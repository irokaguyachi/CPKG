/**
 * ChoKaguya Site Header (2단 헤더 — src/css/layout/site-header.css)
 * - 1행: 로고 · 통합 검색 · 라이트/다크 전환 · 프로필(계정 메뉴)
 * - 2행: 페이지 메뉴(지금 페이지에 밑줄) · "설정" 버튼(settingsModal.js 가
 *   data-settings-trigger 로 클릭을 처리한다)
 * - 통합 검색은 문학·번역·시리즈·명예관·공식을 한 번에 찾는다. 데이터는
 *   북마크 상세와 끌올 위젯이 쓰는 Lookup.json 하나를 fetchJsonCached 로
 *   공유하고, 검색창에 처음 포커스가 갈 때 받는다(첫 화면 로딩을 늘리지
 *   않도록). 결과를 고르면 목록 카드와 같은 상세 팝업(PostDetailSeries)을
 *   바로 연다.
 * - 프로필 메뉴는 로그인 / 동기화(서버에 저장·불러오기) / 로그아웃을 담는다.
 *   실제 동작은 auth.js·authModal.js·userData.js·bookmarkLibrary.js 의 기존
 *   함수를 그대로 부르고, 'chokaguya:auth-change'·'chokaguya:sync-state'
 *   이벤트를 들어 다시 그린다.
 */
