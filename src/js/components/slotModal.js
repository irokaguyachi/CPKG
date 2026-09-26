/**
 * 번역 슬롯 (오른쪽 아래 플로팅 버튼 + 팝업)
 * - 번역은 공식 태그가 없어서(Translation.json 의 tags 가 항상 빈 배열) 룰렛처럼
 *   태그를 먼저 고르지 않고, 칸이 하나뿐인 슬롯머신이 전체 번역 중 한 편을 바로
 *   뽑는다. 레버를 당기면 릴이 돌다가 한 칸에 멈춘다.
 * - 버튼 묶음에서 문학 룰렛(order 2) 위에 놓인다(order 1). 팝업 DOM과 번역 목록은
 *   처음 열 때 한 번만 만들고 받는다. 공통 동작은 pickerKit.js.
 * - 릴 회전은 requestAnimationFrame 으로 transform 을 직접 갱신하고, 속도에
 *   비례해 세로 방향으로만 흐리게(SVG feGaussianBlur stdDeviation="0 y") 해서
 *   글자가 위아래로 번지는 슬롯머신 느낌을 낸다.
 * - 의존: pickerKit.js, seriesUtil.js, bookmarkPicker.js, postDetailSeries.js
 */
(function (global) {
  var PK = global.PickerKit;
  if (!PK || !document.body) return;

  var DATA_PATH = '../data/PageData/Translation.json';
  var FAV_TYPE = 'translation';

  var CELL_COUNT = 30;     // 한 번 돌 때 지나가는 칸 수(마지막 칸이 당첨)
  var SPIN_MS = 3600;
  var LEVER_MS = 420;
  var LIGHT_COUNT = 14;
  var MAX_BLUR = 7;
  var PLACEHOLDER_EMOJI = '🌐';

  var DATA = global.dataUrl || function (p) { return p; };
  var reduceMotion = PK.reduceMotion;

  // 플로팅 버튼 아이콘: 작은 슬롯 창 안에서 글자 릴이 한 칸씩 끊어 돌아간다.
  // 번역이니 여러 언어의 글자를 번갈아 보여 준다. 오른쪽 레버는 마우스를
  // 올리면 아래로 당겨진다(팔과 손잡이를 따로 움직여야 손잡이가 찌그러지지
  // 않아서 형제 요소로 나눴다).
  var FAB_ICON =
    '<span class="sl-fab-machine" aria-hidden="true">' +
      '<span class="sl-fab-window"><span class="sl-fab-strip">' +
        '<span>あ</span><span>가</span><span>A</span><span>文</span><span>あ</span>' +
      '</span></span>' +
      '<span class="sl-fab-arm"></span>' +
      '<span class="sl-fab-pivot"></span>' +
      '<span class="sl-fab-knob"></span>' +
    '</span>';

  var MACHINE_HTML =
    '<header class="pk-head">' +
      '<p class="pk-eyebrow">RANDOM TRANSLATION</p>' +
      '<h2 class="pk-title" id="sl-title">번역 슬롯</h2>' +
      '<p class="pk-sub">번역은 태그가 없어서, 레버를 당기면 전체 번역 중 한 편을 바로 뽑아 드려요.</p>' +
    '</header>' +
    '<div class="sl-cabinet">' +
      '<div class="sl-body">' +
        '<div class="sl-lights" aria-hidden="true"></div>' +
        '<div class="sl-window">' +
          '<div class="sl-strip"></div>' +
          '<span class="sl-payline sl-payline-left" aria-hidden="true"></span>' +
          '<span class="sl-payline sl-payline-right" aria-hidden="true"></span>' +
        '</div>' +
        '<p class="sl-status" aria-live="polite">번역 목록을 불러오는 중…</p>' +
      '</div>' +
      '<button type="button" class="sl-lever" aria-label="레버 당겨서 번역 뽑기" disabled>' +
        '<span class="sl-lever-slot" aria-hidden="true"></span>' +
        '<span class="sl-lever-arm" aria-hidden="true"></span>' +
        '<span class="sl-lever-pivot" aria-hidden="true"></span>' +
        '<span class="sl-lever-knob" aria-hidden="true"></span>' +
        '<span class="sl-lever-hint" aria-hidden="true">PULL</span>' +
      '</button>' +
    '</div>' +
    '<p class="sl-note">⚠️ 번역은 태그를 지원하지 않아 선정적인 작품이 나올 수 있어요.</p>' +
    '<svg class="sl-defs" width="0" height="0" aria-hidden="true" focusable="false">' +
      '<filter id="sl-motion-blur" x="0" y="-20%" width="100%" height="140%">' +
        '<feGaussianBlur in="SourceGraphic" stdDeviation="0 0" />' +
      '</filter>' +
    '</svg>' +
    PK.resultHtml('다시 돌리기');

  var fabEl = null;
  var modal = null;
  var machineEl, cabinetEl, lightsEl, stripEl, statusEl, leverEl, blurEl;
  var resultEl, openBtn, rerollBtn;

  var items = [];
  var busy = false;
  var shownItem = null;    // 지금 창에 보이는 작품(없으면 안내 문구)
  var currentItem = null;  // 결과 카드에 올라간 작품

  /* ---------- 릴 ---------- */

  function cellFor(s, isGuide) {
    var cell = document.createElement('div');
    cell.className = 'sl-cell' + (isGuide ? ' is-guide' : '');
    var title = document.createElement('p');
    title.className = 'sl-cell-title';
    title.textContent = s.name;
    cell.appendChild(title);
    if (s.author) {
      var author = document.createElement('p');
      author.className = 'sl-cell-author';
      author.textContent = s.author;
      cell.appendChild(author);
    }
    return cell;
  }

  function showGuide(text) {
    stripEl.innerHTML = '';
    stripEl.style.transform = '';
    stripEl.appendChild(cellFor({ name: text }, true));
    shownItem = null;
  }

  function buildLights() {
    lightsEl.innerHTML = '';
    for (var i = 0; i < LIGHT_COUNT; i++) {
      var bulb = document.createElement('span');
      bulb.className = 'sl-light';
      bulb.style.animationDelay = (-(i % 3) * 0.12) + 's';
      lightsEl.appendChild(bulb);
    }
  }

  function cellHeight() {
    var first = stripEl.firstChild;
    return first ? first.getBoundingClientRect().height : 0;
  }

  // 살짝 지나쳤다가 돌아와 멈추는 슬롯머신 릴 감속
  function easeOutBack(t) {
    var c1 = 0.9;
    var c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  function setBlur(px) {
    blurEl.setAttribute('stdDeviation', '0 ' + px.toFixed(2));
  }

  function spinStrip(winner) {
    return new Promise(function (resolve) {
      // 지금 보이는 칸에서 이어서 돌도록 첫 칸은 현재 칸, 마지막 칸은 당첨작
      stripEl.innerHTML = '';
      stripEl.style.transform = '';
      stripEl.appendChild(shownItem ? cellFor(shownItem) : cellFor({ name: '레버를 당겨 보세요' }, true));
      var prev = shownItem;
      for (var i = 1; i < CELL_COUNT - 1; i++) {
        var filler;
        do { filler = items[PK.randInt(items.length)]; } while ((filler === prev || filler === winner) && items.length > 2);
        prev = filler;
        stripEl.appendChild(cellFor(filler));
      }
      stripEl.appendChild(cellFor(winner));

      var h = cellHeight();
      var end = (CELL_COUNT - 1) * h;
      var duration = reduceMotion ? 400 : SPIN_MS;
      var t0 = null;
      var lastY = 0;
      var lastNow = 0;
      if (!reduceMotion) stripEl.style.filter = 'url(#sl-motion-blur)';

      function frame(now) {
        if (t0 === null) { t0 = now; lastNow = now; }
        var t = Math.min(1, (now - t0) / duration);
        var y = end * (reduceMotion ? t : easeOutBack(t));
        stripEl.style.transform = 'translateY(' + (-y) + 'px)';
        if (!reduceMotion) {
          var dt = Math.max(1, now - lastNow);
          setBlur(Math.min(MAX_BLUR, Math.abs(y - lastY) / dt * 0.9));
        }
        lastY = y;
        lastNow = now;
        if (t < 1) {
          global.requestAnimationFrame(frame);
        } else {
          setBlur(0);
          stripEl.style.filter = '';
          // 다음 판을 위해 당첨 칸 하나만 남기고 정리한다
          stripEl.innerHTML = '';
          stripEl.style.transform = '';
          var cell = cellFor(winner);
          cell.classList.add('is-win');
          stripEl.appendChild(cell);
          shownItem = winner;
          resolve();
        }
      }
      global.requestAnimationFrame(frame);
    });
  }

  function pullLever() {
    return new Promise(function (resolve) {
      if (reduceMotion) { resolve(); return; }
      leverEl.classList.remove('is-pulled');
      void leverEl.offsetWidth;
      leverEl.classList.add('is-pulled');
      // 레버가 가장 아래까지 내려간 순간부터 릴이 돈다
      global.setTimeout(resolve, LEVER_MS * 0.45);
      // 남겨 두면 대기 중 손잡이 흔들림 애니메이션을 가린다
      global.setTimeout(function () { leverEl.classList.remove('is-pulled'); }, LEVER_MS + 50);
    });
  }

  /* ---------- 흐름 ---------- */

  function setBusy(on) {
    busy = on;
    machineEl.classList.toggle('is-spinning', on);
    leverEl.disabled = on || !items.length;
    if (rerollBtn) rerollBtn.disabled = on;
    if (openBtn) openBtn.disabled = on;
  }

  function runSpin() {
    if (busy || !items.length) return;
    setBusy(true);
    cabinetEl.classList.remove('is-win');
    PK.hideResult(resultEl);
    statusEl.textContent = 'SPINNING…';

    var winner = PK.pickAvoiding(items, currentItem);
    pullLever()
      .then(function () { return spinStrip(winner); })
      .then(function () {
        currentItem = winner;
        statusEl.textContent = '당첨!';
        cabinetEl.classList.add('is-win');
        PK.renderResult(resultEl, winner, {
          favType: FAV_TYPE,
          placeholderEmoji: PLACEHOLDER_EMOJI
        });
      })
      .then(function () { setBusy(false); }, function () { setBusy(false); });
  }

  function resetMachine() {
    currentItem = null;
    PK.hideResult(resultEl);
    cabinetEl.classList.remove('is-win');
    if (items.length) {
      showGuide('레버를 당겨 보세요');
      statusEl.textContent = 'READY · 번역 ' + items.length + '편';
    } else {
      showGuide('뽑을 번역이 없어요');
      statusEl.textContent = 'EMPTY';
    }
    leverEl.disabled = !items.length;
  }

  /* ---------- 팝업 ---------- */

  function buildModal() {
    modal = PK.createModal({
      machineClass: 'sl-machine',
      labelledBy: 'sl-title',
      closeLabel: '슬롯 닫기',
      html: MACHINE_HTML,
      fab: fabEl,
      onOpen: loadData,
      focusEl: function () { return leverEl; }
    });

    function q(sel) { return modal.el.querySelector(sel); }
    machineEl = modal.machine;
    cabinetEl = q('.sl-cabinet');
    lightsEl = q('.sl-lights');
    stripEl = q('.sl-strip');
    statusEl = q('.sl-status');
    leverEl = q('.sl-lever');
    blurEl = q('#sl-motion-blur feGaussianBlur');
    resultEl = q('.pk-result');
    openBtn = q('[data-pk-open]');
    rerollBtn = q('[data-pk-reroll]');

    leverEl.addEventListener('click', runSpin);
    rerollBtn.addEventListener('click', runSpin);
    PK.bindResult(resultEl, function () { return currentItem; }, FAV_TYPE);

    buildLights();
    showGuide('잠시만 기다려 주세요');
  }

  var loadPromise = null;
  function loadData() {
    if (loadPromise) return loadPromise;
    loadPromise = fetch(DATA(DATA_PATH))
      .then(function (r) { return r.json(); })
      .then(function (list) {
        items = Array.isArray(list) ? list : [];
        resetMachine();
        if (modal.isOpen() && !leverEl.disabled) leverEl.focus({ preventScroll: true });
      })
      .catch(function () {
        // 다음에 팝업을 다시 열면 한 번 더 시도한다
        loadPromise = null;
        showGuide('번역 목록을 불러오지 못했어요');
        statusEl.textContent = 'ERROR';
      });
    return loadPromise;
  }

  fabEl = PK.createFab({
    iconHtml: FAB_ICON,
    label: '번역 룰렛',
    ariaLabel: '번역 룰렛 열기',
    order: 1,
    className: 'sl-fab',
    // 평소 3.2초에 한 바퀴, 마우스를 올리면 약 2.7배(1.2초)까지 가속
    spinSelector: '.sl-fab-strip',
    hoverRate: 2.7,
    onClick: function () {
      if (!modal) buildModal();
      modal.open();
    }
  });

  global.SlotModal = {
    open: function () { fabEl.click(); },
    close: function () { if (modal) modal.close(); }
  };
})(window);
