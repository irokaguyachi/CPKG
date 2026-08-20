/**
 * ChoKaguya Bookmarks Store
 * - 즐겨찾기(타입별 고정 4버킷, favorites.js)를 대체합니다. 유저가 이름을
 *   직접 지은 북마크(재생목록 개념)를 여러 개 만들고, 게시물/시리즈를
 *   { type, id } 쌍으로 원하는 북마크에 담습니다. 한 항목은 여러 북마크에
 *   동시에 들어갈 수 있습니다.
 * - localStorage 에 { version: 1, bookmarks: [{ id, name, createdAt, items }] }
 *   형태로 저장합니다. 기존 chokaguya_favorites 키는 건드리지 않고 그대로
 *   방치합니다 — 마이그레이션 없이 새로 시작.
 */
(function (global) {
  var STORAGE_KEY = 'chokaguya_bookmarks';

  function emptyStore() {
    return { version: 1, bookmarks: [] };
  }

  function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // localStorage 읽기는 동기라 메인 스레드를 막음 — favorites.js 와 같은 이유로
  // 캐시해두고 쓰기 때만 localStorage 를 건드림
  var cache = null;

  function isValidStore(store) {
    if (!store || typeof store !== 'object') return false;
    if (store.version !== 1 || !Array.isArray(store.bookmarks)) return false;
    for (var i = 0; i < store.bookmarks.length; i++) {
      var b = store.bookmarks[i];
      if (!b || typeof b !== 'object') return false;
      if (typeof b.id !== 'string' || typeof b.name !== 'string') return false;
      if (!Array.isArray(b.items)) return false;
    }
    return true;
  }

  function loadFromStorage() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyStore();
      var parsed = JSON.parse(raw);
      return isValidStore(parsed) ? parsed : emptyStore();
    } catch (e) {
      return emptyStore();
    }
  }

  function readAll() {
    if (cache === null) cache = loadFromStorage();
    return cache;
  }

  function writeAll(store) {
    cache = store;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (e) {}
  }

  // 다른 탭에서 store 가 바뀌면 캐시를 버려서 다음 읽기가 다시 파싱하게 함
  if (global.addEventListener) {
    global.addEventListener('storage', function (e) {
      if (!e.key || e.key === STORAGE_KEY) cache = null;
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

  function cloneBookmark(b) {
    return { id: b.id, name: b.name, createdAt: b.createdAt, items: b.items.slice() };
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
    var bookmark = { id: genId(), name: clean, createdAt: Date.now(), items: [] };
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

  function addItemToBookmark(bookmarkId, type, id) {
    var store = readAll();
    var b = findBookmark(store, bookmarkId);
    if (!b) return false;
    for (var i = 0; i < b.items.length; i++) {
      if (sameItem(b.items[i], type, id)) return false;
    }
    b.items.push({ type: type, id: id });
    writeAll(store);
    return true;
  }

  function removeItemFromBookmark(bookmarkId, type, id) {
    var store = readAll();
    var b = findBookmark(store, bookmarkId);
    if (!b) return false;
    for (var i = 0; i < b.items.length; i++) {
      if (sameItem(b.items[i], type, id)) {
        b.items.splice(i, 1);
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
    toggleItemInBookmark: toggleItemInBookmark
  };
})(window);
