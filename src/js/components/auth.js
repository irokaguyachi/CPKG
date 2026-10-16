/**
 * ChoKaguya Auth (로그인/개인 코드 관리 — 통합 설정창의 "계정" 탭)
 * - 비로그인 상태: "로그인" 버튼 → src/js/components/authModal.js 의 로그인 모달(코드
 *   입력창). 거기서 "새로 발급받으세요!" 링크를 누르면 회원가입으로
 *   전환된다. 북마크처럼 로그인이 필요한 다른 기능들(bookmarkPicker.js,
 *   bookmarksPage.js)도 AuthModal.requireLogin() 을 통해 같은 로그인
 *   화면부터 띄운다 — 회원가입 화면을 먼저 보여주면, 이미 계정이 있는데
 *   지금 로그아웃 상태인 사람이 새로 뜬 코드를 그대로 확정해 버려 쓰지도
 *   않을 계정이 서버에 하나 더 생기기 때문이다.
 * - 로그인 상태: 아이디 표시·변경(코드만 있으면 아이디 만들기 안내), 로그아웃, 클라우드 동기화(저장/
 *   불러오기)를 renderAccountSettings() 가 하나의 컨테이너에 인라인으로
 *   그린다 — 예전엔 헤더 버튼 + 앵커 팝오버(popoverKit.js)였지만, 이제
 *   src/js/components/settingsModal.js 의 "계정" 탭 안에 이미 자리가 있어서 팝오버가
 *   필요 없다.
 * - window 의 'chokaguya:auth-change'/'chokaguya:sync-state' 이벤트를 듣고
 *   있다가, 계정 탭이 지금 열려 있으면 다시 그린다.
 */
