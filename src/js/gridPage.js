/**
 * ChoKaguya Grid Page
 * - Shared implementation behind 시리즈 / 명예관 / 공식 — the three pages had
 *   ~95% identical scripts, so they now pass their differences in as config
 *   and this file owns the behaviour.
 * - Config: { dataUrl, favType, countText(n), emptyText, countLine(s) }
 *   countLine 을 생략하면 SeriesUtil.countLine (자식 글이 2개 이상이면 시리즈로
 *   보고 화수, 아니면 글자 수) 을 씁니다.
 */
(function (global) {
  var TOP_THRESHOLD = 10;

  // hero-state header: collapses out of the oversized landing layout as soon
  // as the visitor scrolls at all
  (function () {
    function onScroll() {
      if (global.scrollY > TOP_THRESHOLD) {
        document.body.classList.remove('is-top');
        global.removeEventListener('scroll', onScroll);
      }
    }
    if (global.scrollY <= TOP_THRESHOLD) {
      document.body.classList.add('is-top');
      global.addEventListener('scroll', onScroll, { passive: true });
    } else {
      document.body.classList.remove('is-top');
    }
  })();

  var CHECK_ICON = '<svg viewBox="0 0 10 10" fill="none"><path d="M1.5 5L4 7.5L8.5 2.5" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // 태그 색상/이모지/정렬 — tagConfig.js(mainPage.js와 공유하는 단일 소스)로 옮김
  var TAG_COLORS = global.TagConfig.TAG_COLORS;
  var TAG_EMOJI = global.TagConfig.TAG_EMOJI;
  var DEFAULT_TAG_COLOR = global.TagConfig.DEFAULT_TAG_COLOR;
  var DEFAULT_EMOJI = global.TagConfig.DEFAULT_EMOJI;
  var sortTags = global.TagConfig.sortTags;

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

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  function create(config) {
    config = config || {};

    var searchInput = document.getElementById('series-search-input');
    var filterBtn = document.getElementById('series-filter-btn');
    var filterPanel = document.getElementById('series-filter-panel');
    var optionsEl = document.getElementById('series-filter-options');
    var gridEl = document.getElementById('series-grid');
    var countEl = document.getElementById('series-count');
    var viewToggleBtn = document.getElementById('series-view-toggle-btn');
    if (!gridEl) return;

    var countLine = config.countLine || global.SeriesUtil.countLine;

    var allItems = [];
    var activeTags = {};
    var searchTerm = '';
    var viewMode = 'grid';

    var PAGE_SIZE = 50;
    var currentFiltered = [];
    var renderedCount = 0;
    var isLoadingMore = false;
    var loadMoreObserver = null;
    var sentinelEl = null;

    // versioned URL so the browser may cache these normally (see cdnConfig.js)
    var DATA = global.dataUrl || function (p) { return p; };
    var fetchJson = global.fetchJsonCached || function (p) { return fetch(DATA(p)).then(function (r) { return r.json(); }); };

    // MiniLoading (Figma #2183:2) reuses the same mascot gifs as the full-page
    // loader — pick a random one per sentinel instead of the counter-based
    // rotation loading.js uses for the intro screen
    var miniLoadingIcons = [];
    fetchJson('../data/LoadingIcons.json')
      .then(function (files) { if (Array.isArray(files)) miniLoadingIcons = files; })
      .catch(function () {});

    fetch(DATA(config.dataUrl))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        allItems = Array.isArray(data) ? data : [];
        if (countEl) countEl.textContent = config.countText(allItems.length);
        renderFilterOptions();
        renderGrid();
        startSearchPlaceholderCycle();
      })
      .catch(function () {});

    // rotates the (empty) search input's placeholder through real item
    // names, typed out like loading.js's tip text, so the dim placeholder
    // itself hints at what you can type
    function startSearchPlaceholderCycle() {
      if (!searchInput || !allItems.length) return;
      var names = allItems.map(function (s) { return s.name; });
      var order = shuffle(names.slice());
      var idx = 0;
      var typeTimer = null;
      var gapTimer = null;
      var onScreen = true;
      var running = false;

      // the typing effect used to run a 70ms interval for as long as the page
      // was open, even in a background tab or with the search box scrolled far
      // out of view. It now only ticks while it can actually be seen.
      function canRun() { return onScreen && !document.hidden; }

      function stop() {
        running = false;
        if (typeTimer) { clearInterval(typeTimer); typeTimer = null; }
        if (gapTimer) { clearTimeout(gapTimer); gapTimer = null; }
      }

      function cycle() {
        if (!canRun()) { stop(); return; }
        running = true;
        if (idx >= order.length) { order = shuffle(names.slice()); idx = 0; }
        var name = order[idx];
        idx++;
        searchInput.placeholder = '';
        var i = 0;
        typeTimer = setInterval(function () {
          if (!canRun()) { stop(); return; }
          searchInput.placeholder += name.charAt(i);
          i++;
          if (i >= name.length) {
            clearInterval(typeTimer);
            typeTimer = null;
            gapTimer = setTimeout(cycle, 5000);
          }
        }, 70);
      }

      function sync() {
        if (canRun()) { if (!running) cycle(); }
        else stop();
      }

      document.addEventListener('visibilitychange', sync);
      if ('IntersectionObserver' in global) {
        new IntersectionObserver(function (records) {
          onScreen = records[0].isIntersecting;
          sync();
        }).observe(searchInput);
      }

      cycle();
    }

    function matchesSearch(s, term) {
      if (!term) return true;
      var name = s.name;
      var lowerName = name.toLowerCase();
      if (lowerName.indexOf(term) !== -1) return true;
      if (CHOSUNG_ONLY_RE.test(term)) {
        if (toChosung(name).indexOf(term) !== -1) return true;
      }
      // 디시 게시물 번호로도 검색 가능
      var posts = s.posts || [];
      for (var i = 0; i < posts.length; i++) {
        var p = posts[i];
        if (p.id != null && String(p.id).indexOf(term) !== -1) return true;
      }
      return false;
    }

    function allTags() {
      var tagSet = {};
      allItems.forEach(function (s) {
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

    // 그리드/리스트 보기 — localStorage에 저장해서 다른 페이지(탭)로 이동해도
    // 유지된다. 아이콘은 theme.js의 테마 토글 버튼과 같은 관례로 "누르면
    // 바뀔 모드"를 보여준다(현재 상태 아이콘이 아님).
    var VIEW_MODE_KEY = 'chokaguya_grid_view';
    var GRID_ICON = '<svg viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="1.5" y="1.5" width="6.5" height="6.5" rx="1.5" stroke="currentColor" stroke-width="1.5"/><rect x="10" y="1.5" width="6.5" height="6.5" rx="1.5" stroke="currentColor" stroke-width="1.5"/><rect x="1.5" y="10" width="6.5" height="6.5" rx="1.5" stroke="currentColor" stroke-width="1.5"/><rect x="10" y="10" width="6.5" height="6.5" rx="1.5" stroke="currentColor" stroke-width="1.5"/></svg>';
    var LIST_ICON = '<svg viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="1.5" y="2" width="15" height="3.5" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="1.5" y="7.25" width="15" height="3.5" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="1.5" y="12.5" width="15" height="3.5" rx="1" stroke="currentColor" stroke-width="1.5"/></svg>';

    function getStoredViewMode() {
      var stored = global.localStorage.getItem(VIEW_MODE_KEY);
      return stored === 'list' ? 'list' : 'grid';
    }

    function applyViewMode(mode, skipRerender) {
      viewMode = mode === 'list' ? 'list' : 'grid';
      gridEl.classList.toggle('is-list-view', viewMode === 'list');
      if (viewToggleBtn) {
        var toList = viewMode === 'grid';
        viewToggleBtn.innerHTML = toList ? LIST_ICON : GRID_ICON;
        viewToggleBtn.setAttribute('aria-pressed', viewMode === 'list' ? 'true' : 'false');
        viewToggleBtn.setAttribute('aria-label', toList ? '리스트로 보기' : '그리드로 보기');
        viewToggleBtn.title = toList ? '리스트로 보기' : '그리드로 보기';
      }
      global.localStorage.setItem(VIEW_MODE_KEY, viewMode);
      // 뷰 전환은 이미 받아둔 currentFiltered를 다른 카드로 다시 그리는
      // 것뿐이라 네트워크 재요청이 없다 — renderGrid()를 그대로 다시
      // 불러도 검색/태그 필터 때와 같은 저비용 동작이다.
      if (!skipRerender) renderGrid();
    }

    if (viewToggleBtn) {
      viewToggleBtn.addEventListener('click', function () {
        applyViewMode(viewMode === 'list' ? 'grid' : 'list');
      });
    }
    applyViewMode(getStoredViewMode(), true);

    function renderGrid() {
      var term = searchTerm.trim().toLowerCase();
      var activeList = Object.keys(activeTags);
      var filtered = allItems.filter(function (s) {
        if (!matchesSearch(s, term)) return false;
        if (activeList.length && !activeList.some(function (t) { return s.tags.indexOf(t) !== -1; })) return false;
        return true;
      });

      currentFiltered = filtered;
      renderedCount = 0;
      isLoadingMore = false;
      if (loadMoreObserver) loadMoreObserver.disconnect();
      sentinelEl = null;
      // cards about to be discarded may still be registered with the lazy-image
      // observer (it only unobserves ones that actually became visible), so
      // clear the batch before wiping the grid — otherwise every re-render on
      // keystroke leaves detached nodes behind for it to keep re-checking
      if (global.unobserveAllLazy) global.unobserveAllLazy();
      gridEl.innerHTML = '';

      if (!filtered.length) {
        var empty = document.createElement('p');
        empty.className = 'series-empty';
        empty.textContent = config.emptyText;
        gridEl.appendChild(empty);
        return;
      }

      appendNextPage();
    }

    // renders the next PAGE_SIZE cards and (re)places the loading sentinel
    // after them so infinite scroll always resumes from the grid's true end
    function appendNextPage() {
      var next = currentFiltered.slice(renderedCount, renderedCount + PAGE_SIZE);
      var frag = document.createDocumentFragment();
      var buildCard = viewMode === 'list' ? createListCard : createGridCard;
      next.forEach(function (s) {
        frag.appendChild(buildCard(s));
      });
      gridEl.appendChild(frag);
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
        // served from the origin, not R2 — src/offline_src/LoadingLogo/
        icon.style.backgroundImage = 'url("../offline_src/LoadingLogo/' + pick + '")';
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
      // brief hold so the MiniLoading row is legible rather than flashing —
      // 500ms just read as the next cards being slow to arrive
      setTimeout(function () {
        appendNextPage();
        isLoadingMore = false;
      }, 180);
    }

    function createGridCard(s) {
      var card = document.createElement('article');
      card.className = 'series-card';

      var image = document.createElement('div');
      image.className = 'series-card-image';
      if (s.image) {
        // cards show the 600px thumbnail, never the full-size original
        if (global.lazyLoadBackground) {
          global.lazyLoadBackground(image, s.image);
        } else {
          var finalImg = global.resolveThumbUrl ? global.resolveThumbUrl(s.image) : s.image;
          image.style.backgroundImage = 'url("' + finalImg + '")';
        }
      }
      var favId = s.posts && s.posts[0] && s.posts[0].id;
      if (favId != null) image.appendChild(global.BookmarkPicker.createButton(config.favType, favId));
      card.appendChild(image);

      var info = document.createElement('div');
      info.className = 'series-card-info';

      var title = document.createElement('p');
      title.className = 'series-card-title';
      title.textContent = s.name;
      info.appendChild(title);

      var count = document.createElement('p');
      count.className = 'series-card-count';
      count.textContent = countLine(s);
      info.appendChild(count);

      var tagsWrap = document.createElement('div');
      tagsWrap.className = 'series-card-tags';
      // 4개째부터는 2줄로 넘어가면서 형제 카드와 높이가 어긋나므로 3개까지만 보여준다
      sortTags(s.tags).slice(0, 3).forEach(function (tag) {
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
        if (!global.PostDetailSeries) return;
        PostDetailSeries.open({
          seriesName: s.name,
          imageUrl: s.image,
          episodes: (s.posts || []).map(function (post) {
            return {
              title: post.title,
              dcId: post.id,
              link: post.link,
              episodeLabel: post.episode + ' 화'
            };
          })
        });
      });

      return card;
    }

    // 리스트 뷰 카드 — mainPage.js의 .post-row 마크업을 재사용해 메인
    // 페이지의 "최신 등록" 리스트와 같은 모습을 낸다. 화수/글자수 뱃지는
    // createGridCard와 같은 countLine(s)을 써서 그리드/리스트가 항상 같은
    // 문구를 보여주도록 한다.
    function createListCard(s) {
      var card = document.createElement('article');
      card.className = 'post-row';

      var image = document.createElement('div');
      image.className = 'post-row-image';
      if (s.image) {
        if (global.lazyLoadBackground) {
          global.lazyLoadBackground(image, s.image);
        } else {
          var finalImg = global.resolveThumbUrl ? global.resolveThumbUrl(s.image) : s.image;
          image.style.backgroundImage = 'url("' + finalImg + '")';
        }
      }
      var favId = s.posts && s.posts[0] && s.posts[0].id;
      if (favId != null) image.appendChild(global.BookmarkPicker.createButton(config.favType, favId));
      card.appendChild(image);

      var info = document.createElement('div');
      info.className = 'post-row-info';

      var title = document.createElement('p');
      title.className = 'post-row-title';
      var name = document.createElement('span');
      name.className = 'post-row-name';
      name.textContent = s.name;
      title.appendChild(name);
      info.appendChild(title);

      var tagsWrap = document.createElement('div');
      tagsWrap.className = 'post-row-tags';
      sortTags(s.tags).slice(0, 3).forEach(function (tag) {
        var pill = document.createElement('span');
        pill.className = 'series-card-tag';
        pill.dataset.tag = tag;
        pill.textContent = (TAG_EMOJI[tag] || DEFAULT_EMOJI) + ' ' + tag;
        pill.style.background = TAG_COLORS[tag] || DEFAULT_TAG_COLOR;
        tagsWrap.appendChild(pill);
      });
      info.appendChild(tagsWrap);

      card.appendChild(info);

      var episode = document.createElement('div');
      episode.className = 'post-row-episode';
      episode.textContent = countLine(s);
      card.appendChild(episode);

      card.addEventListener('click', function () {
        if (!global.PostDetailSeries) return;
        PostDetailSeries.open({
          seriesName: s.name,
          imageUrl: s.image,
          episodes: (s.posts || []).map(function (post) {
            return {
              title: post.title,
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
      // rebuilding the whole grid on every keystroke is far more work than a
      // typist can outrun; coalesce bursts of input into one render
      var searchTimer = null;
      searchInput.addEventListener('input', function () {
        searchTerm = searchInput.value;
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(function () {
          searchTimer = null;
          renderGrid();
        }, 150);
      });
    }

    // 모바일(series-toolbar.css 의 768px 브레이크포인트와 동일)에서는 검색창을
    // 화면 아래쪽의 작은 원형 버튼으로 접어두고, 탭하면 같은 자리에서 전체
    // 알약(검색창+필터)으로 펼친다 — is-search-open 클래스를 CSS 쪽 애니메이션이
    // 그대로 사용한다.
    var toolbarEl = document.querySelector('.series-toolbar');
    var searchLabel = document.querySelector('.series-search');
    var mobileQuery = global.matchMedia ? global.matchMedia('(max-width: 768px)') : null;
    function isMobileToolbar() { return !!(mobileQuery && mobileQuery.matches); }

    function openMobileSearch() {
      if (!toolbarEl) return;
      toolbarEl.classList.add('is-search-open');
      if (searchInput) searchInput.focus();
    }
    function closeMobileSearch() {
      if (toolbarEl) toolbarEl.classList.remove('is-search-open');
    }

    if (toolbarEl && searchLabel) {
      // 접혀 있을 때는 라벨 클릭이 곧 "펼치기" — 펼쳐지기 전엔 input이
      // display:none이라 기본 라벨→포커스 동작이 일어나지 않으므로, 펼친 뒤
      // 직접 포커스를 준다.
      searchLabel.addEventListener('click', function (e) {
        if (!isMobileToolbar()) return;
        if (!toolbarEl.classList.contains('is-search-open')) {
          e.preventDefault();
          openMobileSearch();
        }
      });
      document.addEventListener('click', function (e) {
        if (!isMobileToolbar()) return;
        if (!toolbarEl.classList.contains('is-search-open')) return;
        if (toolbarEl.contains(e.target)) return;
        closeMobileSearch();
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && isMobileToolbar()) closeMobileSearch();
      });
      // 펼친 채로 창 크기를 키워 데스크톱 폭을 넘기면(회전, 리사이즈) 다음에
      // 다시 모바일로 돌아왔을 때 항상 접힌 채로 시작하도록 정리해둔다.
      if (mobileQuery && mobileQuery.addEventListener) {
        mobileQuery.addEventListener('change', function (e) {
          if (!e.matches) closeMobileSearch();
        });
      }
    }
  }

  global.GridPage = { create: create };
})(window);
