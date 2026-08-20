// 공식 페이지 — 실제 구현은 gridPage.js 의 공통 팩토리에 있습니다.
// Official.json 은 의도적으로 비워둔 수동 관리 파일입니다.
window.GridPage.create({
  dataUrl: '../data/PageData/Official.json',
  numberPrefix: 'O',
  favType: 'official',
  countText: function (n) { return n + '개의 게시물이 있습니다!'; },
  emptyText: '조건에 맞는 게시물이 없어요.'
});
