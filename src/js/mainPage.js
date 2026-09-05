(function (global) {
  var contentEl = document.getElementById('content');
  if (!contentEl) return;

  var DATA = global.dataUrl || function (p) { return p; };

  // 오디오 노벨 홍보 카드를 한 번 닫으면 이 브라우저에서는 다시 안 뜨도록
  // 기억하는 키 — chokaguya_theme/chokaguya_tipVisited와 같은 네이밍 관례.
  var AUDIO_PROMO_DISMISS_KEY = 'chokaguya_audioPromoDismissed';

  // 태그 색상/이모지/정렬 — gridPage.js와 공유하는 단일 소스(tagConfig.js)로 옮김.
  // 예전엔 이 파일이 직접 들고 있었는데, gridPage.js가 쓰던 표와 이모지 9개가
  // 실제로 어긋나 있었다(같은 태그가 페이지마다 다르게 보임) — tagConfig.js의
  // 헤더 주석에 병합 기준을 적어뒀다.
  var TAG_COLORS = global.TagConfig.TAG_COLORS;
  var DEFAULT_TAG_COLOR = global.TagConfig.DEFAULT_TAG_COLOR;
  var TAG_EMOJI = global.TagConfig.TAG_EMOJI;
  var DEFAULT_EMOJI = global.TagConfig.DEFAULT_EMOJI;
  var sortTags = global.TagConfig.sortTags;

  // 설정이 꺼져 있으면(기본값) `후방주의` 태그가 붙은 항목을 최신/랜덤
  // 섹션과 오디오 노벨 홍보 배너 후보에서 제외한다 — gridPage.js의 grid/
  // 검색 필터와 같은 기준(ContentSettings.isBlocked)을 공유한다.
  function filterMature(items) {
    if (!global.ContentSettings) return items;
    return items.filter(function (item) { return !global.ContentSettings.isBlocked(item.tags); });
  }

  function formatCount(n) {
    if (n === null || n === undefined) return '0';
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  // gridPage.js와 같은 기준(화들 중 하나라도 post.reader가 있으면 오디오
  // 노벨 리본 표시) — 카드 마크업이 이 파일 소유라 gridPage.js의 함수를
  // 그대로 재사용할 수 없어 같은 로직을 복사해 둔다.
  function hasAudioNovel(item) {
    var posts = item && item.posts;
    if (!posts || !posts.length) return false;
    for (var i = 0; i < posts.length; i++) {
      if (posts[i] && posts[i].reader) return true;
    }
    return false;
  }

  // 시리즈/작품 상세 모달(PostDetailSeries)에 넘길 화 목록 매핑 — createCard의
  // 클릭 핸들러와 오디오 노벨 홍보 카드가 함께 쓰도록 뽑아둔 공용 헬퍼.
  function buildEpisodes(item) {
    return (item.posts || []).map(function (post) {
      return {
        title: post.title,
        dcId: post.id,
        link: post.link,
        reader: post.reader,
        episodeLabel: (post.episode != null ? post.episode + ' 화' : (item.charCount || '1 화'))
      };
    });
  }

  function createAudioRibbon() {
    var ribbon = document.createElement('span');
    ribbon.className = 'audio-novel-ribbon';
    var icon = document.createElement('span');
    icon.className = 'audio-novel-ribbon-icon';
    icon.textContent = '🎧';
    var label = document.createElement('span');
    label.className = 'audio-novel-ribbon-label';
    label.textContent = '오디오노벨';
    ribbon.appendChild(icon);
    ribbon.appendChild(label);
    return ribbon;
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
    if (hasAudioNovel(item)) {
      image.appendChild(createAudioRibbon());
      card.classList.add('is-audio-novel');
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

      PostDetailSeries.open({
        seriesName: item.name,
        imageUrl: item.image,
        favType: favType,
        postId: favId,
        tags: item.tags,
        episodes: buildEpisodes(item)
      });
    });

    return card;
  }

  // 메인페이지 최상단 오디오 노벨 홍보 카드 — 특정 작품명을 문구에 박아두지
  // 않고 범용 소개로 두었기 때문에, 실제로 보여줄 작품(썸네일/클릭 시 열릴
  // 상세 모달)은 Official.json에서 오디오 노벨이 연결된 첫 항목을 찾아 쓴다.
  // 나중에 다른 작품에도 오디오 노벨이 붙어도 이 함수는 손댈 필요가 없다.
  function createAudioPromoBanner(item) {
    var card = document.createElement('article');
    card.className = 'audio-novel-promo';

    var thumb = document.createElement('div');
    thumb.className = 'audio-novel-promo-thumb';
    if (item.image) {
      if (global.lazyLoadBackground) {
        global.lazyLoadBackground(thumb, item.image);
      } else {
        var finalImg = global.resolveThumbUrl ? global.resolveThumbUrl(item.image) : item.image;
        thumb.style.backgroundImage = 'url("' + finalImg + '")';
      }
    }
    card.appendChild(thumb);

    var body = document.createElement('div');
    body.className = 'audio-novel-promo-body';

    var eyebrow = document.createElement('p');
    eyebrow.className = 'audio-novel-promo-eyebrow';
    eyebrow.textContent = '🎧 오디오 노벨';
    body.appendChild(eyebrow);

    var desc = document.createElement('p');
    desc.className = 'audio-novel-promo-desc';
    desc.textContent = '이제 소설을 눈이 아니라 귀로도 즐길 수 있어요';
    body.appendChild(desc);

    var cta = document.createElement('span');
    cta.className = 'audio-novel-promo-cta';
    var ctaLabel = document.createElement('span');
    ctaLabel.textContent = '더 알아보기';
    cta.appendChild(ctaLabel);
    var ctaArrow = document.createElement('span');
    ctaArrow.className = 'content-heading-arrow';
    ctaArrow.innerHTML = '<svg width="10" height="16" viewBox="0 0 10 16" fill="none" aria-hidden="true"><path d="M1.5 1.5L8 8L1.5 14.5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    cta.appendChild(ctaArrow);
    body.appendChild(cta);

    card.appendChild(body);

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'audio-novel-promo-close';
    closeBtn.setAttribute('aria-label', '닫기');
    closeBtn.textContent = '×';
    card.appendChild(closeBtn);

    card.addEventListener('click', function (e) {
      if (e.target.closest('.audio-novel-promo-close')) return;
      if (!global.PostDetailSeries) return;

      PostDetailSeries.open({
        seriesName: item.name,
        imageUrl: item.image,
        episodes: buildEpisodes(item)
      });
    });

    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      try { localStorage.setItem(AUDIO_PROMO_DISMISS_KEY, '1'); } catch (err) {}
      card.classList.add('is-dismissing');
      // CSS 트랜지션(0.2s)이 끝난 뒤 DOM에서 제거 — series-card.css의 트랜지션
      // 관례와 같은 시간 감각으로 맞춤.
      setTimeout(function () {
        if (card.parentNode) card.parentNode.removeChild(card);
      }, 220);
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
        items = filterMature(Array.isArray(items) ? items : []);
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

  // 야치요 생일 축하 배너 (Figma "Birthday Banner", node 2257:2) — 이벤트
  // 기간에만 콘텐츠 맨 위에 붙인다. 종료 후엔 이 함수와 아래 호출부,
  // birthday-banner.css, mainPage.html의 <link> 만 지우면 된다.
  // 9월 2일 00:00(KST)이 지나면 자동으로 숨긴다 — 방문자의 로컬 시간대와
  // 무관하게 항상 같은 실제 시각에 사라지도록 오프셋(+09:00)을 명시한다.
  var BIRTHDAY_BANNER_END = new Date('2026-09-02T00:00:00+09:00').getTime();

  function createBirthdayBanner() {
    var banner = document.createElement('div');
    banner.className = 'birthday-banner';

    var text = document.createElement('div');
    text.className = 'birthday-banner-text';

    var title = document.createElement('p');
    title.className = 'birthday-banner-title';
    title.textContent = 'HAPPY BIRTHDAY YACHIYO!';
    text.appendChild(title);

    var desc = document.createElement('p');
    desc.className = 'birthday-banner-desc';
    desc.textContent = '8월 32일은 야치요의 생일입니다 모두 야치요의 생일을 축하해줍시다!';
    text.appendChild(desc);

    // 팬케이크 주기 버튼 + 카운트 — 실제 클릭 처리는 src/js/pancakeCounter.js
    var ctaRow = document.createElement('div');
    ctaRow.className = 'birthday-banner-cta-row';

    var ctaBtn = document.createElement('button');
    ctaBtn.type = 'button';
    ctaBtn.id = 'birthday-pancake-btn';
    ctaBtn.className = 'birthday-banner-cta';
    ctaBtn.textContent = '🥞 생일 기념 팬케이크 주기!';
    ctaRow.appendChild(ctaBtn);

    var countEl = document.createElement('span');
    countEl.id = 'birthday-pancake-count';
    countEl.className = 'birthday-banner-pancake-count';
    ctaRow.appendChild(countEl);

    text.appendChild(ctaRow);

    banner.appendChild(text);

    var art = document.createElement('div');
    art.className = 'birthday-banner-art';
    art.setAttribute('aria-hidden', 'true');
    banner.appendChild(art);

    return banner;
  }

  // 오디오 노벨 홍보 카드 — #content의 첫 자식으로 붙는다. Recent.json 쪽
  // fetch가 응답하면 contentEl.innerHTML = '' 로 #content를 통째로 비우고
  // 다시 채우는데, 이 배너가 그보다 먼저 붙어있었다면 함께 지워진다. 그래서
  // 두 fetch 중 어느 쪽이 먼저 끝나든 항상 배너가 맨 위에 있도록, 만들어둔
  // 배너를 audioPromoEl에 쥐고 있다가 필요한 시점마다 placeAudioPromo()로
  // 다시 끼워 넣는다.
  var audioPromoEl = null;
  function placeAudioPromo() {
    if (audioPromoEl && audioPromoEl.parentNode !== contentEl) {
      contentEl.insertBefore(audioPromoEl, contentEl.firstChild);
    }
  }

  var audioPromoDismissed = false;
  try { audioPromoDismissed = !!localStorage.getItem(AUDIO_PROMO_DISMISS_KEY); } catch (e) {}

  if (!audioPromoDismissed) {
    fetch(DATA('../data/PageData/Official.json'))
      .then(function (r) { return r.json(); })
      .then(function (items) {
        items = filterMature(Array.isArray(items) ? items : []);
        var promoItem = null;
        for (var i = 0; i < items.length; i++) {
          if (hasAudioNovel(items[i])) { promoItem = items[i]; break; }
        }
        if (!promoItem) return; // 아직 오디오 노벨이 붙은 작품이 없음 — 조용히 스킵

        audioPromoEl = createAudioPromoBanner(promoItem);
        placeAudioPromo();
      })
      .catch(function () {}); // Official.json이 없거나 실패해도 나머지 페이지는 그대로
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
      var novels = filterMature((data && Array.isArray(data.novels)) ? data.novels : []);
      var totals = (data && data.totals) || {};

      // 총 게시물 수 업데이트 — 전체 배열을 더 이상 안 받으므로 길이를 셀 수
      // 없다. 빌드 스크립트가 넣어둔 totals 를 쓴다.
      var statEl = document.querySelector('.site-info-stat');
      if (statEl) {
        var totalPosts = (totals.novel || 0) + (totals.series || 0);
        statEl.textContent = formatCount(totalPosts) + '개의 게시물이 있습니다!';
      }

      contentEl.innerHTML = '';
      placeAudioPromo(); // Official.json이 먼저 응답해 이미 붙어있던 배너를 방금 지웠다면 되살림

      // 0. 야치요 생일 축하 배너 — pancakeCounter.js가 버튼에 클릭을 걸
      // 시점을 알 수 있도록, 배너가 실제로 DOM에 붙은 뒤 이벤트를 쏜다
      // (이 배너는 Recent.json 응답이 와야 그려지므로 DOMContentLoaded보다
      // 한참 늦다 — pancakeCounter.js가 그 시점에 맞춰 기다린다).
      if (Date.now() < BIRTHDAY_BANNER_END) {
        contentEl.appendChild(createBirthdayBanner());
        window.dispatchEvent(new CustomEvent('chokaguya:birthday-banner-ready'));
      }

      // 1. 최신 등록 문학
      if (novels.length) {
        contentEl.appendChild(createRecentSection('최신 등록 문학', novels, '/novel', 'novel'));
      }

      // 2. 랜덤 문학 — 5초마다 다른 문학으로 자동 전환
      contentEl.appendChild(createRandomSection('랜덤 문학', '../data/PageData/Novel.json', '/novel', 'novel'));

      // 3. 랜덤 시리즈 — 동일하게 5초마다 자동 전환
      contentEl.appendChild(createRandomSection('랜덤 시리즈', '../data/PageData/Series.json', '/series', 'series'));

      // 4. 랜덤 명예관 — 동일하게 5초마다 자동 전환
      contentEl.appendChild(createRandomSection('랜덤 명예관', '../data/PageData/HOF.json', '/hof', 'hof'));
    })
    .catch(function () {});

  // 최신/랜덤 섹션은 fetch가 끝난 시점의 스냅샷을 클로저에 쥐고 도는 중이라
  // 설정을 여기서 바로 켜고 꺼도 다시 계산해줄 수가 없다 — gridPage.js처럼
  // 캐시를 다시 거르는 대신, 랜딩 페이지 전체를 새로고침해서 반영한다.
  global.addEventListener('chokaguya:content-settings-change', function () {
    global.location.reload();
  });
})(window);
