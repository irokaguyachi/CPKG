/**
 * cpkg Worker 진입점 — 정적 사이트(assets)와 백엔드 API
 * (../worker/favoritesShareWorker.js)를 하나의 Worker로 합친다.
 * - Cloudflare의 cpkg 프로젝트는 GitHub(main 브랜치) 연동으로 Root
 *   directory=/src, Deploy command=`npx wrangler deploy` 로 자동 배포된다.
 *   이 wrangler.toml(같은 폴더)의 main이 가리키는 파일이 바로 이 파일이라,
 *   이게 그 배포의 실제 진입점이다.
 * - API 경로(/library, /owner/lookup, /user/*)만 favoritesShareWorker.js로
 *   넘기고, 그 외 모든 요청은 정적 자산(ASSETS 바인딩)으로 넘긴다.
 * - 원래 이 API는 chokaguya-favorites-share라는 별도 Worker였다(다른
 *   workers.dev 서브도메인에 떠 있어서 프론트엔드가 매번 교차 출처로 호출해야
 *   했다). 여기 합친 뒤로는 같은 오리진에서 호출하므로 CORS 프리플라이트 자체가
 *   필요 없다 — bookmarkLibrary.js/userData.js의 WORKER_BASE를 상대 경로로
 *   바꾼 이유이기도 하다.
 * - favoritesShareWorker.js 자체는 그대로 두고 여기서 import만 한다: 로직을
 *   복사하면 두 파일이 따로 놀다 조용히 어긋나기 쉽다.
 * - 짧은 주소(/main, /novel, ...)는 실제 파일(/page/mainPage.html 등)의
 *   내용을 리다이렉트 없이 그대로 돌려준다 — 주소창엔 짧은 주소가 그대로
 *   남는다. wrangler.toml의 html_handling="none"이 꺼져 있는 이유(.html
 *   URL을 확장자 없는 주소로 307 리다이렉트해버리는 기본 동작)와 같은
 *   문제라, 여기서도 리다이렉트가 아니라 내용을 직접 매칭해서 돌려준다.
 *   예전 /page/*.html 링크는 이 짧은 주소로 308 영구 이전한다(공유된
 *   링크가 안 죽게).
 * - ckpg.cloud -> cpkg.cloud 도메인 이전 중. 예전 도메인으로 들어오는
 *   요청은(API 포함) 전부 새 도메인의 같은 경로로 301 리다이렉트한다 —
 *   ckpg.cloud도 Custom Domain으로 이 Worker에 계속 붙어 있어야
 *   리다이렉트 자체가 나간다(wrangler.toml에는 새 도메인 cpkg.cloud
 *   라우트만 추가했다 — ckpg.cloud는 이미 대시보드에 연결돼 있어서
 *   그대로 둔다). 이전이 끝나 옛 링크가 더는 안 도는 시점이 오면 이
 *   블록과 OLD_DOMAIN을 지우면 된다.
 */
import backend from '../worker/favoritesShareWorker.js';
import statsApi from '../worker/statsApi.js';
import adminApi, { serveAdminGate } from '../worker/adminApi.js';
import { refreshLibraryIndex } from '../worker/libraryIndex.js';
import { PresenceDO } from '../worker/presenceDO.js';
import { readJsonLimited } from '../worker/requestBody.js';
import { recordTagSnapshot } from '../worker/tagSnapshot.js';
import * as humanCheck from '../worker/humanCheck.js';

// 방문자 통계용 Durable Object 클래스. wrangler가 배포 시 이 export를 보고
// [[durable_objects.bindings]] / [[migrations]] 와 연결한다.
export { PresenceDO };

var OLD_DOMAIN = 'ckpg.cloud';
var NEW_DOMAIN = 'cpkg.cloud';

var API_EXACT_PATHS = ['/library', '/owner/lookup', '/user/signup', '/user/get', '/user/head', '/user/sync', '/pancake', '/pancake/add', '/tags/get', '/tags/vote', '/tags/snapshot', '/bump/get', '/bump/request', '/game/ranking', '/game/start', '/game/end', '/game/submit'];

