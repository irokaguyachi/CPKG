(function () {
  var tipEl = document.getElementById('loader-tip-text');
  // versioned URL so the browser may cache these normally (see cdnConfig.js)
  var DATA = window.dataUrl || function (p) { return p; };

  if (tipEl) {
    fetch(DATA('../data/config/Tip.json'))
      .then(function (r) { return r.json(); })
      .then(function (tips) {
        if (!Array.isArray(tips) || !tips.length) return;

        // 이 브라우저로 사이트에 처음 들어온 경우에만 첫 팁을 고정 문구로 보여줌
        var FIRST_VISIT_TIP = "Let's go on a trip!";
        var isFirstVisit = !localStorage.getItem('chokaguya_tipVisited');
        if (isFirstVisit) localStorage.setItem('chokaguya_tipVisited', '1');

        // 로딩 화면 하나당 팁 하나 — 같은 로딩이 떠 있는 동안 계속 바뀌는
        // 대신 로딩이 새로 발생할 때만 바뀐다.
        var text = isFirstVisit ? FIRST_VISIT_TIP : tips[Math.floor(Math.random() * tips.length)];
        typeText(tipEl, text, 500);
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
  var iconEl = document.getElementById('loader-icon');
  if (!wipeEl || !loaderEl) return;

  // 전체 화면 로더 아이콘은 미러볼(mirrorBall.js)이다. 후시 GIF(LoadingIcons.json)는
  // 미니 로딩(gridPage.js)에서만 쓴다. 로더가 실제로 뜰 때만 그리기 시작하고,
  // 로더가 걷히면 멈춰서 뒤의 페이지가 쓸 프레임을 빼앗지 않는다.
  var ball = null;
  function startBall() {
    if (ball || !iconEl || !window.MirrorBall) return;
    var canvas = document.createElement('canvas');
    canvas.className = 'loader-ball';
    iconEl.appendChild(canvas);
    ball = window.MirrorBall.mount(canvas);
  }
  function stopBall() {
    if (ball) ball.stop();
  }

  var INTRO_MS = 1300;
  var OUTRO_MS = 2200;

  // ---------------------------------------------------------------------
  // 페이지별 준비 작업 게이트
  // 페이지가 자기 데이터(예: 오디오 노벨 본문 .md, 오디오 메타)를 다 불러올
  // 때까지 로더를 붙잡아두고, 로더가 완전히 걷힌 뒤에야 "시작해도 되는" 동작
  // (자동 재생 등)을 실행시키기 위한 장치.
  //   registerLoadingTask(promise) — 이 작업이 끝나야 로더가 걷힌다
  //   whenLoadingFinished(cb)      — 로더가 걷힌(또는 애초에 안 뜬) 뒤 실행
  // ---------------------------------------------------------------------
  var pendingTasks = [];
  var loadingFinished = false;
  var finishCallbacks = [];
  var MAX_TASK_WAIT_MS = 10000; // 네트워크가 죽어도 로더가 영원히 남지 않도록

  window.registerLoadingTask = function (promise) {
    if (!promise || typeof promise.then !== 'function') return promise;
    // 실패해도 로더는 걷혀야 하므로 거부를 여기서 흡수한다
    pendingTasks.push(promise.then(null, function () {}));
    return promise;
  };

  window.whenLoadingFinished = function (cb) {
    if (typeof cb !== 'function') return;
    if (loadingFinished) cb();
    else finishCallbacks.push(cb);
  };

  function markLoadingFinished() {
    if (loadingFinished) return;
    loadingFinished = true;
    var cbs = finishCallbacks.splice(0, finishCallbacks.length);
    cbs.forEach(function (cb) {
      try { cb(); } catch (e) {}
    });
  }

  // 대기 중 새 작업이 추가될 수 있으므로(예: 본문을 받은 뒤 이미지 프리로드)
  // 목록이 더 이상 늘지 않을 때까지 반복해서 기다린다.
  function waitForTasks() {
    var snapshot = pendingTasks.slice();
    return Promise.all(snapshot).then(function () {
      if (pendingTasks.length !== snapshot.length) return waitForTasks();
    });
  }

  // ---------------------------------------------------------------------
  // 로더 붙잡기 (holdLoader)
  // registerLoadingTask와 달리 10초 상한이 없고, 이미 퇴장 연출에 들어간
  // 로더를 되돌리지도 않는다. 로딩 화면 위에서 사용자 조작을 기다려야 하는
  // 경우(pageView.js의 Turnstile 사람 확인)에 쓴다 — 시간 상한은 붙잡는
  // 쪽이 자기 프라미스 안에서 직접 건다.
  //   holdLoader(promise) — 로더가 아직 떠 있으면 true, 이미 없으면 false
  // ---------------------------------------------------------------------
  var holds = [];
  var outroStarted = false;

  window.holdLoader = function (promise) {
    if (outroStarted || loadingFinished || loaderEl.style.display === 'none') return false;
    holds.push(Promise.resolve(promise).then(null, function () {}));
    return true;
  };

  function waitForHolds() {
    var snapshot = holds.slice();
    return Promise.all(snapshot).then(function () {
      if (holds.length !== snapshot.length) return waitForHolds();
    });
  }

  function waitForTasksCapped() {
    return Promise.race([
      waitForTasks(),
      new Promise(function (resolve) { setTimeout(resolve, MAX_TASK_WAIT_MS); })
    ]);
  }

  // 준비 작업은 DOMContentLoaded 시점의 인라인 스크립트에서 등록되므로,
  // 목록을 확인하기 전에 최소한 load 이후까지는 기다려야 한다.
  function afterPageLoad(fn) {
    if (document.readyState === 'complete') setTimeout(fn, 0);
    else window.addEventListener('load', fn);
  }

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
    startBall();

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
    waitForHolds().then(function () {
      if (outroStarted) return;
      outroStarted = true;
      if (contentEl) contentEl.classList.remove('is-visible');
      wipeEl.style.transitionDuration = OUTRO_MS + 'ms, ' + OUTRO_MS + 'ms, ' + OUTRO_MS + 'ms';
      wipeEl.classList.add('is-covering');
      setTimeout(function () {
        loaderEl.classList.add('is-hidden');
        unlockScroll();
        markLoadingFinished();
        // .loader 의 opacity 전환(0.5s)이 끝난 뒤 멈춘다
        setTimeout(stopBall, 600);
      }, OUTRO_REVEAL_MS);
    });
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
    // 로더를 건너뛰는 경우에도 "이제 시작해도 된다" 신호는 똑같이 필요하다.
    // 다만 등록된 준비 작업이 끝난 뒤여야 한다 (본문이 없는데 재생부터 하면 안 됨).
    afterPageLoad(function () {
      waitForTasksCapped().then(markLoadingFinished);
    });
  } else {
    lockScroll();
    playIntro();

    // hold the loader for at least MIN_VISIBLE_MS so it doesn't just flash,
    // but finish as soon as the real page has actually loaded.
    var MIN_VISIBLE_MS = 1500;
    var startedAt = Date.now();
    function ready() {
      // window load 뿐 아니라 페이지가 등록한 준비 작업(본문/오디오 메타 등)까지
      // 끝나야 로더를 걷는다.
      waitForTasksCapped().then(function () {
        var wait = Math.max(0, MIN_VISIBLE_MS - (Date.now() - startedAt));
        setTimeout(window.finishLoading, wait);
      });
    }
    afterPageLoad(ready);
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

      var currentFile = (currentPath.split('/').pop() || 'main').toLowerCase();
      var targetFile = (targetPath.split('/').pop() || 'main').toLowerCase();

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
