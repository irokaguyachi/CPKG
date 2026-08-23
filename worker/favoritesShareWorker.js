/**
 * ChoKaguya Favorites Share Worker
 * - 2026-08-23: 별도 Worker(chokaguya-favorites-share, 독립된
 *   workers.dev 서브도메인)로 배포하던 걸 그만두고, 이 파일은 이제
 *   src/_worker.js가 import해서 cpkg Worker(정적 사이트와 같은 배포)의
 *   API 부분으로 합쳐졌다. 실제 배포 설정은 src/wrangler.toml에 있고, 이
 *   파일 자체를 위한 wrangler.toml은 더 이상 없다 — R2/KV 바인딩 이름
 *   (FAVORITES_BUCKET, RATE_LIMIT_KV)은 그대로라 코드는 안 바뀐다.
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
 * - PUT  /library/<code>           body: { editToken?, personalCode?, name?, items? } -> update.
 * - DELETE /library/<code>         body: { editToken?, personalCode? } -> delete.
 *     PUT/DELETE need at least one of editToken/personalCode, and only one of
 *     them has to match (see verifyLibraryAuth) — that's what lets a personal
 *     code alone recover edit rights without ever knowing the editToken.
 * All /library GET routes have to go through this Worker too, not the raw
 * pub-*.r2.dev URL: that bucket serves GET with no Access-Control-Allow-Origin
 * header, which blocks a cross-origin fetch() from reading the JSON body in JS.
 * GET /library/<code> additionally needs server-side redaction of editTokenHash
 * and ownerHash.
 *
 * ---- Personal recovery code (no login, browser-wide "account") ----
 * A real login (email/password, OAuth) was considered and rejected — this
 * project has no account/session/email infrastructure at all, and it would
 * be a lot of new surface for a hobby archive. Instead each browser keeps one
 * random "personal code" (src/js/bookmarkLibrary.js), sent as `personalCode`
 * on every publish/update/delete. Entering that one code on another device
 * recovers edit rights over *every* bookmark ever published from the
 * original browser, instead of juggling a code/editToken pair per bookmark.
 * - Every /library write may include `personalCode`. On create it links the
 *   new record to that code; on update/delete it's accepted as an
 *   alternative to editToken.
 * - Ownership proof is `ownerHash = sha256('owner:'+code+':'+personalCode)`,
 *   stored on the record (never the plaintext code, same reasoning as
 *   editTokenHash). Hashing the record's own `code` in too means two
 *   bookmarks owned by the same person don't share a recoverable value even
 *   if someone scrapes the whole public bucket — you can't tell they're
 *   linked without already knowing the personal code.
 * - POST /library/<code>/claim-owner   body: { editToken, personalCode }
 *     -> links a bookmark published *before* this feature (or from a
 *     session that skipped personalCode) to a personal code. Proves
 *     ownership via the existing editToken, one bookmark at a time. This is
 *     what the client's one-shot "이 브라우저의 기존 코드들을 내 개인 코드로
 *     가져오기" migration calls for each locally-remembered editToken.
 * - POST /owner/lookup   body: { personalCode }
 *     -> { items:[{code,name,itemCount,createdAt,updatedAt}], total } for
 *     every bookmark linked to that code — this is what "이 코드로 전체
 *     되찾기" shows on another device. Backed by an index object at
 *     owners/<sha256('owner-index:'+personalCode)>.json holding just the
 *     list of codes (R2 list() can't be queried by arbitrary field, so this
 *     index stands in for a lookup-by-owner query). Each code's
 *     name/itemCount/timestamps come from R2 head() + customMetadata, same
 *     as the library listing, so lookup never reads record bodies. A code
 *     already deleted from library/ is dropped from the index the next time
 *     someone looks it up (best-effort GC, not a background job).
 * - The index is a convenience for discovery only, not the source of
 *   authorization — PUT/DELETE always check ownerHash on the record itself.
 *   If an index write ever fails (e.g. right after create), the record is
 *   still fully usable via personalCode; it just won't surface in a lookup
 *   until claim-owner or another publish repairs the index.
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

// 클라이언트가 생성하는 개인 코드는 20자 커스텀 알파벳(chokaguya_personal_code)을
// 기대하지만, 서버 검증은 형태만 넉넉하게 확인한다(길이 16~64, URL-safe 문자) —
// 클라이언트 쪽 알파벳/길이가 나중에 바뀌어도 서버를 같이 고칠 필요가 없도록.
const PERSONAL_CODE_RE = /^[A-Za-z0-9_-]{16,64}$/;
// 개인 코드 하나에 연결할 수 있는 공개 북마크 수 상한 — 이 인덱스는 조회
// 편의용일 뿐 권한 증명 자체는 레코드의 ownerHash가 하므로, 상한을 넘긴
// 코드도 직접 알고 있으면 여전히 PUT/DELETE는 정상 동작한다(조회 목록에만
// 안 뜬다).
const OWNER_MAX_CODES = 500;

const RATE_LIMIT_WRITE_PER_HOUR = 20;
const RATE_LIMIT_LIST_PER_HOUR = 120;
const RATE_LIMIT_OWNER_LOOKUP_PER_HOUR = 60;

// ---- 유저 계정 스토어(/user/*) ----
// 공개 라이브러리(library/)와 달리 여기엔 비공개 북마크까지 전부 들어간다.
// 스냅샷을 통째로 주고받으므로 본문이 library 쪽보다 훨씬 크다.
const USER_MAX_BODY_BYTES = 1048576;
const USER_MAX_BOOKMARKS = 100;
const USER_MAX_ITEMS_PER_BOOKMARK = 300;
const USER_MAX_TOMBSTONES = 500;
const USER_MAX_NAME = 200;
// 클라이언트 로컬 스토어(src/js/bookmarks.js)의 version 과 맞물린 값 —
// 한쪽만 올리면 동기화가 조용히 어긋나므로 반드시 같이 올려야 한다.
const USER_DATA_VERSION = 2;
// etag CAS 가 어긋났을 때 다시 읽고 시도하는 횟수. 넘기면 409로 넘겨서
// 클라이언트가 병합하게 한다(서버는 병합 로직을 갖지 않는다 — 아래 주석 참고).
const USER_SYNC_MAX_ATTEMPTS = 3;

const RATE_LIMIT_USER_SYNC_PER_HOUR = 200;
const RATE_LIMIT_USER_AUTH_PER_HOUR = 60;
// 회원가입만 훨씬 좁은 하루 단위 한도를 따로 둔다 — 로그인(handleUserGet)은
// 정상적인 재방문마다 계속 일어나는 동작이라 시간당 한도를 그대로 쓰지만,
// 가입은 계정을 하나 새로 만드는 동작이라 같은 IP에서 반복될 이유가 없다.
const RATE_LIMIT_USER_SIGNUP_PER_DAY = 1;
const DAY_MS = 86400000;

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

// ---- 개인 복구 코드 ----
// code(레코드 자신의 공개 코드)를 해시에 함께 섞어서, 같은 사람이 올린
// 북마크 두 개라도 ownerHash 값이 서로 달라지게 한다 — 공개 버킷을 통째로
// 긁어봐도 이 값들만으로는 "같은 사람 것"이라는 상관관계가 드러나지 않는다.
async function ownerHashFor(personalCode, code) {
  return sha256Hex('owner:' + code + ':' + personalCode);
}

// 개인 코드 → 소유한 공개 코드 목록을 찾기 위한 인덱스 오브젝트 키.
// R2 list()는 프리픽스로만 훑을 수 있고 임의 필드로 조회할 수 없어서,
// "이 개인 코드가 어떤 code들을 소유하는지"를 이 인덱스 오브젝트가 대신한다.
async function ownerIndexKey(personalCode) {
  return 'owners/' + (await sha256Hex('owner-index:' + personalCode)) + '.json';
}

function cleanPersonalCode(raw) {
  if (typeof raw !== 'string') return null;
  var trimmed = raw.trim();
  if (!PERSONAL_CODE_RE.test(trimmed)) return null;
  return trimmed;
}

// 인덱스는 조회 편의용일 뿐이라 실패해도 삼켜서 게시/연결 자체를 막지 않는다
// (문서 상단 주석 참고 — 권한 증명은 항상 레코드 자신의 ownerHash가 한다).
async function addToOwnerIndex(env, personalCode, code) {
  try {
    var key = await ownerIndexKey(personalCode);
    var object = await env.FAVORITES_BUCKET.get(key);
    var codes = [];
    if (object) {
      var data = await object.json();
      if (data && Array.isArray(data.codes)) {
        codes = data.codes.filter(function (c) { return typeof c === 'string'; });
      }
    }
    if (codes.indexOf(code) === -1) {
      if (codes.length >= OWNER_MAX_CODES) return;
      codes.push(code);
      await env.FAVORITES_BUCKET.put(key, JSON.stringify({ v: 1, codes: codes }), {
        httpMetadata: { contentType: 'application/json' }
      });
    }
  } catch (e) {
    // 인덱스 갱신 실패 — 개별 레코드는 여전히 personalCode로 정상 인증된다
  }
}

// PUT/DELETE 공용 인증: editToken 또는 personalCode 중 하나만 record와
// 맞으면 통과한다. personalCode는 record.ownerHash가 세팅돼 있을 때만
// (즉 이 코드로 연결된 적이 있을 때만) 통할 수 있다.
async function verifyLibraryAuth(record, code, auth) {
  if (auth.editToken) {
    var providedHash = await sha256Hex(auth.editToken);
    if (providedHash === record.editTokenHash) return true;
  }
  if (auth.personalCode && record.ownerHash) {
    var providedOwnerHash = await ownerHashFor(auth.personalCode, code);
    if (providedOwnerHash === record.ownerHash) return true;
  }
  return false;
}

// PUT body와 DELETE body가 공유하는 인증 필드 파싱 — editToken/personalCode
// 중 최소 하나는 있어야 하고, personalCode가 있으면 형태를 검증한다.
function validateLibraryAuth(raw) {
  if (!raw || typeof raw !== 'object') return null;
  var hasEditToken = typeof raw.editToken === 'string' && raw.editToken;
  var hasPersonalCode = typeof raw.personalCode === 'string' && raw.personalCode;
  if (!hasEditToken && !hasPersonalCode) return null;
  var result = {};
  if (hasEditToken) result.editToken = raw.editToken;
  if (hasPersonalCode) {
    var personalCode = cleanPersonalCode(raw.personalCode);
    if (personalCode === null) return null;
    result.personalCode = personalCode;
  }
  return result;
}

// Fixed-window counter in KV, keyed per IP/bucket/window. Fails open (allows
// the request) if RATE_LIMIT_KV isn't bound — e.g. local `wrangler dev`
// without the namespace set up yet — so the feature isn't blocked on
// deploying that piece first; production must bind it (see wrangler.toml).
// windowMs defaults to an hour; callers that need a coarser window (e.g. the
// once-a-day signup cap) pass a bigger one.
async function checkRateLimit(env, ip, bucket, limit, windowMs) {
  if (!env.RATE_LIMIT_KV) return true;
  windowMs = windowMs || 3600000;
  var windowStart = Math.floor(Date.now() / windowMs);
  var key = 'rl:' + bucket + ':' + ip + ':' + windowStart;
  var current = await env.RATE_LIMIT_KV.get(key);
  var count = current ? parseInt(current, 10) : 0;
  if (count >= limit) return false;
  await env.RATE_LIMIT_KV.put(key, String(count + 1), { expirationTtl: Math.ceil(windowMs / 1000) });
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
  var result = { name: name, items: items };
  // personalCode는 선택 — 없어도 게시는 되지만(옛 클라이언트/개인 코드
  // 생성 실패 등 대비), 있으면 형태가 맞아야 한다.
  if (typeof raw.personalCode === 'string' && raw.personalCode) {
    var personalCode = cleanPersonalCode(raw.personalCode);
    if (personalCode === null) return null;
    result.personalCode = personalCode;
  }
  return result;
}

function validateLibraryUpdate(raw) {
  var auth = validateLibraryAuth(raw);
  if (!auth) return null;
  var result = auth;
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
  var ownerHash = clean.personalCode ? await ownerHashFor(clean.personalCode, code) : null;
  var now = Date.now();
  var record = {
    v: 1,
    name: clean.name,
    items: clean.items,
    editTokenHash: editTokenHash,
    ownerHash: ownerHash,
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

  if (clean.personalCode) {
    await addToOwnerIndex(env, clean.personalCode, code);
  }

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

  var authorized = await verifyLibraryAuth(record, code, clean);
  if (!authorized) {
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
  var auth = validateLibraryAuth(body.value);
  if (!auth) return jsonResponse({ error: 'invalid payload shape' }, 400);

  var authorized = await verifyLibraryAuth(record, code, auth);
  if (!authorized) {
    return jsonResponse({ error: 'invalid edit token' }, 403);
  }

  await env.FAVORITES_BUCKET.delete('library/' + code + '.json');
  // 인덱스에서 이 code를 빼는 건 베스트 에포트로만 한다: 인증이 editToken을
  // 통해 이뤄졌다면 서버는 personalCode 평문을 모르므로 인덱스 키(해시)를
  // 계산할 수 없다 — 이런 잔여 항목은 owner/lookup 조회 시 head()가 404를
  // 반환하면 그때 정리된다(handleOwnerLookup 참고).
  if (auth.personalCode) {
    try {
      var indexKey = await ownerIndexKey(auth.personalCode);
      var indexObject = await env.FAVORITES_BUCKET.get(indexKey);
      if (indexObject) {
        var indexData = await indexObject.json();
        var codes = (indexData && Array.isArray(indexData.codes)) ? indexData.codes : [];
        var next = codes.filter(function (c) { return c !== code; });
        if (next.length !== codes.length) {
          await env.FAVORITES_BUCKET.put(indexKey, JSON.stringify({ v: 1, codes: next }), {
            httpMetadata: { contentType: 'application/json' }
          });
        }
      }
    } catch (e) {}
  }
  return jsonResponse({ ok: true });
}

async function handleLibraryClaimOwner(code, request, env) {
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
  var personalCode = cleanPersonalCode(body.value.personalCode);
  if (personalCode === null) return jsonResponse({ error: 'invalid payload shape' }, 400);

  var providedHash = await sha256Hex(body.value.editToken);
  if (providedHash !== record.editTokenHash) {
    return jsonResponse({ error: 'invalid edit token' }, 403);
  }

  // 이미 공개된 내용을 그대로 둔 채 소유권 표지만 붙인다 — name/items는 물론
  // updatedAt도 건드리지 않는다(연결 자체는 "수정"이 아니므로 목록 정렬
  // 순서에 영향을 주면 안 된다).
  record.ownerHash = await ownerHashFor(personalCode, code);
  await env.FAVORITES_BUCKET.put('library/' + code + '.json', JSON.stringify(record), {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: {
      name: record.name,
      itemCount: String(record.items.length),
      createdAt: String(record.createdAt || record.updatedAt),
      updatedAt: String(record.updatedAt)
    }
  });
  await addToOwnerIndex(env, personalCode, code);

  return jsonResponse({ ok: true });
}

async function handleOwnerLookup(request, env) {
  var ip = clientIp(request);
  if (!(await checkRateLimit(env, ip, 'owner-lookup', RATE_LIMIT_OWNER_LOOKUP_PER_HOUR))) {
    return jsonResponse({ error: 'too many requests, try again later' }, 429);
  }

  var body = await readJsonBody(request, LIBRARY_MAX_BODY_BYTES);
  if (body.error) return body.error;
  var personalCode = cleanPersonalCode(body.value && body.value.personalCode);
  if (personalCode === null) return jsonResponse({ error: 'invalid payload shape' }, 400);

  var indexKey = await ownerIndexKey(personalCode);
  var indexObject = await env.FAVORITES_BUCKET.get(indexKey);
  if (!indexObject) return jsonResponse({ items: [], total: 0 });

  var indexData = await indexObject.json();
  var codes = (indexData && Array.isArray(indexData.codes))
    ? indexData.codes.filter(function (c) { return typeof c === 'string'; })
    : [];

  var items = [];
  var staleFound = false;
  for (var i = 0; i < codes.length; i++) {
    var libCode = codes[i];
    var head = await env.FAVORITES_BUCKET.head('library/' + libCode + '.json');
    if (!head) { staleFound = true; continue; }
    var meta = head.customMetadata || {};
    items.push({
      code: libCode,
      name: meta.name || '',
      itemCount: parseInt(meta.itemCount || '0', 10) || 0,
      createdAt: parseInt(meta.createdAt || meta.updatedAt || '0', 10) || 0,
      updatedAt: parseInt(meta.updatedAt || '0', 10) || 0
    });
  }

  items.sort(function (a, b) { return b.updatedAt - a.updatedAt; });

  if (staleFound) {
    // 이미 삭제된 코드가 인덱스에 남아 있었다 — 다음 조회가 깨끗하도록
    // 정리해둔다(베스트 에포트, 실패해도 이번 응답에는 영향 없음).
    try {
      var liveCodes = items.map(function (it) { return it.code; });
      await env.FAVORITES_BUCKET.put(indexKey, JSON.stringify({ v: 1, codes: liveCodes }), {
        httpMetadata: { contentType: 'application/json' }
      });
    } catch (e) {}
  }

  return jsonResponse({ items: items, total: items.length });
}

// ---- 유저 계정 스토어 ----
// 공개 라이브러리와 완전히 분리된 프라이빗 저장소. 키가 개인 코드의 해시라
// 버킷이 공개 읽기 가능해도 키를 모르면 닿을 수 없다. owner-index 와는 해시
// prefix 가 달라서(user-v2: vs owner-index:) 같은 개인 코드라도 두 키가
// 전혀 다른 값이 된다 — 마이그레이션할 땐 양쪽을 따로 계산해야 한다.
async function userStoreKey(personalCode) {
  return 'user/' + (await sha256Hex('user-v2:' + personalCode)) + '.json';
}

function emptyUserData() {
  return { version: USER_DATA_VERSION, bookmarks: [], deletedBookmarks: [] };
}

function cleanUserItems(raw) {
  if (!Array.isArray(raw) || raw.length > USER_MAX_ITEMS_PER_BOOKMARK) return null;
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var item = raw[i];
    if (!item || typeof item !== 'object') return null;
    if (LIBRARY_ITEM_TYPES.indexOf(item.type) === -1) return null;
    if (typeof item.id !== 'number' || !Number.isInteger(item.id) || item.id < 0) return null;
    out.push({
      type: item.type,
      id: item.id,
      addedAt: typeof item.addedAt === 'number' ? item.addedAt : 0
    });
  }
  return out;
}

function cleanUserTombstones(raw, stampField) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > USER_MAX_TOMBSTONES) return null;
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var t = raw[i];
    if (!t || typeof t !== 'object') return null;
    var stamp = typeof t[stampField] === 'number' ? t[stampField] : 0;
    if (stampField === 'deletedAt') {
      if (typeof t.id !== 'string' || !t.id || t.id.length > 64) return null;
      out.push({ id: t.id, deletedAt: stamp });
    } else {
      if (LIBRARY_ITEM_TYPES.indexOf(t.type) === -1) return null;
      if (typeof t.id !== 'number' || !Number.isInteger(t.id)) return null;
      out.push({ type: t.type, id: t.id, removedAt: stamp });
    }
  }
  return out;
}

// 클라이언트 로컬 스토어를 그대로 받되, 남이 버킷에 쓰레기를 밀어 넣지
// 못하도록 형태와 크기만 확인하고 아는 필드만 재조립한다.
function cleanUserData(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.version !== USER_DATA_VERSION) return null;
  if (!Array.isArray(raw.bookmarks) || raw.bookmarks.length > USER_MAX_BOOKMARKS) return null;

  var bookmarks = [];
  for (var i = 0; i < raw.bookmarks.length; i++) {
    var b = raw.bookmarks[i];
    if (!b || typeof b !== 'object') return null;
    if (typeof b.id !== 'string' || !b.id || b.id.length > 64) return null;
    if (typeof b.name !== 'string' || b.name.length > USER_MAX_NAME) return null;
    var items = cleanUserItems(b.items);
    if (items === null) return null;
    var removedItems = cleanUserTombstones(b.removedItems, 'removedAt');
    if (removedItems === null) return null;
    // 공개 라이브러리(library/<code>.json)에 이미 올라가 있으면 그 code —
    // 클라이언트가 같은 북마크를 다른 기기에서 또 공개하지 않도록 이 값을
    // 계정 데이터에 함께 실어 나른다(bookmarks.js 상단 주석 참고).
    var publishedCode = (typeof b.publishedCode === 'string' && CODE_RE.test(b.publishedCode))
      ? b.publishedCode : null;
    bookmarks.push({
      id: b.id,
      name: b.name,
      createdAt: typeof b.createdAt === 'number' ? b.createdAt : 0,
      updatedAt: typeof b.updatedAt === 'number' ? b.updatedAt : 0,
      items: items,
      removedItems: removedItems,
      publishedCode: publishedCode,
      // publishedCode 전용 타임스탬프 — 공용 updatedAt에 얹으면 이름 변경 같은
      // 무관한 수정이 "더 최신"으로 잡혀서 공개 취소가 되살아나는 병합 버그가
      // 생긴다(src/js/userData.js의 mergePublishedCode 참고).
      publishedCodeUpdatedAt: typeof b.publishedCodeUpdatedAt === 'number' ? b.publishedCodeUpdatedAt : 0
    });
  }

  var deletedBookmarks = cleanUserTombstones(raw.deletedBookmarks, 'deletedAt');
  if (deletedBookmarks === null) return null;

  return { version: USER_DATA_VERSION, bookmarks: bookmarks, deletedBookmarks: deletedBookmarks };
}

// head() 만으로 "서버가 나보다 최신인지"를 판단할 수 있게 메타로도 남긴다 —
// 폴링이 매번 본문 전체를 내려받지 않아도 되게 하는 게 목적(library 레코드가
// customMetadata 로 목록을 만드는 것과 같은 수법).
function userStorePutOptions(record) {
  return {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: {
      syncVersion: String(record.syncVersion),
      updatedAt: String(record.updatedAt)
    }
  };
}

async function readUserBody(request, env, bucket, limit, windowMs) {
  // bucket 이 없으면 rate limit 자체를 건너뛴다 — /user/head 가 이 경로다.
  // KV 는 요청마다 get+put 두 번을 쓰는데, head 는 60초 폴링(userData.js)이
  // 계속 때리는 엔드포인트라 여기서만 KV 를 아끼면 일일 무료 한도 소모가
  // 크게 줄어든다. head 자체는 R2 head() 조회뿐이라 남용돼도 부담이 훨씬
  // 가벼운 R2 Class B 요청만 늘어난다(무료 한도가 KV 쓰기보다 훨씬 넉넉함).
  if (bucket) {
    var ip = clientIp(request);
    if (!(await checkRateLimit(env, ip, bucket, limit, windowMs))) {
      return { error: jsonResponse({ error: 'too many requests, try again later' }, 429) };
    }
  }
  var body = await readJsonBody(request, USER_MAX_BODY_BYTES);
  if (body.error) return { error: body.error };
  var personalCode = cleanPersonalCode(body.value && body.value.personalCode);
  if (personalCode === null) return { error: jsonResponse({ error: 'invalid payload shape' }, 400) };
  return { personalCode: personalCode, raw: body.value };
}

async function handleUserSignup(request, env) {
  // 회원가입은 로그인(handleUserGet)과 다른 버킷·다른 창(하루)을 쓴다 —
  // 같은 IP에서 계정을 계속 새로 찍어내는 걸 막는 게 목적이라, 시간당
  // 한도로는 너무 느슨하다.
  var parsed = await readUserBody(request, env, 'user-signup', RATE_LIMIT_USER_SIGNUP_PER_DAY, DAY_MS);
  if (parsed.error) return parsed.error;

  var key = await userStoreKey(parsed.personalCode);
  var existing = await env.FAVORITES_BUCKET.head(key);
  if (existing) {
    var meta = existing.customMetadata || {};
    return jsonResponse({ ok: true, existed: true, syncVersion: parseInt(meta.syncVersion || '1', 10) || 1 });
  }

  var now = Date.now();
  var record = { v: 1, createdAt: now, updatedAt: now, syncVersion: 1, data: emptyUserData() };
  // etagDoesNotMatch:'*' = "없을 때만 만들어라". 두 기기가 같은 코드로 동시에
  // 가입을 눌러도 한쪽만 성공하고, 진 쪽은 이미 있는 계정을 그대로 쓰면 된다.
  var written = await env.FAVORITES_BUCKET.put(
    key, JSON.stringify(record),
    Object.assign({ onlyIf: { etagDoesNotMatch: '*' } }, userStorePutOptions(record))
  );
  if (!written) return jsonResponse({ ok: true, existed: true, syncVersion: 1 });

  return jsonResponse({ ok: true, createdAt: now, syncVersion: 1 }, 201);
}

// 구버전 개인 코드 사용자를 위한 1회성 통합. 예전엔 "공개한 북마크"만 서버에
// 있었으므로, owners 인덱스에 걸린 공개 북마크들을 새 계정 스토어의 북마크로
// 옮겨 담는다. 이 기기의 로컬 북마크와 합치는 건 클라이언트가 이어서 한다.
async function migrateFromOwnerIndex(env, personalCode, userKey) {
  var indexObject = await env.FAVORITES_BUCKET.get(await ownerIndexKey(personalCode));
  if (!indexObject) return null;

  var indexData = await indexObject.json();
  var codes = (indexData && Array.isArray(indexData.codes))
    ? indexData.codes.filter(function (c) { return typeof c === 'string'; })
    : [];
  if (!codes.length) return null;

  var bookmarks = [];
  for (var i = 0; i < codes.length && bookmarks.length < USER_MAX_BOOKMARKS; i++) {
    var libObject = await env.FAVORITES_BUCKET.get('library/' + codes[i] + '.json');
    if (!libObject) continue;
    var rec = await libObject.json();
    var stamp = rec.createdAt || Date.now();
    // 되찾기(restorePublishedToLocal)로 이미 로컬에 복원해 둔 사용자가 있으므로,
    // 클라이언트가 code 로 짝을 찾아 중복 폴더를 합칠 수 있도록 id 에 code 를 심는다.
    bookmarks.push({
      id: 'lib_' + codes[i],
      name: rec.name || '',
      createdAt: stamp,
      updatedAt: rec.updatedAt || stamp,
      items: (rec.items || []).map(function (it) {
        return { type: it.type, id: it.id, addedAt: stamp };
      }),
      removedItems: [],
      // 이 항목은 정의상 이미 공개돼 있던 것(owners 인덱스에 걸려 있었음) —
      // 안 채우면 마이그레이션 직후 다른 기기에서 또 공개할 수 있게 된다.
      publishedCode: codes[i],
      publishedCodeUpdatedAt: stamp
    });
  }
  if (!bookmarks.length) return null;

  var now = Date.now();
  var record = {
    v: 1, createdAt: now, updatedAt: now, syncVersion: 1,
    data: { version: USER_DATA_VERSION, bookmarks: bookmarks, deletedBookmarks: [] }
  };
  var written = await env.FAVORITES_BUCKET.put(
    userKey, JSON.stringify(record),
    Object.assign({ onlyIf: { etagDoesNotMatch: '*' } }, userStorePutOptions(record))
  );
  if (!written) {
    // 다른 기기가 한발 먼저 마이그레이션을 끝냈다 — 그쪽 결과를 쓴다
    var raced = await env.FAVORITES_BUCKET.get(userKey);
    if (raced) return raced.json();
  }
  return record;
}

async function handleUserGet(request, env) {
  var parsed = await readUserBody(request, env, 'user-auth', RATE_LIMIT_USER_AUTH_PER_HOUR);
  if (parsed.error) return parsed.error;

  var key = await userStoreKey(parsed.personalCode);
  var object = await env.FAVORITES_BUCKET.get(key);
  if (object) return jsonResponse({ userStore: await object.json() });

  var migrated = await migrateFromOwnerIndex(env, parsed.personalCode, key);
  if (migrated) return jsonResponse({ userStore: migrated, migrated: true });

  return jsonResponse({ error: 'account not found' }, 404);
}

async function handleUserHead(request, env) {
  var parsed = await readUserBody(request, env, null, 0);
  if (parsed.error) return parsed.error;

  var head = await env.FAVORITES_BUCKET.head(await userStoreKey(parsed.personalCode));
  if (!head) return jsonResponse({ error: 'account not found' }, 404);

  var meta = head.customMetadata || {};
  return jsonResponse({
    syncVersion: parseInt(meta.syncVersion || '0', 10) || 0,
    updatedAt: parseInt(meta.updatedAt || '0', 10) || 0
  });
}

// 병합은 서버가 하지 않는다. 클라이언트가 이미 mergeStores 를 갖고 있는데
// 서버에 같은 로직을 하나 더 두면 두 구현이 조용히 어긋날 수 있어서다.
// 서버는 syncVersion 비교 + etag CAS 로 "덮어써도 되는가"만 판정하고,
// 뒤처진 요청에는 409와 함께 서버 사본을 돌려줘 클라이언트가 병합하게 한다.
async function handleUserSync(request, env) {
  var parsed = await readUserBody(request, env, 'user-sync', RATE_LIMIT_USER_SYNC_PER_HOUR);
  if (parsed.error) return parsed.error;

  var raw = parsed.raw;
  var data = cleanUserData(raw && raw.data);
  if (data === null) return jsonResponse({ error: 'invalid payload shape' }, 400);
  var clientSyncVersion = raw.clientSyncVersion;
  if (typeof clientSyncVersion !== 'number' || !Number.isInteger(clientSyncVersion) || clientSyncVersion < 0) {
    return jsonResponse({ error: 'invalid payload shape' }, 400);
  }

  var key = await userStoreKey(parsed.personalCode);
  for (var attempt = 0; attempt < USER_SYNC_MAX_ATTEMPTS; attempt++) {
    var object = await env.FAVORITES_BUCKET.get(key);
    if (!object) return jsonResponse({ error: 'account not found' }, 404);

    var etag = object.etag;
    var current = await object.json();
    if (clientSyncVersion !== current.syncVersion) {
      return jsonResponse({ error: 'sync version conflict', serverStore: current }, 409);
    }

    var now = Date.now();
    var next = {
      v: 1,
      createdAt: current.createdAt || now,
      updatedAt: now,
      syncVersion: current.syncVersion + 1,
      data: data
    };
    var written = await env.FAVORITES_BUCKET.put(
      key, JSON.stringify(next),
      Object.assign({ onlyIf: { etagMatches: etag } }, userStorePutOptions(next))
    );
    if (written) {
      return jsonResponse({ ok: true, serverSyncVersion: next.syncVersion, updatedAt: now });
    }
    // etag 가 어긋났다 = 방금 사이에 누가 썼다. 다시 읽어서 판정한다.
  }

  var latest = await env.FAVORITES_BUCKET.get(key);
  return jsonResponse({
    error: 'sync version conflict',
    serverStore: latest ? await latest.json() : null
  }, 409);
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
    if (url.pathname === '/owner/lookup' && request.method === 'POST') {
      return handleOwnerLookup(request, env);
    }
    // 개인 코드가 URL/서버 로그에 남지 않도록 조회도 POST 로 받는다
    // (/owner/lookup 이 POST 인 것과 같은 이유).
    if (url.pathname === '/user/signup' && request.method === 'POST') {
      return handleUserSignup(request, env);
    }
    if (url.pathname === '/user/get' && request.method === 'POST') {
      return handleUserGet(request, env);
    }
    if (url.pathname === '/user/head' && request.method === 'POST') {
      return handleUserHead(request, env);
    }
    if (url.pathname === '/user/sync' && request.method === 'PUT') {
      return handleUserSync(request, env);
    }
    if (url.pathname.indexOf('/library/') === 0) {
      var libRest = url.pathname.slice('/library/'.length);
      var claimSuffix = '/claim-owner';
      if (request.method === 'POST' && libRest.length > claimSuffix.length &&
          libRest.slice(-claimSuffix.length) === claimSuffix) {
        var claimCode = libRest.slice(0, libRest.length - claimSuffix.length);
        return handleLibraryClaimOwner(claimCode, request, env);
      }
      if (request.method === 'GET') return handleLibraryGet(libRest, env);
      if (request.method === 'PUT') return handleLibraryUpdate(libRest, request, env);
      if (request.method === 'DELETE') return handleLibraryDelete(libRest, request, env);
    }

    return jsonResponse({ error: 'not found' }, 404);
  }
};
