(function (global) {
  'use strict';

  // 오늘의 랜덤 문학 — 메인 페이지 최상단의 선물상자.
  //
  // - 그날의 글은 KST 날짜 문자열(YYYY-MM-DD)을 해시해 후보 목록의 인덱스로
  //   쓰는 결정론적 방식으로 고른다. 그래서 모든 방문자가 같은 날 같은 글을
  //   보고, 서버 없이도 KST 자정에 저절로 다음 글로 넘어간다.
  // - 상자를 한 번 열면 그날 동안은 열린 상태를 localStorage에 기억한다.
  //   날짜가 바뀌면 키가 어긋나 다시 닫힌 상자로 시작한다.
  // - 카운트다운이 0에 닿으면(자정 통과) 페이지를 한 번 새로고침해 새 글을
  //   받고 상자를 닫힌 상태로 되돌린다.
  //
  // mainPage.js가 DailyGift.create(...)로 요소를 받아 #content 맨 위에 끼운다.
  // 카드 마크업과 성인 태그 필터는 mainPage.js가 콜백으로 넘겨 준다 —
  // 이 파일은 상자/애니메이션/카운트다운/그날의 뽑기만 책임진다.

  var OPENED_KEY = 'chokaguya_dailyGiftOpened';
  var KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  var DAY_MS = 24 * 60 * 60 * 1000;
  var OPEN_ANIM_MS = 520;

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  // 지금 시각을 KST 기준으로 옮긴 Date. getUTC* 로 읽으면 KST의 연/월/일/시가 된다.
  function kstNow() {
    return new Date(Date.now() + KST_OFFSET_MS);
  }

  function kstDateString() {
    var d = kstNow();
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  function msUntilNextKstMidnight() {
    var kstMs = Date.now() + KST_OFFSET_MS;
    var nextMidnight = (Math.floor(kstMs / DAY_MS) + 1) * DAY_MS;
    return nextMidnight - kstMs;
  }

  // FNV-1a 32비트 — 문자열 하나를 안정적인 부호 없는 정수로. 날짜별로 충분히
  // 고르게 흩어지고, 브라우저마다 결과가 같아야 하므로 Math.random을 쓰지 않는다.
  function hashString(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function firstPostId(item) {
    return item && item.posts && item.posts[0] && item.posts[0].id;
  }

  // 후보 목록을 게시글 ID 오름차순으로 고정한 뒤 그날의 인덱스를 뽑는다.
  // 원본 배열 순서가 재빌드로 흔들려도 같은 날 안에서는 같은 글이 유지된다.
  function pickDailyItem(items) {
    var pool = items.slice().sort(function (a, b) {
      return (firstPostId(a) || 0) - (firstPostId(b) || 0);
    });
    if (!pool.length) return null;
    var idx = hashString(kstDateString()) % pool.length;
    return pool[idx];
  }

  function readOpenedDate() {
    try { return localStorage.getItem(OPENED_KEY); } catch (e) { return null; }
  }
  function writeOpenedDate(dateStr) {
    try { localStorage.setItem(OPENED_KEY, dateStr); } catch (e) {}
  }

  function buildShell() {
    var wrap = document.createElement('div');
    wrap.className = 'daily-gift';
    wrap.setAttribute('data-state', 'closed');
    wrap.innerHTML =
      '<button type="button" class="daily-gift-box" aria-label="오늘의 랜덤 문학 열기">' +
        '<span class="daily-gift-lid" aria-hidden="true"></span>' +
        '<span class="daily-gift-ribbon-v" aria-hidden="true"></span>' +
        '<span class="daily-gift-ribbon-h" aria-hidden="true"></span>' +
        '<span class="daily-gift-bow" aria-hidden="true">🎀</span>' +
        '<span class="daily-gift-box-label">오늘의 랜덤 문학</span>' +
        '<span class="daily-gift-box-cta">탭하여 오픈</span>' +
      '</button>' +
      '<div class="daily-gift-reveal" hidden>' +
        '<div class="daily-gift-header">' +
          '<p class="daily-gift-title">🎁 오늘의 랜덤 문학!</p>' +
          '<p class="daily-gift-countdown">다음 문학까지<time class="daily-gift-countdown-time">00:00:00</time></p>' +
        '</div>' +
        '<div class="daily-gift-card-slot"></div>' +
      '</div>';
    return wrap;
  }

  // DailyGift.create({ dataUrl, favType, filterItems, renderCard })
  // - dataUrl: 후보 전체가 담긴 JSON 경로(예: '../data/PageData/Novel.json')
  // - filterItems(items): 성인 태그 등 방문자 설정에 따른 거르기(mainPage 제공)
  // - renderCard(item): 그 글의 카드 DOM을 만들어 돌려주는 함수(mainPage 제공)
  // 후보를 못 받거나 비어 있으면 만든 요소를 스스로 제거한다.
  function create(opts) {
    opts = opts || {};
    var DATA = global.dataUrl || function (p) { return p; };

    var wrap = buildShell();
    var box = wrap.querySelector('.daily-gift-box');
    var reveal = wrap.querySelector('.daily-gift-reveal');
    var slot = wrap.querySelector('.daily-gift-card-slot');
    var timeEl = wrap.querySelector('.daily-gift-countdown-time');

    var countdownTimer = null;
    var rolledOver = false;

    function renderCountdown() {
      var remain = msUntilNextKstMidnight();
      if (remain <= 0) {
        // 자정을 넘겼다 — 새 글과 닫힌 상자를 위해 한 번만 새로고침한다.
        if (rolledOver) return;
        rolledOver = true;
        if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
        global.location.reload();
        return;
      }
      var totalSec = Math.floor(remain / 1000);
      var h = Math.floor(totalSec / 3600);
      var m = Math.floor((totalSec % 3600) / 60);
      var s = totalSec % 60;
      timeEl.textContent = pad2(h) + ':' + pad2(m) + ':' + pad2(s);
    }

    function startCountdown() {
      renderCountdown();
      if (!countdownTimer) countdownTimer = setInterval(renderCountdown, 1000);
    }

    // 백그라운드 탭에서 1초 타이머가 밀렸다 몰아치는 걸 피하려고, 탭이
    // 다시 보이면 즉시 한 번 갱신한다(gridPage.js의 회전 타이머와 같은 기조).
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && countdownTimer) renderCountdown();
    });

    function showReveal(animate) {
      // 오늘 이미 열어 둔 채로 페이지를 다시 연 경우엔 팝인 애니메이션을
      // 생략한다(매 새로고침마다 다시 튀어나오면 거슬린다).
      if (!animate) wrap.classList.add('is-quiet');
      wrap.setAttribute('data-state', 'open');
      reveal.hidden = false;
      startCountdown();
    }

    function openWithAnimation() {
      if (wrap.getAttribute('data-state') !== 'closed') return;
      writeOpenedDate(kstDateString());
      wrap.setAttribute('data-state', 'opening');
      setTimeout(function () {
        box.hidden = true;
        showReveal(true);
      }, OPEN_ANIM_MS);
    }

    box.addEventListener('click', openWithAnimation);

    fetch(DATA(opts.dataUrl))
      .then(function (r) { return r.json(); })
      .then(function (items) {
        items = Array.isArray(items) ? items : [];
        if (typeof opts.filterItems === 'function') items = opts.filterItems(items);
        var item = pickDailyItem(items);
        if (!item) { wrap.remove(); return; }

        var card = opts.renderCard ? opts.renderCard(item) : null;
        if (!card) { wrap.remove(); return; }
        slot.appendChild(card);

        // 오늘 이미 열어 본 방문자는 애니메이션 없이 곧장 열린 상태로.
        // (응답을 기다리는 사이 사용자가 먼저 상자를 눌렀다면 건드리지 않는다.)
        if (wrap.getAttribute('data-state') === 'closed' && readOpenedDate() === kstDateString()) {
          box.hidden = true;
          showReveal(false);
        }
      })
      .catch(function () { wrap.remove(); });

    return wrap;
  }

  global.DailyGift = { create: create };
})(window);
