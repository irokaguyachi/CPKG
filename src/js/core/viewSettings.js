/**
 * ChoKaguya View Settings (목록 보기 설정)
 * - 시리즈/명예관/공식/문학 그리드 페이지(gridPage.js)의 보기 방식
 *   (그리드/리스트)과 그리드 카드 모양을 저장한다. 설정창의 보기 탭
 *   (settingsModal.js)과 목록 툴바의 보기 전환 버튼이 같은 값을 쓴다.
 * - contentSettings.js 와 같은 IIFE + localStorage 패턴이며, 값이 바뀌면
 *   'chokaguya:view-settings-change' 를 쏴서 이미 그려진 목록이 새로고침
 *   없이 다시 그려지게 한다.
 * - 보기 방식 키(chokaguya_grid_view)는 gridPage.js 가 쓰던 키를 그대로
 *   이어받아, 이미 리스트로 바꿔 둔 방문자의 선택이 유지된다.
 */
(function (global) {
  var MODE_KEY = 'chokaguya_grid_view';
  var STYLE_KEY = 'chokaguya_grid_style';

  // classic: 기존 가로 배너 카드 / cover: 표지형 / magazine: 매거진형 /
  // compact: 컴팩트 타일
  var GRID_STYLES = ['classic', 'cover', 'magazine', 'compact'];
  var DEFAULT_GRID_STYLE = 'classic';

  function read(key) {
    try { return global.localStorage.getItem(key); } catch (e) { return null; }
  }
  function write(key, value) {
    try { global.localStorage.setItem(key, value); } catch (e) {}
  }

  function getViewMode() {
    return read(MODE_KEY) === 'list' ? 'list' : 'grid';
  }

  function getGridStyle() {
    var stored = read(STYLE_KEY);
    return GRID_STYLES.indexOf(stored) !== -1 ? stored : DEFAULT_GRID_STYLE;
  }

  function get() {
    return { viewMode: getViewMode(), gridStyle: getGridStyle() };
  }

  function emit() {
    try { global.dispatchEvent(new CustomEvent('chokaguya:view-settings-change', { detail: get() })); } catch (e) {}
  }

  function setViewMode(mode) {
    mode = mode === 'list' ? 'list' : 'grid';
    if (mode === getViewMode()) return;
    write(MODE_KEY, mode);
    emit();
  }

  function setGridStyle(style) {
    if (GRID_STYLES.indexOf(style) === -1 || style === getGridStyle()) return;
    write(STYLE_KEY, style);
    emit();
  }

  global.ViewSettings = {
    GRID_STYLES: GRID_STYLES,
    get: get,
    getViewMode: getViewMode,
    getGridStyle: getGridStyle,
    setViewMode: setViewMode,
    setGridStyle: setGridStyle
  };
})(window);
