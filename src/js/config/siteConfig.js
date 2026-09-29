/**
 * ChoKaguya Site Config (src/data/config/SiteConfig.json)
 * - 문의 메일, PWA 이름처럼 자주 바뀔 수 있는 값을 코드에 박아두지 않고
 *   이 JSON 하나에서 읽어와 적용한다. 값을 바꾸고 싶으면 그 JSON만 고치면
 *   되고, 배포 후 캐시까지 갱신하려면 10_update_data_version.py를 한 번
 *   돌리면 된다(다른 data/*.json과 마찬가지로 DATA_VERSION 대상에 이미
 *   포함돼 있음).
 * - manifest.webmanifest의 name/short_name은 브라우저가 이 스크립트와
 *   무관하게 별도로 직접 fetch하는 정적 파일이라 런타임에는 못 바꾼다 —
 *   그 값은 src/scripts/sync_site_config.py가 SiteConfig.json에서
 *   동기화한다(SiteConfig.json을 고친 뒤 그 스크립트를 실행할 것).
 * - 다른 스크립트(auth.js의 버전 표시 등)가 같은 값을 또 fetch하지 않도록,
 *   이 로딩 프라미스를 window.SiteConfig.ready로 공유한다.
 */
(function (global) {
  var t = global.I18n.t;
  var CONFIG_URL = '../data/config/SiteConfig.json';

  var ready = fetch(global.dataUrl ? global.dataUrl(CONFIG_URL) : CONFIG_URL)
    .then(function (r) { return r.json(); })
    .catch(function () { return {}; });

  function applyToDom(config) {
    if (config.contactEmail) {
      document.querySelectorAll('.site-footer-contact').forEach(function (el) {
        el.textContent = t('문의') + ' : ' + config.contactEmail;
      });
    }
    if (config.shortAppName) {
      var meta = document.querySelector('meta[name="apple-mobile-web-app-title"]');
      if (meta) meta.setAttribute('content', config.shortAppName);
    }
  }

  ready.then(applyToDom);

  global.SiteConfig = { ready: ready };
})(window);
