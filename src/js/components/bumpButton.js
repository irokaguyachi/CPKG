/**
 * ChoKaguya Bump Button (끌올)
 * - bookmarkPicker.js의 북마크 버튼 바로 옆에 붙는 버튼. 로그인한 계정이
 *   문학/시리즈/명예관/번역/공식 중 하나를 골라 사이트 맨 위(mainPage.js의
 *   끌올 배너)에 최대 1시간 동안 노출시켜 달라고 신청한다.
 * - 한 번에 하나만 활성화되는 진짜 줄서기 큐다 — 서버(worker/
 *   favoritesShareWorker.js, D1 bumps 테이블)가 신청 순서대로 1시간씩 구간을
 *   내주고, 계정(personalCode)당 10분에 한 번만 신청할 수 있다. 이미
 *   활성/대기 중인 항목을 또 신청하면 거부된다.
 * - 상태 조회(POST /bump/get)는 20초마다 폴링해서 window에
 *   'chokaguya:bump-change' 커스텀 이벤트로 뿌린다 — 이 버튼들의 "지금
 *   끌올 중" 표시와 mainPage.js의 배너가 같은 폴링 하나를 공유한다
 *   (bookmarkPicker.js의 refreshButtons/chokaguya:bookmarks-change와 같은
 *   구조). 신청 자체(POST /bump/request)는 버튼을 눌러 여는 팝오버
 *   (popoverKit.js) 안에서 이뤄진다 — 대기 중 건수/쿨다운을 미리 보여준
 *   다음 신청해야, 어차피 막힐 신청을 눌러보고서야 아는 일이 없다.
 */
