/**
 * ChoKaguya I18n (사이트 UI 언어 전환: 한국어 / English / 日本語)
 * - 번역 대상은 사이트 UI 문구뿐이다. 문학 본문·제목·작가·태그·공지·변경
 *   내역 같은 콘텐츠는 건드리지 않는다.
 * - 한국어 원문 문구 자체가 키다. src/data/i18n/English.json 과
 *   Japanese.json 은 { "한국어 원문": "번역문" } 형태이고, 사전에 없거나 값이
 *   비어 있는 키는 한국어 원문이 그대로 나온다. 그래서 한국어 사전 파일은
 *   따로 없고, 한국어 방문자는 사전을 아예 내려받지 않는다.
 * - 원문에 {name} 자리표시자가 있으면 t('{n}편', { n: 3 }) 처럼 값을 넘기고,
 *   번역문에도 같은 {n} 을 넣는다. 영어처럼 단수·복수가 갈리는 언어는 값을
 *   { "one": "{n} work", "other": "{n} works" } 객체로 적으면 n 이 1 일 때
 *   one 을, 나머지는 other 를 쓴다.
 * - 다른 스크립트가 문구를 그리는 시점에 사전이 이미 있어야 하므로, 사전은
 *   localStorage 에 캐시해 두고 동기적으로 읽는다. 캐시가 DATA_VERSION 보다
 *   오래됐으면 이번 페이지는 옛 사전으로 그리고, 새 사전은 백그라운드로 받아
 *   다음 페이지부터 쓴다. 캐시가 아예 없으면(저장소가 비워진 경우) 받아 온
 *   뒤 한 번만 새로고침한다.
 * - HTML 의 정적 문구는 data-i18n(텍스트), data-i18n-html(안쪽 HTML),
 *   data-i18n-attr="aria-label,title"(속성) 표시가 붙은 요소만 바꾼다.
 *   표시가 없는 글자는 콘텐츠로 보고 그대로 둔다.
 * - cdnConfig.js 바로 뒤에서 defer 로 불러야 한다(dataUrl 을 쓰고, 뒤따르는
 *   스크립트들이 I18n.t 를 쓴다).
 */
(function (global) {
  var LANG_KEY = 'chokaguya_lang';
  var DICT_KEY_PREFIX = 'chokaguya_i18n_';
  var RELOAD_GUARD_KEY = 'chokaguya_i18n_reloaded';

  var LANGUAGES = [
    { code: 'ko', file: null, label: '한국어', htmlLang: 'ko', locale: 'ko-KR' },
    { code: 'en', file: 'English', label: 'English', htmlLang: 'en', locale: 'en-US' },
    { code: 'ja', file: 'Japanese', label: '日本語', htmlLang: 'ja', locale: 'ja-JP' }
  ];

  function findLang(code) {
    for (var i = 0; i < LANGUAGES.length; i++) {
      if (LANGUAGES[i].code === code) return LANGUAGES[i];
    }
    return null;
  }

  function readStorage(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function writeStorage(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
  }

  var current = findLang(readStorage(LANG_KEY)) || LANGUAGES[0];

  function dictUrl(lang) {
    var path = '../data/i18n/' + lang.file + '.json';
    return global.dataUrl ? global.dataUrl(path) : path;
  }

  function readCachedDict(lang) {
    try {
      var raw = localStorage.getItem(DICT_KEY_PREFIX + lang.code);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && parsed.dict ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  function fetchDict(lang) {
    var url = dictUrl(lang);
    return fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('i18n ' + r.status);
        return r.json();
      })
      .then(function (dict) {
        writeStorage(DICT_KEY_PREFIX + lang.code, JSON.stringify({ url: url, dict: dict }));
        return dict;
      });
  }

  var dict = null;
  if (current.file) {
    var cached = readCachedDict(current);
    if (cached) {
      dict = cached.dict;
      if (cached.url !== dictUrl(current)) fetchDict(current).catch(function () {});
    } else {
      // 캐시가 없으면 이번 페이지는 한국어로 그려진 상태다 — 사전을 받아 온
      // 뒤 한 번만 새로고침한다. 저장이 계속 실패하는 환경에서 무한
      // 새로고침에 빠지지 않도록 세션당 한 번으로 막는다.
      fetchDict(current).then(function () {
        var guard = null;
        try { guard = sessionStorage.getItem(RELOAD_GUARD_KEY); } catch (e) {}
        if (guard || !readCachedDict(current)) return;
        try { sessionStorage.setItem(RELOAD_GUARD_KEY, '1'); } catch (e) {}
        location.reload();
      }).catch(function () {});
    }
  }

  function format(text, params) {
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, function (m, name) {
      return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : m;
    });
  }

  function t(key, params) {
    var text = key;
    var value = dict && Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : null;
    if (value && typeof value === 'object') {
      var one = params && Number(String(params.n).replace(/,/g, '')) === 1;
      value = (one && value.one) || value.other;
    }
    if (value) text = value;
    return format(text, params);
  }

  function normalizeKey(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  // data-i18n / data-i18n-html / data-i18n-attr 표시가 붙은 요소를 번역한다.
  // 원문은 처음 번역할 때 속성에 남겨 두므로 같은 요소를 두 번 불러도
  // 번역문을 다시 키로 쓰는 일이 없다.
  function apply(root) {
    if (!dict) return;
    root = root || document;
    var textEls = root.querySelectorAll('[data-i18n]');
    for (var i = 0; i < textEls.length; i++) {
      var el = textEls[i];
      var key = el.getAttribute('data-i18n') || normalizeKey(el.textContent);
      el.setAttribute('data-i18n', key);
      el.textContent = t(key);
    }
    var htmlEls = root.querySelectorAll('[data-i18n-html]');
    for (var j = 0; j < htmlEls.length; j++) {
      var hel = htmlEls[j];
      var hkey = hel.getAttribute('data-i18n-html') || normalizeKey(hel.innerHTML);
      hel.setAttribute('data-i18n-html', hkey);
      hel.innerHTML = t(hkey);
    }
    var attrEls = root.querySelectorAll('[data-i18n-attr]');
    for (var k = 0; k < attrEls.length; k++) {
      var ael = attrEls[k];
      ael.getAttribute('data-i18n-attr').split(',').forEach(function (name) {
        name = name.trim();
        if (!name) return;
        var origName = 'data-i18n-orig-' + name;
        var akey = ael.getAttribute(origName) || ael.getAttribute(name);
        if (!akey) return;
        ael.setAttribute(origName, akey);
        ael.setAttribute(name, t(akey));
      });
    }
  }

  function setLanguage(code) {
    var lang = findLang(code);
    if (!lang) return Promise.reject(new Error('unknown language: ' + code));
    var ready = lang.file ? fetchDict(lang) : Promise.resolve(null);
    return ready.then(function () {
      writeStorage(LANG_KEY, lang.code);
      location.reload();
    });
  }

  document.documentElement.setAttribute('lang', current.htmlLang);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { apply(document); });
  } else {
    apply(document);
  }

  global.I18n = {
    LANGUAGES: LANGUAGES,
    lang: current.code,
    locale: current.locale,
    t: t,
    apply: apply,
    setLanguage: setLanguage
  };
})(window);
