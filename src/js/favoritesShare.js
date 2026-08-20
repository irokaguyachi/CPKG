/**
 * ChoKaguya Favorites Share
 * - Exports the local favorites store to a downloadable JSON file (공유하기),
 *   and decodes a shared file back into plain bucket data (불러오기).
 * - Loading a shared file never touches localStorage/Favorites — it's meant
 *   for viewing someone else's favorites, not merging into your own.
 * - No page wires this up yet; call FavoritesShare.exportFile() /
 *   FavoritesShare.readSharedFile(file) directly (e.g. from devtools) until
 *   a favorites list/viewer page exists to host the buttons.
 */
(function (global) {
  function exportPayload() {
    if (!global.Favorites || !global.FavoritesCodec) return null;
    var all = global.Favorites.getAll();
    var codec = global.FavoritesCodec;
    return {
      v: 1,
      novel: codec.encodeFavorites(all.novel),
      series: codec.encodeFavorites(all.series),
      hof: codec.encodeFavorites(all.hof),
      official: codec.encodeFavorites(all.official)
    };
  }

  function exportFile() {
    var payload = exportPayload();
    if (!payload) return;
    var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'chokaguya-favorites.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function decodePayload(payload) {
    var codec = global.FavoritesCodec;
    return {
      novel: codec.decodeFavorites(payload.novel || ''),
      series: codec.decodeFavorites(payload.series || ''),
      hof: codec.decodeFavorites(payload.hof || ''),
      official: codec.decodeFavorites(payload.official || '')
    };
  }

  // Resolves with { novel, series, hof, official } decoded from the file —
  // a snapshot to display, not something written back into Favorites.
  function readSharedFile(file) {
    return new Promise(function (resolve, reject) {
      if (!file) { reject(new Error('no file given')); return; }
      if (!global.FavoritesCodec) { reject(new Error('FavoritesCodec not loaded')); return; }
      var reader = new FileReader();
      reader.onload = function () {
        try {
          resolve(decodePayload(JSON.parse(reader.result)));
        } catch (e) {
          reject(e);
        }
      };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsText(file);
    });
  }

  global.FavoritesShare = {
    exportPayload: exportPayload,
    exportFile: exportFile,
    readSharedFile: readSharedFile
  };
})(window);
