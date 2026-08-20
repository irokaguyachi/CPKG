/**
 * ChoKaguya Shared Favorites Viewer
 * - Reads ?share=<code> from the URL, fetches that snapshot via
 *   FavoritesShareRemote.fetchShared() (favoritesShareRemote.js), and
 *   cross-references the decoded IDs against Series.json / HOF.json /
 *   Official.json to render the actual cards — read-only, no star/toggle
 *   button and nothing is written to this browser's own Favorites store.
 */
(function (global) {
  var SECTIONS = [
    {
      type: 'novel',
      title: '문학',
      dataUrl: '../data/PageData/Novel.json',
      numberPrefix: 'N'
    },
    {
      type: 'series',
      title: '시리즈',
      dataUrl: '../data/PageData/Series.json',
      numberPrefix: 'S'
    },
    {
      type: 'hof',
      title: '명예관',
      dataUrl: '../data/PageData/HOF.json',
      numberPrefix: 'H'
    },
    {
      type: 'official',
      title: '공식',
      dataUrl: '../data/PageData/Official.json',
      numberPrefix: 'O'
    }
  ];

  var sectionsEl = document.getElementById('fav-sections');
  var countEl = document.getElementById('fav-count');
  var DATA = global.dataUrl || function (p) { return p; };

  function showMessage(text) {
    sectionsEl.innerHTML = '';
    var p = document.createElement('p');
    p.className = 'series-empty';
    p.textContent = text;
    sectionsEl.appendChild(p);
  }

  function createCard(config, s) {
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
    card.appendChild(image);

    var info = document.createElement('div');
    info.className = 'series-card-info';

    var title = document.createElement('p');
    title.className = 'series-card-title';
    title.textContent = s.name;
    info.appendChild(title);

    var count = document.createElement('p');
    count.className = 'series-card-count';
    count.textContent = SeriesUtil.countLine(s) + ' | ' + SeriesUtil.itemNumber(s);
    info.appendChild(count);

    card.appendChild(info);

    card.addEventListener('click', function () {
      if (!global.PostDetailSeries) return;
      PostDetailSeries.open({
        seriesName: s.name,
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
    items.forEach(function (s) { grid.appendChild(createCard(config, s)); });
    section.appendChild(grid);

    return section;
  }

  function loadShared(code) {
    if (!global.FavoritesShareRemote) {
      showMessage('공유 기능을 불러오지 못했어요.');
      return;
    }

    global.FavoritesShareRemote.fetchShared(code)
      .then(function (favBuckets) {
        var totalCount = favBuckets.novel.length + favBuckets.series.length + favBuckets.hof.length + favBuckets.official.length;
        if (countEl) countEl.textContent = totalCount + '개의 즐겨찾기를 공유받았어요!';

        var fetches = SECTIONS.map(function (config) {
          return fetch(DATA(config.dataUrl)).then(function (r) { return r.json(); }).catch(function () { return []; });
        });

        return Promise.all(fetches).then(function (results) {
          var anyRendered = false;
          SECTIONS.forEach(function (config, i) {
            var allItems = Array.isArray(results[i]) ? results[i] : [];
            SeriesUtil.assignPostNumbers(allItems, config.numberPrefix);
            SeriesUtil.assignSeriesNumbers(allItems, config.numberPrefix);
            var favIds = favBuckets[config.type] || [];
            if (!favIds.length) return;
            var matched = allItems.filter(function (item) {
              return item.posts && item.posts[0] && favIds.indexOf(item.posts[0].id) !== -1;
            });
            if (!matched.length) return;
            anyRendered = true;
            sectionsEl.appendChild(renderSection(config, matched));
          });
          if (!anyRendered) showMessage('공유받은 즐겨찾기에는 아직 항목이 없어요.');
        });
      })
      .catch(function (err) {
        if (countEl) countEl.textContent = '불러오기 실패';
        showMessage((err && err.message) || '공유받은 즐겨찾기를 불러오지 못했어요.');
      });
  }

  var code = new URLSearchParams(global.location.search).get('share');
  if (!code) {
    if (countEl) countEl.textContent = '공유 코드가 없어요';
    showMessage('링크에 공유 코드(?share=...)가 없어요. 공유받은 링크를 다시 확인해주세요.');
  } else {
    loadShared(code);
  }
})(window);
