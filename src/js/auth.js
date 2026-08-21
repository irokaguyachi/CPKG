/**
 * ChoKaguya Auth Header (헤더의 로그인/개인 코드 관리 버튼)
 * - src/js/theme.js 의 injectThemeToggle() 패턴을 따라, 페이지 로드 시
 *   .header-nav 에 버튼을 하나 주입한다(모든 페이지 공통 스크립트).
 * - 비로그인 상태: "로그인" 버튼 → src/js/authModal.js 의 로그인 모달(코드
 *   입력창). 거기서 "새로 발급받으세요!" 링크를 누르면 회원가입으로
 *   전환된다. 북마크 공개하기처럼 "먼저 회원가입부터"가 맞는 문맥에서는
 *   bookmarksPage.js 가 AuthModal.openSignUp() 을 직접 호출한다.
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

  function panelNote(text) {
    var p = document.createElement('p');
    p.className = 'bkm-share-note';
    p.textContent = text;
    return p;
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

    var migrateBtn = panelButton('이 브라우저의 기존 코드들을 여기 연결하기');
    panel.appendChild(migrateBtn);
    var migrateMsg = panelNote('');
    panel.appendChild(migrateMsg);
    migrateBtn.addEventListener('click', function () {
      migrateBtn.disabled = true;
      migrateMsg.textContent = '연결하는 중...';
      global.BookmarkLibrary.migrateExistingToPersonalCode()
        .then(function (result) {
          migrateBtn.disabled = false;
          if (!result.linked.length && !result.failed.length) {
            migrateMsg.textContent = '이 브라우저에 연결할 만한 기존 코드가 없어요.';
            return;
          }
          var msg = result.linked.length + '개 연결 완료';
          if (result.failed.length) msg += ' (' + result.failed.length + '개 실패, 잠시 후 다시 시도해주세요)';
          migrateMsg.textContent = msg + '!';
        })
        .catch(function (err) {
          migrateBtn.disabled = false;
          migrateMsg.textContent = err.message || '연결에 실패했어요.';
        });
    });

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
    btn.textContent = loggedIn ? '개인 코드 관리' : '로그인';
    btn.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (global.BookmarkLibrary.isLoggedIn()) {
        openManagePanel(btn);
      } else {
        global.AuthModal.openSignIn();
      }
    };
  }

  window.addEventListener('chokaguya:auth-change', function () {
    closeManagePanel();
    renderHeaderButton();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderHeaderButton);
  } else {
    renderHeaderButton();
  }
})(window);
