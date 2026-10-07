/**
 * ChoKaguya Profile Editor (통합 설정창의 "프로필" 탭)
 * - settingsModal.js 가 탭을 열 때 ProfileEditor.render(container) 를 부른다
 *   (계정 탭을 auth.js 에 맡기는 것과 같은 방식).
 * - 비로그인: 안내 + 로그인 버튼. 로그인: 프로필이 없으면 만들기, 있으면 편집.
 * - 위에서 아래로 미리보기 카드(ProfileCard.card, 입력 즉시 반영) → 닉네임 →
 *   아이콘 격자 → 색 견본 → 자기소개 → 저장/삭제. 서버 규칙(닉네임 1~12자, 자기소개
 *   40자, 닉네임 변경 7일 간격)은 worker/profileApi.js 가 판정하고, 여기서는 그 결과를
 *   ProfileStore.errorMessage 로 보여 준다.
 */
(function (global) {
  var t = global.I18n.t;
  var NICKNAME_MAX = 12;
  var BIO_MAX = 40;
  var currentMount = null;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(label, variant) {
    var btn = el('button', 'settings-btn' + (variant ? ' ' + variant : ''), label);
    btn.type = 'button';
    return btn;
  }

  function charCount(text) {
    return Array.from(text || '').length;
  }

  function isLoggedIn() {
    return !!(global.BookmarkLibrary && global.BookmarkLibrary.isLoggedIn());
  }

  function render(container) {
    currentMount = container;
    container.innerHTML = '';
    if (!isLoggedIn()) {
      container.appendChild(el('p', 'settings-desc', t('로그인하면 프로필을 만들 수 있어요')));
      var loginBtn = button(t('로그인'), 'is-primary');
      loginBtn.addEventListener('click', function () {
        if (global.AuthModal) global.AuthModal.openSignIn({ onSuccess: function () { render(container); } });
      });
      container.appendChild(loginBtn);
      return;
    }
    container.appendChild(el('p', 'settings-desc', t('불러오는 중…')));
    var store = global.ProfileStore;
    Promise.all([store.loadMine(), store.catalog()]).then(function (r) {
      if (currentMount !== container) return;
      draw(container, r[0], r[1]);
    });
  }

  function draw(container, profile, catalog) {
    container.innerHTML = '';
    var store = global.ProfileStore;
    var state = {
      nickname: profile ? profile.nickname : '',
      icon: profile ? profile.icon : (catalog.icons[0] && catalog.icons[0].id),
      color: profile ? profile.color : (catalog.colors[0] && catalog.colors[0].id),
      bio: profile ? profile.bio : ''
    };

    if (!profile) {
      container.appendChild(el('p', 'settings-field-label', t('프로필 만들기')));
      container.appendChild(el('p', 'settings-desc', t('만든 뒤의 태그 투표·끌올·공개 북마크·랭킹 활동에 이 프로필이 표시돼요')));
    }

    var preview = el('div', 'profile-editor-preview');
    container.appendChild(preview);
    function paintPreview() {
      preview.innerHTML = '';
      preview.appendChild(global.ProfileCard.card({
        id: profile ? profile.id : '', nickname: state.nickname || t('닉네임'),
        icon: state.icon, color: state.color, bio: state.bio
      }, catalog));
    }

    // 닉네임
    container.appendChild(el('p', 'settings-field-label', t('닉네임')));
    var nickInput = el('input', 'profile-editor-input');
    nickInput.type = 'text';
    nickInput.maxLength = NICKNAME_MAX * 2; // 조합 중인 한글이 잘리지 않게 넉넉히 두고 실제 길이는 서버가 센다
    nickInput.value = state.nickname;
    nickInput.addEventListener('input', function () { state.nickname = nickInput.value; paintPreview(); });
    container.appendChild(nickInput);
    if (profile && profile.nicknameChangeableAt > Date.now()) {
      nickInput.disabled = true;
      container.appendChild(el('p', 'settings-row-desc', store.errorMessage('nickname cooldown', profile.nicknameChangeableAt)));
    }

    // 아이콘
    container.appendChild(el('p', 'settings-field-label', t('아이콘')));
    var iconGrid = el('div', 'profile-editor-icons');
    iconGrid.setAttribute('role', 'radiogroup');
    iconGrid.setAttribute('aria-label', t('아이콘'));
    var iconButtons = [];
    function paintIcons() {
      iconButtons.forEach(function (b) {
        var on = b.getAttribute('data-id') === state.icon;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-checked', String(on));
        b.innerHTML = '';
        b.appendChild(global.ProfileCard.avatar({ icon: b.getAttribute('data-id'), color: state.color }, catalog));
      });
    }
    catalog.icons.forEach(function (icon) {
      var b = el('button', 'profile-editor-choice');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('data-id', icon.id);
      b.setAttribute('aria-label', icon.label);
      b.title = icon.label;
      b.addEventListener('click', function () { state.icon = icon.id; paintIcons(); paintPreview(); });
      iconButtons.push(b);
      iconGrid.appendChild(b);
    });
    container.appendChild(iconGrid);

    // 색
    container.appendChild(el('p', 'settings-field-label', t('색')));
    var colorGrid = el('div', 'profile-editor-colors');
    colorGrid.setAttribute('role', 'radiogroup');
    colorGrid.setAttribute('aria-label', t('색'));
    var colorButtons = [];
    catalog.colors.forEach(function (color) {
      var b = el('button', 'profile-editor-swatch');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('data-id', color.id);
      b.setAttribute('aria-label', color.hex);
      b.style.setProperty('--profile-color', color.hex);
      b.addEventListener('click', function () { state.color = color.id; paintColors(); paintIcons(); paintPreview(); });
      colorButtons.push(b);
      colorGrid.appendChild(b);
    });
    function paintColors() {
      colorButtons.forEach(function (b) {
        var on = b.getAttribute('data-id') === state.color;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-checked', String(on));
      });
    }
    container.appendChild(colorGrid);

    // 자기소개
    var bioLabel = el('p', 'settings-field-label profile-editor-bio-label', t('자기소개'));
    var counter = el('span', 'profile-editor-count');
    bioLabel.appendChild(counter);
    container.appendChild(bioLabel);
    var bioInput = el('input', 'profile-editor-input');
    bioInput.type = 'text';
    bioInput.maxLength = BIO_MAX * 4;
    bioInput.value = state.bio;
    function paintCount() {
      var n = charCount(bioInput.value);
      counter.textContent = n + '/' + BIO_MAX;
      counter.classList.toggle('is-over', n > BIO_MAX);
    }
    bioInput.addEventListener('input', function () { state.bio = bioInput.value; paintCount(); paintPreview(); });
    container.appendChild(bioInput);

    // 결과·버튼
    var status = el('p', 'profile-editor-status');
    status.setAttribute('role', 'status');
    container.appendChild(status);
    var actions = el('div', 'settings-inline-row profile-editor-actions');
    var saveBtn = button(profile ? t('저장') : t('프로필 만들기'), 'is-primary');
    saveBtn.addEventListener('click', function () {
      saveBtn.disabled = true;
      status.className = 'profile-editor-status';
      status.textContent = '';
      store.saveMine(state).then(function (saved) {
        draw(container, saved, catalog);
        var done = container.querySelector('.profile-editor-status');
        if (done) done.textContent = t('저장했어요');
      }, function (err) {
        saveBtn.disabled = false;
        status.className = 'profile-editor-status is-error';
        status.textContent = store.errorMessage(err.code, err.retryAt);
      });
    });
    actions.appendChild(saveBtn);
    if (profile) {
      var deleteBtn = button(t('프로필 삭제'), 'is-danger');
      deleteBtn.addEventListener('click', function () {
        if (!global.confirm(t('프로필을 삭제할까요? 지금 닉네임은 다른 사람이 쓸 수 있게 돼요.'))) return;
        deleteBtn.disabled = true;
        store.deleteMine().then(function () {
          draw(container, null, catalog);
        }, function (err) {
          deleteBtn.disabled = false;
          status.className = 'profile-editor-status is-error';
          status.textContent = store.errorMessage(err.code, err.retryAt);
        });
      });
      actions.appendChild(deleteBtn);
    }
    container.appendChild(actions);

    paintPreview();
    paintIcons();
    paintColors();
    paintCount();
  }

  global.addEventListener('chokaguya:auth-change', function () {
    if (currentMount && currentMount.isConnected) render(currentMount);
    else currentMount = null;
  });

  global.ProfileEditor = { render: render };
})(window);
