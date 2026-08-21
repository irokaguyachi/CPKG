/**
 * ChoKaguya Favorites Share Worker
 * - The only piece of this project that can write to R2: the public
 *   pub-*.r2.dev bucket (src/js/cdnConfig.js) is read-only from the browser,
 *   and the only existing write path (src/scripts/sync_to_r2.py) holds a
 *   full-access secret key that must never reach client JS. This Worker
 *   holds an R2 binding instead (no secret key needed) and exposes narrow
 *   write endpoints.
 *
 * ---- Legacy 1:1 favorites share (kept as-is, not used by the bookmark
 *      library below — see BOOKMARK_SYSTEM_PLAN.md) ----
 * - POST /share       body: { v: 1, novel, series, hof, official } (each an
 *   encodeFavorites() string from src/js/favoritesCodec.js) -> stores it at
 *   share/<code>.json and returns { code, url }.
 * - GET /share/<code>  reads it back.
 *
 * ---- Bookmark library (public, browsable, per-bookmark share) ----
 * - POST /library                body: { name, items:[{type,id}] }
 *     -> stores at library/<code>.json, returns { code, editToken } once.
 *     editToken is never stored in plaintext — only its SHA-256 hash is
 *     saved, because this whole bucket is public-read via pub-*.r2.dev, so
 *     anything written to the object body is effectively public.
 * - GET  /library?cursor=&limit=   -> paginated listing (name/itemCount only,
 *     backed by R2 list() + customMetadata so no per-item GET is needed).
 * - GET  /library/<code>           -> full { code, name, items, ... }
 *     (editTokenHash is stripped before responding).
 * - PUT  /library/<code>           body: { editToken, name?, items? } -> update.
 * - DELETE /library/<code>         body: { editToken } -> delete.
 * All /library GET routes have to go through this Worker too (not the raw
 * pub-*.r2.dev URL) for the same CORS reason as /share, plus GET /library/<code>
 * needs server-side redaction of editTokenHash.
 *
 * ---- Rate limiting ----
 * Every /library write (POST/PUT/DELETE) and the list GET are throttled per
 * client IP via the RATE_LIMIT_KV binding (see wrangler.toml) — a public
 * write endpoint with a browsable public listing is a much more attractive
 * spam target than the old link-only /share, so this was added alongside the
 * library feature rather than left for later (see TRAFFIC_LAG_AUDIT.md).
 * KV is only eventually consistent, so this is a best-effort deterrent, not a
 * hard guarantee — good enough for this use case.
 */

const R2_CDN_BASE = 'https://pub-908f4390549649fbbdff99353f22c6d4.r2.dev';
const CODE_RE = /^[A-Za-z0-9_-]{1,32}$/;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const CODE_LENGTH = 8;
const EDIT_TOKEN_LENGTH = 24;

const MAX_BODY_BYTES = 4096;
const MAX_FIELD_LENGTH = 2000;
const FIELDS = ['novel', 'series', 'hof', 'official'];

const LIBRARY_ITEM_TYPES = ['novel', 'series', 'hof', 'official'];
const LIBRARY_MAX_NAME = 40;
const LIBRARY_MAX_ITEMS = 300;
const LIBRARY_MAX_BODY_BYTES = 20480;
const LIBRARY_LIST_DEFAULT_LIMIT = 20;
const LIBRARY_LIST_MAX_LIMIT = 50;

const RATE_LIMIT_WRITE_PER_HOUR = 20;
const RATE_LIMIT_LIST_PER_HOUR = 120;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json' }, CORS_HEADERS)
  });
}

function generateToken(length) {
  var bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  var chars = [];
  for (var i = 0; i < length; i++) chars.push(ALPHABET[bytes[i] % ALPHABET.length]);
  return chars.join('');
}
function generateCode() { return generateToken(CODE_LENGTH); }
function generateEditToken() { return generateToken(EDIT_TOKEN_LENGTH); }

