/**
 * ChoKaguya LoginId Modal (아이디 만들기·변경 창 + 코드만 있는 계정 안내)
 * - 개인 코드 로그인이 폐지되므로(마감: UserData.LOGIN_CODE_DEADLINE) 코드만 있는
 *   계정에게 아이디를 만들게 하고, 이미 아이디가 있는 계정은 쿨타임(1일)에 맞춰
 *   바꿀 수 있게 하는 창이다. 오버레이·카드 껍데기는 authModal.js 와 같은
 *   .auth-overlay/.auth-card 스타일을 그대로 쓴다.
 * - 안내 영역(헤더 프로필 메뉴·설정창 프로필 탭·계정 탭)은 mountNotice() 가 그린다.
 *   UserData.getLoginId() 는 아이디가 없으면 기억하지 않아 호출마다 서버에 묻기
 *   때문에, 이 파일이 결과를 하나의 Promise 로 공유해서 페이지당 한 번만 묻는다.
 *   로그인 상태/아이디가 바뀌면(chokaguya:auth-change · chokaguya:login-id-change)
 *   공유 결과를 버리고 안내 영역을 다시 판단한다.
 */
(function (global) {
  var t = global.I18n.t;
  var PROMPTED_KEY = 'chokaguya_login_id_prompted';
  var overlayEl = null;
  var cardEl = null;
  var openToken = 0; // 창을 다시 열거나 닫으면 늦게 도착한 응답이 화면을 덮지 않게 한다

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function userData() { return global.UserData; }

  function isLoggedIn() {
    return !!(global.BookmarkLibrary && global.BookmarkLibrary.isLoggedIn());
  }

  function isBeforeDeadline() {
    return !!(userData() && userData().isBeforeLoginCodeDeadline && userData().isBeforeLoginCodeDeadline());
  }

  // ---- 공유 상태 ----
  var statusPromise = null;

  function getStatus(opts) {
    if (!isLoggedIn() || !userData() || !userData().getLoginId) {
      return Promise.resolve({ loginId: null, changeableAt: 0 });
    }
    if ((opts && opts.fresh) || !statusPromise) {
      statusPromise = userData().getLoginId(opts && opts.fresh ? { fresh: true } : undefined).then(null, function () {
        // 서버에 못 물어도 화면은 그려야 한다 — 서버가 한 번 더 막아 준다
        return { loginId: null, changeableAt: 0 };
      });
    }
    return statusPromise;
  }

  function resetStatus() { statusPromise = null; }

  // 이 파일의 리스너가 가장 먼저 등록되므로(스크립트 로드 순서) 다른 리스너가 돌기 전에 비워진다
  global.addEventListener('chokaguya:auth-change', resetStatus);
  global.addEventListener('chokaguya:login-id-change', resetStatus);

  // ---- 안내 영역 ----
  function mountNotice(container) {
    var node = el('div', 'login-id-notice auth-reason');
    node.hidden = true;
    node.appendChild(el('p', 'login-id-notice-text', t('이제 로그인 코드는 폐지됩니다! 아이디를 변경하세요! 11월 30일 오후 11:59에 변경하지 않은 로그인 코드는 계정이 삭제됩니다!')));
    var btn = el('button', 'settings-btn is-primary', t('아이디 만들기'));
    btn.type = 'button';
    btn.addEventListener('click', function () { global.LoginIdModal.open({ mode: 'create' }); });
    node.appendChild(btn);
    container.appendChild(node);

    var token = 0;
    function refresh() {
      var mine = ++token;
      if (!isLoggedIn() || !isBeforeDeadline()) { node.hidden = true; return; }
      getStatus().then(function (status) {
        if (mine !== token) return;
        node.hidden = !!status.loginId || !isLoggedIn();
      });
    }
    function onChange() {
      // 화면에서 사라진 안내(메뉴가 다시 그려진 뒤)는 리스너도 거둔다
      if (node.isConnected === false) {
        global.removeEventListener('chokaguya:auth-change', onChange);
        global.removeEventListener('chokaguya:login-id-change', onChange);
        return;
      }
      refresh();
    }
    global.addEventListener('chokaguya:auth-change', onChange);
    global.addEventListener('chokaguya:login-id-change', onChange);
    refresh();
    return node;
  }

  // ---- 창 ----
  function close() {
    openToken++;
    if (overlayEl) overlayEl.classList.remove('is-open');
  }

  function ensureCard() {
    if (overlayEl) return cardEl;
    overlayEl = el('div', 'auth-overlay');
    overlayEl.addEventListener('click', function (e) { if (e.target === overlayEl) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    cardEl = el('div', 'auth-card');
    // authModal.js 와 같은 이유로, 카드 안 클릭이 document 의 바깥 클릭 리스너까지 번지지 않게 끊는다
    cardEl.addEventListener('click', function (e) { e.stopPropagation(); });
    overlayEl.appendChild(cardEl);
    document.body.appendChild(overlayEl);
    return cardEl;
  }

  function closeButton() {
    var btn = el('button', 'pds-close');
    btn.type = 'button';
    btn.setAttribute('aria-label', t('닫기'));
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 4L20 20M20 4L4 20" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/></svg>';
    btn.addEventListener('click', close);
    return btn;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // userData.js 의 formatRetryTime 과 같은 번역 틀(다른 언어에서 '월/일'이 그대로 나오지 않게).
  function formatTime(ms) {
    var d = new Date(ms);
    return t('{month}월 {day}일 {hh}:{mm}', {
      month: d.getMonth() + 1, day: d.getDate(), hh: pad2(d.getHours()), mm: pad2(d.getMinutes())
    });
  }

  // 화면 공유·캡처에 아이디(= 로그인 열쇠)가 다 드러나지 않게 앞 두 글자만 보인다. 'dandelion' → 'da•••'.
  // 길이도 숨기려고 뒤는 늘 같은 개수로 가린다. 전체 아이디는 설정창 계정 탭에서만 보인다.
  function maskLoginId(loginId) {
    if (!loginId) return '';
    return String(loginId).slice(0, 2) + '\u2022\u2022\u2022';
  }

  function renderForm(card, mode, status) {
    var isChange = mode === 'change';
    card.innerHTML = '';
    card.appendChild(closeButton());
    card.appendChild(el('h2', 'auth-title is-small', isChange ? t('아이디 변경') : t('아이디를 만들어 주세요')));
    if (isChange) {
      if (status.loginId) card.appendChild(el('p', 'auth-desc', t('현재 아이디: {id}', { id: status.loginId })));
    } else {
      card.appendChild(el('p', 'auth-desc', t('이제 로그인 코드는 폐지됩니다! 아이디를 변경하세요! 11월 30일 오후 11:59에 변경하지 않은 로그인 코드는 계정이 삭제됩니다!')));
    }
    card.appendChild(el('p', 'auth-desc', t('영문 소문자, 숫자, _ 로 4~20자')));

    var form = el('form', 'auth-form-row');
    var wrap = el('div', 'auth-input-wrap');
    var input = el('input', 'auth-input');
    input.type = 'text';
    input.name = 'username';
    input.autocomplete = 'username';
    input.placeholder = t('아이디 입력창');
    wrap.appendChild(input);
    var submitBtn = el('button', 'auth-btn', isChange ? t('변경') : t('아이디 만들기'));
    submitBtn.type = 'submit';
    form.appendChild(wrap);
    form.appendChild(submitBtn);
    card.appendChild(form);

    var errorEl = el('p', 'auth-error');
    errorEl.hidden = true;
    card.appendChild(errorEl);

    // 쿨타임 중이면 잠근다 — 서버도 429 로 막지만 눌러 보기 전에 알려 준다
    var locked = isChange && status.changeableAt > Date.now();
    if (locked) {
      input.disabled = true;
      submitBtn.disabled = true;
      card.appendChild(el('p', 'auth-reason', t('{time} 이후에 다시 바꿀 수 있어요.', { time: formatTime(status.changeableAt) })));
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (input.disabled || submitBtn.disabled) return;
      var mine = openToken;
      errorEl.hidden = true;
      submitBtn.disabled = true;
      submitBtn.textContent = t('확인하는 중...');
      userData().setLoginId(input.value).then(function (result) {
        if (mine !== openToken) return;
        renderDone(card, result.loginId);
      }, function (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = isChange ? t('변경') : t('아이디 만들기');
        errorEl.textContent = (err && err.message) || t('로그인에 실패했어요.');
        errorEl.hidden = false;
      });
    });

    if (!locked) input.focus();
  }

  function renderDone(card, loginId) {
    card.innerHTML = '';
    card.appendChild(closeButton());
    card.appendChild(el('h2', 'auth-title is-small', t('이제 {id} 아이디로 로그인할 수 있어요', { id: loginId })));
    var ok = el('button', 'auth-btn', t('확인'));
    ok.type = 'button';
    ok.addEventListener('click', close);
    card.appendChild(ok);
  }

  // mode: 'create'(코드 → 아이디 전환) | 'change'(이미 있는 아이디 바꾸기).
  // create 로 열어도 서버에 이미 아이디가 있으면 change 로 바꿔 그린다.
  // 화면이 그려지면 끝나는 Promise 를 돌려준다.
  function open(opts) {
    opts = opts || {};
    if (!isLoggedIn()) return Promise.resolve();
    var card = ensureCard();
    var mine = ++openToken;
    var mode = opts.mode === 'change' ? 'change' : 'create';
    card.innerHTML = '';
    card.appendChild(closeButton());
    card.appendChild(el('p', 'auth-desc', t('확인하는 중...')));
    overlayEl.classList.add('is-open');

    // 변경 창은 쿨타임 잠금이 정확해야 하므로 서버에 새로 묻는다
    return getStatus(mode === 'change' ? { fresh: true } : undefined).then(function (status) {
      if (mine !== openToken) return;
      if (mode === 'create' && status.loginId) {
        return getStatus({ fresh: true }).then(function (fresh) {
          if (mine !== openToken) return;
          renderForm(card, 'change', fresh);
        });
      }
      renderForm(card, mode, status);
    });
  }

  // 로그인 상태 + 마감 전 + 아이디 없음 + 이번 세션에 아직 안 열었을 때만 연다.
  function maybeAutoOpen() {
    var prompted = false;
    try { prompted = global.sessionStorage.getItem(PROMPTED_KEY) === '1'; } catch (e) {}
    if (prompted || !isLoggedIn() || !isBeforeDeadline()) return Promise.resolve(false);
    return getStatus().then(function (status) {
      if (status.loginId || !isLoggedIn()) return false;
      try { global.sessionStorage.setItem(PROMPTED_KEY, '1'); } catch (e) {}
      open({ mode: 'create' });
      return true;
    });
  }

  global.LoginIdModal = {
    open: open,
    close: close,
    maybeAutoOpen: maybeAutoOpen,
    getStatus: getStatus,
    mountNotice: mountNotice,
    maskLoginId: maskLoginId
  };

  // 페이지마다 한 번 — defer 스크립트는 DOMContentLoaded 전에 실행되므로 그때까지 기다린다
  function start() { maybeAutoOpen().then(null, function () {}); }
  if (document.readyState === 'loading' || document.readyState === 'interactive') {
    document.addEventListener('DOMContentLoaded', start);
  } else if (document.readyState === 'complete') {
    start();
  }
})(window);
