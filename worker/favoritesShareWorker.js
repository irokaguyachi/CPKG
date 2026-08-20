/**
 * ChoKaguya Favorites Share Worker
 * - The only piece of this project that can write to R2: the public
 *   pub-*.r2.dev bucket (src/js/cdnConfig.js) is read-only from the browser,
 *   and the only existing write path (src/scripts/sync_to_r2.py) holds a
 *   full-access secret key that must never reach client JS. This Worker
 *   holds an R2 binding instead (no secret key needed) and exposes a single
 *   narrow write endpoint.
 * - POST /share       body: { v: 1, novel, series, hof, official } (each an
 *   encodeFavorites() string from src/js/favoritesCodec.js) -> stores it at
 *   share/<code>.json and returns { code, url }.
 * - GET /share/<code>  reads it back. This has to go through the Worker too,
 *   not straight to the public pub-*.r2.dev URL: that bucket serves GET with
 *   no Access-Control-Allow-Origin header, which is fine for <img>/
 *   background-image (no CORS needed to just paint pixels) but blocks a
 *   cross-origin fetch() from reading the JSON body in JS. This route adds
 *   the CORS header the raw bucket doesn't.
 */

const R2_CDN_BASE = 'https://pub-908f4390549649fbbdff99353f22c6d4.r2.dev';
const CODE_RE = /^[A-Za-z0-9_-]{1,32}$/;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const CODE_LENGTH = 8;
const MAX_BODY_BYTES = 4096;
const MAX_FIELD_LENGTH = 2000;
const FIELDS = ['novel', 'series', 'hof', 'official'];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json' }, CORS_HEADERS)
  });
}

function generateCode() {
  var bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  var chars = [];
  for (var i = 0; i < CODE_LENGTH; i++) chars.push(ALPHABET[bytes[i] % ALPHABET.length]);
  return chars.join('');
}

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
      var code = url.pathname.slice('/share/'.length);
      return handleGetShare(code, env);
    }

    return jsonResponse({ error: 'not found' }, 404);
  }
};
