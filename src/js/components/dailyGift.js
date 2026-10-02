(function (global) {
  'use strict';
  var t = global.I18n.t;

  // 오늘의 랜덤 문학 / 번역 — 메인 페이지 상단, 공지 보드 바로 아래의 위젯.
  //
  // - 그날의 문학과 번역은 "KST 날짜 문자열(YYYY-MM-DD) + 이 브라우저 고정
  //   시드"를 해시해 각 후보 목록의 인덱스로 뽑는다. 시드는 첫 방문 때 한 번
  //   만들어 localStorage에 저장하므로, 방문자마다 다른 글이 나오면서도 하루
  //   동안은 같은 글이 유지되고 KST 자정에 저절로 다음 글로 넘어간다. 서버는
  //   필요 없다. 시드를 저장 못 하는 환경에서는 매 로드마다 임시 시드를 쓴다.
  // - 처음엔 썸네일이 흐리고 제목이 가려진 닫힌 상태다. 한 번 열면 그날
  //   동안은 열린 상태를 localStorage에 기억한다. 날짜가 바뀌면 키가 어긋나
  //   다시 닫힌 상태로 시작한다.
  // - 카운트다운이 0에 닿으면(자정 통과) 페이지를 한 번 새로고침해 새 글을
  //   받고 닫힌 상태로 되돌린다.
  //
  // mainPage.js가 DailyGift.create(...)로 요소를 받아 #content 위쪽에 끼운다.
  // 성인 태그 필터, 분량 글자, 상세 모달 열기는 mainPage.js가 콜백으로 넘겨
  // 준다 — 이 파일은 위젯 마크업/열기/카운트다운/그날의 뽑기를 책임진다.

  var OPENED_KEY = 'chokaguya_dailyGiftOpened';
  var SEED_KEY = 'chokaguya_dailyGiftSeed';
  var KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  var DAY_MS = 24 * 60 * 60 * 1000;
  
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

  var KIND_LABEL = {
    primary: { emoji: '📖', cls: '' },
    secondary: { emoji: '🌐', cls: ' is-translation' }
  };

  // 메인 상단 공지 보드(main-page.css .notice-board)와 같은 2단 그리드.
  // 왼쪽 카드엔 그날의 두 글을 썸네일 행으로, 오른쪽 카드엔 카운트다운과
  // 버튼을 둔다. 닫힌 상태에선 썸네일을 흐리고 제목 자리를 막대로 가린 채
  // 오른쪽 버튼만 "오늘의 글 열기"로 둔다 — 행 자체도 눌러서 열 수 있다.
  function buildShell() {
    var wrap = document.createElement('div');
    wrap.className = 'daily-gift';
    wrap.setAttribute('data-state', 'closed');
    wrap.innerHTML =
      '<section class="daily-gift-card daily-gift-picks">' +
        '<p class="daily-gift-title">' + t('오늘의 랜덤 문학 / 번역') + '</p>' +
        '<ul class="daily-gift-rows"></ul>' +
      '</section>' +
      '<section class="daily-gift-card daily-gift-side">' +
        '<div class="daily-gift-side-top">' +
          '<span class="daily-gift-side-thumb" aria-hidden="true">🎁</span>' +
          '<div class="daily-gift-side-heading">' +
            '<p class="daily-gift-eyebrow">DAILY</p>' +
            '<p class="daily-gift-side-title daily-gift-when-closed">' + t('오늘의 선물 도착!') + '</p>' +
            '<p class="daily-gift-side-title daily-gift-when-open">' + t('다음 뽑기까지') + '</p>' +
          '</div>' +
        '</div>' +
        '<time class="daily-gift-clock daily-gift-when-open">00:00:00</time>' +
        '<p class="daily-gift-side-desc daily-gift-when-closed">' + t('하루 한 번, 나에게만 뽑힌 문학과 번역이 기다리고 있어요. 열어보기 전엔 아무도 몰라요.') + '</p>' +
        '<p class="daily-gift-side-desc daily-gift-when-open">' + t('매일 자정(KST)에 새로운 문학과 번역이 한 편씩 뽑혀요.') + '</p>' +
        '<button type="button" class="daily-gift-cta daily-gift-open-btn daily-gift-when-closed">' + t('🎁 오늘의 글 열기') + '</button>' +
        '<button type="button" class="daily-gift-cta is-ghost daily-gift-roulette-btn daily-gift-when-open">' + t('🎲 룰렛으로 더 뽑아보기') + '</button>' +
      '</section>';
    return wrap;
  }

  // 글이 도착하기 전에도 자리가 잡혀 있도록 종류 알약과 가림막만 있는 행을
  // 먼저 만든다. fillRow()가 글을 받아 썸네일·제목·태그·버튼을 채운다.
  function buildRow(kind, labelText) {
    var li = document.createElement('li');
    li.innerHTML =
      '<div class="daily-gift-row" role="button" tabindex="0">' +
        '<div class="daily-gift-thumb">' +
          '<div class="daily-gift-thumb-img"></div>' +
          '<span class="daily-gift-thumb-q" aria-hidden="true">?</span>' +
        '</div>' +
        '<div class="daily-gift-info">' +
          '<div class="daily-gift-line">' +
            '<span class="daily-gift-kind' + KIND_LABEL[kind].cls + '"></span>' +
            '<span class="daily-gift-name"></span>' +
            '<span class="daily-gift-id"></span>' +
          '</div>' +
          '<div class="daily-gift-tags"></div>' +
          '<span class="daily-gift-mask" aria-hidden="true"></span>' +
          '<span class="daily-gift-mask is-short" aria-hidden="true"></span>' +
        '</div>' +
        '<span class="daily-gift-count"></span>' +
        '<div class="daily-gift-actions card-inline-actions"></div>' +
      '</div>';
    li.querySelector('.daily-gift-kind').textContent = KIND_LABEL[kind].emoji + ' ' + labelText;
    return li;
  }

  function fillRow(li, item, favType, opts) {
    var TagConfig = global.TagConfig || {};
    var row = li.querySelector('.daily-gift-row');
    var img = li.querySelector('.daily-gift-thumb-img');
    if (item.image) {
      if (global.lazyLoadBackground) {
        global.lazyLoadBackground(img, item.image);
      } else {
        var finalImg = global.resolveThumbUrl ? global.resolveThumbUrl(item.image) : item.image;
        img.style.backgroundImage = 'url("' + finalImg + '")';
      }
    } else if (TagConfig.applyTextCover) {
      // 썸네일이 작아 제목은 옆 정보 칸에만 두고, 표지엔 색과 이모지만 깐다.
      TagConfig.applyTextCover(img, { name: item.name, author: item.author, tags: item.tags, text: false });
    }

    li.querySelector('.daily-gift-name').textContent = item.name || t('제목 없음');
    var favId = item.posts && item.posts[0] && item.posts[0].id;
    if (favId != null) li.querySelector('.daily-gift-id').textContent = '| ' + favId;

    var tagsWrap = li.querySelector('.daily-gift-tags');
    var tags = TagConfig.sortTags ? TagConfig.sortTags(item.tags) : (item.tags || []);
    (tags || []).slice(0, 3).forEach(function (tag) {
      var pill = document.createElement('span');
      pill.className = 'series-card-tag';
      pill.dataset.tag = tag;
      pill.textContent = ((TagConfig.TAG_EMOJI && TagConfig.TAG_EMOJI[tag]) || TagConfig.DEFAULT_EMOJI || '') + ' ' + tag;
      tagsWrap.appendChild(pill);
    });

    if (opts.countLabel) li.querySelector('.daily-gift-count').textContent = opts.countLabel(item);

    var actions = li.querySelector('.daily-gift-actions');
    if (favId != null && global.BumpButton) actions.appendChild(global.BumpButton.createButton(favType, favId, item.name));
    if (favId != null && global.BookmarkPicker) actions.appendChild(global.BookmarkPicker.createButton(favType, favId));

    row.classList.add('is-filled');
    row._dailyItem = item;
    row._dailyFavType = favType;
  }

  // DailyGift.create({ dataUrl, favType, secondaryDataUrl, secondaryFavType,
  //                    primaryLabel, secondaryLabel, filterItems,
  //                    countLabel, openItem })
  // - dataUrl: 후보 전체가 담긴 JSON 경로(예: '../data/pageData/Novel.json')
  // - filterItems(items): 성인 태그 등 방문자 설정에 따른 거르기(mainPage 제공)
  // - secondaryDataUrl/secondaryFavType: 두 번째 후보(현재는 번역) 설정.
  // - countLabel(item): 행 오른쪽의 분량 글자(예: '244자', '3화'). mainPage 제공
  // - openItem(item, favType): 행을 눌렀을 때 상세 모달을 연다. mainPage 제공
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
    var rowsEl = wrap.querySelector('.daily-gift-rows');
    var timeEl = wrap.querySelector('.daily-gift-clock');
    var rouletteBtn = wrap.querySelector('.daily-gift-roulette-btn');

    var primaryRow = buildRow('primary', opts.primaryLabel || t('오늘의 문학'));
    var secondaryRow = buildRow('secondary', opts.secondaryLabel || t('오늘의 번역'));
    rowsEl.appendChild(primaryRow);
    rowsEl.appendChild(secondaryRow);

    var countdownTimer = null;
    var rolledOver = false;

    function renderCountdown() {
      var remain = msUntilNextKstMidnight();
      if (remain <= 0) {
        // 자정을 넘겼다 — 새 글과 닫힌 상태를 위해 한 번만 새로고침한다.
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

    // animate=false 는 오늘 이미 열어 둔 채로 페이지를 다시 연 경우 —
    // 매 새로고침마다 흐림이 풀리는 연출이 반복되면 거슬리므로 생략한다.
    function open(animate) {
      if (wrap.getAttribute('data-state') === 'open') return;
      if (!animate) wrap.classList.add('is-quiet');
      else writeOpenedDate(kstDateString());
      wrap.setAttribute('data-state', 'open');
      startCountdown();
    }

    wrap.querySelector('.daily-gift-open-btn').addEventListener('click', function () { open(true); });

    // 룰렛이 없는 페이지에서는 버튼을 숨긴다. rouletteModal.js 는 mainPage.js
    // 보다 뒤에 defer 로 실리므로, defer 스크립트가 모두 돈 뒤에 한 번 더 본다.
    function syncRouletteBtn() { rouletteBtn.hidden = !global.RouletteModal; }
    syncRouletteBtn();
    document.addEventListener('DOMContentLoaded', syncRouletteBtn);
    rouletteBtn.addEventListener('click', function () {
      if (global.RouletteModal) global.RouletteModal.open();
    });

    // 닫힌 상태에서 행을 누르면 먼저 연다. 열린 뒤에는 상세 모달을 띄운다.
    function activateRow(row) {
      if (wrap.getAttribute('data-state') !== 'open') { open(true); return; }
      if (row._dailyItem && opts.openItem) opts.openItem(row._dailyItem, row._dailyFavType);
    }
    rowsEl.addEventListener('click', function (e) {
      if (e.target.closest('.card-inline-actions')) return;
      var row = e.target.closest('.daily-gift-row');
      if (row) activateRow(row);
    });
    rowsEl.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var row = e.target.closest('.daily-gift-row');
      if (!row || e.target !== row) return;
      e.preventDefault();
      activateRow(row);
    });

    if (readOpenedDate() === kstDateString()) open(false);

    function loadItems(url) {
      if (!url) return Promise.resolve([]);
      return fetchJson(url)
        .then(function (items) { return Array.isArray(items) ? items : []; })
        .catch(function () { return []; });
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
        if (item) fillRow(primaryRow, item, opts.favType, opts); else primaryRow.remove();
        if (secondaryItem) fillRow(secondaryRow, secondaryItem, opts.secondaryFavType, opts); else secondaryRow.remove();
        if (!item && !secondaryItem) wrap.remove();
      })
      .catch(function () { wrap.remove(); });

    return wrap;
  }

  global.DailyGift = { create: create };
})(window);
