(function () {
  var TOP_THRESHOLD = 10;

  function onScroll() {
    if (window.scrollY > TOP_THRESHOLD) {
      document.body.classList.remove('is-top');
      window.removeEventListener('scroll', onScroll);
    }
  }

  if (window.scrollY <= TOP_THRESHOLD) {
    document.body.classList.add('is-top');
    window.addEventListener('scroll', onScroll, { passive: true });
  } else {
    document.body.classList.remove('is-top');
  }
})();

(function (global) {
  var contentEl = document.getElementById('content');
  if (!contentEl) return;

  var DATA = global.dataUrl || function (p) { return p; };

  var TAG_COLORS = {
    '일상': '#e2f4f2',
    '소설': '#f3ebe4',
    '장편': '#e6f4df',
    '로맨스': '#fae4ec',
    '슬픔': '#e8ecf8',
    '코미디': '#faf1d2',
    '피폐': '#fae4e4',
    '후방주의': '#fae4e4',
    '짧문': '#f5e4f2',
    '단편': '#eee4fb',
    '감동': '#fbf0df',
    '명예관': '#faeed4',
    '대회': '#e4eefb',
    'IF 스토리': '#fbebe4',
    '로카': '#fde2e4'
  };
  var DEFAULT_TAG_COLOR = '#efefef';

  var TAG_EMOJI = {
    '일상': '☀️',
    '소설': '📖',
    '장편': '📚',
    '로맨스': '💖',
    '슬픔': '💧',
    '코미디': '🤣',
    '피폐': '🩸',
    '후방주의': '🔞',
    '짧문': '✍️',
    '단편': '📄',
    '감동': '🥹',
    '명예관': '👑',
    '대회': '🏆',
    'IF 스토리': '🔮',
    '로카': '🌸'
  };
  var DEFAULT_EMOJI = '🏷️';

  var TAG_PRIORITY = ['로카', 'IF 스토리', '장편', '단편', '소설', '명예관', '대회'];

  function sortTags(tags) {
    if (!Array.isArray(tags)) return [];
    return tags.slice().sort(function (a, b) {
      var ia = TAG_PRIORITY.indexOf(a);
      var ib = TAG_PRIORITY.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b, 'ko');
    });
  }

  function formatCount(n) {
    if (n === null || n === undefined) return '0';
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function createCard(item, favType) {
    var card = document.createElement('article');
    card.className = 'series-card';

    var image = document.createElement('div');
    image.className = 'series-card-image';
    if (item.image) {
      if (global.lazyLoadBackground) {
        global.lazyLoadBackground(image, item.image);
      } else {
        var finalImg = global.resolveThumbUrl ? global.resolveThumbUrl(item.image) : item.image;
        image.style.backgroundImage = 'url("' + finalImg + '")';
      }
    }
    var favId = item.posts && item.posts[0] && item.posts[0].id;
    if (favId != null && global.BookmarkPicker) {
      image.appendChild(global.BookmarkPicker.createButton(favType, favId));
    }
    card.appendChild(image);

    var info = document.createElement('div');
    info.className = 'series-card-info';

    var title = document.createElement('p');
    title.className = 'series-card-title';
    title.textContent = item.name || '제목 없음';
    info.appendChild(title);

    var count = document.createElement('p');
    count.className = 'series-card-count';
    var countText = (item.posts && item.posts.length > 1)
      ? item.posts.length + '화'
      : (item.charCount || '단편');
    count.textContent = countText;
    info.appendChild(count);

    var tagsWrap = document.createElement('div');
    tagsWrap.className = 'series-card-tags';
    sortTags(item.tags).forEach(function (tag) {
      var pill = document.createElement('span');
      pill.className = 'series-card-tag';
      pill.dataset.tag = tag;
      pill.textContent = (TAG_EMOJI[tag] || DEFAULT_EMOJI) + ' ' + tag;
      pill.style.background = TAG_COLORS[tag] || DEFAULT_TAG_COLOR;
      tagsWrap.appendChild(pill);
    });
    info.appendChild(tagsWrap);

    card.appendChild(info);

    card.addEventListener('click', function (e) {
      if (e.target.closest('.bkm-heart-btn')) return;
      if (!global.PostDetailSeries) return;

      var episodes = (item.posts || []).map(function (post) {
        return {
          title: post.title,
          dcId: post.id,
          link: post.link,
          episodeLabel: (post.episode != null ? post.episode + ' 화' : (item.charCount || '1 화'))
        };
      });

      PostDetailSeries.open({
        seriesName: item.name,
        imageUrl: item.image,
        episodes: episodes
      });
    });

    return card;
  }

  function createRecentSection(title, items, href, favType) {
    var section = document.createElement('div');
    section.className = 'recent';

    var heading = href ? document.createElement('a') : document.createElement('div');
    heading.className = 'content-heading';
    if (href) heading.href = href;

    var label = document.createElement('span');
    label.textContent = title;
    heading.appendChild(label);

    var arrow = document.createElement('span');
    arrow.className = 'content-heading-arrow';
    arrow.innerHTML = '<svg width="10" height="16" viewBox="0 0 10 16" fill="none" aria-hidden="true"><path d="M1.5 1.5L8 8L1.5 14.5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    heading.appendChild(arrow);

    section.appendChild(heading);

    var list = document.createElement('div');
    list.className = 'post-list';

    (items || []).forEach(function (item) {
      list.appendChild(createCard(item, favType));
    });

    section.appendChild(list);
    return section;
  }

  // 최신 10 + 10장만 그리면서 Novel.json(약 600KB) + Series.json(약 170KB)을
  // 통째로 받아 slice(0, 10) 두 번만 쓰던 걸 걷어냈다. 랜딩 페이지라 방문자당
  // 무조건 발생하는 요청이었다. Recent.json 은 src/scripts/8_build_recent_page_data.py
  // 가 빌드 시점에 만들어 두는 파일로, 두 배열의 앞 10건을 필드 손실 없이
  // 그대로 담고 있어서 카드와 상세 모달이 예전과 똑같이 동작한다.
  // (데이터를 다시 빌드했으면 cdnConfig.js 의 DATA_VERSION 을 올릴 것)
  fetch(DATA('../data/PageData/Recent.json'))
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var novels = (data && Array.isArray(data.novels)) ? data.novels : [];
      var series = (data && Array.isArray(data.series)) ? data.series : [];
      var totals = (data && data.totals) || {};

      // 총 게시물 수 업데이트 — 전체 배열을 더 이상 안 받으므로 길이를 셀 수
      // 없다. 빌드 스크립트가 넣어둔 totals 를 쓴다.
      var statEl = document.querySelector('.site-info-stat');
      if (statEl) {
        var totalPosts = (totals.novel || 0) + (totals.series || 0);
        statEl.textContent = formatCount(totalPosts) + '개의 게시물이 있습니다!';
      }

      contentEl.innerHTML = '';

      // 1. 최신 등록 문학
      if (novels.length) {
        contentEl.appendChild(createRecentSection('최신 등록 문학', novels, 'novelPage.html', 'novel'));
      }

      // 2. 최신 등록 시리즈
      if (series.length) {
        contentEl.appendChild(createRecentSection('최신 등록 시리즈', series, 'seriesPage.html', 'series'));
      }
    })
    .catch(function () {});
})(window);