function isApiPath(pathname) {
  if (API_EXACT_PATHS.indexOf(pathname) !== -1) return true;
  return pathname.indexOf('/library/') === 0;
}

// 방문자 통계 API(하트비트 + 관리자 조회). favoritesShareWorker와 달리
// 별도 모듈로 두는 이유는 북마크 API와 책임이 완전히 다르고, R2/KV가 아니라
// Durable Object와 Analytics Engine을 쓰기 때문이다.
function isStatsPath(pathname) {
  return pathname.indexOf('/api/presence/') === 0 || pathname.indexOf('/api/stats/') === 0;
}

async function sha256Hex(str) {
  var digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  var bytes = new Uint8Array(digest);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

function deviceTypeFromUA(ua) {
  var s = (ua || '').toLowerCase();
  if (/ipad|tablet|kindle|playbook|silk/.test(s)) return 'tablet';
  if (/mobi|iphone|android.*mobile|windows phone/.test(s)) return 'mobile';
  if (/android/.test(s)) return 'tablet';
  return 'desktop';
}

// Analytics Engine에 방문 기록 한 줄을 남긴다. 인덱스는 "그날의 방문자 해시"라,
// 같은 사람은 하루에 한 번만 고유값으로 잡히고 날짜가 바뀌면 값도 바뀐다
// (개인 식별을 남기지 않으면서 "일별 순 방문자"를 얻는 방법). 통계는 어디까지나
// 부가 기능이라, 여기서 무슨 일이 생겨도 응답에는 영향을 주지 않는다.
// 문서 요청이 아니라 브라우저 비콘(/api/pageview)에서 부르므로, 경로와
// 유입 호스트는 비콘 본문에서 받는다(IP·UA·국가는 비콘 요청 자체의 값).
async function recordPageView(request, env, pathname, refHost) {
  try {
    if (!env.VISITS_AE) return;
    var ua = request.headers.get('User-Agent') || '';
    var ip = request.headers.get('CF-Connecting-IP') || '';
    var cf = request.cf || {};
    var daySalt = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    var visitorId = (await sha256Hex(daySalt + '|' + ip + '|' + ua)).slice(0, 32);
    env.VISITS_AE.writeDataPoint({
      indexes: [visitorId],
      blobs: [
        String(cf.country || 'XX'),
        deviceTypeFromUA(ua),
        pathname.slice(0, 96),
        refHost.slice(0, 96)
      ],
      doubles: [1]
    });
  } catch (e) {
    // 기록 실패는 삼킨다 — 통계보다 페이지가 우선이다.
  }
}

// 방문으로 셀 수 있는 경로. 실제로 존재하는 페이지만 센다 — 예전엔 Accept
// 헤더만 보고 세서 /TikTok/TikTok.html 같은 스캐너 경로(404)까지 방문으로
// 잡혔다. 관리자 통계 페이지(/stats)는 수치를 보는 행위가 수치를 흔들면
// 안 되므로 뺀다. 오디오 노벨 리더는 짧은 주소 없이 파일 경로로 열린다.
function isCountedPath(pathname) {
  if (pathname === '/' || pathname === '/page/audioNovelReaderPage.html') return true;
  var slug = pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  return slug !== 'stats' && Object.prototype.hasOwnProperty.call(PAGE_SLUGS, slug);
}

function jsonResponse(body, status, extraHeaders) {
  var headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  for (var k in extraHeaders || {}) headers[k] = extraHeaders[k];
  return new Response(JSON.stringify(body), { status: status || 200, headers: headers });
}

// POST /api/pageview { path, ref, token? } — src/js/core/pageView.js가
// 페이지를 열 때마다 한 번 보낸다. Turnstile을 통과한 적이 있는 브라우저
// (cpkg_hv 쿠키)면 바로 기록하고, 아니면 { need: 'turnstile', sitekey }로
// 답해 브라우저가 로딩 화면에서 검증을 받아 token과 함께 다시 보내게 한다.
async function handlePageViewBeacon(request, env, ctx, url) {
  var origin = request.headers.get('Origin');
  if ((origin && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    return jsonResponse({ error: 'forbidden origin' }, 403);
  }
  var parsed = await readJsonLimited(request, 4096);
  if (parsed.error) return jsonResponse({ error: parsed.error }, parsed.status);
  var body = parsed.value || {};
  var path = typeof body.path === 'string' ? body.path : '';
  if (!isCountedPath(path)) return jsonResponse({ ok: false, counted: false });
  var refHost = typeof body.ref === 'string' && /^[a-z0-9.-]{0,96}$/i.test(body.ref) ? body.ref : '';

  if (humanCheck.isConfigured(env) && !(await humanCheck.hasValidPass(request, env))) {
    if (body.token == null) {
      return jsonResponse({ need: 'turnstile', sitekey: env.TURNSTILE_SITEKEY });
    }
    if (!(await humanCheck.verifyToken(body.token, request, env))) {
      return jsonResponse({ error: 'verification failed' }, 403);
    }
    ctx.waitUntil(recordPageView(request, env, path, refHost));
    return jsonResponse({ ok: true, counted: true }, 200, { 'Set-Cookie': await humanCheck.passCookie(env) });
  }

  ctx.waitUntil(recordPageView(request, env, path, refHost));
  return jsonResponse({ ok: true, counted: true });
}

// 1분 Cron이 부른다. Durable Object에서 현재 접속자 수와 피크를 읽어
// Analytics Engine(PRESENCE_AE)에 한 줄로 적재한다 → 커스텀 대시보드/Grafana가
// 이 데이터셋을 시계열로 그린다(동시 접속자 추이 = avg(double1) 또는
// max(double1), 피크 = 하루치 max(double2)). 접속자가 0이어도 한 줄을 남겨
// 그래프가 끊기지 않게 한다.
async function recordPresenceSample(env) {
  try {
    if (!env.PRESENCE_AE || !env.PRESENCE) return;
    var id = env.PRESENCE.idFromName('global');
    var res = await env.PRESENCE.get(id).fetch('https://do/stats', { method: 'GET' });
    var s = await res.json();
    env.PRESENCE_AE.writeDataPoint({
      // 인덱스는 표본화 그룹 키일 뿐이라 상수로 둔다(게이지는 카디널리티가 낮다).
      indexes: ['presence'],
      blobs: [String(s.peakDay || '')],
      doubles: [
        Number(s.online) || 0,
        Number(s.peakToday) || 0,
        Number(s.peakAllTime) || 0
      ]
    });
  } catch (e) {
    // Cron 한 번 걸러도 다음 분에 다시 찍힌다 — 조용히 넘어간다.
  }
}

// 5분마다 끌올(bump) 큐의 오래된 행을 걷어낸다. D1 용량이 무한정 쌓이지
// 않도록 하는 하우스키핑일 뿐이다. 다만 v0.5부터 끌올은 다음 신청이 올
// 때까지 끝나지 않으므로, end_at(교체 시각이 없으면 시작 + 1시간인 임시
// 값)이 오래됐더라도 지금 활성인 행(이미 시작한 행 중 가장 늦게 시작한
// 것)은 남긴다 — favoritesShareWorker.js의 BUMP_ACTIVE_ID_SQL과 같은 판정.
async function cleanupBumps(env) {
  try {
    if (!env.TAGS_DB) return;
    var now = Date.now();
    var cutoff = now - 7 * 86400000; // 7일 지난 기록만 정리
    await env.TAGS_DB.prepare(
      'DELETE FROM bumps WHERE end_at < ? AND id <> ' +
      'COALESCE((SELECT id FROM bumps WHERE start_at <= ? ORDER BY start_at DESC, id DESC LIMIT 1), -1)'
    ).bind(cutoff, now).run();
  } catch (e) {
    // 스키마 미적용 등 — 다음 5분 뒤에 다시 시도된다.
  }
  try {
    // 관리 페이지가 취소 표시한 행(worker/admin_schema.sql)도 원본 행이 정리되면 같이 지운다.
    await env.TAGS_DB.prepare('DELETE FROM bump_cancels WHERE bump_id NOT IN (SELECT id FROM bumps)').run();
  } catch (e) {
    // 관리 스키마 미적용 — 무시한다.
  }
}

// 5분마다 우주 미니게임 랭킹(worker/game_schema.sql)의 오래된 행을 걷어낸다.
// 등록된 판의 nonce(game_runs)는 시작한 지 4시간이 지나면 그 판의 토큰이
// 전부 만료되므로 하루 지난 것을, 주간 기록은 8주 지난 것을 지운다. 기간 키가 'wYYYY-MM-DD' 라 문자열 비교가
// 곧 날짜 비교다.
async function cleanupGameRanking(env) {
  try {
    if (!env.TAGS_DB) return;
    var now = Date.now();
    var oldWeek = 'w' + new Date(now - 8 * 7 * 86400000).toISOString().slice(0, 10);
    await env.TAGS_DB.batch([
      env.TAGS_DB.prepare('DELETE FROM game_runs WHERE started_at < ?').bind(now - 86400000),
      env.TAGS_DB.prepare("DELETE FROM game_scores WHERE period <> 'all' AND period < ?").bind(oldWeek)
    ]);
  } catch (e) {
    // 스키마 미적용 등 — 다음 5분 뒤에 다시 시도된다.
  }
}

// 짧은 주소 <-> 실제 파일(src/page/ 아래) 매핑. 사이드바 등 사이트 내부
// 링크는 전부 이 짧은 주소를 쓰도록 이미 바꿔뒀다(src/page/*.html,
// src/js/pages/bookmarksPage.js, changelogPage.js, mainPage.js, loading.js 참고) —
// 여기 슬러그를 바꾸면 그 파일들도 같이 바꿔야 한다.
var PAGE_SLUGS = {
  main: 'mainPage.html',
  novel: 'novelPage.html',
  series: 'seriesPage.html',
  hof: 'HOFPage.html',
  contest: 'contestPage.html',
  official: 'OfficialPage.html',
  bookmarks: 'bookmarksPage.html',
  notice: 'changelogPage.html',
  // 관리자용 방문자 통계 페이지. 화면 자체는 데이터가 없으면 아무것도 안
  // 보여주고, 실제 수치는 /api/stats/* 가 STATS_ADMIN_TOKEN 으로 막는다.
  stats: 'statsPage.html',
  // 관리 페이지. 화면은 껍데기뿐이고, 데이터는 /api/admin/* 가 관리자 계정 +
  // 비밀번호로 받은 세션으로만 내려준다(worker/adminApi.js).
  admin: 'adminPage.html'
};

var LEGACY_HTML_TO_SLUG = {};
for (var slug in PAGE_SLUGS) {
  LEGACY_HTML_TO_SLUG['/page/' + PAGE_SLUGS[slug]] = '/' + slug;
}

// 문학 페이지로 합쳐진 옛 번역 탭 주소. 번역 목록은 이제 /novel 안의 번역
// 탭(?tab=translation)이다. 공유된 옛 링크가 번역 탭으로 바로 열리도록
// 보내되, 나중에 번역 페이지를 다시 분리할 수도 있어 브라우저가 영구히
// 기억하는 301/308 대신 302 로 보낸다.
var MERGED_PAGE_REDIRECTS = {
  '/translation': '/novel?tab=translation',
  '/translation/': '/novel?tab=translation',
  '/page/translationPage.html': '/novel?tab=translation'
};

export default {
  // 1분 Cron(wrangler.toml [triggers]). 접속자 게이지를 Analytics Engine에 적재.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(recordPresenceSample(env));
    ctx.waitUntil(refreshLibraryIndex(env).catch(function (error) {
      console.error('library index refresh failed', error.message);
    }));
    // 태그 집계는 매분 할 필요가 없어 5의 배수 분에만 돌려 D1 읽기를 아낀다.
    if (new Date(event.scheduledTime).getUTCMinutes() % 5 === 0) {
      ctx.waitUntil(recordTagSnapshot(env));
      ctx.waitUntil(cleanupBumps(env));
      ctx.waitUntil(cleanupGameRanking(env));
    }
  },

  async fetch(request, env, ctx) {
    var url = new URL(request.url);

    // 옛 도메인은 뭘 요청했든(API 포함) 새 도메인의 같은 경로로 보낸다 —
    // 다른 분기보다 먼저 확인해야 한다.
    if (url.hostname === OLD_DOMAIN || url.hostname === 'www.' + OLD_DOMAIN) {
      var newUrl = new URL(url);
      newUrl.hostname = NEW_DOMAIN;
      return Response.redirect(newUrl.toString(), 301);
    }

    // 방문자 통계 API — 하트비트(공개)와 관리자 조회. backend(북마크 API)와
    // 완전히 분리된 모듈로 넘긴다.
    if (isStatsPath(url.pathname)) {
      return statsApi.fetch(request, env, ctx);
    }

    // 관리 페이지(/admin) API — 관리자 계정 + 비밀번호로 받은 세션으로만 연다.
    if (url.pathname.indexOf('/api/admin/') === 0) {
      return adminApi.fetch(request, env, ctx);
    }

    // 방문 기록 비콘. 사람 판정(Turnstile)을 거친 방문만 통계에 남긴다.
    if (url.pathname === '/api/pageview' && request.method === 'POST') {
      return handlePageViewBeacon(request, env, ctx, url);
    }

    // CORS 프리플라이트(OPTIONS)는 API 경로에서만 의미가 있지만, 정적 자산은
    // 애초에 OPTIONS를 받을 일이 없으므로 전부 backend로 넘겨도 무해하다.
    if (request.method === 'OPTIONS' || isApiPath(url.pathname)) {
      return backend.fetch(request, env, ctx);
    }

    // 사이드바 버전 표시(auth.js)가 누르면 실제 배포 시각을 확인할 수 있게
    // 부르는 엔드포인트. env.CF_VERSION_METADATA는 지금 이 요청을 처리 중인
    // Worker Version에 Cloudflare가 직접 붙여 주는 값이라, 커밋을 손으로
    // 추적하지 않아도 실배포와 항상 정확히 일치한다. timestamp의 실제
    // 런타임 타입이 문서에 명시돼 있지 않아(Date/문자열/epoch ms 전부 가능)
    // 방어적으로 ISO 문자열로 통일해서 내려준다. no-store로 캐시를 막는
    // 이유는 이 엔드포인트의 존재 목적 자체가 "방금 배포가 실제로 반영됐는지
    // 확인"이라 캐시된 옛 값을 보여주면 목적이 무의미해지기 때문이다.
    if (url.pathname === '/__build-info') {
      var meta = env.CF_VERSION_METADATA || {};
      var ts = meta.timestamp;
      var iso = null;
      if (ts != null) {
        if (ts instanceof Date) iso = ts.toISOString();
        else if (typeof ts === 'number') iso = new Date(ts).toISOString();
        else iso = String(ts);
      }
      return new Response(JSON.stringify({ id: meta.id || null, tag: meta.tag || null, timestamp: iso }), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }

    // 관리 페이지(/admin)와 그 JS·CSS 는 관리자 계정 확인 쿠키가 있을 때만 내려준다.
    // 정적 자산이라도 wrangler.toml 의 run_worker_first 로 여기를 먼저 거친다.
    var adminGate = await serveAdminGate(request, env);
    if (adminGate) return adminGate;

    var mergedTarget = MERGED_PAGE_REDIRECTS[url.pathname];
    if (mergedTarget) {
      return Response.redirect(new URL(mergedTarget, url.origin).toString(), 302);
    }

    var legacyTarget = LEGACY_HTML_TO_SLUG[url.pathname];
    if (legacyTarget) {
      var redirectUrl = new URL(url);
      redirectUrl.pathname = legacyTarget;
      return Response.redirect(redirectUrl.toString(), 308);
    }

    // 방문 기록은 여기(문서 요청)가 아니라 /api/pageview 비콘에서 남긴다 —
    // 문서 요청 시점에 세면 JS를 안 돌리는 스캐너 봇까지 전부 잡힌다.

    // "/"는 메인 페이지 슬러그(main)와 같은 것으로 취급한다.
    var pathSlug = url.pathname === '/'
      ? 'main'
      : url.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
    var file = PAGE_SLUGS[pathSlug];
    if (file) {
      var assetUrl = new URL(url);
      assetUrl.pathname = '/page/' + file;
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }

    return env.ASSETS.fetch(request);
  }
};
