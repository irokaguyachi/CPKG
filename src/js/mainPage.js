(function () {
  var TOP_THRESHOLD = 10;

  function update() {
    if (window.scrollY <= TOP_THRESHOLD) {
      document.body.classList.add('is-top');
    } else {
      document.body.classList.remove('is-top');
    }
  }

  update();
  window.addEventListener('scroll', update, { passive: true });
})();

(function () {
  var contentEl = document.getElementById('content');
  if (!contentEl || !window.RecentSection) return;

  // placeholder sections/cards until real post data is wired in
  var sections = [
    { title: '최신 등록', items: [{}, {}, {}, {}] },
    { title: '최신 등록', items: [{}, {}, {}, {}] }
  ];

  sections.forEach(function (section) {
    contentEl.appendChild(RecentSection.create(section.title, section.items));
  });
})();

(function () {
  var contentEl = document.getElementById('content');
  if (!contentEl || !window.PostDetailSeries) return;

  var POST_LINK_BASE = 'https://gall.dcinside.com/mgallery/board/view/?id=chokaguyahime&no=';

  // demo: post-cards have no real detail pages yet, so clicking one opens
  // the series-detail modal populated with a real series pulled from
  // MoonHakdata.json, previewing the interaction ahead of real routing.
  fetch('../data/MoonHakdata.json', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var series = data && data.series && data.series[0];
      if (!series) return;

      var demoData = {
        seriesName: (series.n || '').replace(/^\[|\]$/g, ''),
        episodeCount: series.c,
        episodes: (series.ch || []).map(function (ch) {
          return {
            title: ch.t,
            id: ch.i,
            link: POST_LINK_BASE + ch.i,
            episodeLabel: ch.n + ' 화'
          };
        })
      };

      contentEl.addEventListener('click', function (e) {
        if (e.target.closest('.post-card')) {
          e.preventDefault();
          PostDetailSeries.open(demoData);
        }
      });
    })
    .catch(function () {});
})();
