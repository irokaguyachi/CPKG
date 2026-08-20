(function () {
  var TOP_THRESHOLD = 10;

  function onScroll() {
    if (window.scrollY > TOP_THRESHOLD) {
      document.body.classList.remove('is-top');
      window.removeEventListener('scroll', onScroll);
    }
  }

  if (window.scrollY <= TOP_THRESHOLD) {
    document.body.classList.add('is-top');
    window.addEventListener('scroll', onScroll, { passive: true });
  } else {
    document.body.classList.remove('is-top');
  }
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

  var DATA = window.dataUrl || function (p) { return p; };

  // demo: post-cards have no real detail pages yet, so clicking one opens
  // the series-detail modal populated with a real series, previewing the
  // interaction ahead of real routing.
  // Reads Series.json (138 KB) rather than MoonHakdata.json (493 KB) — this
  // only ever needs one series, and Series.json is already the file the
  // series page loads, so a visitor who goes there reuses the cached copy.
  fetch(DATA('../data/PageData/Series.json'))
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!Array.isArray(data) || !data.length) return;
      var series = data[0];

      // seriesPage.js 와 같은 번호(오래된 글이 S1)를 붙여서, 데모 모달에도
      // 실제 페이지에서 보이는 것과 동일한 게시물 번호가 나오게 함
      SeriesUtil.assignPostNumbers(data, 'S');

      var demoData = {
        seriesName: series.name,
        imageUrl: series.image,
        episodes: (series.posts || []).map(function (post) {
          return {
            title: post.title,
            id: post.customNo,
            dcId: post.id,
            link: post.link,
            episodeLabel: post.episode + ' 화'
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
