/**
 * ChoKaguya Profile Store (유저 프로필 데이터)
 * - 서버: worker/profileApi.js (/profile/me·save·delete, GET /profiles).
 * - 내 프로필: 로그인하면 /profile/me 로 받아 오고 로그아웃하면 비운다. /profile/me 는
 *   로그인·가입과 같은 제한기(분당 10회)를 쓰므로 페이지를 열 때마다 묻지 않고
 *   localStorage 에 10분 캐시해 둔다. 바뀌면 'chokaguya:profile-change' 를 보낸다.
 * - 다른 사람 프로필: fetchMany(ids) 가 같은 순간(마이크로태스크)에 들어온 요청을 모아
 *   GET /profiles 로 50개씩 받고 메모리에 캐시한다.
 * - 아이콘·색 목록은 src/data/config/ProfileIcons.json. 그림을 추가하면 cdnConfig.js 의
 *   DATA_VERSION 도 올려야 브라우저가 새 목록을 받는다.
 */
(function (global) {
  var CACHE_KEY = 'chokaguya_profile_mine';
  var CACHE_TTL_MS = 10 * 60 * 1000;
  // /profile/me 가 실패하면(스키마 미적용·장애·429) 이 시간 동안은 페이지마다 다시 묻지 않는다.
  // 로그인과 같은 제한기를 쓰므로, 실패를 바로 되풀이하면 같은 IP 의 로그인까지 막힌다.
  var FAILURE_BACKOFF_MS = 2 * 60 * 1000;
  var LOOKUP_CHUNK = 50;
  var CATALOG_PATH = '../data/config/ProfileIcons.json';

  var mine = null;
  var mineSeq = 0; // 늦게 도착한 /profile/me 응답을 버리기 위한 요청 번호

  function personalCode() {
    var lib = global.BookmarkLibrary;
    return (lib && lib.getPersonalCode()) || null;
  }

  // 캐시가 어느 계정 것인지 알아보는 표시. 개인 코드 전체는 남기지 않는다.
  function codeTag(code) {
    return code ? code.slice(0, 8) : '';
  }

  function readCache() {
    try {
      var raw = global.localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeCache(profile) {
    try {
      var code = personalCode();
      if (!code) global.localStorage.removeItem(CACHE_KEY);
      else global.localStorage.setItem(CACHE_KEY, JSON.stringify({ tag: codeTag(code), at: Date.now(), profile: profile }));
    } catch (e) {}
  }

  // 실패를 기록한다. 지금 들고 있는 프로필은 그대로 둔다.
  function markFailure() {
    try {
      var code = personalCode();
      if (code) {
        global.localStorage.setItem(CACHE_KEY, JSON.stringify({ tag: codeTag(code), at: Date.now(), profile: mine, failed: true }));
      }
    } catch (e) {}
  }

  function setMine(profile) {
    mine = profile || null;
    writeCache(mine);
    if (mine) known[mine.id] = publicPart(mine);
    try {
      global.dispatchEvent(new CustomEvent('chokaguya:profile-change', { detail: { profile: mine } }));
    } catch (e) {}
  }

  function publicPart(profile) {
    return { id: profile.id, nickname: profile.nickname, icon: profile.icon, color: profile.color, bio: profile.bio };
  }

  function postJson(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { ok: res.ok, status: res.status, data: data || {} };
      });
    });
  }

  // 삭제된 계정이라는 410 이면 로그아웃시킨다. UserData 는 로드 순서가 페이지마다
  // 달라 호출 시점에 찾는다.
  function checkDeleted(r) {
    var ud = global.UserData;
    if (r && r.status === 410 && ud && ud.isAccountDeletedBody && ud.isAccountDeletedBody(r.data)) {
      ud.handleAccountDeleted();
      return true;
    }
    return false;
  }

  function failure(data) {
    var err = new Error((data && data.error) || 'network');
    err.code = (data && data.error) || 'network';
    if (data && data.retryAt) err.retryAt = data.retryAt;
    return err;
  }

  function loadMine() {
    var code = personalCode();
    var seq = ++mineSeq;
    if (!code) {
      setMine(null);
      return Promise.resolve(null);
    }
    return postJson('/profile/me', { personalCode: code }).then(function (r) {
      if (seq !== mineSeq || personalCode() !== code) return mine;
      if (checkDeleted(r)) return mine;
      if (r.ok) setMine(r.data.profile || null);
      else markFailure();
      return mine;
    }, function () {
      if (seq === mineSeq && personalCode() === code) markFailure();
      return mine;
    });
  }

  function saveMine(fields) {
    var code = personalCode();
    if (!code) return Promise.reject(failure({ error: 'account not found' }));
    var body = {
      personalCode: code, nickname: fields.nickname, icon: fields.icon, color: fields.color, bio: fields.bio
    };
    return postJson('/profile/save', body).then(function (r) {
      if (!r.ok) {
        checkDeleted(r);
        throw failure(r.data);
      }
      mineSeq++;
      setMine(r.data.profile);
      return mine;
    }, function () { throw failure(null); });
  }

  function deleteMine() {
    var code = personalCode();
    if (!code) return Promise.resolve();
    return postJson('/profile/delete', { personalCode: code }).then(function (r) {
      if (!r.ok && r.status !== 404) throw failure(r.data);
      if (mine) known[mine.id] = null;
      mineSeq++;
      setMine(null);
    }, function () { throw failure(null); });
  }

  // ---- 다른 사람 프로필 ----
  var known = {};    // id → 공개 프로필 | null(없는 프로필)
  var waiting = {};  // id → { promise, resolve }
  var queue = [];
  var flushScheduled = false;

  function settle(id, profile, remember) {
    if (remember) known[id] = profile;
    var w = waiting[id];
    delete waiting[id];
    if (w) w.resolve(profile);
  }

  function requestChunk(ids) {
    fetch('/profiles?ids=' + ids.join(','))
      .then(function (res) {
        if (!res.ok) throw new Error('profile lookup failed');
        return res.json();
      })
      .then(function (body) {
        var profiles = (body && body.profiles) || {};
        ids.forEach(function (id) { settle(id, profiles[id] || null, true); });
      }, function () {
        // 네트워크 실패나 오류 응답(429·503)은 캐시하지 않는다 — 다음에 다시 묻는다.
        ids.forEach(function (id) { settle(id, null, false); });
      });
  }

  function flush() {
    flushScheduled = false;
    var ids = queue;
    queue = [];
    for (var i = 0; i < ids.length; i += LOOKUP_CHUNK) requestChunk(ids.slice(i, i + LOOKUP_CHUNK));
  }

  function want(id) {
    if (Object.prototype.hasOwnProperty.call(known, id)) return Promise.resolve(known[id]);
    if (!waiting[id]) {
      var resolve;
      var promise = new Promise(function (r) { resolve = r; });
      waiting[id] = { promise: promise, resolve: resolve };
      queue.push(id);
      if (!flushScheduled) {
        flushScheduled = true;
        Promise.resolve().then(flush);
      }
    }
    return waiting[id].promise;
  }

  function fetchMany(ids) {
    var unique = (ids || []).filter(function (id, i, all) { return id && all.indexOf(id) === i; });
    return Promise.all(unique.map(want)).then(function (profiles) {
      var out = {};
      unique.forEach(function (id, i) { out[id] = profiles[i]; });
      return out;
    });
  }

  // ---- 아이콘·색 목록 ----
  var catalogPromise = null;
  function catalog() {
    if (!catalogPromise) {
      var load = global.fetchJsonCached || function (p) { return fetch(p).then(function (r) { return r.json(); }); };
      catalogPromise = load(CATALOG_PATH).then(function (data) {
        return { icons: (data && data.icons) || [], colors: (data && data.colors) || [] };
      }, function () {
        catalogPromise = null;
        return { icons: [], colors: [] };
      });
    }
    return catalogPromise;
  }

  function findById(list, id) {
    for (var i = 0; i < (list || []).length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function iconFile(cat, id) {
    var icon = findById(cat && cat.icons, id);
    return icon ? icon.file : null;
  }
  function colorHex(cat, id) {
    var color = findById(cat && cat.colors, id);
    return color ? color.hex : null;
  }

  // ---- 서버 오류 → 문구 ----
  function errorMessage(code, retryAt) {
    var t = global.I18n.t;
    switch (code) {
      case 'nickname taken': return t('이미 쓰이는 닉네임이에요');
      case 'banned word': return t('쓸 수 없는 단어가 들어 있어요');
      case 'reserved nickname': return t('쓸 수 없는 닉네임 형식이에요');
      case 'invalid nickname': return t('닉네임은 1~12자로 정해 주세요');
      case 'invalid bio': return t('자기소개는 40자까지 쓸 수 있어요');
      case 'account not found': return t('계정을 찾지 못했어요. 다시 로그인해 주세요');
      case 'nickname cooldown': return t('{date}부터 닉네임을 바꿀 수 있어요', { date: formatDate(retryAt) });
      default: return t('잠시 후 다시 시도해 주세요');
    }
  }

  function formatDate(ms) {
    var i18n = global.I18n;
    var locale = 'ko-KR';
    (i18n.LANGUAGES || []).forEach(function (lang) { if (lang.code === i18n.lang) locale = lang.locale; });
    try {
      return new Date(ms).toLocaleDateString(locale, { month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' });
    } catch (e) {
      return new Date(ms).toLocaleDateString();
    }
  }

  // ---- 시작 ----
  global.addEventListener('chokaguya:auth-change', function (e) {
    if (e && e.detail && e.detail.loggedIn) {
      loadMine();
    } else {
      mineSeq++;
      setMine(null);
    }
  });

  (function init() {
    var code = personalCode();
    if (!code) return;
    var cached = readCache();
    if (cached && cached.tag === codeTag(code)) {
      mine = cached.profile || null;
      if (mine) known[mine.id] = publicPart(mine);
      var age = Date.now() - (cached.at || 0);
      if (age < (cached.failed ? FAILURE_BACKOFF_MS : CACHE_TTL_MS)) return;
    }
    loadMine();
  })();

  global.ProfileStore = {
    mine: function () { return mine; },
    loadMine: loadMine,
    saveMine: saveMine,
    deleteMine: deleteMine,
    fetchMany: fetchMany,
    catalog: catalog,
    iconFile: iconFile,
    colorHex: colorHex,
    errorMessage: errorMessage
  };
})(window);