(function (global) {
  var t = global.I18n.t;
  // 프로필 메뉴에 찍히는 사이트 버전 — src/js/config/siteConfig.js 가 이미 fetch해둔
  // src/data/config/SiteConfig.json 을 그대로 재사용한다(같은 파일을 또 받지
  // 않도록). 대표님이 이 값을 바꾸고 싶을 때 코드를 건드릴 필요 없이 그
  // JSON 파일의 "version" 값만 고치면 된다.
  var SITE_VERSION = 'v?'; // JSON을 아직 못 불러왔을 때만 아주 잠깐 보이는 기본값
  var siteVersionPromise = (global.SiteConfig ? global.SiteConfig.ready : Promise.resolve({}))
    .then(function (data) {
      if (data && typeof data.version === 'string' && data.version) {
        SITE_VERSION = data.version;
      }
      return SITE_VERSION;
    });
  var currentMount = null; // 지금 계정 탭이 열려 있으면 그 컨테이너, 아니면 null

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function settingsButton(label, variant) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'settings-btn' + (variant ? ' ' + variant : '');
    btn.textContent = label;
    return btn;
  }

  // 클라우드 동기화가 지금 어떤 상태인지 — 로컬에만 저장됐는데 저장됐다고
  // 믿는 상황을 막는 게 목적이라, 로그인 상태에서만 보여준다. 자동 동기화가
  // 없으므로(userData.js) 이 라벨은 곧 버튼이다 — 눌러야 실제로 맞춰진다.
  var SYNC_STATE_LABELS = {
    synced: t('동기화됨'),
    pending: t('동기화 필요 · 아래에서 저장/불러오기'),
    syncing: t('동기화 중...'),
    cooldown: t('동기화 쿨타임중..'),
    offline: t('오프라인 (이 기기에만 저장 중)'),
    error: t('동기화 실패 · 다시 눌러보세요')
  };

  function renderLoggedOut(container) {
    container.innerHTML = '';
    container.appendChild(el('p', 'settings-desc', t('로그인하면 북마크를 다른 기기와 동기화할 수 있어요.')));
    var loginBtn = settingsButton(t('로그인'), 'is-primary');
    loginBtn.addEventListener('click', function () {
      global.AuthModal.openSignIn({ onSuccess: function () { renderAccountSettings(container); } });
    });
    container.appendChild(loginBtn);
  }

  // 아이디가 있으면 "아이디: {id} [변경]", 코드만 있는 계정이면 안내 문구 + [아이디 만들기].
  // 개인 코드는 더 이상 보여 주지 않는다. 아이디 여부는 loginIdModal.js 가 페이지당 한 번만
  // 서버에 묻고 공유하므로, 자리만 먼저 잡고 답이 오면 채운다.
  function renderLoginIdSection(container) {
    var LoginIdModal = global.LoginIdModal;
    if (!LoginIdModal) return;
    var slot = el('div', 'settings-login-id');
    container.appendChild(slot);
    LoginIdModal.getStatus().then(function (status) {
      if (!status.loginId) {
        LoginIdModal.mountNotice(slot);
        return;
      }
      slot.appendChild(el('p', 'settings-field-label', t('아이디')));
      var idRow = el('div', 'settings-inline-row');
      idRow.appendChild(el('span', 'settings-login-id-value', status.loginId));
      var changeBtn = settingsButton(t('변경'));
      changeBtn.addEventListener('click', function () { global.LoginIdModal.open({ mode: 'change' }); });
      idRow.appendChild(changeBtn);
      slot.appendChild(idRow);
    });
  }

  function renderLoggedIn(container) {
    container.innerHTML = '';

    renderLoginIdSection(container);

    container.appendChild(el('p', 'settings-field-label', t('클라우드 동기화')));
    var state = (global.UserData && global.UserData.getStatus()) || 'offline';
    container.appendChild(el('p', 'settings-sync-status is-' + state, SYNC_STATE_LABELS[state] || SYNC_STATE_LABELS.offline));

    var syncRow = el('div', 'settings-inline-row');
    var saveBtn = settingsButton(t('이 기기 → 서버에 저장'), 'is-primary');
    saveBtn.addEventListener('click', function () { if (global.UserData) global.UserData.saveToServer(); });
    syncRow.appendChild(saveBtn);
    var loadBtn = settingsButton(t('서버 → 이 기기로 불러오기'));
    loadBtn.addEventListener('click', function () { if (global.UserData) global.UserData.loadFromServer(); });
    syncRow.appendChild(loadBtn);
    container.appendChild(syncRow);

    var logoutBtn = settingsButton(t('로그아웃'), 'is-danger');
    logoutBtn.addEventListener('click', confirmAndLogout);
    container.appendChild(logoutBtn);

    renderDeletePanel(container);
  }

  // 계정 삭제 — 버튼을 누르면 아래로 확인 패널이 펼쳐지고, '삭제'를 직접 입력해야
  // 영구 삭제 버튼이 켜진다. 성공하면 UserData.deleteAccount() 가 로그아웃까지
  // 끝내므로 여기서는 로그아웃 화면을 다시 그리고 안내 문구만 붙인다.
  function renderDeletePanel(container) {
    var openBtn = settingsButton(t('계정 삭제'), 'is-danger');
    openBtn.className += ' settings-delete-open';
    container.appendChild(openBtn);

    var panel = el('div', 'settings-danger-panel');
    panel.hidden = true;
    panel.appendChild(el('p', 'settings-danger-title', t('계정을 삭제하면 되돌릴 수 없어요.')));
    panel.appendChild(el('p', 'settings-desc', t('지워지는 것: 서버에 저장된 북마크, 프로필, 공개한 서재, 프로필로 올린 랭킹 기록')));
    panel.appendChild(el('p', 'settings-desc', t('남는 것: 태그 투표·끌올 신청(익명으로), 이 브라우저에 있는 북마크')));
    panel.appendChild(el('p', 'settings-desc', t("계속하려면 아래에 '삭제'라고 입력해 주세요.")));

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'settings-danger-input';
    input.placeholder = t('삭제');
    panel.appendChild(input);

    var error = el('p', 'settings-danger-error');
    error.hidden = true;

    var row = el('div', 'settings-inline-row');
    var cancelBtn = settingsButton(t('취소'));
    var confirmBtn = settingsButton(t('영구 삭제'), 'is-danger');
    confirmBtn.disabled = true;
    row.appendChild(cancelBtn);
    row.appendChild(confirmBtn);
    panel.appendChild(row);
    panel.appendChild(error);
    container.appendChild(panel);

    var busy = false;
    function syncConfirm() {
      confirmBtn.disabled = busy || String(input.value).trim() !== t('삭제');
    }
    function setOpen(open) {
      panel.hidden = !open;
      if (!open) {
        input.value = '';
        error.hidden = true;
        syncConfirm();
      }
    }
    openBtn.addEventListener('click', function () { setOpen(panel.hidden); });
    cancelBtn.addEventListener('click', function () { if (!busy) setOpen(false); });
    input.addEventListener('input', syncConfirm);
    confirmBtn.addEventListener('click', function () {
      if (busy || confirmBtn.disabled || !global.UserData) return;
      busy = true;
      input.disabled = true;
      cancelBtn.disabled = true;
      error.hidden = true;
      confirmBtn.textContent = t('삭제하는 중…');
      syncConfirm();
      global.UserData.deleteAccount().then(function () {
        renderAccountSettings(container);
        container.insertBefore(el('p', 'settings-desc', t('계정을 삭제했어요.')), container.firstChild);
      }, function (err) {
        busy = false;
        input.disabled = false;
        cancelBtn.disabled = false;
        confirmBtn.textContent = t('영구 삭제');
        error.textContent = (err && err.message) || t('지금은 계정을 삭제할 수 없어요.');
        error.hidden = false;
        syncConfirm();
      });
    });
  }

  // 설정창 계정 탭과 헤더 프로필 메뉴(siteHeader.js)가 같은 확인 문구를 쓴다.
  function confirmAndLogout() {
    if (!global.confirm(t('로그아웃할까요? 다시 로그인하려면 아이디를 알고 있어야 해요.'))) return;
    global.BookmarkLibrary.logout();
  }

  function syncStateLabel(state) {
    return SYNC_STATE_LABELS[state] || SYNC_STATE_LABELS.offline;
  }

  // settingsModal.js 의 "계정" 탭이 호출하는 진입점 — 탭이 열릴 때마다,
  // 그리고 로그인 상태/동기화 상태가 바뀔 때마다 이 컨테이너를 다시 그린다.
  function renderAccountSettings(container) {
    currentMount = container;
    if (global.BookmarkLibrary && global.BookmarkLibrary.isLoggedIn()) {
      renderLoggedIn(container);
    } else {
      renderLoggedOut(container);
    }
  }

  function refreshIfMounted() {
    if (currentMount && currentMount.isConnected) renderAccountSettings(currentMount);
    else currentMount = null;
  }

  // 실제로 지금 떠 있는 게 어느 배포인지 확인용 — 버전 태그를 누르면
  // _worker.js의 /__build-info(Cloudflare가 실행 중인 Worker Version에
  // 직접 붙여 주는 값)를 물어서 배포 시각을 보여준다. 한 번 받아오면
  // 다시 물어보지 않고 재사용한다(어차피 새로고침 전까진 안 바뀜).
  var buildInfoPromise = null;
  function fetchBuildTimeText() {
    if (!buildInfoPromise) {
      buildInfoPromise = fetch('/__build-info')
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (!data.timestamp) return t('확인 불가');
          var d = new Date(data.timestamp);
          if (isNaN(d.getTime())) return t('확인 불가');
          function pad(n) { return (n < 10 ? '0' : '') + n; }
          return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
            pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
        })
        .catch(function () { return t('확인 불가'); });
    }
    return buildInfoPromise;
  }

  // 헤더 프로필 메뉴 맨 아래(siteHeader.js)에 붙는 사이트 버전 표시. 계정과
  // 무관한 배포 확인용 스탬프라 설정창으로 옮기지 않는다. 눌러서 버전 <->
  // 실제 배포 시각을 토글한다.
  function renderVersionTag(nav) {
    if (nav.querySelector('.auth-version-tag')) return;
    var tag = document.createElement('button');
    tag.type = 'button';
    tag.className = 'auth-version-tag';
    tag.textContent = SITE_VERSION;
    tag.title = t('눌러서 실제 배포 시각 확인');
    tag.setAttribute('data-showing-time', '0');
    // SiteConfig.json 로딩이 끝나면 실제 버전으로 갱신 — 그사이 배포 시각을
    // 보여주는 중으로 전환했다면 덮어쓰지 않는다.
    siteVersionPromise.then(function () {
      if (tag.getAttribute('data-showing-time') === '0') tag.textContent = SITE_VERSION;
    });
    tag.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (tag.getAttribute('data-showing-time') === '1') {
        tag.setAttribute('data-showing-time', '0');
        tag.textContent = SITE_VERSION;
        return;
      }
      tag.setAttribute('data-showing-time', '1');
      tag.textContent = t('확인 중...');
      fetchBuildTimeText().then(function (text) {
        // 응답이 오기 전에 다시 눌러서 버전으로 돌아갔다면 덮어쓰지 않는다.
        if (tag.getAttribute('data-showing-time') !== '1') return;
        tag.textContent = text;
      });
    });
    nav.appendChild(tag);
  }

  window.addEventListener('chokaguya:auth-change', refreshIfMounted);
  window.addEventListener('chokaguya:sync-state', refreshIfMounted);
  // 로그아웃은 auth-change 만 보내고, 아이디를 만들거나 바꾸면 login-id-change 를 보낸다 — 둘 다 듣는다
  window.addEventListener('chokaguya:login-id-change', refreshIfMounted);

  global.AuthUI = {
    renderAccountSettings: renderAccountSettings,
    renderVersionTag: renderVersionTag,
    confirmAndLogout: confirmAndLogout,
    syncStateLabel: syncStateLabel
  };
})(window);
