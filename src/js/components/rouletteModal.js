/**
 * 문학 룰렛 (오른쪽 아래 플로팅 버튼 + 팝업)
 * - 오른쪽 아래 버튼 묶음에 천천히 도는 룰렛 아이콘과 "룰렛" 글자로 된
 *   버튼을 달고, 누르면 룰렛 머신 팝업을 연다. 팝업 DOM과 문학 목록은 처음
 *   열 때 한 번만 만들고 받는다(버튼만 보고 지나가는 방문자에게 Novel.json 을
 *   내려받게 하지 않기 위해). 버튼·팝업·결과 카드의 공통 동작은 pickerKit.js.
 * - 룰렛 머신 하나가 두 단계를 모두 처리한다: 바퀴가 공식 태그 하나를 고르고
 *   (1단계), 아래 화면(릴)이 그 태그가 붙은 문학 중 한 편을 고른다(2단계).
 * - 목록은 문학 탭과 같은 Novel.json(시리즈에 속하지 않은 단독 게시물)을 쓴다.
 * - 바퀴 칸은 태그마다 같은 크기라 태그 자체는 균등 확률로 뽑히고, 작품은
 *   뽑힌 태그 안에서 다시 균등 확률로 뽑힌다.
 * - 의존: pickerKit.js, tagConfig.js(필수), seriesUtil.js, contentSettings.js,
 *   bookmarkPicker.js, postDetailSeries.js (없으면 해당 부가 기능만 빠진다)
 */
