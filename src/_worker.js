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
 */
import backend from '../worker/favoritesShareWorker.js';

var API_EXACT_PATHS = ['/library', '/owner/lookup', '/user/signup', '/user/get', '/user/head', '/user/sync'];

function isApiPath(pathname) {
  if (API_EXACT_PATHS.indexOf(pathname) !== -1) return true;
  return pathname.indexOf('/library/') === 0;
}

export default {
  async fetch(request, env, ctx) {
    var url = new URL(request.url);
    // CORS 프리플라이트(OPTIONS)는 API 경로에서만 의미가 있지만, 정적 자산은
    // 애초에 OPTIONS를 받을 일이 없으므로 전부 backend로 넘겨도 무해하다.
    if (request.method === 'OPTIONS' || isApiPath(url.pathname)) {
      return backend.fetch(request, env, ctx);
    }
    // html_handling="none"(아래 설명) 상태에서는 "/"가 index.html로 자동
    // 연결되지 않으므로 여기서 직접 이어준다. 그 외 경로는 손대지 않는다.
    if (url.pathname === '/') {
      var indexUrl = new URL(url);
      indexUrl.pathname = '/index.html';
      return env.ASSETS.fetch(new Request(indexUrl, request));
    }
    return env.ASSETS.fetch(request);
  }
};
