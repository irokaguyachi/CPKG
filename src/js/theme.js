/**
 * ChoKaguya Theme System (Dark / Light Mode)
 * - Persists theme preference in localStorage ('theme': 'dark' | 'light')
 * - Automatically detects system preference (prefers-color-scheme)
 * - Renders theme toggle button in header navigation
 * - Smooth transition and instant FOUC-free initialization
 */
(function (global) {
  var STORAGE_KEY = 'chokaguya_theme';

  // SVG Icons for Light (Sun) and Dark (Moon) modes
  var SUN_ICON = '<svg class="theme-icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';
  var MOON_ICON = '<svg class="theme-icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';

  function getPreferredTheme() {
    var stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
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
    updateButtons(theme);
    updateLogos(theme);
  }

  function toggleTheme() {
    var current = document.documentElement.getAttribute('data-theme') || getPreferredTheme();
    var next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next, true);
  }

  function updateButtons(theme) {
    var buttons = document.querySelectorAll('.theme-toggle-btn');
    buttons.forEach(function (btn) {
      btn.setAttribute('aria-label', theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환');
      btn.title = theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환';
      btn.innerHTML = theme === 'dark' ? SUN_ICON : MOON_ICON;
    });
  }

  function updateLogos(theme) {
    var logos = document.querySelectorAll('img[data-light-src][data-dark-src]');
    logos.forEach(function (img) {
      var targetSrc = theme === 'dark' ? img.getAttribute('data-dark-src') : img.getAttribute('data-light-src');
      if (targetSrc && img.getAttribute('src') !== targetSrc) {
        img.src = targetSrc;
      }
    });
  }

  function injectThemeToggle() {
    var nav = document.querySelector('.header-nav');
    if (!nav || nav.querySelector('.theme-toggle-btn')) return;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-toggle-btn';
    var currentTheme = document.documentElement.getAttribute('data-theme') || getPreferredTheme();
    btn.setAttribute('aria-label', currentTheme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환');
    btn.title = currentTheme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환';
    btn.innerHTML = currentTheme === 'dark' ? SUN_ICON : MOON_ICON;

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggleTheme();
    });

    nav.appendChild(btn);
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

  // Inject when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      injectThemeToggle();
      updateLogos(initialTheme);
    });
  } else {
    injectThemeToggle();
    updateLogos(initialTheme);
  }

  global.ThemeManager = {
    getTheme: function () { return document.documentElement.getAttribute('data-theme') || getPreferredTheme(); },
    setTheme: applyTheme,
    toggle: toggleTheme
  };
})(window);
