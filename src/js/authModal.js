/**
 * ChoKaguya Auth Modal (로그인/회원가입)
 * - 개인 코드(src/js/bookmarkLibrary.js)를 "로그인" UX로 감싸는 모달.
 *   회원가입은 순수 로컬 동작(코드를 만들어 저장할 뿐, 서버 호출 없음)이고,
 *   로그인은 서버(/owner/lookup)에서 그 코드에 연결된 목록을 받아와 로컬로
 *   복원한다.
 * - src/js/postDetailSeries.js 의 싱글턴 오버레이 패턴(document.body 에 한
 *   번만 append, 바깥클릭/Escape 로 닫힘, .is-open 토글)을 그대로 본떴다.
 * - Figma "개인 공간" 파일의 SignInFrame/SignUpFrame(node #2222) 디자인을
 *   반영(CSS: src/css/components/auth.css 의 .auth-* 규칙).
 */
(function (global) {
  var overlayEl = null;
  // 회원가입 확인 화면(발급된 개인 코드를 보여주는 단계)은 코드를 못 보고
  // 나가버리면 되돌릴 수 없으니, 바깥 클릭/Escape/X 로 못 닫게 잠근다 —
  // "확인" 버튼을 눌러야만 나갈 수 있다. 다른 화면(로그인 등)은 그대로
  // 자유롭게 닫힌다.
  var dismissible = true;

  function ensureOverlay() {
    if (overlayEl) return overlayEl;
    overlayEl = document.createElement('div');
    overlayEl.className = 'auth-overlay';
    overlayEl.addEventListener('click', function (e) {
      if (e.target === overlayEl && dismissible) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && dismissible) close();
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
    btn.setAttribute('aria-label', '닫기');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 4L20 20M20 4L4 20" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/></svg>';
    btn.addEventListener('click', close);
    return btn;
  }

  // ---- SignIn ----
  function renderSignIn(card, opts) {
    dismissible = true;
    card.innerHTML = '';
    card.appendChild(closeButton());
    card.appendChild(el('h2', 'auth-title', '로그인'));

    if (opts.reason) card.appendChild(el('p', 'auth-reason', opts.reason));

    var row = el('div', 'auth-form-row');
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'auth-input';
    input.placeholder = '로그인 코드 입력창';
    input.autocomplete = 'off';
    var submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.className = 'auth-btn';
    submitBtn.textContent = '로그인';
    row.appendChild(input);
    row.appendChild(submitBtn);
    card.appendChild(row);

    var errorEl = el('p', 'auth-error');
    errorEl.hidden = true;
    card.appendChild(errorEl);

    function showError(message) {
      errorEl.textContent = message;
      errorEl.hidden = false;
    }

    function submit() {
      var raw = input.value;
      var normalized = global.BookmarkLibrary.normalizePersonalCode(raw);
      if (normalized.length < 16) {
        showError('개인 코드 형식이 올바르지 않아요. 20자리 코드를 정확히 입력해주세요.');
        return;
      }
      errorEl.hidden = true;
      submitBtn.disabled = true;
      submitBtn.textContent = '확인하는 중...';

      // 서버에 계정이 있으면 북마크가 0개여도 로그인 성공이다. 예전엔 공개한
      // 게시물 목록이 비어 있으면 실패로 돌렸는데, 그게 갓 가입한 사람이 다른
      // 기기에서 절대 로그인하지 못하던 원인이었다.
      global.UserData.login(raw)
        .then(function () {
          close();
          if (opts.onSuccess) opts.onSuccess(normalized);
        })
        .catch(function (err) {
          submitBtn.disabled = false;
          submitBtn.textContent = '로그인';
          showError(err.message || '로그인에 실패했어요.');
        });
    }

    submitBtn.addEventListener('click', submit);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });

    var switchRow = el('p', 'auth-switch', '로그인 코드가 없으신가요? ');
    var switchLink = document.createElement('button');
    switchLink.type = 'button';
    switchLink.className = 'auth-switch-link';
    switchLink.textContent = '새로 발급받으세요!';
    switchLink.addEventListener('click', function () { renderSignUp(card, opts); });
    switchRow.appendChild(switchLink);
    card.appendChild(switchRow);

    input.focus();
  }

  // ---- SignUp ----
  function renderSignUp(card, opts) {
    // 방금 발급된 코드는 이 화면을 벗어나면 다시 볼 수 없다 — 실수로
    // 바깥을 클릭하거나 Escape 를 누르거나 X 를 눌러서 코드를 못 본 채
    // 나가버리는 일이 없도록, "확인" 버튼을 눌러야만 닫히게 한다.
    dismissible = false;
    card.innerHTML = '';
    card.appendChild(el('h2', 'auth-title is-small', '잊어버리지 마세요!'));
    card.appendChild(el('p', 'auth-desc', '해당 코드를 잃어버릴시 앞으로 로그인이 힘들수도 있으니 미리 다른곳에 해당 코드를 적어두세요'));

    if (opts.reason) card.appendChild(el('p', 'auth-reason', opts.reason));

    var code = global.BookmarkLibrary.issueNewPersonalCode();
    card.appendChild(el('p', 'auth-code-display', global.BookmarkLibrary.formatPersonalCodeForDisplay(code)));

    var confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'auth-btn';
    confirmBtn.textContent = '확인';
    card.appendChild(confirmBtn);

    var errorEl = el('p', 'auth-error');
    errorEl.hidden = true;
    card.appendChild(errorEl);

    confirmBtn.addEventListener('click', function () {
      errorEl.hidden = true;
      confirmBtn.disabled = true;
      confirmBtn.textContent = '계정을 만드는 중...';
      // 서버에 계정이 생긴 걸 확인한 뒤에야 이 기기가 코드를 채택한다 —
      // 순서가 반대면 가입은 된 것처럼 보이는데 다른 기기에선 못 찾는다
      global.UserData.signup(code)
        .then(function () {
          close();
          if (opts.onSuccess) opts.onSuccess(code);
        })
        .catch(function (err) {
          confirmBtn.disabled = false;
          confirmBtn.textContent = '확인';
          errorEl.textContent = err.message || '계정을 만들지 못했어요. 인터넷 연결을 확인해주세요.';
          errorEl.hidden = false;
        });
    });

    // "이미 코드가 있으신가요? 로그인하기" 링크는 일부러 안 넣는다 — 이
    // 화면은 확인 버튼으로만 나가야 하므로, 로그인 화면으로 새는 경로도
    // 열어두면 안 된다.
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
  // 반드시 로그인 화면을 먼저 보여준다. 회원가입 화면을 먼저 띄우면 새 코드가
  // 곧바로 눈앞에 뜨는데, 이미 계정이 있는 사람(다른 기기에서 왔거나 로그아웃
  // 상태인 사람)이 그걸 그대로 확정해 버리면 쓰지도 않을 계정이 서버에 하나 더
  // 생기고, 원래 쓰던 북마크와도 갈라진다. 코드가 없는 사람은 로그인 화면의
  // "새로 발급받으세요!" 링크로 넘어가면 되고, 그때 opts 도 그대로 따라간다.
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
