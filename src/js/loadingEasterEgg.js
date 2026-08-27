/**
 * 로딩 화면 이스터에그 (단발성 이벤트용 — 캠페인이 끝나면 이 파일과 각
 * 페이지의 <script defer src="../js/loadingEasterEgg.js"> 한 줄만 지우면
 * 원래 로딩 화면으로 완전히 되돌아간다. loading.js 본체는 전혀 건드리지
 * 않는다:
 * - "Loading" 문구는 loading.js가 따로 갱신하지 않는 정적 텍스트라 한 번만
 *   바꿔치면 끝난다.
 * - 팁 문구는 loading.js가 비동기로 Tip.json을 받아온 뒤 한 번 정해지므로,
 *   이 스크립트가 먼저 채워둬도 그 응답이 늦게 도착하면 나중에 덮어써질 수
 *   있다. 그 경합을 피하려고 로딩이 떠 있는 동안 짧은 간격으로 다시
 *   덮어써서 이 문구가 계속 보이게 한다.
 * - 로딩을 더 길게 붙잡는 것도 loading.js가 이미 만들어 둔
 *   window.finishLoading을 감싸서(monkey-patch) 실제 호출 시점만
 *   늦추는 방식이라, loading.js 쪽 코드는 수정하지 않는다.
 */
(function () {
  var TRIGGER_CHANCE = 0.01;
  if (Math.random() >= TRIGGER_CHANCE) return;

  var EASTER_LOADING_TEXT = 'Loading?';
  var EASTER_TIP_TEXT = 'https://open.kakao.com/o/sIGm6pKi (선착)';
  var EXTRA_DELAY_MS = 10000;
  var REASSERT_INTERVAL_MS = 100;

  var loadingTextEl = document.querySelector('.loader-loading-text');
  if (loadingTextEl) loadingTextEl.textContent = EASTER_LOADING_TEXT;

  var tipEl = document.getElementById('loader-tip-text');
  var reassertTimer = null;
  if (tipEl) {
    tipEl.textContent = EASTER_TIP_TEXT;
    reassertTimer = setInterval(function () {
      if (tipEl.textContent !== EASTER_TIP_TEXT) tipEl.textContent = EASTER_TIP_TEXT;
    }, REASSERT_INTERVAL_MS);
  }

  // loading.js는 defer로 이 스크립트보다 먼저 실행되므로 window.finishLoading이
  // 이미 정의돼 있다 — 그걸 감싸서 실제로 로더를 닫는 시점을 10초 늦춘다.
  var originalFinish = window.finishLoading;
  if (typeof originalFinish === 'function') {
    window.finishLoading = function () {
      setTimeout(function () {
        if (reassertTimer) clearInterval(reassertTimer);
        originalFinish();
      }, EXTRA_DELAY_MS);
    };
  } else if (reassertTimer) {
    clearInterval(reassertTimer);
  }
})();
