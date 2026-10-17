// 프로필 활동 통계(본 문학·저장·투표·끌올). 레벨 계산에 쓰는 숫자를 기록하고 읽는다.
// 기록(recordView·recordSaves)은 하루 한도 안에서만 늘고, 한 번 들어간 행은 되돌리지 않는다.
// 호출자는 기록이 실패해도(표 없음·D1 오류) 원래 요청을 그대로 끝내야 한다.
// 설계: docs/superpowers/specs/2026-10-17-profile-stats-level-design.md
export const STATS_DAILY_LIMIT = 200;

var DAY_MS = 86400000;
var KST_OFFSET_MS = 9 * 3600000;
// favoritesShareWorker.js 의 LIBRARY_ITEM_TYPES 와 같다.
var ITEM_TYPES = ['novel', 'translation', 'series', 'hof', 'official'];

async function sha256Hex(str) {
  var digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  var bytes = new Uint8Array(digest);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

// now 가 속한 KST 하루의 시작 시각(ms).
export function kstDayStart(now) {
  return Math.floor((now + KST_OFFSET_MS) / DAY_MS) * DAY_MS - KST_OFFSET_MS;
}

// 작품 키 '<type>:<id>'. 형식(타입·0 이상 정수)만 검사하고, 틀리면 null.
export function itemKey(type, id) {
  if (ITEM_TYPES.indexOf(type) === -1) return null;
  if (typeof id !== 'number' || !Number.isInteger(id) || id < 0) return null;
  return type + ':' + id;
}

// 개인 코드의 프로필 ID. 프로필이 없으면 null. D1 오류는 그대로 throw 한다.
export async function profileIdForCode(env, personalCode) {
  var row = await env.TAGS_DB.prepare('SELECT profile_id FROM profiles WHERE owner_hash = ?')
    .bind(await sha256Hex('profile:' + personalCode)).first();
  return row ? row.profile_id : null;
}

// 본 작품 한 개를 기록한다. 새로 들어갔으면 true, 이미 있거나 오늘 한도를 넘었으면 false.
export async function recordView(env, profileId, key, now) {
  var result = await env.TAGS_DB.prepare(
    "INSERT OR IGNORE INTO profile_activity (profile_id, kind, item_key, at) " +
    "SELECT ?1, 'view', ?2, ?3 WHERE (SELECT COUNT(*) FROM profile_activity " +
    "WHERE profile_id = ?1 AND kind = 'view' AND at >= ?4) < ?5"
  ).bind(profileId, key, now, kstDayStart(now), STATS_DAILY_LIMIT).run();
  return result.meta.changes > 0;
}

// 이 작품이 이미 본 문학으로 기록돼 있는지(기본 키 조회 1번). recordView 가 false 일 때
// '이미 셌다'와 '오늘 한도에 걸렸다'를 가르는 데 쓴다.
export async function viewRecorded(env, profileId, key) {
  var row = await env.TAGS_DB.prepare(
    "SELECT 1 AS ok FROM profile_activity WHERE profile_id = ? AND kind = 'view' AND item_key = ?"
  ).bind(profileId, key).first();
  return !!row;
}

// 저장한 작품들을 한 번에 기록하고 새로 들어간 수를 돌려준다.
// 이미 있는 키는 한도에 세지 않으며, 오늘 남은 한도만큼만 들어간다(나머지는 다음 날 동기화에서 이어진다).
export async function recordSaves(env, profileId, keys, now) {
  var unique = Array.from(new Set(keys));
  if (!unique.length) return 0;
  var result = await env.TAGS_DB.prepare(
    "INSERT OR IGNORE INTO profile_activity (profile_id, kind, item_key, at) " +
    "SELECT ?1, 'save', j.value, ?2 FROM json_each(?3) j " +
    "WHERE NOT EXISTS (SELECT 1 FROM profile_activity a " +
    "WHERE a.profile_id = ?1 AND a.kind = 'save' AND a.item_key = j.value) " +
    "LIMIT max(0, ?5 - (SELECT COUNT(*) FROM profile_activity " +
    "WHERE profile_id = ?1 AND kind = 'save' AND at >= ?4))"
  ).bind(profileId, now, JSON.stringify(unique), kstDayStart(now), STATS_DAILY_LIMIT).run();
  return result.meta.changes;
}

// keys 중 아직 저장으로 기록되지 않은 키만 돌려준다(쿼리 1개). 동기화가 무거운 Lookup.json 을
// 읽기 전에 걸러, 새로 담은 작품이 없으면 Lookup 을 아예 읽지 않게 한다.
export async function unsavedKeys(env, profileId, keys) {
  var unique = Array.from(new Set(keys));
  if (!unique.length) return [];
  var result = await env.TAGS_DB.prepare(
    "SELECT j.value AS item_key FROM json_each(?1) j WHERE NOT EXISTS (SELECT 1 FROM profile_activity a " +
    "WHERE a.profile_id = ?2 AND a.kind = 'save' AND a.item_key = j.value)"
  ).bind(JSON.stringify(unique), profileId).all();
  return (result.results || []).map(function (r) { return r.item_key; });
}

// 끌올 신청을 기록한다. 프로필이 없는 계정이면 아무것도 하지 않는다.
export async function recordBump(env, personalCode, bumpId, now) {
  var profileId = await profileIdForCode(env, personalCode);
  if (!profileId) return;
  await env.TAGS_DB.prepare(
    "INSERT OR IGNORE INTO profile_activity (profile_id, kind, item_key, at) VALUES (?, 'bump', ?, ?)"
  ).bind(profileId, String(bumpId), now).run();
}

// 프로필 하나의 숫자 네 개를 쿼리 1개로 읽는다.
// 투표는 tag_votes 에서 연결 시각(linked_at) 이후의 서로 다른 게시물을 센다 — 연결 행이 없으면 0 이다.
export async function readStats(env, profileId) {
  var row = await env.TAGS_DB.prepare(
    "SELECT " +
    "(SELECT COUNT(*) FROM profile_activity WHERE profile_id = ?1 AND kind = 'view') AS viewed, " +
    "(SELECT COUNT(*) FROM profile_activity WHERE profile_id = ?1 AND kind = 'save') AS saved, " +
    "(SELECT COUNT(DISTINCT post_id) FROM tag_votes " +
    "WHERE voter_hash = (SELECT vote_hash FROM profile_links WHERE profile_id = ?1) " +
    "AND created_at >= (SELECT linked_at FROM profile_links WHERE profile_id = ?1)) AS voted, " +
    "(SELECT COUNT(*) FROM profile_activity WHERE profile_id = ?1 AND kind = 'bump') AS bumped"
  ).bind(profileId).first();
  return {
    viewed: row ? row.viewed : 0,
    saved: row ? row.saved : 0,
    voted: row ? row.voted : 0,
    bumped: row ? row.bumped : 0
  };
}

// 삭제 경로가 쓰는 문장들(runUnlessNoTable 로 기존 batch 앞에 실행한다).
export function deleteActivityStatement(env, profileId) {
  return env.TAGS_DB.prepare('DELETE FROM profile_activity WHERE profile_id = ?').bind(profileId);
}

// 관리자가 끌올을 취소·삭제할 때 쓴다.
export function deleteBumpStatement(env, bumpId) {
  return env.TAGS_DB.prepare("DELETE FROM profile_activity WHERE kind = 'bump' AND item_key = ?").bind(String(bumpId));
}

// 위 삭제 문장을 기존 batch 앞에 따로 실행한다. stats_schema.sql 을 아직 적용하지 않아
// 표가 없으면 무시하고(삭제·취소가 깨지지 않게), 그 밖의 D1 오류는 throw 한다 — 이때는
// 아직 아무것도 지우지 않았으므로 다시 시도하면 끝까지 지울 수 있다.
// accountDelete.js 의 deleteLoginId 와 같은 방식이다.
export async function runUnlessNoTable(statement) {
  try {
    await statement.run();
  } catch (e) {
    if (String(e && e.message || '').indexOf('no such table') === -1) throw e;
  }
}

// ---- HTTP 핸들러 ----
export const STATS_PATHS = ['/profile/view', '/profile/stats'];

var BODY_MAX_BYTES = 512;
var PROFILE_ID_RE = /^[A-Za-z0-9_-]{12}$/;
var PUBLIC_CACHE = 'public, max-age=60';

// 상세 창을 연 작품 하나를 본 문학으로 기록한다. 프로필이 없으면 아무것도 하지 않고 counted:false 로 답한다.
// 프로필을 먼저 찾아, 프로필이 없는 호출은 무거운 Lookup.json 을 읽지 않고 바로 끝낸다.
// 오늘 한도에 걸려 못 셌으면 capped:true 를 붙인다(클라이언트가 다음 날 다시 보내도록).
// 레이트리밋은 태그 투표와 같은 바인딩이지만 키를 'view:' 로 나눠, 빠르게 둘러봐도 투표가 막히지 않게 한다.
async function handleView(request, env, tools) {
  if (!(await tools.checkLimit(env.RL_TAG_WRITE, 'view:' + tools.clientIp(request)))) {
    return tools.jsonResponse(request, { error: 'too many requests, try again later' }, 429);
  }
  var body = await tools.readJsonBody(request, BODY_MAX_BYTES);
  if (body.error) return body.error;
  var raw = body.value && typeof body.value === 'object' ? body.value : {};
  var personalCode = tools.cleanPersonalCode(raw.personalCode);
  var key = itemKey(raw.type, raw.id);
  if (personalCode === null || key === null) {
    return tools.jsonResponse(request, { error: 'invalid payload shape' }, 400);
  }
  var profileId = await profileIdForCode(env, personalCode);
  if (!profileId) return tools.jsonResponse(request, { ok: true, counted: false });
  if (!(await tools.itemExists(request, env, raw.type, raw.id))) {
    return tools.jsonResponse(request, { error: 'unknown post' }, 400);
  }
  if (await recordView(env, profileId, key, Date.now())) {
    return tools.jsonResponse(request, { ok: true, counted: true });
  }
  if (await viewRecorded(env, profileId, key)) return tools.jsonResponse(request, { ok: true, counted: false });
  return tools.jsonResponse(request, { ok: true, counted: false, capped: true });
}

// Workers 엣지 캐시(caches.default). 테스트처럼 caches 가 없는 환경이면 null.
function edgeCache() {
  return typeof caches !== 'undefined' && caches && caches.default ? caches.default : null;
}

// 공개 프로필의 숫자 네 개. 로그인 없이 누구나 볼 수 있어 60초 공용 캐시를 건다.
// 브라우저 캐시만으로는 여러 방문자의 D1 조회를 막지 못하므로, 200 응답은 엣지 캐시에도
// 60초 담아 두고 그 안의 요청은 D1 을 거치지 않는다. 캐시 키는 id 만 남긴 URL 이다
// (다른 쿼리를 붙여 캐시를 비켜 가지 못하게). 꺼낼 때는 이번 요청 기준 CORS 헤더로 다시 만든다.
async function handleStats(request, env, tools, url, ctx) {
  if (!(await tools.checkLimit(env.RL_LIB_LIST, tools.clientIp(request)))) {
    return tools.jsonResponse(request, { error: 'too many requests, try again later' }, 429);
  }
  var id = url.searchParams.get('id') || '';
  if (!PROFILE_ID_RE.test(id)) return tools.jsonResponse(request, { error: 'invalid payload shape' }, 400);
  var cache = edgeCache();
  var cacheKey = new Request(url.origin + url.pathname + '?id=' + id, { method: 'GET' });
  var stats = null;
  if (cache) {
    try {
      var hit = await cache.match(cacheKey);
      if (hit) stats = await hit.json();
    } catch (e) {
      stats = null; // 캐시가 실패하면 D1 에서 읽는다
    }
  }
  if (!stats) {
    var exists = await env.TAGS_DB.prepare('SELECT 1 AS ok FROM profiles WHERE profile_id = ?').bind(id).first();
    if (!exists) return tools.jsonResponse(request, { error: 'profile not found' }, 404);
    stats = await readStats(env, id);
    if (cache) {
      var stored = cache.put(cacheKey, new Response(JSON.stringify(stats), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': PUBLIC_CACHE }
      }));
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(stored.catch(function () {}));
      else await stored.catch(function () {});
    }
  }
  var res = tools.jsonResponse(request, stats);
  res.headers.set('Cache-Control', PUBLIC_CACHE);
  return res;
}

export async function handleStatsRequest(request, env, tools, ctx) {
  var url = new URL(request.url);
  try {
    if (url.pathname === '/profile/view' && request.method === 'POST') return await handleView(request, env, tools);
    if (url.pathname === '/profile/stats' && request.method === 'GET') return await handleStats(request, env, tools, url, ctx);
    return tools.jsonResponse(request, { error: 'not found' }, 404);
  } catch (e) {
    console.error('stats unavailable', e && e.message);
    return tools.jsonResponse(request, { error: 'stats unavailable' }, 503);
  }
}
