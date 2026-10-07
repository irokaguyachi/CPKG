/**
 * ChoKaguya Settings Modal (통합 설정창)
 * - 사이드바에 흩어져 있던 다크모드 토글·로그인/계정 관리를 한 곳에
 *   모으고, 오디오 노벨 재생 설정(자동재생/음량)을 새로 추가한 통합 창.
 * - src/js/components/authModal.js 의 싱글턴 오버레이 패턴(document.body 에 한 번만
 *   append, 바깥클릭/Escape 로 닫힘, `.is-open` 토글)을 그대로 따르되,
 *   내부는 좌측 카테고리 레일 + 우측 상세 패널의 2단 레이아웃(Claude
 *   데스크톱 앱 설정창 참고)이라 auth-card 를 상속하지 않고 새 클래스를
 *   쓴다.
 * - 계정 탭 내용은 src/js/components/auth.js 의 AuthUI.renderAccountSettings() 에
 *   위임한다 — 로그인 상태 판정/동기화 버튼 로직을 여기서 중복하지 않는다.
 */
(function (global) {
  var t = global.I18n.t;
  var overlayEl = null;
  var railEls = {};
  var railIndicator = null;
  var paneEl = null;
  var activeTab = 'general';
  var paneFadeTimer = null;

  var TABS = [
    { id: 'general', label: t('일반') },
    { id: 'view', label: t('보기') },
    { id: 'profile', label: t('프로필') },
    { id: 'account', label: t('계정') },
    { id: 'audio', label: t('오디오 문학') },
    { id: 'info', label: t('정보') }
  ];

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function closeButton() {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pds-close';
    btn.setAttribute('aria-label', t('닫기'));
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 4L20 20M20 4L4 20" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/></svg>';
    btn.addEventListener('click', close);
    return btn;
  }

  function ensureOverlay() {
    if (overlayEl) return overlayEl;
    overlayEl = document.createElement('div');
    overlayEl.className = 'settings-overlay';
    overlayEl.addEventListener('click', function (e) {
      if (e.target === overlayEl) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
    document.body.appendChild(overlayEl);

    var card = document.createElement('div');
    card.className = 'settings-card';
    card.addEventListener('click', function (e) { e.stopPropagation(); });
    card.appendChild(closeButton());

    var rail = el('div', 'settings-rail');
    railIndicator = el('div', 'settings-rail-indicator');
    rail.appendChild(railIndicator);
    TABS.forEach(function (tab) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'settings-rail-btn';
      btn.textContent = tab.label;
      btn.addEventListener('click', function () { switchTab(tab.id); });
      rail.appendChild(btn);
      railEls[tab.id] = btn;
    });
    card.appendChild(rail);

    paneEl = el('div', 'settings-pane');
    card.appendChild(paneEl);

    overlayEl.appendChild(card);
    return overlayEl;
  }

  var MOBILE_QUERY = '(max-width: 640px)';

  // 좁은 화면(settings-modal.css의 640px 브레이크포인트와 맞춤)에서는
  // 레일이 세로 목록이 아니라 가로 한 줄이 되므로, 활성 표시도 위아래로
  // 미끄러지는 대신 좌우로 미끄러져야 한다 — 두 축을 각각 명시해서 이전
  // 모드의 값이 남지 않게 한다.
  function positionIndicator(btn) {
    if (!railIndicator || !btn) return;
    var isMobile = window.matchMedia && window.matchMedia(MOBILE_QUERY).matches;
    if (isMobile) {
      railIndicator.style.top = '0';
      railIndicator.style.height = '100%';
      railIndicator.style.left = btn.offsetLeft + 'px';
      railIndicator.style.right = 'auto';
      railIndicator.style.width = btn.offsetWidth + 'px';
      railIndicator.style.transform = 'none';
    } else {
      railIndicator.style.left = '12px';
      railIndicator.style.right = '12px';
      railIndicator.style.width = 'auto';
      railIndicator.style.height = btn.offsetHeight + 'px';
      railIndicator.style.transform = 'translateY(' + btn.offsetTop + 'px)';
    }
  }

  // 창 폭이 브레이크포인트를 넘나들 때(모바일 회전, 창 크기 조절)도 지금
  // 활성 탭 기준으로 다시 계산한다.
  window.addEventListener('resize', function () {
    if (railEls[activeTab]) positionIndicator(railEls[activeTab]);
  });

  function switchTab(tabId) {
    var changed = activeTab !== tabId || !paneEl.firstChild;
    activeTab = tabId;
    Object.keys(railEls).forEach(function (id) {
      railEls[id].classList.toggle('is-active', id === tabId);
    });
    positionIndicator(railEls[tabId]);
    if (changed) renderPane(tabId);
  }

  // ---- 일반 탭 ----
  // 예전 헤더의 다크모드 토글 버튼(theme.js, 통합 설정창으로 옮겨가며 삭제됨)과
  // 같은 아이콘·문구 — 지금 모드가 아니라 "눌렀을 때 바뀔 모드"를 보여준다
  // (다크일 땐 해 아이콘+"라이트 모드", 라이트일 땐 달 아이콘+"다크 모드").
  var SUN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';
  var MOON_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';

  function renderGeneralPane(pane) {
    pane.appendChild(el('h3', 'settings-pane-title', t('일반')));

    pane.appendChild(languageRow());

    var row = el('div', 'settings-row');
    row.appendChild(el('p', 'settings-row-label', t('라이트 모드/다크 모드')));

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'settings-mode-btn';
    function paint() {
      var isDark = (global.ThemeManager ? global.ThemeManager.getTheme() : 'light') === 'dark';
      btn.innerHTML = (isDark ? SUN_ICON : MOON_ICON) + '<span>' + (isDark ? t('라이트 모드') : t('다크 모드')) + '</span>';
    }
    paint();
    btn.addEventListener('click', function () {
      var isDark = (global.ThemeManager ? global.ThemeManager.getTheme() : 'light') === 'dark';
      if (global.ThemeManager) global.ThemeManager.setTheme(isDark ? 'light' : 'dark', true);
      paint();
    });
    row.appendChild(btn);
    pane.appendChild(row);

    // 후방주의 모드 토글 — 켜면 후방주의(성인) 태그 문학이 보이고 번역 사진
    // 검열(흐림·주의 게이트)도 풀린다. 오디오 탭의 자동재생 토글과 같은
    // .settings-toggle 마크업/스타일을 그대로 쓴다. 기본 OFF(ContentSettings
    // 참고) — 국내 법적 리스크와, 원치 않는 방문자가 성인 콘텐츠를 갑자기
    // 마주치는 상황을 막기 위함.
    var matureRow = el('div', 'settings-row');
    var matureText = el('div', 'settings-row-text');
    matureText.appendChild(el('p', 'settings-row-label', t('🔞 후방주의 모드')));
    matureText.appendChild(el('p', 'settings-row-desc', t('후방주의 태그 문학을 노출하고 번역 사진 검열을 해제합니다')));
    matureRow.appendChild(matureText);

    var matureToggle = document.createElement('button');
    matureToggle.type = 'button';
    var showMature = global.ContentSettings ? global.ContentSettings.get().showMature : false;
    matureToggle.className = 'settings-toggle' + (showMature ? ' is-on' : '');
    matureToggle.setAttribute('role', 'switch');
    matureToggle.setAttribute('aria-checked', String(showMature));
    matureToggle.innerHTML = '<span class="settings-toggle-knob"></span>';
    matureToggle.addEventListener('click', function () {
      var next = !matureToggle.classList.contains('is-on');
      matureToggle.classList.toggle('is-on', next);
      matureToggle.setAttribute('aria-checked', String(next));
      if (global.ContentSettings) global.ContentSettings.setShowMature(next);
    });
    matureRow.appendChild(matureToggle);
    pane.appendChild(matureRow);
  }

  // 사이트 UI 언어 선택. 언어를 바꾸면 I18n.setLanguage() 가 사전을 받아
  // 저장한 뒤 페이지를 새로고침한다(이미 그려진 문구를 전부 다시 그리는
  // 것보다 확실하다). 라벨에 영어를 함께 적어 한국어를 못 읽는 방문자도
  // 이 줄을 찾을 수 있게 한다.
  function languageRow() {
    var row = el('div', 'settings-row settings-lang-row');
    row.appendChild(el('p', 'settings-row-label', t('🌐 언어 · Language')));

    var group = el('div', 'settings-lang-group');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', 'Language');
    var i18n = global.I18n;
    i18n.LANGUAGES.forEach(function (lang) {
      var btn = document.createElement('button');
      btn.type = 'button';
      var isCurrent = lang.code === i18n.lang;
      btn.className = 'settings-mode-btn settings-lang-btn' + (isCurrent ? ' is-active' : '');
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', String(isCurrent));
      btn.setAttribute('lang', lang.htmlLang);
      btn.textContent = lang.label;
      btn.addEventListener('click', function () {
        if (lang.code === i18n.lang || group.classList.contains('is-busy')) return;
        group.classList.add('is-busy');
        i18n.setLanguage(lang.code).catch(function () {
          group.classList.remove('is-busy');
        });
      });
      group.appendChild(btn);
    });
    row.appendChild(group);
    return row;
  }

  // ---- 보기 탭 ----
  // 문학·시리즈·명예관·공식 목록의 보기 방식(그리드/리스트)과 그리드 카드
  // 모양을 고른다. 값은 viewSettings.js 가 저장하고, 이미 열려 있는 목록은
  // 이벤트를 받아 곧바로 다시 그린다. 고르기 전에 모양을 짐작할 수 있도록
  // 각 선택지에 작은 예시 그림(.svp-*)을 붙인다 — 예시는 실제 카드 CSS 를
  // 쓰지 않는 도식이라 카드 CSS 가 없는 페이지에서 설정창을 열어도 깨지지
  // 않는다.
  var VIEW_MODE_OPTIONS = [
    { id: 'grid', label: t('그리드'), desc: t('그림을 크게 보며 고르기 좋아요') },
    { id: 'list', label: t('리스트'), desc: t('게시판처럼 한 줄씩 빠르게 훑어봐요') }
  ];
  var GRID_STYLE_OPTIONS = [
    { id: 'classic', label: t('기본'), desc: t('가로 배너 그림 아래에 제목과 태그') },
    { id: 'cover', label: t('표지형'), desc: t('책 표지처럼 그림 위에 제목') },
    { id: 'magazine', label: t('매거진형'), desc: t('정사각형 그림 아래에 두 줄 제목') },
    { id: 'compact', label: t('컴팩트'), desc: t('작은 그림 옆에 제목, 가장 많이 보여요') }
  ];
  // 예시 그림 속 썸네일 색 — tags.css 의 태그 색(--tag-glow-*) 몇 가지를 빌린다.
  var PREVIEW_TINTS = ['235, 105, 145', '105, 140, 225', '70, 185, 175', '225, 185, 50'];

  function previewFigure(kind) {
    var fig = el('div', 'svp svp-' + kind);
    fig.setAttribute('aria-hidden', 'true');
    var count = kind === 'list' || kind === 'compact' ? 3 : (kind === 'classic' ? 2 : 3);
    for (var i = 0; i < count; i++) {
      var item = el('span', 'svp-item');
      var img = el('span', 'svp-img');
      img.style.setProperty('--svp-tint', PREVIEW_TINTS[i % PREVIEW_TINTS.length]);
      item.appendChild(img);
      var text = el('span', 'svp-text');
      text.appendChild(el('span', 'svp-line svp-line-title'));
      text.appendChild(el('span', 'svp-line'));
      item.appendChild(text);
      fig.appendChild(item);
    }
    return fig;
  }

  function optionGroup(label, options, current, onPick, kindOf) {
    var group = el('div', 'settings-view-options');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', label);
    var buttons = [];
    options.forEach(function (opt) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'settings-view-option';
      btn.setAttribute('role', 'radio');
      btn.appendChild(previewFigure(kindOf(opt.id)));
      var text = el('span', 'settings-view-option-text');
      text.appendChild(el('span', 'settings-view-option-label', opt.label));
      text.appendChild(el('span', 'settings-view-option-desc', opt.desc));
      btn.appendChild(text);
      btn.addEventListener('click', function () {
        paint(opt.id);
        onPick(opt.id);
      });
      buttons.push({ id: opt.id, btn: btn });
      group.appendChild(btn);
    });
    function paint(id) {
      buttons.forEach(function (b) {
        var on = b.id === id;
        b.btn.classList.toggle('is-active', on);
        b.btn.setAttribute('aria-checked', String(on));
      });
    }
    paint(current);
    return { el: group, paint: paint };
  }

  function renderViewPane(pane) {
    pane.appendChild(el('h3', 'settings-pane-title', t('보기')));
    var VS = global.ViewSettings;
    if (!VS) {
      pane.appendChild(el('p', 'settings-desc', t('이 페이지에서는 보기 설정을 바꿀 수 없어요.')));
      return;
    }
    var state = VS.get();

    pane.appendChild(el('p', 'settings-field-label', t('목록 보기 방식')));
    var modeGroup = optionGroup(t('목록 보기 방식'), VIEW_MODE_OPTIONS, state.viewMode, function (id) {
      VS.setViewMode(id);
    }, function (id) { return id === 'list' ? 'list' : VS.getGridStyle(); });
    pane.appendChild(modeGroup.el);

    pane.appendChild(el('p', 'settings-field-label', t('그리드 카드 모양')));
    var styleGroup = optionGroup(t('그리드 카드 모양'), GRID_STYLE_OPTIONS, state.gridStyle, function (id) {
      VS.setGridStyle(id);
      // 카드 모양을 고르는 건 그리드로 보겠다는 뜻이므로 보기 방식도 맞춘다.
      VS.setViewMode('grid');
    }, function (id) { return id; });
    styleGroup.el.classList.add('is-grid-styles');
    pane.appendChild(styleGroup.el);

    pane.appendChild(el('p', 'settings-stat-note', t('작가 이름은 앞 두 글자만 보여 줍니다. 툴바의 보기 전환 버튼으로 바꾼 값도 여기에 함께 저장됩니다.')));

    // 툴바 버튼이나 카드 모양 선택으로 값이 바뀌면 이 탭의 선택 표시와
    // 그리드 예시 그림을 다시 맞춘다. 탭이 닫혀 노드가 치워지면 스스로 뗀다.
    function onChange(e) {
      if (!pane.contains(modeGroup.el)) {
        global.removeEventListener('chokaguya:view-settings-change', onChange);
        return;
      }
      var next = e.detail || VS.get();
      modeGroup.paint(next.viewMode);
      styleGroup.paint(next.gridStyle);
      var gridBtn = modeGroup.el.querySelector('.settings-view-option');
      var oldFig = gridBtn && gridBtn.querySelector('.svp');
      if (oldFig) gridBtn.replaceChild(previewFigure(next.gridStyle), oldFig);
    }
    global.addEventListener('chokaguya:view-settings-change', onChange);
  }

  // ---- 계정 탭 ----
  function renderAccountPane(pane) {
    pane.appendChild(el('h3', 'settings-pane-title', t('계정')));
    var container = el('div', 'settings-account-container');
    pane.appendChild(container);
    if (global.AuthUI) global.AuthUI.renderAccountSettings(container);
  }

  // ---- 프로필 탭 ----
  // 내용은 src/js/components/profileEditor.js 가 그린다(계정 탭을 auth.js 에 맡기는 것과 같다).
  function renderProfilePane(pane) {
    pane.appendChild(el('h3', 'settings-pane-title', t('프로필')));
    var container = el('div', 'profile-editor');
    pane.appendChild(container);
    if (global.ProfileEditor) global.ProfileEditor.render(container);
  }

  // ---- 오디오 문학 탭 ----
  // 일반 탭과 같은 "왼쪽 라벨 / 오른쪽 컨트롤 + 아래 구분선" 행 구조
  // (.settings-row)를 그대로 쓴다.
  function renderAudioPane(pane) {
    pane.appendChild(el('h3', 'settings-pane-title', t('오디오 문학')));

    var settings = global.AudioSettings ? global.AudioSettings.get() : { autoplay: true, volume: 1 };

    var autoplayRow = el('div', 'settings-row');
    var autoplayText = el('div', 'settings-row-text');
    autoplayText.appendChild(el('p', 'settings-row-label', t('자동재생')));
    autoplayText.appendChild(el('p', 'settings-row-desc', t('스크롤로 구간에 들어오면 배경음악을 자동으로 재생')));
    autoplayRow.appendChild(autoplayText);

    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'settings-toggle' + (settings.autoplay ? ' is-on' : '');
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-checked', String(settings.autoplay));
    toggle.innerHTML = '<span class="settings-toggle-knob"></span>';
    toggle.addEventListener('click', function () {
      var next = !toggle.classList.contains('is-on');
      toggle.classList.toggle('is-on', next);
      toggle.setAttribute('aria-checked', String(next));
      if (global.AudioSettings) global.AudioSettings.setAutoplay(next);
    });
    autoplayRow.appendChild(toggle);
    pane.appendChild(autoplayRow);

    var volumeRow = el('div', 'settings-row');
    volumeRow.appendChild(el('p', 'settings-row-label', t('음량')));

    var volumeControl = el('div', 'settings-volume-control');
    var slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '1';
    slider.step = '0.05';
    slider.value = String(settings.volume);
    slider.className = 'settings-slider';
    var volumeLabel = el('span', 'settings-slider-value', Math.round(settings.volume * 100) + '%');
    slider.addEventListener('input', function () {
      var v = parseFloat(slider.value);
      volumeLabel.textContent = Math.round(v * 100) + '%';
      if (global.AudioSettings) global.AudioSettings.setVolume(v);
    });
    volumeControl.appendChild(slider);
    volumeControl.appendChild(volumeLabel);
    volumeRow.appendChild(volumeControl);
    pane.appendChild(volumeRow);
  }

  // ---- 정보 탭 ----
  // 저장소 루트의 CurrentStats.md(에이전트용 상세 수집 기록)를 사용자가 볼
  // 만한 수치만 추려 src/data/config/CollectionStats.json 에 옮겨 두고, 그
  // JSON을 읽어 보여준다. 크롤링 후 CurrentStats.md 를 갱신할 때 이 JSON도
  // 같이 고친다(.agent/rules/crawling.md 5번).
  var STATS_URL = '../data/config/CollectionStats.json';
  var DC_POST_URL = 'https://gall.dcinside.com/mgallery/board/view/?id=chokaguyahime&no=';

  function formatCount(n) {
    return Number(n || 0).toLocaleString(global.I18n.locale);
  }

  // 글자 수는 자릿수가 커서 그대로 쓰면 타일에 안 들어간다 — 만 단위로 줄인다.
  // 영어에는 만 단위가 없으므로 천(k)·백만(M) 단위로 줄인다.
  function formatChars(n) {
    n = Number(n || 0);
    if (global.I18n.lang === 'en') {
      if (n < 1000) return { value: formatCount(n), unit: 'chars' };
      if (n < 1000000) return { value: formatCount(Math.round(n / 1000)), unit: 'k chars' };
      return { value: (n / 1000000).toFixed(1), unit: 'M chars' };
    }
    if (n < 10000) return { value: formatCount(n), unit: t('자') };
    return { value: formatCount(Math.round(n / 10000)), unit: t('만 자') };
  }

  function statTile(label, value, unit, sub) {
    var tile = el('div', 'settings-stat');
    tile.appendChild(el('p', 'settings-stat-label', label));
    var valueEl = el('p', 'settings-stat-value', value);
    valueEl.appendChild(el('span', 'settings-stat-unit', unit));
    tile.appendChild(valueEl);
    if (sub) tile.appendChild(el('p', 'settings-stat-sub', sub));
    return tile;
  }

  function lastPostRow(post) {
    var row = el('div', 'settings-row');
    var text = el('div', 'settings-row-text');
    text.appendChild(el('p', 'settings-row-label', t('마지막으로 수집한 글')));
    var desc = el('p', 'settings-row-desc');
    var link = el('a', 'settings-stat-link', t('{n}번', { n: formatCount(post.id) }) + ' · ' + post.title);
    link.href = DC_POST_URL + post.id;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    desc.appendChild(link);
    text.appendChild(desc);
    row.appendChild(text);
    return row;
  }

  function renderInfoContent(box, stats) {
    var lit = stats.literature || {};
    var tr = stats.translation || {};

    if (stats.updatedAt) {
      box.appendChild(el('p', 'settings-desc', t('{date} 기준 · 갤러리 글을 주기적으로 모아 반영하므로 최근 글은 다음 수집 때 추가됩니다.', { date: stats.updatedAt })));
    }

    box.appendChild(el('p', 'settings-field-label', t('문학')));
    var litGrid = el('div', 'settings-stat-grid');
    var litChars = formatChars(lit.chars);
    litGrid.appendChild(statTile(t('작품'), formatCount(lit.posts), t('편')));
    litGrid.appendChild(statTile(t('작가'), formatCount(lit.authors), t('명')));
    litGrid.appendChild(statTile(t('글자 수'), litChars.value, litChars.unit));
    litGrid.appendChild(statTile(t('시리즈'), formatCount(lit.series), t('개'), lit.seriesEpisodes ? t('총 {n}화', { n: formatCount(lit.seriesEpisodes) }) : ''));
    litGrid.appendChild(statTile(t('대회 출품작'), formatCount(lit.contest), t('편')));
    litGrid.appendChild(statTile(t('명예관'), formatCount(lit.hof), t('편')));
    box.appendChild(litGrid);
    if (lit.lastPost) box.appendChild(lastPostRow(lit.lastPost));

    box.appendChild(el('p', 'settings-field-label', t('번역')));
    var trGrid = el('div', 'settings-stat-grid');
    var trChars = formatChars(tr.chars);
    trGrid.appendChild(statTile(t('번역글'), formatCount(tr.posts), t('편')));
    trGrid.appendChild(statTile(t('역자'), formatCount(tr.translators), t('명')));
    trGrid.appendChild(statTile(t('글자 수'), trChars.value, trChars.unit));
    box.appendChild(trGrid);
    if (tr.lastPost) box.appendChild(lastPostRow(tr.lastPost));

    box.appendChild(el('p', 'settings-stat-note', t('끌올·잡담·소재 요청처럼 작품이 아닌 글은 집계에서 뺐고, 여러 곳에 함께 실린 글은 한 번만 셌습니다.')));
  }

  function renderInfoPane(pane) {
    pane.appendChild(el('h3', 'settings-pane-title', t('정보')));
    var box = el('div', 'settings-info');
    box.appendChild(el('p', 'settings-desc', t('수집 현황을 불러오는 중…')));
    pane.appendChild(box);

    var load = global.fetchJsonCached
      ? global.fetchJsonCached(STATS_URL)
      : fetch(STATS_URL).then(function (r) { return r.json(); });
    load.then(function (stats) {
      // 불러오는 사이 다른 탭으로 옮겨 갔으면 이미 치워진 노드라 건드리지 않는다.
      if (!box.isConnected) return;
      box.innerHTML = '';
      renderInfoContent(box, stats || {});
    }).catch(function () {
      if (!box.isConnected) return;
      box.innerHTML = '';
      box.appendChild(el('p', 'settings-desc', t('수집 현황을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.')));
    });
  }

  var PANE_FADE_MS = 120;

  // 탭을 바꿀 때 내용을 바로 갈아치우지 않고, 살짝 페이드아웃한 뒤 새
  // 내용으로 채우고 다시 페이드인한다 — 급하게 뚝 끊기지 않게.
  function renderPane(tabId) {
    if (paneFadeTimer) clearTimeout(paneFadeTimer);
    var hasContent = !!paneEl.firstChild;
    function fill() {
      paneEl.innerHTML = '';
      if (tabId === 'general') renderGeneralPane(paneEl);
      else if (tabId === 'view') renderViewPane(paneEl);
      else if (tabId === 'profile') renderProfilePane(paneEl);
      else if (tabId === 'account') renderAccountPane(paneEl);
      else if (tabId === 'audio') renderAudioPane(paneEl);
      else if (tabId === 'info') renderInfoPane(paneEl);
      requestAnimationFrame(function () {
        paneEl.classList.remove('is-fading');
      });
    }
    if (!hasContent) {
      fill();
      return;
    }
    paneEl.classList.add('is-fading');
    paneFadeTimer = setTimeout(fill, PANE_FADE_MS);
  }

  function open(tabId) {
    ensureOverlay();
    switchTab(tabId || 'general');
    overlayEl.classList.add('is-open');
  }

  function close() {
    if (overlayEl) overlayEl.classList.remove('is-open');
  }

  function init() {
    document.querySelectorAll('[data-settings-trigger]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        open('general');
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.SettingsModal = { open: open, close: close };
})(window);
