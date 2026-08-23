// 문학 페이지 — 실제 구현은 gridPage.js 의 공통 팩토리에 있습니다.
// Novel.json 은 시리즈에 속하지 않은 단독 게시물만 담고 있습니다
// (생성: src/scripts/7_build_novel_page_data.py).
window.GridPage.create({
  dataUrl: '../data/PageData/Novel.json',
  favType: 'novel',
  countText: function (n) { return n + '개의 문학이 있습니다!'; },
  emptyText: '조건에 맞는 문학이 없어요.'
});
