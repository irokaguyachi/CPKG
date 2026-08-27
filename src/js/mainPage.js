(function (global) {
  var contentEl = document.getElementById('content');
  if (!contentEl) return;

  var DATA = global.dataUrl || function (p) { return p; };

  // 태그 색상/이모지/정렬 — gridPage.js와 공유하는 단일 소스(tagConfig.js)로 옮김.
  // 예전엔 이 파일이 직접 들고 있었는데, gridPage.js가 쓰던 표와 이모지 9개가
  // 실제로 어긋나 있었다(같은 태그가 페이지마다 다르게 보임) — tagConfig.js의
  // 헤더 주석에 병합 기준을 적어뒀다.
  var TAG_COLORS = global.TagConfig.TAG_COLORS;
  var DEFAULT_TAG_COLOR = global.TagConfig.DEFAULT_TAG_COLOR;
  var TAG_EMOJI = global.TagConfig.TAG_EMOJI;
  var DEFAULT_EMOJI = global.TagConfig.DEFAULT_EMOJI;
  var sortTags = global.TagConfig.sortTags;

  function formatCount(n) {
    if (n === null || n === undefined) return '0';
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function createCard(item, favType) {
    var card = document.createElement('article');
    card.className = 'post-row';

    var image = document.createElement('div');
    image.className = 'post-row-image';
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
    info.className = 'post-row-info';

    var title = document.createElement('p');
    title.className = 'post-row-title';

    var name = document.createElement('span');
    name.className = 'post-row-name';
    name.textContent = item.name || '제목 없음';
    title.appendChild(name);

    if (favId != null) {
      var idSpan = document.createElement('span');
      idSpan.className = 'post-row-id';
      idSpan.textContent = '| ' + favId;
      title.appendChild(idSpan);
    }
    info.appendChild(title);

    var tagsWrap = document.createElement('div');
    tagsWrap.className = 'post-row-tags';
    // 4개째부터는 2줄로 넘어가면서 형제 카드와 높이가 어긋나므로 3개까지만 보여준다
    sortTags(item.tags).slice(0, 3).forEach(function (tag) {
      var pill = document.createElement('span');
      pill.className = 'series-card-tag';
      pill.dataset.tag = tag;
      pill.textContent = (TAG_EMOJI[tag] || DEFAULT_EMOJI) + ' ' + tag;
      pill.style.background = TAG_COLORS[tag] || DEFAULT_TAG_COLOR;
      tagsWrap.appendChild(pill);
    });
    info.appendChild(tagsWrap);

    card.appendChild(info);

    var episode = document.createElement('div');
    episode.className = 'post-row-episode';
    var countText = (item.posts && item.posts.length > 1)
      ? item.posts.length + '화'
      : (item.charCount || '단편');
    episode.textContent = countText;
    card.appendChild(episode);

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

  // 5초마다 다른 랜덤 항목 하나를 보여주는 스포트라이트 섹션.
  // 최신 등록과 달리 전체 목록에서 뽑아야 하므로 dataUrl 전체를 fetch한다
  // (Series.json ~170KB, HOF.json ~14KB — Recent.json 최적화 때 피했던
  // 큰 파일이지만, 랜덤 뽑기 특성상 전체를 안 받으면 뽑을 수 없다).
  function createRandomSection(title, dataUrl, href, favType) {
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
    section.appendChild(list);

    fetch(DATA(dataUrl))
      .then(function (r) { return r.json(); })
      .then(function (items) {
        items = Array.isArray(items) ? items : [];
        if (!items.length) {
          section.remove();
          return;
        }

        var lastIndex = -1;
        function pickItem() {
          if (items.length === 1) return items[0];
          var idx;
          do { idx = Math.floor(Math.random() * items.length); } while (idx === lastIndex);
          lastIndex = idx;
          return items[idx];
        }

        function insertCard() {
          var card = createCard(pickItem(), favType);
          card.style.opacity = '0';
          list.appendChild(card);
          // 두 번의 rAF로 opacity:0 스타일이 먼저 반영된 뒤에 전환을 걸어야
          // 브라우저가 초기값과 최종값을 다른 프레임으로 인식해 트랜지션이 재생된다
          requestAnimationFrame(function () {
            requestAnimationFrame(function () {
              card.style.opacity = '1';
            });
          });
        }

        // 백그라운드 탭에서는 타이머가 지연됐다가 한꺼번에 몰아서 실행될 수
        // 있다 — 그러면 이전 showNext() 의 300ms 제거 타이머가 아직 안 끝난
        // 채로 다음 showNext() 가 또 시작돼서, oldCard 가 이미 다른 호출에
        // 의해 제거된 상태라 removeChild 는 조용히 스킵되는데 insertCard() 는
        // 그대로 실행돼 카드가 지워지지 않고 계속 쌓였다. isTransitioning 으로
        // 겹치는 호출을 막고, 혹시 이미 쌓여있는 카드가 있어도 매 주기마다
        // list 에 남아있는 자식을 전부 정리해서 항상 카드 1개만 남긴다.
        var isTransitioning = false;
        function showNext() {
          if (isTransitioning) return;
          var stale = Array.prototype.slice.call(list.children);
          if (!stale.length) {
            insertCard();
            return;
          }
          isTransitioning = true;
          stale.forEach(function (el) { el.style.opacity = '0'; });
          setTimeout(function () {
            stale.forEach(function (el) { if (el.parentNode === list) list.removeChild(el); });
            insertCard();
            isTransitioning = false;
          }, 300);
        }

        // gridPage.js의 검색 placeholder 타이핑 로직과 같은 이유로, 백그라운드
        // 탭에서는 회전을 멈춘다 — 안 그러면 setInterval이 탭을 벗어나도
        // 영구히 돌면서 불필요한 DOM 작업을 계속 쌓는다.
        var rotateTimer = null;
        function stopRotate() {
          if (rotateTimer) { clearInterval(rotateTimer); rotateTimer = null; }
        }
        function startRotate() {
          if (!rotateTimer) rotateTimer = setInterval(showNext, 5000);
        }
        function syncRotate() {
          if (document.hidden) stopRotate();
          else startRotate();
        }
        document.addEventListener('visibilitychange', syncRotate);

        showNext();
        syncRotate();
      })
      .catch(function () { section.remove(); });

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

      // 2. 랜덤 문학 — 5초마다 다른 문학으로 자동 전환
      contentEl.appendChild(createRandomSection('랜덤 문학', '../data/PageData/Novel.json', 'novelPage.html', 'novel'));

      // 3. 랜덤 시리즈 — 동일하게 5초마다 자동 전환
      contentEl.appendChild(createRandomSection('랜덤 시리즈', '../data/PageData/Series.json', 'seriesPage.html', 'series'));

      // 4. 랜덤 명예관 — 동일하게 5초마다 자동 전환
      contentEl.appendChild(createRandomSection('랜덤 명예관', '../data/PageData/HOF.json', 'HOFPage.html', 'hof'));
    })
    .catch(function () {});
})(window);
