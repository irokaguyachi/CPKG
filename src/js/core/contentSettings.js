/**
 * ChoKaguya Content Visibility Settings (후방주의 모드)
 * - 기본값(꺼짐)에서는 `후방주의`(성인) 태그가 붙은 문학을 목록·상세에서
 *   숨기고, 번역 사진을 흐리게(검열) 한다. 사용자가 설정창에서 후방주의
 *   모드를 켜야만 둘 다 풀린다. 저장 키 이름(showMature)은 예전 '후방주의
 *   태그 문학 표시' 토글 값을 그대로 이어받으려고 바꾸지 않았다.
 *   audioSettings.js와 같은
 *   즉시실행 IIFE + localStorage 패턴이며, 값이 바뀌면
 *   'chokaguya:content-settings-change'를 쏴서 이미 열려 있는 그리드/상세
 *   팝업이 새로고침 없이 다시 계산하게 한다.
 */
(function (global) {
  var STORAGE_KEY = 'chokaguya_content_settings';
  var MATURE_TAG = '후방주의';
  var DEFAULTS = { showMature: false };

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { showMature: DEFAULTS.showMature };
      var parsed = JSON.parse(raw);
      return { showMature: typeof parsed.showMature === 'boolean' ? parsed.showMature : DEFAULTS.showMature };
    } catch (e) {
      return { showMature: DEFAULTS.showMature };
    }
  }

  var state = load();

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
    try { global.dispatchEvent(new CustomEvent('chokaguya:content-settings-change', { detail: state })); } catch (e) {}
  }

  function get() {
    return { showMature: state.showMature };
  }

  function setShowMature(value) {
    state.showMature = !!value;
    save();
  }

  function hasMatureTag(tags) {
    return Array.isArray(tags) && tags.indexOf(MATURE_TAG) !== -1;
  }

  // 설정이 꺼져 있고 해당 태그가 붙어 있으면 true — 목록 필터링과 상세 팝업
  // 접근 차단이 이 하나의 판정을 공유한다.
  function isBlocked(tags) {
    return !state.showMature && hasMatureTag(tags);
  }

  // 후방주의 모드가 꺼져 있으면 true — 번역 사진 흐림과 번역 탭 주의
  // 게이트가 이 판정을 공유한다(번역은 태그가 없어 글마다 가릴 수 없다).
  function isTranslationCensored() {
    return !state.showMature;
  }

  global.ContentSettings = {
    MATURE_TAG: MATURE_TAG,
    get: get,
    setShowMature: setShowMature,
    hasMatureTag: hasMatureTag,
    isBlocked: isBlocked,
    isTranslationCensored: isTranslationCensored
  };
})(window);
