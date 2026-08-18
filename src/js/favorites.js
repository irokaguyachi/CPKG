/**
 * ChoKaguya Favorites Store
 * - Persists favorited series/posts in localStorage as { key: meta }
 * - Today: toggling + read-back only. Viewing the full list, exporting to a
 *   JSON file, and importing one back are follow-up work (not implemented yet).
 */
(function (global) {
  var STORAGE_KEY = 'chokaguya_favorites';

  function readAll() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function writeAll(all) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch (e) {}
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

  function getAll() {
    return readAll();
  }

  global.Favorites = {
    isFavorite: isFavorite,
    toggle: toggle,
    getAll: getAll
  };
})(window);
