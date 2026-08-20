(function () {
  var tipEl = document.getElementById('loader-tip-text');
  var iconEl = document.getElementById('loader-icon');
  // versioned URL so the browser may cache these normally (see cdnConfig.js)
  var DATA = window.dataUrl || function (p) { return p; };

  if (tipEl) {
    fetch(DATA('../data/Tip.json'))
      .then(function (r) { return r.json(); })
      .then(function (tips) {
        if (!Array.isArray(tips) || !tips.length) return;
        var order = shuffle(tips.slice());
        var idx = 0;
        function cycle() {
          if (idx >= order.length) { order = shuffle(tips.slice()); idx = 0; }
          var text = order[idx];
          idx++;
          typeText(tipEl, text, 45, function () {
            setTimeout(cycle, 2200);
          });
        }
        cycle();
      })
      .catch(function () {});
  }

  if (iconEl) {
    fetch(DATA('../data/LoadingIcons.json'))
      .then(function (r) { return r.json(); })
      .then(function (files) {
        if (!Array.isArray(files) || !files.length) return;
        // shows one icon per loading occurrence (not a timed cycle); the
        // index is persisted so a real page navigation later also advances
        // it instead of always starting back at the first icon.
        window.__loaderShowIcon = function () {
          var counter = parseInt(localStorage.getItem('loaderIconCounter') || '0', 10);
          var idx = ((counter % files.length) + files.length) % files.length;
          var rawSrc = '../assets/Image/LoadingIcon/' + files[idx];
          var src = window.resolveAssetUrl ? window.resolveAssetUrl(rawSrc) : rawSrc;
          iconEl.style.backgroundImage = 'url("' + src + '")';
        };
        window.__loaderShowIcon();
      })
      .catch(function () {});
  }

  function typeText(el, text, speed, done) {
    el.textContent = '';
    var i = 0;
    var timer = setInterval(function () {
      el.textContent += text.charAt(i);
      i++;
      if (i >= text.length) {
        clearInterval(timer);
        if (done) done();
      }
    }, speed);
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }
})();

(function () {
  var wipeEl = document.getElementById('loader-wipe');
  var contentEl = document.getElementById('loader-content');
  var loaderEl = document.getElementById('loader');
  if (!wipeEl || !loaderEl) return;

  var INTRO_MS = 1300;
  var OUTRO_MS = 2200;

  // 로더가 화면을 덮고 있는 동안은 그 뒤의 실제 페이지가 스크롤되지 않게 막음
  // — 안 막으면 로더가 안 보이는 사이에 그리드가 이미 스크롤된 채로 드러남
  function lockScroll() {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }
  function unlockScroll() {
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }

  // intro: white circle covers the screen, then shrinks away to nothing
  // while the content fades in at the same time, so the two blend together
  // instead of one waiting for the other to finish.
  function playIntro() {
    var counter = parseInt(localStorage.getItem('loaderIconCounter') || '0', 10) + 1;
    localStorage.setItem('loaderIconCounter', counter);
    if (window.__loaderShowIcon) window.__loaderShowIcon();

    wipeEl.style.transitionDuration = INTRO_MS + 'ms, ' + INTRO_MS + 'ms, ' + INTRO_MS + 'ms';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        wipeEl.classList.remove('is-covering');
        if (contentEl) contentEl.classList.add('is-visible');
      });
    });
  }

  // outro: the circle grows back to cover the screen while the content
  // fades out. The circle keeps growing at the same OUTRO_MS pace (it's
  // sized to 300vmax so it stays big enough to cover any screen for a
  // while yet), but visually it's already covering the viewport well
  // before that full duration elapses — so the real page underneath is
  // revealed as soon as it looks fully covered instead of waiting out
  // the rest of the oversized transition.
  var OUTRO_REVEAL_MS = 700;
  window.finishLoading = function () {
    if (contentEl) contentEl.classList.remove('is-visible');
    wipeEl.style.transitionDuration = OUTRO_MS + 'ms, ' + OUTRO_MS + 'ms, ' + OUTRO_MS + 'ms';
    wipeEl.classList.add('is-covering');
    setTimeout(function () {
      loaderEl.classList.add('is-hidden');
      unlockScroll();
    }, OUTRO_REVEAL_MS);
  };

  // the wipe only plays on a genuine fresh entry into the page (e.g.
  // clicking a nav link in from another page). A refresh or a browser
  // back/forward return skips straight to the page — no wipe, no flash.
  function isFreshEntry() {
    try {
      var nav = performance.getEntriesByType('navigation')[0];
      if (nav) return nav.type === 'navigate';
      if (performance.navigation) return performance.navigation.type === 0;
    } catch (e) {}
    return true;
  }

  if (!isFreshEntry()) {
    loaderEl.style.display = 'none';
  } else {
    lockScroll();
    playIntro();

    // hold the loader for at least MIN_VISIBLE_MS so it doesn't just flash,
    // but finish as soon as the real page has actually loaded.
    var MIN_VISIBLE_MS = 1500;
    var startedAt = Date.now();
    function ready() {
      var wait = Math.max(0, MIN_VISIBLE_MS - (Date.now() - startedAt));
      setTimeout(window.finishLoading, wait);
    }
    if (document.readyState === 'complete') {
      ready();
    } else {
      window.addEventListener('load', ready);
    }
  }

  // demo: nav links without a real destination yet just replay the loading
  // transition to preview how a page change will feel. links that do have a
  // real href (e.g. 시리즈 → seriesPage.html) are left alone to navigate
  // normally — the loader replays anyway on the destination page's own load.
  var DEMO_HOLD_MS = 1600;
  var navLinks = document.querySelectorAll('.header-nav a');
  var demoRunning = false;
  for (var i = 0; i < navLinks.length; i++) {
    navLinks[i].addEventListener('click', function (e) {
      if (this.getAttribute('href') !== '#' || this.hasAttribute('data-locked')) return;
      e.preventDefault();
      if (demoRunning) return;
      demoRunning = true;
      loaderEl.classList.remove('is-hidden');
      lockScroll();
      playIntro();
      setTimeout(function () {
        window.finishLoading();
        setTimeout(function () { demoRunning = false; }, OUTRO_MS);
      }, INTRO_MS + DEMO_HOLD_MS);
    });
  }

  // locked nav links (e.g. 번역) have no destination yet — instead of the
  // loading-replay demo, they shake in place to read as a deliberate
  // "not open yet" rejection rather than a dead/broken link
  var lockedLinks = document.querySelectorAll('.header-nav a[data-locked]');
  for (var k = 0; k < lockedLinks.length; k++) {
    lockedLinks[k].addEventListener('click', function (e) {
      e.preventDefault();
      var el = this;
      el.classList.remove('is-nav-shake');
      void el.offsetWidth;
      el.classList.add('is-nav-shake');
    });
  }
})();
