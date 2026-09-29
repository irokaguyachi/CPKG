/**
 * 북마크 바로가기 버튼 (오른쪽 아래 버튼 묶음 맨 위)
 * - 사이드바에 있던 "북마크" 링크를 오른쪽 아래 버튼 묶음(pickerKit.js 의
 *   .pk-fab-stack)으로 옮겼다. 룰렛들(order 1, 2)보다 위에 놓인다(order 0).
 * - 팝업을 여는 룰렛 버튼과 달리 /bookmarks 로 이동하는 링크다. 북마크
 *   페이지에서는 지금 보고 있는 곳이라는 표시만 하고, 같은 페이지 링크
 *   클릭은 loading.js 가 막는다.
 * - 의존: pickerKit.js
 */
(function (global) {
  var t = global.I18n.t;
  var PK = global.PickerKit;
  if (!PK || !document.body) return;

  // bookmarkPicker.js 의 카드 북마크 버튼과 같은 리본 모양
  var ICON =
    '<svg class="bm-fab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>' +
    '</svg>';

  // 짧은 주소(/bookmarks)와 파일 경로(page/bookmarksPage.html) 둘 다 있다
  var onBookmarksPage = /\/(bookmarks|bookmarksPage\.html)\/?$/i.test(global.location.pathname);

  PK.createFabLink({
    href: '/bookmarks',
    iconHtml: ICON,
    label: t('북마크'),
    ariaLabel: onBookmarksPage ? t('북마크 (현재 페이지)') : t('북마크로 이동'),
    order: 0,
    className: 'bm-fab',
    current: onBookmarksPage
  });
})(window);
