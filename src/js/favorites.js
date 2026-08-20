/**
 * ChoKaguya Favorites Store
 * - Persists favorited items in localStorage, split into buckets by tab:
 *   { novel: [id, ...], series: [id, ...], hof: [id, ...], official: [id, ...] }
 * - Each bucket holds only representative post IDs (no name/timestamp) to
 *   keep the stored JSON small. A future favorites list view resolves IDs
 *   back to titles/images by looking them up in the page data.
 */
(function (global) {
  var STORAGE_KEY = 'chokaguya_favorites';
  var TYPES = ['novel', 'series', 'hof', 'official'];

  function emptyStore() {
    return { novel: [], series: [], hof: [], official: [] };
  }

  // localStorage reads are synchronous and block the main thread, and
  // isFavorite() runs once per card — re-parsing the whole store 50 times per
  // keystroke made typing in the search box stutter. Parse once, keep it in
  // memory, and only touch localStorage on write.
  var cache = null;

  function isValidStore(store) {
    if (!store || typeof store !== 'object') return false;
    for (var i = 0; i < TYPES.length; i++) {
      if (!Array.isArray(store[TYPES[i]])) return false;
    }
    return true;
  }

  function loadFromStorage() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyStore();
      var parsed = JSON.parse(raw);
      // pre-bucket (or otherwise malformed) data from an earlier version of
      // this store isn't migratable one-to-one, so it's just reset here
      return isValidStore(parsed) ? parsed : emptyStore();
    } catch (e) {
      return emptyStore();
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

  function isFavorite(type, id) {
    if (!type || id == null || TYPES.indexOf(type) === -1) return false;
    return readAll()[type].indexOf(id) !== -1;
  }

  // Returns the new favorited state.
  function toggle(type, id) {
    if (!type || id == null || TYPES.indexOf(type) === -1) return false;
    var all = readAll();
    var bucket = all[type];
    var idx = bucket.indexOf(id);
    if (idx !== -1) {
      bucket.splice(idx, 1);
    } else {
      bucket.push(id);
    }
    writeAll(all);
    return idx === -1;
  }

  // shallow copy — readAll() now hands back the live cache, so callers must
  // not be able to mutate it by accident
  function getAll() {
    var all = readAll();
    var copy = {};
    for (var i = 0; i < TYPES.length; i++) copy[TYPES[i]] = all[TYPES[i]].slice();
    return copy;
  }

  function getBucket(type) {
    if (TYPES.indexOf(type) === -1) return [];
    return readAll()[type].slice();
  }

  global.Favorites = {
    isFavorite: isFavorite,
    toggle: toggle,
    getAll: getAll,
    getBucket: getBucket
  };
})(window);
