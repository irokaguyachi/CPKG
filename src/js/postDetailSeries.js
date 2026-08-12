(function (global) {
  var ICON_VIEW = '<svg class="pds-stat-icon" width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true"><path d="M0.5 7.5C2 3.5 5 1.5 7.5 1.5C10 1.5 13 3.5 14.5 7.5C13 11.5 10 13.5 7.5 13.5C5 13.5 2 11.5 0.5 7.5Z" stroke="#ffffff"/><circle cx="7.5" cy="7.5" r="2.5" stroke="#ffffff"/></svg>';
  var ICON_LIKE = '<svg class="pds-stat-icon" width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true"><path d="M8.5 1.5L10.6 6L15.5 6.6L11.9 9.9L12.9 14.7L8.5 12.2L4.1 14.7L5.1 9.9L1.5 6.6L6.4 6L8.5 1.5Z" stroke="#ffffff" stroke-linejoin="round"/></svg>';
  var ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 4L20 20M20 4L4 20" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/></svg>';

  var overlayEl = null;

  function ensureOverlay() {
    if (overlayEl) return overlayEl;
    overlayEl = document.createElement('div');
    overlayEl.className = 'pds-overlay';
    overlayEl.addEventListener('click', function (e) {
      if (e.target === overlayEl) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
    document.body.appendChild(overlayEl);
    return overlayEl;
  }

  function formatCount(n) {
    if (n === null || n === undefined) return '000,000';
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function createStat(iconMarkup, value) {
    var wrap = document.createElement('span');
    wrap.className = 'pds-stat';
    var iconHost = document.createElement('div');
    iconHost.innerHTML = iconMarkup;
    wrap.appendChild(iconHost.firstElementChild);
    var valueEl = document.createElement('span');
    valueEl.textContent = formatCount(value);
    wrap.appendChild(valueEl);
    return wrap;
  }

  // data: { seriesName, episodeCount, views, likes, imageUrl, episodes: [{ title, id, link, episodeLabel }] }
  function open(data) {
    data = data || {};
    var overlay = ensureOverlay();
    overlay.innerHTML = '';

    var card = document.createElement('div');
    card.className = 'post-detail-series';

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'pds-close';
    closeBtn.setAttribute('aria-label', '닫기');
    closeBtn.innerHTML = ICON_CLOSE;
    closeBtn.addEventListener('click', close);
    card.appendChild(closeBtn);

    var image = document.createElement('div');
    image.className = 'pds-image';
    if (data.imageUrl) {
      image.style.backgroundImage = 'url("' + data.imageUrl + '")';
    }

    var imageEffect = document.createElement('div');
    imageEffect.className = 'pds-image-effect';
    image.appendChild(imageEffect);

    var seriesInfo = document.createElement('div');
    seriesInfo.className = 'pds-series-info';

    var name = document.createElement('p');
    name.className = 'pds-series-name';
    name.textContent = data.seriesName || '시리즈 이름';
    var episodeCountEl = document.createElement('span');
    episodeCountEl.className = 'pds-series-episode-count';
    episodeCountEl.textContent = (data.episodeCount != null ? data.episodeCount : '00') + ' 화';
    name.appendChild(episodeCountEl);
    seriesInfo.appendChild(name);

    var stats = document.createElement('div');
    stats.className = 'pds-stats';
    stats.appendChild(createStat(ICON_VIEW, data.views));
    stats.appendChild(createStat(ICON_LIKE, data.likes));
    seriesInfo.appendChild(stats);

    image.appendChild(seriesInfo);
    card.appendChild(image);

    var gradient = document.createElement('div');
    gradient.className = 'pds-gradient';
    card.appendChild(gradient);

    var list = document.createElement('div');
    list.className = 'pds-list';
    (data.episodes || []).forEach(function (ep) {
      list.appendChild(createEpisodeItem(ep));
    });
    card.appendChild(list);

    overlay.appendChild(card);
    requestAnimationFrame(function () {
      overlay.classList.add('is-open');
    });
  }

  function createEpisodeItem(ep) {
    ep = ep || {};
    var item = document.createElement('a');
    item.className = 'pds-episode-item';
    item.href = ep.link || '#';
    item.target = '_blank';
    item.rel = 'noopener noreferrer';

    var title = document.createElement('p');
    title.className = 'pds-episode-title';
    title.textContent = (ep.title || '게시물 이름') + ' ';
    var idSpan = document.createElement('span');
    idSpan.className = 'pds-episode-id';
    idSpan.textContent = '| ' + (ep.id != null ? ep.id : '게시물 ID');
    title.appendChild(idSpan);
    item.appendChild(title);

    var link = document.createElement('p');
    link.className = 'pds-episode-link';
    link.textContent = ep.link || '게시물 링크';
    item.appendChild(link);

    var badge = document.createElement('span');
    badge.className = 'pds-episode-badge';
    badge.textContent = ep.episodeLabel || '00 화';
    item.appendChild(badge);

    return item;
  }

  function close() {
    if (!overlayEl) return;
    overlayEl.classList.remove('is-open');
  }

  global.PostDetailSeries = {
    open: open,
    close: close
  };
})(window);
