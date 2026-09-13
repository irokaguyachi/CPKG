/**
 * ChoKaguya Library Config
 * - 북마크 라이브러리 관련 값 중 클라이언트 여러 파일에 흩어져 있던 것들을
 *   모았다: 이름 길이 제한(bookmarkPicker.js/bookmarksPage.js 세 군데에
 *   40으로 손으로 복사돼 있었음), 타입 라벨(bookmarksPage.js 안에서만
 *   쓰이지만 아래 worker 쪽 배열과 짝을 맞춰야 함).
 *
 * ⚠️ worker/favoritesShareWorker.js의 LIBRARY_ITEM_TYPES / LIBRARY_MAX_NAME
 *    과 값이 맞물려 있다 — 브라우저(이 파일)와 Worker(Cloudflare 엣지)는
 *    서로 다른 런타임이라 import로 값을 공유할 방법이 없다. 한쪽을 바꾸면
 *    반드시 다른 쪽도 같이 확인할 것.
 */
(function (global) {
  var MAX_NAME_LENGTH = 20; // worker: LIBRARY_MAX_NAME

  var TYPE_LABELS = {
    novel: '문학',
    translation: '번역',
    series: '시리즈',
    hof: '명예관',
    official: '공식'
  }; // 키 목록이 worker: LIBRARY_ITEM_TYPES 와 일치해야 함

  global.LibraryConfig = {
    MAX_NAME_LENGTH: MAX_NAME_LENGTH,
    TYPE_LABELS: TYPE_LABELS
  };
})(window);
