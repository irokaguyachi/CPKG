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
import statsApi from './statsApi.js';
import { PresenceDO } from './presenceDO.js';

// 방문자 통계용 Durable Object 클래스. wrangler가 배포 시 이 export를 보고
// [[durable_objects.bindings]] / [[migrations]] 와 연결한다.
export { PresenceDO };

var OLD_DOMAIN = 'ckpg.cloud';
var NEW_DOMAIN = 'cpkg.cloud';

var API_EXACT_PATHS = ['/library', '/owner/lookup', '/user/signup', '/user/get', '/user/head', '/user/sync'];

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

// 이 요청이 "사람이 페이지를 열어본 것"인지 판정한다. Analytics Engine에
// 방문 기록을 남길지 여기서 거른다 — 정적 자산(js/css/이미지)과 fetch API
// 호출은 제외하고, HTML 문서 요청만 센다.
function isPageView(request, url) {
  if (request.method !== 'GET') return false;
  var accept = request.headers.get('Accept') || '';
  if (accept.indexOf('text/html') === -1) return false;
  // 확장자가 붙은 경로(/foo.png, /bar.js)는 문서로 보지 않는다. .html은 예외.
  var last = url.pathname.split('/').pop() || '';
  if (last.indexOf('.') !== -1 && last.slice(-5) !== '.html') return false;
  return true;
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
// 부가 기능이라, 여기서 무슨 일이 생겨도 페이지 응답에는 영향을 주지 않는다.
async function recordPageView(request, env, url) {
  try {
    if (!env.VISITS_AE) return;
    var ua = request.headers.get('User-Agent') || '';
    var ip = request.headers.get('CF-Connecting-IP') || '';
    var cf = request.cf || {};
    var daySalt = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    var visitorId = (await sha256Hex(daySalt + '|' + ip + '|' + ua)).slice(0, 32);
    var refHost = '';
    try {
      var ref = request.headers.get('Referer');
      if (ref) refHost = new URL(ref).hostname;
    } catch (e) {}
    env.VISITS_AE.writeDataPoint({
      indexes: [visitorId],
      blobs: [
        String(cf.country || 'XX'),
        deviceTypeFromUA(ua),
        url.pathname.slice(0, 96),
        refHost.slice(0, 96)
      ],
      doubles: [1]
    });
  } catch (e) {
    // 기록 실패는 삼킨다 — 통계보다 페이지가 우선이다.
  }
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

// 짧은 주소 <-> 실제 파일(src/page/ 아래) 매핑. 사이드바 등 사이트 내부
// 링크는 전부 이 짧은 주소를 쓰도록 이미 바꿔뒀다(src/page/*.html,
// src/js/bookmarksPage.js, changelogPage.js, mainPage.js, loading.js 참고) —
// 여기 슬러그를 바꾸면 그 파일들도 같이 바꿔야 한다.
var PAGE_SLUGS = {
  main: 'mainPage.html',
  novel: 'novelPage.html',
  series: 'seriesPage.html',
  hof: 'HOFPage.html',
  official: 'OfficialPage.html',
  bookmarks: 'bookmarksPage.html',
  notice: 'changelogPage.html',
  // 관리자용 방문자 통계 페이지. 화면 자체는 데이터가 없으면 아무것도 안
  // 보여주고, 실제 수치는 /api/stats/* 가 STATS_ADMIN_TOKEN 으로 막는다.
  stats: 'statsPage.html'
};

var LEGACY_HTML_TO_SLUG = {};
for (var slug in PAGE_SLUGS) {
  LEGACY_HTML_TO_SLUG['/page/' + PAGE_SLUGS[slug]] = '/' + slug;
}

export default {
  // 1분 Cron(wrangler.toml [triggers]). 접속자 게이지를 Analytics Engine에 적재.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(recordPresenceSample(env));
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

    var legacyTarget = LEGACY_HTML_TO_SLUG[url.pathname];
    if (legacyTarget) {
      var redirectUrl = new URL(url);
      redirectUrl.pathname = legacyTarget;
      return Response.redirect(redirectUrl.toString(), 308);
    }

    // 여기까지 왔다는 건 리다이렉트 없이 실제 페이지를 돌려준다는 뜻이다.
    // 사람이 문서를 연 요청이면 Analytics Engine에 방문 한 줄을 남긴다
    // (waitUntil로 응답 흐름 밖에서 처리). 관리자 통계 페이지 자신은 세지
    // 않는다 — 수치를 보는 행위가 수치를 흔들면 안 된다.
    if (url.pathname !== '/stats' && isPageView(request, url)) {
      ctx.waitUntil(recordPageView(request, env, url));
    }

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
