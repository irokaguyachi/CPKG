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
  var DATA_VERSION = 'c71eeaf8fa1a';
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

  // 카드 썸네일(assets/image/thumb/, 600px)과 상세 모달용 중간 이미지
  // (assets/image/mid/, 1200px)는 src/scripts/6_build_thumbnails.py 가 원본과
  // 같은 폴더 구조로, 항상 .webp 로 만들어 둔다 — 변형 트리 이름만 다를 뿐
  // 경로 변환 규칙은 동일해서 한 헬퍼로 묶는다. 애니메이션 GIF 원본은 mid/
  // 트리에 일부러 없으므로(모달에서 계속 움직이게 두려고) 그런 경로는 여기서
  // 404가 나고, revealBackgroundProgressive() 가 원본으로 대체한다. 원본
  // 자체는 여전히 detail 모달의 최종 폴백으로 쓰인다.
  function resolveVariantUrl(path, variantDir) {
    if (!path) return '';
    if (/^https?:\/\//i.test(path) || path.startsWith('data:')) {
      return path;
    }
    var cleanPath = path.replace(/^(\.\.\/|\.\/|\/)+/, '');
    if (!cleanPath.startsWith('assets/')) {
      cleanPath = 'assets/' + cleanPath;
    }
    // anything under assets/image/ maps into the mirrored variant tree. Only
    // paths the builder actually saw have a file there, so callers go through
    // revealBackground()/revealBackgroundProgressive(), which fall back to the
    // original on a 404. Logos and loading icons never come through here —
    // they use resolveAssetUrl.
    var prefix = 'assets/image/';
    if (cleanPath.indexOf(prefix) !== 0) {
      return resolveAssetUrl(path);
    }
    var sub = cleanPath.slice(prefix.length).replace(/\.[^./]+$/, '.webp');
    return resolveAssetUrl(prefix + variantDir + '/' + sub);
  }

  function resolveThumbUrl(path) {
    return resolveVariantUrl(path, 'thumb');
  }

  function resolveMidUrl(path) {
    return resolveVariantUrl(path, 'mid');
  }

  // Defers setting background-image until the element actually scrolls near
  // the viewport, so off-screen cards never fire an R2 GET request at all.
  // rootMargin preloads a bit early so images are ready by the time they're
  // actually visible instead of popping in.
  var lazyObserver = null;

  // 이미지가 도착하기 전까지 자리에 잔잔한 그라데이션이 흐르게 하는 표시
  // (series-card.css 의 .is-img-loading). 배경을 칠하는 순간 떼어낸다.
  var LOADING_CLASS = 'is-img-loading';

  function paintBackground(target, url) {
    target.style.backgroundImage = 'url("' + url + '")';
    target.classList.remove(LOADING_CLASS);
  }

  // 받아지는 동안에는 로딩 표시를 유지하고, 끝나면(실패해도) 칠한다.
  function paintWhenLoaded(target, url) {
    var probe = new Image();
    probe.onload = probe.onerror = function () { paintBackground(target, url); };
    probe.src = url;
  }

  function revealBackground(target, rawPath) {
    var thumb = resolveThumbUrl(rawPath);
    var full = resolveAssetUrl(rawPath);
    target.classList.add(LOADING_CLASS);
    if (thumb === full) {
      paintWhenLoaded(target, full);
      return;
    }
    // fall back to the original if a thumbnail was never generated (e.g. a new
    // image was added to the page data without re-running 6_build_thumbnails.py)
    var probe = new Image();
    probe.onload = function () {
      paintBackground(target, thumb);
    };
    probe.onerror = function () {
      paintWhenLoaded(target, full);
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
    target.classList.add(LOADING_CLASS);
    if (thumb === full) {
      paintWhenLoaded(target, full);
      return;
    }

    // thumb/mid(또는 그 폴백인 원본)이 병렬로 요청되므로 어느 쪽이 먼저
    // 도착할지 보장이 없다 — 캐시 상태에 따라 mid가 thumb보다 먼저 뜬 뒤에
    // 늦게 도착한 thumb가 화질을 도로 떨어뜨리는 걸 막기 위해, 이미 칠한
    // 단계보다 낮은 단계는 무시한다.
    var RANK = { thumb: 1, mid: 2, full: 2 };
    var painted = 0;
    function paint(rank, url) {
      if (rank < painted) return;
      painted = rank;
      paintBackground(target, url);
    }

    var thumbProbe = new Image();
    thumbProbe.onload = function () { paint(RANK.thumb, thumb); };
    thumbProbe.src = thumb;

    var midProbe = new Image();
    midProbe.onload = function () { paint(RANK.mid, mid); };
    midProbe.onerror = function () {
      // mid 파일이 없다(애니메이션 원본이라 일부러 안 만들었거나, 아직 빌드
      // 전이거나) — 원본으로 대체한다.
      var fullProbe = new Image();
      fullProbe.onload = function () { paint(RANK.full, full); };
      fullProbe.onerror = function () {
        // 원본도 404 — 썸네일 프로브가 이미 채워놨을 수도, 아닐 수도 있는
        // 상태 그대로 두되, 로딩 표시가 끝없이 돌지 않게 떼어낸다.
        target.classList.remove(LOADING_CLASS);
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
    // 화면 근처에 오기 전(아직 요청을 보내지 않은 상태)에도 이미지가 올
    // 자리라는 걸 보여 주도록 로딩 표시를 먼저 붙인다.
    el.classList.add(LOADING_CLASS);
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
