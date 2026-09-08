// 번역 페이지 — 실제 구현은 gridPage.js 의 공통 팩토리에 있습니다.
//
// [게이트 상태] 이 탭은 아직 공개하지 않습니다. 지금은 어떤 경로로도 열리지
// 않도록 다음 세 가지로 막아 두었습니다.
//   1) _worker.js 의 PAGE_SLUGS 에 translation 슬러그가 없어 /translation 은 404
//   2) src/.assetsignore 가 page/translationPage.html 과 js/translationPage.js 를
//      배포에서 제외 → 직접 주소(/page/translationPage.html)로도 404
//   3) 모든 페이지 사이드바의 번역 링크는 <a href="#" data-locked> 상태 그대로
//
// [탭을 공개할 때 해야 하는 작업]
//   1) src/.assetsignore 에서 번역 탭 관련 두 줄(page/translationPage.html,
//      js/translationPage.js)을 지웁니다.
//   2) _worker.js 의 PAGE_SLUGS 에 translation: 'translationPage.html' 을 추가합니다.
//   3) 모든 페이지 사이드바의 <a href="#" data-locked>번역</a> 을
//      <a href="/translation">번역</a> 으로 바꿉니다(현재 페이지에서는
//      class="header-nav-strong" 를 붙입니다).
//   4) favType 'translation' 을 src/js/libraryConfig.js 의 TYPE_LABELS 와
//      worker/favoritesShareWorker.js 의 LIBRARY_ITEM_TYPES 양쪽에 등록합니다.
//   5) src/data/PageData/Translation.json 을 채우는 빌드 스크립트를 연결합니다
//      (크롤링 산출물: src/scripts/crawl_translations.py).
//
// [태그 정책] 번역 탭은 공식(AI) 태그를 지원하지 않고 유저 투표 태그만
// 사용합니다. userTagsOnly 플래그가 gridPage.js 에서 공식/유저 토글을
// 없애고 태그 풀을 처음부터 유저 태그로 고정합니다.
window.GridPage.create({
  dataUrl: '../data/PageData/Translation.json',
  favType: 'translation',
  userTagsOnly: true,
  countText: function (n) { return n + '개의 번역이 있습니다!'; },
  emptyText: '조건에 맞는 번역이 없어요.'
});
