// 번역 페이지 — 실제 구현은 gridPage.js 의 공통 팩토리에 있습니다.
//
// [배선] 이 탭은 다른 페이지와 같은 방식으로 연결돼 있습니다.
//   · 라우트: _worker.js 의 PAGE_SLUGS 에 translation: 'translationPage.html'
//   · 사이드바: 모든 페이지가 <a href="/translation">번역</a> (이 페이지에서는
//     class="header-nav-strong")
//   · favType 'translation' 은 src/js/config/libraryConfig.js 의 TYPE_LABELS 와
//     worker/favoritesShareWorker.js 의 LIBRARY_ITEM_TYPES 양쪽에 등록돼 있음
//     (worker 쪽은 배포해야 실서버 북마크 라이브러리에 반영됨)
//
// [목록 데이터] src/scripts/14_build_translation_page_data.py 가
// '번역 정리/크롤링 파일/*.md'(crawl_translations.py 의 --daily 산출물)를 파싱해
// Translation.json 을 만듭니다. 크롤링 원본과 번역 사진(src/assets 아래)은
// .gitignore 대상이라 이 JSON 자체가 커밋되는 유일한 산출물입니다. 데이터를
// 새로 빌드하면 src/scripts/10_update_data_version.py 로 DATA_VERSION 을
// 갱신해야 브라우저 캐시가 깨집니다.
//
// [태그 정책] 번역 탭은 공식(AI) 태그를 지원하지 않고 유저 투표 태그만
// 사용합니다. userTagsOnly 플래그가 gridPage.js 에서 공식/유저 토글을
// 없애고 태그 풀을 처음부터 유저 태그로 고정합니다.
(function (global) {
  var body = document.body;
  if (!body) return;

  function revealContent() {
    body.classList.remove('is-content-gated');
    global.removeEventListener('scroll', revealOnScroll);
  }

  function revealOnScroll() {
    if (global.scrollY > 16) revealContent();
  }

  // 뒤로 가기로 이미 내려간 위치에서 열린 경우에는 즉시 공개한다.
  if (global.scrollY > 16) {
    revealContent();
  } else {
    global.addEventListener('scroll', revealOnScroll, { passive: true });
  }
})(window);

window.GridPage.create({
  dataUrl: '../data/PageData/Translation.json',
  favType: 'translation',
  userTagsOnly: true,
  countText: function (n) { return n + '개의 번역이 있습니다!'; },
  emptyText: '조건에 맞는 번역이 없어요.'
});
