/**
 * 생일 배너 "팬케이크 주기" 카운터 (src/js/mainPage.js가 그리는
 * #birthday-pancake-btn / #birthday-pancake-count 를 대상으로 동작한다)
 * - 클릭할 때마다 서버로 보내지 않는다. 로컬에서 즉시(낙관적) 숫자를
 *   올려 보여주고, 5초간 클릭이 없으면 그동안 쌓인 개수를 한 번에
 *   /pancake/add 로 보낸다 — 연타 한 번에 서버 쓰기 요청 하나만 나간다.
 * - 이벤트 종료 후엔 이 파일과 mainPage.html의 <script> 태그,
 *   createBirthdayBanner()의 버튼 마크업만 지우면 된다(서버 쪽
 *   worker/favoritesShareWorker.js의 /pancake, /pancake/add 는 남아있어도
 *   무해하다 — 아무도 안 부르면 그냥 쓰이지 않을 뿐).
 */
(function () {
  'use strict';
  var GET_URL = '/pancake';
  var ADD_URL = '/pancake/add';
  var IDLE_MS = 5000;
  var POLL_MS = 5000; // 남이 준 팬케이크도 반영되도록 주기적으로 다시 불러온다
  var MAX_PER_REQUEST = 300; // worker의 PANCAKE_MAX_AMOUNT와 맞춤

  function formatCount(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  var PARTICLE_COUNT = 6;
  var prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 버튼에서 팬케이크 이모지가 터져 나오는 이펙트. .birthday-banner가
  // overflow:hidden(캐릭터 아트 흘러나가는 연출용)이라, 파티클을 배너 안에
  // 붙이면 밖으로 나가는 순간 잘린다 — document.body에 fixed로 띄운다.
  // prefers-reduced-motion이면 애니메이션이 안 걸려 animationend가 영영
  // 안 오고 DOM에 계속 쌓이므로, 아예 만들지 않는다.
  function spawnPancakeParticles(originEl) {
    if (prefersReducedMotion) return;
    var rect = originEl.getBoundingClientRect();
    var originX = rect.left + rect.width / 2;
    var originY = rect.top + rect.height / 2;

    for (var i = 0; i < PARTICLE_COUNT; i++) {
      var angle = (Math.PI * 2 * i) / PARTICLE_COUNT + (Math.random() - 0.5) * 0.6;
      var distance = 46 + Math.random() * 38;
      var span = document.createElement('span');
      span.className = 'pancake-particle';
      span.textContent = '🥞';
      span.style.left = originX + 'px';
      span.style.top = originY + 'px';
      span.style.setProperty('--tx', (Math.cos(angle) * distance) + 'px');
      span.style.setProperty('--ty', (Math.sin(angle) * distance - 18) + 'px');
      span.style.setProperty('--rot', (Math.random() * 140 - 70) + 'deg');
      document.body.appendChild(span);
      span.addEventListener('animationend', function () { this.remove(); });
    }
  }

  // 배너는 mainPage.js가 Recent.json 응답을 받은 뒤에야 그리므로
  // DOMContentLoaded 시점엔 버튼이 아직 없다 — mainPage.js가 배너를 붙인
  // 직후 쏘는 'chokaguya:birthday-banner-ready'를 기다린다. 혹시 이 스크립트가
  // 그 이벤트보다 늦게 로드돼 이미 버튼이 있으면(방어적으로) 곧바로 진행한다.
  function whenBannerReady(fn) {
    var existing = document.getElementById('birthday-pancake-btn');
    if (existing) { fn(); return; }
    window.addEventListener('chokaguya:birthday-banner-ready', fn, { once: true });
  }

  whenBannerReady(function () {
    var btn = document.getElementById('birthday-pancake-btn');
    var countEl = document.getElementById('birthday-pancake-count');
    if (!btn || !countEl) return;

    var baseCount = 0; // 서버에 마지막으로 확인/반영된 값
    var pending = 0; // 아직 서버에 안 보낸, 이번 연타에서 쌓인 개수
    var idleTimer = null;

    function render() {
      countEl.textContent = '지금까지 ' + formatCount(baseCount + pending) + '개';
    }

    // 다른 사람이 준 팬케이크도 화면에 반영되도록, 서버 값을 주기적으로
    // 다시 불러온다. 내가 아직 안 보낸 pending은 그대로 위에 얹어서 보여준다
    // (render()가 baseCount + pending을 합쳐서 표시).
    function refreshBaseCount() {
      return fetch(GET_URL)
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data && typeof data.count === 'number') {
            baseCount = data.count;
            render();
          }
        })
        .catch(function () {});
    }

    var pollTimer = null;
    function startPolling() {
      if (pollTimer) return;
      pollTimer = setInterval(refreshBaseCount, POLL_MS);
    }
    function stopPolling() {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }
    // 백그라운드 탭에서까지 계속 폴링하지 않는다(gridPage.js의 검색
    // placeholder 타이핑, mainPage.js의 랜덤 섹션 로테이션과 같은 이유).
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        stopPolling();
      } else {
        refreshBaseCount();
        startPolling();
      }
    });

    refreshBaseCount();
    startPolling();

    function flush() {
      idleTimer = null;
      if (!pending) return;
      var amount = Math.min(pending, MAX_PER_REQUEST);
      pending = 0;
      fetch(ADD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amount })
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data && typeof data.count === 'number') {
            baseCount = data.count;
            render();
          }
        })
        .catch(function () {}); // 실패해도 그만인 가벼운 카운터라 재시도하지 않는다
    }

    btn.addEventListener('click', function () {
      pending += 1;
      render();
      spawnPancakeParticles(btn);

      btn.classList.remove('is-bump');
      void btn.offsetWidth; // 리플로우를 강제해 같은 애니메이션을 연속 클릭에도 재생
      btn.classList.add('is-bump');

      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(flush, IDLE_MS);
    });

    // 5초를 못 기다리고 페이지를 떠나는 경우, 쌓인 만큼을 sendBeacon으로
    // 곧장 흘려보낸다(응답은 못 받으니 화면 갱신은 하지 않는다).
    window.addEventListener('beforeunload', function () {
      if (!pending || !navigator.sendBeacon) return;
      var amount = Math.min(pending, MAX_PER_REQUEST);
      try {
        navigator.sendBeacon(ADD_URL, new Blob([JSON.stringify({ amount: amount })], { type: 'application/json' }));
      } catch (e) {}
    });
  });
})();
