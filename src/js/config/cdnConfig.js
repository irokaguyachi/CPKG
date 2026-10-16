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
  var DATA_VERSION = 'fad6ca5b4a0c';
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
      jsonCache[url] = withOfficialTags(path, fetch(url).then(function (r) { return r.json(); }));
    }
    return jsonCache[url];
  }

  // 캐시 없이 새로 받되 공식 태그 덮어쓰기는 똑같이 적용한다 — 받은 배열을
  // 각자 고쳐 쓰는 화면(gridPage.js, 룰렛·슬롯 모달 등)이 서로의 변경을 공유하지
  // 않도록 fetchJsonCached 와 나눠 둔다.
  function fetchPageData(path) {
    return withOfficialTags(path, fetch(dataUrl(path)).then(function (r) { return r.json(); }));
  }

  // ---- 공식 태그 덮어쓰기 ----
  // 관리 페이지(공식 태그 탭, worker/adminOfficialTags.js)에서 고친 작품별 공식
  // 태그를 GET /tags/official 로 페이지당 한 번만 받아, pageData JSON 을 읽을 때
  // 그 작품의 tags 를 통째로 교체한다(태그보정.md 와 같은 "교체" 의미, 빈 배열은
  // 태그 전부 제거). 작품 = 종류 + 첫 게시물 ID. 정적 데이터를 다시 빌드해도 이
  // 덮어쓰기가 그 위에 적용되므로 수정이 사라지지 않는다. 받기에 실패하면 원래
  // 데이터를 그대로 쓴다 — 태그 때문에 페이지가 막히면 안 된다.
  var OFFICIAL_TAGS_URL = '/tags/official';
  var PAGE_DATA_TYPES = {
    'Novel.json': 'novel',
    'Translation.json': 'translation',
    'Series.json': 'series',
    'HOF.json': 'hof',
    'Official.json': 'official'
  };
  var officialTagsPromise = null;

  // 관리 페이지의 태그 정의(worker/adminTagDefs.js)도 같은 파일(v2)에 실려 온다:
  // tags = 이모지·색·순서·투표 허용 정의(없으면 null), renames = { 옛 이름: 새 이름 }.
  // 받은 정의는 화면을 그리기 전에 TagConfig.applyDefinitions 로 한 번 넘긴다.
  // tagConfig.js 가 아직 실행 전이면 window.__tagDefinitions 에 두고 가져가게 한다.
  function officialTagOverrides() {
    if (!officialTagsPromise) {
      officialTagsPromise = fetch(OFFICIAL_TAGS_URL)
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          var result = {
            items: (data && data.items && typeof data.items === 'object') ? data.items : {},
            tags: (data && Array.isArray(data.tags)) ? data.tags : null,
            renames: (data && data.renames && typeof data.renames === 'object') ? data.renames : {}
          };
          if (result.tags || Object.keys(result.renames).length) {
            var defs = { tags: result.tags, renames: result.renames };
            if (global.TagConfig && global.TagConfig.applyDefinitions) global.TagConfig.applyDefinitions(defs);
            else global.__tagDefinitions = defs;
          }
          return result;
        })
        .catch(function () { return { items: {}, tags: null, renames: {} }; });
    }
    return officialTagsPromise;
  }

  function pageDataName(path) {
    var m = /pageData\/([A-Za-z]+\.json)/.exec(path || '');
    if (!m) return null;
    var name = m[1];
    return (PAGE_DATA_TYPES[name] || name === 'Lookup.json' || name === 'Recent.json' ||
      name === 'UserTagCatalog.json') ? name : null;
  }

  // 이름 바꾸기(renames)는 덮어쓰기 뒤에 적용하고, 바꾼 결과가 겹치면 하나만 남긴다.
  function renameTags(tags, renames) {
    var out = [];
    tags.forEach(function (tag) {
      var next = Object.prototype.hasOwnProperty.call(renames, tag) ? renames[tag] : tag;
      if (out.indexOf(next) === -1) out.push(next);
    });
    return out;
  }

  function overrideEntry(entry, type, items, renames, fallbackId) {
    if (!entry) return;
    var id = entry.posts && entry.posts[0] && entry.posts[0].id;
    var tags = items[type + ':' + (id != null ? id : fallbackId)];
    if (Array.isArray(tags)) entry.tags = tags.slice();
    if (renames && Array.isArray(entry.tags)) entry.tags = renameTags(entry.tags, renames);
  }

  // data 를 제자리에서 고쳐 돌려준다. 파일 형식은 세 가지다 — 작품 배열(Novel 등),
  // { 종류: { id: 작품 } }(Lookup), { novels: [...] }(Recent). defs 는 { tags, renames }
  // (선택)로, 태그 정의가 있으면 투표 후보 목록(UserTagCatalog.json)도 바꿔 돌려준다.
  function applyOfficialTagOverrides(path, data, items, defs) {
    var name = pageDataName(path);
    if (!name || !data || !items) return data;
    var renames = (defs && defs.renames && Object.keys(defs.renames).length) ? defs.renames : null;
    if (name === 'UserTagCatalog.json') {
      if (!defs || !Array.isArray(defs.tags)) return data;
      return defs.tags.filter(function (t) { return t && t.votable; }).map(function (t) { return t.name; });
    }
    if (name === 'Lookup.json') {
      Object.keys(data).forEach(function (type) {
        var group = data[type] || {};
        Object.keys(group).forEach(function (key) { overrideEntry(group[key], type, items, renames, key); });
      });
    } else if (name === 'Recent.json') {
      (Array.isArray(data.novels) ? data.novels : []).forEach(function (e) { overrideEntry(e, 'novel', items, renames); });
    } else if (Array.isArray(data)) {
      data.forEach(function (e) { overrideEntry(e, PAGE_DATA_TYPES[name], items, renames); });
    }
    return data;
  }

  function withOfficialTags(path, dataPromise) {
    if (!pageDataName(path)) return dataPromise;
    return Promise.all([dataPromise, officialTagOverrides()]).then(function (r) {
      return applyOfficialTagOverrides(path, r[0], r[1].items, r[1]);
    });
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

  // 로딩 표시를 떼는 순간 이미지가 뿅 하고 튀어나오지 않게, 같은 그라데이션을
  // 한 겹(.img-reveal-veil) 덮어 두고 그 겹을 서서히 걷어 낸다. 배경 자체는
  // 투명도를 줄 수 없고, 자리 전체를 흐리게 하면 안에 든 북마크 버튼까지
  // 함께 깜빡이기 때문이다. 겹은 자리의 배경 바로 위, 자식들 아래에 깔린다
  // (series-card.css 의 .is-img-revealing 참고).
  var REVEAL_CLASS = 'is-img-revealing';
  var VEIL_CLASS = 'img-reveal-veil';
  var reduceMotion = global.matchMedia
    ? global.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

  function coverWithVeil(target) {
    if (reduceMotion && reduceMotion.matches) return;
    var veil = document.createElement('span');
    veil.className = VEIL_CLASS;
    veil.setAttribute('aria-hidden', 'true');
    // 아래에서 흐르던 그라데이션과 같은 지점에서 이어 흐르도록 진행 시점을 맞춘다.
    var drift = 0;
    if (target.getAnimations) {
      target.getAnimations().forEach(function (a) {
        if (a.animationName === 'img-loading-drift') drift = Number(a.currentTime) || 0;
      });
    }
    veil.style.animationDelay = (-drift) + 'ms, 0ms';
    target.classList.add(REVEAL_CLASS);
    target.insertBefore(veil, target.firstChild);

    var done = false;
    function finish() {
      if (done) return;
      done = true;
      if (veil.parentNode) veil.parentNode.removeChild(veil);
      target.classList.remove(REVEAL_CLASS);
    }
    veil.addEventListener('animationend', function (e) {
      if (e.animationName === 'img-reveal-fade') finish();
    });
    // 탭이 백그라운드라 animationend 가 오지 않아도 겹이 남지 않게 한다.
    setTimeout(finish, 1500);
  }

  function paintBackground(target, url) {
    // 이미 이미지가 칠해진 자리(썸네일 → 중간 이미지 교체)는 겹 없이 바로 바꾼다.
    if (target.classList.contains(LOADING_CLASS)) coverWithVeil(target);
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
  global.fetchPageData = fetchPageData;
  global.applyOfficialTagOverrides = applyOfficialTagOverrides;
  global.DATA_VERSION = DATA_VERSION;
  global.R2_CDN_BASE = R2_CDN_BASE;
  global.lazyLoadBackground = lazyLoadBackground;
  global.revealBackgroundProgressive = revealBackgroundProgressive;
  global.unobserveAllLazy = unobserveAllLazy;
})(window);
