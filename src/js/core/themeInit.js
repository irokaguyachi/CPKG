(function () {
  var s = localStorage.getItem('chokaguya_theme');
  var d = s || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', d);
})();
