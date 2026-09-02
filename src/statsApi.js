/**
 * statsApi — 방문자 통계용 API. src/_worker.js가 아래 경로를 이 모듈로 넘긴다.
 *
 *   POST /api/presence/beat        (공개)  브라우저 하트비트 -> { online }
 *   POST /api/presence/leave       (공개)  명시적 이탈 신호  -> { online }
 *   GET  /api/presence/stats       (관리자) 현재/피크 동시 접속자
 *   GET  /api/stats/visitors       (관리자) 일별 순 방문자·페이지뷰 시계열
 *   GET  /api/stats/summary        (관리자) 위 둘을 한 번에 묶은 요약
 *
 * 관리자 게이트:
 * - 이 프로젝트에는 로그인/세션 개념이 없다(개인 코드는 북마크 신원일 뿐
 *   관리자 인증이 아니다). 그래서 통계 조회는 Worker 시크릿
 *   STATS_ADMIN_TOKEN 하나로만 막는다 — 통계 페이지가 이 토큰을 한 번 받아
 *   localStorage에 넣어두고 Authorization: Bearer 로 보낸다.
 * - STATS_ADMIN_TOKEN이 설정돼 있지 않으면 관리자 경로는 503으로 답한다
 *   (실수로 무방비 공개되는 것보다 안전한 기본값).
 *
 * 순 방문자 집계(Analytics Engine):
 * - _worker.js가 문서 요청마다 writeDataPoint를 남긴다. 인덱스는 "그날의
 *   방문자 해시"라서, 같은 사람은 하루에 한 번만 고유값으로 잡히고 날짜가
 *   바뀌면 해시도 바뀐다(개인 식별이 남지 않게 하는 장치이자, 우리가 원하는
 *   "일별 순 방문자"와 정확히 맞는 단위).
 * - 조회는 Analytics Engine SQL API(HTTP)로 한다. 계정 ID는 vars,
 *   조회용 토큰은 시크릿 CF_ANALYTICS_TOKEN(Account Analytics: Read 권한).
 * - SQL 결과는 RATE_LIMIT_KV에 5분 캐시한다 — 통계 페이지를 열 때마다
 *   원본을 때리지 않도록.
 */

var AE_DATASET = 'cpkg_visits';
var VISITORS_CACHE_TTL = 300;
var DEFAULT_DAYS = 30;
var MAX_DAYS = 90; // Analytics Engine 무료 보존 기간 안쪽

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

// 길이가 다르면 즉시 실패하되, 같으면 전체를 비교해 조기 반환 타이밍으로
// 토큰 길이를 넘겨짚지 못하게 한다.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function requireAdmin(request, env) {
  if (!env.STATS_ADMIN_TOKEN) {
    return json({ error: 'stats admin token not configured' }, 503);
  }
  var header = request.headers.get('Authorization') || '';
  var token = header.indexOf('Bearer ') === 0 ? header.slice(7) : '';
  if (!safeEqual(token, env.STATS_ADMIN_TOKEN)) {
    return json({ error: 'unauthorized' }, 401);
  }
  return null; // 통과
}

function presenceStub(env) {
  // 계정 전체에서 인스턴스 하나만 쓴다 — 이름을 고정한다.
  var id = env.PRESENCE.idFromName('global');
  return env.PRESENCE.get(id);
}

async function handlePresenceBeat(request, env) {
  var stub = presenceStub(env);
  var res = await stub.fetch('https://do/beat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: await request.text()
  });
  return new Response(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

async function handlePresenceLeave(request, env) {
  var stub = presenceStub(env);
  var res = await stub.fetch('https://do/leave', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: await request.text()
  });
  return new Response(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

async function handlePresenceStats(request, env) {
  var denied = requireAdmin(request, env);
  if (denied) return denied;
  var stub = presenceStub(env);
  var res = await stub.fetch('https://do/stats', { method: 'GET' });
  return new Response(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

// Analytics Engine SQL API 호출. 실패 시 { error } 를 담은 객체를 던지지 않고
// 반환하므로 호출자가 상태 코드를 정한다.
async function runAeSql(env, sql) {
  if (!env.CF_ACCOUNT_ID || !env.CF_ANALYTICS_TOKEN) {
    return { ok: false, status: 503, error: 'analytics engine query not configured' };
  }
  var endpoint = 'https://api.cloudflare.com/client/v4/accounts/' +
    env.CF_ACCOUNT_ID + '/analytics_engine/sql';
  var res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.CF_ANALYTICS_TOKEN,
        'Content-Type': 'text/plain'
      },
      body: sql
    });
  } catch (e) {
    return { ok: false, status: 502, error: 'analytics engine unreachable' };
  }
  var text = await res.text();
  if (!res.ok) {
    return { ok: false, status: 502, error: 'analytics engine error', detail: text.slice(0, 500) };
  }
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch (e) {
    return { ok: false, status: 502, error: 'analytics engine returned non-json' };
  }
}

