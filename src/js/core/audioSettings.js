/**
 * ChoKaguya Audio Novel Playback Settings
 * - 오디오 노벨 재생 관련 사용자 설정(자동재생 여부, 기본 볼륨)을
 *   localStorage에 저장한다. src/js/core/bookmarks.js와 같은 즉시실행 IIFE 패턴.
 * - settingsModal.js의 "오디오 문학" 탭이 읽고 쓰며, audioNovelReader.js가
 *   재생 시점에 읽는다. 값이 바뀌면 'chokaguya:audio-settings-change'를
 *   발생시켜, 리더 페이지가 열려 있는 동안 설정을 바꿔도 즉시 반영되게 한다.
 */
(function (global) {
  var STORAGE_KEY = 'chokaguya_audio_settings';
  var DEFAULTS = { autoplay: true, volume: 1 };

  function clampVolume(v) {
    v = Number(v);
    if (isNaN(v)) return DEFAULTS.volume;
    return Math.min(1, Math.max(0, v));
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { autoplay: DEFAULTS.autoplay, volume: DEFAULTS.volume };
      var parsed = JSON.parse(raw);
      return {
        autoplay: typeof parsed.autoplay === 'boolean' ? parsed.autoplay : DEFAULTS.autoplay,
        volume: clampVolume(parsed.volume !== undefined ? parsed.volume : DEFAULTS.volume)
      };
    } catch (e) {
      return { autoplay: DEFAULTS.autoplay, volume: DEFAULTS.volume };
    }
  }

  var state = load();

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
    try { global.dispatchEvent(new CustomEvent('chokaguya:audio-settings-change', { detail: state })); } catch (e) {}
  }

  function get() {
    return { autoplay: state.autoplay, volume: state.volume };
  }

  function setAutoplay(value) {
    state.autoplay = !!value;
    save();
  }

  function setVolume(value) {
    state.volume = clampVolume(value);
    save();
  }

  global.AudioSettings = { get: get, setAutoplay: setAutoplay, setVolume: setVolume };
})(window);