(function (global) {
  var t = global.I18n.t;
  var PK = global.PickerKit;
  if (!PK || !global.TagConfig || !document.body) return;

  var DATA_PATH = '../data/pageData/Novel.json';
  var FAV_TYPE = 'novel';

  // 작품 수가 이보다 적은 태그(명언·이모티콘처럼 1편뿐인 태그)는 바퀴에
  // 올리지 않는다 — 칸 하나를 차지하는데 매번 같은 작품만 나오게 된다.
  var MIN_ITEMS_PER_TAG = 3;

  var SPIN_MS = 5200;
  var MIN_TURNS = 5;
  var BULB_COUNT = 24;
  var WHEEL_R = 96;

  var TAG_EMOJI = global.TagConfig.TAG_EMOJI;
  var DEFAULT_EMOJI = global.TagConfig.DEFAULT_EMOJI;
  var sortTags = global.TagConfig.sortTags;

  var DATA = global.dataUrl || function (p) { return p; };
  var randInt = PK.randInt;
  var reduceMotion = PK.reduceMotion;

  // 플로팅 버튼 아이콘. 칸 색은 tags.css 태그 색(로맨스·일상·코미디·슬픔·
  // 짧문·감동·대회·피폐)과 같은 계열이지만, 60px 안팎의 작은 아이콘에서는
  // 파스텔 원색이 흰 원처럼 보여서 채도를 올렸다.
  var FAB_ICON = (function () {
    var colors = ['#f48fb1', '#4fc3b5', '#f6c945', '#7f9cf0', '#d58bd0', '#f4a261', '#5aa9f0', '#ef6f6f'];
    var n = colors.length;
    var r = 20;
    function pt(i) {
      var a = (i / n) * Math.PI * 2;
      return (r * Math.sin(a)).toFixed(2) + ',' + (-r * Math.cos(a)).toFixed(2);
    }
    var slices = colors.map(function (c, i) {
      return '<path d="M0,0L' + pt(i) + 'A' + r + ',' + r + ' 0 0,1 ' + pt(i + 1) + 'Z" fill="' + c + '"/>';
    }).join('');
    var lines = colors.map(function (c, i) {
      return '<path d="M0,0L' + pt(i) + '"/>';
    }).join('');
    return '<svg class="rl-fab-wheel" viewBox="-24 -24 48 48" aria-hidden="true">' +
      '<circle r="23.5" class="rl-fab-wheel-rim"/>' + slices +
      '<g class="rl-fab-wheel-lines">' + lines + '</g>' +
      '<circle r="5.5" class="rl-fab-wheel-hub"/></svg>';
  })();

  var MACHINE_HTML =
    '<header class="pk-head">' +
      '<p class="pk-eyebrow">RANDOM LITERATURE</p>' +
      '<h2 class="pk-title" id="rl-title">' + t('문학 룰렛') + '</h2>' +
      '<p class="pk-sub">' + t('룰렛이 태그를 고르면, 그 태그가 붙은 문학 중 한 편을 뽑아 드려요.') + '</p>' +
    '</header>' +
    '<div class="rl-stage">' +
      '<div class="rl-rim" aria-hidden="true"></div>' +
      '<svg class="rl-wheel" viewBox="-100 -100 200 200" role="img" aria-label="' + t('태그 룰렛') + '"></svg>' +
      '<div class="rl-pointer" aria-hidden="true">' +
        '<svg viewBox="0 0 32 40"><path d="M16 38L2.5 8.5A14 14 0 0 1 29.5 8.5Z" /><circle cx="16" cy="12" r="4.5" /></svg>' +
      '</div>' +
      '<button type="button" class="rl-hub" disabled><span class="rl-hub-label">SPIN</span></button>' +
    '</div>' +
    '<div class="rl-screen" aria-live="polite">' +
      '<div class="rl-screen-row">' +
        '<span class="rl-screen-step">READY</span>' +
        '<span class="rl-screen-tag">' + t('문학 목록을 불러오는 중…') + '</span>' +
      '</div>' +
      '<div class="rl-reel"><p class="rl-reel-text">' + t('잠시만 기다려 주세요') + '</p></div>' +
    '</div>' +
    PK.resultHtml(t('같은 태그로 다시 뽑기'));

  var fabEl = null;
  var modal = null;
  var machineEl, wheelEl, rimEl, pointerEl, spinBtn, stepEl, screenTagEl, reelTextEl;
  var resultEl, openBtn, rerollBtn;

  var rawItems = [];
  var items = [];
  var tagPool = {};      // 태그 → 그 태그가 붙은 작품 배열
  var wheelTags = [];    // 바퀴에 올라간 태그(칸 순서)
  var sliceEls = [];
  var rotation = 0;      // 누적 회전각(deg, 시계 방향)
  var busy = false;
  var currentTag = null;
  var currentItem = null;
  var lastPickByTag = {};

  // 설정에서 후방주의 표시를 끈 경우 문학 탭과 똑같이 목록에서 뺀다 —
  // 그래야 태그 칸도, 뽑히는 작품도 탭에서 보이는 목록과 어긋나지 않는다.
  function recomputeItems() {
    var CS = global.ContentSettings;
    items = (!CS || CS.get().showMature)
      ? rawItems
      : rawItems.filter(function (s) { return !CS.hasMatureTag(s.tags); });

    tagPool = {};
    items.forEach(function (s) {
      (s.tags || []).forEach(function (t) {
        (tagPool[t] = tagPool[t] || []).push(s);
      });
    });
    wheelTags = sortTags(Object.keys(tagPool).filter(function (t) {
      return tagPool[t].length >= MIN_ITEMS_PER_TAG;
    }));
  }

  /* ---------- 바퀴 그리기 ---------- */

  var SVG_NS = 'http://www.w3.org/2000/svg';
  function svg(name, attrs) {
    var el = document.createElementNS(SVG_NS, name);
    for (var k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }
  // 12시 방향을 0도로 두고 시계 방향으로 잰 각도의 원 위 점
  function polar(r, deg) {
    var rad = deg * Math.PI / 180;
    return [r * Math.sin(rad), -r * Math.cos(rad)];
  }
  function fmt(n) { return Math.round(n * 1000) / 1000; }

  function buildWheel() {
    wheelEl.innerHTML = '';
    sliceEls = [];
    var n = wheelTags.length;
    if (!n) return;
    var seg = 360 / n;

    wheelEl.appendChild(svg('circle', { class: 'rl-wheel-base', cx: 0, cy: 0, r: WHEEL_R }));

    wheelTags.forEach(function (tag, i) {
      var a0 = i * seg;
      var a1 = (i + 1) * seg;
      var g = svg('g', { class: 'rl-slice', 'data-tag': tag });

      var p0 = polar(WHEEL_R, a0);
      var p1 = polar(WHEEL_R, a1);
      var d = n === 1
        ? 'M0,' + (-WHEEL_R) + 'A' + WHEEL_R + ',' + WHEEL_R + ' 0 1,1 0,' + WHEEL_R + 'A' + WHEEL_R + ',' + WHEEL_R + ' 0 1,1 0,' + (-WHEEL_R) + 'Z'
        : 'M0,0L' + fmt(p0[0]) + ',' + fmt(p0[1]) +
          'A' + WHEEL_R + ',' + WHEEL_R + ' 0 ' + (seg > 180 ? 1 : 0) + ',1 ' + fmt(p1[0]) + ',' + fmt(p1[1]) + 'Z';
      g.appendChild(svg('path', { class: 'rl-slice-fill', d: d }));

      // 칸 이름은 반지름을 따라 놓이고 이모지는 항상 테두리 쪽에 온다.
      // 왼쪽 절반은 테두리→중심, 오른쪽 절반은 중심→테두리 방향으로 읽혀야
      // 글자가 거꾸로 뒤집혀 보이지 않는다.
      var mid = a0 + seg / 2;
      var rightHalf = mid > 0 && mid < 180;
      var emoji = TAG_EMOJI[tag] || DEFAULT_EMOJI;
      var label = svg('text', {
        class: 'rl-slice-label',
        transform: 'rotate(' + fmt(mid) + ') translate(0,' + (-(WHEEL_R - 12)) + ') rotate(' + (rightHalf ? -90 : 90) + ')',
        'text-anchor': rightHalf ? 'end' : 'start',
        'dominant-baseline': 'central'
      });
      label.textContent = rightHalf ? tag + ' ' + emoji : emoji + ' ' + tag;
      g.appendChild(label);

      wheelEl.appendChild(g);
      sliceEls.push(g);
    });

    wheelEl.appendChild(svg('circle', { class: 'rl-wheel-edge', cx: 0, cy: 0, r: WHEEL_R }));
    setRotation(rotation);
  }

  function buildRim() {
    rimEl.innerHTML = '';
    for (var i = 0; i < BULB_COUNT; i++) {
      var bulb = document.createElement('span');
      bulb.className = 'rl-bulb' + (i % 2 ? ' is-odd' : '');
      bulb.style.transform = 'rotate(' + (i * 360 / BULB_COUNT) + 'deg)';
      rimEl.appendChild(bulb);
    }
  }

  function setRotation(deg) {
    wheelEl.style.transform = 'rotate(' + deg + 'deg)';
  }

  // 포인터(12시) 아래에 있는 칸 번호
  function sliceUnderPointer(deg) {
    var n = wheelTags.length;
    var a = ((-deg % 360) + 360) % 360;
    return Math.floor(a / (360 / n)) % n;
  }

  function clearWinner() {
    wheelEl.classList.remove('has-winner');
    sliceEls.forEach(function (el) { el.classList.remove('is-winner'); });
  }

  /* ---------- 1단계: 바퀴 ---------- */

  function easeOutQuart(t) { return 1 - Math.pow(1 - t, 4); }

  function flickPointer() {
    pointerEl.classList.remove('is-flick');
    void pointerEl.offsetWidth;
    pointerEl.classList.add('is-flick');
  }

  function spinWheel() {
    return new Promise(function (resolve) {
      var n = wheelTags.length;
      var seg = 360 / n;
      var target = randInt(n);
      // 칸 경계에 딱 걸려 애매해 보이지 않도록 칸 폭의 가운데 70% 안에서 멈춘다
      var landAt = target * seg + seg * (0.15 + Math.random() * 0.7);
      var turns = reduceMotion ? 1 : MIN_TURNS + randInt(3);
      var start = rotation;
      var delta = ((-landAt - start) % 360 + 360) % 360;
      var end = start + turns * 360 + delta;
      var duration = reduceMotion ? 700 : SPIN_MS;
      var t0 = null;
      var lastSlice = sliceUnderPointer(start);

      function frame(now) {
        if (t0 === null) t0 = now;
        var t = Math.min(1, (now - t0) / duration);
        var deg = start + (end - start) * easeOutQuart(t);
        setRotation(deg);
        var s = sliceUnderPointer(deg);
        if (s !== lastSlice) { lastSlice = s; flickPointer(); }
        if (t < 1) {
          global.requestAnimationFrame(frame);
        } else {
          rotation = end % 360;
          setRotation(rotation);
          resolve(target);
        }
      }
      global.requestAnimationFrame(frame);
    });
  }

  /* ---------- 2단계: 릴 ---------- */

  function setReel(text, final) {
    reelTextEl.textContent = text;
    reelTextEl.classList.remove('is-roll', 'is-final');
    void reelTextEl.offsetWidth;
    reelTextEl.classList.add(final ? 'is-final' : 'is-roll');
  }


  function pickItem(tag) {
    var winner = PK.pickAvoiding(tagPool[tag] || [], lastPickByTag[tag]);
    if (winner) lastPickByTag[tag] = winner;
    return winner;
  }

  function spinReel(tag, winner) {
    return new Promise(function (resolve) {
      var pool = tagPool[tag] || [];
      if (reduceMotion || pool.length < 2) {
        setReel(winner.name, true);
        resolve();
        return;
      }
      // 처음엔 빠르게, 점점 느려지다 멈추는 슬롯머신 간격
      var delay = 45;
      var prev = null;
      function tick() {
        if (delay > 340) {
          setReel(winner.name, true);
          resolve();
          return;
        }
        var s;
        do { s = pool[randInt(pool.length)]; } while (s === prev && pool.length > 2);
        prev = s;
        setReel(s.name, false);
        delay *= 1.13;
        global.setTimeout(tick, delay);
      }
      tick();
    });
  }

  /* ---------- 결과 ---------- */

  function tagChipText(tag) {
    return (TAG_EMOJI[tag] || DEFAULT_EMOJI) + ' ' + tag;
  }

  function renderResult(s) {
    currentItem = s;
    // 문학의 절반 가량은 대표 이미지가 없다 — 회색 빈칸 대신 당첨 태그의
    // 색과 이모지로 채운다
    PK.renderResult(resultEl, s, {
      favType: FAV_TYPE,
      pickedTag: currentTag,
      placeholderTag: currentTag,
      placeholderEmoji: TAG_EMOJI[currentTag] || DEFAULT_EMOJI
    });
  }

  /* ---------- 흐름 ---------- */

  function setBusy(on) {
    busy = on;
    machineEl.classList.toggle('is-spinning', on);
    spinBtn.disabled = on || !wheelTags.length;
    if (rerollBtn) rerollBtn.disabled = on;
    if (openBtn) openBtn.disabled = on;
  }

  function setStep(text) { stepEl.textContent = text; }

  function drawNovel(tag) {
    var winner = pickItem(tag);
    if (!winner) {
      setStep('EMPTY');
      setReel(t('이 태그의 문학을 찾지 못했어요'), true);
      return Promise.resolve();
    }
    setStep('STEP 2');
    return spinReel(tag, winner).then(function () {
      setStep(t('당첨!'));
      renderResult(winner);
    });
  }

  function runSpin() {
    if (busy || !wheelTags.length) return;
    setBusy(true);
    clearWinner();
    resultEl.classList.remove('is-in');
    resultEl.hidden = true;
    currentTag = null;
    setStep('STEP 1');
    screenTagEl.textContent = t('태그를 고르는 중…');
    screenTagEl.removeAttribute('data-tag');
    setReel(t('룰렛이 돌아가고 있어요'), false);

    spinWheel()
      .then(function (idx) {
        currentTag = wheelTags[idx];
        sliceEls[idx].classList.add('is-winner');
        wheelEl.classList.add('has-winner');
        screenTagEl.textContent = tagChipText(currentTag) + ' · ' + t('{n}편', { n: tagPool[currentTag].length });
        screenTagEl.dataset.tag = currentTag;
        return new Promise(function (r) { global.setTimeout(r, reduceMotion ? 0 : 450); });
      })
      .then(function () { return drawNovel(currentTag); })
      .then(finish, finish);
  }

  function runReroll() {
    if (busy || !currentTag) return;
    setBusy(true);
    resultEl.classList.remove('is-in');
    drawNovel(currentTag).then(finish, finish);
  }

  var pendingRebuild = false;

  function applyContentSettings() {
    var CS = global.ContentSettings;
    recomputeItems();
    buildWheel();
    // 방금 뽑힌 작품이 새 설정에서 가려지는 작품이면 결과째 초기화하고,
    // 아니면 결과 카드는 그대로 두고 바퀴와 안내 문구만 새로 맞춘다.
    if (!currentItem || (CS && CS.isBlocked(currentItem.tags))) {
      resetMachine();
    } else {
      spinBtn.disabled = !wheelTags.length;
    }
  }

  function finish() {
    setBusy(false);
    if (pendingRebuild) {
      pendingRebuild = false;
      applyContentSettings();
    }
  }

  function resetMachine() {
    clearWinner();
    currentTag = null;
    currentItem = null;
    resultEl.hidden = true;
    setStep('READY');
    screenTagEl.textContent = t('태그 {tags}종 · 문학 {n}편', { tags: wheelTags.length, n: items.length });
    screenTagEl.removeAttribute('data-tag');
    setReel(wheelTags.length ? t('가운데 SPIN 버튼을 눌러 보세요') : t('룰렛에 올릴 태그가 없어요'), true);
    spinBtn.disabled = !wheelTags.length;
  }

  /* ---------- 팝업 ---------- */

  function buildModal() {
    modal = PK.createModal({
      machineClass: 'rl-machine',
      labelledBy: 'rl-title',
      closeLabel: t('룰렛 닫기'),
      html: MACHINE_HTML,
      fab: fabEl,
      onOpen: loadData,
      focusEl: function () { return spinBtn; }
    });

    function q(sel) { return modal.el.querySelector(sel); }
    machineEl = modal.machine;
    wheelEl = q('.rl-wheel');
    rimEl = q('.rl-rim');
    pointerEl = q('.rl-pointer');
    spinBtn = q('.rl-hub');
    stepEl = q('.rl-screen-step');
    screenTagEl = q('.rl-screen-tag');
    reelTextEl = q('.rl-reel-text');
    resultEl = q('.pk-result');
    openBtn = q('[data-pk-open]');
    rerollBtn = q('[data-pk-reroll]');

    spinBtn.addEventListener('click', runSpin);
    rerollBtn.addEventListener('click', runReroll);
    PK.bindResult(resultEl, function () { return currentItem; }, FAV_TYPE);

    buildRim();
  }

  var loadPromise = null;
  function loadData() {
    if (loadPromise) return loadPromise;
    loadPromise = fetch(DATA(DATA_PATH))
      .then(function (r) { return r.json(); })
      .then(function (list) {
        rawItems = Array.isArray(list) ? list : [];
        recomputeItems();
        buildWheel();
        resetMachine();
        if (modal.isOpen() && !spinBtn.disabled) spinBtn.focus({ preventScroll: true });
      })
      .catch(function () {
        // 다음에 팝업을 다시 열면 한 번 더 시도한다
        loadPromise = null;
        setStep('ERROR');
        setReel(t('문학 목록을 불러오지 못했어요'), true);
      });
    return loadPromise;
  }

  fabEl = PK.createFab({
    iconHtml: FAB_ICON,
    label: t('문학 룰렛'),
    ariaLabel: t('문학 룰렛 열기'),
    order: 2,
    // 평소 7초에 한 바퀴, 마우스를 올리면 5배(1.4초에 한 바퀴)까지 가속
    spinSelector: '.rl-fab-wheel',
    hoverRate: 5,
    onClick: function () {
      if (!modal) buildModal();
      modal.open();
    }
  });

  // 설정창에서 후방주의 표시를 바꾸면 새로고침 없이 바퀴를 다시 짠다.
  // 돌아가는 중에 칸 구성이 바뀌면 멈출 칸이 어긋나므로 그땐 끝난 뒤로 미룬다.
  global.addEventListener('chokaguya:content-settings-change', function () {
    if (!rawItems.length) return;
    if (busy) { pendingRebuild = true; return; }
    applyContentSettings();
  });

  global.RouletteModal = {
    open: function () { fabEl.click(); },
    close: function () { if (modal) modal.close(); }
  };
})(window);