// 한국 시간 기준 일자별로 묶은 순 방문자(고유 인덱스 수)와 페이지뷰
// (표본 보정 합계). formatDateTime의 세 번째 인자로 타임존을 넘기면 서울
// 기준 벽시계 날짜 문자열이 나오므로, 그 문자열로 그룹핑하면 KST 자정에서
// 날이 갈린다. 인덱스가 "그날의 방문자 해시"라 COUNT(DISTINCT index1)이
// 곧 일별 순 방문자다(표본화도 인덱스 기준으로 균등하게 이뤄진다).
function visitorsSql(days) {
  return (
    "SELECT " +
    "formatDateTime(timestamp, '%Y-%m-%d', 'Asia/Seoul') AS day, " +
    "COUNT(DISTINCT index1) AS uniques, " +
    "SUM(_sample_interval) AS pageviews " +
    "FROM " + AE_DATASET + " " +
    "WHERE timestamp >= NOW() - INTERVAL '" + days + "' DAY " +
    "GROUP BY day ORDER BY day ASC " +
    "FORMAT JSON"
  );
}

function parseDays(url) {
  var raw = parseInt(url.searchParams.get('days'), 10);
  if (!raw || raw < 1) return DEFAULT_DAYS;
  if (raw > MAX_DAYS) return MAX_DAYS;
  return raw;
}

async function handleVisitors(request, env, url) {
  var denied = requireAdmin(request, env);
  if (denied) return denied;

  var days = parseDays(url);
  var cacheKey = 'stats:visitors:' + days;

  if (env.RATE_LIMIT_KV) {
    try {
      var cached = await env.RATE_LIMIT_KV.get(cacheKey);
      if (cached) {
        return new Response(cached, {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Cache': 'hit' }
        });
      }
    } catch (e) {}
  }

  var result = await runAeSql(env, visitorsSql(days));
  if (!result.ok) return json({ error: result.error, detail: result.detail || null }, result.status);

  var rows = (result.data && Array.isArray(result.data.data)) ? result.data.data : [];
  var payload = JSON.stringify({
    days: days,
    rows: rows.map(function (r) {
      return {
        day: r.day,
        uniques: Number(r.uniques) || 0,
        pageviews: Math.round(Number(r.pageviews) || 0)
      };
    }),
    generatedAt: Date.now()
  });

  if (env.RATE_LIMIT_KV) {
    try {
      await env.RATE_LIMIT_KV.put(cacheKey, payload, { expirationTtl: VISITORS_CACHE_TTL });
    } catch (e) {}
  }
  return new Response(payload, {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Cache': 'miss' }
  });
}

// 페이지 상단 타일용 요약: 현재/피크 동시 접속자 + 최근 구간 순 방문자 합계.
async function handleSummary(request, env) {
  var denied = requireAdmin(request, env);
  if (denied) return denied;

  var presence = null;
  try {
    var pRes = await presenceStub(env).fetch('https://do/stats', { method: 'GET' });
    presence = await pRes.json();
  } catch (e) {
    presence = { error: 'presence unavailable' };
  }

  // 최근 30일 시계열을 한 번만 뽑아서 오늘/7일/30일 합계를 여기서 계산한다
  // (같은 데이터를 세 번 조회하지 않도록). visitors 캐시를 그대로 재사용한다.
  var visitors = null;
  try {
    var vReq = new Request('https://internal/api/stats/visitors?days=30', {
      headers: { 'Authorization': request.headers.get('Authorization') || '' }
    });
    var vRes = await handleVisitors(vReq, env, new URL(vReq.url));
    visitors = await vRes.json();
  } catch (e) {
    visitors = { rows: [] };
  }

  var rows = (visitors && Array.isArray(visitors.rows)) ? visitors.rows : [];
  var sumOverLast = function (n) {
    return rows.slice(-n).reduce(function (a, r) { return a + (r.uniques || 0); }, 0);
  };
  var todayRow = rows.length ? rows[rows.length - 1] : null;

  return json({
    presence: presence,
    visitors: {
      today: todayRow ? todayRow.uniques : 0,
      last7d: sumOverLast(7),
      last30d: sumOverLast(30),
      todayPageviews: todayRow ? todayRow.pageviews : 0,
      series: rows
    },
    generatedAt: Date.now()
  });
}

export default {
  async fetch(request, env, ctx) {
    var url = new URL(request.url);
    var p = url.pathname;

    if (p === '/api/presence/beat' && request.method === 'POST') {
      return handlePresenceBeat(request, env);
    }
    if (p === '/api/presence/leave' && request.method === 'POST') {
      return handlePresenceLeave(request, env);
    }
    if (p === '/api/presence/stats' && request.method === 'GET') {
      return handlePresenceStats(request, env);
    }
    if (p === '/api/stats/visitors' && request.method === 'GET') {
      return handleVisitors(request, env, url);
    }
    if (p === '/api/stats/summary' && request.method === 'GET') {
      return handleSummary(request, env);
    }
    return json({ error: 'not found' }, 404);
  }
};
