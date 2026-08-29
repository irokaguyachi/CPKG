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
 */
import backend from '../worker/favoritesShareWorker.js';

var API_EXACT_PATHS = ['/library', '/owner/lookup', '/user/signup', '/user/get', '/user/head', '/user/sync'];

function isApiPath(pathname) {
  if (API_EXACT_PATHS.indexOf(pathname) !== -1) return true;
  return pathname.indexOf('/library/') === 0;
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
  notice: 'changelogPage.html'
};

var LEGACY_HTML_TO_SLUG = {};
for (var slug in PAGE_SLUGS) {
  LEGACY_HTML_TO_SLUG['/page/' + PAGE_SLUGS[slug]] = '/' + slug;
}

export default {
  async fetch(request, env, ctx) {
    var url = new URL(request.url);
    // CORS 프리플라이트(OPTIONS)는 API 경로에서만 의미가 있지만, 정적 자산은
    // 애초에 OPTIONS를 받을 일이 없으므로 전부 backend로 넘겨도 무해하다.
    if (request.method === 'OPTIONS' || isApiPath(url.pathname)) {
      return backend.fetch(request, env, ctx);
    }

    var legacyTarget = LEGACY_HTML_TO_SLUG[url.pathname];
    if (legacyTarget) {
      var redirectUrl = new URL(url);
      redirectUrl.pathname = legacyTarget;
      return Response.redirect(redirectUrl.toString(), 308);
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
