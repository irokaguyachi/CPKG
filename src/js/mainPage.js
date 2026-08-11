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
