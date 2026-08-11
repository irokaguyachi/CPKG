(function (global) {
  var ICON_VIEW = '<svg class="post-stat-icon" width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true"><path d="M0.5 7.5C2 3.5 5 1.5 7.5 1.5C10 1.5 13 3.5 14.5 7.5C13 11.5 10 13.5 7.5 13.5C5 13.5 2 11.5 0.5 7.5Z" stroke="#000000"/><circle cx="7.5" cy="7.5" r="2.5" stroke="#000000"/></svg>';
  var ICON_LIKE = '<svg class="post-stat-icon" width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true"><path d="M8.5 1.5L10.6 6L15.5 6.6L11.9 9.9L12.9 14.7L8.5 12.2L4.1 14.7L5.1 9.9L1.5 6.6L6.4 6L8.5 1.5Z" stroke="#000000" stroke-linejoin="round"/></svg>';

  // data: { title, id, tagColor, tagLabel, views, likes, imageUrl, href }
  function createPostCard(data) {
    data = data || {};

    var card = document.createElement('article');
    card.className = 'post-card';

    var image = document.createElement('div');
    image.className = 'post-image';
    if (data.imageUrl) {
      image.style.backgroundImage = 'url("' + data.imageUrl + '")';
      image.style.backgroundSize = 'cover';
      image.style.backgroundPosition = 'center';
    }
    card.appendChild(image);

    var info = document.createElement('div');
    info.className = 'post-info';

    var title = document.createElement('p');
    title.className = 'post-title';
    title.textContent = (data.title || '게시물 이름') + ' ';
    var idSpan = document.createElement('span');
    idSpan.className = 'post-title-id';
    idSpan.textContent = '| ' + (data.id != null ? data.id : '게시물 ID');
    title.appendChild(idSpan);
    info.appendChild(title);

    var tagWrap = document.createElement('div');
    tagWrap.className = 'post-tag';
    var pill = document.createElement('span');
    pill.className = 'post-tag-pill';
    if (data.tagColor) pill.style.background = data.tagColor;
    if (data.tagLabel) pill.textContent = data.tagLabel;
    tagWrap.appendChild(pill);
    info.appendChild(tagWrap);

    var stats = document.createElement('div');
    stats.className = 'post-stats';
    stats.appendChild(createStat(ICON_VIEW, data.views));
    stats.appendChild(createStat(ICON_LIKE, data.likes));
    info.appendChild(stats);

    card.appendChild(info);

    if (data.href) {
      var link = document.createElement('a');
      link.href = data.href;
      link.style.display = 'contents';
      link.appendChild(card);
      return link;
    }
    return card;
  }

  function createStat(iconMarkup, value) {
    var wrap = document.createElement('span');
    wrap.className = 'post-stat';

    var iconHost = document.createElement('div');
    iconHost.innerHTML = iconMarkup;
    wrap.appendChild(iconHost.firstElementChild);

    var valueEl = document.createElement('span');
    valueEl.textContent = formatCount(value);
    wrap.appendChild(valueEl);

    return wrap;
  }

  function formatCount(n) {
    if (n === null || n === undefined) return '000,000';
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function renderPostList(container, items) {
    if (!container) return;
    container.innerHTML = '';
    (items || []).forEach(function (item) {
      container.appendChild(createPostCard(item));
    });
  }

  global.PostCard = {
    create: createPostCard,
    renderList: renderPostList
  };
})(window);
