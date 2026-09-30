// 문학·번역 통합 페이지 — 목록 구현은 gridPage.js 의 공통 팩토리에 있고,
// 이 파일은 [문학 | 번역] 탭 전환과 번역 탭의 주의 게이트만 맡는다.
//
// [데이터]
//   · 문학: Novel.json — 시리즈에 속하지 않은 단독 게시물만 담는다
//     (생성: src/scripts/7_build_novel_page_data.py).
//   · 번역: Translation.json — src/scripts/14_build_translation_page_data.py 가
//     '번역 정리/크롤링 파일/*.md' 를 파싱해 만든다. 크롤링 원본과 번역 사진은
//     .gitignore 대상이라 이 JSON 자체가 커밋되는 유일한 산출물이다.
//
// [주소] /novel 은 문학 탭, /novel?tab=translation 은 번역 탭으로 열린다.
//   예전 /translation 주소는 _worker.js 가 /novel?tab=translation 으로 보낸다.
//   favType 'translation' 은 그대로라 기존 북마크·끌올 데이터와 호환된다.
//
// [태그 정책] 번역 탭은 공식(AI) 태그를 지원하지 않고 유저 투표 태그만
// 사용한다. userTagsOnly 플래그가 gridPage.js 에서 공식/유저 토글을 숨기고
// 태그 풀을 처음부터 유저 태그로 고정한다.
(function (global) {
  var t = global.I18n.t;
  var body = document.body;
  var TAB_PARAM = 'tab';
  var DEFAULT_SOURCE = 'novel';

  var SOURCES = {
    novel: {
      dataUrl: '../data/pageData/Novel.json',
      favType: 'novel',
      userTags: true,
      searchPlaceholder: t('문학 제목으로 검색'),
      pageTitle: t('초카공 문학&번역 • 문학'),
      countText: function (n) { return t('{n}개의 문학이 있습니다!', { n: n }); },
      emptyText: t('조건에 맞는 문학이 없어요.')
    },
    translation: {
      dataUrl: '../data/pageData/Translation.json',
      favType: 'translation',
      userTagsOnly: true,
      searchPlaceholder: t('번역 제목으로 검색'),
      pageTitle: t('초카공 문학&번역 • 번역'),
      countText: function (n) { return t('{n}개의 번역이 있습니다!', { n: n }); },
      emptyText: t('조건에 맞는 번역이 없어요.')
    }
  };

  function readSourceFromUrl() {
    var key = null;
    try { key = new URLSearchParams(global.location.search).get(TAB_PARAM); } catch (e) {}
    return Object.prototype.hasOwnProperty.call(SOURCES, key) ? key : DEFAULT_SOURCE;
  }

  function writeSourceToUrl(key) {
    if (!global.history || !global.history.replaceState) return;
    var url = new URL(global.location.href);
    if (key === DEFAULT_SOURCE) url.searchParams.delete(TAB_PARAM);
    else url.searchParams.set(TAB_PARAM, key);
    global.history.replaceState(global.history.state, '', url.pathname + url.search + url.hash);
  }

  // ── 번역 탭 주의 게이트 ──────────────────────────────────────────────
  // 민감한 번역 목록은 첫 화면에서 경고문 아래(검색·카드·푸터)를 흐리게
  // 보여주고, 사용자가 실제로 아래로 스크롤하면 한 번에 공개한다. 탭 버튼과
  // 경고문은 게이트 밖이라 흐린 상태에서도 문학 탭으로 돌아갈 수 있다.
  var warningEl = document.querySelector('.translation-warning');
  var GATE_SCROLL_PX = 16;

  function revealContent() {
    body.classList.remove('is-content-gated');
    global.removeEventListener('scroll', revealOnScroll);
  }

  function revealOnScroll() {
    if (global.scrollY > GATE_SCROLL_PX) revealContent();
  }

  function applyGate(key) {
    var isTranslation = key === 'translation';
    if (warningEl) warningEl.hidden = !isTranslation;
    global.removeEventListener('scroll', revealOnScroll);
    // 뒤로 가기 등으로 이미 내려간 위치에서 열린 경우에는 즉시 공개한다.
    if (!isTranslation || global.scrollY > GATE_SCROLL_PX) {
      body.classList.remove('is-content-gated');
      return;
    }
    body.classList.add('is-content-gated');
    global.addEventListener('scroll', revealOnScroll, { passive: true });
  }

  // ── 탭 버튼 ──────────────────────────────────────────────────────────
  var tabButtons = Array.prototype.slice.call(document.querySelectorAll('.library-tab[data-source]'));

  function paintTabs(key) {
    tabButtons.forEach(function (btn) {
      var active = btn.getAttribute('data-source') === key;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      btn.tabIndex = active ? 0 : -1;
    });
    var tabsEl = document.querySelector('.library-tabs');
    if (tabsEl) tabsEl.setAttribute('data-active', key);
  }

  var initialSource = readSourceFromUrl();
  var grid = global.GridPage.create({ sources: SOURCES, initialSource: initialSource });

  function showSource(key) {
    paintTabs(key);
    applyGate(key);
    document.title = SOURCES[key].pageTitle;
    var input = document.getElementById('series-search-input');
    if (input) input.placeholder = SOURCES[key].searchPlaceholder;
  }

  function selectSource(key) {
    if (!grid || !SOURCES[key] || grid.getSource() === key) return;
    grid.setSource(key);
    writeSourceToUrl(key);
    showSource(key);
  }

  tabButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      selectSource(btn.getAttribute('data-source'));
    });
    // 좌우 화살표로 탭 사이를 옮긴다(WAI-ARIA tablist 관례).
    btn.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      var idx = tabButtons.indexOf(btn);
      var next = tabButtons[(idx + (e.key === 'ArrowRight' ? 1 : tabButtons.length - 1)) % tabButtons.length];
      next.focus();
      selectSource(next.getAttribute('data-source'));
    });
  });

  showSource(initialSource);
})(window);
