/**
 * ChoKaguya Favorites Share (Remote / R2-backed)
 * - createShareLink(): POSTs the current localStorage favorites (encoded via
 *   favoritesCodec.js) to the favoritesShareWorker (see worker/), which
 *   stores them in R2 and returns a code.
 * - fetchShared(code): GETs a previously shared payload back and decodes it.
 *   Both go through the Worker rather than the public pub-*.r2.dev URL
 *   directly — that bucket serves GETs with no CORS header, which is fine
 *   for <img>/background-image but blocks a cross-origin fetch() from
 *   reading the JSON body in JS. See worker/favoritesShareWorker.js.
 */
(function (global) {
  var WORKER_URL = 'https://chokaguya-favorites-share.nwb10102.workers.dev/share';

  function createShareLink() {
    if (!global.Favorites || !global.FavoritesCodec) {
      return Promise.reject(new Error('Favorites/FavoritesCodec not loaded'));
    }
    if (!WORKER_URL) {
      return Promise.reject(new Error('공유 기능이 아직 준비되지 않았어요 (Worker 미배포)'));
    }

    var all = global.Favorites.getAll();
    var codec = global.FavoritesCodec;
    var payload = {
      v: 1,
      novel: codec.encodeFavorites(all.novel),
      series: codec.encodeFavorites(all.series),
      hof: codec.encodeFavorites(all.hof),
      official: codec.encodeFavorites(all.official)
    };

    return fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        if (!res.ok) throw new Error('공유 링크 생성에 실패했어요 (' + res.status + ')');
        return res.json();
      })
      .then(function (data) {
        var pageUrl = global.location.origin + global.location.pathname.replace(/[^/]*$/, '') + 'sharedFavoritesPage.html?share=' + data.code;
        return { code: data.code, dataUrl: data.url, pageUrl: pageUrl };
      });
  }

  // Resolves with { novel, series, hof, official } as decoded ID arrays.
  function fetchShared(code) {
    if (!code) return Promise.reject(new Error('공유 코드가 없어요'));
    if (!global.FavoritesCodec) return Promise.reject(new Error('FavoritesCodec not loaded'));

    return fetch(WORKER_URL + '/' + encodeURIComponent(code))
      .then(function (res) {
        if (res.status === 404) throw new Error('존재하지 않거나 만료된 공유 링크예요.');
        if (!res.ok) throw new Error('공유 데이터를 불러오지 못했어요 (' + res.status + ')');
        return res.json();
      })
      .then(function (payload) {
        var codec = global.FavoritesCodec;
        return {
          novel: codec.decodeFavorites(payload.novel || ''),
          series: codec.decodeFavorites(payload.series || ''),
          hof: codec.decodeFavorites(payload.hof || ''),
          official: codec.decodeFavorites(payload.official || '')
        };
      });
  }

  global.FavoritesShareRemote = { createShareLink: createShareLink, fetchShared: fetchShared };
})(window);