async function sha256Hex(str) {
  var data = new TextEncoder().encode(str);
  var digest = await crypto.subtle.digest('SHA-256', data);
  var bytes = new Uint8Array(digest);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

// Fixed-window counter in KV, keyed per IP/bucket/hour. Fails open (allows
// the request) if RATE_LIMIT_KV isn't bound — e.g. local `wrangler dev`
// without the namespace set up yet — so the feature isn't blocked on
// deploying that piece first; production must bind it (see wrangler.toml).
async function checkRateLimit(env, ip, bucket, limit) {
  if (!env.RATE_LIMIT_KV) return true;
  var windowStart = Math.floor(Date.now() / 3600000);
  var key = 'rl:' + bucket + ':' + ip + ':' + windowStart;
  var current = await env.RATE_LIMIT_KV.get(key);
  var count = current ? parseInt(current, 10) : 0;
  if (count >= limit) return false;
  await env.RATE_LIMIT_KV.put(key, String(count + 1), { expirationTtl: 3600 });
  return true;
}

// ---- Legacy 1:1 favorites share ----

// Only known fields make it into the stored object — anything else in the
// request body is dropped rather than stored verbatim.
function validatePayload(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return null;
  var clean = { v: 1 };
  for (var i = 0; i < FIELDS.length; i++) {
    var key = FIELDS[i];
    var value = raw[key];
    if (typeof value !== 'string' || value.length > MAX_FIELD_LENGTH) return null;
    clean[key] = value;
  }
  return clean;
}

async function handleShare(request, env) {
  var text;
  try {
    text = await request.text();
  } catch (e) {
    return jsonResponse({ error: 'invalid body' }, 400);
  }
  if (text.length > MAX_BODY_BYTES) {
    return jsonResponse({ error: 'payload too large' }, 413);
  }

  var raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return jsonResponse({ error: 'invalid json' }, 400);
  }

  var payload = validatePayload(raw);
  if (!payload) return jsonResponse({ error: 'invalid payload shape' }, 400);

  var code = null;
  for (var attempt = 0; attempt < 3; attempt++) {
    var candidate = generateCode();
    var existing = await env.FAVORITES_BUCKET.head('share/' + candidate + '.json');
    if (!existing) { code = candidate; break; }
  }
  if (!code) return jsonResponse({ error: 'could not allocate code, try again' }, 500);

  await env.FAVORITES_BUCKET.put('share/' + code + '.json', JSON.stringify(payload), {
    httpMetadata: { contentType: 'application/json' }
  });

  return jsonResponse({ code: code, url: R2_CDN_BASE + '/share/' + code + '.json' }, 201);
}

async function handleGetShare(code, env) {
  if (!CODE_RE.test(code)) return jsonResponse({ error: 'invalid code' }, 400);

  var object = await env.FAVORITES_BUCKET.get('share/' + code + '.json');
  if (!object) return jsonResponse({ error: 'not found' }, 404);

  return new Response(object.body, {
    status: 200,
    headers: Object.assign({ 'Content-Type': 'application/json' }, CORS_HEADERS)
  });
}

// ---- Bookmark library ----

function cleanLibraryName(raw) {
  if (typeof raw !== 'string') return null;
  var trimmed = raw.trim();
  if (!trimmed || trimmed.length > LIBRARY_MAX_NAME) return null;
  return trimmed;
}

function cleanLibraryItems(raw) {
  if (!Array.isArray(raw) || raw.length > LIBRARY_MAX_ITEMS) return null;
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var item = raw[i];
    if (!item || typeof item !== 'object') return null;
    if (LIBRARY_ITEM_TYPES.indexOf(item.type) === -1) return null;
    if (typeof item.id !== 'number' || !Number.isInteger(item.id) || item.id < 0) return null;
    out.push({ type: item.type, id: item.id });
  }
  return out;
}

