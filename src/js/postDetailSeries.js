(function (global) {
  var ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 4L20 20M20 4L4 20" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/></svg>';

  var overlayEl = null;
  var openCard = null;

  // 오버레이가 뷰포트를 덮고 있어도 그 위에서 휠을 굴리면 배경 페이지가
  // 대신 스크롤됐다 — 오버레이 자체는 스크롤 대상이 아니라서 브라우저가
  // 스크롤 가능한 가장 가까운 조상인 html/body로 스크롤을 넘겼기 때문.
  // loading.js 의 lockScroll/unlockScroll 과 동일한 패턴.
  function lockScroll() {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }
  function unlockScroll() {
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }

  // The card is sized in vw (80.8333 x 55.4167) and then transform-scaled, so
  // on a short/wide window its scaled height can exceed the viewport. The
  // overlay centres it and cannot scroll, so the excess was simply cut off the
  // top and bottom with no way to reach it. Shrink the scale just enough to
  // fit; on normal windows this stays at the designed 0.62.
  var BASE_SCALE = 0.62;
  var DESIGN_W_VW = 80.8333;
  var DESIGN_H_VW = 55.4167;

  function applyFitScale(card) {
    if (!card) return;
    if (window.innerWidth <= 1080) {
      card.style.removeProperty('--pds-scale');
      return;
    }
    var unit = window.innerWidth / 100;
    var scale = Math.min(
      BASE_SCALE,
      (window.innerWidth * 0.96) / (DESIGN_W_VW * unit),
      (window.innerHeight * 0.92) / (DESIGN_H_VW * unit)
    );
    card.style.setProperty('--pds-scale', scale);
  }

  window.addEventListener('resize', function () {
    if (openCard) applyFitScale(openCard);
  });


  function ensureOverlay() {
    if (overlayEl) return overlayEl;
    overlayEl = document.createElement('div');
    overlayEl.className = 'pds-overlay';
    overlayEl.addEventListener('click', function (e) {
      if (e.target === overlayEl) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
    document.body.appendChild(overlayEl);
    return overlayEl;
  }

  // data: { seriesName, views, likes, imageUrl, episodes: [{ title, id, link, episodeLabel }] }
  // 화수는 따로 받지 않고 episodes 길이로 계산합니다 (시리즈 판별 기준과 동일).
  function open(data) {
    data = data || {};
    var overlay = ensureOverlay();
    overlay.innerHTML = '';

    var card = document.createElement('div');
    card.className = 'post-detail-series';

    var handle = document.createElement('div');
    handle.className = 'pds-sheet-handle';
    card.appendChild(handle);

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'pds-close';
    closeBtn.setAttribute('aria-label', '닫기');
    closeBtn.innerHTML = ICON_CLOSE;
    closeBtn.addEventListener('click', close);
    card.appendChild(closeBtn);

    var image = document.createElement('div');
    image.className = 'pds-image';
    if (data.imageUrl) {
      // 예전엔 원본(평균 755KB, 최대 17MB)을 그대로 받아 모달이 뜨는 동안
      // 멈춘 것처럼 보였다. 썸네일을 먼저 배경으로 깔고, 이 모달 크기에는
      // 충분한 1200px 중간 이미지가 도착하면 그걸로 교체한다(애니메이션
      // GIF만 예외로 원본 그대로 유지 — resolveMidUrl 참고).
      if (window.revealBackgroundProgressive) {
        window.revealBackgroundProgressive(image, data.imageUrl);
      } else {
        var finalImg = window.resolveAssetUrl ? window.resolveAssetUrl(data.imageUrl) : data.imageUrl;
        image.style.backgroundImage = 'url("' + finalImg + '")';
      }
    }

    var imageEffect = document.createElement('div');
    imageEffect.className = 'pds-image-effect';
    image.appendChild(imageEffect);
    card.appendChild(image);

    var gradient = document.createElement('div');
    gradient.className = 'pds-gradient';
    card.appendChild(gradient);

    var seriesInfo = document.createElement('div');
    seriesInfo.className = 'pds-series-info';

    var name = document.createElement('p');
    name.className = 'pds-series-name';
    name.textContent = data.seriesName || '시리즈 이름';
    var episodeCountEl = document.createElement('span');
    episodeCountEl.className = 'pds-series-episode-count';
    episodeCountEl.textContent = (data.episodes || []).length + ' 화';
    name.appendChild(episodeCountEl);
    seriesInfo.appendChild(name);

    card.appendChild(seriesInfo);

    // Right side container holding toolbar & episode list
    var rightPanel = document.createElement('div');
    rightPanel.className = 'pds-right-panel';

    var episodes = (data.episodes || []).map(function (ep, idx) {
      ep._idx = idx;
      return ep;
    });

    var currentSortOrder = 'asc'; // 'asc' = 1화부터, 'desc' = 최신화부터

    var toolbar = document.createElement('div');
    toolbar.className = 'pds-toolbar';

    var sortBtn = document.createElement('button');
    sortBtn.type = 'button';
    sortBtn.className = 'pds-sort-btn';
    sortBtn.setAttribute('aria-label', '화 정렬 순서 변경');

    function updateSortButtonUI() {
      if (currentSortOrder === 'asc') {
        sortBtn.innerHTML = '<svg class="pds-sort-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4.5h6M2.5 8h4M2.5 11.5h2"/><path d="M10.5 11.5l2.5-3 2.5 3"/><path d="M13 8.5v5"/></svg><span class="pds-sort-text">1화부터 (오름차순)</span>';
        sortBtn.setAttribute('title', '현재: 1화부터 순서대로 (클릭 시 최신화부터 역순)');
      } else {
        sortBtn.innerHTML = '<svg class="pds-sort-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4.5h6M2.5 8h4M2.5 11.5h2"/><path d="M10.5 8.5l2.5 3 2.5-3"/><path d="M13 11.5v-5"/></svg><span class="pds-sort-text">최신화부터 (내림차순)</span>';
        sortBtn.setAttribute('title', '현재: 최신화부터 역순으로 (클릭 시 1화부터 순서대로)');
      }
    }

    var list = document.createElement('div');
    list.className = 'pds-list';

    function getEpisodeSortKey(ep, fallbackIndex) {
      if (!ep) return fallbackIndex;
      if (ep.episodeLabel) {
        var m = String(ep.episodeLabel).match(/(\d+(?:\.\d+)?)/);
        if (m) return parseFloat(m[1]);
      }
      if (ep.title) {
        var tm = String(ep.title).match(/(?:第|\b|\[|\()?\s*(\d+(?:\.\d+)?)\s*(?:화|편|話|\))/);
        if (tm) return parseFloat(tm[1]);
      }
      return fallbackIndex;
    }

    function renderEpisodes() {
      list.innerHTML = '';
      var sorted = episodes.slice().sort(function (a, b) {
        var valA = getEpisodeSortKey(a, a._idx);
        var valB = getEpisodeSortKey(b, b._idx);
        if (valA !== valB) {
          return currentSortOrder === 'asc' ? (valA - valB) : (valB - valA);
        }
        return currentSortOrder === 'asc' ? (a._idx - b._idx) : (b._idx - a._idx);
      });

      // build off-document so the whole list lands in one layout pass
      var frag = document.createDocumentFragment();
      sorted.forEach(function (ep) {
        frag.appendChild(createEpisodeItem(ep));
      });
      list.appendChild(frag);

      list.scrollTop = 0;
      applyTitleMarquee(card, list);
    }

    var isSorting = false;
    sortBtn.addEventListener('click', function (e) {
      e.preventDefault();
      if (isSorting) return;
      isSorting = true;

      currentSortOrder = (currentSortOrder === 'asc' ? 'desc' : 'asc');
      updateSortButtonUI();

      // Slide out effect
      list.classList.remove('pds-list-anim-in', 'pds-list-anim-prep');
      list.classList.add('pds-list-anim-out');

      setTimeout(function () {
        renderEpisodes();
        list.classList.remove('pds-list-anim-out');
        list.classList.add('pds-list-anim-prep');
        void list.offsetWidth; // force reflow
        list.classList.remove('pds-list-anim-prep');
        list.classList.add('pds-list-anim-in');

        setTimeout(function () {
          list.classList.remove('pds-list-anim-in');
          isSorting = false;
        }, 240);
      }, 140);
    });

    updateSortButtonUI();

    toolbar.appendChild(sortBtn);
    rightPanel.appendChild(toolbar);
    rightPanel.appendChild(list);
    card.appendChild(rightPanel);

    // episodes are rendered only after the card is in the document — measuring
    // title overflow on a detached node reads zeroes, so doing it earlier just
    // threw the whole pass away and made it run twice.
    // is-open goes on before the list is built (after a forced reflow, so the
    // open transition still has a start value to animate from) — that way the
    // marquee visibility observer measures against the modal's real on-screen
    // geometry instead of its hidden, pre-open state.
    openCard = card;
    applyFitScale(card);
    overlay.appendChild(card);
    void card.offsetWidth;
    overlay.classList.add('is-open');
    lockScroll();
    renderEpisodes();
  }

  // titles longer than the clipped box get a ping-pong scroll instead of
  // being cut off under the episode badge — only overflowing ones animate.
  // Reads and writes are kept in separate passes so the browser recalculates
  // layout twice total instead of once per title.
  function applyTitleMarquee(root, scrollRoot) {
    var titles = root.querySelectorAll('.pds-episode-title');

    var toMarquee = [];
    for (var i = 0; i < titles.length; i++) {
      var titleEl = titles[i];
      var inner = titleEl.querySelector('.pds-episode-title-inner');
      if (!inner) continue;
      var overflow = inner.scrollWidth - titleEl.clientWidth;
      if (overflow > 0) toMarquee.push({ el: titleEl, overflow: overflow });
    }
    if (!toMarquee.length) return;

    for (var j = 0; j < toMarquee.length; j++) {
      toMarquee[j].el.classList.add('is-marquee');
    }

    // the ::after fade only exists once .is-marquee is set, and its width is
    // the same for every title — so measure it once, after the class pass
    var fadeWidth = parseFloat(getComputedStyle(toMarquee[0].el, '::after').width) || 0;

    for (var k = 0; k < toMarquee.length; k++) {
      // scroll past the overflow by the fade's own width too, so the trailing
      // text (e.g. the episode ID) ends up fully clear of the gradient
      // instead of sitting permanently faded under it
      toMarquee[k].el.style.setProperty('--marquee-distance', -(toMarquee[k].overflow + fadeWidth) + 'px');
    }

    observeMarqueeVisibility(toMarquee, scrollRoot);
  }

  // A long series can have dozens of overflowing titles, and leaving every one
  // of them running an infinite transform animation pins the compositor even
  // though only a handful are on screen. Animate the visible ones only.
  var marqueeObserver = null;
  function observeMarqueeVisibility(entries, scrollRoot) {
    if (!('IntersectionObserver' in global)) {
      for (var i = 0; i < entries.length; i++) entries[i].el.classList.add('is-marquee-live');
      return;
    }
    if (marqueeObserver) marqueeObserver.disconnect();
    marqueeObserver = new IntersectionObserver(function (records) {
      records.forEach(function (record) {
        record.target.classList.toggle('is-marquee-live', record.isIntersecting);
      });
    }, { root: scrollRoot || null, rootMargin: '50px 0px' });
    for (var j = 0; j < entries.length; j++) marqueeObserver.observe(entries[j].el);
  }

  function createEpisodeItem(ep) {
    ep = ep || {};
    var item = document.createElement('a');
    item.className = 'pds-episode-item';

    // 오디오 노벨 리더가 준비된 화는 원문 새 탭 대신 이 사이트 안 리더
    // 페이지로 이동한다 (AudioNovel.md 참고). 준비 안 된 화는 기존과 동일.
    if (ep.reader) {
      item.href = 'audioNovelReaderPage.html?chapter=' + encodeURIComponent(ep.reader);
    } else {
      item.href = ep.link || '#';
      item.target = '_blank';
      item.rel = 'noopener noreferrer';
    }

    var title = document.createElement('p');
    title.className = 'pds-episode-title';
    var titleInner = document.createElement('span');
    titleInner.className = 'pds-episode-title-inner';
    titleInner.appendChild(document.createTextNode((ep.title || '게시물 이름') + ' '));
    var idSpan = document.createElement('span');
    idSpan.className = 'pds-episode-id';
    idSpan.textContent = '| ' + (ep.dcId != null ? ep.dcId : '게시물 ID');
    titleInner.appendChild(idSpan);
    title.appendChild(titleInner);
    item.appendChild(title);

    var link = document.createElement('p');
    link.className = 'pds-episode-link';
    link.textContent = ep.reader ? '🎧 오디오 노벨로 읽기' : (ep.link || '게시물 링크');
    item.appendChild(link);

    var badge = document.createElement('span');
    badge.className = 'pds-episode-badge';
    badge.textContent = ep.episodeLabel || '00 화';
    item.appendChild(badge);

    return item;
  }

  function close() {
    if (!overlayEl) return;
    openCard = null;
    overlayEl.classList.remove('is-open');
    unlockScroll();
    // closing only fades the overlay out — the card stays in the document, so
    // the marquee animations would otherwise keep running against an invisible
    // modal until the next open replaced it
    if (marqueeObserver) {
      marqueeObserver.disconnect();
      marqueeObserver = null;
    }
    var live = overlayEl.querySelectorAll('.is-marquee-live');
    for (var i = 0; i < live.length; i++) live[i].classList.remove('is-marquee-live');
  }

  global.PostDetailSeries = {
    open: open,
    close: close
  };
})(window);
