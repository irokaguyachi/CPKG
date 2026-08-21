/**
 * ChoKaguya Favorites Share Worker
 * - The only piece of this project that can write to R2: the public
 *   pub-*.r2.dev bucket (src/js/cdnConfig.js) is read-only from the browser,
 *   and the only existing write path (src/scripts/sync_to_r2.py) holds a
 *   full-access secret key that must never reach client JS. This Worker
 *   holds an R2 binding instead (no secret key needed) and exposes narrow
 *   write endpoints.
 *
 * ---- Bookmark library (public, browsable, per-bookmark share) ----
 * - POST /library                body: { name, items:[{type,id}] }
 *     -> stores at library/<code>.json, returns { code, editToken } once.
 *     editToken is never stored in plaintext — only its SHA-256 hash is
 *     saved, because this whole bucket is public-read via pub-*.r2.dev, so
 *     anything written to the object body is effectively public.
 * - GET  /library?sort=&q=&offset=&limit=  -> listing (name/itemCount only,
 *     backed by R2 list() + customMetadata so no per-item GET is needed).
 *     sort: new (default, newest published) | updated | name. q filters on
 *     name. Offset paging, not cursor: the whole prefix is scanned and sorted
 *     first, because R2 only lists in key order (see LIBRARY_SCAN_MAX).
 * - GET  /library/<code>           -> full { code, name, items, ... }
 *     (editTokenHash is stripped before responding).
 * - PUT  /library/<code>           body: { editToken, name?, items? } -> update.
 * - DELETE /library/<code>         body: { editToken } -> delete.
 * All /library GET routes have to go through this Worker too, not the raw
 * pub-*.r2.dev URL: that bucket serves GET with no Access-Control-Allow-Origin
 * header, which blocks a cross-origin fetch() from reading the JSON body in JS.
 * GET /library/<code> additionally needs server-side redaction of editTokenHash.
 *
 * ---- Rate limiting ----
 * Every /library write (POST/PUT/DELETE) and the list GET are throttled per
 * client IP via the RATE_LIMIT_KV binding (see wrangler.toml) — a public
 * write endpoint with a browsable public listing is an attractive spam
 * target, so this was added alongside the library feature rather than left
 * for later (see TRAFFIC_LAG_AUDIT.md).
 * KV is only eventually consistent, so this is a best-effort deterrent, not a
 * hard guarantee — good enough for this use case.
 */

const CODE_RE = /^[A-Za-z0-9_-]{1,32}$/;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const CODE_LENGTH = 8;
const EDIT_TOKEN_LENGTH = 24;

const LIBRARY_ITEM_TYPES = ['novel', 'series', 'hof', 'official'];
const LIBRARY_MAX_NAME = 40;
const LIBRARY_MAX_ITEMS = 300;
const LIBRARY_MAX_BODY_BYTES = 20480;
const LIBRARY_LIST_DEFAULT_LIMIT = 20;
const LIBRARY_LIST_MAX_LIMIT = 50;
// R2 list() only ever returns key (= random code) order, so newest-first and
// name search can't be done with a cursor page. The listing instead scans the
// whole prefix, sorts, then slices. Capped so a runaway bucket can't turn one
// request into unbounded list() calls; past the cap the ordering is partial
// and `truncated` says so.
const LIBRARY_SCAN_PAGE = 1000;
const LIBRARY_SCAN_MAX = 4000;
const LIBRARY_MAX_QUERY = 40;

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
      createdAt: String(now),
      updatedAt: String(now)
    }
  });

  return jsonResponse({ code: code, editToken: editToken }, 201);
}

async function scanLibrary(env) {
  var all = [];
  var cursor = undefined;
  var truncated = false;
  while (true) {
    var page = await env.FAVORITES_BUCKET.list({
      prefix: 'library/',
      cursor: cursor,
      limit: LIBRARY_SCAN_PAGE,
      include: ['customMetadata']
    });
    for (var i = 0; i < page.objects.length; i++) {
      var obj = page.objects[i];
      var meta = obj.customMetadata || {};
      var updatedAt = parseInt(meta.updatedAt || '0', 10) || 0;
      all.push({
        code: obj.key.slice('library/'.length, obj.key.length - '.json'.length),
        name: meta.name || '',
        itemCount: parseInt(meta.itemCount || '0', 10) || 0,
        // objects published before createdAt was recorded fall back to
        // updatedAt so they still sort sensibly instead of sinking to 0
        createdAt: parseInt(meta.createdAt || meta.updatedAt || '0', 10) || 0,
        updatedAt: updatedAt
      });
    }
    if (!page.truncated) break;
    if (all.length >= LIBRARY_SCAN_MAX) { truncated = true; break; }
    cursor = page.cursor;
  }
  return { all: all, truncated: truncated };
}

async function handleLibraryList(url, request, env) {
  var ip = clientIp(request);
  if (!(await checkRateLimit(env, ip, 'lib-list', RATE_LIMIT_LIST_PER_HOUR))) {
    return jsonResponse({ error: 'too many requests, try again later' }, 429);
  }

  var limit = parseInt(url.searchParams.get('limit'), 10);
  if (!limit || limit < 1 || limit > LIBRARY_LIST_MAX_LIMIT) limit = LIBRARY_LIST_DEFAULT_LIMIT;
  var offset = parseInt(url.searchParams.get('offset'), 10);
  if (!offset || offset < 0) offset = 0;

  var sort = url.searchParams.get('sort') || 'new';
  if (sort !== 'new' && sort !== 'updated' && sort !== 'name') sort = 'new';

  var q = (url.searchParams.get('q') || '').trim().slice(0, LIBRARY_MAX_QUERY).toLowerCase();

  var scanned = await scanLibrary(env);
  var rows = scanned.all;

  if (q) {
    rows = rows.filter(function (r) { return r.name.toLowerCase().indexOf(q) !== -1; });
  }

  rows.sort(function (a, b) {
    // 'ko' is pinned rather than relying on the runtime default locale —
    // Korean collation sorts Hangul ahead of Latin, which is what a Korean
    // reader expects from 가나다순
    if (sort === 'name') return a.name.localeCompare(b.name, 'ko') || b.createdAt - a.createdAt;
    if (sort === 'updated') return b.updatedAt - a.updatedAt;
    return b.createdAt - a.createdAt;
  });

  var total = rows.length;
  var items = rows.slice(offset, offset + limit);

  return jsonResponse({
    items: items,
    total: total,
    offset: offset,
    limit: limit,
    hasMore: offset + items.length < total,
    sort: sort,
    q: q,
    truncated: scanned.truncated
  });
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
      createdAt: String(record.createdAt || record.updatedAt),
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
