/**
 * pageView.js — 이 페이지를 연 것을 방문 통계에 한 번 남긴다.
 *
 * 예전엔 서버가 HTML 문서 요청 자체를 방문으로 셌는데, 그러면 JS를 안
 * 돌리는 스캐너 봇까지 전부 방문자로 잡혔다. 지금은 브라우저가 이 비콘을
 * 보내야만 기록된다(_worker.js의 /api/pageview).
 *
 * 사람 확인(Cloudflare Turnstile):
 * - 서버가 { need: 'turnstile' } 로 답하면(이 브라우저가 30일 안에 통과한
 *   적이 없다는 뜻) Turnstile을 managed + interaction-only 로 띄운다.
 *   대부분의 사람은 아무것도 못 본 채 자동으로 통과하고, Cloudflare가 봇으로
 *   의심할 때만 로딩 로고 아래에 체크박스가 나타난다.
 * - 체크박스가 떠 있는 동안은 로더를 붙잡아 둔다(loading.js holdLoader).
 *   로더가 이미 없으면(새로고침 등으로 로딩 화면을 건너뛴 경우) 화면 아래에
 *   작은 상자로 띄운다.
 * - 통과하지 못해도 사이트는 그대로 쓸 수 있다. 통계에서만 빠진다.
 */
(function () {
  'use strict';

  var ENDPOINT = '/api/pageview';
  var SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  var QUIET_WAIT_MS = 8000;        // 체크박스 없이 끝나는 검증을 로더가 기다려 주는 상한
  var INTERACTIVE_WAIT_MS = 60000; // 체크박스가 뜬 뒤 사용자를 기다려 주는 상한
  var FLOAT_REMOVE_DELAY_MS = 1200;

  var path = location.pathname;
  var ref = '';
  try {
    if (document.referrer) ref = new URL(document.referrer).hostname;
  } catch (e) {}

  function send(token) {
    var body = { path: path, ref: ref };
    if (token) body.token = token;
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }

  // 대부분의 방문자는 이미 통과 쿠키가 있으므로 스크립트는 필요할 때만 받는다.
  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = SCRIPT_URL;
      s.async = true;
      s.onload = function () {
        if (window.turnstile) resolve(window.turnstile);
        else reject(new Error('turnstile unavailable'));
      };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function challenge(sitekey) {
    var box = document.createElement('div');
    box.className = 'human-check';
    var caption = document.createElement('p');
    caption.className = 'human-check-caption';
    caption.textContent = '사람인지 잠깐 확인할게요';
    var slot = document.createElement('div');
    box.appendChild(caption);
    box.appendChild(slot);

    var release;
    var settled = new Promise(function (resolve) { release = resolve; });
    var timer = setTimeout(release, QUIET_WAIT_MS);

    var loaderContent = document.getElementById('loader-content');
    var inLoader = !!(loaderContent && typeof window.holdLoader === 'function' && window.holdLoader(settled));
    if (inLoader) {
      box.classList.add('is-in-loader');
      loaderContent.appendChild(box);
    } else {
      box.classList.add('is-floating');
      document.body.appendChild(box);
    }

    var finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      release();
      // 로더 안의 상자는 로더와 함께 사라지므로 따로 치우지 않는다. 떠 있는
      // 상자는 Turnstile의 "성공" 표시를 잠깐 보여 준 뒤 걷는다.
      if (!inLoader) {
        setTimeout(function () {
          if (box.parentNode) box.parentNode.removeChild(box);
        }, box.classList.contains('is-interactive') ? FLOAT_REMOVE_DELAY_MS : 0);
      }
    }

    loadTurnstile().then(function (ts) {
      ts.render(slot, {
        sitekey: sitekey,
        action: 'pageview',
        appearance: 'interaction-only',
        theme: 'dark',
        callback: function (token) {
          send(token).catch(function () {});
          finish();
        },
        'before-interactive-callback': function () {
          box.classList.add('is-interactive');
          clearTimeout(timer);
          timer = setTimeout(finish, INTERACTIVE_WAIT_MS);
        },
        'error-callback': function () {
          finish();
          return true; // 처리했다고 알려 콘솔 예외를 막는다
        },
        'unsupported-callback': finish,
        'timeout-callback': finish
      });
    }).catch(finish);
  }

  send().then(function (res) {
    if (res && res.need === 'turnstile' && typeof res.sitekey === 'string' && res.sitekey) {
      challenge(res.sitekey);
    }
  }).catch(function () {
    // 통계는 부가 기능이다 — 실패해도 페이지 동작에 영향을 주지 않는다.
  });
})();
