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
    btn.setAttribute('aria-label', '닫기');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 4L20 20M20 4L4 20" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/></svg>';
    btn.addEventListener('click', close);
    return btn;
  }

  // ---- SignIn ----
  function renderSignIn(card, opts) {
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

      global.BookmarkLibrary.claimAllByPersonalCode(raw)
        .then(function (items) {
          if (!items.length) {
            submitBtn.disabled = false;
            submitBtn.textContent = '로그인';
            showError('그래도 이 코드로 로그인되지 않았어요 — 코드가 틀렸는지, 이 코드로 아직 공개한 게 없는지는 구분할 수 없으니 코드를 다시 확인해주세요.');
            return;
          }
          // 이 페이지에 로컬 북마크(Bookmarks)가 있으면, 연결된 항목들을
          // 그 자리에서 복원한다 — 없는 페이지(mainPage.html 등)에서는
          // 개별 실패를 조용히 무시한다(로그인 자체는 이미 끝났으므로).
          var chain = Promise.resolve();
          items.forEach(function (entry) {
            chain = chain.then(function () {
              return global.BookmarkLibrary.restorePublishedToLocal(entry.code).catch(function () {});
            });
          });
          return chain.then(function () {
            close();
            if (opts.onSuccess) opts.onSuccess(normalized);
          });
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
    card.innerHTML = '';
    card.appendChild(closeButton());
    card.appendChild(el('h2', 'auth-title is-small', '잊어버리지 마세요!'));
    card.appendChild(el('p', 'auth-desc', '해당 코드를 잃어버릴시 앞으로 로그인이 힘들수도 있으니 미리 다른곳에 해당 코드를 적어두세요'));

    if (opts.reason) card.appendChild(el('p', 'auth-reason', opts.reason));

    var code = global.BookmarkLibrary.issueNewPersonalCode();
    card.appendChild(el('p', 'auth-code-display', global.BookmarkLibrary.formatPersonalCodeForDisplay(code)));

    var confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'auth-btn';
    confirmBtn.textContent = '확인';
    confirmBtn.addEventListener('click', function () {
      global.BookmarkLibrary.confirmPersonalCode(code);
      close();
      if (opts.onSuccess) opts.onSuccess(code);
    });
    card.appendChild(confirmBtn);

    var switchRow = el('p', 'auth-switch', '이미 코드가 있으신가요? ');
    var switchLink = document.createElement('button');
    switchLink.type = 'button';
    switchLink.className = 'auth-switch-link';
    switchLink.textContent = '로그인하기';
    switchLink.addEventListener('click', function () { renderSignIn(card, opts); });
    switchRow.appendChild(switchLink);
    card.appendChild(switchRow);
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

  global.AuthModal = {
    openSignIn: openSignIn,
    openSignUp: openSignUp,
    close: close
  };
})(window);
