/**
 * ChoKaguya Settings Modal (통합 설정창)
 * - 사이드바에 흩어져 있던 다크모드 토글·로그인/계정 관리를 한 곳에
 *   모으고, 오디오 노벨 재생 설정(자동재생/음량)을 새로 추가한 통합 창.
 * - src/js/authModal.js 의 싱글턴 오버레이 패턴(document.body 에 한 번만
 *   append, 바깥클릭/Escape 로 닫힘, `.is-open` 토글)을 그대로 따르되,
 *   내부는 좌측 카테고리 레일 + 우측 상세 패널의 2단 레이아웃(Claude
 *   데스크톱 앱 설정창 참고)이라 auth-card 를 상속하지 않고 새 클래스를
 *   쓴다.
 * - 계정 탭 내용은 src/js/auth.js 의 AuthUI.renderAccountSettings() 에
 *   위임한다 — 로그인 상태 판정/동기화 버튼 로직을 여기서 중복하지 않는다.
 */
(function (global) {
  var overlayEl = null;
  var railEls = {};
  var railIndicator = null;
  var paneEl = null;
  var activeTab = 'general';
  var paneFadeTimer = null;

  var TABS = [
    { id: 'general', label: '일반' },
    { id: 'account', label: '계정' },
    { id: 'audio', label: '오디오 문학' }
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
    btn.setAttribute('aria-label', '닫기');
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

  function positionIndicator(btn) {
    if (!railIndicator || !btn) return;
    railIndicator.style.transform = 'translateY(' + btn.offsetTop + 'px)';
    railIndicator.style.height = btn.offsetHeight + 'px';
  }

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
    pane.appendChild(el('h3', 'settings-pane-title', '일반'));

    var row = el('div', 'settings-row');
    row.appendChild(el('p', 'settings-row-label', '라이트 모드/다크 모드'));

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'settings-mode-btn';
    function paint() {
      var isDark = (global.ThemeManager ? global.ThemeManager.getTheme() : 'light') === 'dark';
      btn.innerHTML = (isDark ? SUN_ICON : MOON_ICON) + '<span>' + (isDark ? '라이트 모드' : '다크 모드') + '</span>';
    }
    paint();
    btn.addEventListener('click', function () {
      var isDark = (global.ThemeManager ? global.ThemeManager.getTheme() : 'light') === 'dark';
      if (global.ThemeManager) global.ThemeManager.setTheme(isDark ? 'light' : 'dark', true);
      paint();
    });
    row.appendChild(btn);
    pane.appendChild(row);
  }

  // ---- 계정 탭 ----
  function renderAccountPane(pane) {
    pane.appendChild(el('h3', 'settings-pane-title', '계정'));
    var container = el('div', 'settings-account-container');
    pane.appendChild(container);
    if (global.AuthUI) global.AuthUI.renderAccountSettings(container);
  }

  // ---- 오디오 문학 탭 ----
  // 일반 탭과 같은 "왼쪽 라벨 / 오른쪽 컨트롤 + 아래 구분선" 행 구조
  // (.settings-row)를 그대로 쓴다.
  function renderAudioPane(pane) {
    pane.appendChild(el('h3', 'settings-pane-title', '오디오 문학'));

    var settings = global.AudioSettings ? global.AudioSettings.get() : { autoplay: true, volume: 1 };

    var autoplayRow = el('div', 'settings-row');
    var autoplayText = el('div', 'settings-row-text');
    autoplayText.appendChild(el('p', 'settings-row-label', '자동재생'));
    autoplayText.appendChild(el('p', 'settings-row-desc', '스크롤로 구간에 들어오면 배경음악을 자동으로 재생'));
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
    volumeRow.appendChild(el('p', 'settings-row-label', '음량'));

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

  var PANE_FADE_MS = 120;

  // 탭을 바꿀 때 내용을 바로 갈아치우지 않고, 살짝 페이드아웃한 뒤 새
  // 내용으로 채우고 다시 페이드인한다 — 급하게 뚝 끊기지 않게.
  function renderPane(tabId) {
    if (paneFadeTimer) clearTimeout(paneFadeTimer);
    var hasContent = !!paneEl.firstChild;
    function fill() {
      paneEl.innerHTML = '';
      if (tabId === 'general') renderGeneralPane(paneEl);
      else if (tabId === 'account') renderAccountPane(paneEl);
      else if (tabId === 'audio') renderAudioPane(paneEl);
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
