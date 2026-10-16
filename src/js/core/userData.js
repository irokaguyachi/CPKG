/**
 * ChoKaguya User Data Sync (계정 클라우드 동기화 엔진)
 * - bookmarks.js 의 로컬 스토어를 개인 코드로 식별되는 서버 계정
 *   (worker/favoritesShareWorker.js 의 /user/*)과 양방향으로 맞춥니다.
 *   공개 라이브러리(bookmarkLibrary.js)와는 별개 층입니다 — 저쪽은 "남에게
 *   보여주려고 발행한 스냅샷", 이쪽은 "비공개 포함 내 데이터 전부".
 * - 자동 동기화(폴링, 포커스/탭전환 감지, 다른 탭 알림)는 전부 없앴습니다 —
 *   서버 요청이 너무 잦아지는 게 문제였습니다. 대신 헤더의 동기화 버튼을
 *   눌러야만 로컬↔서버를 맞춥니다. 로그인/가입 직후 서버 데이터를 한 번
 *   받아오는 것만 예외입니다 — 그건 로그인 절차 자체지 "동기화를 자동
 *   반복"하는 게 아닙니다.
 * - 동기화 버튼은 방향을 사용자가 직접 고릅니다(auth.js 의 팝오버) —
 *   saveToServer(이 기기 → 서버) / loadFromServer(서버 → 이 기기, 병합
 *   없이 그대로 덮어씀). 예전엔 "서버가 더 최신이면 받고 아니면 올린다"를
 *   자동 판단하는 버튼 하나였는데, 그러면 "이미 버전이 맞더라도 서버 걸
 *   그대로 가져오고 싶다"는 요청을 처리할 방법이 없었습니다.
 * - saveToServer: 스토어 전체를 스냅샷으로 올립니다. 부분 diff 를 보내지
 *   않으므로 오프라인 중 쌓인 변경을 따로 큐에 담을 필요가 없습니다 —
 *   로컬 스토어 자체가 항상 "보낼 것"입니다. 충돌은 서버가 아니라
 *   여기서 풉니다(mergeStores). 서버는 syncVersion 과 etag 로 "덮어써도
 *   되는지"만 판정하고, 뒤처졌으면 409와 함께 서버 사본을 돌려줍니다.
 *   병합 구현이 한쪽에만 있어야 두 구현이 어긋날 일이 없습니다.
 * - loadFromServer: 병합하지 않고 서버 사본을 그대로 앉힙니다 — 아직
 *   서버에 못 올린 변경이 있으면 사라진다는 뜻이라 먼저 확인을 받습니다.
 */
