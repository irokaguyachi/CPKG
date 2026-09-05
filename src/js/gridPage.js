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

  // 화들 중 하나라도 오디오 노벨 리더가 연결돼 있으면(post.reader) 그
  // 시리즈는 목록 단계에서부터 코너 리본으로 표시한다 (postDetailSeries.js가
  // 상세 모달 안에서 화 단위로 하는 표시와는 별개 — 여긴 작품 단위).
  function hasAudioNovel(s) {
    var posts = s && s.posts;
    if (!posts || !posts.length) return false;
    for (var i = 0; i < posts.length; i++) {
      if (posts[i] && posts[i].reader) return true;
    }
    return false;
  }

  function createAudioRibbon() {
    var ribbon = document.createElement('span');
    ribbon.className = 'audio-novel-ribbon';
    var icon = document.createElement('span');
    icon.className = 'audio-novel-ribbon-icon';
    icon.textContent = '🎧';
    var label = document.createElement('span');
    label.className = 'audio-novel-ribbon-label';
    label.textContent = '오디오노벨';
    ribbon.appendChild(icon);
    ribbon.appendChild(label);
    return ribbon;
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

    var rawItems = [];
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

    // 유저 태그 투표 스냅샷 병합(config.userTags — 지금은 novelPage.js만 켠다).
    // Cron이 5분마다 D1을 집계해 구워 두는 정적 스냅샷이라 페이지당 한 번만
    // 받으면 되고, 실패해도 정적 태그만으로 화면이 그려져야 하므로 조용히
    // 넘어간다(태그는 부가 정보라 페이지를 막지 않는다).
    // 첫 표부터 카드·필터에 반영한다. 더 높이면 방금 투표한 태그가 상세
    // 팝업에는 1등으로 뜨는데 목록 바깥에는 한동안 안 보이는 괴리가 생긴다.
    var TAG_SNAPSHOT_MIN_VOTES = 1;
    // 투표 가능한 유저 태그 후보 고정 목록(UserTagCatalog.json). 득표 여부와
    // 무관하게 필터 옵션으로 항상 보여준다 — 아직 아무도 투표하지 않은
    // 초기 상태에서도 유저 태그 필터가 빈 칸이 되지 않도록 allTags()가
    // 스냅샷 득표 태그와 이 목록의 합집합을 돌려준다.
    var userTagCatalog = [];
    // 공식 태그(s.tags)와는 별개 필드(s.popularUserTags)에 담는다 — 합쳐
    // 버리면 "공식/유저" 탭이 어느 태그가 어느 쪽 출처인지 구분할 수
    // 없어진다. 탭(activePool)에 따라 tagsField(s)가 둘 중 하나만 골라
    // 돌려주고, 카드 알약도 필터 후보 목록도 전부 그 결과 하나만 쓴다.
    function mergeUserTagSnapshot(snapshot) {
      var postsMap = (snapshot && snapshot.posts) || {};
      rawItems.forEach(function (s) {
        var pid = s.posts && s.posts[0] && s.posts[0].id;
        if (pid == null) return;
        var entries = postsMap[String(pid)] || [];
        s.popularUserTags = entries
          .filter(function (e) { return e && e.votes >= TAG_SNAPSHOT_MIN_VOTES; })
          .map(function (e) { return e.tag; });
      });
    }

    // 설정이 꺼져 있으면(기본값) `후방주의` 태그가 붙은 항목을 그리드에
    // 올라가는 목록 자체(allItems)에서 제외한다 — 카드도, 검색 결과도,
    // allTags()가 만드는 태그 필터 체크박스 목록도 이 한 곳만 고치면 전부
    // 자연히 반영된다(allTags()가 allItems만 훑기 때문).
    function recomputeAllItems() {
      var CS = global.ContentSettings;
      allItems = (!CS || CS.get().showMature)
        ? rawItems
        : rawItems.filter(function (s) { return !CS.hasMatureTag(s.tags); });
    }

    function finishItemsLoad() {
      if (countEl) countEl.textContent = config.countText(allItems.length);
      renderFilterOptions();
      renderGrid();
      startSearchPlaceholderCycle();
    }

    // 목록 본문과 태그 스냅샷은 서로 의존하지 않으니 동시에 요청하고 둘 다
    // 도착했을 때 합친다 — 태그 스냅샷이 끝나야 목록 요청을 시작하던 예전
    // 방식은 왕복 하나만큼 첫 렌더를 늦추고 있었다.
    var itemsPromise = fetch(DATA(config.dataUrl)).then(function (r) { return r.json(); });
    var snapshotPromise = config.userTags
      ? fetch('/tags/snapshot').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      : Promise.resolve(null);
    // 유저 태그 후보 목록은 postDetailSeries.js의 투표 모달이 읽는 것과 같은
    // 정적 자산이다. 실패해도 스냅샷 득표 태그만으로 필터가 그려지도록
    // 조용히 빈 배열로 넘어간다.
    var catalogPromise = config.userTags
      ? fetchJson('../data/PageData/UserTagCatalog.json')
          .then(function (list) { return Array.isArray(list) ? list : []; })
          .catch(function () { return []; })
      : Promise.resolve([]);

    Promise.all([itemsPromise, snapshotPromise, catalogPromise])
      .then(function (results) {
        rawItems = Array.isArray(results[0]) ? results[0] : [];
        if (config.userTags) {
          mergeUserTagSnapshot(results[1]);
          userTagCatalog = results[2].filter(function (t) { return typeof t === 'string'; });
        }
        recomputeAllItems();
        finishItemsLoad();
      })
      .catch(function () {});

    // 설정창에서 토글을 켜고 끌 때 새로고침 없이 바로 반영 — 이미 받아둔
    // rawItems를 다시 거르기만 하면 되므로 네트워크 재요청은 없다.
    global.addEventListener('chokaguya:content-settings-change', function () {
      if (!rawItems.length) return;
      recomputeAllItems();
      if (countEl) countEl.textContent = config.countText(allItems.length);
      renderFilterOptions();
      renderGrid();
    });

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

    // pool: 'official'(기본, s.tags) | 'user'(s.popularUserTags). config.userTags가
    // 꺼져 있는 페이지(시리즈/명예관/공식)는 항상 official만 쓴다 — 그 페이지들엔
    // popularUserTags 자체가 없으므로 자연히 빈 목록이 되어 안전하다.
    // 탭은 필터 후보 목록뿐 아니라 카드에 실제로 그려지는 태그 자체도 바꾼다
    // (createGridCard/createListCard가 tagsField(s, activePool)을 그대로 씀) —
    // "공식 태그로 볼지 유저 태그로 볼지" 페이지 전체의 보기 모드를 바꾸는
    // 토글이지, 필터 후보 목록만 왔다갔다 하는 게 아니다.
    var activePool = 'official';

    function tagsField(s, pool) {
      return ((pool || activePool) === 'user' ? s.popularUserTags : s.tags) || [];
    }

    function allTags() {
      var tagSet = {};
      allItems.forEach(function (s) {
        tagsField(s).forEach(function (t) { tagSet[t] = true; });
      });
      // 유저 태그 풀에서는 실제 득표 태그에 더해 아직 표를 받지 못한 후보까지
      // 전부 필터 옵션으로 노출한다 — 투표 초기라 스냅샷이 비어 있어도
      // 사용자가 유저 태그로 걸러볼 수 있게 한다.
      if (activePool === 'user') {
        userTagCatalog.forEach(function (t) { tagSet[t] = true; });
      }
      return sortTags(Object.keys(tagSet));
    }

    // "원하는 태그를 고르세요!" 헤더 오른쪽에 다는 공식/유저 토글 — 설정창의
    // 라이트/다크 모드 버튼(settingsModal.js)과 같은 스타일(.settings-mode-btn)을
    // 그대로 재사용하지만, 그 버튼과 달리 라벨은 "누르면 바뀔 모드"가 아니라
    // 지금 보고 있는 모드를 그대로 보여준다(태그는 "지금 뭘 보고 있는지"가
    // 헷갈리면 안 되는 필터 상태라 라이트/다크 버튼의 관례를 따르지 않기로 함).
    // 패널이 열릴 때마다 다시 그리는 옵션 목록과 달리 이 버튼은 헤더에 한 번만
    // 만들어 두고 클릭 때마다 라벨만 다시 칠한다.
    var poolToggleBtn = null;
    function setupPoolToggle() {
      if (!config.userTags || poolToggleBtn) return;
      var header = filterPanel && filterPanel.querySelector('.sfp-header');
      if (!header) return;

      poolToggleBtn = document.createElement('button');
      poolToggleBtn.type = 'button';
      poolToggleBtn.className = 'settings-mode-btn sfp-pool-toggle';
      poolToggleBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        activePool = activePool === 'official' ? 'user' : 'official';
        // 이전 풀에서 고른 체크는 새 풀에서는 의미가 없으니 초기화한다
        activeTags = {};
        updateFilterButtonState();
        paintPoolToggle();
        renderFilterOptions();
        renderGrid();
      });
      header.appendChild(poolToggleBtn);
      paintPoolToggle();
    }

    function paintPoolToggle() {
      if (!poolToggleBtn) return;
      // 지금 보고 있는 모드를 그대로 표시한다(누르면 바뀔 모드가 아니라).
      poolToggleBtn.textContent = activePool === 'official' ? '공식 태그' : '유저 태그';
    }

    function renderFilterOptions() {
      if (!optionsEl) return;
      setupPoolToggle();
      var tags = allTags();

      optionsEl.innerHTML = '';

      if (!tags.length) {
        var empty = document.createElement('div');
        empty.className = 'sfp-empty';
        empty.textContent = activePool === 'user'
          ? '아직 투표된 유저 태그가 없어요'
          : '일치하는 옵션이 없어요';
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

    var VIEW_SWITCH_MS = 180;
    var viewSwitchTimer = null;

    function applyViewMode(mode, skipRerender) {
      viewMode = mode === 'list' ? 'list' : 'grid';
      if (viewToggleBtn) {
        var toList = viewMode === 'grid';
        viewToggleBtn.innerHTML = toList ? LIST_ICON : GRID_ICON;
        viewToggleBtn.setAttribute('aria-pressed', viewMode === 'list' ? 'true' : 'false');
        viewToggleBtn.setAttribute('aria-label', toList ? '리스트로 보기' : '그리드로 보기');
        viewToggleBtn.title = toList ? '리스트로 보기' : '그리드로 보기';
      }
      global.localStorage.setItem(VIEW_MODE_KEY, viewMode);

      if (skipRerender) {
        // 페이지 로드 시 저장된 모드를 처음 반영하는 자리 — 아직 카드가
        // 하나도 없으니 페이드할 것도 없이 바로 클래스만 맞춰둔다.
        gridEl.classList.toggle('is-list-view', viewMode === 'list');
        return;
      }

      // 그리드 카드(.series-card)와 리스트 카드(.post-row)는 마크업 자체가
      // 달라 레이아웃을 직접 애니메이션할 수 없다 — 대신 살짝 페이드아웃한
      // 다음 카드를 바꿔 끼우고 다시 페이드인해서 순간적으로 확 바뀌는
      // 느낌을 없앤다. renderGrid() 자체는 캐시된 currentFiltered를 다시
      // 그리는 것뿐이라 네트워크 재요청 없이 저비용으로 끝난다.
      gridEl.classList.add('is-view-switching');
      if (viewSwitchTimer) clearTimeout(viewSwitchTimer);
      viewSwitchTimer = setTimeout(function () {
        viewSwitchTimer = null;
        gridEl.classList.toggle('is-list-view', viewMode === 'list');
        renderGrid(true);
        gridEl.classList.remove('is-view-switching');
      }, VIEW_SWITCH_MS);
    }

    if (viewToggleBtn) {
      viewToggleBtn.addEventListener('click', function () {
        applyViewMode(viewMode === 'list' ? 'grid' : 'list');
      });
    }
    applyViewMode(getStoredViewMode(), true);

    // 항상 activePool 쪽 필드(s.tags 또는 s.popularUserTags)만 본다 — 풀을
    // 바꾸면 activeTags가 초기화되므로 여기서 두 풀을 섞어 볼 일이 없다.
    function matchesActiveTags(s, activeList) {
      if (!activeList.length) return true;
      var field = tagsField(s);
      return activeList.some(function (tag) { return field.indexOf(tag) !== -1; });
    }

    function renderGrid(preserveCount) {
      var term = searchTerm.trim().toLowerCase();
      var activeList = Object.keys(activeTags);
      var filtered = allItems.filter(function (s) {
        if (!matchesSearch(s, term)) return false;
        if (!matchesActiveTags(s, activeList)) return false;
        return true;
      });

      // 그리드/리스트 뷰 전환은 검색어나 태그를 바꾸는 게 아니라 이미 보고
      // 있던 결과를 다른 카드로 다시 그리는 것뿐이다 — 스크롤로 100개,
      // 150개까지 불러온 상태에서 전환했는데 매번 처음 PAGE_SIZE개로
      // 되돌아가면 그때마다 "Loading" 스피너가 다시 뜨는 것처럼 보인다.
      // preserveCount가 true면 전환 전까지 그려져 있던 개수만큼 그대로
      // 이어서 그린다(다시 fetch하는 게 아니라 캐시된 currentFiltered를
      // 더 많이 append하는 것뿐이라 비용은 그대로 저렴하다).
      var priorCount = preserveCount ? renderedCount : 0;

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
      while (renderedCount < priorCount && renderedCount < currentFiltered.length) {
        appendNextPage();
      }
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
      if (hasAudioNovel(s)) {
        image.appendChild(createAudioRibbon());
        card.classList.add('is-audio-novel');
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
      count.textContent = countLine(s);
      info.appendChild(count);

      var tagsWrap = document.createElement('div');
      tagsWrap.className = 'series-card-tags';
      // 4개째부터는 2줄로 넘어가면서 형제 카드와 높이가 어긋나므로 3개까지만 보여준다
      sortTags(tagsField(s)).slice(0, 3).forEach(function (tag) {
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
          favType: config.favType,
          postId: favId,
          tags: s.tags,
          episodes: (s.posts || []).map(function (post) {
            return {
              title: post.title,
              dcId: post.id,
              link: post.link,
              reader: post.reader,
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
      if (hasAudioNovel(s)) {
        image.appendChild(createAudioRibbon());
        card.classList.add('is-audio-novel');
      }
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
      sortTags(tagsField(s)).slice(0, 3).forEach(function (tag) {
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
          favType: config.favType,
          postId: favId,
          tags: s.tags,
          episodes: (s.posts || []).map(function (post) {
            return {
              title: post.title,
              dcId: post.id,
              link: post.link,
              reader: post.reader,
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
