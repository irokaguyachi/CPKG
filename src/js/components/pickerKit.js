/**
 * 랜덤 뽑기 팝업 공통 도구 (문학 룰렛 rouletteModal.js, 번역 슬롯 slotModal.js)
 * - createFab: 오른쪽 아래 버튼 묶음(.pk-fab-stack)에 아이콘+이름 버튼을 단다.
 * - createModal: 팝업 오버레이. 여닫기, 바깥 클릭·Esc 닫기, 스크롤 잠금,
 *   포커스 복원을 맡는다. 한 번에 팝업 하나만 열린다.
 * - resultHtml / renderResult / bindResult: 뽑힌 작품 카드와 "작품 보기" 버튼.
 *   상세 팝업은 목록 페이지와 같은 PostDetailSeries 를 쓴다.
 * 스타일은 css/components/picker-kit.css.
 */
(function (global) {
  var ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 5L19 19M19 5L5 19" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';

  var reduceMotion = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function randInt(n) { return Math.floor(Math.random() * n); }

  /* ---------- 플로팅 버튼 ---------- */

  function fabStack() {
    var el = document.querySelector('.pk-fab-stack');
    if (!el) {
      el = document.createElement('div');
      el.className = 'pk-fab-stack';
      document.body.appendChild(el);
    }
    return el;
  }

  // 마우스를 올리면 아이콘 애니메이션(CSS animation)을 maxRate 배까지 서서히
  // 빠르게, 떼면 서서히 원래 속도로 되돌린다. CSS 에서 :hover 로
  // animation-duration 을 바꾸면 진행 위치가 새 길이 기준으로 다시 계산돼
  // 아이콘이 다른 각도로 툭 튀는데, playbackRate 는 바꿔도 현재 위치를
  // 그대로 유지하므로 끊김 없이 이어진다.
  var HOVER_RAMP_MS = 120; // 지수 감쇠 시간 상수 — 약 0.35초면 목표 속도의 95%
  function rampOnHover(btn, selector, maxRate) {
    var el = btn.querySelector(selector);
    if (!el || typeof el.getAnimations !== 'function' || reduceMotion) return;
    var rate = 1;
    var target = 1;
    var raf = 0;
    var last = 0;
    function step(now) {
      var dt = last ? Math.min(64, now - last) : 16;
      last = now;
      rate += (target - rate) * (1 - Math.exp(-dt / HOVER_RAMP_MS));
      if (Math.abs(target - rate) < 0.01) rate = target;
      el.getAnimations().forEach(function (a) { a.playbackRate = rate; });
      if (rate !== target) {
        raf = global.requestAnimationFrame(step);
      } else {
        raf = 0;
        last = 0;
      }
    }
    function rampTo(r) {
      target = r;
      if (!raf) raf = global.requestAnimationFrame(step);
    }
    btn.addEventListener('pointerenter', function () { rampTo(maxRate); });
    btn.addEventListener('pointerleave', function () { rampTo(1); });
    // 팝업이 열리면 버튼 묶음이 숨겨져 pointerleave 가 안 올 수 있다
    btn.addEventListener('click', function () { rampTo(1); });
  }

  // opts: { iconHtml, label, ariaLabel, order, className, onClick,
  //         spinSelector, hoverRate }
  // order 가 작을수록 위에 놓인다. spinSelector 로 지정한 아이콘 요소의
  // 애니메이션은 마우스를 올린 동안 hoverRate 배로 빨라진다.
  function createFab(opts) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pk-fab' + (opts.className ? ' ' + opts.className : '');
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', opts.ariaLabel || opts.label);
    btn.style.order = String(opts.order || 0);
    btn.innerHTML = '<span class="pk-fab-icon">' + opts.iconHtml + '</span>' +
      '<span class="pk-fab-label">' + opts.label + '</span>';
    btn.addEventListener('click', opts.onClick);
    fabStack().appendChild(btn);
    if (opts.spinSelector) rampOnHover(btn, opts.spinSelector, opts.hoverRate || 3);
    return btn;
  }

  // 팝업 대신 다른 페이지로 이동하는 링크형 버튼(북마크 등).
  // opts: { href, iconHtml, label, ariaLabel, order, className, current }
  // current 가 참이면 지금 보고 있는 페이지라는 표시(aria-current, .is-current)를
  // 단다. 같은 페이지 링크 클릭은 loading.js 가 막아 준다.
  function createFabLink(opts) {
    var a = document.createElement('a');
    a.href = opts.href;
    a.className = 'pk-fab' + (opts.className ? ' ' + opts.className : '') + (opts.current ? ' is-current' : '');
    a.setAttribute('aria-label', opts.ariaLabel || opts.label);
    if (opts.current) a.setAttribute('aria-current', 'page');
    a.style.order = String(opts.order || 0);
    a.innerHTML = '<span class="pk-fab-icon">' + opts.iconHtml + '</span>' +
      '<span class="pk-fab-label">' + opts.label + '</span>';
    fabStack().appendChild(a);
    return a;
  }

  /* ---------- 팝업 ---------- */

  // postDetailSeries.js 와 같은 방식의 스크롤 잠금. 뽑기 팝업 위에 상세 팝업을
  // 열었다 닫으면 그쪽 close() 가 잠금을 풀어 버리므로, 뽑기 팝업이 열려 있는
  // 동안에는 body 의 overflow 가 풀리는 순간 다시 잠근다.
  var current = null;
  function lockScroll() {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }
  function unlockScroll() {
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }
  if ('MutationObserver' in global) {
    new MutationObserver(function () {
      if (current && document.body.style.overflow !== 'hidden') lockScroll();
    }).observe(document.body, { attributes: true, attributeFilter: ['style'] });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !current) return;
    // 뽑기 팝업 위에 상세 팝업이 떠 있으면 Esc 는 그쪽만 닫는다
    if (document.querySelector('.pds-overlay.is-open')) return;
    current.close();
  });

  // opts: { machineClass, labelledBy, closeLabel, html, fab, onOpen, focusEl() }
  // html 은 .pk-machine 안쪽 내용. 닫기 버튼은 여기서 붙인다.
  function createModal(opts) {
    var overlay = document.createElement('div');
    overlay.className = 'pk-overlay';
    overlay.innerHTML =
      '<section class="pk-machine ' + (opts.machineClass || '') + '" role="dialog" aria-modal="true"' +
        (opts.labelledBy ? ' aria-labelledby="' + opts.labelledBy + '"' : '') + '>' +
        '<button type="button" class="pk-close" aria-label="' + (opts.closeLabel || '닫기') + '">' + ICON_CLOSE + '</button>' +
        opts.html +
      '</section>';
    document.body.appendChild(overlay);

    var lastFocus = null;
    var modal = {
      el: overlay,
      machine: overlay.firstChild,
      isOpen: function () { return current === modal; },
      open: function () {
        if (current === modal) return;
        if (current) current.close();
        current = modal;
        lastFocus = document.activeElement;
        if (global.Sidebar && typeof global.Sidebar.close === 'function') global.Sidebar.close();
        lockScroll();
        document.body.classList.add('pk-modal-open');
        overlay.classList.add('is-open');
        if (opts.fab) opts.fab.setAttribute('aria-expanded', 'true');
        if (opts.onOpen) opts.onOpen();
        var f = opts.focusEl && opts.focusEl();
        if (f && !f.disabled) f.focus({ preventScroll: true });
      },
      close: function () {
        if (current !== modal) return;
        current = null;
        overlay.classList.remove('is-open');
        document.body.classList.remove('pk-modal-open');
        if (opts.fab) opts.fab.setAttribute('aria-expanded', 'false');
        unlockScroll();
        if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus({ preventScroll: true });
      }
    };

    overlay.querySelector('.pk-close').addEventListener('click', modal.close);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) modal.close();
    });
    return modal;
  }

  /* ---------- 결과 카드 ---------- */

  // rerollLabel: 두 번째 버튼 문구 (예: "같은 태그로 다시 뽑기")
  function resultHtml(rerollLabel) {
    return '<div class="pk-result" hidden>' +
        '<article class="pk-card">' +
          '<div class="pk-card-image"></div>' +
          '<div class="pk-card-body">' +
            '<p class="pk-card-title"></p>' +
            '<p class="pk-card-meta"></p>' +
            '<div class="pk-card-tags"></div>' +
          '</div>' +
        '</article>' +
        '<div class="pk-actions">' +
          '<button type="button" class="pk-btn pk-btn-primary" data-pk-open>작품 보기</button>' +
          '<button type="button" class="pk-btn" data-pk-reroll>' + rerollLabel + '</button>' +
        '</div>' +
      '</div>';
  }

  function itemId(s) {
    return s && s.posts && s.posts[0] && s.posts[0].id;
  }

  function openDetail(s, favType) {
    if (!s || !global.PostDetailSeries) return;
    global.PostDetailSeries.open({
      seriesName: s.name,
      imageUrl: s.image,
      favType: favType,
      postId: itemId(s),
      tags: s.tags,
      episodes: (s.posts || []).map(function (post) {
        return {
          title: post.title,
          dcId: post.id,
          link: post.link,
          reader: post.reader,
          episodeLabel: post.episode + ' 화'
        };
      })
    });
  }

  // 카드 이미지 클릭과 "작품 보기" 버튼을 getItem() 이 돌려주는 작품의 상세
  // 팝업에 연결한다.
  function bindResult(resultEl, getItem, favType) {
    function openCurrent() { openDetail(getItem(), favType); }
    resultEl.querySelector('[data-pk-open]').addEventListener('click', openCurrent);
    resultEl.querySelector('.pk-card-image').addEventListener('click', function (e) {
      // 이미지 위 북마크 버튼 클릭은 상세 팝업을 열지 않는다
      if (e.target.closest('button')) return;
      openCurrent();
    });
  }

  // cdnConfig.js 의 revealBackground() 와 같은 규칙: 600px 썸네일을 먼저
  // 시도하고, 썸네일이 아직 안 만들어진 이미지(404)면 원본으로 대신한다.
  // 다시 뽑기를 빨리 누르면 앞 작품의 늦은 응답이 새 작품 이미지를 덮어쓸 수
  // 있어서, 요청마다 토큰을 붙여 마지막 요청만 칠한다.
  var paintSeq = 0;
  function paintImage(el, rawPath) {
    var thumb = global.resolveThumbUrl ? global.resolveThumbUrl(rawPath) : rawPath;
    var full = global.resolveAssetUrl ? global.resolveAssetUrl(rawPath) : rawPath;
    var token = String(++paintSeq);
    el.dataset.paintToken = token;
    function paint(url) {
      if (el.dataset.paintToken === token) el.style.backgroundImage = 'url("' + url + '")';
    }
    if (thumb === full) { paint(full); return; }
    var probe = new Image();
    probe.onload = function () { paint(thumb); };
    probe.onerror = function () { paint(full); };
    probe.src = thumb;
  }

  // opts: { favType, pickedTag, placeholderTag, placeholderEmoji }
  // 대표 이미지가 없으면 placeholderTag 의 태그 색과 placeholderEmoji 로 채운다.
  function renderResult(resultEl, s, opts) {
    var TC = global.TagConfig;
    var imageEl = resultEl.querySelector('.pk-card-image');
    var tagsEl = resultEl.querySelector('.pk-card-tags');

    imageEl.innerHTML = '';
    imageEl.style.backgroundImage = '';
    imageEl.classList.toggle('is-empty', !s.image);
    imageEl.removeAttribute('data-tag');
    if (s.image) {
      paintImage(imageEl, s.image);
    } else {
      imageEl.dataset.paintToken = '';
      if (opts.placeholderTag) imageEl.dataset.tag = opts.placeholderTag;
      var ph = document.createElement('span');
      ph.className = 'pk-card-placeholder';
      ph.setAttribute('aria-hidden', 'true');
      ph.textContent = opts.placeholderEmoji || (TC && TC.DEFAULT_EMOJI) || '';
      imageEl.appendChild(ph);
    }
    var favId = itemId(s);
    if (favId != null && global.BookmarkPicker) {
      imageEl.appendChild(global.BookmarkPicker.createButton(opts.favType, favId));
    }

    resultEl.querySelector('.pk-card-title').textContent = s.name;
    var meta = [];
    if (s.author) meta.push(s.author);
    var count = global.SeriesUtil ? global.SeriesUtil.countLine(s) : s.charCount;
    if (count) meta.push(count);
    resultEl.querySelector('.pk-card-meta').textContent = meta.join(' · ');

    tagsEl.innerHTML = '';
    var tags = TC ? TC.sortTags(s.tags || []) : (s.tags || []);
    tags.forEach(function (tag) {
      var pill = document.createElement('span');
      pill.className = 'series-card-tag' + (tag === opts.pickedTag ? ' is-picked' : '');
      pill.dataset.tag = tag;
      pill.textContent = ((TC && (TC.TAG_EMOJI[tag] || TC.DEFAULT_EMOJI)) || '') + ' ' + tag;
      tagsEl.appendChild(pill);
    });

    resultEl.hidden = false;
    resultEl.classList.remove('is-in');
    void resultEl.offsetWidth;
    resultEl.classList.add('is-in');
    // 팝업이 화면보다 길면 결과 카드가 아래로 밀려 안 보이므로 끝까지 내려 준다
    resultEl.scrollIntoView({ block: 'end', behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  function hideResult(resultEl) {
    resultEl.classList.remove('is-in');
    resultEl.hidden = true;
  }

  // 목록에서 무작위로 하나 고르되, 바로 직전에 나온 작품(avoid)은 한 번 비껴 준다
  function pickAvoiding(list, avoid) {
    if (!list.length) return null;
    var idx = randInt(list.length);
    if (list.length > 1 && list[idx] === avoid) {
      idx = (idx + 1 + randInt(list.length - 1)) % list.length;
    }
    return list[idx];
  }

  global.PickerKit = {
    reduceMotion: reduceMotion,
    randInt: randInt,
    createFab: createFab,
    createFabLink: createFabLink,
    createModal: createModal,
    resultHtml: resultHtml,
    bindResult: bindResult,
    renderResult: renderResult,
    hideResult: hideResult,
    pickAvoiding: pickAvoiding
  };
})(window);
