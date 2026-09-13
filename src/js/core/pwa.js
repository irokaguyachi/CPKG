/**
 * 설치 배너를 띄우기 위한 서비스 워커 등록. sw.js는 캐시를 쓰지 않는
 * 빈 워커라 등록해도 사이트 동작(자산 로딩)에는 영향이 없다.
 */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js');
  });
}
