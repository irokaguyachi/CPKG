(function (global) {
  'use strict';
  var t = global.I18n.t;

  // 오늘의 랜덤 문학 / 번역 — 메인 페이지 최상단의 선물상자.
  //
  // - 그날의 문학과 번역은 "KST 날짜 문자열(YYYY-MM-DD) + 이 브라우저 고정
  //   시드"를 해시해 각 후보 목록의 인덱스로 뽑는다. 시드는 첫 방문 때 한 번
  //   만들어 localStorage에 저장하므로, 방문자마다 다른 글이 나오면서도 하루
  //   동안은 같은 글이 유지되고 KST 자정에 저절로 다음 글로 넘어간다. 서버는
  //   필요 없다. 시드를 저장 못 하는 환경에서는 매 로드마다 임시 시드를 쓴다.
  // - 상자를 한 번 열면 그날 동안은 열린 상태를 localStorage에 기억한다.
  //   날짜가 바뀌면 키가 어긋나 다시 닫힌 상자로 시작한다.
  // - 카운트다운이 0에 닿으면(자정 통과) 페이지를 한 번 새로고침해 새 글을
  //   받고 상자를 닫힌 상태로 되돌린다.
  //
  // mainPage.js가 DailyGift.create(...)로 요소를 받아 #content 맨 위에 끼운다.
  // 카드 마크업과 성인 태그 필터는 mainPage.js가 콜백으로 넘겨 준다 —
  // 이 파일은 상자/애니메이션/카운트다운/그날의 뽑기만 책임진다.

  var OPENED_KEY = 'chokaguya_dailyGiftOpened';
  var SEED_KEY = 'chokaguya_dailyGiftSeed';
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

  // 후보 목록을 게시글 ID 오름차순으로 고정한 뒤 "날짜 + 브라우저 시드"로
  // 그날의 인덱스를 뽑는다. 원본 배열 순서가 재빌드로 흔들려도 같은 날
  // 안에서는 같은 글이 유지되고, 시드가 방문자마다 달라 글도 갈린다.
  function pickDailyItem(items) {
    var pool = items.slice().sort(function (a, b) {
      return (firstPostId(a) || 0) - (firstPostId(b) || 0);
    });
    if (!pool.length) return null;
    var idx = hashString(kstDateString() + ':' + getUserSeed()) % pool.length;
    return pool[idx];
  }

  // 이 브라우저만의 고정 시드(16진수 16자). 첫 호출 때 만들어 저장하고
  // 이후로는 그대로 재사용한다 — 이게 있어야 그날의 글이 방문자마다 갈린다.
  // presence.js의 세션 ID 생성과 같은 관용구.
  function getUserSeed() {
    try {
      var saved = localStorage.getItem(SEED_KEY);
      if (saved && /^[a-f0-9]{16}$/.test(saved)) return saved;
      var buf = new Uint8Array(8);
      crypto.getRandomValues(buf);
      var hex = '';
      for (var i = 0; i < buf.length; i++) hex += buf[i].toString(16).padStart(2, '0');
      localStorage.setItem(SEED_KEY, hex);
      return hex;
    } catch (e) {
      // localStorage나 crypto를 못 쓰는 환경 — 이번 로드에서만 쓰는 임시 시드.
      return String(Math.random()).slice(2) + String(Math.random()).slice(2);
    }
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
      '<button type="button" class="daily-gift-box" aria-label="' + t('오늘의 랜덤 문학 / 번역 열기') + '">' +
        '<span class="daily-gift-lid" aria-hidden="true"></span>' +
        '<span class="daily-gift-ribbon-v" aria-hidden="true"></span>' +
        '<span class="daily-gift-ribbon-h" aria-hidden="true"></span>' +
        '<span class="daily-gift-bow" aria-hidden="true">🎀</span>' +
        '<span class="daily-gift-box-label">' + t('오늘의 랜덤 문학 / 번역') + '</span>' +
        '<span class="daily-gift-box-cta">' + t('탭하여 오픈') + '</span>' +
      '</button>' +
      '<div class="daily-gift-reveal" hidden>' +
        '<div class="daily-gift-header">' +
          '<p class="daily-gift-title">' + t('🎁 오늘의 랜덤 문학 / 번역!') + '</p>' +
          '<p class="daily-gift-countdown">' + t('다음 문학 / 번역까지') + '<time class="daily-gift-countdown-time">00:00:00</time></p>' +
        '</div>' +
        '<div class="daily-gift-card-slot"></div>' +
      '</div>';
    return wrap;
  }

  // DailyGift.create({ dataUrl, favType, secondaryDataUrl, secondaryFavType,
  //                    filterItems, renderCard })
  // - dataUrl: 후보 전체가 담긴 JSON 경로(예: '../data/pageData/Novel.json')
  // - filterItems(items): 성인 태그 등 방문자 설정에 따른 거르기(mainPage 제공)
  // - secondaryDataUrl/secondaryFavType: 두 번째 후보(현재는 번역) 설정.
  // - renderCard(item, favType): 글의 카드 DOM을 만들어 돌려준다(mainPage 제공).
  // 두 후보를 모두 못 받거나 비어 있으면 만든 요소를 스스로 제거한다.
  function create(opts) {
    opts = opts || {};
    var DATA = global.dataUrl || function (p) { return p; };
    var fetchJson = global.fetchJsonCached || function (url) {
      return fetch(DATA(url)).then(function (r) {
        if (!r.ok) throw new Error('Daily gift data request failed: ' + r.status);
        return r.json();
      });
    };

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

    function loadItems(url) {
      if (!url) return Promise.resolve([]);
      return fetchJson(url)
        .then(function (items) { return Array.isArray(items) ? items : []; })
        .catch(function () { return []; });
    }

    function appendCard(item, favType, labelText) {
      if (!item || !opts.renderCard) return false;
      var card = opts.renderCard(item, favType);
      if (!card) return false;
      var label = document.createElement('p');
      label.className = 'daily-gift-card-label';
      label.textContent = labelText;
      slot.appendChild(label);
      slot.appendChild(card);
      return true;
    }

    Promise.all([loadItems(opts.dataUrl), loadItems(opts.secondaryDataUrl)])
      .then(function (results) {
        var items = results[0];
        var secondaryItems = results[1];
        if (typeof opts.filterItems === 'function') items = opts.filterItems(items);
        if (typeof opts.secondaryFilterItems === 'function') {
          secondaryItems = opts.secondaryFilterItems(secondaryItems);
        } else if (typeof opts.filterItems === 'function') {
          secondaryItems = opts.filterItems(secondaryItems);
        }

        var item = pickDailyItem(items);
        var secondaryItem = pickDailyItem(secondaryItems);
        var rendered = 0;
        rendered += appendCard(item, opts.favType, opts.primaryLabel || t('오늘의 문학')) ? 1 : 0;
        rendered += appendCard(secondaryItem, opts.secondaryFavType, opts.secondaryLabel || t('오늘의 번역')) ? 1 : 0;
        if (!rendered) { wrap.remove(); return; }

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
