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
  global.DATA_VERSION = DATA_VERSION;
  global.R2_CDN_BASE = R2_CDN_BASE;
  global.lazyLoadBackground = lazyLoadBackground;
  global.unobserveAllLazy = unobserveAllLazy;
})(window);
