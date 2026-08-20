/**
 * ChoKaguya Favorites Page
 * - Cross-references the locally stored favorite IDs (src/js/favorites.js)
 *   against Series.json / HOF.json / Official.json to render the actual
 *   favorited cards, and wires up the "공유 링크 만들기" button
 *   (favoritesShareRemote.js). The novel bucket has no page/data yet, so
 *   it's skipped here until a literature page exists.
 */
(function (global) {
  var STAR_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>';

  var SECTIONS = [
    {
      type: 'series',
      title: '시리즈',
      dataUrl: '../data/PageData/Series.json',
      numberPrefix: 'S',
      countLine: function (s) { return s.episodeCount + '화'; }
    },
    {
      type: 'hof',
      title: '명예관',
      dataUrl: '../data/PageData/HOF.json',
      numberPrefix: 'H',
      countLine: function (s) { return s.charCount || (s.episodeCount + '화'); }
    },
    {
      type: 'official',
      title: '공식',
      dataUrl: '../data/PageData/Official.json',
      numberPrefix: 'O',
      countLine: function (s) { return s.charCount || (s.episodeCount + '화'); }
    }
  ];

  var sectionsEl = document.getElementById('fav-sections');
  var countEl = document.getElementById('fav-count');
  var DATA = global.dataUrl || function (p) { return p; };

  // mirrors gridPage.js's numbering so an episode opened from here shows the
  // same S1/H1/O1-style id the visitor originally saw on the grid page
  function assignPostNumbers(items, prefix) {
    var counter = 1;
    items.forEach(function (s) {
      (s.posts || []).forEach(function (post) {
        post.customNo = prefix + counter;
        counter++;
      });
    });
  }

  function createFavButton(type, id, onRemoved) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'series-card-fav is-fav';
    btn.innerHTML = STAR_ICON;
    btn.setAttribute('aria-label', '즐겨찾기 해제');
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (global.Favorites) global.Favorites.toggle(type, id);
      onRemoved();
    });
    return btn;
  }

  function createCard(config, s, grid, section) {
    var card = document.createElement('article');
    card.className = 'series-card';

    var image = document.createElement('div');
    image.className = 'series-card-image';
    if (s.image) {
      if (global.lazyLoadBackground) {
        global.lazyLoadBackground(image, s.image);
      } else {
        var finalImg = global.resolveThumbUrl ? global.resolveThumbUrl(s.image) : s.image;
        image.style.backgroundImage = 'url("' + finalImg + '")';
      }
    }

    var favId = s.posts && s.posts[0] && s.posts[0].id;
    if (favId != null) {
      image.appendChild(createFavButton(config.type, favId, function () {
        card.remove();
        if (!grid.children.length) section.remove();
      }));
    }
    card.appendChild(image);

    var info = document.createElement('div');
    info.className = 'series-card-info';

    var title = document.createElement('p');
    title.className = 'series-card-title';
    title.textContent = s.name;
    info.appendChild(title);

    var count = document.createElement('p');
    count.className = 'series-card-count';
    count.textContent = config.countLine(s);
    info.appendChild(count);

    card.appendChild(info);

    card.addEventListener('click', function () {
      if (!global.PostDetailSeries) return;
      PostDetailSeries.open({
        seriesName: s.name,
        episodeCount: s.episodeCount,
        imageUrl: s.image,
        episodes: (s.posts || []).map(function (post) {
          return {
            title: post.title,
            id: post.customNo,
            dcId: post.id,
            link: post.link,
            episodeLabel: post.episode + ' 화'
          };
        })
      });
    });

    return card;
  }

  function renderSection(config, items) {
    var section = document.createElement('section');
    section.className = 'fav-section';

    var heading = document.createElement('h2');
    heading.className = 'fav-section-title';
    heading.textContent = config.title;
    section.appendChild(heading);

    var grid = document.createElement('div');
    grid.className = 'series-grid';
    section.appendChild(grid);

    items.forEach(function (s) {
      grid.appendChild(createCard(config, s, grid, section));
    });

    return section;
  }

  function loadAll() {
    var favBuckets = global.Favorites
      ? global.Favorites.getAll()
      : { novel: [], series: [], hof: [], official: [] };
    var totalCount = favBuckets.novel.length + favBuckets.series.length + favBuckets.hof.length + favBuckets.official.length;
    if (countEl) countEl.textContent = totalCount + '개의 즐겨찾기가 있습니다!';

    var fetches = SECTIONS.map(function (config) {
      return fetch(DATA(config.dataUrl)).then(function (r) { return r.json(); }).catch(function () { return []; });
    });

    Promise.all(fetches).then(function (results) {
      var anyRendered = false;
      SECTIONS.forEach(function (config, i) {
        var allItems = Array.isArray(results[i]) ? results[i] : [];
        assignPostNumbers(allItems, config.numberPrefix);
        var favIds = favBuckets[config.type] || [];
        if (!favIds.length) return;
        var matched = allItems.filter(function (item) {
          return item.posts && item.posts[0] && favIds.indexOf(item.posts[0].id) !== -1;
        });
        if (!matched.length) return;
        anyRendered = true;
        sectionsEl.appendChild(renderSection(config, matched));
      });
      if (!anyRendered) {
        var empty = document.createElement('p');
        empty.className = 'series-empty';
        empty.textContent = '아직 즐겨찾기한 게시물이 없어요.';
        sectionsEl.appendChild(empty);
      }
    });
  }

  loadAll();

  // 공유 링크 위젯
  var shareBtn = document.getElementById('fav-share-btn');
  var resultRow = document.getElementById('fav-share-result');
  var shareInput = document.getElementById('fav-share-input');
  var copyBtn = document.getElementById('fav-share-copy-btn');
  var statusEl = document.getElementById('fav-share-status');

  if (shareBtn) {
    shareBtn.addEventListener('click', function () {
      if (!global.FavoritesShareRemote) return;
      shareBtn.disabled = true;
      statusEl.textContent = '';
      statusEl.classList.remove('is-error');
      global.FavoritesShareRemote.createShareLink()
        .then(function (result) {
          shareInput.value = result.pageUrl;
          resultRow.hidden = false;
          statusEl.textContent = '링크가 만들어졌어요!';
        })
        .catch(function (err) {
          statusEl.textContent = (err && err.message) || '공유 링크 생성에 실패했어요.';
          statusEl.classList.add('is-error');
        })
        .finally(function () {
          shareBtn.disabled = false;
        });
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      if (!shareInput.value) return;
      navigator.clipboard.writeText(shareInput.value).then(function () {
        statusEl.textContent = '복사했어요!';
        statusEl.classList.remove('is-error');
      }).catch(function () {
        statusEl.textContent = '복사에 실패했어요. 직접 선택해서 복사해주세요.';
        statusEl.classList.add('is-error');
      });
    });
  }
})(window);
