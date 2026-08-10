(function () {
  var tipEl = document.getElementById('loader-tip-text');
  var iconEl = document.getElementById('loader-icon');

  if (tipEl) {
    fetch('../data/Tip.json')
      .then(function (r) { return r.json(); })
      .then(function (tips) {
        if (!Array.isArray(tips) || !tips.length) return;
        var order = shuffle(tips.slice());
        var idx = 0;
        function cycle() {
          if (idx >= order.length) { order = shuffle(tips.slice()); idx = 0; }
          var text = order[idx];
          idx++;
          typeText(tipEl, text, 45, function () {
            setTimeout(cycle, 2200);
          });
        }
        cycle();
      })
      .catch(function () {});
  }

  if (iconEl) {
    fetch('../data/LoadingIcons.json')
      .then(function (r) { return r.json(); })
      .then(function (files) {
        if (!Array.isArray(files) || !files.length) return;
        var idx = 0;
        function showNext() {
          iconEl.style.backgroundImage = 'url(../assets/Image/LoadingIcon/' + files[idx % files.length] + ')';
          idx++;
        }
        showNext();
        setInterval(showNext, 1200);
      })
      .catch(function () {});
  }

  function typeText(el, text, speed, done) {
    el.textContent = '';
    var i = 0;
    var timer = setInterval(function () {
      el.textContent += text.charAt(i);
      i++;
      if (i >= text.length) {
        clearInterval(timer);
        if (done) done();
      }
    }, speed);
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }
})();

(function () {
  var wipeEl = document.getElementById('loader-wipe');
  var contentEl = document.getElementById('loader-content');
  var loaderEl = document.getElementById('loader');
  if (!wipeEl || !loaderEl) return;

  // intro: white circle covers the screen, then shrinks away to nothing
  // while the content fades in at the same time, so the two blend together
  // instead of one waiting for the other to finish.
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      wipeEl.classList.remove('is-covering');
      if (contentEl) contentEl.classList.add('is-visible');
    });
  });

  // outro: call window.finishLoading() once the real page content is ready.
  // the circle grows back to cover the screen while the content fades out,
  // then once the circle fully covers everything the whole loader hides.
  var OUTRO_MS = 2200;
  window.finishLoading = function () {
    if (contentEl) contentEl.classList.remove('is-visible');
    wipeEl.style.transitionDuration = OUTRO_MS + 'ms, ' + OUTRO_MS + 'ms, ' + OUTRO_MS + 'ms';
    wipeEl.classList.add('is-covering');
    setTimeout(function () {
      loaderEl.classList.add('is-hidden');
    }, OUTRO_MS);
  };

  // DEMO ONLY: no real page content to wait on yet, so trigger the outro
  // automatically. Replace this with a real call to window.finishLoading()
  // once this loading screen is wired up to actual content loading.
  setTimeout(function () { window.finishLoading(); }, 6500);
})();
