/**
 * ChoKaguya Bookmarks Store
 * - 즐겨찾기(타입별 고정 4버킷, favorites.js)를 대체합니다. 유저가 이름을
 *   직접 지은 북마크(재생목록 개념)를 여러 개 만들고, 게시물/시리즈를
 *   { type, id } 쌍으로 원하는 북마크에 담습니다. 한 항목은 여러 북마크에
 *   동시에 들어갈 수 있습니다.
 * - localStorage 에 { version: 2, bookmarks: [...], deletedBookmarks: [...] }
 *   형태로 저장합니다. 기존 chokaguya_favorites 키는 건드리지 않고 그대로
 *   방치합니다 — 마이그레이션 없이 새로 시작.
 * - version 2 에서 북마크마다 updatedAt, 아이템마다 addedAt 이 붙었습니다.
 *   userData.js 의 다기기 병합이 "어느 쪽이 더 최신인지" 판단하는 근거라
 *   없으면 충돌 해결이 불가능합니다. version 1 로 저장된 기존 데이터는
 *   loadFromStorage 가 읽는 시점에 migrateStore 가 승격시킵니다.
 * - 삭제는 곧바로 지우지 않고 deletedBookmarks / removedItems 에 묘비를
 *   남깁니다. 그러지 않으면 A기기에서 지운 북마크가 B기기의 오래된 사본과
 *   합쳐질 때 "B에만 있는 항목"으로 보여 되살아납니다. 묘비는 30일 뒤 정리.
 * - 스토어가 바뀌면 window 에 'chokaguya:bookmarks-change' 커스텀 이벤트가
 *   발생합니다(detail.source 로 어디서 비롯됐는지 구분). userData.js 가
 *   이걸 듣고 서버에 올립니다.
 */
