/**
 * ChoKaguya Profile Card (프로필 칩·카드·팝오버)
 * - badge(profile, catalog): 목록 안에 들어가는 작은 칩(아이콘 + 닉네임). 누르면 open().
 *   profile 이 null(지워진 프로필)이면 누를 수 없는 "알 수 없는 유저" 칩.
 * - card(profile, catalog): 색 띠·큰 아이콘·닉네임·자기소개. 설정창 프로필 탭의
 *   미리보기도 이것을 쓴다.
 * - open(profileId, anchor): popoverKit.js 팝오버로 card 를 띄운다.
 * - 색은 profile.css 의 --card-* 변수를 쓰고, 프로필 색만 --profile-color 로 넣는다.
 * - 1단계에서는 내 프로필(헤더·설정창)에만 쓰이고, 공개 북마크·끌올·태그 투표·랭킹은
 *   2단계에서 badge 를 붙인다.
 */
(function (global) {
  var t = global.I18n.t;
  var DEFAULT_COLOR = '#607089';
  var PROFILE_ID_RE = /^[A-Za-z0-9_-]{12}$/; // 서버가 만든 프로필 ID(worker/profileApi.js)

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function store() {
    return global.ProfileStore;
  }

  function avatar(profile, catalog, size) {
    var node = el('span', 'profile-avatar' + (size ? ' is-' + size : ''));
    node.setAttribute('aria-hidden', 'true');
    var s = store();
    var hex = (profile && s && s.colorHex(catalog, profile.color)) || DEFAULT_COLOR;
    node.style.setProperty('--profile-color', hex);
    var file = profile && s && s.iconFile(catalog, profile.icon);
    if (file) {
      var img = el('img');
      img.src = file;
      img.alt = '';
      img.setAttribute('loading', 'lazy');
      node.appendChild(img);
    }
    return node;
  }

  function badge(profile, catalog) {
    if (!profile) {
      var unknown = el('span', 'profile-badge is-unknown', t('알 수 없는 유저'));
      return unknown;
    }
    var btn = el('button', 'profile-badge');
    btn.type = 'button';
    btn.setAttribute('data-profile-id', profile.id);
    btn.appendChild(avatar(profile, catalog, 'small'));
    btn.appendChild(el('span', 'profile-badge-name', profile.nickname));
    btn.addEventListener('click', function (e) {
      if (e && e.stopPropagation) e.stopPropagation();
      open(profile.id, btn);
    });
    return btn;
  }

  function card(profile, catalog) {
    var node = el('div', 'profile-card');
    var s = store();
    var hex = (profile && s && s.colorHex(catalog, profile.color)) || DEFAULT_COLOR;
    node.style.setProperty('--profile-color', hex);
    node.appendChild(el('div', 'profile-card-band'));
    var body = el('div', 'profile-card-body');
    body.appendChild(avatar(profile, catalog, 'large'));
    body.appendChild(el('p', 'profile-card-name', profile ? profile.nickname : t('알 수 없는 유저')));
    if (profile && profile.bio) body.appendChild(el('p', 'profile-card-bio', profile.bio));
    node.appendChild(body);
    // 저장 전 초안(편집기는 id: '' 로 넘긴다)에는 스탯 영역을 만들지 않고 요청도 보내지 않는다.
    if (profile && typeof profile.id === 'string' && PROFILE_ID_RE.test(profile.id) &&
        global.ProfileStats && global.ProfileLevel) {
      var area = el('div', 'profile-card-stats is-loading');
      body.appendChild(area);
      global.ProfileStats.fetch(profile.id).then(function (stats) {
        if (!stats) {
          if (area.remove) area.remove();
          return;
        }
        fillStats(area, stats);
      }, function () {
        if (area.remove) area.remove();
      });
    }
    return node;
  }

  var STAT_ROWS = [
    ['viewed', '본 문학 수'],
    ['saved', '저장 수'],
    ['voted', '태그 투표 수'],
    ['bumped', '끌올 수']
  ];

  function fillStats(area, stats) {
    var lv = global.ProfileLevel.fromStats(stats);
    var span = lv.nextStart - lv.levelStart;
    var ratio = span > 0 ? Math.min(1, Math.max(0, (lv.xp - lv.levelStart) / span)) : 0;
    area.appendChild(el('p', 'profile-card-level', t('Lv.{n}', { n: lv.level })));
    var xp = el('div', 'profile-card-xp');
    var track = el('div', 'profile-card-xp-track');
    var fill = el('div', 'profile-card-xp-fill');
    fill.style.width = Math.round(ratio * 10000) / 100 + '%';
    track.appendChild(fill);
    xp.appendChild(track);
    xp.appendChild(el('span', 'profile-card-xp-text', lv.xp + '/' + lv.nextStart));
    area.appendChild(xp);
    var grid = el('div', 'profile-card-stat-grid');
    STAT_ROWS.forEach(function (row) {
      var cell = el('div', 'profile-card-stat');
      cell.appendChild(el('span', 'profile-card-stat-num', String(stats[row[0]] || 0)));
      cell.appendChild(el('span', 'profile-card-stat-name', t(row[1])));
      grid.appendChild(cell);
    });
    area.appendChild(grid);
    area.classList.remove('is-loading');
  }

  // 랭킹처럼 이름 칸 하나: 프로필이 있으면 칩, 없으면 원래 글자(직접 입력한 닉네임 등).
  function nameCell(profile, fallbackText, catalog) {
    return profile ? badge(profile, catalog) : el('span', 'profile-name-text', fallbackText || '');
  }

  // 태그 투표자 목록(postDetailSeries.js). profileIds 중 조회되지 않은(지워진) 프로필은
  // 익명 수에 더한다.
  function voterList(profileIds, anonymous, profiles, catalog) {
    var node = el('div', 'profile-voters');
    var hidden = anonymous || 0;
    (profileIds || []).forEach(function (id) {
      var profile = profiles && profiles[id];
      if (profile) node.appendChild(badge(profile, catalog));
      else hidden++;
    });
    if (hidden > 0) node.appendChild(el('span', 'profile-voters-anon', t('익명 {n}명', { n: hidden })));
    if (!node.children.length) node.appendChild(el('span', 'profile-voters-empty', t('아직 투표한 사람이 없어요')));
    return node;
  }

  var popover = null;
  function open(profileId, anchor) {
    var s = store();
    if (!s || !global.PopoverKit) return;
    if (!popover) popover = global.PopoverKit.createPopover('bkm-picker profile-popover', 280);
    var target = popover.ensure();
    Promise.all([s.fetchMany([profileId]), s.catalog()]).then(function (r) {
      target.innerHTML = '';
      target.appendChild(card(r[0][profileId] || null, r[1]));
      popover.position(anchor);
      target.classList.add('is-open');
    });
  }

  global.ProfileCard = {
    avatar: avatar,
    badge: badge,
    card: card,
    nameCell: nameCell,
    voterList: voterList,
    open: open
  };
})(window);
