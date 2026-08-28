(function () {
  'use strict';

  // Local-only easter egg. Click the locked "번역" nav link — cumulative
  // clicks (persisted in localStorage) hit five milestones, each popping
  // Yachiyo (src/offline_src/ForEvent/yachiyo.png — not part of the deploy
  // pipeline) in from the side with one of the dialogue1..dialogue5 arrays
  // from src/data/ForEvent/YachiyoDialogue.json. A full-page overlay blocks
  // every other click on the site for as long as she's on screen; lines
  // type out one character at a time, and clicking either finishes the
  // current line instantly or advances to the next one. At the last
  // milestone (168), once her final line finishes typing, a button slides
  // in next to her linking to the KakaoTalk open chat, and clicking past
  // that point does nothing (just a bounce) until she's actually clicked
  // through to Kakao. The counter resets to 0 after the 168 milestone so
  // the whole 30/60/90/120/168 sequence can play out again. A small
  // source-credit badge/link sits over the art the whole time she's on
  // screen (always visible, not click-gated).
  var STORAGE_KEY = 'yachiyoEventClicks';
  var DIALOGUE_URL = '../data/ForEvent/YachiyoDialogue.json';
  var FALLBACK_LINES = ['...?'];
  var TYPE_MS = 40;
  var KAKAO_URL = 'https://open.kakao.com/o/s8KC6pKi';
  // 야치요 그림 출처 — showYachiyo()가 그림 위에 항상 이 링크를 띄운다.
  var IMAGE_SOURCE_URL = 'https://x.com/TERURU_sakura/status/2057038861575008490?s=20';
  var IMAGE_SOURCE_LABEL = '출처: X(@TERURU_sakura)';

  var MILESTONES = [
    { count: 30, key: 'dialogue1' },
    { count: 60, key: 'dialogue2' },
    { count: 90, key: 'dialogue3' },
    { count: 120, key: 'dialogue4' },
    { count: 168, key: 'dialogue5', isFinal: true }
  ];

  // fetched once and cached; src/data/ForEvent/YachiyoDialogue.json holds
  // dialogue1..dialogue5 — edit that file to change lines per milestone
  var dialoguePromise = fetch(DIALOGUE_URL)
    .then(function (res) { return res.json(); })
    .catch(function () { return {}; });

  function linesFor(data, key) {
    var lines = (data && data[key] || []).filter(function (l) {
      return l && l.trim();
    });
    return lines.length ? lines : FALLBACK_LINES;
  }

  function getCount() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    var n = parseInt(raw, 10);
    return isNaN(n) ? 0 : n;
  }

  function setCount(n) {
    try { localStorage.setItem(STORAGE_KEY, String(n)); } catch (e) {}
  }

  function showYachiyo(lines, isFinal) {
    if (document.querySelector('.yachiyo-event')) return;

    var blocker = document.createElement('div');
    blocker.className = 'yachiyo-event-block';

    var wrap = document.createElement('div');
    wrap.className = 'yachiyo-event';
    wrap.innerHTML =
      '<div class="yachiyo-event-bubble"></div>' +
      '<div class="yachiyo-event-img-wrap">' +
        '<img class="yachiyo-event-img" src="../offline_src/ForEvent/yachiyo.png" alt="야치요" />' +
        '<a class="yachiyo-event-credit" href="' + IMAGE_SOURCE_URL + '" target="_blank" rel="noopener noreferrer">' + IMAGE_SOURCE_LABEL + '</a>' +
      '</div>';
    var bubble = wrap.querySelector('.yachiyo-event-bubble');
    var img = wrap.querySelector('.yachiyo-event-img');

    document.body.appendChild(blocker);
    document.body.appendChild(wrap);

    var ready = false;
    var isTyping = false;
    var typingTimer = null;
    var lineIndex = 0;
    var kakaoJoined = false;

    function bounce() {
      img.classList.remove('is-talking');
      void img.offsetWidth;
      img.classList.add('is-talking');
    }

    function showJoinButton() {
      if (wrap.querySelector('.yachiyo-event-cta')) return;
      var cta = document.createElement('div');
      cta.className = 'yachiyo-event-cta';
      cta.innerHTML =
        '<a href="' + KAKAO_URL + '" target="_blank" rel="noopener noreferrer">오픈채팅 참여하기</a>';
      cta.querySelector('a').addEventListener('click', function () {
        kakaoJoined = true;
      });
      wrap.insertBefore(cta, bubble);
      void cta.offsetWidth;
      cta.classList.add('is-in');
    }

    function typeLine(text, onComplete) {
      bubble.classList.add('is-visible');
      bubble.textContent = '';
      isTyping = true;
      var i = 0;
      // clearInterval only stops future ticks — a tick already queued (e.g.
      // the tab was backgrounded and timers piled up) still fires. Tag this
      // run so a stale tick from a since-completed/replaced line no-ops
      // instead of corrupting isTyping/bubble text after the fact.
      var myTimer = setInterval(function () {
        if (typingTimer !== myTimer) return;
        i += 1;
        bubble.textContent = text.slice(0, i);
        if (i >= text.length) {
          clearInterval(myTimer);
          typingTimer = null;
          isTyping = false;
          if (onComplete) onComplete();
        }
      }, TYPE_MS);
      typingTimer = myTimer;
    }

    function completeTyping(onComplete) {
      clearInterval(typingTimer);
      typingTimer = null;
      bubble.textContent = lines[lineIndex];
      isTyping = false;
      if (onComplete) onComplete();
    }

    function showLine(i) {
      bounce();
      var isLastLine = i === lines.length - 1;
      typeLine(lines[i], function () {
        if (isFinal && isLastLine) showJoinButton();
      });
    }

    function dismiss() {
      ready = false;
      blocker.classList.remove('is-ready');
      wrap.classList.remove('is-in');
      wrap.classList.add('is-out');
      wrap.addEventListener('transitionend', function () {
        wrap.remove();
        blocker.remove();
      }, { once: true });
    }

    blocker.addEventListener('click', function () {
      if (!ready) return;
      if (isTyping) {
        var isLastLine = lineIndex === lines.length - 1;
        completeTyping(function () {
          if (isFinal && isLastLine) showJoinButton();
        });
        return;
      }
      var atLastLine = lineIndex === lines.length - 1;
      if (atLastLine) {
        if (isFinal && !kakaoJoined) {
          bounce(); // nudge: won't close until she's actually joined
          return;
        }
        dismiss();
        return;
      }
      lineIndex += 1;
      showLine(lineIndex);
    });

    // force layout so the initial (offscreen) transform is committed before
    // the "is-in" class flips it, otherwise the transition gets skipped
    void wrap.offsetWidth;
    wrap.classList.add('is-in');

    wrap.addEventListener('transitionend', function () {
      ready = true;
      blocker.classList.add('is-ready');
      showLine(lineIndex);
    }, { once: true });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var links = document.querySelectorAll('a[data-locked]');
    for (var i = 0; i < links.length; i++) {
      links[i].addEventListener('click', function () {
        var count = getCount() + 1;
        var milestone = null;
        for (var m = 0; m < MILESTONES.length; m++) {
          if (MILESTONES[m].count === count) { milestone = MILESTONES[m]; break; }
        }
        if (!milestone) {
          setCount(count);
          return;
        }
        setCount(milestone.isFinal ? 0 : count);
        dialoguePromise.then(function (data) {
          showYachiyo(linesFor(data, milestone.key), !!milestone.isFinal);
        });
      });
    }
  });
})();
