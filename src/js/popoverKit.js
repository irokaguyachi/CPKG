/**
 * ChoKaguya Anchored Popover Kit
 * - bookmarkPicker.js / auth.js / bookmarksPage.js 가 각자 만들던 "버튼 옆에
 *   뜨는 작은 패널" 세 벌이 사실 똑같은 코드였다: document.body 싱글턴 +
 *   바깥 클릭·Escape 로 닫힘 + getBoundingClientRect 기준 뷰포트 클램프
 *   위치 계산. 클래스명과 기본 폭(260 vs 280)만 달랐다.
 * - 딤 배경이 있는 authModal.js/postDetailSeries.js/sidebar.js 의 오버레이는
 *   여기 포함하지 않았다 — authModal.js는 "확인 버튼으로만 닫히는" 잠금
 *   상태(dismissible)가 있고, sidebar.js는 바깥 클릭 시 클릭 대상 검사 없이
 *   바로 닫히는 등 실제로 동작이 달라서, 억지로 하나로 묶으면 그 차이를
 *   깨뜨릴 위험이 있었다.
 */
(function (global) {
  // className: 팝오버 엘리먼트에 줄 클래스(예: 'bkm-picker bkm-share-panel').
  // defaultWidth: offsetWidth를 아직 못 잴 때(첫 렌더 전) 쓰는 폴백 폭.
  // onClose: 바깥 클릭/Escape로 닫힐 때도 호출자가 자기 상태를 정리할 수 있게
  //   하는 훅 — bookmarkPicker.js는 닫힐 때 항상 state를 비워야 해서 필요하다.
  function createPopover(className, defaultWidth, onClose) {
    var el = null;
    var docListenersBound = false;

    function ensure() {
      if (el) return el;
      el = document.createElement('div');
      el.className = className;
      el.addEventListener('click', function (e) { e.stopPropagation(); });
      document.body.appendChild(el);
      if (!docListenersBound) {
        document.addEventListener('click', close);
        document.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') close();
        });
        docListenersBound = true;
      }
      return el;
    }

    function close() {
      if (el) el.classList.remove('is-open');
      if (onClose) onClose();
    }

    // 버튼 우측 하단에 붙이되 화면 밖으로 안 나가게 클램프
    function position(anchorEl) {
      var rect = anchorEl.getBoundingClientRect();
      var popW = el.offsetWidth || defaultWidth;
      var left = Math.max(8, Math.min(rect.right - popW, global.innerWidth - popW - 8));
      var top = Math.min(rect.bottom + 8, global.innerHeight - 8);
      el.style.left = Math.round(left) + 'px';
      el.style.top = Math.round(top) + 'px';
    }

    return { ensure: ensure, close: close, position: position };
  }

  // auth.js의 panelHeader/panelButton, bookmarksPage.js의
  // sharePanelHeader/sharePanelButton이 이름만 다르고 완전히 같았다.
  function header(text) {
    var h = document.createElement('div');
    h.className = 'sfp-header';
    h.textContent = text;
    return h;
  }

  function button(label, variant) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bkm-share-btn' + (variant ? ' ' + variant : '');
    btn.textContent = label;
    return btn;
  }

  global.PopoverKit = {
    createPopover: createPopover,
    header: header,
    button: button
  };
})(window);