(function (global) {
  var t = global.I18n.t;
  // bookmarkLibrary.js 와 같은 이유로 상대 경로를 쓴다 — API가 같은
  // Worker(cpkg)에 합쳐져 있으므로 같은 오리진 호출이면 충분하다.
  var WORKER_BASE = '';
  var SIGNUP_URL = WORKER_BASE + '/user/signup';
  var GET_URL = WORKER_BASE + '/user/get';
  var SYNC_URL = WORKER_BASE + '/user/sync';
  var DELETE_URL = WORKER_BASE + '/user/delete';
  var LOGIN_URL = WORKER_BASE + '/user/login';
  var LOGIN_ID_SET_URL = WORKER_BASE + '/login-id/set';
  var LOGIN_ID_ME_URL = WORKER_BASE + '/login-id/me';
  // 기억해 둔 로그인 아이디 { code, loginId, changeableAt } — logout() 이 지운다
  var LOGIN_ID_KEY = 'chokaguya_login_id';
  // 서버(worker/loginIdConfig.js)와 같은 값 — 2026-11-01 00:00 KST
  var LOGIN_CODE_DEADLINE = Date.UTC(2026, 9, 31, 15, 0, 0);
  var LOGIN_ID_PATTERN = /^[a-z0-9_]{4,20}$/;
  // 삭제된 계정 안내 alert 을 이 탭에서 이미 띄웠는지 (탭당 한 번만)
  var DELETED_ALERT_KEY = 'chokaguya_deleted_alerted';

  var SYNC_VERSION_KEY = 'chokaguya_sync_version';
  var LAST_SYNC_AT_KEY = 'chokaguya_last_sync_at';
  // 동기화 버튼을 누른 뒤 이 시간 안에는 다시 눌러도 서버로 안 나간다 —
  // "동기화 쿨타임중.." 으로 표시만 해준다. localStorage 에 저장해서
  // 새로고침으로 우회하지 못하게 한다.
  var SYNC_COOLDOWN_MS = 120000;
  var COOLDOWN_LABEL_MS = 2500;

  var inFlight = false;
  var pendingPush = false;
  var applyingRemote = false;
  // 서버에 아직 못 올린 변경이 있는가. 로컬 변경이 생겨도 자동으로 올리지
  // 않으므로, 사용자가 동기화 버튼을 눌러야 할지 이 플래그로 알려준다.
  var dirty = false;
  var status = 'offline';
  var lastSyncAt = 0;
  try { lastSyncAt = parseInt(localStorage.getItem(LAST_SYNC_AT_KEY) || '0', 10) || 0; } catch (e) {}

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

  // 서버가 계정이 삭제됐다고 알리는 410 본문. 숨겨진 서재의 410 {error:'hidden'} 과
  // 구별해야 하므로 상태 코드만으로 판단하지 않는다.
  function isAccountDeletedBody(data) {
    return !!(data && data.error === 'account deleted');
  }

  // 삭제된 계정으로 요청이 들어왔을 때 — 이 브라우저를 로그아웃시키고 탭당
  // 한 번만 알린다. bookmarkLibrary.js·profileStore.js 도 이 함수를 부른다.
  var deletedAlerted = false;
  function handleAccountDeleted() {
    var l = lib();
    if (l && l.logout) l.logout();
    var already = deletedAlerted;
    try { if (global.sessionStorage.getItem(DELETED_ALERT_KEY)) already = true; } catch (e) {}
    if (already) return;
    deletedAlerted = true;
    try { global.sessionStorage.setItem(DELETED_ALERT_KEY, '1'); } catch (e) {}
    try { global.alert(t('삭제된 계정이라 로그아웃됐어요.')); } catch (e) {}
  }

  // 응답이 410 {error:'account deleted'} 이면 로그아웃하고 표시를 단 오류로 reject.
  // 그 밖의 응답은 null (호출부가 계속 처리).
  function rejectIfDeleted(res) {
    if (res.status !== 410) return Promise.resolve(null);
    return res.json().catch(function () { return {}; }).then(function (data) {
      if (!isAccountDeletedBody(data)) return null;
      handleAccountDeleted();
      var err = new Error(messageForStatus(410));
      err.accountDeleted = true;
      return err;
    });
  }

  function messageForStatus(code) {
    if (code === 429) return t('요청이 너무 잦아요. 잠시 후 다시 시도해주세요.');
    if (code === 404) return t('이 코드로 만들어진 계정을 찾을 수 없어요. 코드를 다시 확인해주세요.');
    if (code === 400) return t('코드 형식이 올바르지 않아요.');
    if (code === 410) return t('삭제된 계정의 코드예요.');
    return t('서버와 통신하지 못했어요 ({code})', { code: code });
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

  // publishedCode는 북마크 전체의 공용 updatedAt(이름 변경 등 아무 수정에나
  // 갱신됨)을 기준으로 병합하면 안 된다 — 한 기기가 공개를 취소한 직후에,
  // 그 사실을 아직 못 받아본 다른 기기가 이름만 바꿔도 그 변경이 "더
  // 최신"으로 잡혀서 이미 지운 공개 게시물이 되살아나 버린다(실사용
  // 중에 실제로 재현된 회귀). publishedCode 전용 타임스탬프
  // (publishedCodeUpdatedAt)끼리만 비교해야 이 필드가 다른 필드의 변경에
  // 휩쓸리지 않는다.
  function mergePublishedCode(a, b) {
    var winner = (b.publishedCodeUpdatedAt || 0) >= (a.publishedCodeUpdatedAt || 0) ? b : a;
    return {
      publishedCode: winner.publishedCode || null,
      publishedCodeUpdatedAt: winner.publishedCodeUpdatedAt || 0
    };
  }

  function mergeBookmark(a, b) {
    var removedItems = mergeTombstones(a.removedItems, b.removedItems, 'removedAt');
    var newer = (b.updatedAt || 0) > (a.updatedAt || 0) ? b : a;
    var pub = mergePublishedCode(a, b);
    return {
      id: a.id,
      name: newer.name,
      createdAt: Math.min(a.createdAt || 0, b.createdAt || 0) || (a.createdAt || b.createdAt || 0),
      updatedAt: Math.max(a.updatedAt || 0, b.updatedAt || 0),
      items: mergeItems(a.items, b.items, tombstoneMap(removedItems, 'removedAt')),
      removedItems: removedItems,
      publishedCode: pub.publishedCode,
      publishedCodeUpdatedAt: pub.publishedCodeUpdatedAt
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
      lines.push(b.id + '|' + b.name + '|' + (b.updatedAt || 0) + '|' + (b.publishedCode || '') + '|' + itemKeys.join(','));
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
        // 다른 기기가 먼저 썼다 — 그 사본과 합친 뒤 새 버전으로 다시 올린다.
        // 이건 지금 누른 동기화 버튼 한 번을 완결짓는 재시도라 자동 폴링이
        // 아니다.
        return res.json().then(function (data) {
          if (!data.serverStore) return;
          applyRemote(data.serverStore);
          pendingPush = true;
        });
      }
      if (res.status === 404) {
        // 로그인은 돼 있는데 서버 계정이 없다(구버전 코드) — 만들고 다시 올린다
        return postJson(SIGNUP_URL, { personalCode: code }).then(function (signupRes) {
          if (signupRes.ok) {
            setSyncVersion(1);
            pendingPush = true;
            return;
          }
          // 삭제된 계정이면 다시 만들지 않고 로그아웃한다
          return rejectIfDeleted(signupRes).then(function (err) {
            throw err || new Error(messageForStatus(signupRes.status));
          });
        });
      }
      // 삭제된 계정이면 재가입 시도 없이 로그아웃한다
      return rejectIfDeleted(res).then(function (err) {
        throw err || new Error(messageForStatus(res.status));
      });
    }).catch(function (err) {
      // 로그아웃은 auth-change 가 이미 상태를 정리했다
      if (err && err.accountDeleted) { pendingPush = false; return; }
      setStatus(global.navigator && global.navigator.onLine === false ? 'offline' : 'error');
    }).then(function () {
      inFlight = false;
      if (pendingPush) {
        pendingPush = false;
        return pushNow();
      }
    });
  }

  // 로컬 변경이 생겨도 곧장 서버로 올리지 않는다 — "아직 안 올렸다"는
  // 표시만 남기고, 실제 업로드는 사용자가 동기화 버튼에서 "저장"을
  // 골랐을 때만(saveToServer) 한다.
  function markDirty() {
    if (!canSync()) return;
    dirty = true;
    setStatus('pending');
  }

  // ---- 다운스트림 ----
  // (버전이 서버가 더 최신인지 미리 찔러보는 pullIfStale/HEAD_URL 은
  // "저장"/"불러오기"로 나누면서 안 쓰게 됐다 — loadFromServer는 버전 비교
  // 없이 항상 서버 사본을 그대로 가져온다.)

  // ---- 공개 진입점 ----

  // 서버에 계정이 생긴 걸 확인한 뒤에야 로컬에 코드를 저장한다 —
  // 순서가 반대면 "가입은 됐는데 다른 기기에선 로그인 안 되는" 상태가 된다
  function finishSignup(code, data) {
    lib().adoptPersonalCode(code);
    setSyncVersion(data.syncVersion || 1);
    // 이 브라우저에 이미 있던 북마크는 동기화 버튼을 눌러야 새 계정에
    // 올라간다 — 자동으로 올리지 않는다.
    if (store() && store().getRawStore().bookmarks.length) {
      dirty = true;
      setStatus('pending');
    } else {
      setStatus('synced');
    }
  }

  function signup(rawCode) {
    var l = lib();
    var code = l.normalizePersonalCode(rawCode);
    return postJson(SIGNUP_URL, { personalCode: code }).then(function (res) {
      if (!res.ok) return failWith(res);
      return res.json();
    }).then(function (data) {
      finishSignup(code, data);
      return code;
    });
  }

  function login(rawCode) {
    var l = lib();
    var code = l.normalizePersonalCode(rawCode);
    if (code.length < 16) {
      return Promise.reject(new Error(t('개인 코드 형식이 올바르지 않아요. 20자리 코드를 정확히 입력해주세요.')));
    }
    return postJson(GET_URL, { personalCode: code }).then(function (res) {
      if (!res.ok) return failWith(res);
      return res.json();
    }).then(function (data) {
      // 계정이 있으면 북마크가 0개여도 로그인 성공이다 — 빈 계정을 실패로
      // 취급하던 게 신규 가입자의 첫 로그인을 막던 원인이었다
      l.adoptPersonalCode(code);
      if (store()) {
        // 이 기기에 이미 있던 북마크가 서버 것과 합쳐졌으면 동기화가 필요하다
        if (applyRemote(data.userStore)) { dirty = true; setStatus('pending'); }
        else setStatus('synced');
      } else {
        // 로컬 북마크를 다루지 않는 페이지(mainPage 등)에서도 로그인 자체는 된다
        setSyncVersion(data.userStore.syncVersion);
        setStatus('synced');
      }
      return code;
    });
  }

  // ---- 로그인 아이디 ----

  function isBeforeLoginCodeDeadline() {
    return Date.now() < LOGIN_CODE_DEADLINE;
  }

  function loginIdFormatMessage() {
    return t('영문 소문자, 숫자, _ 로 4~20자로 입력해 주세요.');
  }

  // 서버와 같은 규칙(trim 후 소문자)으로 미리 걸러 낸다. 서버로는 원문을 보내고
  // 정규화는 서버가 한다.
  function isValidLoginId(raw) {
    return LOGIN_ID_PATTERN.test(String(raw == null ? '' : raw).trim().toLowerCase());
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // 날짜 순서·단위는 언어마다 달라서 번역 틀로 만든다(loginIdModal.js 의 formatTime 과 같은 틀).
  function formatRetryTime(ms) {
    var d = new Date(ms);
    return t('{month}월 {day}일 {hh}:{mm}', {
      month: d.getMonth() + 1, day: d.getDate(), hh: pad2(d.getHours()), mm: pad2(d.getMinutes())
    });
  }

  function readRemembered() {
    try {
      var parsed = JSON.parse(localStorage.getItem(LOGIN_ID_KEY) || 'null');
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  function dispatchLoginIdChange(loginId) {
    try {
      global.dispatchEvent(new CustomEvent('chokaguya:login-id-change', { detail: { loginId: loginId } }));
    } catch (e) {}
  }

  function rememberLoginId(code, loginId, changeableAt) {
    try {
      localStorage.setItem(LOGIN_ID_KEY, JSON.stringify({ code: code, loginId: loginId, changeableAt: changeableAt || 0 }));
    } catch (e) {}
    dispatchLoginIdChange(loginId);
  }

  // 아이디 API 오류 → Error. 410(계정 삭제)은 로그아웃까지 하고 accountDeleted 표시를 단다.
  // kind: 'login' | 'signup' | 'set' | 'me' — 404·429 의 뜻이 호출마다 다르다.
  function loginIdFailure(res, kind) {
    return rejectIfDeleted(res).then(function (deletedErr) {
      if (deletedErr) return deletedErr;
      return res.json().catch(function () { return {}; }).then(function (body) {
        var s = res.status;
        // 409 는 두 가지다: 남이 쓰는 아이디(taken), 읽은 뒤 다른 곳에서 먼저 바뀜(changed)
        if (s === 409 && body && body.error === 'login id changed') {
          return new Error(t('다른 곳에서 아이디가 바뀌었어요. 다시 시도해 주세요.'));
        }
        if (s === 409) return new Error(t('이미 쓰이고 있는 아이디예요.'));
        if (s === 400 && body && body.error === 'invalid login id') return new Error(loginIdFormatMessage());
        if (s === 404 && kind === 'login') return new Error(t('없는 아이디예요.'));
        if (s === 429 && kind === 'set' && body && body.retryAt) {
          return new Error(t('{time} 이후에 다시 바꿀 수 있어요.', { time: formatRetryTime(body.retryAt) }));
        }
        return new Error(messageForStatus(s));
      });
    }).then(function (err) { throw err; });
  }

  function loginWithId(rawId) {
    if (!isValidLoginId(rawId)) return Promise.reject(new Error(loginIdFormatMessage()));
    var loginId = String(rawId).trim();
    return postJson(LOGIN_URL, { loginId: loginId }).then(function (res) {
      if (!res.ok) return loginIdFailure(res, 'login');
      return res.json();
    }).then(function (data) {
      return login(data.personalCode).then(function (code) {
        // 변경 가능 시각은 /login-id/me 로 확인해야 알 수 있다 — 0 으로 두면 서버가 429 로 막아 준다
        rememberLoginId(code, data.loginId || loginId.toLowerCase(), 0);
        return code;
      });
    });
  }

  // 가입 도중 실패해도 같은 코드를 다시 쓴다 — 서버의 IP 일일 가입 한도가
  // 코드 해시 기준이라, 재시도마다 새 코드를 만들면 한도만 소진된다.
  // 가입에 성공하면 비운다.
  var pendingSignupCode = null;

  function signupWithId(rawId) {
    if (!isValidLoginId(rawId)) return Promise.reject(new Error(loginIdFormatMessage()));
    var l = lib();
    var loginId = String(rawId).trim();
    if (!pendingSignupCode) pendingSignupCode = l.issueNewPersonalCode();
    var code = pendingSignupCode;
    return postJson(SIGNUP_URL, { personalCode: code, loginId: loginId }).then(function (res) {
      if (!res.ok) return loginIdFailure(res, 'signup');
      return res.json();
    }).then(function (data) {
      pendingSignupCode = null;
      finishSignup(code, data);
      // 서버가 알려 준 아이디만 기억한다. 이미 있던 계정(existed)이면 보낸 아이디가 붙지 않았을 수
      // 있으므로 입력값을 기억하면 안 된다 — 없으면 getLoginId 가 나중에 서버에 다시 묻는다.
      if (data.loginId) rememberLoginId(code, data.loginId, 0);
      return code;
    });
  }

  // opts.fresh: 기억해 둔 값을 건너뛰고 서버에 다시 묻는다(쿨타임 잠금을 정확히 보여줄 때).
  function getLoginId(opts) {
    var code = personalCode();
    if (!code) return Promise.resolve({ loginId: null, changeableAt: 0 });
    var saved = readRemembered();
    if (!(opts && opts.fresh) && saved && saved.code === code && saved.loginId) {
      return Promise.resolve({ loginId: saved.loginId, changeableAt: saved.changeableAt || 0 });
    }
    return postJson(LOGIN_ID_ME_URL, { personalCode: code }).then(function (res) {
      if (!res.ok) return loginIdFailure(res, 'me');
      return res.json();
    }).then(function (data) {
      var result = { loginId: data.loginId || null, changeableAt: data.changeableAt || 0 };
      // 아직 아이디가 없으면 기억하지 않는다 — 곧 정할 것이므로 다음에 다시 물어야 한다
      if (result.loginId) rememberLoginId(code, result.loginId, result.changeableAt);
      return result;
    });
  }

  function setLoginId(rawId) {
    if (!isValidLoginId(rawId)) return Promise.reject(new Error(loginIdFormatMessage()));
    var code = personalCode();
    if (!code) return Promise.reject(new Error(messageForStatus(404)));
    return postJson(LOGIN_ID_SET_URL, { personalCode: code, loginId: String(rawId).trim() }).then(function (res) {
      if (!res.ok) return loginIdFailure(res, 'set');
      return res.json();
    }).then(function (data) {
      rememberLoginId(code, data.loginId, data.changeableAt);
      return { loginId: data.loginId, changeableAt: data.changeableAt };
    });
  }

  // 헤더의 동기화 버튼을 누르면 이제 "저장"/"불러오기" 중 하나를 고른다
  // (auth.js 의 팝오버) — 예전엔 버튼 하나가 "서버가 더 최신이면 받고,
  // 이 기기가 더 최신이면 올린다"를 알아서 판단했는데, 그러다 보니 정작
  // "서버에 있는 걸 그대로 가져오고 싶다"는 요청은 처리할 방법이 없었다
  // (버전이 이미 맞으면 pullIfStale 이 아무것도 안 받아온다). 두 방향을
  // 사용자가 직접 고르게 나눴다: saveToServer 는 이 기기 것을 서버에 그대로
  // 올리고(충돌 시에만 자동 병합), loadFromServer 는 서버 것을 병합 없이
  // 그대로 이 기기에 앉힌다. 둘 다 같은 쿨다운(SYNC_COOLDOWN_MS)을 공유한다
  // — 방향과 무관하게 서버 요청 자체를 남용하지 못하게 막는 게 목적이라서다.
  function checkCooldown() {
    var remaining = SYNC_COOLDOWN_MS - (Date.now() - lastSyncAt);
    if (remaining <= 0) return null;
    var prevStatus = status;
    setStatus('cooldown');
    setTimeout(function () {
      if (status === 'cooldown') setStatus(prevStatus);
    }, COOLDOWN_LABEL_MS);
    return { ok: false, reason: 'cooldown', remainingMs: remaining };
  }

  function markSynced() {
    lastSyncAt = Date.now();
    try { localStorage.setItem(LAST_SYNC_AT_KEY, String(lastSyncAt)); } catch (e) {}
  }

  // "저장" — 이 기기의 스토어를 서버에 올린다. pushNow() 가 409(다른 기기가
  // 먼저 썼음)는 자동으로 병합해 재시도하므로, 완전히 다른 기기의 최신
  // 변경을 실수로 지우지는 않는다.
  function saveToServer() {
    if (!canSync()) return Promise.resolve({ ok: false, reason: 'offline' });
    var blocked = checkCooldown();
    if (blocked) return Promise.resolve(blocked);

    return pushNow().then(function () {
      markSynced();
      return { ok: true };
    });
  }

  // "불러오기" — 서버 스토어를 병합 없이 그대로 이 기기에 앉힌다. 아직
  // 서버에 못 올린 변경(dirty)이 있으면 그게 사라진다는 뜻이라 먼저
  // 확인받는다(logout()의 confirm과 같은 자리).
  function loadFromServer() {
    if (!canSync()) return Promise.resolve({ ok: false, reason: 'offline' });
    var blocked = checkCooldown();
    if (blocked) return Promise.resolve(blocked);

    if (dirty) {
      var proceed = false;
      try {
        proceed = global.confirm(t('아직 서버에 저장하지 않은 변경사항이 있어요. 지금 불러오면 그 변경사항은 사라져요. 그래도 서버에 저장된 내용을 불러올까요?'));
      } catch (e) {}
      if (!proceed) return Promise.resolve({ ok: false, reason: 'cancelled' });
    }

    var code = personalCode();
    setStatus('syncing');
    return postJson(GET_URL, { personalCode: code }).then(function (res) {
      if (res.ok) return res.json();
      return rejectIfDeleted(res).then(function (err) { return err ? Promise.reject(err) : failWith(res); });
    }).then(function (data) {
      var remoteData = realignMigratedIds(data.userStore.data);
      applyingRemote = true;
      try {
        store().replaceStore(remoteData, { silent: true });
      } finally {
        applyingRemote = false;
      }
      setSyncVersion(data.userStore.syncVersion);
      dirty = false;
      // 조용히 앉혔으므로 화면이 스스로 갱신되도록 따로 알린다.
      // source 가 remote 라 아래 리스너는 이걸 다시 업로드하지 않는다.
      try {
        global.dispatchEvent(new CustomEvent('chokaguya:bookmarks-change', { detail: { source: 'remote' } }));
      } catch (e) {}
      markSynced();
      setStatus('synced');
      return { ok: true };
    }).catch(function (err) {
      if (err && err.accountDeleted) return { ok: false, reason: 'deleted' };
      setStatus(global.navigator && global.navigator.onLine === false ? 'offline' : 'error');
      return { ok: false, reason: 'error' };
    });
  }

  // 계정 삭제 — 서버에서 지우고 이 브라우저도 로그아웃한다.
  function deleteAccount() {
    var code = personalCode();
    var failed = function () { return new Error(t('지금은 계정을 삭제할 수 없어요.')); };
    if (!code) return Promise.reject(failed());
    return postJson(DELETE_URL, { personalCode: code }).then(function (res) {
      if (res.ok) {
        var l = lib();
        if (l && l.logout) l.logout();
        return;
      }
      // 404: 서버에 지울 계정이 없다(서버 저장소가 없는 옛 로그인 등) — 로그인만 풀면 된다
      if (res.status === 404) {
        var l2 = lib();
        if (l2 && l2.logout) l2.logout();
        return;
      }
      if (res.status === 429) throw new Error(t('요청이 너무 잦아요. 잠시 후 다시 시도해주세요.'));
      throw failed();
    }, function () { throw failed(); });
  }

  // ---- 이벤트 배선 ----
  // 폴링도, 포커스/탭전환 감지도, 다른 탭에서 온 알림도 없다 — 로컬 변경은
  // "동기화 필요" 표시만 남기고, 실제로 서버와 주고받는 건 오직 동기화
  // 버튼에서 고른 saveToServer/loadFromServer 뿐이다.

  global.addEventListener('chokaguya:bookmarks-change', function (e) {
    if (applyingRemote) return;
    var source = e.detail && e.detail.source;
    // remote 는 방금 서버에서 받아 앉힌 것이라 다시 표시할 필요가 없다
    if (source === 'remote') return;
    markDirty();
  });

  global.addEventListener('chokaguya:auth-change', function (e) {
    var loggedIn = e.detail && e.detail.loggedIn;
    if (!loggedIn) {
      setSyncVersion(0);
      dirty = false;
      setStatus('offline');
    }
    // 로그인 시에는 signup()/login() 이 이미 상태를 정해뒀다 — 여기서
    // 또 서버를 찔러 확인하지 않는다.
  });

  function boot() {
    // 서버에 새 변경이 있는지는 동기화 버튼을 눌러야 확인한다 — 로그인만
    // 돼 있으면 우선 "동기화 필요"로 보여준다.
    setStatus(canSync() ? 'pending' : 'offline');
  }

  if (global.document && global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.UserData = {
    signup: signup,
    login: login,
    saveToServer: saveToServer,
    loadFromServer: loadFromServer,
    getStatus: function () { return status; },
    mergeStores: mergeStores,
    isAccountDeletedBody: isAccountDeletedBody,
    handleAccountDeleted: handleAccountDeleted,
    deleteAccount: deleteAccount,
    LOGIN_CODE_DEADLINE: LOGIN_CODE_DEADLINE,
    isBeforeLoginCodeDeadline: isBeforeLoginCodeDeadline,
    loginWithId: loginWithId,
    signupWithId: signupWithId,
    getLoginId: getLoginId,
    setLoginId: setLoginId
  };
})(window);