function validateLibraryCreate(raw) {
  if (!raw || typeof raw !== 'object') return null;
  var name = cleanLibraryName(raw.name);
  var items = cleanLibraryItems(raw.items);
  if (name === null || items === null) return null;
  return { name: name, items: items };
}

function validateLibraryUpdate(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.editToken !== 'string' || !raw.editToken) return null;
  var result = { editToken: raw.editToken };
  if (raw.name !== undefined) {
    var name = cleanLibraryName(raw.name);
    if (name === null) return null;
    result.name = name;
  }
  if (raw.items !== undefined) {
    var items = cleanLibraryItems(raw.items);
    if (items === null) return null;
    result.items = items;
  }
  return result;
}

async function readJsonBody(request, maxBytes) {
  var text = await request.text();
  if (text.length > maxBytes) return { error: jsonResponse({ error: 'payload too large' }, 413) };
  try {
    return { value: JSON.parse(text) };
  } catch (e) {
    return { error: jsonResponse({ error: 'invalid json' }, 400) };
  }
}

function libraryPublicView(code, record) {
  return {
    code: code,
    name: record.name,
    items: record.items,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

async function handleLibraryCreate(request, env) {
  var ip = clientIp(request);
  if (!(await checkRateLimit(env, ip, 'lib-write', RATE_LIMIT_WRITE_PER_HOUR))) {
    return jsonResponse({ error: 'too many requests, try again later' }, 429);
  }

  var body = await readJsonBody(request, LIBRARY_MAX_BODY_BYTES);
  if (body.error) return body.error;

  var clean = validateLibraryCreate(body.value);
  if (!clean) return jsonResponse({ error: 'invalid payload shape' }, 400);

  var code = null;
  for (var attempt = 0; attempt < 3; attempt++) {
    var candidate = generateCode();
    var existing = await env.FAVORITES_BUCKET.head('library/' + candidate + '.json');
    if (!existing) { code = candidate; break; }
  }
  if (!code) return jsonResponse({ error: 'could not allocate code, try again' }, 500);

  var editToken = generateEditToken();
  var editTokenHash = await sha256Hex(editToken);
  var now = Date.now();
  var record = {
    v: 1,
    name: clean.name,
    items: clean.items,
    editTokenHash: editTokenHash,
    createdAt: now,
    updatedAt: now
  };

  await env.FAVORITES_BUCKET.put('library/' + code + '.json', JSON.stringify(record), {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: {
      name: clean.name,
      itemCount: String(clean.items.length),
      updatedAt: String(now)
    }
  });

  return jsonResponse({ code: code, editToken: editToken }, 201);
}

async function handleLibraryList(url, request, env) {
  var ip = clientIp(request);
  if (!(await checkRateLimit(env, ip, 'lib-list', RATE_LIMIT_LIST_PER_HOUR))) {
    return jsonResponse({ error: 'too many requests, try again later' }, 429);
  }

  var cursor = url.searchParams.get('cursor') || undefined;
  var limit = parseInt(url.searchParams.get('limit'), 10);
  if (!limit || limit < 1 || limit > LIBRARY_LIST_MAX_LIMIT) limit = LIBRARY_LIST_DEFAULT_LIMIT;

  var listed = await env.FAVORITES_BUCKET.list({
    prefix: 'library/',
    cursor: cursor,
    limit: limit,
    include: ['customMetadata']
  });

  var items = listed.objects.map(function (obj) {
    var meta = obj.customMetadata || {};
    var code = obj.key.slice('library/'.length, obj.key.length - '.json'.length);
    return {
      code: code,
      name: meta.name || '',
      itemCount: parseInt(meta.itemCount || '0', 10),
      updatedAt: parseInt(meta.updatedAt || '0', 10)
    };
  });

  return jsonResponse({ items: items, cursor: listed.truncated ? listed.cursor : null });
}

async function handleLibraryGet(code, env) {
  if (!CODE_RE.test(code)) return jsonResponse({ error: 'invalid code' }, 400);

  var object = await env.FAVORITES_BUCKET.get('library/' + code + '.json');
  if (!object) return jsonResponse({ error: 'not found' }, 404);

  var record = await object.json();
  return jsonResponse(libraryPublicView(code, record));
}

async function handleLibraryUpdate(code, request, env) {
  var ip = clientIp(request);
  if (!(await checkRateLimit(env, ip, 'lib-write', RATE_LIMIT_WRITE_PER_HOUR))) {
    return jsonResponse({ error: 'too many requests, try again later' }, 429);
  }
  if (!CODE_RE.test(code)) return jsonResponse({ error: 'invalid code' }, 400);

  var object = await env.FAVORITES_BUCKET.get('library/' + code + '.json');
  if (!object) return jsonResponse({ error: 'not found' }, 404);
  var record = await object.json();

  var body = await readJsonBody(request, LIBRARY_MAX_BODY_BYTES);
  if (body.error) return body.error;

  var clean = validateLibraryUpdate(body.value);
  if (!clean) return jsonResponse({ error: 'invalid payload shape' }, 400);

  var providedHash = await sha256Hex(clean.editToken);
  if (providedHash !== record.editTokenHash) {
    return jsonResponse({ error: 'invalid edit token' }, 403);
  }

  if (clean.name !== undefined) record.name = clean.name;
  if (clean.items !== undefined) record.items = clean.items;
  record.updatedAt = Date.now();

  await env.FAVORITES_BUCKET.put('library/' + code + '.json', JSON.stringify(record), {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: {
      name: record.name,
      itemCount: String(record.items.length),
      updatedAt: String(record.updatedAt)
    }
  });

  return jsonResponse(libraryPublicView(code, record));
}

async function handleLibraryDelete(code, request, env) {
  var ip = clientIp(request);
  if (!(await checkRateLimit(env, ip, 'lib-write', RATE_LIMIT_WRITE_PER_HOUR))) {
    return jsonResponse({ error: 'too many requests, try again later' }, 429);
  }
  if (!CODE_RE.test(code)) return jsonResponse({ error: 'invalid code' }, 400);

  var object = await env.FAVORITES_BUCKET.get('library/' + code + '.json');
  if (!object) return jsonResponse({ error: 'not found' }, 404);
  var record = await object.json();

  var body = await readJsonBody(request, LIBRARY_MAX_BODY_BYTES);
  if (body.error) return body.error;
  if (!body.value || typeof body.value.editToken !== 'string' || !body.value.editToken) {
    return jsonResponse({ error: 'invalid payload shape' }, 400);
  }

  var providedHash = await sha256Hex(body.value.editToken);
  if (providedHash !== record.editTokenHash) {
    return jsonResponse({ error: 'invalid edit token' }, 403);
  }

  await env.FAVORITES_BUCKET.delete('library/' + code + '.json');
  return jsonResponse({ ok: true });
}

export default {
  async fetch(request, env) {
    var url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === '/share' && request.method === 'POST') {
      return handleShare(request, env);
    }
    if (url.pathname.indexOf('/share/') === 0 && request.method === 'GET') {
      return handleGetShare(url.pathname.slice('/share/'.length), env);
    }

    if (url.pathname === '/library' && request.method === 'POST') {
      return handleLibraryCreate(request, env);
    }
    if (url.pathname === '/library' && request.method === 'GET') {
      return handleLibraryList(url, request, env);
    }
    if (url.pathname.indexOf('/library/') === 0) {
      var libCode = url.pathname.slice('/library/'.length);
      if (request.method === 'GET') return handleLibraryGet(libCode, env);
      if (request.method === 'PUT') return handleLibraryUpdate(libCode, request, env);
      if (request.method === 'DELETE') return handleLibraryDelete(libCode, request, env);
    }

    return jsonResponse({ error: 'not found' }, 404);
  }
};
