/**
 * ChoKaguya Auth Header (헤더의 로그인/개인 코드 관리 버튼)
 * - src/js/theme.js 의 injectThemeToggle() 패턴을 따라, 페이지 로드 시
 *   .header-nav 에 버튼을 하나 주입한다(모든 페이지 공통 스크립트).
 * - 비로그인 상태: "로그인" 버튼 → src/js/authModal.js 의 로그인 모달(코드
 *   입력창). 거기서 "새로 발급받으세요!" 링크를 누르면 회원가입으로
 *   전환된다. 북마크처럼 로그인이 필요한 다른 기능들(bookmarkPicker.js,
 *   bookmarksPage.js)도 AuthModal.requireLogin() 을 통해 같은 로그인
 *   화면부터 띄운다 — 회원가입 화면을 먼저 보여주면, 이미 계정이 있는데
 *   지금 로그아웃 상태인 사람이 새로 뜬 코드를 그대로 확정해 버려 쓰지도
 *   않을 계정이 서버에 하나 더 생기기 때문이다.
 * - 로그인 상태: "개인 코드 관리" 버튼 → 버튼 옆에 뜨는 작은 패널(코드
 *   보기·복사, 기존 코드 마이그레이션, 로그아웃). 이 패널은 딤 배경이 없는
 *   앵커 팝오버라서, bookmarksPage.js 의 openSharePanel/ensureSharePanel
 *   패턴(document.body 싱글턴, position:fixed + getBoundingClientRect)을
 *   그대로 재사용했다.
 * - window 의 'chokaguya:auth-change' 이벤트(bookmarkLibrary.js 가 로그인/
 *   로그아웃 시 발생시킴)를 들어서, 새로고침 없이 버튼을 다시 그린다.
 */
