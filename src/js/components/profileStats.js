/**
 * ChoKaguya Profile Stats (본 문학 기록과 공개 스탯 조회)
 * - noteView(type, id): 상세 창을 연 작품을 POST /profile/view 로 한 번만 알린다.
 *   보낸 키('<type>:<id>')는 localStorage 에 프로필 ID 별로 최근 2000개까지 남겨 다시 보내지 않는다
 *   (프로필을 지우고 새로 만들면 ID 가 바뀌어 처음부터 다시 센다. 개인 코드는 남기지 않는다).
 *   서버가 오늘 한도에 걸렸다고(capped) 답하거나 일시적으로 거절하면 기억을 지워 다음에 다시 보낸다.
 *   로그인하지 않았거나 프로필이 없으면 아무것도 보내지 않는다. 모든 실패는 조용히 넘긴다.
 * - fetch(profileId): GET /profile/stats. 실패하면 null, 같은 ID 는 60초 메모리 캐시.
 */
(function (global) {
  var KEY_PREFIX = 'chokaguya_profile_views:';
  var MAX_KEYS = 2000;
  var CACHE_MS = 60 * 1000;
  var PROFILE_ID_RE = /^[A-Za-z0-9_-]{12}$/;

  var cache = {}; // profileId → { at, promise }

  function personalCode() {
    var lib = global.BookmarkLibrary;
    return (lib && lib.getPersonalCode()) || null;
  }

  function readKeys(storeKey) {
    try {
      var list = JSON.parse(global.localStorage.getItem(storeKey));
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function writeKeys(storeKey, list) {
    try {
      global.localStorage.setItem(storeKey, JSON.stringify(list.slice(-MAX_KEYS)));
    } catch (e) {}
  }

  function forget(storeKey, key) {
    var list = readKeys(storeKey);
    var at = list.lastIndexOf(key);
    if (at >= 0) {
      list.splice(at, 1);
      writeKeys(storeKey, list);
    }
  }

  // localStorage 를 못 쓰는 환경에서도 한 번만 보내도록 이번 방문 동안의 기억을 따로 둔다.
  var sentThisVisit = {};

  function noteView(type, id) {
    try {
      if (typeof type !== 'string' || !type) return;
      if (typeof id !== 'number' || !isFinite(id) || id < 0 || Math.floor(id) !== id) return;
      var code = personalCode();
      var store = global.ProfileStore;
      var mine = code && store ? store.mine() : null;
      if (!mine || typeof mine.id !== 'string' || !PROFILE_ID_RE.test(mine.id)) return;

      var key = type + ':' + id;
      var storeKey = KEY_PREFIX + mine.id;
      var memoryKey = storeKey + '|' + key;
      var list = readKeys(storeKey);
      if (sentThisVisit[memoryKey] || list.indexOf(key) >= 0) return;

      sentThisVisit[memoryKey] = true;
      list.push(key);
      writeKeys(storeKey, list);

      var fail = function () {
        delete sentThisVisit[memoryKey];
        forget(storeKey, key);
      };
      fetch('/profile/view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personalCode: code, type: type, id: id })
      }).then(function (res) {
        // 일시적인 거절(429·503)과 서버 오류는 다음에 다시 보낼 수 있게 기억을 지운다.
        if (!res.ok) {
          if (res.status === 429 || res.status >= 500) fail();
          return;
        }
        // 오늘 한도에 걸려 못 센 작품은 다음 날 다시 보내야 하므로 기억하지 않는다.
        return res.json().then(function (body) {
          if (body && body.capped === true) fail();
        }, function () {});
      }, fail).catch(function () {});
    } catch (e) {}
  }

  function fetchStats(profileId) {
    if (!profileId) return Promise.resolve(null);
    var hit = cache[profileId];
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
    var promise = fetch('/profile/stats?id=' + encodeURIComponent(profileId)).then(function (res) {
      if (!res.ok) return null;
      return res.json().then(function (body) {
        if (!body) return null;
        return { viewed: body.viewed, saved: body.saved, voted: body.voted, bumped: body.bumped };
      });
    }).catch(function () { return null; });
    cache[profileId] = { at: Date.now(), promise: promise };
    // 실패는 캐시하지 않는다.
    promise.then(function (value) {
      if (value === null && cache[profileId] && cache[profileId].promise === promise) delete cache[profileId];
    });
    return promise;
  }

  global.ProfileStats = { noteView: noteView, fetch: fetchStats };
})(window);