(function (global) {
  var t = global.I18n.t;
  var headerEl = document.querySelector('.site-header');
  if (!headerEl) return;

  var ICONS = {
    person: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="8" r="4.2"/><path d="M3.5 21.5c0-4.7 3.8-8 8.5-8s8.5 3.3 8.5 8z"/></svg>',
    cloudUp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18a4.5 4.5 0 0 1-.5-8.97A6 6 0 0 1 18 8.5a4 4 0 0 1-.5 9.5"/><path d="M12 12v8"/><path d="m9 15 3-3 3 3"/></svg>',
    cloudDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18a4.5 4.5 0 0 1-.5-8.97A6 6 0 0 1 18 8.5a4 4 0 0 1-.5 9.5"/><path d="M12 12v8"/><path d="m9 17 3 3 3-3"/></svg>',
    key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8"/><path d="m17 6 3 3"/><path d="m14.5 8.5 2 2"/></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>',
    login: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/></svg>'
  };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // ── 지금 페이지 메뉴에 밑줄 ────────────────────────────────────────────
  function normalizePath(path) {
    path = (path || '/').replace(/\/+$/, '') || '/';
    return path === '/main' ? '/' : path;
  }

  // 메뉴에 자기 주소가 없는 하위 페이지(오디오 노벨 리더 → 공식)는
  // <body data-nav-path="/official"> 로 밑줄을 칠 메뉴를 지정한다.
  function markActiveNav() {
    var here = normalizePath(document.body.getAttribute('data-nav-path') || global.location.pathname);
    headerEl.querySelectorAll('.site-nav-link').forEach(function (link) {
      var target = normalizePath(new URL(link.href, global.location.href).pathname);
      var active = target === here;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  // ── 라이트 | 다크 ─────────────────────────────────────────────────────
  var themeButtons = headerEl.querySelectorAll('[data-theme-set]');

  function paintThemeSwitch() {
    var current = global.ThemeManager ? global.ThemeManager.getTheme() : 'light';
    themeButtons.forEach(function (btn) {
      var active = btn.getAttribute('data-theme-set') === current;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  themeButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var next = btn.getAttribute('data-theme-set');
      if (!global.ThemeManager || global.ThemeManager.getTheme() === next) return;
      global.ThemeManager.setTheme(next, true);
    });
  });
  global.addEventListener('chokaguya:theme-change', paintThemeSwitch);

  // ── 프로필 메뉴 ────────────────────────────────────────────────────────
  var profileBtn = headerEl.querySelector('.site-profile-btn');
  var profileMenu = headerEl.querySelector('.site-profile-menu');
  var buttonAvatar = profileBtn && profileBtn.querySelector('.site-avatar');
  var buttonDot = profileBtn && profileBtn.querySelector('.site-sync-dot');

  function isLoggedIn() {
    return !!(global.BookmarkLibrary && global.BookmarkLibrary.isLoggedIn());
  }

  function syncState() {
    return (global.UserData && global.UserData.getStatus()) || 'offline';
  }

  function syncLabel(state) {
    return global.AuthUI && global.AuthUI.syncStateLabel ? global.AuthUI.syncStateLabel(state) : state;
  }

  // 20자리 개인 코드는 메뉴에 그대로 노출하지 않는다 — 앞 다섯 자리만 보여
  // 어느 계정인지 알아볼 수 있게 하고, 전체 코드는 설정창 계정 탭에서 본다.
  function maskedCode() {
    var code = (global.BookmarkLibrary && global.BookmarkLibrary.getPersonalCode()) || '';
    if (!code) return '';
    return code.slice(0, 5) + '-•••••-•••••-•••••';
  }

  function makeAvatar(loggedIn) {
    var avatar = el('span', 'site-avatar' + (loggedIn ? ' is-logged-in' : ''));
    avatar.innerHTML = ICONS.person;
    return avatar;
  }

  function paintProfileButton() {
    if (!profileBtn) return;
    var loggedIn = isLoggedIn();
    if (buttonAvatar) buttonAvatar.classList.toggle('is-logged-in', loggedIn);
    if (buttonDot) {
      buttonDot.hidden = !loggedIn;
      buttonDot.className = 'site-sync-dot is-' + syncState();
    }
    var label = loggedIn ? t('계정 메뉴 · {status}', { status: syncLabel(syncState()) }) : t('계정 메뉴 · 로그인하지 않음');
    profileBtn.setAttribute('aria-label', label);
    profileBtn.title = loggedIn ? syncLabel(syncState()) : t('로그인');
  }

  function menuLink(icon, label, onClick, variant) {
    var btn = el('button', 'site-profile-link' + (variant ? ' ' + variant : ''));
    btn.type = 'button';
    btn.setAttribute('role', 'menuitem');
    btn.innerHTML = icon;
    btn.appendChild(el('span', null, label));
    btn.addEventListener('click', onClick);
    return btn;
  }

  function settingsButton(label, variant) {
    var btn = el('button', 'settings-btn' + (variant ? ' ' + variant : ''), label);
    btn.type = 'button';
    return btn;
  }

  function renderProfileMenu() {
    if (!profileMenu) return;
    profileMenu.innerHTML = '';
    var loggedIn = isLoggedIn();

    var head = el('div', 'site-profile-head');
    head.appendChild(makeAvatar(loggedIn));
    var headText = el('div', 'site-profile-head-text');
    headText.appendChild(el('p', 'site-profile-title', loggedIn ? t('로그인됨') : t('로그인하지 않았어요')));
    headText.appendChild(el('p', 'site-profile-sub', loggedIn ? maskedCode() : t('게스트')));
    head.appendChild(headText);
    profileMenu.appendChild(head);

    if (!loggedIn) {
      profileMenu.appendChild(el('p', 'site-profile-desc', t('로그인하면 북마크를 다른 기기와 동기화할 수 있어요.')));
      var loginBtn = settingsButton(t('로그인'), 'is-primary');
      loginBtn.setAttribute('role', 'menuitem');
      loginBtn.addEventListener('click', function () {
        closeProfileMenu();
        if (global.AuthModal) global.AuthModal.openSignIn({});
      });
      profileMenu.appendChild(loginBtn);
    } else {
      // 동기화 — 자동 동기화가 없으므로(userData.js) 두 버튼이 곧 동기화다.
      var sync = el('div', 'site-profile-sync');
      var state = syncState();
      var status = el('p', 'site-profile-sync-status');
      status.appendChild(el('span', 'site-sync-dot is-' + state));
      status.appendChild(el('span', null, syncLabel(state)));
      sync.appendChild(status);

      var actions = el('div', 'site-profile-sync-actions');
      var saveBtn = settingsButton(t('서버에 저장'), 'is-primary');
      saveBtn.title = t('이 기기 → 서버에 저장');
      saveBtn.setAttribute('role', 'menuitem');
      saveBtn.addEventListener('click', function () { if (global.UserData) global.UserData.saveToServer(); });
      var loadBtn = settingsButton(t('불러오기'));
      loadBtn.title = t('서버 → 이 기기로 불러오기');
      loadBtn.setAttribute('role', 'menuitem');
      loadBtn.addEventListener('click', function () { if (global.UserData) global.UserData.loadFromServer(); });
      var busy = state === 'syncing';
      saveBtn.disabled = busy;
      loadBtn.disabled = busy;
      actions.appendChild(saveBtn);
      actions.appendChild(loadBtn);
      sync.appendChild(actions);
      profileMenu.appendChild(sync);

      var links = el('div', 'site-profile-links');
      links.appendChild(menuLink(ICONS.key, t('개인 코드 보기'), function () {
        closeProfileMenu();
        if (global.SettingsModal) global.SettingsModal.open('account');
      }));
      links.appendChild(menuLink(ICONS.logout, t('로그아웃'), function () {
        closeProfileMenu();
        if (global.AuthUI && global.AuthUI.confirmAndLogout) global.AuthUI.confirmAndLogout();
      }, 'is-danger'));
      profileMenu.appendChild(links);
    }

    var foot = el('div', 'site-profile-foot');
    if (global.AuthUI && global.AuthUI.renderVersionTag) global.AuthUI.renderVersionTag(foot);
    profileMenu.appendChild(foot);
  }

  function isProfileOpen() {
    return !!(profileMenu && !profileMenu.hidden);
  }

  function openProfileMenu() {
    if (!profileMenu) return;
    closeSearchResults();
    renderProfileMenu();
    profileMenu.hidden = false;
    profileBtn.setAttribute('aria-expanded', 'true');
  }

  function closeProfileMenu() {
    if (!profileMenu || profileMenu.hidden) return;
    profileMenu.hidden = true;
    profileBtn.setAttribute('aria-expanded', 'false');
  }

  if (profileBtn && profileMenu) {
    profileBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (isProfileOpen()) closeProfileMenu();
      else openProfileMenu();
    });
    profileMenu.addEventListener('click', function (e) { e.stopPropagation(); });
  }

  function onAccountChange() {
    paintProfileButton();
    if (isProfileOpen()) renderProfileMenu();
  }
  global.addEventListener('chokaguya:auth-change', onAccountChange);
  global.addEventListener('chokaguya:sync-state', onAccountChange);

  // ── 통합 검색 ──────────────────────────────────────────────────────────
  var searchWrap = headerEl.querySelector('.site-search');
  var searchInput = headerEl.querySelector('.site-search-input');
  var resultsEl = headerEl.querySelector('.site-search-results');
  var openSearchBtn = headerEl.querySelector('.site-search-open-btn');
  var closeSearchBtn = headerEl.querySelector('.site-search-close-btn');

  var CATEGORY_ORDER = ['novel', 'translation', 'series', 'hof', 'official'];
  var PER_CATEGORY = 5;
  var TYPE_LABELS = (global.LibraryConfig && global.LibraryConfig.TYPE_LABELS) || {};

  // gridPage.js 와 같은 초성 검색 — "ㅅㅋㅇㄹ" 로 "사카요리"를 찾는다.
  var CHOSUNG_LIST = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
  var CHOSUNG_ONLY_RE = /^[ㄱ-ㅎ\s]+$/;
  function toChosung(str) {
    var result = '';
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i) - 0xac00;
      result += (code >= 0 && code <= 11171) ? CHOSUNG_LIST[Math.floor(code / 588)] : str[i];
    }
    return result;
  }

  var searchIndex = null;      // [{ type, id, item, lower, chosung }]
  var searchIndexPromise = null;
  var activeIndex = -1;        // 키보드로 고른 결과 위치
  var visibleResults = [];     // 지금 드롭다운에 그려진 결과(키보드 이동 순서)

  function isBlocked(item) {
    return !!(global.ContentSettings && global.ContentSettings.isBlocked(item.tags));
  }

  function loadSearchIndex() {
    if (searchIndexPromise) return searchIndexPromise;
    var fetchJson = global.fetchJsonCached || function (p) { return fetch(p).then(function (r) { return r.json(); }); };
    searchIndexPromise = fetchJson('../data/pageData/Lookup.json').then(function (lookup) {
      var list = [];
      CATEGORY_ORDER.forEach(function (type) {
        var byId = (lookup && lookup[type]) || {};
        Object.keys(byId).forEach(function (id) {
          var item = byId[id];
          if (!item || !item.name) return;
          list.push({ type: type, id: id, item: item, lower: item.name.toLowerCase(), chosung: null });
        });
      });
      searchIndex = list;
      return list;
    }).catch(function () {
      searchIndexPromise = null; // 다음 포커스 때 다시 시도
      return null;
    });
    return searchIndexPromise;
  }

  // 제목이 검색어로 시작하면 0, 중간에 있으면 1, 초성 일치 2, 게시물 번호 3.
  // 낮을수록 위에 보인다. 일치하지 않으면 -1.
  function matchRank(entry, term, chosungTerm, numericTerm) {
    var at = entry.lower.indexOf(term);
    if (at === 0) return 0;
    if (at > 0) return 1;
    if (chosungTerm) {
      if (entry.chosung === null) entry.chosung = toChosung(entry.item.name);
      if (entry.chosung.indexOf(chosungTerm) !== -1) return 2;
    }
    if (numericTerm) {
      var posts = entry.item.posts || [];
      for (var i = 0; i < posts.length; i++) {
        if (posts[i] && posts[i].id != null && String(posts[i].id).indexOf(numericTerm) !== -1) return 3;
      }
    }
    return -1;
  }

  function search(rawTerm) {
    var term = rawTerm.trim().toLowerCase();
    var groups = {};
    if (!term || !searchIndex) return groups;
    var chosungTerm = CHOSUNG_ONLY_RE.test(term) ? term.replace(/\s+/g, '') : '';
    var numericTerm = /^\d{3,}$/.test(term) ? term : '';
    searchIndex.forEach(function (entry) {
      if (isBlocked(entry.item)) return;
      var rank = matchRank(entry, term, chosungTerm, numericTerm);
      if (rank < 0) return;
      (groups[entry.type] = groups[entry.type] || []).push({ entry: entry, rank: rank });
    });
    Object.keys(groups).forEach(function (type) {
      // Array.prototype.sort 는 안정 정렬이라 같은 순위끼리는 데이터 순서(최신순)를 지킨다.
      groups[type].sort(function (a, b) { return a.rank - b.rank; });
    });
    return groups;
  }

  function metaText(entry) {
    var item = entry.item;
    var label = TYPE_LABELS[entry.type] || entry.type;
    var count = global.SeriesUtil ? global.SeriesUtil.countLine(item) : '';
    return count ? label + ' · ' + count : label;
  }

  // 제목 안에서 검색어와 일치한 부분만 강조한다(초성·번호 일치는 강조 없음).
  function renderName(container, name, term) {
    var at = term ? name.toLowerCase().indexOf(term) : -1;
    if (at < 0) { container.textContent = name; return; }
    container.appendChild(document.createTextNode(name.slice(0, at)));
    container.appendChild(el('mark', null, name.slice(at, at + term.length)));
    container.appendChild(document.createTextNode(name.slice(at + term.length)));
  }

  function createResultItem(entry, term) {
    var item = entry.item;
    var btn = el('button', 'site-search-item');
    btn.type = 'button';
    btn.setAttribute('role', 'option');
    btn.id = 'site-search-opt-' + visibleResults.length;

    var thumb = el('span', 'site-search-thumb');
    if (item.image) {
      var src = global.resolveThumbUrl ? global.resolveThumbUrl(item.image) : item.image;
      thumb.style.backgroundImage = 'url("' + src + '")';
      if (entry.type === 'translation') thumb.classList.add('is-blurred');
    } else {
      thumb.appendChild(el('span', 'site-search-thumb-letter', item.name.replace(/^[\s\[\(【「『]+/, '').charAt(0)));
    }
    btn.appendChild(thumb);

    var text = el('span', 'site-search-text');
    var name = el('span', 'site-search-name');
    renderName(name, item.name, term);
    text.appendChild(name);
    text.appendChild(el('span', 'site-search-meta', metaText(entry)));
    btn.appendChild(text);

    btn.addEventListener('mousedown', function (e) { e.preventDefault(); }); // 입력창 포커스 유지
    btn.addEventListener('click', function () { openResult(entry); });
    btn.addEventListener('mousemove', function () {
      var idx = visibleResults.indexOf(entry);
      if (idx !== activeIndex) setActive(idx);
    });
    visibleResults.push(entry);
    return btn;
  }

  function showStatus(text) {
    resultsEl.innerHTML = '';
    resultsEl.appendChild(el('p', 'site-search-status', text));
    openSearchResults();
  }

  function renderResults() {
    var raw = searchInput.value;
    var term = raw.trim().toLowerCase();
    visibleResults = [];
    activeIndex = -1;
    searchInput.removeAttribute('aria-activedescendant');
    if (!term) { closeSearchResults(); return; }
    if (!searchIndex) {
      showStatus(t('검색 목록을 불러오는 중이에요...'));
      loadSearchIndex().then(function (list) {
        if (!list) { showStatus(t('검색 목록을 불러오지 못했어요.')); return; }
        if (searchInput.value === raw) renderResults();
      });
      return;
    }

    var groups = search(raw);
    resultsEl.innerHTML = '';
    var any = false;
    CATEGORY_ORDER.forEach(function (type) {
      var matches = groups[type];
      if (!matches || !matches.length) return;
      any = true;
      var group = el('div', 'site-search-group');
      group.setAttribute('role', 'group');
      var title = el('p', 'site-search-group-title');
      title.appendChild(el('span', null, TYPE_LABELS[type] || type));
      if (matches.length > PER_CATEGORY) {
        title.appendChild(el('span', 'site-search-group-more', t('{n}건 중 {shown}건', { n: matches.length, shown: PER_CATEGORY })));
      }
      group.appendChild(title);
      group.setAttribute('aria-label', TYPE_LABELS[type] || type);
      matches.slice(0, PER_CATEGORY).forEach(function (m) {
        group.appendChild(createResultItem(m.entry, term));
      });
      resultsEl.appendChild(group);
    });
    if (!any) { showStatus(t('검색 결과가 없어요.')); return; }
    openSearchResults();
  }

  function setActive(idx) {
    var items = resultsEl.querySelectorAll('.site-search-item');
    items.forEach(function (node, i) { node.classList.toggle('is-active', i === idx); });
    activeIndex = idx;
    if (idx >= 0 && items[idx]) {
      searchInput.setAttribute('aria-activedescendant', items[idx].id);
      items[idx].scrollIntoView({ block: 'nearest' });
    } else {
      searchInput.removeAttribute('aria-activedescendant');
    }
  }

  function openSearchResults() {
    resultsEl.hidden = false;
    searchInput.setAttribute('aria-expanded', 'true');
  }

  function closeSearchResults() {
    if (!resultsEl) return;
    resultsEl.hidden = true;
    if (searchInput) searchInput.setAttribute('aria-expanded', 'false');
    activeIndex = -1;
  }

  function openResult(entry) {
    var item = entry.item;
    closeSearchResults();
    closeMobileSearch();
    searchInput.blur();
    if (!global.PostDetailSeries) return;
    var favId = item.posts && item.posts[0] && item.posts[0].id;
    global.PostDetailSeries.open({
      seriesName: item.name,
      imageUrl: item.image,
      favType: entry.type,
      postId: favId,
      tags: item.tags,
      episodes: (item.posts || []).map(function (post) {
        var charLabel = global.SeriesUtil ? global.SeriesUtil.charLabel(item.charCount) : item.charCount;
        return {
          title: post.title,
          dcId: post.id,
          link: post.link,
          reader: post.reader,
          episodeLabel: post.episode != null ? t('{n} 화', { n: post.episode }) : (charLabel || t('{n} 화', { n: 1 }))
        };
      })
    });
  }

  // 모바일: 돋보기 버튼을 누르면 검색창이 1행을 덮는다(site-header.css).
  function openMobileSearch() {
    headerEl.classList.add('is-search-open');
    document.body.classList.add('is-site-search-open');
    closeProfileMenu();
    searchInput.focus();
  }

  function closeMobileSearch() {
    headerEl.classList.remove('is-search-open');
    document.body.classList.remove('is-site-search-open');
  }

  if (searchWrap && searchInput && resultsEl) {
    var searchTimer = null;
    searchInput.addEventListener('focus', function () {
      searchWrap.classList.add('is-focused');
      closeProfileMenu();
      loadSearchIndex();
      if (searchInput.value.trim()) renderResults();
    });
    searchInput.addEventListener('blur', function () {
      searchWrap.classList.remove('is-focused');
      closeSearchResults();
    });
    searchInput.addEventListener('input', function () {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { searchTimer = null; renderResults(); }, 120);
    });
    searchInput.addEventListener('keydown', function (e) {
      if (e.isComposing) return; // 한글 조합 중 Enter/화살표는 입력기 몫
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!visibleResults.length) return;
        e.preventDefault();
        var step = e.key === 'ArrowDown' ? 1 : -1;
        var next = activeIndex + step;
        if (next < 0) next = visibleResults.length - 1;
        if (next >= visibleResults.length) next = 0;
        setActive(next);
      } else if (e.key === 'Enter') {
        var pick = visibleResults[activeIndex >= 0 ? activeIndex : 0];
        if (pick) { e.preventDefault(); openResult(pick); }
      } else if (e.key === 'Escape') {
        if (!resultsEl.hidden) { closeSearchResults(); e.stopPropagation(); return; }
        searchInput.blur();
        closeMobileSearch();
      }
    });
    resultsEl.addEventListener('mousedown', function (e) { e.preventDefault(); });

    // "/" 를 누르면 어디서든 검색창으로 간다(입력 중일 때는 제외).
    document.addEventListener('keydown', function (e) {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      var target = e.target;
      var tag = target && target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target && target.isContentEditable)) return;
      e.preventDefault();
      if (global.matchMedia && global.matchMedia('(max-width: 768px)').matches) openMobileSearch();
      else searchInput.focus();
    });
  }
  if (openSearchBtn) openSearchBtn.addEventListener('click', function (e) { e.stopPropagation(); openMobileSearch(); });
  if (closeSearchBtn) {
    closeSearchBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    closeSearchBtn.addEventListener('click', function () {
      closeSearchResults();
      searchInput.blur();
      closeMobileSearch();
    });
  }

  // ── 바깥 클릭·Escape 로 닫기 ──────────────────────────────────────────
  document.addEventListener('click', function (e) {
    closeProfileMenu();
    if (headerEl.classList.contains('is-search-open') && !headerEl.contains(e.target)) closeMobileSearch();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeProfileMenu();
  });

  // ── 고정 로고 위치 맞추기 ──────────────────────────────────────────────
  // .header-logo 는 position:fixed 라 가운데 모은 헤더 컨테이너를 따라오지
  // 못한다. 로고 자리(.header-logo-link)의 실제 왼쪽 끝을 재서 CSS 변수로
  // 넘기고(site-header.css), 메인 페이지 히어로 상태에서 로고를 화면
  // 가운데로 옮길 가로 이동량(main-page.css)도 같이 넘긴다. clientWidth 는
  // 스크롤바를 뺀 폭이라 100vw 로 계산할 때보다 본문 가운데와 정확히 맞는다.
  var logoSlot = headerEl.querySelector('.header-logo-link');
  function syncLogoPosition() {
    if (!logoSlot) return;
    var root = document.documentElement;
    var left = logoSlot.getBoundingClientRect().left;
    root.style.setProperty('--site-logo-left', left + 'px');
    root.style.setProperty('--site-hero-shift', (root.clientWidth / 2 - left) + 'px');
  }
  var logoSyncFrame = 0;
  function scheduleLogoSync() {
    if (logoSyncFrame) return;
    logoSyncFrame = global.requestAnimationFrame(function () {
      logoSyncFrame = 0;
      syncLogoPosition();
    });
  }
  // 목록이 늦게 그려져 세로 스크롤바가 새로 생기면 창 크기는 그대로라
  // resize 가 안 온다. 헤더 폭 자체를 지켜본다.
  if ('ResizeObserver' in global) new ResizeObserver(scheduleLogoSync).observe(headerEl);
  else global.addEventListener('resize', scheduleLogoSync);

  syncLogoPosition();
  markActiveNav();
  paintThemeSwitch();
  paintProfileButton();
})(window);