(function (global) {
  var manageEl = null;
  var manageBound = false;

  function ensureManagePanel() {
    if (manageEl) return manageEl;
    manageEl = document.createElement('div');
    manageEl.className = 'bkm-picker auth-manage-panel';
    manageEl.addEventListener('click', function (e) { e.stopPropagation(); });
    document.body.appendChild(manageEl);
    if (!manageBound) {
      document.addEventListener('click', closeManagePanel);
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeManagePanel();
      });
      manageBound = true;
    }
    return manageEl;
  }

  function closeManagePanel() {
    if (manageEl) manageEl.classList.remove('is-open');
  }

  function positionManagePanel(anchorEl) {
    var rect = anchorEl.getBoundingClientRect();
    var panelW = manageEl.offsetWidth || 280;
    var left = Math.max(8, Math.min(rect.right - panelW, global.innerWidth - panelW - 8));
    var top = Math.min(rect.bottom + 8, global.innerHeight - 8);
    manageEl.style.left = Math.round(left) + 'px';
    manageEl.style.top = Math.round(top) + 'px';
  }

  function panelHeader(text) {
    var header = document.createElement('div');
    header.className = 'sfp-header';
    header.textContent = text;
    return header;
  }

  function panelButton(label, variant) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bkm-share-btn' + (variant ? ' ' + variant : '');
    btn.textContent = label;
    return btn;
  }

  function openManagePanel(anchorEl) {
    var panel = ensureManagePanel();
    panel.innerHTML = '';
    panel.appendChild(panelHeader('개인 코드 관리'));

    var codeRow = document.createElement('div');
    codeRow.className = 'bkm-inline-create';
    var codeInput = document.createElement('input');
    codeInput.type = 'text';
    codeInput.className = 'bkm-share-code';
    codeInput.readOnly = true;
    codeInput.value = global.BookmarkLibrary.formatPersonalCodeForDisplay(global.BookmarkLibrary.getPersonalCode() || '');
    codeInput.addEventListener('focus', function () { codeInput.select(); });
    codeRow.appendChild(codeInput);
    panel.appendChild(codeRow);

    var copyBtn = panelButton('복사');
    copyBtn.addEventListener('click', function () {
      codeInput.focus();
      codeInput.select();
      var text = codeInput.value;
      var showCopied = function () {
        copyBtn.textContent = '복사됨!';
        setTimeout(function () { copyBtn.textContent = '복사'; }, 1500);
      };
      if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
        global.navigator.clipboard.writeText(text).then(showCopied).catch(function () {});
      } else {
        try { document.execCommand('copy'); showCopied(); } catch (e) {}
      }
    });
    panel.appendChild(copyBtn);

    var logoutBtn = panelButton('로그아웃', 'is-danger');
    logoutBtn.addEventListener('click', function () {
      if (!global.confirm('로그아웃할까요? 이 브라우저의 개인 코드가 지워져요. 다시 로그인하려면 그 코드를 알고 있어야 해요(단, 이 브라우저가 직접 관리 코드를 쥔 게시물은 로그아웃 후에도 계속 관리할 수 있어요).')) return;
      global.BookmarkLibrary.logout();
      closeManagePanel();
    });
    panel.appendChild(logoutBtn);

    positionManagePanel(anchorEl);
    panel.classList.add('is-open');
  }

  var LOGIN_ICON = '<svg class="auth-icon-login" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>';
  var MANAGE_ICON = '<svg class="auth-icon-manage" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

  // 클라우드 동기화가 지금 어떤 상태인지 — 로컬에만 저장됐는데 저장됐다고
  // 믿는 상황을 막는 게 목적이라, 로그인 상태에서만 띄운다. 자동 동기화가
  // 없으므로(userData.js) 이 뱃지는 곧 버튼이다 — 눌러야 실제로 맞춰진다.
  var SYNC_STATE_LABELS = {
    synced: '동기화됨',
    pending: '동기화 필요 · 눌러서 동기화',
    syncing: '동기화 중...',
    cooldown: '동기화 쿨타임중..',
    offline: '오프라인 (이 기기에만 저장 중)',
    error: '동기화 실패 · 다시 눌러보세요'
  };

  function renderSyncBadge(nav, loggedIn) {
    var badge = nav.querySelector('.auth-sync-badge');
    if (!loggedIn) {
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('button');
      badge.type = 'button';
      badge.className = 'auth-sync-badge';
      badge.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (global.UserData) global.UserData.requestSync();
      });
    }
    // userData.js 의 초기 상태 이벤트(chokaguya:sync-state)가 스크립트 로드
    // 순서상 renderHeaderButton 보다 먼저 도착할 수 있어(로그인된 채로
    // 페이지를 새로고침한 경우 흔함), 그때는 이 뱃지가 개인 코드 관리
    // 버튼보다 먼저 nav 에 붙어버린다. 매번 그 버튼 바로 뒤로 강제
    // 재배치해서 순서를 고정한다.
    var authBtn = nav.querySelector('.auth-header-btn');
    if (authBtn) {
      authBtn.insertAdjacentElement('afterend', badge);
    } else if (!badge.parentNode) {
      nav.appendChild(badge);
    }
    var state = (global.UserData && global.UserData.getStatus()) || 'offline';
    var label = SYNC_STATE_LABELS[state] || SYNC_STATE_LABELS.offline;
    badge.className = 'auth-sync-badge is-' + state;
    badge.title = label;
    badge.setAttribute('aria-label', '클라우드 동기화 상태: ' + label + '. 눌러서 지금 동기화');
    badge.innerHTML = '<span class="auth-sync-dot" aria-hidden="true"></span>' +
      '<span class="auth-sync-badge-label">' + label + '</span>';
  }

  function renderHeaderButton() {
    var nav = document.querySelector('.header-nav');
    if (!nav) return;
    var loggedIn = global.BookmarkLibrary.isLoggedIn();

    var btn = nav.querySelector('.auth-header-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'auth-header-btn';
      nav.appendChild(btn);
    }
    btn.classList.toggle('is-logged-in', loggedIn);
    var icon = loggedIn ? MANAGE_ICON : LOGIN_ICON;
    var text = loggedIn ? '개인 코드 관리' : '로그인';
    btn.innerHTML = icon + '<span class="auth-header-btn-label">' + text + '</span>';
    btn.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (global.BookmarkLibrary.isLoggedIn()) {
        openManagePanel(btn);
      } else {
        global.AuthModal.openSignIn();
      }
    };

    renderSyncBadge(nav, loggedIn);
  }

  window.addEventListener('chokaguya:auth-change', function () {
    closeManagePanel();
    renderHeaderButton();
  });

  window.addEventListener('chokaguya:sync-state', function () {
    var nav = document.querySelector('.header-nav');
    if (nav) renderSyncBadge(nav, global.BookmarkLibrary.isLoggedIn());
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderHeaderButton);
  } else {
    renderHeaderButton();
  }
})(window);
