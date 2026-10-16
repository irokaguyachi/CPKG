/**
 * ChoKaguya Auth Modal (로그인/회원가입)
 * - 유저가 정한 아이디로 로그인·가입하는 모달(UserData.loginWithId/signupWithId).
 *   내부적으로는 서버가 아이디를 예전 개인 코드에 대응시켜 계정을 찾는다. 마감
 *   (UserData.LOGIN_CODE_DEADLINE) 전에는 "기존 로그인 코드로 로그인" 경로가 남아 있고,
 *   성공하면 src/js/components/loginIdModal.js 의 아이디 만들기 창으로 넘어간다.
 * - src/js/components/postDetailSeries.js 의 싱글턴 오버레이 패턴(document.body 에 한
 *   번만 append, 바깥클릭/Escape 로 닫힘, .is-open 토글)을 그대로 본떴다.
 * - Figma "개인 공간" 파일의 SignInFrame/SignUpFrame(node #2222) 디자인을
 *   반영(CSS: src/css/components/auth.css 의 .auth-* 규칙).
 */
(function (global) {
  var t = global.I18n.t;
  var overlayEl = null;

  function ensureOverlay() {
    if (overlayEl) return overlayEl;
    overlayEl = document.createElement('div');
    overlayEl.className = 'auth-overlay';
    overlayEl.addEventListener('click', function (e) {
      if (e.target === overlayEl) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
    document.body.appendChild(overlayEl);
    return overlayEl;
  }

  function close() {
    if (!overlayEl) return;
    overlayEl.classList.remove('is-open');
  }

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

  var EYE_OPEN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_CLOSED_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.77 21.77 0 0 1 5.06-6.06M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a21.77 21.77 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  // 입력창을 type=password 로 감춰서 브라우저 비밀번호 관리자가 저장 후보로
  // 인식하게 만든 자리에 붙이는 눈 아이콘 — 지금 뭘 쳤는지 확인하고 싶을 때
  // 평문으로 잠깐 바꿔볼 수 있게 한다.
  function createRevealToggle(inputEl) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'auth-input-toggle';
    btn.setAttribute('aria-label', t('입력한 코드 표시'));
    btn.innerHTML = EYE_OPEN_ICON;
    btn.addEventListener('click', function () {
      var isRevealed = inputEl.type === 'text';
      inputEl.type = isRevealed ? 'password' : 'text';
      btn.innerHTML = isRevealed ? EYE_OPEN_ICON : EYE_CLOSED_ICON;
      btn.setAttribute('aria-label', isRevealed ? t('입력한 코드 표시') : t('입력한 코드 숨기기'));
      inputEl.focus();
    });
    return btn;
  }

  // ---- 아이디 입력 화면 공통 ----
  // 로그인과 가입이 같은 모양(아이디 입력칸 + 제출 버튼 + 오류 줄)이라 한 곳에서 만든다.
  // 입력칸은 autocomplete=username 으로 둬서 브라우저가 아이디를 기억해 준다.
  function idForm(card, submitLabel, busyLabel, action, opts, presetError) {
    var row = document.createElement('form');
    row.className = 'auth-form-row';
    var inputWrap = document.createElement('div');
    inputWrap.className = 'auth-input-wrap';
    var input = document.createElement('input');
    input.type = 'text';
    input.name = 'username';
    input.className = 'auth-input';
    input.placeholder = t('아이디 입력창');
    input.autocomplete = 'username';
    inputWrap.appendChild(input);
    var submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'auth-btn';
    submitBtn.textContent = submitLabel;
    row.appendChild(inputWrap);
    row.appendChild(submitBtn);
    card.appendChild(row);

    var errorEl = el('p', 'auth-error');
    errorEl.hidden = true;
    card.appendChild(errorEl);

    function showError(message) {
      errorEl.textContent = message;
      errorEl.hidden = false;
    }
    if (presetError) showError(presetError);

    row.addEventListener('submit', function (e) {
      e.preventDefault();
      errorEl.hidden = true;
      submitBtn.disabled = true;
      submitBtn.textContent = busyLabel;
      action(input.value).then(function (code) {
        close();
        if (opts.onSuccess) opts.onSuccess(code);
      }, function (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = submitLabel;
        showError((err && err.message) || t('로그인에 실패했어요.'));
      });
    });
    return input;
  }

  function linkButton(label, onClick) {
    var link = document.createElement('button');
    link.type = 'button';
    link.className = 'auth-switch-link';
    link.textContent = label;
    link.addEventListener('click', onClick);
    return link;
  }

  // ---- SignIn ----
  function renderSignIn(card, opts, presetError) {
    card.innerHTML = '';
    card.appendChild(closeButton());
    card.appendChild(el('h2', 'auth-title', t('로그인')));

    if (opts.reason) card.appendChild(el('p', 'auth-reason', opts.reason));

    var input = idForm(card, t('로그인'), t('확인하는 중...'), function (id) {
      return global.UserData.loginWithId(id);
    }, opts, presetError);

    var switchRow = el('p', 'auth-switch', t('계정이 없으신가요?') + ' ');
    switchRow.appendChild(linkButton(t('새로 만들기'), function () { renderSignUp(card, opts); }));
    card.appendChild(switchRow);

    // 마감 전에만 — 예전 20자리 코드로 들어와 아이디를 만들 수 있는 마지막 통로
    if (global.UserData.isBeforeLoginCodeDeadline()) {
      var legacyRow = el('p', 'auth-switch');
      legacyRow.appendChild(linkButton(t('기존 로그인 코드로 로그인'), function () { renderCodeSignIn(card, opts); }));
      card.appendChild(legacyRow);
    }

    input.focus();
  }

  // ---- SignUp ----
  // 아이디만 정하면 곧바로 로그인된다(20자리 코드 확인 화면은 없다). 서버 가입이 실패하면
  // (중복·형식 오류·IP 한도) 같은 화면에서 오류만 보여 준다.
  function renderSignUp(card, opts) {
    card.innerHTML = '';
    card.appendChild(closeButton());
    card.appendChild(el('h2', 'auth-title', t('새로 만들기')));
    if (opts.reason) card.appendChild(el('p', 'auth-reason', opts.reason));
    card.appendChild(el('p', 'auth-desc', t('영문 소문자, 숫자, _ 로 4~20자')));

    var input = idForm(card, t('가입'), t('확인하는 중...'), function (id) {
      return global.UserData.signupWithId(id);
    }, opts);

    var switchRow = el('p', 'auth-switch', t('이미 계정이 있으신가요?') + ' ');
    switchRow.appendChild(linkButton(t('아이디로 로그인'), function () { renderSignIn(card, opts); }));
    card.appendChild(switchRow);

    input.focus();
  }

  // ---- 예전 로그인 코드로 로그인 (마감 전까지) ----
  // 성공하면 곧바로 아이디 만들기 창으로 넘어간다.
  function renderCodeSignIn(card, opts) {
    card.innerHTML = '';
    card.appendChild(closeButton());
    card.appendChild(el('h2', 'auth-title', t('기존 로그인 코드로 로그인')));

    // 개인 코드를 비밀번호 필드로 취급 — type=password + autocomplete=current-password
    // 로 감싸야 브라우저 비밀번호 관리자가 저장·자동완성을 해 준다. 눈 아이콘으로
    // 지금 친 코드를 확인할 수 있다.
    var row = document.createElement('form');
    row.className = 'auth-form-row';
    var inputWrap = document.createElement('div');
    inputWrap.className = 'auth-input-wrap';
    var input = document.createElement('input');
    input.type = 'password';
    input.name = 'password';
    input.className = 'auth-input';
    input.placeholder = t('로그인 코드 입력창');
    input.autocomplete = 'current-password';
    inputWrap.appendChild(input);
    inputWrap.appendChild(createRevealToggle(input));
    var submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'auth-btn';
    submitBtn.textContent = t('로그인');
    row.appendChild(inputWrap);
    row.appendChild(submitBtn);
    card.appendChild(row);

    var errorEl = el('p', 'auth-error');
    errorEl.hidden = true;
    card.appendChild(errorEl);

    function showError(message) {
      errorEl.textContent = message;
      errorEl.hidden = false;
    }

    row.addEventListener('submit', function (e) {
      e.preventDefault();
      var raw = input.value;
      var normalized = global.BookmarkLibrary.normalizePersonalCode(raw);
      if (normalized.length < 16) {
        showError(t('개인 코드 형식이 올바르지 않아요. 20자리 코드를 정확히 입력해주세요.'));
        return;
      }
      errorEl.hidden = true;
      submitBtn.disabled = true;
      submitBtn.textContent = t('확인하는 중...');

      // 서버에 계정이 있으면 북마크가 0개여도 로그인 성공이다.
      global.UserData.login(raw)
        .then(function () {
          close();
          if (global.LoginIdModal) global.LoginIdModal.open({ mode: 'create' });
          if (opts.onSuccess) opts.onSuccess(normalized);
        })
        .catch(function (err) {
          submitBtn.disabled = false;
          submitBtn.textContent = t('로그인');
          showError(err.message || t('로그인에 실패했어요.'));
        });
    });

    var switchRow = el('p', 'auth-switch');
    switchRow.appendChild(linkButton(t('아이디로 로그인'), function () { renderSignIn(card, opts); }));
    card.appendChild(switchRow);

    input.focus();
  }

  function openWith(renderFn, opts) {
    opts = opts || {};
    var overlay = ensureOverlay();
    var card = overlay.querySelector('.auth-card');
    if (!card) {
      card = document.createElement('div');
      card.className = 'auth-card';
      // 이 카드 안 클릭이 document까지 버블링되면, 다른 UI(bookmarksPage.js의
      // 공유 패널 등)가 document 클릭 리스너로 "바깥 클릭 시 닫기"를 구현해둔
      // 경우 그 패널이 엉뚱하게 닫혀버릴 수 있다(오버레이가 닫히기 전 이미
      // 열어둔 패널이 함께 닫히는 문제). 여기서 끊는다.
      card.addEventListener('click', function (e) { e.stopPropagation(); });
      overlay.appendChild(card);
    }
    renderFn(card, opts);
    overlay.classList.add('is-open');
  }

  function openSignIn(opts) { openWith(renderSignIn, opts); }
  function openSignUp(opts) { openWith(renderSignUp, opts); }

  // 로그인이 필요한 동작의 공통 관문 — 이미 로그인돼 있으면 곧바로
  // 실행하고, 아니면 모달을 띄운 뒤 완료 시점에 이어서 실행한다.
  //
  // 반드시 로그인 화면을 먼저 보여준다. 이미 계정이 있는 사람(다른 기기에서 왔거나
  // 로그아웃 상태인 사람)이 가입 화면에서 새 계정을 만들어 버리면 원래 쓰던 북마크와
  // 갈라진다. 계정이 없는 사람은 로그인 화면의 "새로 만들기" 링크로 넘어가면 되고,
  // 그때 opts 도 그대로 따라간다.
  function requireLogin(opts) {
    opts = opts || {};
    if (global.BookmarkLibrary && global.BookmarkLibrary.isLoggedIn()) {
      if (opts.onSuccess) opts.onSuccess();
      return true;
    }
    openSignIn({
      reason: opts.reason,
      onSuccess: function () { if (opts.onSuccess) opts.onSuccess(); }
    });
    return false;
  }

  global.AuthModal = {
    openSignIn: openSignIn,
    openSignUp: openSignUp,
    requireLogin: requireLogin,
    close: close
  };
})(window);
