/**
 * ChoKaguya Sidebar Toggle
 * - 오른쪽 위 메뉴 버튼(.sidebar-toggle-btn, 각 페이지 HTML에 정적으로
 *   있음)을 누르면 화면 오른쪽의 .sidebar(src/js/core/theme.js/auth.js 가
 *   .header-nav 안에 다크모드 토글·로그인 버튼을 자동 주입하는 그 사이드바)
 *   가 슬라이드인 된다.
 * - 딤 배경(.sidebar-overlay)은 src/js/components/postDetailSeries.js/authModal.js
 *   와 같은 싱글턴 오버레이 패턴 — document.body 에 한 번만 append,
 *   오버레이 자체 클릭이나 Escape 로 닫힌다.
 */
(function (global) {
  var HAMBURGER_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
  var CLOSE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>';

  var overlayEl = null;

  function ensureOverlay() {
    if (overlayEl) return overlayEl;
    overlayEl = document.createElement('div');
    overlayEl.className = 'sidebar-overlay';
    overlayEl.addEventListener('click', close);
    document.body.appendChild(overlayEl);
    return overlayEl;
  }

  function getSidebar() {
    return document.querySelector('.sidebar');
  }

  // 열림/닫힘에 따라 버튼 아이콘을 햄버거⇄X로 바꾼다 — 사이드바가 열려
  //있는 동안에는 같은 버튼이 "닫기" 컨트롤로도 계속 보인다.
  function updateToggleBtn(isOpen) {
    var btn = document.querySelector('.sidebar-toggle-btn');
    if (!btn) return;
    btn.innerHTML = isOpen ? CLOSE_ICON : HAMBURGER_ICON;
    btn.setAttribute('aria-label', isOpen ? '메뉴 닫기' : '메뉴 열기');
  }

  function open() {
    var sidebar = getSidebar();
    if (!sidebar) return;
    ensureOverlay().classList.add('is-open');
    sidebar.classList.add('is-open');
    updateToggleBtn(true);
  }

  function close() {
    var sidebar = getSidebar();
    if (overlayEl) overlayEl.classList.remove('is-open');
    if (sidebar) sidebar.classList.remove('is-open');
    updateToggleBtn(false);
  }

  function toggle() {
    var sidebar = getSidebar();
    if (sidebar && sidebar.classList.contains('is-open')) {
      close();
    } else {
      open();
    }
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close();
  });

  function init() {
    var btn = document.querySelector('.sidebar-toggle-btn');
    if (!btn) return;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.Sidebar = { open: open, close: close, toggle: toggle };
})(window);
