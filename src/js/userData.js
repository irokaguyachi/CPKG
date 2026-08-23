/**
 * ChoKaguya User Data Sync (계정 클라우드 동기화 엔진)
 * - bookmarks.js 의 로컬 스토어를 개인 코드로 식별되는 서버 계정
 *   (worker/favoritesShareWorker.js 의 /user/*)과 양방향으로 맞춥니다.
 *   공개 라이브러리(bookmarkLibrary.js)와는 별개 층입니다 — 저쪽은 "남에게
 *   보여주려고 발행한 스냅샷", 이쪽은 "비공개 포함 내 데이터 전부".
 * - 업스트림: 북마크가 바뀌면 1.5초 디바운스 후 스토어 전체를 스냅샷으로
 *   올립니다. 부분 diff 를 보내지 않으므로 오프라인 중 쌓인 변경을 따로
 *   큐에 담을 필요가 없습니다 — 로컬 스토어 자체가 항상 "보낼 것"입니다.
 * - 다운스트림: 같은 기기의 다른 탭은 BroadcastChannel 로 즉시, 다른 기기의
 *   변경은 탭 포커스 복귀와 60초 폴링으로 따라옵니다. 폴링은 head 만 찔러
 *   syncVersion 을 비교하므로 본문을 매번 내려받지 않습니다.
 * - 충돌은 서버가 아니라 여기서 풉니다(mergeStores). 서버는 syncVersion 과
 *   etag 로 "덮어써도 되는지"만 판정하고, 뒤처졌으면 409와 함께 서버 사본을
 *   돌려줍니다. 병합 구현이 한쪽에만 있어야 두 구현이 어긋날 일이 없습니다.
 */
