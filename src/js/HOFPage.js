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
  var searchInput = document.getElementById('series-search-input');
  var filterBtn = document.getElementById('series-filter-btn');
  var filterPanel = document.getElementById('series-filter-panel');
  var optionsEl = document.getElementById('series-filter-options');
  var gridEl = document.getElementById('series-grid');
  var countEl = document.getElementById('series-count');
  if (!gridEl) return;

  var CHECK_ICON = '<svg viewBox="0 0 10 10" fill="none"><path d="M1.5 5L4 7.5L8.5 2.5" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var STAR_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>';

  // 즐겨찾기 별 버튼 — 카드 클릭(상세보기)과 별개로 동작하도록 클릭 시
  // stopPropagation. 즐겨찾기 목록 확인/내보내기/불러오기는 추후 구현 예정
  function createFavButton(key, meta) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'series-card-fav';
    btn.innerHTML = STAR_ICON;
    btn.setAttribute('aria-label', '즐겨찾기');
    if (window.Favorites && window.Favorites.isFavorite(key)) {
      btn.classList.add('is-fav');
    }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!window.Favorites) return;
      var nowFav = window.Favorites.toggle(key, meta);
      btn.classList.toggle('is-fav', nowFav);
    });
    return btn;
  }

  var TAG_COLORS = {
    '일상': '#e2f4f2',
    '소설': '#f3ebe4',
    '장편': '#e6f4df',
    '로맨스': '#fae4ec',
    '슬픔': '#e8ecf8',
    '코미디': '#faf1d2',
    '피폐': '#fae4e4',
    '후방주의': '#fae4e4',
    '짧문': '#f5e4f2',
    '단편': '#eee4fb',
    '감동': '#fbf0df',
    '명예관': '#faeed4',
    '대회': '#e4eefb',
    '미스테리': '#ece8f7',
    'SF': '#e0f1f6',
    '글카스': '#ebecee'
  };
  var TAG_EMOJI = {
    '일상': '☕',
    '소설': '📕',
    '장편': '📖',
    '로맨스': '❤️',
    '슬픔': '💧',
    '코미디': '🎭',
    '피폐': '🥀',
    '후방주의': '🔞',
    '짧문': '✏️',
    '단편': '📄',
    '감동': '✨',
    '글카스': '🗃️',
    '명예관': '🏆'
  };
  var DEFAULT_TAG_COLOR = '#efefef';
  var DEFAULT_EMOJI = '🏷️';

  // matches the classification order in .agent/rules/tag.md (분량 태그 →
  // 명예관/대회 → 장르 태그 순) so the filter list and card pills read in a
  // consistent, intentional order instead of alphabetically
  var TAG_ORDER = [
    '짧문', '소설', '장편', '단편',
    '명예관', '대회',
    '피폐', '슬픔', '감동', '로맨스', '후방주의', '코미디', '일상', '미스테리', 'SF',
    '글카스', '이모티콘', 'IF 스토리',
    '분류 안함', 'AI', '로카'
  ];
  function tagOrderIndex(t) {
    var i = TAG_ORDER.indexOf(t);
    return i === -1 ? TAG_ORDER.length : i;
  }
  function sortTags(tags) {
    return tags.slice().sort(function (a, b) {
      var d = tagOrderIndex(a) - tagOrderIndex(b);
      return d !== 0 ? d : a.localeCompare(b);
    });
  }

  var allPosts = [];
  var activeTags = {};
  var searchTerm = '';

  var PAGE_SIZE = 50;
  var currentFiltered = [];
  var renderedCount = 0;
  var isLoadingMore = false;
  var loadMoreObserver = null;
  var sentinelEl = null;

  // MiniLoading (Figma #2183:2) reuses the same mascot gifs as the full-page
  // loader — pick a random one per sentinel instead of the counter-based
  // rotation loading.js uses for the intro screen
  var miniLoadingIcons = [];
  fetch('../data/LoadingIcons.json', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (files) { if (Array.isArray(files)) miniLoadingIcons = files; })
    .catch(function () {});

  fetch('../data/PageData/HOF.json', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      // HOF.json is auto-extracted from MoonHakdata.json's 명예관-tagged
      // posts — each entry is a single post, modeled with the same
      // episodeCount/posts[] shape as Series.json so it can reuse the same
      // card renderer and the Post_Detail_Series modal as-is
      allPosts = Array.isArray(data) ? data : [];
      assignPostNumbers();
      if (countEl) countEl.textContent = allPosts.length + '개의 게시물이 있습니다!';
      renderFilterOptions();
      renderGrid();
      startSearchPlaceholderCycle();
    })
    .catch(function () {});

  // rotates the (empty) search input's placeholder through real post
  // names, typed out like loading.js's tip text, so the dim placeholder
  // itself hints at what you can type
  function startSearchPlaceholderCycle() {
    if (!searchInput || !allPosts.length) return;
    var names = allPosts.map(function (s) { return s.name; });
    var order = shuffle(names.slice());
    var idx = 0;
    function cycle() {
      if (idx >= order.length) { order = shuffle(names.slice()); idx = 0; }
      var name = order[idx];
      idx++;
      typePlaceholder(searchInput, name, 70, function () {
        setTimeout(cycle, 5000);
      });
    }
    cycle();
  }

  function typePlaceholder(el, text, speed, done) {
    el.placeholder = '';
    var i = 0;
    var timer = setInterval(function () {
      el.placeholder += text.charAt(i);
      i++;
      if (i >= text.length) {
        clearInterval(timer);
        if (done) done();
      }
    }, speed);
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  // 초성 검색: "ㅅㅋㅇㄹ ㅇㄹㅎ" 같은 자음만으로도 "사카요리 이로하"를 찾을 수
  // 있도록, 검색어가 자음으로만 이루어져 있으면 이름을 초성으로 변환해 비교함
  var CHOSUNG_LIST = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
  function toChosung(str) {
    var result = '';
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i) - 0xac00;
      if (code >= 0 && code <= 11171) {
        result += CHOSUNG_LIST[Math.floor(code / 588)];
      } else {
        result += str[i];
      }
    }
    return result;
  }
  var CHOSUNG_ONLY_RE = /^[ㄱ-ㅎ\s]+$/;
  function matchesSearch(s, term) {
    if (!term) return true;
    var name = s.name;
    var lowerName = name.toLowerCase();
    if (lowerName.indexOf(term) !== -1) return true;
    if (CHOSUNG_ONLY_RE.test(term)) {
      if (toChosung(name).indexOf(term) !== -1) return true;
    }
    // 자체 게시물 번호(H1...)나 디시 게시물 번호로도 검색 가능
    var posts = s.posts || [];
    for (var i = 0; i < posts.length; i++) {
      var p = posts[i];
      if (p.customNo && p.customNo.toLowerCase().indexOf(term) !== -1) return true;
      if (p.id != null && String(p.id).indexOf(term) !== -1) return true;
    }
    return false;
  }

  // DC 게시물 번호(디시 게시물 번호) 대신 사이트 자체 게시물 번호를 매김 —
  // 명예관은 파일 순서대로 H1, H2, H3... 로 전체 게시물에 걸쳐 고유하게 부여
  function assignPostNumbers() {
    var counter = 1;
    allPosts.forEach(function (s) {
      (s.posts || []).forEach(function (post) {
        post.customNo = 'H' + counter;
        counter++;
      });
    });
  }

  function allTags() {
    var tagSet = {};
    allPosts.forEach(function (s) {
      s.tags.forEach(function (t) { tagSet[t] = true; });
    });
    return sortTags(Object.keys(tagSet));
  }

  function renderFilterOptions() {
    if (!optionsEl) return;
    var tags = allTags();

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
      label.dataset.tag = tag;
      label.textContent = tag;
      label.style.background = TAG_COLORS[tag] || DEFAULT_TAG_COLOR;
      label.style.color = '#000000';
      label.style.padding = '0.1042vw 0.4167vw';
      label.style.borderRadius = '999px';
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
    filterPanel.classList.add('is-open');
    filterBtn.setAttribute('aria-expanded', 'true');
  }

  function closeFilterPanel() {
    if (!filterPanel) return;
    filterPanel.classList.remove('is-open');
    filterBtn.setAttribute('aria-expanded', 'false');
  }

  if (filterBtn) {
    filterBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (filterPanel.classList.contains('is-open')) closeFilterPanel();
      else openFilterPanel();
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

  function renderGrid() {
    var term = searchTerm.trim().toLowerCase();
    var activeList = Object.keys(activeTags);
    var filtered = allPosts.filter(function (s) {
      if (!matchesSearch(s, term)) return false;
      if (activeList.length && !activeList.some(function (t) { return s.tags.indexOf(t) !== -1; })) return false;
      return true;
    });

    currentFiltered = filtered;
    renderedCount = 0;
    isLoadingMore = false;
    if (loadMoreObserver) loadMoreObserver.disconnect();
    sentinelEl = null;
    gridEl.innerHTML = '';

    if (!filtered.length) {
      var empty = document.createElement('p');
      empty.className = 'series-empty';
      empty.textContent = '조건에 맞는 게시물이 없어요.';
      gridEl.appendChild(empty);
      return;
    }

    appendNextPage();
  }

  // renders the next PAGE_SIZE cards and (re)places the loading sentinel
  // after them so infinite scroll always resumes from the grid's true end
  function appendNextPage() {
    var next = currentFiltered.slice(renderedCount, renderedCount + PAGE_SIZE);
    next.forEach(function (s) {
      gridEl.appendChild(createPostCard(s));
    });
    renderedCount += next.length;
    updateSentinel();
  }

  function updateSentinel() {
    if (sentinelEl) {
      if (loadMoreObserver) loadMoreObserver.unobserve(sentinelEl);
      if (sentinelEl.parentNode) sentinelEl.parentNode.removeChild(sentinelEl);
      sentinelEl = null;
    }
    if (renderedCount >= currentFiltered.length) return;

    sentinelEl = document.createElement('div');
    sentinelEl.className = 'series-loading-more';

    var icon = document.createElement('div');
    icon.className = 'series-loading-icon';
    if (miniLoadingIcons.length) {
      var pick = miniLoadingIcons[Math.floor(Math.random() * miniLoadingIcons.length)];
      var rawPick = '../assets/Image/LoadingIcon/' + pick;
      icon.style.backgroundImage = 'url("' + (window.resolveAssetUrl ? window.resolveAssetUrl(rawPick) : rawPick) + '")';
    }
    sentinelEl.appendChild(icon);

    var label = document.createElement('p');
    label.className = 'series-loading-text';
    label.textContent = 'Loading';
    sentinelEl.appendChild(label);

    gridEl.appendChild(sentinelEl);

    if (!loadMoreObserver) {
      loadMoreObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) handleSentinelVisible();
        });
      }, { rootMargin: '200px 0px' });
    }
    loadMoreObserver.observe(sentinelEl);
  }

  function handleSentinelVisible() {
    if (isLoadingMore || renderedCount >= currentFiltered.length) return;
    isLoadingMore = true;
    setTimeout(function () {
      appendNextPage();
      isLoadingMore = false;
    }, 500);
  }

  function createPostCard(s) {
    var card = document.createElement('article');
    card.className = 'series-card';

    var image = document.createElement('div');
    image.className = 'series-card-image';
    if (s.image) {
      if (window.lazyLoadBackground) {
        window.lazyLoadBackground(image, s.image);
      } else {
        var finalImg = window.resolveAssetUrl ? window.resolveAssetUrl(s.image) : s.image;
        image.style.backgroundImage = 'url("' + finalImg + '")';
      }
    }
    image.appendChild(createFavButton('hof:' + s.name, { type: 'hof', name: s.name }));
    card.appendChild(image);

    var info = document.createElement('div');
    info.className = 'series-card-info';

    var title = document.createElement('p');
    title.className = 'series-card-title';
    title.textContent = s.name;
    info.appendChild(title);

    // HOF entries are single posts, not multi-episode series — the char
    // count (already crawled per post) is a far more useful line here
    // than a constant "1화" would be
    var count = document.createElement('p');
    count.className = 'series-card-count';
    count.textContent = s.charCount || (s.episodeCount + '화');
    info.appendChild(count);

    var tagsWrap = document.createElement('div');
    tagsWrap.className = 'series-card-tags';
    sortTags(s.tags).forEach(function (tag) {
      var pill = document.createElement('span');
      pill.className = 'series-card-tag';
      pill.dataset.tag = tag;
      pill.textContent = (TAG_EMOJI[tag] || DEFAULT_EMOJI) + ' ' + tag;
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
            id: post.customNo,
            dcId: post.id,
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
