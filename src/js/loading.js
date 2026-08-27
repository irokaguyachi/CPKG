(function () {
  var tipEl = document.getElementById('loader-tip-text');
  var iconEl = document.getElementById('loader-icon');
  // versioned URL so the browser may cache these normally (see cdnConfig.js)
  var DATA = window.dataUrl || function (p) { return p; };
  var fetchJson = window.fetchJsonCached || function (p) { return fetch(DATA(p)).then(function (r) { return r.json(); }); };

  if (tipEl) {
    fetch(DATA('../data/Tip.json'))
      .then(function (r) { return r.json(); })
      .then(function (tips) {
        if (!Array.isArray(tips) || !tips.length) return;

        // 이 브라우저로 사이트에 처음 들어온 경우에만 첫 팁을 고정 문구로 보여줌
        var FIRST_VISIT_TIP = "Let's go on a trip!";
        var isFirstVisit = !localStorage.getItem('chokaguya_tipVisited');
        if (isFirstVisit) localStorage.setItem('chokaguya_tipVisited', '1');

        // 로딩 화면 하나당 팁 하나 — __loaderShowIcon과 같은 원칙으로, 같은
        // 로딩이 떠 있는 동안 계속 바뀌는 대신 로딩이 새로 발생할 때만 바뀐다.
        var text = isFirstVisit ? FIRST_VISIT_TIP : tips[Math.floor(Math.random() * tips.length)];
        typeText(tipEl, text, 500);
      })
      .catch(function () {});
  }

  if (iconEl) {
    fetchJson('../data/LoadingIcons.json')
      .then(function (files) {
        if (!Array.isArray(files) || !files.length) return;
        // shows one icon per loading occurrence (not a timed cycle); the
        // index is persisted so a real page navigation later also advances
        // it instead of always starting back at the first icon.
        window.__loaderShowIcon = function () {
          var counter = parseInt(localStorage.getItem('loaderIconCounter') || '0', 10);
          var idx = ((counter % files.length) + files.length) % files.length;
          // served from the origin, not R2 (see theme.js's isLocal exception
          // for the same reasoning) — src/offline_src/LoadingLogo/
          var src = '../offline_src/LoadingLogo/' + files[idx];
          iconEl.style.backgroundImage = 'url("' + src + '")';
        };
        window.__loaderShowIcon();
      })
      .catch(function () {});
  }

  function typeText(el, text, durationMs, done) {
    el.textContent = '';
    if (!text) {
      if (done) done();
      return;
    }
    var startTime = performance.now();
    var duration = durationMs || 500;
    function step(now) {
      var elapsed = now - startTime;
      var progress = Math.min(1, elapsed / duration);
      var charCount = Math.floor(progress * text.length);
      el.textContent = text.slice(0, charCount);
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        el.textContent = text;
        if (done) done();
      }
    }
    requestAnimationFrame(step);
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

  // locked nav links (e.g. 번역) have no destination yet — they shake in place
  // to read as a deliberate "not open yet" rejection rather than a dead/broken link
  var lockedLinks = document.querySelectorAll('.header-nav a[data-locked], a[data-locked]');
  for (var k = 0; k < lockedLinks.length; k++) {
    lockedLinks[k].addEventListener('click', function (e) {
      e.preventDefault();
      var el = this;
      el.classList.remove('is-nav-shake');
      void el.offsetWidth;
      el.classList.add('is-nav-shake');
    });
  }

  // Same-page link protection: clicking a link to the current page (e.g. header logo
  // on main page, or "시리즈" link while already on seriesPage) does NOT navigate or reload,
  // preventing unnecessary traffic, loader flashes, and re-fetching data.
  function isSamePage(anchor) {
    if (!anchor) return false;
    var rawHref = anchor.getAttribute('href');
    if (!rawHref || rawHref === '#') return true;
    if (rawHref.startsWith('#')) return false; // in-page anchor

    try {
      var currentUrl = new URL(window.location.href);
      var targetUrl = new URL(anchor.href, window.location.href);

      var currentPath = currentUrl.pathname.replace(/\/+$/, '');
      var targetPath = targetUrl.pathname.replace(/\/+$/, '');

      var currentFile = (currentPath.split('/').pop() || 'mainPage.html').toLowerCase();
      var targetFile = (targetPath.split('/').pop() || 'mainPage.html').toLowerCase();

      if (currentFile === targetFile) {
        if (targetUrl.search === currentUrl.search || (!targetUrl.search && !currentUrl.search)) {
          return true;
        }
      }
    } catch (err) {
      if (anchor.href === window.location.href) return true;
    }
    return false;
  }

  document.addEventListener('click', function (e) {
    var anchor = e.target.closest('a');
    if (!anchor) return;
    if (anchor.hasAttribute('data-locked')) return;
    if (anchor.target && anchor.target !== '_self') return;

    if (isSamePage(anchor)) {
      e.preventDefault();
      if (window.Sidebar && typeof window.Sidebar.close === 'function') {
        window.Sidebar.close();
      }
    }
  });
})();
