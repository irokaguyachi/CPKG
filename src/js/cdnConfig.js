/**
 * ChoKaguya CDN Asset Resolver
 * - Maps local asset paths (../assets/...) to Cloudflare R2 Public CDN
 * - Handles Korean directory/file name URL encoding automatically
 */
(function (global) {
  var R2_CDN_BASE = 'https://pub-908f4390549649fbbdff99353f22c6d4.r2.dev';

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

  // Defers setting background-image until the element actually scrolls near
  // the viewport, so off-screen cards never fire an R2 GET request at all.
  // rootMargin preloads a bit early so images are ready by the time they're
  // actually visible instead of popping in.
  var lazyObserver = null;
  function lazyLoadBackground(el, rawPath) {
    if (!el || !rawPath) return;
    if (!('IntersectionObserver' in global)) {
      el.style.backgroundImage = 'url("' + resolveAssetUrl(rawPath) + '")';
      return;
    }
    if (!lazyObserver) {
      lazyObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var target = entry.target;
          lazyObserver.unobserve(target);
          target.style.backgroundImage = 'url("' + target.dataset.lazyBg + '")';
          delete target.dataset.lazyBg;
        });
      }, { rootMargin: '300px 0px' });
    }
    el.dataset.lazyBg = resolveAssetUrl(rawPath);
    lazyObserver.observe(el);
  }

  global.resolveAssetUrl = resolveAssetUrl;
  global.R2_CDN_BASE = R2_CDN_BASE;
  global.lazyLoadBackground = lazyLoadBackground;
})(window);
