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
      // 메뉴 색 효과(site-header.css 의 .has-glow) — 모바일 시트 타일과 같은 색
      var glow = MENU_GLOW_COLORS[target];
      if (glow) {
        link.style.setProperty('--tile-glow', glow);
        link.classList.add('has-glow');
      }
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
    paintAvatar(avatar);
    return avatar;
  }

  function myProfile() {
    return (isLoggedIn() && global.ProfileStore && global.ProfileStore.mine()) || null;
  }

  // 프로필이 있으면 사람 아이콘 대신 내 프로필 아이콘을 내 색 위에 그린다
  // (profileStore.js / profile.css). 목록은 비동기로 받으므로 받은 뒤에 칠한다.
  function paintAvatar(avatar) {
    if (!avatar) return;
    var profile = myProfile();
    if (!profile) {
      if (avatar.classList.contains('has-profile')) {
        avatar.classList.remove('has-profile');
        avatar.style.background = '';
        avatar.innerHTML = ICONS.person;
      }
      return;
    }
    global.ProfileStore.catalog().then(function (catalog) {
      if (myProfile() !== profile) return;
      var file = global.ProfileStore.iconFile(catalog, profile.icon);
      var hex = global.ProfileStore.colorHex(catalog, profile.color);
      avatar.classList.add('has-profile');
      avatar.style.background = hex || '';
      avatar.innerHTML = '';
      if (file) {
        var img = el('img');
        img.src = file;
        img.alt = '';
        avatar.appendChild(img);
      }
    });
  }

  function paintProfileButton() {
    if (!profileBtn) return;
    var loggedIn = isLoggedIn();
    if (buttonAvatar) {
      buttonAvatar.classList.toggle('is-logged-in', loggedIn);
      paintAvatar(buttonAvatar);
    }
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

  function renderProfileMenu(target) {
    var menu = target || profileMenu;
    if (!menu) return;
    menu.innerHTML = '';
    var loggedIn = isLoggedIn();

    var head = el('div', 'site-profile-head');
    head.appendChild(makeAvatar(loggedIn));
    var headText = el('div', 'site-profile-head-text');
    var profile = myProfile();
    headText.appendChild(el('p', 'site-profile-title', profile ? profile.nickname : (loggedIn ? t('로그인됨') : t('로그인하지 않았어요'))));
    headText.appendChild(el('p', 'site-profile-sub', loggedIn ? maskedCode() : t('게스트')));
    head.appendChild(headText);
    menu.appendChild(head);

    if (!loggedIn) {
      menu.appendChild(el('p', 'site-profile-desc', t('로그인하면 북마크를 다른 기기와 동기화할 수 있어요.')));
      var loginBtn = settingsButton(t('로그인'), 'is-primary');
      loginBtn.setAttribute('role', 'menuitem');
      loginBtn.addEventListener('click', function () {
        closeProfileMenu();
        if (global.AuthModal) global.AuthModal.openSignIn({});
      });
      menu.appendChild(loginBtn);
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
      menu.appendChild(sync);

      var links = el('div', 'site-profile-links');
      links.appendChild(menuLink(ICONS.person, t('프로필 편집'), function () {
        closeProfileMenu();
        if (global.SettingsModal) global.SettingsModal.open('profile');
      }));
      links.appendChild(menuLink(ICONS.key, t('개인 코드 보기'), function () {
        closeProfileMenu();
        if (global.SettingsModal) global.SettingsModal.open('account');
      }));
      links.appendChild(menuLink(ICONS.logout, t('로그아웃'), function () {
        closeProfileMenu();
        if (global.AuthUI && global.AuthUI.confirmAndLogout) global.AuthUI.confirmAndLogout();
      }, 'is-danger'));
      menu.appendChild(links);
    }

    var foot = el('div', 'site-profile-foot');
    if (global.AuthUI && global.AuthUI.renderVersionTag) global.AuthUI.renderVersionTag(foot);
    menu.appendChild(foot);
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
    closeMobileSheet();
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
  global.addEventListener('chokaguya:profile-change', onAccountChange);

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

  function isTranslationCensored() {
    return !global.ContentSettings || global.ContentSettings.isTranslationCensored();
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
      if (entry.type === 'translation' && isTranslationCensored()) thumb.classList.add('is-blurred');
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
      audio: item.audio,
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

  // ── 모바일 하단 내비게이션 ─────────────────────────────────────────────
  // 768px 이하에서는 헤더 2행(.site-nav)을 숨기고(site-header.css) 화면
  // 아래 탭 바로 페이지를 옮긴다. 마크업은 페이지마다 넣지 않고 여기서
  // 만들며, 페이지 목록은 헤더 메뉴(.site-nav-link)를 그대로 옮겨 쓴다.
  // - 홈: 메인으로 이동
  // - 메뉴: 페이지 타일과 북마크·룰렛 버튼이 아래에서 하나씩 올라오는 시트
  // - 프로필: 계정 메뉴 + 테마 + 설정 시트
  var MTB_ICONS = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9v11a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>'
  };

  var mtb = el('nav', 'mtb');
  mtb.setAttribute('aria-label', t('하단 메뉴'));
  var mtbBackdrop = el('div', 'mtb-backdrop');
  var mtbSheet = el('div', 'mtb-sheet');
  mtbSheet.setAttribute('role', 'dialog');
  mtbSheet.hidden = true;
  mtbBackdrop.hidden = true;
  var mtbOpen = null; // 'pages' | 'profile' | null

  function mtbTab(key, icon, label) {
    var node = el(key === 'home' ? 'a' : 'button', 'mtb-tab');
    if (key === 'home') node.href = '/';
    else node.type = 'button';
    node.innerHTML = icon;
    node.appendChild(el('span', 'mtb-label', label));
    mtb.appendChild(node);
    return node;
  }

  var homeTab = mtbTab('home', MTB_ICONS.home, t('홈'));
  var pagesTab = mtbTab('pages', MTB_ICONS.menu, t('메뉴'));
  var profileTab = mtbTab('profile', '', t('프로필'));
  profileTab.insertBefore(makeAvatar(false), profileTab.firstChild);
  pagesTab.setAttribute('aria-haspopup', 'dialog');
  profileTab.setAttribute('aria-haspopup', 'dialog');

  function paintMtbTabs() {
    var here = normalizePath(document.body.getAttribute('data-nav-path') || global.location.pathname);
    var onHome = here === '/' || /mainPage\.html$/.test(here);
    homeTab.classList.toggle('is-active', onHome && !mtbOpen);
    pagesTab.classList.toggle('is-active', mtbOpen === 'pages');
    profileTab.classList.toggle('is-active', mtbOpen === 'profile');
    pagesTab.setAttribute('aria-expanded', mtbOpen === 'pages' ? 'true' : 'false');
    profileTab.setAttribute('aria-expanded', mtbOpen === 'profile' ? 'true' : 'false');
    var av = profileTab.querySelector('.site-avatar');
    if (av) {
      av.classList.toggle('is-logged-in', isLoggedIn());
      paintAvatar(av);
    }
  }

  // 메뉴 시트 — 맨 위에 큰 '문학·번역' 타일, 그 아래 나머지 페이지를 2열
  // 타일로, 공지사항은 맨 아래 가로로 꽉 찬 타일로 둔다. 그 밑에는 오른쪽
  // 아래 버튼 묶음(북마크·룰렛, pickerKit.js 의 .pk-fab-stack)을 통째로
  // 옮겨 와 가로로 펼친다. 룰렛은 페이지마다 있는 것이 달라서 새로 만들지
  // 않고 그 페이지에 이미 있는 버튼을 그대로 쓴다. 모바일에서는 떠 있는
  // 버튼 묶음을 숨기고(site-header.css) 이 시트에서만 보여 준다. 시트를
  // 닫으면 묶음을 body 로 되돌려 데스크톱 폭에서 다시 뜬다.
  var MENU_FEATURED_PATH = '/novel'; // 맨 위 큰 타일
  var MENU_WIDE_PATH = '/notice';    // 2열 타일 아래 가로로 꽉 찬 타일
  var MENU_EXCLUDED_PATHS = { '/': true }; // 메인은 홈 탭이 있다
  // 타일을 누르거나 마우스를 올렸을 때 테두리·빛 색(site-header.css 의 --tile-glow)
  var MENU_GLOW_COLORS = {
    '/novel': '#FC4845',
    '/official': '#FED571',
    '/series': '#F3F23E',
    '/hof': '#C4F23D',
    '/contest': '#07D796',
    '/notice': '#00C5C1'
  };

  // ── '문학·번역' 타일 배경 이펙트 ──
  // offlineSrc/buttonEffect/ 의 GIF(목록: ButtonEffects.json, 3_build_data.py
  // 가 만든다)를 가장자리가 흐려지는 타원 안에 담아 타일 안 무작위 위치에
  // 띄운다. 각 거품은 제자리에서 투명도만 서서히 올라갔다가, 1~2.5초 머문
  // 뒤 서서히 사라진다. 동시에 2~4개가 떠 있고, 사라지려던 거품은 자기를
  // 빼고도 2개가 남을 때만 사라진다 — 모자라면 뒤를 이을 거품을 띄우고,
  // 그 거품이 나타나기 시작하자마자 겹쳐서 사라진다. 타일을 가로로 네 칸으로
  // 나눠 한 칸에 하나씩 띄우고, 세로 위치는 타일 높이 안에서 무작위로 잡는다.
  // GIF는 띄울 때마다 하나씩 받고, 다음에 쓸 것 하나만 미리 받아 둔다.
  // 최근에 띄운 GIF는 잠시 피해서 골고루 나오게 한다.
  var FX_DIR = '../offlineSrc/buttonEffect/';
  var FX_MIN = 2;          // 항상 떠 있어야 하는 최소 개수
  var FX_MAX = 4;          // 동시에 떠 있을 수 있는 최대 개수(= 칸 수)
  var FX_FADE_MS = 1200;   // site-header.css 의 .mtb-fx-bubble transition 과 맞춘다
  var fxListPromise = null;
  var fxRun = 0;           // 시트를 다시 그리거나 닫으면 이전 이펙트를 무효로 만든다
  var fxTimers = [];
  var fxReady = {};        // 이미 받아 둔 GIF 이름 → true (페이지에 머무는 동안 유지)

  function loadFxList() {
    if (!fxListPromise) {
      var fetchJson = global.fetchJsonCached || function (p) { return fetch(p).then(function (r) { return r.json(); }); };
      fxListPromise = fetchJson('../data/config/ButtonEffects.json')
        .then(function (list) { return Array.isArray(list) ? list : []; })
        .catch(function () { fxListPromise = null; return []; });
    }
    return fxListPromise;
  }

  function fxLater(run, fn, ms) {
    var id = setTimeout(function () {
      var at = fxTimers.indexOf(id);
      if (at >= 0) fxTimers.splice(at, 1);
      if (run === fxRun) fn();
    }, ms);
    fxTimers.push(id);
  }

  function stopTileEffect() {
    fxRun++;
    fxTimers.forEach(clearTimeout);
    fxTimers = [];
  }

  function randBetween(a, b) { return a + Math.random() * (b - a); }

  function startTileEffect(tile) {
    stopTileEffect();
    if (global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var run = fxRun;
    var fx = el('span', 'mtb-fx');
    fx.setAttribute('aria-hidden', 'true');
    tile.insertBefore(fx, tile.firstChild);
    tile.classList.add('has-fx');

    var zonesInUse = {};   // 칸 번호 → true
    var namesInUse = {};   // 지금 떠 있거나 받는 중인 GIF 이름 → true
    var loading = 0;       // 받는 중인 거품 수
    var active = 0;        // 화면에 있고 아직 사라지기 시작하지 않은 거품 수
    var target = FX_MIN;

    loadFxList().then(function (list) {
      if (run !== fxRun || !list.length) return;

      function randomOf(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

      // 최근에 띄운 GIF는 잠시 피해서 고른다. 목록이 많으니 같은 GIF가
      // 금방 다시 나오지 않도록, 목록 절반 정도는 되돌아 나오지 않게 한다.
      var recent = [];
      var recentLimit = Math.max(0, Math.min(Math.floor(list.length / 2), list.length - FX_MAX - 1));
      var nextName = null; // 다음 차례에 쓸 GIF — 미리 받아 둔다

      function randomFresh() {
        var pool = list.filter(function (n) { return !namesInUse[n] && recent.indexOf(n) < 0 && n !== nextName; });
        if (!pool.length) pool = list.filter(function (n) { return !namesInUse[n]; });
        if (!pool.length) pool = list;
        return randomOf(pool);
      }

      function pickName() {
        var name = (nextName && !namesInUse[nextName]) ? nextName : randomFresh();
        nextName = null;
        recent.push(name);
        if (recent.length > recentLimit) recent.shift();
        return name;
      }

      // 다음 차례에 쓸 GIF를 무작위로 정해 미리 받아 둔다. 이미 받아 둔
      // 것만 고르면 같은 몇 개만 반복되므로, 고른 뒤에 받는다.
      function prefetchOne() {
        if (nextName) return;
        nextName = randomFresh();
        if (fxReady[nextName]) return;
        var name = nextName;
        var img = new Image();
        img.onload = function () { fxReady[name] = true; };
        img.src = FX_DIR + encodeURIComponent(name);
      }

      function pickZone() {
        var free = [];
        for (var z = 0; z < FX_MAX; z++) if (!zonesInUse[z]) free.push(z);
        return free.length ? randomOf(free) : -1;
      }

      function spawn() {
        var zone = pickZone();
        if (zone < 0) return false;
        var name = pickName();
        zonesInUse[zone] = true;
        namesInUse[name] = true;
        loading++;

        function release() {
          delete zonesInUse[zone];
          delete namesInUse[name];
        }

        var url = FX_DIR + encodeURIComponent(name);
        var img = new Image();
        img.onload = function () {
          if (run !== fxRun) return;
          fxReady[name] = true;
          loading--;
          active++;
          // 타일 높이보다 크게(1.35~1.65배) 띄워 꽉 차 보이게 한다. 가장자리는
          // CSS 마스크로 흐려지므로 타일 밖으로 넘친 부분은 자연스럽게
          // 잘린다. 중심은 가로로는 자기 칸 안, 세로로는 타일 한가운데에서
          // 위아래로 타일 높이의 ±15%(35~65%) 안에서 무작위로 잡는다.
          var w = tile.offsetWidth || 340;
          var h = tile.offsetHeight || 112;
          var bh = h * randBetween(1.35, 1.65);
          var bw = bh * randBetween(1.25, 1.45);
          var zoneW = w / FX_MAX;
          var cx = zoneW * (zone + randBetween(0.2, 0.8));
          var cy = h * (0.5 + randBetween(-0.15, 0.15));
          var bubble = el('span', 'mtb-fx-bubble');
          bubble.style.width = bw + 'px';
          bubble.style.height = bh + 'px';
          bubble.style.left = (cx - bw / 2) + 'px';
          bubble.style.top = (cy - bh / 2) + 'px';
          bubble.style.backgroundImage = 'url("' + url + '")';
          fx.appendChild(bubble);
          void bubble.offsetWidth; // 붙인 다음 프레임에 보이게 해야 서서히 나타난다
          bubble.classList.add('is-shown');
          prefetchOne();

          // 다 나타난 뒤 1~2.5초 머문다. 자기를 빼면 최소 개수에 못 미칠 것
          // 같으면 그때 미리 뒤를 이을 거품을 띄워 둔다.
          fxLater(run, function () {
            if (active - 1 < FX_MIN) topUp(true);
            fxLater(run, tryFadeOut, randBetween(1000, 2500));
          }, FX_FADE_MS);

          function tryFadeOut() {
            if (active - 1 < FX_MIN) {
              // 뒤를 이을 거품이 나타나기 시작할 때까지 잠깐씩 기다린다.
              if (!loading) topUp(true);
              fxLater(run, tryFadeOut, 150);
              return;
            }
            active--;
            bubble.classList.remove('is-shown');
            fxLater(run, function () {
              if (bubble.parentNode) bubble.parentNode.removeChild(bubble);
              release();
              fxLater(run, topUp, randBetween(100, 600));
            }, FX_FADE_MS);
          }
        };
        // 못 받은 GIF는 건너뛰고 잠시 뒤 다른 것을 시도한다.
        img.onerror = function () {
          loading--;
          release();
          fxLater(run, topUp, 800);
        };
        img.src = url;
        return true;
      }

      // 목표 개수(2~4개)를 매번 새로 정하고, 모자란 만큼 시차를 두고 띄운다.
      // force 는 최소 개수를 지키려고 부를 때다 — 목표와 상관없이 빈 칸이
      // 있으면 바로 하나를 더 띄운다.
      function topUp(force) {
        if (force === true) {
          if (active + loading <= FX_MAX) spawn();
          return;
        }
        target = FX_MIN + Math.floor(Math.random() * (FX_MAX - FX_MIN + 1));
        var need = target - (active + loading);
        for (var i = 0; i < need; i++) {
          fxLater(run, function () { if (active + loading < target) spawn(); }, i * randBetween(250, 700));
        }
      }

      // 처음에는 최소 개수를 바로 띄우고, 나머지는 목표에 맞춰 이어서 띄운다.
      for (var i = 0; i < FX_MIN; i++) spawn();
      fxLater(run, topUp, FX_FADE_MS);
    });
  }

  function restoreFabStack() {
    var stack = mtbSheet.querySelector('.pk-fab-stack');
    if (stack) document.body.appendChild(stack);
  }

  function renderPagesSheet() {
    mtbSheet.setAttribute('aria-label', t('메뉴'));
    var grid = el('div', 'mtb-pages');
    var featured = [];
    var tiles = [];
    var wide = [];
    headerEl.querySelectorAll('.site-nav-link').forEach(function (link) {
      var path = normalizePath(new URL(link.href, global.location.href).pathname);
      if (MENU_EXCLUDED_PATHS[path]) return;
      var item = { href: link.getAttribute('href'), label: link.textContent, active: link.classList.contains('is-active'), glow: MENU_GLOW_COLORS[path] };
      if (path === MENU_FEATURED_PATH) { item.className = 'is-featured'; featured.push(item); }
      else if (path === MENU_WIDE_PATH) { item.className = 'is-wide'; wide.push(item); }
      else tiles.push(item);
    });

    var stack = document.querySelector('.pk-fab-stack');
    // 탭 바에 가까운 아래쪽부터 차례로 올라온다 — 버튼 줄이 먼저, 그다음
    // 타일을 아래 줄부터. 줄 번호는 아래에서부터 센다.
    var step = 40;
    var row = stack ? 1 : 0;
    function addTile(item, rowFromBottom) {
      var a = el('a', 'mtb-page' + (item.className ? ' ' + item.className : '') + (item.active ? ' is-active' : ''));
      a.href = item.href;
      a.style.setProperty('--mtb-delay', (rowFromBottom * step) + 'ms');
      if (item.glow) a.style.setProperty('--tile-glow', item.glow);
      a.appendChild(el('span', 'mtb-page-label', item.label));
      if (item.active) a.setAttribute('aria-current', 'page');
      grid.appendChild(a);
      return a;
    }
    var wideRow = row;
    if (wide.length) row++;
    var tileRows = Math.ceil(tiles.length / 2);
    var featuredRow = row + tileRows;
    featured.forEach(function (item) { startTileEffect(addTile(item, featuredRow)); });
    tiles.forEach(function (item, i) { addTile(item, row + tileRows - 1 - Math.floor(i / 2)); });
    wide.forEach(function (item) { addTile(item, wideRow); });
    mtbSheet.appendChild(grid);

    if (stack) {
      var fabs = el('div', 'mtb-fabs');
      fabs.style.setProperty('--mtb-delay', '0ms');
      fabs.appendChild(stack);
      mtbSheet.appendChild(fabs);
    }
  }

  function renderProfileSheet() {
    mtbSheet.setAttribute('aria-label', t('계정 메뉴'));
    var box = el('div', 'mtb-profile site-profile-menu');
    renderProfileMenu(box);
    mtbSheet.appendChild(box);

    var rows = el('div', 'mtb-rows');
    var themeRow = el('div', 'mtb-row');
    themeRow.appendChild(el('span', 'mtb-row-label', t('화면 테마')));
    var seg = el('div', 'mtb-seg');
    var current = global.ThemeManager ? global.ThemeManager.getTheme() : 'light';
    [['light', t('라이트')], ['dark', t('다크')]].forEach(function (opt) {
      var b = el('button', 'mtb-seg-btn' + (current === opt[0] ? ' is-active' : ''), opt[1]);
      b.type = 'button';
      b.addEventListener('click', function () {
        if (global.ThemeManager && global.ThemeManager.getTheme() !== opt[0]) global.ThemeManager.setTheme(opt[0], true);
        seg.querySelectorAll('.mtb-seg-btn').forEach(function (x) { x.classList.toggle('is-active', x === b); });
      });
      seg.appendChild(b);
    });
    themeRow.appendChild(seg);
    rows.appendChild(themeRow);

    var settingsRow = el('button', 'mtb-row mtb-row-btn');
    settingsRow.type = 'button';
    settingsRow.innerHTML = MTB_ICONS.gear;
    settingsRow.appendChild(el('span', 'mtb-row-label', t('설정')));
    settingsRow.addEventListener('click', function () {
      closeMobileSheet();
      if (global.SettingsModal) global.SettingsModal.open();
    });
    rows.appendChild(settingsRow);
    mtbSheet.appendChild(rows);
  }

  function renderMobileSheet() {
    stopTileEffect();
    restoreFabStack(); // innerHTML 로 지우기 전에 빌려 온 버튼 묶음부터 돌려준다
    mtbSheet.innerHTML = '';
    mtbSheet.appendChild(el('div', 'mtb-grip'));
    if (mtbOpen === 'pages') renderPagesSheet();
    else renderProfileSheet();
  }

  function openMobileSheet(kind) {
    if (mtbOpen === kind) { closeMobileSheet(); return; }
    closeSearchResults();
    closeMobileSearch();
    mtbOpen = kind;
    mtbSheet.className = 'mtb-sheet is-' + kind;
    renderMobileSheet();
    mtbSheet.hidden = false;
    mtbBackdrop.hidden = false;
    document.body.classList.add('is-mtb-open');
    // hidden 을 푼 다음 프레임에 열린 상태를 붙여야 transition 이 돈다.
    global.requestAnimationFrame(function () {
      global.requestAnimationFrame(function () {
        if (mtbOpen !== kind) return;
        mtbSheet.classList.add('is-open');
        mtbBackdrop.classList.add('is-open');
      });
    });
    paintMtbTabs();
  }

  function closeMobileSheet() {
    if (!mtbOpen) return;
    mtbOpen = null;
    stopTileEffect();
    mtbSheet.classList.remove('is-open');
    mtbBackdrop.classList.remove('is-open');
    document.body.classList.remove('is-mtb-open');
    setTimeout(function () {
      if (mtbOpen) return;
      mtbSheet.hidden = true;
      mtbBackdrop.hidden = true;
      restoreFabStack();
    }, 260);
    paintMtbTabs();
  }

  pagesTab.addEventListener('click', function (e) { e.stopPropagation(); openMobileSheet('pages'); });
  profileTab.addEventListener('click', function (e) { e.stopPropagation(); openMobileSheet('profile'); });
  mtbSheet.addEventListener('click', function (e) {
    e.stopPropagation();
    // 룰렛 버튼은 팝업을 띄우므로 그 뒤에 시트가 남지 않게 닫는다.
    if (e.target.closest && e.target.closest('.pk-fab')) closeMobileSheet();
  });
  mtbBackdrop.addEventListener('click', closeMobileSheet);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMobileSheet(); });
  // 데스크톱 폭으로 넓어지면 열린 시트를 닫는다.
  if (global.matchMedia) {
    var mtbQuery = global.matchMedia('(max-width: 768px)');
    if (mtbQuery.addEventListener) mtbQuery.addEventListener('change', function () { if (!mtbQuery.matches) closeMobileSheet(); });
  }
  global.addEventListener('chokaguya:auth-change', function () { paintMtbTabs(); if (mtbOpen === 'profile') renderMobileSheet(); });
  global.addEventListener('chokaguya:profile-change', function () { paintMtbTabs(); if (mtbOpen === 'profile') renderMobileSheet(); });
  global.addEventListener('chokaguya:sync-state', function () { if (mtbOpen === 'profile') renderMobileSheet(); });

  document.body.appendChild(mtbBackdrop);
  document.body.appendChild(mtbSheet);
  document.body.appendChild(mtb);
  document.body.classList.add('has-mtb');

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
  paintMtbTabs();
})(window);
