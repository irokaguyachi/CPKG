/**
 * ChoKaguya Theme System (Dark / Light Mode)
 * - Persists theme preference in localStorage ('theme': 'dark' | 'light')
 * - Automatically detects system preference (prefers-color-scheme)
 * - Smooth transition and instant FOUC-free initialization
 * - 토글 UI 자체는 없음 — src/js/components/settingsModal.js의 "일반" 탭이
 *   ThemeManager.getTheme()/setTheme()을 직접 불러 쓴다.
 */
(function (global) {
  var STORAGE_KEY = 'chokaguya_theme';

  function getPreferredTheme() {
    var stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function updateThemeColorMeta(theme) {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#121316' : '#ffffff');
  }

  function applyTheme(theme, animate) {
    if (animate) {
      document.documentElement.classList.add('theme-transitioning');
      setTimeout(function () {
        document.documentElement.classList.remove('theme-transitioning');
      }, 400);
    }
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEY, theme);
    updateLogos(theme);
    updateThemeColorMeta(theme);
  }

  function toggleTheme() {
    var current = document.documentElement.getAttribute('data-theme') || getPreferredTheme();
    var next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next, true);
  }

  function updateLogos(theme) {
    var logos = document.querySelectorAll('img[data-light-src][data-dark-src]');
    logos.forEach(function (img) {
      var rawSrc = theme === 'dark' ? img.getAttribute('data-dark-src') : img.getAttribute('data-light-src');
      if (!rawSrc) return;
      // 헤더 로고는 R2 가 아니라 오리진에서 직접 서빙한다(src/offline_src/logo/).
      // cdnConfig.js 의 resolveAssetUrl()은 경로에 assets/ 가 없으면 붙여서
      // R2 로 보내버리기 때문에, 이 예외가 없으면 ../offline_src/logo/... 가
      // R2/assets/offline_src/logo/... 라는 없는 주소로 변환된다.
      var isLocal = rawSrc.indexOf('../offline_src/') === 0 || rawSrc.indexOf('/offline_src/') === 0;
      var targetSrc = (!isLocal && window.resolveAssetUrl) ? window.resolveAssetUrl(rawSrc) : rawSrc;
      if (img.getAttribute('src') !== targetSrc) {
        img.src = targetSrc;
      }
    });
  }

  // System color-scheme change listener
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
      if (!localStorage.getItem(STORAGE_KEY)) {
        applyTheme(e.matches ? 'dark' : 'light', true);
      }
    });
  }

  // Initial apply
  var initialTheme = getPreferredTheme();
  document.documentElement.setAttribute('data-theme', initialTheme);
  updateThemeColorMeta(initialTheme);

  // Apply logo swap once DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      updateLogos(initialTheme);
    });
  } else {
    updateLogos(initialTheme);
  }

  global.ThemeManager = {
    getTheme: function () { return document.documentElement.getAttribute('data-theme') || getPreferredTheme(); },
    setTheme: applyTheme,
    toggle: toggleTheme
  };
})(window);
