/**
 * ChoKaguya Favorites Store
 * - Persists favorited series/posts in localStorage as { key: meta }
 * - Today: toggling + read-back only. Viewing the full list, exporting to a
 *   JSON file, and importing one back are follow-up work (not implemented yet).
 */
(function (global) {
  var STORAGE_KEY = 'chokaguya_favorites';

  // localStorage reads are synchronous and block the main thread, and
  // isFavorite() runs once per card — re-parsing the whole store 50 times per
  // keystroke made typing in the search box stutter. Parse once, keep it in
  // memory, and only touch localStorage on write.
  var cache = null;

  function loadFromStorage() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function readAll() {
    if (cache === null) cache = loadFromStorage();
    return cache;
  }

  function writeAll(all) {
    cache = all;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch (e) {}
  }

  // another tab changed the store — drop the cache so the next read re-parses
  if (global.addEventListener) {
    global.addEventListener('storage', function (e) {
      if (!e.key || e.key === STORAGE_KEY) cache = null;
    });
  }

  function isFavorite(key) {
    if (!key) return false;
    return !!readAll()[key];
  }

  // meta: arbitrary extra fields (type, name, ...) stored alongside the key
  // for tomorrow's list/export view. Returns the new favorited state.
  function toggle(key, meta) {
    if (!key) return false;
    var all = readAll();
    if (all[key]) {
      delete all[key];
    } else {
      var entry = { addedAt: Date.now() };
      for (var k in meta) {
        if (Object.prototype.hasOwnProperty.call(meta, k)) entry[k] = meta[k];
      }
      all[key] = entry;
    }
    writeAll(all);
    return !!all[key];
  }

  // shallow copy — readAll() now hands back the live cache, so callers must
  // not be able to mutate it by accident
  function getAll() {
    var all = readAll();
    var copy = {};
    for (var k in all) {
      if (Object.prototype.hasOwnProperty.call(all, k)) copy[k] = all[k];
    }
    return copy;
  }

  global.Favorites = {
    isFavorite: isFavorite,
    toggle: toggle,
    getAll: getAll
  };
})(window);
