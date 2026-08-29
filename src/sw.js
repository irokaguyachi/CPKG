/**
 * 설치 요건만 채우는 빈 서비스 워커.
 * - 이 사이트는 GitHub main 브랜치에 푸시할 때마다 곧바로 실서버에 배포된다.
 *   여기서 자산을 캐시하기 시작하면 "배포는 됐는데 사용자 화면엔 옛 버전이
 *   남아 있는" 사고가 조용히 생길 수 있다. 그래서 캐시를 한 줄도 쓰지 않고
 *   모든 요청을 그대로 네트워크로 흘려보낸다 — fetch 핸들러에서 respondWith를
 *   호출하지 않으면 브라우저가 평소대로 처리하므로, 이 워커는 사이트 동작에
 *   아무 영향도 주지 않는다.
 * - 크롬·엣지는 fetch 핸들러가 있는 서비스 워커가 등록돼 있어야 설치 배너를
 *   띄운다 — 이 파일이 존재하는 유일한 이유는 그 요건 충족이다.
 * - 나중에 오프라인 지원/자산 캐싱을 붙이고 싶어지면 이 파일을 확장하되,
 *   DATA_VERSION처럼 배포마다 바뀌는 캐시 무효화 전략을 먼저 갖춰야 한다.
 */
self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function () {});
