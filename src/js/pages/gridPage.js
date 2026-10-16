/**
 * ChoKaguya Grid Page
 * - Shared implementation behind 시리즈 / 명예관 / 공식 — the three pages had
 *   ~95% identical scripts, so they now pass their differences in as config
 *   and this file owns the behaviour.
 * - Config: { dataUrl, favType, countText(n), emptyText, countLine(s), filterItems(items) }
 *   countLine 을 생략하면 SeriesUtil.countLine (자식 글이 2개 이상이면 시리즈로
 *   보고 화수, 아니면 글자 수) 을 씁니다.
 */
(function (global) {
  var t = global.I18n.t;
  var CHECK_ICON = '<svg viewBox="0 0 10 10" fill="none"><path d="M1.5 5L4 7.5L8.5 2.5" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // 태그 색상/이모지/정렬 — tagConfig.js(mainPage.js와 공유하는 단일 소스)로 옮김
  var TAG_EMOJI = global.TagConfig.TAG_EMOJI;
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
    // 화와 따로 붙은 오디오 목록(Official.json 소설판의 audio)도 오디오 작품이다
    if (s && s.audio && s.audio.length) return true;
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
    label.textContent = t('오디오노벨');
    ribbon.appendChild(icon);
    ribbon.appendChild(label);
    return ribbon;
  }

  // 두 설정 객체를 얕게 합친다 — sources 를 쓰는 페이지(문학·번역 통합)가
  // 공통 설정 위에 탭별 설정을 덮어쓸 때 쓴다.
  function extend(base, override) {
    var out = {};
    var k;
    for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
    for (k in override) if (Object.prototype.hasOwnProperty.call(override, k)) out[k] = override[k];
    return out;
  }

  // baseConfig.sources 가 있으면 한 페이지 안에서 데이터 소스(탭)를 바꿔 낄 수
  // 있다: { sources: { novel: {...}, translation: {...} }, initialSource: 'novel' }.
  // 각 탭 설정은 dataUrl/favType/userTags/userTagsOnly/countText/emptyText 등
  // 단일 페이지 config 와 같은 키를 쓰고, 전환은 반환값의 setSource(key)로 한다.
  // 검색창·필터·보기 전환 버튼의 이벤트는 처음 한 번만 걸고, 탭을 바꿀 때는
  // 목록과 태그 상태만 갈아 끼운다.
  function create(baseConfig) {
    baseConfig = baseConfig || {};
    var sources = baseConfig.sources || null;
    var sourceKey = sources ? (baseConfig.initialSource || Object.keys(sources)[0]) : null;
    var config = sources ? extend(baseConfig, sources[sourceKey]) : baseConfig;

    var searchInput = document.getElementById('series-search-input');
    var filterBtn = document.getElementById('series-filter-btn');
    var filterPanel = document.getElementById('series-filter-panel');
    var optionsEl = document.getElementById('series-filter-options');
    var gridEl = document.getElementById('series-grid');
    var countEl = document.getElementById('series-count');
    var viewToggleBtn = document.getElementById('series-view-toggle-btn');
    if (!gridEl) return;

    function countLine(s) {
      return (config.countLine || global.SeriesUtil.countLine)(s);
    }

    // config.userTags 는 공식/유저 태그 토글을 다는 탭(문학)이,
    // config.userTagsOnly 는 유저 태그만 쓰는 탭(번역 — 공식 AI 태그를
    // 지원하지 않는다)이 켠다. 스냅샷·후보 목록을 받아야 하는지, 유저 태그
    // 관련 코드 경로를 태울지는 둘 중 하나라도 켜져 있으면 되므로 여기서
    // 하나로 묶는다. userTagsOnly 는 추가로 activePool 을 처음부터 'user' 로
    // 고정하고 공식/유저 토글 버튼을 숨긴다.
    function wantUserTags() {
      return !!(config.userTags || config.userTagsOnly);
    }

    var rawItems = [];
    var allItems = [];
    var activeTags = {};
    var searchTerm = '';
    var viewMode = 'grid';
    var gridStyle = 'classic';

    var PAGE_SIZE = 50;
    var currentFiltered = [];
    var renderedCount = 0;
    var isLoadingMore = false;
    var loadMoreObserver = null;
    var sentinelEl = null;

    // versioned URL so the browser may cache these normally (see cdnConfig.js)
    var DATA = global.dataUrl || function (p) { return p; };
    // 공식 태그 덮어쓰기(cdnConfig.js)를 적용해 pageData JSON 을 새로 받는다.
    var fetchPageData = global.fetchPageData || function (p) { return fetch(DATA(p)).then(function (r) { return r.json(); }); };
    var fetchJson = global.fetchJsonCached || function (p) { return fetch(DATA(p)).then(function (r) { return r.json(); }); };

    // MiniLoading (Figma #2183:2) shows a random 후시 mascot gif per sentinel.
    // The full-page loader uses the mirror ball (mirrorBall.js) instead, so
    // these gifs are only used here.
    var miniLoadingIcons = [];
    fetchJson('../data/config/LoadingIcons.json')
      .then(function (files) { if (Array.isArray(files)) miniLoadingIcons = files; })
      .catch(function () {});

    // 유저 태그 투표 스냅샷 병합(wantUserTags 인 페이지만 — 문학은 config.userTags,
    // 번역은 config.userTagsOnly 로 켠다).
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

    // 태그 스냅샷과 후보 목록은 탭과 무관하게 같은 자원이라 페이지당 한 번만
    // 받는다. 유저 태그를 쓰는 탭이 처음 열릴 때 요청을 시작한다.
    var snapshotPromise = null;
    var catalogPromise = null;
    function loadUserTagAssets() {
      if (!snapshotPromise) {
        snapshotPromise = fetch('/tags/snapshot')
          .then(function (r) { return r.ok ? r.json() : null; })
          .catch(function () { return null; });
        // 유저 태그 후보 목록은 postDetailSeries.js의 투표 모달이 읽는 것과 같은
        // 정적 자산이다. 실패해도 스냅샷 득표 태그만으로 필터가 그려지도록
        // 조용히 빈 배열로 넘어간다.
        catalogPromise = fetchJson('../data/pageData/UserTagCatalog.json')
          .then(function (list) { return Array.isArray(list) ? list : []; })
          .catch(function () { return []; });
      }
      return Promise.all([snapshotPromise, catalogPromise]);
    }

    // 탭별로 한 번 받아 가공한 목록을 보관한다. 문학 ↔ 번역을 오갈 때 같은
    // 목록을 다시 받거나 스냅샷을 다시 병합하지 않는다.
    var sourceCache = {};
    var loadToken = 0;

    function loadItems() {
      var token = ++loadToken;
      var cacheKey = sourceKey || '_';
      if (sourceCache[cacheKey]) {
        rawItems = sourceCache[cacheKey].rawItems;
        userTagCatalog = sourceCache[cacheKey].userTagCatalog;
        recomputeAllItems();
        finishItemsLoad();
        return;
      }

      // 목록 본문과 태그 스냅샷은 서로 의존하지 않으니 동시에 요청하고 둘 다
      // 도착했을 때 합친다 — 태그 스냅샷이 끝나야 목록 요청을 시작하던 예전
      // 방식은 왕복 하나만큼 첫 렌더를 늦추고 있었다.
      var itemsPromise = fetchPageData(config.dataUrl);
      var tagAssetsPromise = wantUserTags() ? loadUserTagAssets() : Promise.resolve([null, []]);

      Promise.all([itemsPromise, tagAssetsPromise])
        .then(function (results) {
          // 응답을 기다리는 사이 다른 탭으로 바뀌었으면 버린다.
          if (token !== loadToken) return;
          rawItems = Array.isArray(results[0]) ? results[0] : [];
          userTagCatalog = [];
          // config.filterItems 는 같은 데이터 파일에서 일부만 보여주는 페이지
          // (대회 — Novel.json 중 해당 대회 참가작만)가 넘긴다. 태그 스냅샷
          // 병합과 후방주의 필터보다 먼저 걸러야 카운트·태그 필터 후보도 그
          // 부분집합 기준으로 계산된다.
          if (config.filterItems) rawItems = config.filterItems(rawItems);
          if (wantUserTags()) {
            mergeUserTagSnapshot(results[1][0]);
            userTagCatalog = results[1][1].filter(function (t) { return typeof t === 'string'; });
          }
          sourceCache[cacheKey] = { rawItems: rawItems, userTagCatalog: userTagCatalog };
          recomputeAllItems();
          finishItemsLoad();
        })
        .catch(function () {});
    }

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
    // 탭을 바꾸면 finishItemsLoad()가 다시 불리지만 타이머·관찰자는 처음 한
    // 번만 만든다. 이름 목록은 cycle()이 돌 때마다 지금 탭의 allItems 에서
    // 새로 섞도록 order 만 비워 둔다.
    var placeholderCycleStarted = false;
    var placeholderOrder = null;
    function startSearchPlaceholderCycle() {
      if (!searchInput || !allItems.length) return;
      placeholderOrder = null;
      if (placeholderCycleStarted) return;
      placeholderCycleStarted = true;
      function freshOrder() { return shuffle(allItems.map(function (s) { return s.name; })); }
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
        if (!placeholderOrder || idx >= placeholderOrder.length) { placeholderOrder = freshOrder(); idx = 0; }
        if (!placeholderOrder.length) { running = false; return; }
        var name = placeholderOrder[idx];
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
    // config.userTagsOnly(번역)는 공식 태그 자체가 없으므로 처음부터 'user'로
    // 고정하고, 아래 setupPoolToggle 은 토글 버튼을 숨긴다.
    var activePool = config.userTagsOnly ? 'user' : 'official';

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
    // userTagsOnly 탭(번역)은 전환할 공식 풀이 없으므로 토글을 숨긴다.
    function hasPoolToggle() {
      return !!(config.userTags && !config.userTagsOnly);
    }
    function setupPoolToggle() {
      if (poolToggleBtn) { paintPoolToggle(); return; }
      if (!hasPoolToggle()) return;
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
      // .settings-mode-btn 의 display 지정이 [hidden] 보다 우선하므로 직접 끈다.
      poolToggleBtn.style.display = hasPoolToggle() ? '' : 'none';
      // 지금 보고 있는 모드를 그대로 표시한다(누르면 바뀔 모드가 아니라).
      poolToggleBtn.textContent = activePool === 'official' ? t('공식 태그') : t('유저 태그');
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
          ? t('아직 투표된 유저 태그가 없어요')
          : t('일치하는 옵션이 없어요');
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

    // 그리드/리스트 보기와 그리드 카드 모양 — viewSettings.js 가 저장해서
    // 다른 페이지(탭)로 이동해도 유지되고, 설정창 보기 탭에서 바꿔도 이벤트로
    // 곧바로 다시 그린다. 아이콘은 theme.js의 테마 토글 버튼과 같은 관례로
    // "누르면 바뀔 모드"를 보여준다(현재 상태 아이콘이 아님).
    var GRID_ICON = '<svg viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="1.5" y="1.5" width="6.5" height="6.5" rx="1.5" stroke="currentColor" stroke-width="1.5"/><rect x="10" y="1.5" width="6.5" height="6.5" rx="1.5" stroke="currentColor" stroke-width="1.5"/><rect x="1.5" y="10" width="6.5" height="6.5" rx="1.5" stroke="currentColor" stroke-width="1.5"/><rect x="10" y="10" width="6.5" height="6.5" rx="1.5" stroke="currentColor" stroke-width="1.5"/></svg>';
    var LIST_ICON = '<svg viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="1.5" y="2" width="15" height="3.5" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="1.5" y="7.25" width="15" height="3.5" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="1.5" y="12.5" width="15" height="3.5" rx="1" stroke="currentColor" stroke-width="1.5"/></svg>';
    var ViewSettings = global.ViewSettings;

    var VIEW_SWITCH_MS = 180;
    var viewSwitchTimer = null;

    function paintViewToggle() {
      if (!viewToggleBtn) return;
      var toList = viewMode === 'grid';
      viewToggleBtn.innerHTML = toList ? LIST_ICON : GRID_ICON;
      viewToggleBtn.setAttribute('aria-pressed', viewMode === 'list' ? 'true' : 'false');
      viewToggleBtn.setAttribute('aria-label', toList ? t('리스트로 보기') : t('그리드로 보기'));
      viewToggleBtn.title = toList ? t('리스트로 보기') : t('그리드로 보기');
    }

    // 카드 모양마다 열 수와 간격이 달라서(series-card.css 의 is-grid-*)
    // 컨테이너 클래스도 함께 바꿔 끼운다. 리스트일 때는 어느 모양도 붙이지
    // 않는다.
    function syncContainerClasses() {
      gridEl.classList.toggle('is-list-view', viewMode === 'list');
      (ViewSettings ? ViewSettings.GRID_STYLES : []).forEach(function (style) {
        gridEl.classList.toggle('is-grid-' + style, viewMode === 'grid' && gridStyle === style);
      });
    }

    function applyView(mode, style, skipRerender) {
      viewMode = mode === 'list' ? 'list' : 'grid';
      gridStyle = style || gridStyle;
      paintViewToggle();
      if (ViewSettings) ViewSettings.setViewMode(viewMode);

      if (skipRerender || !allItems.length) {
        // 페이지 로드 시 저장된 모드를 처음 반영하거나 아직 목록을 받기
        // 전이라 카드가 하나도 없는 자리 — 페이드할 것도 없이 바로 클래스만
        // 맞춰둔다.
        syncContainerClasses();
        return;
      }

      // 그리드 카드와 리스트 카드는 마크업 자체가 달라 레이아웃을 직접
      // 애니메이션할 수 없다 — 대신 살짝 페이드아웃한 다음 카드를 바꿔
      // 끼우고 다시 페이드인해서 순간적으로 확 바뀌는 느낌을 없앤다.
      // renderGrid() 자체는 캐시된 currentFiltered를 다시 그리는 것뿐이라
      // 네트워크 재요청 없이 저비용으로 끝난다.
      gridEl.classList.add('is-view-switching');
      if (viewSwitchTimer) clearTimeout(viewSwitchTimer);
      viewSwitchTimer = setTimeout(function () {
        viewSwitchTimer = null;
        syncContainerClasses();
        renderGrid(true);
        gridEl.classList.remove('is-view-switching');
      }, VIEW_SWITCH_MS);
    }

    if (viewToggleBtn) {
      viewToggleBtn.addEventListener('click', function () {
        applyView(viewMode === 'list' ? 'grid' : 'list');
      });
    }
    // 설정창 보기 탭에서 바꾼 값 — 툴바 버튼으로 바꾼 값도 같은 이벤트가
    // 돌아오지만, 이미 반영된 값이라 아래 비교에서 걸러진다.
    global.addEventListener('chokaguya:view-settings-change', function (e) {
      var next = e.detail || {};
      if (next.viewMode === viewMode && next.gridStyle === gridStyle) return;
      applyView(next.viewMode, next.gridStyle);
    });
    if (ViewSettings) applyView(ViewSettings.getViewMode(), ViewSettings.getGridStyle(), true);
    else applyView('grid', 'classic', true);

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
        // served from the origin, not R2 — offlineSrc/loadingLogo/
        icon.style.backgroundImage = 'url("../offlineSrc/loadingLogo/' + pick + '")';
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

    // ---- 카드 공용 부품 ----
    // 그리드 카드 네 가지 모양과 리스트(게시판형) 행이 썸네일·버튼·태그·상세
    // 열기를 똑같이 쓰도록 여기 모아 둔다.

    // 썸네일 칠하기. 이미지가 없는 작품은 제목·작가를 올린 책 표지 모양으로
    // 자리를 채운다. withText 가 false 면 색과 이모지만 깐다 — 제목이 이미
    // 표지 위나 바로 옆에 따로 있는 카드에서 같은 제목이 두 번 보이지 않게.
    function fillThumb(image, s, withText) {
      if (s.image) {
        // cards show the 600px thumbnail, never the full-size original
        if (global.lazyLoadBackground) {
          global.lazyLoadBackground(image, s.image);
        } else {
          var finalImg = global.resolveThumbUrl ? global.resolveThumbUrl(s.image) : s.image;
          image.style.backgroundImage = 'url("' + finalImg + '")';
        }
      } else if (global.TagConfig.applyTextCover) {
        global.TagConfig.applyTextCover(image, {
          name: s.name,
          author: s.author,
          tags: (s.tags && s.tags.length) ? s.tags : s.popularUserTags,
          text: withText !== false
        });
      }
    }

    function favIdOf(s) {
      return s.posts && s.posts[0] && s.posts[0].id;
    }

    // 북마크·끌올 버튼. 그림 위에 띄우는 카드는 series-card.css 의 절대
    // 위치를 그대로 쓰고, 리스트·컴팩트처럼 버튼 칸이 따로 있는 카드는
    // 그 칸의 CSS 가 위치를 풀어 한 줄로 늘어놓는다.
    function appendActions(parent, s) {
      var favId = favIdOf(s);
      if (favId == null) return;
      parent.appendChild(global.BookmarkPicker.createButton(config.favType, favId));
      if (global.BumpButton) parent.appendChild(global.BumpButton.createButton(config.favType, favId, s.name));
    }

    // 리본이 들어갈 자리가 없는 새 카드 모양에서 쓰는 작은 오디오 노벨 표시
    function createAudioChip() {
      var chip = document.createElement('span');
      chip.className = 'audio-novel-chip';
      chip.textContent = '🎧 ' + t('오디오노벨');
      return chip;
    }

    function createTagPills(s, max, className) {
      var wrap = document.createElement('div');
      wrap.className = className;
      // 4개째부터는 2줄로 넘어가면서 형제 카드와 높이가 어긋나므로 정해진 개수까지만 보여준다
      sortTags(tagsField(s)).slice(0, max).forEach(function (tag) {
        var pill = document.createElement('span');
        pill.className = 'series-card-tag';
        pill.dataset.tag = tag;
        pill.textContent = (TAG_EMOJI[tag] || DEFAULT_EMOJI) + ' ' + tag;
        wrap.appendChild(pill);
      });
      return wrap;
    }

    // 작가 이름은 친목 방지를 위해 앞 두 글자만 보여 준다(tagConfig.js
    // maskAuthor). 시리즈·공식처럼 데이터에 작가가 없는 탭은 빈 문자열이다.
    function maskedAuthor(s) {
      return s.author && global.TagConfig.maskAuthor ? global.TagConfig.maskAuthor(s.author) : '';
    }

    // "별바*** · 2,042자" 처럼 작가와 화수/글자 수를 한 줄로 잇는다.
    function createMetaLine(s, className) {
      var meta = document.createElement('p');
      meta.className = className;
      var author = maskedAuthor(s);
      if (author) {
        var who = document.createElement('span');
        who.className = 'card-meta-author';
        who.textContent = author;
        meta.appendChild(who);
        var dot = document.createElement('span');
        dot.className = 'card-meta-dot';
        dot.setAttribute('aria-hidden', 'true');
        dot.textContent = '·';
        meta.appendChild(dot);
      }
      var count = document.createElement('span');
      count.className = 'card-meta-count';
      count.textContent = countLine(s);
      meta.appendChild(count);
      return meta;
    }

    function textEl(tag, className, text) {
      var node = document.createElement(tag);
      node.className = className;
      node.textContent = text;
      return node;
    }

    function bindOpenDetail(card, s) {
      card.addEventListener('click', function () {
        if (!global.PostDetailSeries) return;
        PostDetailSeries.open({
          seriesName: s.name,
          imageUrl: s.image,
          favType: config.favType,
          postId: favIdOf(s),
          tags: s.tags,
          audio: s.audio,
          episodes: (s.posts || []).map(function (post) {
            return {
              title: post.title,
              dcId: post.id,
              link: post.link,
              reader: post.reader,
              episodeLabel: t('{n} 화', { n: post.episode })
            };
          })
        });
      });
    }

    function createGridCard(s) {
      if (gridStyle === 'cover') return createCoverCard(s);
      if (gridStyle === 'magazine') return createMagazineCard(s);
      if (gridStyle === 'compact') return createCompactCard(s);
      return createClassicCard(s);
    }

    // 기본: 가로 배너 이미지 아래에 제목·화수·태그를 쌓는 원래 카드
    function createClassicCard(s) {
      var card = document.createElement('article');
      card.className = 'series-card';

      var image = document.createElement('div');
      image.className = 'series-card-image';
      fillThumb(image, s, true);
      appendActions(image, s);
      if (hasAudioNovel(s)) {
        image.appendChild(createAudioRibbon());
        card.classList.add('is-audio-novel');
      }
      card.appendChild(image);

      var info = document.createElement('div');
      info.className = 'series-card-info';
      info.appendChild(textEl('p', 'series-card-title', s.name));
      info.appendChild(textEl('p', 'series-card-count', countLine(s)));
      info.appendChild(createTagPills(s, 3, 'series-card-tags'));
      card.appendChild(info);

      bindOpenDetail(card, s);
      return card;
    }

    // 표지형: 세로 3:4 카드에 그림을 꽉 채우고, 아래쪽 그늘 위에 태그·제목·
    // 작가를 얹는다. 크롤링된 그림 대부분이 정사각형이라 가로 배너보다 훨씬
    // 덜 잘린다. 그림을 감싼 칸(.grid-cover-media)만 확대되도록 따로 둔다.
    function createCoverCard(s) {
      var card = document.createElement('article');
      card.className = 'grid-cover-card';
      if (!s.image) card.classList.add('is-text-cover');

      var media = document.createElement('div');
      media.className = 'grid-cover-media';
      fillThumb(media, s, false);
      card.appendChild(media);
      card.appendChild(textEl('div', 'grid-cover-shade', ''));

      appendActions(card, s);
      if (hasAudioNovel(s)) {
        card.appendChild(createAudioChip());
        card.classList.add('is-audio-novel');
      }

      var body = document.createElement('div');
      body.className = 'grid-cover-body';
      var tags = document.createElement('div');
      tags.className = 'grid-cover-tags';
      sortTags(tagsField(s)).slice(0, 2).forEach(function (tag) {
        tags.appendChild(textEl('span', 'grid-cover-tag', (TAG_EMOJI[tag] || DEFAULT_EMOJI) + ' ' + tag));
      });
      body.appendChild(tags);
      body.appendChild(textEl('p', 'grid-cover-title', s.name));
      body.appendChild(createMetaLine(s, 'grid-cover-meta'));
      card.appendChild(body);

      bindOpenDetail(card, s);
      return card;
    }

    // 매거진형: 테두리 없는 정사각형 그림 아래에 태그 색 점, 두 줄 제목,
    // 작가와 화수/글자 수를 기사 목록처럼 둔다.
    function createMagazineCard(s) {
      var card = document.createElement('article');
      card.className = 'grid-mag-card';

      var frame = document.createElement('div');
      frame.className = 'grid-mag-frame';
      var media = document.createElement('div');
      media.className = 'grid-mag-media';
      fillThumb(media, s, false);
      frame.appendChild(media);
      appendActions(frame, s);
      if (hasAudioNovel(s)) {
        frame.appendChild(createAudioChip());
        card.classList.add('is-audio-novel');
      }
      card.appendChild(frame);

      var kicker = document.createElement('div');
      kicker.className = 'grid-mag-tags';
      sortTags(tagsField(s)).slice(0, 3).forEach(function (tag) {
        var item = textEl('span', 'grid-mag-tag', tag);
        // 색이 정해진 태그만 CSS 변수 이름으로 쓸 수 있다(유저 태그는 임의 문자열).
        // 관리 페이지에서 정의한 태그의 색도 glowValue 가 함께 처리한다.
        item.style.setProperty('--dot-color', global.TagConfig.glowValue(tag));
        kicker.appendChild(item);
      });
      card.appendChild(kicker);

      card.appendChild(textEl('p', 'grid-mag-title', s.name));
      card.appendChild(createMetaLine(s, 'grid-mag-meta'));

      bindOpenDetail(card, s);
      return card;
    }

    // 컴팩트 타일: 작은 정사각형 썸네일과 글을 가로로 놓은 타일. 그림보다
    // 제목 위주로 훑어볼 때 한 화면에 가장 많이 들어온다.
    function createCompactCard(s) {
      var card = document.createElement('article');
      card.className = 'grid-compact-card';
      if (hasAudioNovel(s)) card.classList.add('is-audio-novel');

      var thumb = document.createElement('div');
      thumb.className = 'grid-compact-thumb';
      fillThumb(thumb, s, false);
      card.appendChild(thumb);

      var body = document.createElement('div');
      body.className = 'grid-compact-body';
      body.appendChild(textEl('p', 'grid-compact-title', s.name));
      var meta = createMetaLine(s, 'grid-compact-meta');
      if (hasAudioNovel(s)) meta.appendChild(createAudioChip());
      body.appendChild(meta);
      body.appendChild(createTagPills(s, 2, 'grid-compact-tags'));
      card.appendChild(body);

      var actions = document.createElement('div');
      actions.className = 'card-inline-actions';
      appendActions(actions, s);
      card.appendChild(actions);

      bindOpenDetail(card, s);
      return card;
    }

    // 리스트(게시판형) — 썸네일, 제목과 태그, 작가, 화수/글자 수, 버튼을
    // 열로 맞춘 촘촘한 행. 모바일에서는 작가와 글자 수를 제목 아래 한 줄로
    // 내린다. 북마크·끌올 버튼은 그림을 가리지 않게 행 끝 칸에 둔다.
    function createListCard(s) {
      var card = document.createElement('article');
      card.className = 'post-board-row';
      if (hasAudioNovel(s)) card.classList.add('is-audio-novel');

      var thumb = document.createElement('div');
      thumb.className = 'post-board-thumb';
      fillThumb(thumb, s, false);
      card.appendChild(thumb);

      var main = document.createElement('div');
      main.className = 'post-board-main';
      var title = document.createElement('p');
      title.className = 'post-board-title';
      title.appendChild(textEl('span', 'post-board-name', s.name));
      if (hasAudioNovel(s)) title.appendChild(createAudioChip());
      main.appendChild(title);
      main.appendChild(createTagPills(s, 3, 'post-board-tags'));
      main.appendChild(createMetaLine(s, 'post-board-sub'));
      card.appendChild(main);

      card.appendChild(textEl('span', 'post-board-author', maskedAuthor(s)));
      card.appendChild(textEl('span', 'post-board-count', countLine(s)));

      var actions = document.createElement('div');
      actions.className = 'card-inline-actions';
      appendActions(actions, s);
      card.appendChild(actions);

      bindOpenDetail(card, s);
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

    // 탭 전환 — 태그 선택과 공식/유저 풀은 탭마다 의미가 달라 초기화하고,
    // 검색어와 보기 모드(그리드/리스트)는 그대로 이어 간다.
    function setSource(key) {
      if (!sources || !sources[key] || key === sourceKey) return;
      sourceKey = key;
      config = extend(baseConfig, sources[key]);
      activePool = config.userTagsOnly ? 'user' : 'official';
      activeTags = {};
      rawItems = [];
      allItems = [];
      closeFilterPanel();
      updateFilterButtonState();
      paintPoolToggle();
      if (searchInput && config.searchPlaceholder) searchInput.placeholder = config.searchPlaceholder;
      if (countEl) countEl.textContent = '';
      if (global.unobserveAllLazy) global.unobserveAllLazy();
      if (loadMoreObserver) loadMoreObserver.disconnect();
      sentinelEl = null;
      gridEl.innerHTML = '';
      loadItems();
    }

    loadItems();

    return {
      setSource: setSource,
      getSource: function () { return sourceKey; }
    };
  }

  global.GridPage = { create: create };
})(window);
