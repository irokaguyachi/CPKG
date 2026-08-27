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
  //
  // 이 값은 손으로 고치지 마세요 — src/scripts/10_update_data_version.py가
  // src/data/ 아래 실제로 fetch되는 .json 파일들의 내용을 해시해서 자동으로
  // 채워 넣습니다. 데이터 빌드 스크립트를 돌린 뒤 마지막에 이 스크립트를
  // 실행하세요: python src/scripts/10_update_data_version.py
  var DATA_VERSION = 'b41bdaa6ae21';
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

  // 상세 모달용 1200px WebP 중간 이미지 — src/scripts/6_build_thumbnails.py 가
  // thumb/ 와 같은 규칙으로 assets/Image/mid/ 아래에 만든다. 애니메이션 GIF
  // 원본은 일부러 이 트리에 없다(모달에서 계속 움직이게 두려고) — 그런
  // 경로는 여기서도 404가 나므로, revealBackgroundProgressive() 가 원본으로
  // 대체한다.
  function resolveMidUrl(path) {
    if (!path) return '';
    if (/^https?:\/\//i.test(path) || path.startsWith('data:')) {
      return path;
    }
    var cleanPath = path.replace(/^(\.\.\/|\.\/|\/)+/, '');
    if (!cleanPath.startsWith('assets/')) {
      cleanPath = 'assets/' + cleanPath;
    }
    var prefix = 'assets/Image/';
    if (cleanPath.indexOf(prefix) !== 0) {
      return resolveAssetUrl(path);
    }
    var sub = cleanPath.slice(prefix.length).replace(/\.[^./]+$/, '.webp');
    return resolveAssetUrl(prefix + 'mid/' + sub);
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

  // Like revealBackground(), but for callers that show the image at a large
  // scale (e.g. the detail modal) rather than settling for the card
  // thumbnail. Originals average 755KB and run up to 17MB, so waiting for
  // one before showing anything makes the modal feel frozen — and showing
  // the full original at all was mostly wasted resolution for how large the
  // modal actually renders it. Both requests start immediately in parallel;
  // the (much smaller) thumbnail almost always paints first, then gets
  // replaced once the 1200px "mid" image finishes loading. Animated GIF
  // sources have no mid file on purpose (see resolveMidUrl) — that 404 falls
  // back to the true original so those keep animating like before.
  function revealBackgroundProgressive(target, rawPath) {
    var thumb = resolveThumbUrl(rawPath);
    var mid = resolveMidUrl(rawPath);
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

    var midProbe = new Image();
    midProbe.onload = function () {
      target.style.backgroundImage = 'url("' + mid + '")';
    };
    midProbe.onerror = function () {
      // mid 파일이 없다(애니메이션 원본이라 일부러 안 만들었거나, 아직 빌드
      // 전이거나) — 원본으로 대체한다.
      var fullProbe = new Image();
      fullProbe.onload = function () {
        target.style.backgroundImage = 'url("' + full + '")';
      };
      fullProbe.onerror = function () {
        // 원본도 404 — 썸네일 프로브가 이미 채워놨을 수도, 아닐 수도 있는
        // 상태 그대로 둔다.
      };
      fullProbe.src = full;
    };
    midProbe.src = mid;
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
  global.resolveMidUrl = resolveMidUrl;
  global.dataUrl = dataUrl;
  global.fetchJsonCached = fetchJsonCached;
  global.DATA_VERSION = DATA_VERSION;
  global.R2_CDN_BASE = R2_CDN_BASE;
  global.lazyLoadBackground = lazyLoadBackground;
  global.revealBackgroundProgressive = revealBackgroundProgressive;
  global.unobserveAllLazy = unobserveAllLazy;
})(window);
