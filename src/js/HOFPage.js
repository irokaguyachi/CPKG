// 명예관 페이지 — 실제 구현은 gridPage.js 의 공통 팩토리에 있습니다.
// 명예관 항목은 시리즈가 아니라 단일 게시물이라, 화수 대신 크롤링된
// 글자 수를 카드에 보여줍니다.
window.GridPage.create({
  dataUrl: '../data/PageData/HOF.json',
  favType: 'hof',
  countText: function (n) { return n + '개의 게시물이 있습니다!'; },
  emptyText: '조건에 맞는 게시물이 없어요.'
});
