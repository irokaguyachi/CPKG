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
  var searchInput = document.getElementById('series-search-input');
  var filterBtn = document.getElementById('series-filter-btn');
  var filterPanel = document.getElementById('series-filter-panel');
  var filterSearch = document.getElementById('series-filter-search');
  var optionsEl = document.getElementById('series-filter-options');
  var gridEl = document.getElementById('series-grid');
  var countEl = document.getElementById('series-count');
  if (!gridEl) return;

  var CHECK_ICON = '<svg viewBox="0 0 10 10" fill="none"><path d="M1.5 5L4 7.5L8.5 2.5" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  var TAG_COLORS = {
    '일상': '#86fff9',
    '장편': '#a6e674',
    '로맨스': '#ffc1a3',
    '슬픔': '#b3b3ff',
    '코미디': '#ffe58d',
    '피폐': '#ff8a8a',
    '후방주의': '#ffb3b3',
    '장문': '#9fd8ff',
    '짧문': '#ffd1ec',
    '단편': '#d1b3ff',
    '감동': '#ffdca8',
    '글카스': '#d4d4d4',
    '명예관': '#ffb347'
  };
  var TAG_EMOJI = {
    '일상': '☕',
    '장편': '📖',
    '로맨스': '❤️',
    '슬픔': '💧',
    '코미디': '🎭',
    '피폐': '🥀',
    '후방주의': '🔞',
    '장문': '📜',
    '짧문': '✏️',
    '단편': '📄',
    '감동': '✨',
    '글카스': '🗃️',
    '명예관': '🏆'
  };
  var DEFAULT_TAG_COLOR = '#efefef';
  var DEFAULT_EMOJI = '🏷️';

  var allSeries = [];
  var activeTags = {};
  var searchTerm = '';
  var filterSearchTerm = '';

  fetch('../data/PageData/Series.json', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      // Series.json is the hand-editable source for this page — image is
      // null until someone fills one in, and series-card-image stays the
      // empty Figma placeholder (PostContent's PostImage) until then
      allSeries = Array.isArray(data) ? data : [];
      if (countEl) countEl.textContent = allSeries.length + '개의 시리즈가 있습니다!';
      renderFilterOptions();
      renderGrid();
    })
    .catch(function () {});

  function allTags() {
    var tagSet = {};
    allSeries.forEach(function (s) {
      s.tags.forEach(function (t) { tagSet[t] = true; });
    });
    return Object.keys(tagSet).sort();
  }

  function renderFilterOptions() {
    if (!optionsEl) return;
    var term = filterSearchTerm.trim().toLowerCase();
    var tags = allTags().filter(function (t) { return !term || t.toLowerCase().indexOf(term) !== -1; });

    optionsEl.innerHTML = '';
    if (!tags.length) {
      var empty = document.createElement('div');
      empty.className = 'sfp-empty';
      empty.textContent = '일치하는 옵션이 없어요';
      optionsEl.appendChild(empty);
      return;
    }

    tags.forEach(function (tag) {
      var row = document.createElement('div');
      row.className = 'sfp-option' + (activeTags[tag] ? ' is-checked' : '');
      row.dataset.tag = tag;

      var box = document.createElement('span');
      box.className = 'sfp-checkbox';
      box.innerHTML = CHECK_ICON;
      row.appendChild(box);

      var emoji = document.createElement('span');
      emoji.className = 'sfp-emoji';
      emoji.textContent = TAG_EMOJI[tag] || DEFAULT_EMOJI;
      row.appendChild(emoji);

      var label = document.createElement('span');
      label.className = 'sfp-label';
      label.textContent = tag;
      label.style.color = TAG_COLORS[tag] || DEFAULT_TAG_COLOR;
      row.appendChild(label);

      row.addEventListener('click', function () {
        if (activeTags[tag]) delete activeTags[tag];
        else activeTags[tag] = true;
        row.classList.toggle('is-checked', !!activeTags[tag]);
        updateFilterButtonState();
        renderGrid();
      });

      optionsEl.appendChild(row);
    });
  }

  function updateFilterButtonState() {
    if (!filterBtn) return;
    filterBtn.classList.toggle('is-active', Object.keys(activeTags).length > 0);
  }

  function openFilterPanel() {
    if (!filterPanel) return;
    filterPanel.hidden = false;
    filterBtn.setAttribute('aria-expanded', 'true');
    if (filterSearch) filterSearch.focus();
  }

  function closeFilterPanel() {
    if (!filterPanel) return;
    filterPanel.hidden = true;
    filterBtn.setAttribute('aria-expanded', 'false');
  }

  if (filterBtn) {
    filterBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (filterPanel.hidden) openFilterPanel();
      else closeFilterPanel();
    });
  }
  if (filterPanel) {
    filterPanel.addEventListener('click', function (e) { e.stopPropagation(); });
  }
  document.addEventListener('click', function () {
    closeFilterPanel();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeFilterPanel();
  });
  if (filterSearch) {
    filterSearch.addEventListener('input', function () {
      filterSearchTerm = filterSearch.value;
      renderFilterOptions();
    });
  }

  function renderGrid() {
    var term = searchTerm.trim().toLowerCase();
    var activeList = Object.keys(activeTags);
    var filtered = allSeries.filter(function (s) {
      if (term && s.name.toLowerCase().indexOf(term) === -1) return false;
      if (activeList.length && !activeList.some(function (t) { return s.tags.indexOf(t) !== -1; })) return false;
      return true;
    });

    gridEl.innerHTML = '';
    if (!filtered.length) {
      var empty = document.createElement('p');
      empty.className = 'series-empty';
      empty.textContent = '조건에 맞는 시리즈가 없어요.';
      gridEl.appendChild(empty);
      return;
    }

    filtered.forEach(function (s) {
      gridEl.appendChild(createSeriesCard(s));
    });
  }

  function createSeriesCard(s) {
    var card = document.createElement('article');
    card.className = 'series-card';

    var image = document.createElement('div');
    image.className = 'series-card-image';
    if (s.image) {
      image.style.backgroundImage = 'url("' + s.image + '")';
    }
    card.appendChild(image);

    var info = document.createElement('div');
    info.className = 'series-card-info';

    var title = document.createElement('p');
    title.className = 'series-card-title';
    title.textContent = s.name;
    info.appendChild(title);

    var count = document.createElement('p');
    count.className = 'series-card-count';
    count.textContent = s.episodeCount + '화';
    info.appendChild(count);

    var tagsWrap = document.createElement('div');
    tagsWrap.className = 'series-card-tags';
    s.tags.forEach(function (tag) {
      var pill = document.createElement('span');
      pill.className = 'series-card-tag';
      pill.textContent = tag;
      pill.style.background = TAG_COLORS[tag] || DEFAULT_TAG_COLOR;
      tagsWrap.appendChild(pill);
    });
    info.appendChild(tagsWrap);

    card.appendChild(info);

    card.addEventListener('click', function () {
      if (!window.PostDetailSeries) return;
      PostDetailSeries.open({
        seriesName: s.name,
        episodeCount: s.episodeCount,
        imageUrl: s.image,
        episodes: (s.posts || []).map(function (post) {
          return {
            title: post.title,
            id: post.id,
            link: post.link,
            episodeLabel: post.episode + ' 화'
          };
        })
      });
    });

    return card;
  }

  if (searchInput) {
    searchInput.addEventListener('input', function () {
      searchTerm = searchInput.value;
      renderGrid();
    });
  }
})();