(function (global) {
  var STORAGE_KEY = 'chokaguya_bookmarks';
  var STORE_VERSION = 2;
  var TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

  function emptyStore() {
    return { version: STORE_VERSION, bookmarks: [], deletedBookmarks: [] };
  }

  function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // localStorage 읽기는 동기라 메인 스레드를 막음 — favorites.js 와 같은 이유로
  // 캐시해두고 쓰기 때만 localStorage 를 건드림
  var cache = null;

  function isValidStore(store) {
    if (!store || typeof store !== 'object') return false;
    if (store.version !== STORE_VERSION || !Array.isArray(store.bookmarks)) return false;
    if (!Array.isArray(store.deletedBookmarks)) return false;
    for (var i = 0; i < store.bookmarks.length; i++) {
      var b = store.bookmarks[i];
      if (!b || typeof b !== 'object') return false;
      if (typeof b.id !== 'string' || typeof b.name !== 'string') return false;
      if (!Array.isArray(b.items)) return false;
    }
    return true;
  }

  // version 1 { version, bookmarks: [{id, name, createdAt, items: [{type,id}]}] }
  // → version 2. 타임스탬프가 없던 데이터라 createdAt 을 그대로 물려주고,
  // 그마저 없으면 현재 시각으로 채운다. 항목은 한 건도 버리지 않는다.
  function migrateStore(store) {
    if (!store || typeof store !== 'object') return null;
    if (store.version === STORE_VERSION) return store;
    if (store.version !== 1 || !Array.isArray(store.bookmarks)) return null;

    var now = Date.now();
    var bookmarks = [];
    for (var i = 0; i < store.bookmarks.length; i++) {
      var b = store.bookmarks[i];
      if (!b || typeof b !== 'object') continue;
      if (typeof b.id !== 'string' || typeof b.name !== 'string') continue;
      var stamp = typeof b.createdAt === 'number' ? b.createdAt : now;
      var items = [];
      var rawItems = Array.isArray(b.items) ? b.items : [];
      for (var j = 0; j < rawItems.length; j++) {
        var it = rawItems[j];
        if (!it || typeof it !== 'object') continue;
        items.push({ type: it.type, id: it.id, addedAt: stamp });
      }
      bookmarks.push({
        id: b.id,
        name: b.name,
        createdAt: stamp,
        updatedAt: stamp,
        items: items,
        removedItems: []
      });
    }
    return { version: STORE_VERSION, bookmarks: bookmarks, deletedBookmarks: [] };
  }

  // 오래된 묘비는 계속 쌓이면 동기화 페이로드만 부풀리므로 읽을 때 정리한다.
  // TTL 안에 모든 기기가 한 번쯤은 동기화됐다고 보는 게 전제.
  function pruneTombstones(store) {
    var cutoff = Date.now() - TOMBSTONE_TTL_MS;
    store.deletedBookmarks = store.deletedBookmarks.filter(function (t) {
      return t && typeof t.id === 'string' && (t.deletedAt || 0) >= cutoff;
    });
    for (var i = 0; i < store.bookmarks.length; i++) {
      var b = store.bookmarks[i];
      if (!Array.isArray(b.removedItems)) { b.removedItems = []; continue; }
      b.removedItems = b.removedItems.filter(function (t) {
        return t && (t.removedAt || 0) >= cutoff;
      });
    }
    return store;
  }

  function loadFromStorage() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyStore();
      var migrated = migrateStore(JSON.parse(raw));
      if (!migrated || !isValidStore(migrated)) return emptyStore();
      return pruneTombstones(migrated);
    } catch (e) {
      return emptyStore();
    }
  }

  function readAll() {
    if (cache === null) cache = loadFromStorage();
    return cache;
  }

  function dispatchChange(source) {
    try {
      global.dispatchEvent(new CustomEvent('chokaguya:bookmarks-change', {
        detail: { source: source }
      }));
    } catch (e) {}
  }

  // silent 는 userData.js 가 서버에서 받은 데이터를 로컬에 앉힐 때만 씀 —
  // 그때 이벤트를 쏘면 그대로 다시 서버로 올라가는 순환이 생긴다.
  function writeAll(store, options) {
    cache = store;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (e) {}
    if (!options || !options.silent) dispatchChange((options && options.source) || 'local');
  }

  // 다른 탭에서 store 가 바뀌면 캐시를 버려서 다음 읽기가 다시 파싱하게 함.
  // 이벤트도 함께 쏴서 열려 있는 화면이 새로고침 없이 따라오게 하되,
  // source 로 구분해줘야 userData.js 가 남의 탭이 이미 올린 걸 또 올리지 않음.
  if (global.addEventListener) {
    global.addEventListener('storage', function (e) {
      if (!e.key || e.key === STORAGE_KEY) {
        cache = null;
        dispatchChange('storage');
      }
    });
  }

  function findBookmark(store, id) {
    for (var i = 0; i < store.bookmarks.length; i++) {
      if (store.bookmarks[i].id === id) return store.bookmarks[i];
    }
    return null;
  }

  function sameItem(item, type, id) {
    return item.type === type && item.id === id;
  }

  function cloneItem(it) {
    return { type: it.type, id: it.id, addedAt: it.addedAt };
  }

  function cloneBookmark(b) {
    return {
      id: b.id,
      name: b.name,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      items: b.items.map(cloneItem)
    };
  }

  function getAllBookmarks() {
    return readAll().bookmarks.map(cloneBookmark);
  }

  function getBookmark(id) {
    var b = findBookmark(readAll(), id);
    return b ? cloneBookmark(b) : null;
  }

  function createBookmark(name) {
    var store = readAll();
    var clean = (name || '').trim() || '새 북마크';
    var now = Date.now();
    var bookmark = { id: genId(), name: clean, createdAt: now, updatedAt: now, items: [], removedItems: [] };
    store.bookmarks.push(bookmark);
    writeAll(store);
    return bookmark.id;
  }

  function renameBookmark(id, name) {
    var store = readAll();
    var b = findBookmark(store, id);
    var clean = (name || '').trim();
    if (!b || !clean) return false;
    b.name = clean;
    b.updatedAt = Date.now();
    writeAll(store);
    return true;
  }

  function deleteBookmark(id) {
    var store = readAll();
    var idx = -1;
    for (var i = 0; i < store.bookmarks.length; i++) {
      if (store.bookmarks[i].id === id) { idx = i; break; }
    }
    if (idx === -1) return false;
    store.bookmarks.splice(idx, 1);
    store.deletedBookmarks.push({ id: id, deletedAt: Date.now() });
    writeAll(store);
    return true;
  }

  function isInBookmark(bookmarkId, type, id) {
    var b = findBookmark(readAll(), bookmarkId);
    if (!b) return false;
    for (var i = 0; i < b.items.length; i++) {
      if (sameItem(b.items[i], type, id)) return true;
    }
    return false;
  }

  function isInAnyBookmark(type, id) {
    var bookmarks = readAll().bookmarks;
    for (var i = 0; i < bookmarks.length; i++) {
      for (var j = 0; j < bookmarks[i].items.length; j++) {
        if (sameItem(bookmarks[i].items[j], type, id)) return true;
      }
    }
    return false;
  }

  function getBookmarksContaining(type, id) {
    var bookmarks = readAll().bookmarks;
    var result = [];
    for (var i = 0; i < bookmarks.length; i++) {
      for (var j = 0; j < bookmarks[i].items.length; j++) {
        if (sameItem(bookmarks[i].items[j], type, id)) { result.push(bookmarks[i].id); break; }
      }
    }
    return result;
  }

  function dropRemovedItemTombstone(b, type, id) {
    if (!Array.isArray(b.removedItems)) { b.removedItems = []; return; }
    b.removedItems = b.removedItems.filter(function (t) { return !sameItem(t, type, id); });
  }

  function addItemToBookmark(bookmarkId, type, id) {
    var store = readAll();
    var b = findBookmark(store, bookmarkId);
    if (!b) return false;
    for (var i = 0; i < b.items.length; i++) {
      if (sameItem(b.items[i], type, id)) return false;
    }
    var now = Date.now();
    b.items.push({ type: type, id: id, addedAt: now });
    // 다시 담았으면 예전 삭제 기록은 무효 — 안 지우면 병합이 이걸 보고 또 뺀다
    dropRemovedItemTombstone(b, type, id);
    b.updatedAt = now;
    writeAll(store);
    return true;
  }

  function removeItemFromBookmark(bookmarkId, type, id) {
    var store = readAll();
    var b = findBookmark(store, bookmarkId);
    if (!b) return false;
    for (var i = 0; i < b.items.length; i++) {
      if (sameItem(b.items[i], type, id)) {
        var now = Date.now();
        b.items.splice(i, 1);
        if (!Array.isArray(b.removedItems)) b.removedItems = [];
        b.removedItems.push({ type: type, id: id, removedAt: now });
        b.updatedAt = now;
        writeAll(store);
        return true;
      }
    }
    return false;
  }

  // 반환값은 토글 후 "이 북마크에 들어있는지" 새 상태 (favorites.js 의
  // toggle 이 새 즐겨찾기 상태를 반환하던 관례와 동일)
  function toggleItemInBookmark(bookmarkId, type, id) {
    if (isInBookmark(bookmarkId, type, id)) {
      removeItemFromBookmark(bookmarkId, type, id);
      return false;
    }
    addItemToBookmark(bookmarkId, type, id);
    return true;
  }

  // 아래 둘은 userData.js(동기화 엔진) 전용 — 일반 UI 코드는 위의 개별
  // 함수들을 쓴다. 묘비까지 포함한 스토어 원본을 그대로 주고받아야
  // 병합이 삭제를 인식할 수 있다.
  function getRawStore() {
    return JSON.parse(JSON.stringify(readAll()));
  }

  function replaceStore(store, options) {
    if (!isValidStore(store)) return false;
    writeAll(pruneTombstones(store), options);
    return true;
  }

  global.Bookmarks = {
    getAllBookmarks: getAllBookmarks,
    getBookmark: getBookmark,
    createBookmark: createBookmark,
    renameBookmark: renameBookmark,
    deleteBookmark: deleteBookmark,
    isInBookmark: isInBookmark,
    isInAnyBookmark: isInAnyBookmark,
    getBookmarksContaining: getBookmarksContaining,
    addItemToBookmark: addItemToBookmark,
    removeItemFromBookmark: removeItemFromBookmark,
    toggleItemInBookmark: toggleItemInBookmark,
    getRawStore: getRawStore,
    replaceStore: replaceStore,
    STORE_VERSION: STORE_VERSION
  };
})(window);
