// 시리즈 문학 페이지 — 실제 구현은 gridPage.js 의 공통 팩토리에 있습니다.
// 세 목록 페이지(시리즈/명예관/공식)의 차이는 아래 config 가 전부입니다.
window.GridPage.create({
  dataUrl: '../data/pageData/Series.json',
  favType: 'series',
  countText: function (n) { return I18n.t('{n}개의 시리즈가 있습니다!', { n: n }); },
  emptyText: I18n.t('조건에 맞는 시리즈가 없어요.')
});