(function (global) {
  // bookmarkLibrary.js 와 같은 이유로 상대 경로를 쓴다 — API가 같은
  // Worker(cpkg)에 합쳐져 있으므로 같은 오리진 호출이면 충분하다.
  var WORKER_BASE = '';
  var SIGNUP_URL = WORKER_BASE + '/user/signup';
  var GET_URL = WORKER_BASE + '/user/get';
  var HEAD_URL = WORKER_BASE + '/user/head';
  var SYNC_URL = WORKER_BASE + '/user/sync';

  var SYNC_VERSION_KEY = 'chokaguya_sync_version';
  var DEBOUNCE_MS = 1500;
  var POLL_INTERVAL_MS = 60000;
  var CHANNEL_NAME = 'chokaguya_sync';

  var pushTimer = null;
  var pollTimer = null;
  var inFlight = false;
  var pendingPush = false;
  var applyingRemote = false;
  // 서버에 아직 못 올린 변경이 있는가. 이게 없으면 폴링/포커스 복귀마다
  // 같은 내용을 올려 syncVersion 만 올라가고, 그걸 본 다른 기기가 또 받아가
  // 되올리는 핑퐁이 생긴다.
  var dirty = false;
  var status = 'offline';

  var channel = null;
  try {
    if (typeof global.BroadcastChannel === 'function') channel = new global.BroadcastChannel(CHANNEL_NAME);
  } catch (e) {}

  function lib() { return global.BookmarkLibrary; }
  function store() { return global.Bookmarks; }

  function personalCode() {
    var l = lib();
    return l && l.isLoggedIn() ? l.getPersonalCode() : null;
  }

  function canSync() {
    return !!(personalCode() && store());
  }

  // ---- 동기화 상태 ----

  function setStatus(next) {
    if (status === next) return;
    status = next;
    try {
      global.dispatchEvent(new CustomEvent('chokaguya:sync-state', { detail: { state: next } }));
    } catch (e) {}
  }

  function getSyncVersion() {
    try {
      return parseInt(localStorage.getItem(SYNC_VERSION_KEY) || '0', 10) || 0;
    } catch (e) {
      return 0;
    }
  }

  function setSyncVersion(version) {
    try { localStorage.setItem(SYNC_VERSION_KEY, String(version)); } catch (e) {}
  }

  // ---- 서버 통신 ----

  function postJson(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  function messageForStatus(code) {
    if (code === 429) return '요청이 너무 잦아요. 잠시 후 다시 시도해주세요.';
    if (code === 404) return '이 코드로 만들어진 계정을 찾을 수 없어요. 코드를 다시 확인해주세요.';
    if (code === 400) return '코드 형식이 올바르지 않아요.';
    return '서버와 통신하지 못했어요 (' + code + ')';
  }

  function failWith(res) {
    return Promise.reject(new Error(messageForStatus(res.status)));
  }

  // ---- 병합 ----
  //
  // 양쪽에만 있는 것을 살리는 합집합이 기본이고, 같은 대상을 양쪽에서
  // 건드렸을 때만 타임스탬프로 승자를 고릅니다. 삭제는 묘비로 표현되므로
  // "한쪽에 없다"는 사실만으로는 절대 지우지 않습니다 — 그렇게 하면 아직
  // 동기화 안 된 기기의 오래된 사본이 남의 새 북마크를 지워버립니다.

  function tombstoneMap(list, stampField) {
    var map = {};
    for (var i = 0; i < (list || []).length; i++) {
      var t = list[i];
      if (!t) continue;
      var key = stampField === 'deletedAt' ? t.id : (t.type + ':' + t.id);
      var stamp = t[stampField] || 0;
      if (!(key in map) || stamp > map[key]) map[key] = stamp;
    }
    return map;
  }

  function mergeTombstones(a, b, stampField) {
    var merged = tombstoneMap((a || []).concat(b || []), stampField);
    var out = [];
    for (var key in merged) {
      if (!Object.prototype.hasOwnProperty.call(merged, key)) continue;
      if (stampField === 'deletedAt') {
        out.push({ id: key, deletedAt: merged[key] });
      } else {
        var sep = key.indexOf(':');
        out.push({
          type: key.slice(0, sep),
          id: parseInt(key.slice(sep + 1), 10),
          removedAt: merged[key]
        });
      }
    }
    return out;
  }

  function mergeItems(localItems, remoteItems, removedMap) {
    var byKey = {};
    var order = [];

    function absorb(list) {
      for (var i = 0; i < (list || []).length; i++) {
        var it = list[i];
        if (!it) continue;
        var key = it.type + ':' + it.id;
        var addedAt = it.addedAt || 0;
        // 삭제된 뒤에 다시 담은 것만 살린다 — 삭제보다 오래된 항목은
        // 아직 그 삭제를 못 본 기기가 들고 있는 잔상이다
        if (key in removedMap && addedAt <= removedMap[key]) continue;
        if (!(key in byKey)) {
          byKey[key] = { type: it.type, id: it.id, addedAt: addedAt };
          order.push(key);
        } else if (addedAt && (!byKey[key].addedAt || addedAt < byKey[key].addedAt)) {
          // 같은 항목이면 처음 담은 시각을 남긴다
          byKey[key].addedAt = addedAt;
        }
      }
    }

    absorb(localItems);
    absorb(remoteItems);
    return order.map(function (key) { return byKey[key]; });
  }

  function mergeBookmark(a, b) {
    var removedItems = mergeTombstones(a.removedItems, b.removedItems, 'removedAt');
    var newer = (b.updatedAt || 0) > (a.updatedAt || 0) ? b : a;
    return {
      id: a.id,
      name: newer.name,
      createdAt: Math.min(a.createdAt || 0, b.createdAt || 0) || (a.createdAt || b.createdAt || 0),
      updatedAt: Math.max(a.updatedAt || 0, b.updatedAt || 0),
      items: mergeItems(a.items, b.items, tombstoneMap(removedItems, 'removedAt')),
      removedItems: removedItems
    };
  }

  function mergeStores(local, remote) {
    var deletedBookmarks = mergeTombstones(local.deletedBookmarks, remote.deletedBookmarks, 'deletedAt');
    var deletedMap = tombstoneMap(deletedBookmarks, 'deletedAt');

    var byId = {};
    var order = [];

    function absorb(list) {
      for (var i = 0; i < (list || []).length; i++) {
        var b = list[i];
        if (!b || !b.id) continue;
        // 삭제 이후에 다시 손댄 북마크만 되살린다
        if (b.id in deletedMap && (b.updatedAt || 0) <= deletedMap[b.id]) continue;
        if (!(b.id in byId)) {
          byId[b.id] = b;
          order.push(b.id);
        } else {
          byId[b.id] = mergeBookmark(byId[b.id], b);
        }
      }
    }

    absorb(local.bookmarks);
    absorb(remote.bookmarks);

    return {
      version: store().STORE_VERSION,
      bookmarks: order.map(function (id) { return byId[id]; }),
      deletedBookmarks: deletedBookmarks
    };
  }

  // 서버가 owners 인덱스에서 통째로 만들어 준 북마크는 id 가 'lib_<code>' 다.
  // 이 브라우저가 예전에 같은 code 를 로컬로 되찾아 뒀다면 내용이 같은 폴더가
  // 이미 있으므로, 서버 쪽 id 를 그 로컬 id 로 바꿔 하나로 합친다.
  function realignMigratedIds(remoteData) {
    var l = lib();
    if (!l || !l.getLocalLinkForCode) return remoteData;
    for (var i = 0; i < remoteData.bookmarks.length; i++) {
      var b = remoteData.bookmarks[i];
      if (b.id.indexOf('lib_') !== 0) continue;
      var link = l.getLocalLinkForCode(b.id.slice(4));
      if (link && link.bookmarkId && store().getBookmark(link.bookmarkId)) {
        b.id = link.bookmarkId;
      }
    }
    return remoteData;
  }

  // 키 순서에 흔들리지 않는 비교용 지문. JSON.stringify 로 두 스토어를
  // 비교하면 필드 순서만 달라도 "바뀌었다"가 되어, 두 기기가 서로에게
  // 똑같은 데이터를 60초마다 되던지는 핑퐁이 생긴다.
  function dataSignature(data) {
    var lines = [];
    var bookmarks = (data.bookmarks || []).slice().sort(function (a, b) {
      return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    });
    for (var i = 0; i < bookmarks.length; i++) {
      var b = bookmarks[i];
      var itemKeys = (b.items || []).map(function (it) { return it.type + ':' + it.id; }).sort();
      lines.push(b.id + '|' + b.name + '|' + (b.updatedAt || 0) + '|' + itemKeys.join(','));
    }
    var deleted = (data.deletedBookmarks || []).map(function (t) { return t.id; }).sort();
    return lines.join(';') + '#' + deleted.join(',');
  }

  // 반환값은 "병합 결과가 서버 사본과 다른가" — true 면 이 기기에만 있던
  // 변경이 섞였다는 뜻이라 되돌려 올려야 한다.
  function applyRemote(record) {
    var remoteSignature = dataSignature(record.data);
    var remoteData = realignMigratedIds(record.data);
    var merged = mergeStores(store().getRawStore(), remoteData);
    applyingRemote = true;
    try {
      store().replaceStore(merged, { silent: true });
    } finally {
      applyingRemote = false;
    }
    setSyncVersion(record.syncVersion);
    // 조용히 앉혔으므로 화면이 스스로 갱신되도록 따로 알린다.
    // source 가 remote 라 아래 리스너는 이걸 다시 업로드하지 않는다.
    try {
      global.dispatchEvent(new CustomEvent('chokaguya:bookmarks-change', { detail: { source: 'remote' } }));
    } catch (e) {}
    return dataSignature(merged) !== remoteSignature;
  }

  // ---- 업스트림 ----

  function pushNow() {
    var code = personalCode();
    if (!code || !store()) return Promise.resolve();
    if (inFlight) { pendingPush = true; return Promise.resolve(); }

    inFlight = true;
    setStatus('syncing');
    var snapshot = store().getRawStore();

    return fetch(SYNC_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalCode: code,
        clientSyncVersion: getSyncVersion(),
        data: snapshot
      })
    }).then(function (res) {
      if (res.ok) {
        return res.json().then(function (data) {
          setSyncVersion(data.serverSyncVersion);
          dirty = false;
          setStatus('synced');
        });
      }
      if (res.status === 409) {
        // 다른 기기가 먼저 썼다 — 그 사본과 합친 뒤 새 버전으로 다시 올린다
        return res.json().then(function (data) {
          if (!data.serverStore) return;
          applyRemote(data.serverStore);
          pendingPush = true;
        });
      }
      if (res.status === 404) {
        // 로그인은 돼 있는데 서버 계정이 없다(구버전 코드) — 만들고 다시 올린다
        return postJson(SIGNUP_URL, { personalCode: code }).then(function (signupRes) {
          if (!signupRes.ok) throw new Error(messageForStatus(signupRes.status));
          setSyncVersion(1);
          pendingPush = true;
        });
      }
      throw new Error(messageForStatus(res.status));
    }).catch(function () {
      setStatus(global.navigator && global.navigator.onLine === false ? 'offline' : 'error');
    }).then(function () {
      inFlight = false;
      if (pendingPush) {
        pendingPush = false;
        return pushNow();
      }
    });
  }

  function schedulePush() {
    if (!canSync()) return;
    dirty = true;
    setStatus('syncing');
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      pushTimer = null;
      pushNow().then(function () {
        if (channel) {
          try { channel.postMessage({ type: 'pushed', version: getSyncVersion() }); } catch (e) {}
        }
      });
    }, DEBOUNCE_MS);
  }

  // ---- 다운스트림 ----

  function pullFull() {
    var code = personalCode();
    if (!code || !store()) return Promise.resolve();
    return postJson(GET_URL, { personalCode: code }).then(function (res) {
      if (!res.ok) return failWith(res);
      return res.json();
    }).then(function (data) {
      var localOnlyChanges = applyRemote(data.userStore);
      setStatus('synced');
      if (localOnlyChanges) schedulePush();
    });
  }

  function pullIfStale() {
    var code = personalCode();
    if (!code || !store()) return Promise.resolve();
    return postJson(HEAD_URL, { personalCode: code }).then(function (res) {
      if (res.status === 404) {
        // 구버전 코드로 로그인한 상태 — 계정을 만들고 지금 로컬을 올린다
        return postJson(SIGNUP_URL, { personalCode: code }).then(function (signupRes) {
          if (!signupRes.ok) return;
          setSyncVersion(1);
          schedulePush();
        });
      }
      if (!res.ok) return failWith(res);
      return res.json().then(function (meta) {
        if (meta.syncVersion > getSyncVersion()) return pullFull();
        setStatus('synced');
      });
    }).catch(function () {
      setStatus(global.navigator && global.navigator.onLine === false ? 'offline' : 'error');
    });
  }

  // ---- 공개 진입점 ----

  function signup(rawCode) {
    var l = lib();
    var code = l.normalizePersonalCode(rawCode);
    return postJson(SIGNUP_URL, { personalCode: code }).then(function (res) {
      if (!res.ok) return failWith(res);
      return res.json();
    }).then(function (data) {
      // 서버에 계정이 생긴 걸 확인한 뒤에야 로컬에 코드를 저장한다 —
      // 순서가 반대면 "가입은 됐는데 다른 기기에선 로그인 안 되는" 상태가 된다
      l.adoptPersonalCode(code);
      setSyncVersion(data.syncVersion || 1);
      setStatus('synced');
      // 이 브라우저에 이미 있던 북마크를 새 계정에 올려둔다
      if (store() && store().getRawStore().bookmarks.length) schedulePush();
      return code;
    });
  }

  function login(rawCode) {
    var l = lib();
    var code = l.normalizePersonalCode(rawCode);
    if (code.length < 16) {
      return Promise.reject(new Error('개인 코드 형식이 올바르지 않아요. 20자리 코드를 정확히 입력해주세요.'));
    }
    return postJson(GET_URL, { personalCode: code }).then(function (res) {
      if (!res.ok) return failWith(res);
      return res.json();
    }).then(function (data) {
      // 계정이 있으면 북마크가 0개여도 로그인 성공이다 — 빈 계정을 실패로
      // 취급하던 게 신규 가입자의 첫 로그인을 막던 원인이었다
      l.adoptPersonalCode(code);
      if (store()) {
        // 이 기기에 이미 있던 북마크가 서버 것과 합쳐졌으면 되돌려 올린다
        if (applyRemote(data.userStore)) schedulePush();
      } else {
        // 로컬 북마크를 다루지 않는 페이지(mainPage 등)에서도 로그인 자체는 된다
        setSyncVersion(data.userStore.syncVersion);
      }
      setStatus('synced');
      return code;
    });
  }

  function syncNow() {
    if (!canSync()) return Promise.resolve();
    return pullIfStale().then(function () {
      if (!dirty) return;
      if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
      return pushNow();
    });
  }

  // ---- 이벤트 배선 ----

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(function () {
      if (canSync() && !global.document.hidden) pullIfStale();
    }, POLL_INTERVAL_MS);
  }

  global.addEventListener('chokaguya:bookmarks-change', function (e) {
    if (applyingRemote) return;
    var source = e.detail && e.detail.source;
    // storage 는 같은 기기 다른 탭이 이미 올린 변경, remote 는 방금 서버에서
    // 받아 앉힌 것 — 둘 다 다시 올리면 순환이다
    if (source === 'remote' || source === 'storage') return;
    schedulePush();
  });

  global.addEventListener('chokaguya:auth-change', function (e) {
    var loggedIn = e.detail && e.detail.loggedIn;
    if (loggedIn) {
      startPolling();
      pullIfStale();
    } else {
      if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
      setSyncVersion(0);
      setStatus('offline');
    }
  });

  global.addEventListener('online', function () { if (canSync()) pullIfStale(); });
  global.addEventListener('offline', function () { setStatus('offline'); });
  global.addEventListener('focus', function () { if (canSync()) pullIfStale(); });

  if (global.document) {
    global.document.addEventListener('visibilitychange', function () {
      if (!global.document.hidden && canSync()) pullIfStale();
    });
  }

  if (channel) {
    channel.onmessage = function (e) {
      if (!e.data || e.data.type !== 'pushed' || !canSync()) return;
      if ((e.data.version || 0) > getSyncVersion()) pullFull();
    };
  }

  function boot() {
    if (!canSync()) { setStatus('offline'); return; }
    startPolling();
    pullIfStale();
  }

  if (global.document && global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.UserData = {
    signup: signup,
    login: login,
    syncNow: syncNow,
    getStatus: function () { return status; },
    mergeStores: mergeStores
  };
})(window);
