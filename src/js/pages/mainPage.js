(function (global) {
  var contentEl = document.getElementById('content');
  if (!contentEl) return;

  var DATA = global.dataUrl || function (p) { return p; };
  var fetchJson = global.fetchJsonCached || function (url) {
    return fetch(DATA(url)).then(function (response) {
      if (!response.ok) throw new Error('Data request failed: ' + response.status);
      return response.json();
    });
  };

  // 오디오 노벨 홍보 카드를 한 번 닫으면 이 브라우저에서는 다시 안 뜨도록
  // 기억하는 키 — chokaguya_theme/chokaguya_tipVisited와 같은 네이밍 관례.
  var AUDIO_PROMO_DISMISS_KEY = 'chokaguya_audioPromoDismissed';

  // 태그 색상/이모지/정렬 — gridPage.js와 공유하는 단일 소스(tagConfig.js)로 옮김.
  // 예전엔 이 파일이 직접 들고 있었는데, gridPage.js가 쓰던 표와 이모지 9개가
  // 실제로 어긋나 있었다(같은 태그가 페이지마다 다르게 보임) — tagConfig.js의
  // 헤더 주석에 병합 기준을 적어뒀다.
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

  function createCard(item, favType, options) {
    options = options || {};
    var card = document.createElement('article');
    card.className = 'post-row';

    var image = document.createElement('div');
    image.className = 'post-row-image';
    var imageTarget = image;
    if (options.blurPhoto) {
      image.classList.add('is-photo-blurred');
      imageTarget = document.createElement('div');
      imageTarget.className = 'post-row-image-bg';
      image.appendChild(imageTarget);
    }
    if (item.image) {
      if (global.lazyLoadBackground) {
        global.lazyLoadBackground(imageTarget, item.image);
      } else {
        var finalImg = global.resolveThumbUrl ? global.resolveThumbUrl(item.image) : item.image;
        imageTarget.style.backgroundImage = 'url("' + finalImg + '")';
      }
    }
    var favId = item.posts && item.posts[0] && item.posts[0].id;
    if (favId != null && global.BookmarkPicker) {
      image.appendChild(global.BookmarkPicker.createButton(favType, favId));
    }
    if (favId != null && global.BumpButton) {
      image.appendChild(global.BumpButton.createButton(favType, favId, item.name));
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

  // 메인 상단 가로 배너(대회 홍보·신규 기능 알림 공용). 왼쪽엔 한 줄
  // 머리말 / 제목 / 두 줄 설명 / 알약 버튼, 오른쪽엔 이미지를 깔고 왼쪽으로
  // 갈수록 배경색에 녹아들게 한다. 색은 .is-contest / .is-audio 에서
  // --hero-accent 로 갈라 쓴다.
  //   opts.tag     : 'a'(링크 배너) 또는 'article'(클릭 핸들러를 직접 거는 배너)
  //   opts.image   : 배너 오른쪽 그림. offlineSrc/ 는 오리진에서 바로 읽는다
  //   opts.descLines: 설명 줄 배열(최대 두 줄)
  function createHeroBanner(opts) {
    var card = document.createElement(opts.tag || 'a');
    card.className = 'main-hero ' + (opts.className || '');
    if (opts.href) card.href = opts.href;

    var art = document.createElement('div');
    art.className = 'main-hero-art';
    art.setAttribute('aria-hidden', 'true');
    var src = opts.image;
    if (src) {
      if (opts.imagePosition) art.style.backgroundPosition = opts.imagePosition;
      // offlineSrc/ 는 R2 가 아니라 오리진에서 서빙한다(contestPage.js 와 같은 예외).
      if (/^(\.\.\/|\/)offlineSrc\//.test(src)) {
        art.style.backgroundImage = 'url("' + src + '")';
      } else if (global.lazyLoadBackground) {
        global.lazyLoadBackground(art, src);
      } else {
        art.style.backgroundImage = 'url("' + (global.resolveThumbUrl ? global.resolveThumbUrl(src) : src) + '")';
      }
    }
    card.appendChild(art);

    var body = document.createElement('div');
    body.className = 'main-hero-body';

    var eyebrow = document.createElement('p');
    eyebrow.className = 'main-hero-eyebrow';
    eyebrow.textContent = opts.eyebrow;
    body.appendChild(eyebrow);

    var title = document.createElement('p');
    title.className = 'main-hero-title';
    title.textContent = opts.title;
    body.appendChild(title);

    var lines = (opts.descLines || []).filter(Boolean);
    if (lines.length) {
      var desc = document.createElement('p');
      desc.className = 'main-hero-desc';
      lines.forEach(function (line, i) {
        if (i) desc.appendChild(document.createElement('br'));
        desc.appendChild(document.createTextNode(line));
      });
      body.appendChild(desc);
    }

    var cta = document.createElement('span');
    cta.className = 'main-hero-cta';
    cta.textContent = opts.cta;
    body.appendChild(cta);

    card.appendChild(body);
    return card;
  }

  // 메인페이지 최상단 오디오 노벨 홍보 배너 — 특정 작품명을 문구에 박아두지
  // 않고 범용 소개로 두었기 때문에, 실제로 보여줄 작품(배너 그림/클릭 시 열릴
  // 상세 모달)은 Official.json에서 오디오 노벨이 연결된 첫 항목을 찾아 쓴다.
  // 나중에 다른 작품에도 오디오 노벨이 붙어도 이 함수는 손댈 필요가 없다.
  function createAudioPromoBanner(item) {
    var card = createHeroBanner({
      tag: 'article',
      className: 'is-audio',
      image: item.image,
      eyebrow: 'NEW',
      title: '🎧 오디오 노벨',
      descLines: ['이제 소설을 눈이 아니라', '귀로도 즐길 수 있어요'],
      cta: '더 알아보기'
    });

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'main-hero-close';
    closeBtn.setAttribute('aria-label', '닫기');
    closeBtn.textContent = '×';
    card.appendChild(closeBtn);

    card.addEventListener('click', function (e) {
      if (e.target.closest('.main-hero-close')) return;
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
      // 닫은 뒤 placeTopWidgets()가 다시 끼우지 않도록 놓아 준다.
      if (audioPromoEl === card) audioPromoEl = null;
      setTimeout(function () {
        if (card.parentNode) card.parentNode.removeChild(card);
      }, 220);
    });

    return card;
  }

  function createTranslationWarning() {
    var warning = document.createElement('aside');
    warning.className = 'translation-warning';
    warning.setAttribute('role', 'note');
    warning.setAttribute('aria-label', '번역 페이지 주의사항');

    var warningTitle = document.createElement('p');
    warningTitle.className = 'translation-warning-title';
    warningTitle.textContent = '⚠️ 주의';
    warning.appendChild(warningTitle);

    var warningText = document.createElement('p');
    warningText.className = 'translation-warning-text';
    warningText.textContent = '해당 페이지는 태그를 지원하지 않습니다. 일부 선정적인 페이지가 노출될 수 있으므로 주의해주세요';
    warning.appendChild(warningText);

    return warning;
  }

  function createRecentSection(title, items, href, favType, options) {
    options = options || {};
    var section = document.createElement('div');
    section.className = 'recent';
    if (options.className) section.classList.add(options.className);

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

    if (options.warning) section.appendChild(createTranslationWarning());

    var list = document.createElement('div');
    list.className = 'post-list';

    (items || []).forEach(function (item) {
      list.appendChild(createCard(item, favType, options.cardOptions));
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

    fetchJson(dataUrl)
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

    // 팬케이크 주기 버튼 + 카운트 — 실제 클릭 처리는 src/js/components/pancakeCounter.js
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

  // #content 맨 위 위젯들. 각자 데이터가 오는 시점이 달라서, 예전처럼
  // 붙을 때마다 첫 자식으로 끼우면 응답 순서에 따라 위아래가 뒤바뀌었다.
  // 그래서 요소를 변수에 쥐고 있다가 placeTopWidgets()가 언제 불리든 아래
  // 순서로 다시 맞춘다. Recent.json 응답이 contentEl.innerHTML = '' 로
  // #content를 통째로 비울 때도 이 함수로 되살린다.
  //   1. audioPromoEl  : 신규 기능 알림(오디오 노벨 홍보 카드). Official.json
  //   2. bumpBannerEl  : 지금 끌올된 문학. bumpButton.js 폴링 상태
  //   3. contestPromoEl: 진행 중인 대회 홍보. Contest.json
  //   4. noticeBoardEl : 최근 공지사항 목록 + 최신 업데이트 카드.
  //                      notice/index.json, changelog/index.json
  //   5. dailyGiftEl   : 오늘의 문학 / 번역 선물상자. 상자/애니메이션/카운트
  //                      다운/그날의 뽑기는 dailyGift.js가 맡는다.
  // 끌올 배너는 끌올이 없을 때 hidden 으로 자리만 지킨다.
  var audioPromoEl = null;
  var bumpBannerEl = null;
  var contestPromoEl = null;
  var noticeBoardEl = null;
  var dailyGiftEl = null;

  function placeTopWidgets() {
    var widgets = [audioPromoEl, bumpBannerEl, contestPromoEl, noticeBoardEl, dailyGiftEl]
      .filter(Boolean);
    // 이미 제자리에 있는 요소는 옮기지 않는다(옮기면 CSS 애니메이션이
    // 처음부터 다시 돈다).
    var ref = contentEl.firstChild;
    widgets.forEach(function (el) {
      if (el === ref) {
        ref = ref.nextSibling;
      } else {
        contentEl.insertBefore(el, ref);
      }
    });
  }

  function createBumpBanner() {
    var section = document.createElement('div');
    section.className = 'recent bump-banner';
    section.hidden = true;

    var headingRow = document.createElement('div');
    headingRow.className = 'bump-banner-heading-row';

    var heading = document.createElement('div');
    heading.className = 'content-heading';
    var label = document.createElement('span');
    label.textContent = '🔥 지금 끌올된 문학';
    heading.appendChild(label);
    headingRow.appendChild(heading);

    var countdown = document.createElement('span');
    countdown.className = 'bump-banner-countdown';
    headingRow.appendChild(countdown);

    section.appendChild(headingRow);

    var list = document.createElement('div');
    list.className = 'post-list';
    section.appendChild(list);

    var currentKey = null; // "type:id" — 같은 항목이면 카드를 다시 안 그리고 카운트다운만 갱신
    var countdownTimer = null;

    function stopCountdown() {
      if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    }

    // endAt은 다음 끌올로 교체되는 시각이다. 대기자가 없으면 null이고,
    // 그동안은 끌올이 끝나지 않으므로 카운트다운을 비워 둔다.
    function startCountdown(endAt) {
      stopCountdown();
      if (!endAt) { countdown.textContent = ''; return; }
      function pad(n) { return (n < 10 ? '0' : '') + n; }
      function tick() {
        var remain = endAt - Date.now();
        if (remain <= 0) { countdown.textContent = ''; stopCountdown(); return; }
        var h = Math.floor(remain / 3600000);
        var m = Math.floor((remain % 3600000) / 60000);
        var s = Math.floor((remain % 60000) / 1000);
        countdown.textContent = '교체까지 ' + (h ? h + ':' + pad(m) : m) + ':' + pad(s);
      }
      tick();
      countdownTimer = setInterval(tick, 1000);
    }

    function showActive(active) {
      var key = active.type + ':' + active.id;
      if (key === currentKey) {
        startCountdown(active.endAt);
        return;
      }
      currentKey = key;
      // 카드에 필요한 필드(name/image/tags/posts)만 담긴 경량 조회 인덱스 —
      // bookmarksPage.js가 북마크 상세에 쓰는 것과 같은 Lookup.json을
      // 재사용한다(타입별 pageData 5개를 따로 받을 필요가 없다).
      fetchJson('../data/pageData/Lookup.json').then(function (lookup) {
        if (currentKey !== key) return; // 그 사이 활성 항목이 또 바뀜
        var entry = lookup && lookup[active.type] && lookup[active.type][String(active.id)];
        list.innerHTML = '';
        if (!entry) { section.hidden = true; return; }
        list.appendChild(createCard(entry, active.type));
        section.hidden = false;
        startCountdown(active.endAt);
      }).catch(function () {
        if (currentKey === key) section.hidden = true;
      });
    }

    function applyStatus(status) {
      if (status && status.active) {
        showActive(status.active);
      } else {
        currentKey = null;
        stopCountdown();
        section.hidden = true;
      }
    }

    if (global.BumpButton) {
      applyStatus(global.BumpButton.getLastStatus());
      global.addEventListener('chokaguya:bump-change', function (e) { applyStatus(e.detail); });
      global.BumpButton.ensurePolling();
    }

    return section;
  }

  // "2026-03-19" → 로컬 자정 Date (contestPage.js 와 같은 규칙).
  function parseContestDate(str) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(str || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }

  // 오늘이 기간 안에 있는 대회만 고른다. 끝나는 날 자정까지는 진행 중으로 친다.
  function ongoingContests(contests) {
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return contests.filter(function (c) {
      if (!c || !c.id) return false;
      var start = parseContestDate(c.startDate);
      var end = parseContestDate(c.endDate);
      if (start && today < start) return false;
      if (end && today > end) return false;
      return !!(start || end);
    });
  }

  function contestDdayText(contest) {
    var end = parseContestDate(contest.endDate);
    if (!end) return '진행 중';
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var left = Math.round((end - today) / 86400000);
    return left === 0 ? 'D-DAY' : 'D-' + left;
  }

  // "2026-09-24" → "9월 24일"
  function formatContestDay(str) {
    var d = parseContestDate(str);
    return d ? (d.getMonth() + 1) + '월 ' + d.getDate() + '일' : '';
  }

  function contestPeriodText(contest) {
    var start = formatContestDay(contest.startDate);
    var end = formatContestDay(contest.endDate);
    if (start && end) return start + ' ~ ' + end;
    return end ? end + ' 마감' : start + '부터';
  }

  // 진행 중인 대회 홍보 배너. 누르면 그 대회 상세(/contest?c=<id>)로 간다.
  function createContestPromoCard(contest) {
    return createHeroBanner({
      className: 'is-contest',
      href: '/contest?c=' + encodeURIComponent(contest.id),
      image: contest.image,
      // 배너는 대회 탭 카드와 비율이 달라 보일 부분도 다르다. 배너 전용
      // heroImagePosition 이 있으면 그것을, 없으면 imagePosition 을 쓴다.
      imagePosition: contest.heroImagePosition || contest.imagePosition,
      eyebrow: contestDdayText(contest),
      title: contest.name || contest.shortName || contest.id,
      descLines: [contest.description, contestPeriodText(contest)],
      cta: '참가작 보러 가기'
    });
  }

  // ---- 최근 공지사항 위젯 ----
  // 왼쪽 카드는 공지사항과 업데이트 로그를 날짜순으로 섞어 한 쪽에 3개씩
  // 보여 주고, 오른쪽 카드는 가장 최근 업데이트 로그 하나를 크게 보여 준다.
  // 항목을 누르면 /notice 의 해당 탭에서 그 글의 상세 모달이 바로 열린다
  // (changelogPage.js 의 ?open=<파일명>).
  var NOTICE_PAGE_SIZE = 3;

  // "2026-09-27" → "2026.09.27"
  function formatNoticeDate(str) {
    return String(str || '').replace(/-/g, '.');
  }

  function noticeHref(tab, file) {
    var q = tab === 'notice' ? '?tab=notice&open=' : '?open=';
    return '/notice' + q + encodeURIComponent(file);
  }

  function createPagerButton(dir) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'notice-board-page-btn';
    btn.setAttribute('aria-label', dir < 0 ? '이전 공지' : '다음 공지');
    btn.innerHTML = dir < 0
      ? '<svg width="8" height="12" viewBox="0 0 8 12" fill="none" aria-hidden="true"><path d="M6.5 1L1.5 6L6.5 11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : '<svg width="8" height="12" viewBox="0 0 8 12" fill="none" aria-hidden="true"><path d="M1.5 1L6.5 6L1.5 11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    return btn;
  }

  function createNoticeListCard(entries) {
    var card = document.createElement('div');
    card.className = 'notice-board-card notice-board-list';

    var head = document.createElement('div');
    head.className = 'notice-board-head';
    var title = document.createElement('a');
    title.className = 'notice-board-title';
    title.href = '/notice?tab=notice';
    title.textContent = '공지사항';
    head.appendChild(title);

    var pager = document.createElement('div');
    pager.className = 'notice-board-pager';
    var prevBtn = createPagerButton(-1);
    var nextBtn = createPagerButton(1);
    pager.appendChild(prevBtn);
    pager.appendChild(nextBtn);
    head.appendChild(pager);
    card.appendChild(head);

    var list = document.createElement('ul');
    list.className = 'notice-board-rows';
    card.appendChild(list);

    var pageCount = Math.max(1, Math.ceil(entries.length / NOTICE_PAGE_SIZE));
    var page = 0;
    pager.hidden = pageCount < 2;

    function render() {
      list.innerHTML = '';
      entries.slice(page * NOTICE_PAGE_SIZE, (page + 1) * NOTICE_PAGE_SIZE).forEach(function (entry) {
        var li = document.createElement('li');
        var row = document.createElement('a');
        row.className = 'notice-board-row';
        row.href = entry.href;

        var tag = document.createElement('span');
        tag.className = 'notice-board-tag';
        tag.textContent = entry.tag;
        row.appendChild(tag);

        var text = document.createElement('span');
        text.className = 'notice-board-text';
        text.textContent = entry.title;
        row.appendChild(text);

        var date = document.createElement('span');
        date.className = 'notice-board-date';
        date.textContent = formatNoticeDate(entry.date);
        row.appendChild(date);

        li.appendChild(row);
        list.appendChild(li);
      });
      prevBtn.disabled = page === 0;
      nextBtn.disabled = page >= pageCount - 1;
    }

    prevBtn.addEventListener('click', function () {
      if (page > 0) { page--; render(); }
    });
    nextBtn.addEventListener('click', function () {
      if (page < pageCount - 1) { page++; render(); }
    });

    render();
    return card;
  }

  // 오른쪽 "NOW" 카드 — 가장 최근 업데이트 로그. 두 번째 설명 줄은 그
  // 로그 .md 의 "## " 소제목을 모아 채운다(본문 파일을 받아야 알 수 있어서
  // 받기 전에는 한 줄로 두었다가 채운다).
  function createLatestUpdateCard(entry) {
    var card = document.createElement('a');
    card.className = 'notice-board-card notice-board-now';
    card.href = noticeHref('changelog', entry.file);

    var top = document.createElement('div');
    top.className = 'notice-board-now-top';

    var thumb = document.createElement('div');
    thumb.className = 'notice-board-now-thumb';
    thumb.setAttribute('aria-hidden', 'true');
    thumb.textContent = entry.version;
    top.appendChild(thumb);

    var heading = document.createElement('div');
    heading.className = 'notice-board-now-heading';
    var eyebrow = document.createElement('p');
    eyebrow.className = 'notice-board-now-eyebrow';
    eyebrow.textContent = 'NOW';
    heading.appendChild(eyebrow);
    var title = document.createElement('p');
    title.className = 'notice-board-now-title';
    title.textContent = entry.version + ' 업데이트';
    heading.appendChild(title);
    top.appendChild(heading);
    card.appendChild(top);

    // 줄마다 따로 말줄임하도록 줄 단위 span 으로 쌓는다.
    var desc = document.createElement('p');
    desc.className = 'notice-board-now-desc';
    function addDescLine(text) {
      var line = document.createElement('span');
      line.className = 'notice-board-now-line';
      line.textContent = text;
      desc.appendChild(line);
    }
    addDescLine(entry.title);
    card.appendChild(desc);

    var cta = document.createElement('span');
    cta.className = 'notice-board-now-cta';
    cta.textContent = '업데이트 안내 보기';
    card.appendChild(cta);

    fetch(DATA('../data/changelog/' + entry.file))
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (md) {
        var sections = [];
        String(md).split('\n').forEach(function (line) {
          var m = /^##\s+(.+?)\s*$/.exec(line);
          if (m) sections.push(m[1]);
        });
        if (!sections.length) return;
        var summary = sections.slice(0, 3).join(' · ');
        summary += sections.length > 3 ? ' 외 ' + (sections.length - 3) + '가지' : ' 포함';
        addDescLine(summary);
      })
      .catch(function () {});

    return card;
  }

  function loadIndexList(dir) {
    return fetch(DATA('../data/' + dir + '/index.json'))
      .then(function (r) { return r.json(); })
      .then(function (entries) { return Array.isArray(entries) ? entries : []; })
      .catch(function () { return []; });
  }

  Promise.all([loadIndexList('notice'), loadIndexList('changelog')])
    .then(function (results) {
      var notices = results[0];
      var changelogs = results[1];
      var merged = notices.map(function (e) {
        return { tag: e.category || '공지', title: e.title, date: e.date, href: noticeHref('notice', e.file) };
      }).concat(changelogs.map(function (e) {
        return { tag: '업데이트', title: e.version + ' ' + e.title, date: e.date, href: noticeHref('changelog', e.file) };
      }));
      if (!merged.length) return;
      // 같은 날짜면 원래 index.json 순서(최신 먼저)를 유지한다.
      merged.forEach(function (e, i) { e.order = i; });
      merged.sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        return a.order - b.order;
      });

      var board = document.createElement('section');
      board.className = 'notice-board';
      board.setAttribute('aria-label', '최근 공지사항');
      board.appendChild(createNoticeListCard(merged));
      if (changelogs.length) {
        board.appendChild(createLatestUpdateCard(changelogs[0]));
      } else {
        board.classList.add('is-list-only');
      }
      noticeBoardEl = board;
      placeTopWidgets();
    });

  fetchJson('../data/pageData/Contest.json')
    .then(function (contests) {
      var live = ongoingContests(Array.isArray(contests) ? contests : []);
      if (!live.length) return; // 진행 중인 대회가 없으면 자리도 만들지 않는다
      var wrap = document.createElement('div');
      wrap.className = 'main-hero-list';
      live.forEach(function (c) { wrap.appendChild(createContestPromoCard(c)); });
      contestPromoEl = wrap;
      placeTopWidgets();
    })
    .catch(function () {});

  if (global.DailyGift) {
    dailyGiftEl = global.DailyGift.create({
      dataUrl: '../data/pageData/Novel.json',
      favType: 'novel',
      secondaryDataUrl: '../data/pageData/Translation.json',
      secondaryFavType: 'translation',
      primaryLabel: '오늘의 문학',
      secondaryLabel: '오늘의 번역',
      filterItems: filterMature,
      renderCard: function (item, favType) { return createCard(item, favType); }
    });
    placeTopWidgets();
  }

  if (global.BumpButton) {
    bumpBannerEl = createBumpBanner();
    placeTopWidgets();
  }

  var audioPromoDismissed = false;
  try { audioPromoDismissed = !!localStorage.getItem(AUDIO_PROMO_DISMISS_KEY); } catch (e) {}

  if (!audioPromoDismissed) {
    fetch(DATA('../data/pageData/Official.json'))
      .then(function (r) { return r.json(); })
      .then(function (items) {
        items = filterMature(Array.isArray(items) ? items : []);
        var promoItem = null;
        for (var i = 0; i < items.length; i++) {
          if (hasAudioNovel(items[i])) { promoItem = items[i]; break; }
        }
        if (!promoItem) return; // 아직 오디오 노벨이 붙은 작품이 없음 — 조용히 스킵

        audioPromoEl = createAudioPromoBanner(promoItem);
        placeTopWidgets();
      })
      .catch(function () {}); // Official.json이 없거나 실패해도 나머지 페이지는 그대로
  }

  // 최신 10 + 10장만 그리면서 Novel.json(약 600KB) + Series.json(약 170KB)을
  // 통째로 받아 slice(0, 10) 두 번만 쓰던 걸 걷어냈다. 랜딩 페이지라 방문자당
  // 무조건 발생하는 요청이었다. Recent.json 은 src/scripts/8_build_recent_page_data.py
  // 가 빌드 시점에 만들어 두는 파일로, 두 배열의 앞 10건을 필드 손실 없이
  // 그대로 담고 있어서 카드와 상세 모달이 예전과 똑같이 동작한다.
  // (데이터를 다시 빌드했으면 cdnConfig.js 의 DATA_VERSION 을 올릴 것)
  fetch(DATA('../data/pageData/Recent.json'))
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
      placeTopWidgets(); // 먼저 붙어 있던 위젯을 방금 지웠다면 정해진 순서로 되살림

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

      // 번역 데이터는 랜덤 번역과 같은 요청을 공유한다. 응답이 늦어도
      // 다른 섹션은 먼저 표시하고, 최신 번역의 위치는 여기로 고정한다.
      var recentTranslationSlot = document.createElement('div');
      recentTranslationSlot.hidden = true;
      contentEl.appendChild(recentTranslationSlot);
      fetchJson('../data/pageData/Translation.json')
        .then(function (items) {
          var translations = filterMature(Array.isArray(items) ? items : []);
          if (!translations.length) {
            recentTranslationSlot.remove();
            return;
          }
          // Translation.json은 번역 빌더가 게시글 ID 내림차순으로 생성한다.
          recentTranslationSlot.replaceWith(createRecentSection(
            '최근 등록 번역',
            translations.slice(0, 5),
            '/translation',
            'translation',
            {
              className: 'recent-translation',
              warning: true,
              cardOptions: { blurPhoto: true }
            }
          ));
        })
        .catch(function () { recentTranslationSlot.remove(); });

      // 2. 랜덤 문학 — 5초마다 다른 문학으로 자동 전환
      contentEl.appendChild(createRandomSection('랜덤 문학', '../data/pageData/Novel.json', '/novel', 'novel'));

      // 랜덤 번역은 랜덤 문학과 랜덤 시리즈 사이에 배치한다.
      contentEl.appendChild(createRandomSection('랜덤 번역', '../data/pageData/Translation.json', '/translation', 'translation'));

      // 3. 랜덤 시리즈 — 동일하게 5초마다 자동 전환
      contentEl.appendChild(createRandomSection('랜덤 시리즈', '../data/pageData/Series.json', '/series', 'series'));

      // 4. 랜덤 명예관 — 동일하게 5초마다 자동 전환
      contentEl.appendChild(createRandomSection('랜덤 명예관', '../data/pageData/HOF.json', '/hof', 'hof'));
    })
    .catch(function () {});

  // 최신/랜덤 섹션은 fetch가 끝난 시점의 스냅샷을 클로저에 쥐고 도는 중이라
  // 설정을 여기서 바로 켜고 꺼도 다시 계산해줄 수가 없다 — gridPage.js처럼
  // 캐시를 다시 거르는 대신, 랜딩 페이지 전체를 새로고침해서 반영한다.
  global.addEventListener('chokaguya:content-settings-change', function () {
    global.location.reload();
  });
})(window);