(function (global) {
  var BUMP_ICON = '🔥';
  var POLL_INTERVAL_MS = 20000;
  var GET_URL = '/bump/get';
  var REQUEST_URL = '/bump/request';

  var lastStatus = { active: null, waitingCount: 0, cooldownRemainingMs: 0 };
  var pollTimer = null;
  var pollingEnsured = false;

  function isLoggedIn() {
    return !!(global.BookmarkLibrary && global.BookmarkLibrary.isLoggedIn());
  }

  function broadcast() {
    try {
      global.dispatchEvent(new CustomEvent('chokaguya:bump-change', { detail: lastStatus }));
    } catch (e) {}
  }

  function fetchStatus(personalCode) {
    var body = {};
    if (personalCode) body.personalCode = personalCode;
    return fetch(GET_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) throw new Error('상태를 불러오지 못했어요.');
      return res.json();
    });
  }

  function poll() {
    fetchStatus().then(function (data) {
      lastStatus = data;
      broadcast();
    }).catch(function () {});
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function startPolling() {
    if (pollTimer) return;
    poll();
    pollTimer = setInterval(poll, POLL_INTERVAL_MS);
  }

  // mainPage.js의 랜덤 섹션 회전과 같은 이유로, 백그라운드 탭에서는 멈춘다.
  function syncPolling() {
    if (document.hidden) stopPolling();
    else startPolling();
  }

  // 이 버튼이 페이지에 하나라도 그려지면 폴링을 시작한다 — 여러 카드가
  // 동시에 부르더라도 한 번만 등록된다.
  function ensurePolling() {
    if (pollingEnsured) return;
    pollingEnsured = true;
    document.addEventListener('visibilitychange', syncPolling);
    syncPolling();
  }

  function getLastStatus() { return lastStatus; }

  function minutesCeil(ms) {
    return Math.max(1, Math.ceil(ms / 60000));
  }

  function isItemActive(status, type, id) {
    return !!(status && status.active && status.active.type === type && status.active.id === id);
  }

  // ---- 신청 팝오버 — bookmarkPicker.js와 같은 popoverKit.js 싱글턴 패턴.
  // bkm-picker 클래스를 공유해 팝오버 배경/애니메이션(bookmarks.css)을
  // 그대로 재사용한다.
  var popoverEl = null;
  var state = null; // { anchorEl, type, id, name }
  var popover = global.PopoverKit.createPopover('bkm-picker bump-picker', 300, function () { state = null; });

  function ensurePopoverEl() {
    popoverEl = popover.ensure();
    return popoverEl;
  }

  function isOpenFor(anchorEl) {
    return !!state && state.anchorEl === anchorEl && popoverEl && popoverEl.classList.contains('is-open');
  }

  function render() {
    popoverEl.innerHTML = '';
    popoverEl.appendChild(global.PopoverKit.header(BUMP_ICON + ' 끌올'));

    // bkm-share-note — bookmarksPage.js의 공개 패널이 쓰는 것과 같은 안내
    // 문구 스타일(밝기/다크 모드 색이 이미 theme.css에 있음)을 재사용한다.
    var note = document.createElement('p');
    note.className = 'bkm-share-note';
    popoverEl.appendChild(note);

    var actionBtn = global.PopoverKit.button('이 문학 끌올하기', 'is-primary');
    popoverEl.appendChild(actionBtn);

    var mySnapshot = state; // 응답이 늦게 와서 그 사이 팝오버가 닫히거나 다른 카드로 옮겨갔는지 확인용

    function paint(status) {
      if (isItemActive(status, mySnapshot.type, mySnapshot.id)) {
        var remain = minutesCeil(status.active.endAt - Date.now());
        note.textContent = '지금 사이트 맨 위에 끌올 중이에요! (약 ' + remain + '분 남음)';
        actionBtn.style.display = 'none';
        return;
      }
      actionBtn.style.display = '';
      actionBtn.disabled = false;
      actionBtn.textContent = '이 문학 끌올하기';

      var lines = [];
      if (status.waitingCount) lines.push('현재 대기 중인 끌올 ' + status.waitingCount + '건.');
      lines.push('신청하면 순서가 되는 대로 최대 1시간 동안 사이트 맨 위에 노출돼요.');
      var cooldown = status.cooldownRemainingMs || 0;
      if (cooldown > 0) {
        lines.push('다음 신청까지 약 ' + minutesCeil(cooldown) + '분 남았어요.');
        actionBtn.disabled = true;
      }
      note.textContent = lines.join(' ');
    }

    note.textContent = '불러오는 중...';
    actionBtn.style.display = 'none';

    var personalCode = global.BookmarkLibrary.getPersonalCode();
    fetchStatus(personalCode).then(function (status) {
      lastStatus = status;
      broadcast();
      if (state !== mySnapshot) return;
      paint(status);
    }).catch(function () {
      if (state !== mySnapshot) return;
      note.textContent = '상태를 불러오지 못했어요.';
    });

    actionBtn.addEventListener('click', function () {
      actionBtn.disabled = true;
      actionBtn.textContent = '신청 중...';

      fetch(REQUEST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personalCode: personalCode, type: mySnapshot.type, id: mySnapshot.id })
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          return { ok: res.ok, data: data };
        });
      }).then(function (result) {
        if (!result.ok) {
          if (state !== mySnapshot) return;
          note.textContent = result.data.error || '신청하지 못했어요.';
          actionBtn.disabled = false;
          actionBtn.textContent = '이 문학 끌올하기';
          return;
        }
        // 즉시 활성인지 대기열에 붙었는지는 startAt/endAt만으로 알 수
        // 없으므로(다른 항목이 이미 활성 중일 수 있음), 서버 상태를 다시
        // 받아 정확히 반영한다.
        return fetchStatus(personalCode).then(function (status) {
          lastStatus = status;
          broadcast();
          if (state !== mySnapshot) return;
          if (isItemActive(status, mySnapshot.type, mySnapshot.id)) {
            note.textContent = '지금 바로 끌올됐어요! 사이트 맨 위에서 확인해보세요.';
          } else {
            note.textContent = '끌올 신청 완료! 순서가 되면 최대 1시간 동안 노출돼요.';
          }
          actionBtn.style.display = 'none';
        });
      }).catch(function () {
        if (state !== mySnapshot) return;
        note.textContent = '신청하지 못했어요. 다시 시도해주세요.';
        actionBtn.disabled = false;
        actionBtn.textContent = '이 문학 끌올하기';
      });
    });
  }

  function position(anchorEl) {
    popover.position(anchorEl);
  }

  function open(anchorEl, type, id, name) {
    ensurePopoverEl();
    state = { anchorEl: anchorEl, type: type, id: id, name: name || '' };
    render();
    position(anchorEl);
    popoverEl.classList.add('is-open');
  }

  function close() {
    popover.close();
  }

  function toggle(anchorEl, type, id, name) {
    if (isOpenFor(anchorEl)) { close(); return; }
    open(anchorEl, type, id, name);
  }

  // 팝오버를 안 열어도, 이미 알고 있는 최신 상태(lastStatus)만으로 "지금
  // 이 항목이 끌올 중"인지 버튼에 바로 표시한다 — bookmarkPicker.js의
  // _bkmSync/refreshButtons와 같은 구조.
  function refreshButtons() {
    var btns = document.querySelectorAll('.bkm-bump-btn');
    for (var i = 0; i < btns.length; i++) {
      if (typeof btns[i]._bumpSync === 'function') btns[i]._bumpSync();
    }
  }

  // opts는 지금은 안 쓰지만, bookmarkPicker.createButton과 시그니처를
  // 맞춰둔다(호출부가 필요해지면 옵션을 넘길 자리).
  function createButton(type, id, name) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'series-card-bump bkm-bump-btn';
    btn.textContent = BUMP_ICON;
    btn.setAttribute('aria-label', '끌올 신청');
    btn._bumpSync = function () {
      btn.classList.toggle('is-bumped', isItemActive(lastStatus, type, id));
    };
    btn._bumpSync();
    ensurePolling();

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      // 끌올은 계정에 딸린 기능이라 로그인부터 받는다 — bookmarkPicker.js의
      // 북마크 버튼과 같은 흐름(가입/로그인이 끝나면 누르려던 팝오버를
      // 그대로 이어서 연다).
      if (!isLoggedIn()) {
        global.AuthModal.requireLogin({
          reason: '끌올 신청은 로그인이 필요해요',
          onSuccess: function () { open(btn, type, id, name); }
        });
        return;
      }
      toggle(btn, type, id, name);
    });
    return btn;
  }

  global.addEventListener('chokaguya:bump-change', refreshButtons);
  global.addEventListener('chokaguya:auth-change', close);

  global.BumpButton = {
    createButton: createButton,
    open: open,
    close: close,
    getLastStatus: getLastStatus,
    ensurePolling: ensurePolling
  };
})(window);
