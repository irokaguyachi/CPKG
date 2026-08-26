/**
 * ChoKaguya CDN Asset Resolver
 * - Maps local asset paths (../assets/...) to Cloudflare R2 Public CDN
 * - Handles Korean directory/file name URL encoding automatically
 */
(function (global) {
  var R2_CDN_BASE = 'https://pub-908f4390549649fbbdff99353f22c6d4.r2.dev';

  // Local JSON used to be fetched with { cache: 'no-store' }, which defeated
  // the browser cache entirely and re-downloaded every data file on every
  // navigation. Cache normally instead and bust it explicitly by bumping this
  // when the data under src/data/ changes.
  var DATA_VERSION = '20260824';
  function dataUrl(path) {
    if (!path) return path;
    return path + (path.indexOf('?') === -1 ? '?' : '&') + 'v=' + DATA_VERSION;
  }

  // loading.js(전체 화면 로더 아이콘)와 gridPage.js(미니 로딩 스피너)가
  // 같은 LoadingIcons.json을 각자 fetch하고 있었다 — 페이지당 왕복 하나가
  // 그냥 중복이었다. 같은 URL을 요청한 첫 호출의 프라미스를 그대로
  // 돌려줘서 두 번째 호출부터는 새 네트워크 요청을 만들지 않는다.
  var jsonCache = {};
  function fetchJsonCached(path) {
    var url = dataUrl(path);
    if (!jsonCache[url]) {
      jsonCache[url] = fetch(url).then(function (r) { return r.json(); });
    }
    return jsonCache[url];
  }

  function resolveAssetUrl(path) {
    if (!path) return '';
    if (/^https?:\/\//i.test(path) || path.startsWith('data:')) {
      return path;
    }
    // Normalize relative path prefixes (../, ./)
    var cleanPath = path.replace(/^(\.\.\/|\.\/|\/)+/, '');
    if (!cleanPath.startsWith('assets/')) {
      cleanPath = 'assets/' + cleanPath;
    }
    // Encode segments (handling Korean characters safely)
    var segments = cleanPath.split('/').map(function (seg) {
      return encodeURIComponent(seg);
    });
    return R2_CDN_BASE + '/' + segments.join('/');
  }

  // Card thumbnails live in a parallel assets/Image/thumb/ tree built by
  // src/scripts/6_build_thumbnails.py — same folder structure, always .webp,
  // 600px wide. Originals stay untouched and are still used by the detail
  // modal, which wants full resolution.
  function resolveThumbUrl(path) {
    if (!path) return '';
    if (/^https?:\/\//i.test(path) || path.startsWith('data:')) {
      return path;
    }
    var cleanPath = path.replace(/^(\.\.\/|\.\/|\/)+/, '');
    if (!cleanPath.startsWith('assets/')) {
      cleanPath = 'assets/' + cleanPath;
    }
    // anything under assets/Image/ maps into the mirrored thumb/ tree. Only
    // paths the builder actually saw have a file there, so callers go through
    // revealBackground(), which falls back to the original on a 404. Logos and
    // loading icons never come through here — they use resolveAssetUrl.
    var prefix = 'assets/Image/';
    if (cleanPath.indexOf(prefix) !== 0) {
      return resolveAssetUrl(path);
    }
    var sub = cleanPath.slice(prefix.length).replace(/\.[^./]+$/, '.webp');
    return resolveAssetUrl(prefix + 'thumb/' + sub);
  }

  // Defers setting background-image until the element actually scrolls near
  // the viewport, so off-screen cards never fire an R2 GET request at all.
  // rootMargin preloads a bit early so images are ready by the time they're
  // actually visible instead of popping in.
  var lazyObserver = null;
  function revealBackground(target, rawPath) {
    var thumb = resolveThumbUrl(rawPath);
    var full = resolveAssetUrl(rawPath);
    if (thumb === full) {
      target.style.backgroundImage = 'url("' + full + '")';
      return;
    }
    // fall back to the original if a thumbnail was never generated (e.g. a new
    // image was added to the page data without re-running 6_build_thumbnails.py)
    var probe = new Image();
    probe.onload = function () {
      target.style.backgroundImage = 'url("' + thumb + '")';
    };
    probe.onerror = function () {
      target.style.backgroundImage = 'url("' + full + '")';
    };
    probe.src = thumb;
  }

  // Like revealBackground(), but for callers that need the full-resolution
  // original as the final image (e.g. the detail modal, which shows it at a
  // large scale) rather than settling for the thumbnail. Originals average
  // 755KB and run up to 17MB, so waiting for one before showing anything
  // makes the modal feel frozen. Both requests start immediately in
  // parallel; the (much smaller) thumbnail almost always paints first, then
  // gets replaced the moment the original finishes loading. Final image is
  // always the original — this only changes how long the wait feels.
  function revealBackgroundProgressive(target, rawPath) {
    var thumb = resolveThumbUrl(rawPath);
    var full = resolveAssetUrl(rawPath);
    if (thumb === full) {
      target.style.backgroundImage = 'url("' + full + '")';
      return;
    }
    var thumbProbe = new Image();
    thumbProbe.onload = function () {
      target.style.backgroundImage = 'url("' + thumb + '")';
    };
    thumbProbe.src = thumb;

    var fullProbe = new Image();
    fullProbe.onload = function () {
      target.style.backgroundImage = 'url("' + full + '")';
    };
    fullProbe.onerror = function () {
      // original 404s — keep whatever the thumbnail probe already set
      // (or nothing, if that hasn't resolved yet either)
    };
    fullProbe.src = full;
  }

  function lazyLoadBackground(el, rawPath) {
    if (!el || !rawPath) return;
    if (!('IntersectionObserver' in global)) {
      revealBackground(el, rawPath);
      return;
    }
    if (!lazyObserver) {
      lazyObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var target = entry.target;
          lazyObserver.unobserve(target);
          revealBackground(target, target.dataset.lazyBg);
          delete target.dataset.lazyBg;
        });
      }, { rootMargin: '300px 0px' });
    }
    el.dataset.lazyBg = rawPath;
    lazyObserver.observe(el);
  }

  // Re-rendering a grid drops every card, but the observer only unobserves
  // elements that actually became visible — the rest stay observed as detached
  // nodes and get re-checked on every scroll. Callers clear the whole batch
  // before wiping their container.
  function unobserveAllLazy() {
    if (lazyObserver) {
      lazyObserver.disconnect();
      lazyObserver = null;
    }
  }

  global.resolveAssetUrl = resolveAssetUrl;
  global.resolveThumbUrl = resolveThumbUrl;
  global.dataUrl = dataUrl;
  global.fetchJsonCached = fetchJsonCached;
  global.DATA_VERSION = DATA_VERSION;
  global.R2_CDN_BASE = R2_CDN_BASE;
  global.lazyLoadBackground = lazyLoadBackground;
  global.revealBackgroundProgressive = revealBackgroundProgressive;
  global.unobserveAllLazy = unobserveAllLazy;
})(window);
