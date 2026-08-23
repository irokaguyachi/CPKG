/**
 * ChoKaguya Bookmarks Page
 * - 목록 모드(URL 에 ?id= 없음): 탭 두 개.
 *   · 내 북마크: 내가 만든 북마크(이름 있는 모음)들을 폴더 카드로 보여줌.
 *   · 북마크 라이브러리(?tab=library): 다른 사람이 공개한 북마크 목록.
 * - 상세 모드(?id=<북마크id>): Novel/Series/HOF/Official.json 을 모두
 *   불러와 그 북마크에 담긴 항목들을 담은 순서 그대로 하나의 그리드로
 *   보여줌 — 타입별로 안 나눔(유저가 문학/시리즈를 섞어 담을 수 있어서).
 * - 라이브러리 상세(?libraryId=<code>): 공개된 북마크 하나를 같은 방식으로
 *   보여줌. 카드의 북마크 버튼은 그대로 살아있어서 마음에 드는 항목을
 *   바로 내 북마크에 담을 수 있음.
 * - 공개/수정/삭제는 bookmarkLibrary.js 를 통해 Worker 로 나감
 *   (BOOKMARK_SYSTEM_PLAN.md 참고).
 */
(function (global) {
  var SECTIONS = [
    { type: 'novel', dataUrl: '../data/PageData/Novel.json', numberPrefix: 'N' },
    { type: 'series', dataUrl: '../data/PageData/Series.json', numberPrefix: 'S' },
    { type: 'hof', dataUrl: '../data/PageData/HOF.json', numberPrefix: 'H' },
    { type: 'official', dataUrl: '../data/PageData/Official.json', numberPrefix: 'O' }
  ];

  var PENCIL_ICON = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M11 2.5l2.5 2.5L5 13.5H2.5V11L11 2.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  var DELETE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>';
  var FOLDER_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5h12a.5.5 0 0 1 .5.5v16.2a.5.5 0 0 1-.77.42L12 16.4l-5.73 4.22A.5.5 0 0 1 5.5 20.2V4a.5.5 0 0 1 .5-.5z"/></svg>';
  var SHARE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="M8.3 10.8l7.4-4.3M8.3 13.2l7.4 4.3"/></svg>';
  var GLOBE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.2 2.3 3.4 5.4 3.4 8.5S14.2 18.2 12 20.5c-2.2-2.3-3.4-5.4-3.4-8.5S9.8 5.8 12 3.5z"/></svg>';

  var contentEl = document.getElementById('bkm-content');
  var countEl = document.getElementById('bkm-count');
  var titleEl = document.getElementById('bkm-title');
  var subEl = document.getElementById('bkm-sub');
  var DATA = global.dataUrl || function (p) { return p; };

  function showMessage(text) {
    contentEl.innerHTML = '';
    var p = document.createElement('p');
    p.className = 'series-empty';
    p.textContent = text;
    contentEl.appendChild(p);
  }

  // 상세 모드(내 북마크 / 라이브러리)가 공통으로 쓰는 조회맵 로더 —
  // PageData 4개를 병렬로 받아 { type: { 대표게시물id: 항목 } } 로 만든다.
  function loadItemLookup() {
    var fetches = SECTIONS.map(function (section) {
      return fetch(DATA(section.dataUrl)).then(function (r) { return r.json(); }).catch(function () { return []; });
    });

    return Promise.all(fetches).then(function (results) {
      var byId = {};
      SECTIONS.forEach(function (section, i) {
        var items = Array.isArray(results[i]) ? results[i] : [];
        SeriesUtil.assignPostNumbers(items, section.numberPrefix);
        SeriesUtil.assignSeriesNumbers(items, section.numberPrefix);
        var map = {};
        items.forEach(function (s) {
          var pid = s.posts && s.posts[0] && s.posts[0].id;
          if (pid != null) map[pid] = s;
        });
        byId[section.type] = map;
      });
      return byId;
    });
  }

  // 목록 모드 상단의 "내 북마크 | 북마크 라이브러리" 알약 토글
  function createTabs(active) {
    var tabs = document.createElement('div');
    tabs.className = 'bkm-tabs';

    [
      { key: 'mine', label: '내 북마크', href: 'bookmarksPage.html' },
      { key: 'library', label: '북마크 라이브러리', href: 'bookmarksPage.html?tab=library' }
    ].forEach(function (t) {
      var link = document.createElement('a');
      link.className = 'bkm-tab' + (active === t.key ? ' is-active' : '');
      link.href = t.href;
      link.textContent = t.label;
      tabs.appendChild(link);
    });

    return tabs;
  }

  // ---- 항목 카드 (상세 모드에서 씀 — gridPage.js/favoritesPage.js 의
  // createCard 와 같은 모양) ----
  function createItemCard(type, s, opts) {
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
      image.appendChild(global.BookmarkPicker.createButton(type, favId, opts));
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

  // ---- 공개(공유) 패널 ----
  // bookmarkPicker.js 의 팝오버와 같은 이유로 body 싱글턴 + position:fixed 다
  // (.series-card 의 overflow:hidden 이 카드 밖 절대배치 자식을 잘라버림).
  // 다만 내용이 체크리스트가 아니라 버튼 두어 개뿐이라 그 모듈을 재사용하지
  // 않고 여기서 최소한으로 구현한다.
  var sharePanelEl = null;
  var sharePanelBound = false;

  function ensureSharePanel() {
    if (sharePanelEl) return sharePanelEl;
    sharePanelEl = document.createElement('div');
    sharePanelEl.className = 'bkm-picker bkm-share-panel';
    sharePanelEl.addEventListener('click', function (e) { e.stopPropagation(); });
    document.body.appendChild(sharePanelEl);
    if (!sharePanelBound) {
      document.addEventListener('click', closeSharePanel);
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeSharePanel();
      });
      sharePanelBound = true;
    }
    return sharePanelEl;
  }

  function closeSharePanel() {
    if (sharePanelEl) sharePanelEl.classList.remove('is-open');
  }

  function positionSharePanel(anchorEl) {
    var rect = anchorEl.getBoundingClientRect();
    var panelW = sharePanelEl.offsetWidth || 280;
    var left = Math.max(8, Math.min(rect.right - panelW, global.innerWidth - panelW - 8));
    var top = Math.min(rect.bottom + 8, global.innerHeight - 8);
    sharePanelEl.style.left = Math.round(left) + 'px';
    sharePanelEl.style.top = Math.round(top) + 'px';
  }

  function sharePanelHeader(text) {
    var header = document.createElement('div');
    header.className = 'sfp-header';
    header.textContent = text;
    return header;
  }

  function sharePanelButton(label, variant) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bkm-share-btn' + (variant ? ' ' + variant : '');
    btn.textContent = label;
    return btn;
  }

  function sharePanelNote(text) {
    var p = document.createElement('p');
    p.className = 'bkm-share-note';
    p.textContent = text;
    return p;
  }

  // 게시 직후 한 번만 보여주는 결과 화면. 공개는 이제 로그인이 끝난
  // 뒤에만 할 수 있어서(requireLogin), publish() 가 항상 personalCode 를
  // 함께 보내고 서버가 그 자리에서 ownerHash 를 걸어준다 — 즉 로그인된
  // 계정만으로 어느 기기에서든 이미 수정·공개취소가 가능하므로, 예전처럼
  // editToken(관리 코드)을 따로 보여주고 "잃어버리면 못 고친다"며 백업을
  // 요구할 필요가 없다.
  function renderPublishedResult(panel, code) {
    panel.innerHTML = '';
    panel.appendChild(sharePanelHeader('라이브러리에 공개했어요!'));

    var linkLabel = document.createElement('p');
    linkLabel.className = 'bkm-share-note';
    linkLabel.textContent = '공개 링크';
    panel.appendChild(linkLabel);

    var linkInput = document.createElement('input');
    linkInput.type = 'text';
    linkInput.className = 'bkm-share-code';
    linkInput.readOnly = true;
    linkInput.value = global.location.origin + global.location.pathname + '?libraryId=' + code;
    linkInput.addEventListener('focus', function () { linkInput.select(); });
    panel.appendChild(linkInput);

    panel.appendChild(sharePanelNote('로그인된 계정에 연결됐어요. 다른 기기에서도 같은 개인 코드로 로그인하면 수정·공개취소까지 그대로 할 수 있어요.'));
  }

  // 공개 여부는 이 북마크 자체의 publishedCode(계정과 함께 동기화됨)를
  // 우선 본다 — 옛날 방식인 BookmarkLibrary.getPublishedInfo는 이 브라우저
  // localStorage(chokaguya_library_tokens)만 보므로, 다른 기기에서 이미
  // 공개한 북마크가 계정 동기화로 이 브라우저에 넘어왔을 땐 여기서
  // "공개 안 됨"으로 잘못 판단해 똑같은 걸 또 공개해버리는 사고가 있었다.
  // publishedCode가 아직 없는 아주 오래된 로컬 게시물만 예전 방식으로
  // 보조 확인한다.
  function getPublishedCode(bookmark) {
    if (bookmark.publishedCode) return bookmark.publishedCode;
    var legacy = global.BookmarkLibrary.getPublishedInfo(bookmark.id);
    return legacy ? legacy.code : null;
  }

  function openSharePanel(anchorEl, bookmark, onStateChange) {
    var panel = ensureSharePanel();
    panel.innerHTML = '';

    var publishedCode = getPublishedCode(bookmark);

    if (!publishedCode) {
      panel.appendChild(sharePanelHeader('이 북마크를 라이브러리에 공개할까요?'));
      panel.appendChild(sharePanelNote(bookmark.items.length + '개의 항목이 함께 공개돼요. 누구나 볼 수 있어요.'));

      var publishBtn = sharePanelButton('라이브러리에 공개하기', 'is-primary');
      function doPublish() {
        publishBtn.disabled = true;
        publishBtn.textContent = '공개하는 중...';
        global.BookmarkLibrary.publish(bookmark.name, bookmark.items, bookmark.id)
          .then(function (data) {
            global.Bookmarks.setPublishedCode(bookmark.id, data.code);
            // 스토어는 갱신됐지만 이 함수가 들고 있는 bookmark 는 카드 생성
            // 시점의 스냅샷이라 따로 갱신 안 하면 이 화면 안에서는 여전히
            // "공개 안 됨"으로 보인다.
            bookmark.publishedCode = data.code;
            renderPublishedResult(panel, data.code);
            positionSharePanel(anchorEl);
            if (onStateChange) onStateChange();
          })
          .catch(function (err) {
            panel.innerHTML = '';
            panel.appendChild(sharePanelHeader('공개하지 못했어요'));
            panel.appendChild(sharePanelNote(err.message));
            positionSharePanel(anchorEl);
          });
      }
      publishBtn.addEventListener('click', function () {
        // 북마크를 공개하려면(서버에 실제로 써야 하므로) 로그인이 돼
        // 있어야 한다 — requireLogin 이 로그인 화면부터 보여준다. 여기서
        // 곧장 회원가입 화면을 띄우면, 이미 계정이 있는데 지금 로그아웃
        // 상태인 사람이 새 코드를 그대로 확정해 버려 쓰지도 않을 계정이
        // 하나 더 생기고 원래 북마크와도 갈라진다.
        if (!global.BookmarkLibrary.isLoggedIn()) {
          // 패널은 싱글턴 DOM 이라 innerHTML 은 그대로 두고 is-open 만
          // 뺀다 — 로그인 완료 후 다시 열 때 새로 그릴 필요가 없다.
          closeSharePanel();
          global.AuthModal.requireLogin({
            reason: '북마크를 공개하려면 먼저 로그인해주세요',
            onSuccess: function () {
              panel.classList.add('is-open');
              positionSharePanel(anchorEl);
              doPublish();
            }
          });
          return;
        }
        doPublish();
      });
      panel.appendChild(publishBtn);
    } else {
      panel.appendChild(sharePanelHeader('이미 라이브러리에 공개된 북마크예요'));

      var viewLink = document.createElement('a');
      viewLink.className = 'bkm-share-link';
      viewLink.href = 'bookmarksPage.html?libraryId=' + encodeURIComponent(publishedCode);
      viewLink.textContent = '공개된 모습 보기 →';
      panel.appendChild(viewLink);

      var updateBtn = sharePanelButton('최신 내용으로 업데이트', 'is-primary');
      updateBtn.addEventListener('click', function () {
        updateBtn.disabled = true;
        updateBtn.textContent = '업데이트 중...';
        global.BookmarkLibrary.update(publishedCode, { name: bookmark.name, items: bookmark.items })
          .then(function () {
            updateBtn.textContent = '업데이트 완료!';
          })
          .catch(function (err) {
            updateBtn.disabled = false;
            updateBtn.textContent = '최신 내용으로 업데이트';
            // 이미 지워진 게시물이면(다른 기기에서 먼저 공개 취소) 로컬에
            // 남아있던 publishedCode도 같이 지워서 다음엔 "공개 안 됨"으로
            // 정확히 보이게 한다.
            if (err.message && err.message.indexOf('존재하지 않') !== -1) {
              global.Bookmarks.setPublishedCode(bookmark.id, null);
              bookmark.publishedCode = null;
            }
            panel.appendChild(sharePanelNote(err.message));
            positionSharePanel(anchorEl);
          });
      });
      panel.appendChild(updateBtn);

      var unpublishBtn = sharePanelButton('공개 취소', 'is-danger');
      unpublishBtn.addEventListener('click', function () {
        if (!global.confirm('"' + bookmark.name + '" 북마크의 공개를 취소할까요? 라이브러리에서 사라져요.')) return;
        unpublishBtn.disabled = true;
        unpublishBtn.textContent = '취소하는 중...';
        global.BookmarkLibrary.unpublish(publishedCode)
          .then(function () {
            global.Bookmarks.setPublishedCode(bookmark.id, null);
            bookmark.publishedCode = null;
            closeSharePanel();
            if (onStateChange) onStateChange();
          })
          .catch(function (err) {
            unpublishBtn.disabled = false;
            unpublishBtn.textContent = '공개 취소';
            if (err.message && err.message.indexOf('존재하지 않') !== -1) {
              global.Bookmarks.setPublishedCode(bookmark.id, null);
              bookmark.publishedCode = null;
            }
            panel.appendChild(sharePanelNote(err.message));
            positionSharePanel(anchorEl);
          });
      });
      panel.appendChild(unpublishBtn);
    }

    positionSharePanel(anchorEl);
    panel.classList.add('is-open');
  }

  function isLoggedIn() {
    return !!(global.BookmarkLibrary && global.BookmarkLibrary.isLoggedIn());
  }

  // 로그인 전 안내판. 이 기기에 이미 쌓아둔 북마크가 있으면 개수를 먼저
  // 알려준다 — 목록만 비워두면 "데이터가 날아갔다"로 읽히기 때문이고,
  // 실제로는 로그인하는 순간 userData.js 가 계정 데이터와 합쳐준다.
  function renderLoginGate(withTabs) {
    contentEl.innerHTML = '';
    if (withTabs) contentEl.appendChild(createTabs('mine'));

    var box = document.createElement('div');
    box.className = 'bkm-login-gate';

    var heading = document.createElement('p');
    heading.className = 'bkm-login-gate-title';
    heading.textContent = '북마크는 로그인한 뒤에 쓸 수 있어요';
    box.appendChild(heading);

    var desc = document.createElement('p');
    desc.className = 'bkm-login-gate-desc';
    var localCount = global.Bookmarks ? global.Bookmarks.getAllBookmarks().length : 0;
    desc.textContent = localCount
      ? '이 기기에 저장해 둔 북마크 ' + localCount + '개가 있어요. 로그인하면 계정으로 옮겨져서 다른 기기에서도 그대로 볼 수 있어요.'
      : '로그인하면 북마크가 계정에 저장돼서, 다른 기기에서도 그대로 이어서 볼 수 있어요.';
    box.appendChild(desc);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bkm-inline-create-btn bkm-login-gate-btn';
    btn.textContent = localCount ? '로그인하고 이어서 쓰기' : '로그인하기';
    btn.addEventListener('click', function () {
      global.AuthModal.requireLogin({ reason: '북마크를 쓰려면 먼저 로그인해주세요' });
    });
    box.appendChild(btn);

    contentEl.appendChild(box);
  }

  // ---- 목록 모드 ----
  function renderList(tab) {
    if (tab === 'library') {
      renderLibraryList();
      return;
    }

    titleEl.textContent = '북마크';
    subEl.textContent = '내가 만든 북마크들을 모아봤어요';

    if (!isLoggedIn()) {
      countEl.textContent = '';
      renderLoginGate(true);
      return;
    }

    var bookmarks = global.Bookmarks.getAllBookmarks();
    countEl.textContent = bookmarks.length + '개의 북마크가 있습니다!';

    contentEl.innerHTML = '';
    contentEl.appendChild(createTabs('mine'));

    var toolbar = document.createElement('div');
    toolbar.className = 'bkm-list-toolbar';
    var form = document.createElement('div');
    form.className = 'bkm-inline-create';
    var newInput = document.createElement('input');
    newInput.type = 'text';
    newInput.className = 'bkm-inline-create-input';
    newInput.placeholder = '새 북마크 이름';
    newInput.maxLength = 40;
    var newBtn = document.createElement('button');
    newBtn.type = 'button';
    newBtn.className = 'bkm-inline-create-btn';
    newBtn.textContent = '+ 새 북마크';
    form.appendChild(newInput);
    form.appendChild(newBtn);
    toolbar.appendChild(form);

    contentEl.appendChild(toolbar);

    var grid = document.createElement('div');
    grid.className = 'series-grid';
    contentEl.appendChild(grid);

    function showEmptyIfNeeded() {
      if (grid.children.length) return;
      var empty = document.createElement('p');
      empty.className = 'series-empty';
      empty.textContent = '아직 만든 북마크가 없어요. 카드의 북마크 아이콘을 눌러 새로 만들어보세요!';
      grid.appendChild(empty);
    }

    function createFolderCard(bookmark) {
      var card = document.createElement('article');
      card.className = 'series-card bkm-folder-card';

      var image = document.createElement('div');
      image.className = 'series-card-image bkm-folder-image';
      image.innerHTML = FOLDER_ICON;

      var deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'series-card-fav bkm-folder-delete';
      deleteBtn.innerHTML = DELETE_ICON;
      deleteBtn.setAttribute('aria-label', '북마크 삭제');
      deleteBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (!global.confirm('"' + bookmark.name + '" 북마크를 삭제할까요?')) return;
        var publishedCode = getPublishedCode(bookmark);
        if (publishedCode) global.BookmarkLibrary.unpublish(publishedCode).catch(function () {});
        global.Bookmarks.deleteBookmark(bookmark.id);
        card.remove();
        countEl.textContent = global.Bookmarks.getAllBookmarks().length + '개의 북마크가 있습니다!';
        showEmptyIfNeeded();
      });
      image.appendChild(deleteBtn);

      var shareBtn = document.createElement('button');
      shareBtn.type = 'button';
      shareBtn.className = 'series-card-fav bkm-folder-share';
      shareBtn.innerHTML = SHARE_ICON;
      shareBtn.setAttribute('aria-label', '라이브러리에 공개하기');
      function syncShareState() {
        shareBtn.classList.toggle('is-published', !!getPublishedCode(bookmark));
      }
      syncShareState();
      shareBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openSharePanel(shareBtn, bookmark, syncShareState);
      });
      image.appendChild(shareBtn);

      card.appendChild(image);

      var info = document.createElement('div');
      info.className = 'series-card-info';

      var titleRow = document.createElement('div');
      titleRow.className = 'bkm-folder-title-row';

      var title = document.createElement('p');
      title.className = 'series-card-title';
      title.textContent = bookmark.name;
      titleRow.appendChild(title);

      var renameBtn = document.createElement('button');
      renameBtn.type = 'button';
      renameBtn.className = 'bkm-rename-btn';
      renameBtn.innerHTML = PENCIL_ICON;
      renameBtn.setAttribute('aria-label', '이름 바꾸기');
      renameBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'bkm-rename-input';
        input.value = bookmark.name;
        input.maxLength = 40;
        input.addEventListener('click', function (ev) { ev.stopPropagation(); });

        function commit() {
          // Enter 로 커밋한 뒤 input.blur() 가 다시 blur 이벤트를 발생시켜
          // commit 이 두 번 불릴 수 있음 — 이미 빠진 input 을 또 빼려 하면
          // replaceChild 가 던짐
          if (input.parentNode !== titleRow) return;
          if (input.value.trim() && global.Bookmarks.renameBookmark(bookmark.id, input.value)) {
            bookmark.name = input.value.trim();
          }
          title.textContent = bookmark.name;
          titleRow.replaceChild(title, input);
        }
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
          if (ev.key === 'Escape') { ev.preventDefault(); input.value = bookmark.name; input.blur(); }
        });

        titleRow.replaceChild(input, title);
        input.focus();
        input.select();
      });
      titleRow.appendChild(renameBtn);
      info.appendChild(titleRow);

      var count = document.createElement('p');
      count.className = 'series-card-count';
      count.textContent = bookmark.items.length + '개';
      info.appendChild(count);

      card.appendChild(info);

      card.addEventListener('click', function () {
        global.location.href = 'bookmarksPage.html?id=' + encodeURIComponent(bookmark.id);
      });

      return card;
    }

    bookmarks.forEach(function (b) { grid.appendChild(createFolderCard(b)); });
    showEmptyIfNeeded();

    function submitCreate() {
      if (!newInput.value.trim()) return;
      var id = global.Bookmarks.createBookmark(newInput.value);
      newInput.value = '';
      var emptyMsg = grid.querySelector('.series-empty');
      if (emptyMsg) emptyMsg.remove();
      grid.insertBefore(createFolderCard(global.Bookmarks.getBookmark(id)), grid.firstChild);
      countEl.textContent = global.Bookmarks.getAllBookmarks().length + '개의 북마크가 있습니다!';
    }
    newBtn.addEventListener('click', submitCreate);
    newInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submitCreate(); }
    });
  }

  // ---- 라이브러리 목록 모드 ----
  function renderLibraryList() {
    titleEl.textContent = '북마크 라이브러리';
    subEl.textContent = '다른 사람들이 공개한 북마크를 둘러보세요';
    countEl.textContent = '불러오는 중...';

    contentEl.innerHTML = '';
    contentEl.appendChild(createTabs('library'));

    var grid = document.createElement('div');
    grid.className = 'series-grid';
    contentEl.appendChild(grid);

    var total = 0;

    function createLibraryCard(entry) {
      var card = document.createElement('article');
      card.className = 'series-card bkm-folder-card bkm-library-card';

      var image = document.createElement('div');
      image.className = 'series-card-image bkm-folder-image';
      image.innerHTML = GLOBE_ICON;
      card.appendChild(image);

      var info = document.createElement('div');
      info.className = 'series-card-info';

      var title = document.createElement('p');
      title.className = 'series-card-title';
      title.textContent = entry.name || '(이름 없음)';
      info.appendChild(title);

      var count = document.createElement('p');
      count.className = 'series-card-count';
      count.textContent = entry.itemCount + '개 | ' + entry.code;
      info.appendChild(count);

      card.appendChild(info);

      card.addEventListener('click', function () {
        global.location.href = 'bookmarksPage.html?libraryId=' + encodeURIComponent(entry.code);
      });

      return card;
    }

    // 서버가 전체를 훑어 정렬·검색한 뒤 잘라주므로 offset 페이징을 쓴다
    // (정렬이 바뀌면 커서가 의미를 잃는다 — worker/favoritesShareWorker.js 참고).
    var LIB_PAGE = 20;
    var libSort = 'new';
    var libQuery = '';
    var libOffset = 0;
    var searchTimer = null;
    // 빠르게 입력하면 이전 요청이 늦게 도착해 목록을 덮어쓰거나 '더 보기'
    // 버튼을 중복으로 붙일 수 있어, 세대 번호로 낡은 응답을 버린다
    var loadSeq = 0;

    var toolbar = document.createElement('div');
    toolbar.className = 'bkm-list-toolbar bkm-library-toolbar';

    var searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'bkm-inline-create-input bkm-library-search';
    searchInput.placeholder = '북마크 이름으로 검색';
    searchInput.autocomplete = 'off';

    var sortSelect = document.createElement('select');
    sortSelect.className = 'bkm-library-sort';
    [['new', '최신순'], ['updated', '최근 수정순'], ['name', '이름순']].forEach(function (opt) {
      var o = document.createElement('option');
      o.value = opt[0];
      o.textContent = opt[1];
      sortSelect.appendChild(o);
    });

    toolbar.appendChild(searchInput);
    toolbar.appendChild(sortSelect);
    contentEl.insertBefore(toolbar, grid);

    function clearLoadMore() {
      var stale = contentEl.querySelectorAll('.bkm-load-more');
      for (var i = 0; i < stale.length; i++) stale[i].remove();
    }

    function resetAndLoad() {
      libOffset = 0;
      grid.innerHTML = '';
      clearLoadMore();
      countEl.textContent = '불러오는 중...';
      loadPage(null, null);
    }

    searchInput.addEventListener('input', function () {
      libQuery = searchInput.value.trim();
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(resetAndLoad, 250);
    });
    sortSelect.addEventListener('change', function () {
      libSort = sortSelect.value;
      resetAndLoad();
    });

    function loadPage(_ignored, loadMoreBtn) {
      var seq = ++loadSeq;
      return global.BookmarkLibrary.list({ sort: libSort, q: libQuery, offset: libOffset, limit: LIB_PAGE })
        .then(function (data) {
          if (seq !== loadSeq) return;   // 낡은 응답 — 버린다
          var items = data.items || [];
          items.forEach(function (entry) {
            grid.appendChild(createLibraryCard(entry));
          });
          libOffset += items.length;
          total = data.total || 0;

          if (libQuery) {
            countEl.textContent = total
              ? '"' + libQuery + '" 검색 결과 ' + total + '개'
              : '"' + libQuery + '" 검색 결과가 없어요';
          } else {
            countEl.textContent = total + '개의 공개 북마크가 있어요!';
          }

          clearLoadMore();

          if (data.hasMore) {
            var moreBtn = document.createElement('button');
            moreBtn.type = 'button';
            moreBtn.className = 'bkm-load-more';
            moreBtn.textContent = '더 보기 (' + libOffset + '/' + total + ')';
            moreBtn.addEventListener('click', function () {
              moreBtn.disabled = true;
              moreBtn.textContent = '불러오는 중...';
              loadPage(null, moreBtn);
            });
            contentEl.appendChild(moreBtn);
          } else if (!libOffset) {
            var empty = document.createElement('p');
            empty.className = 'series-empty';
            empty.textContent = libQuery
              ? '검색 결과가 없어요. 다른 이름으로 찾아보세요.'
              : '아직 공개된 북마크가 없어요. 내 북마크 탭에서 공유 버튼을 눌러 처음으로 공개해보세요!';
            grid.appendChild(empty);
          }

          if (data.truncated) {
            var warn = document.createElement('p');
            warn.className = 'bkm-share-note';
            warn.textContent = '공개 북마크가 너무 많아 일부만 정렬해 보여주고 있어요.';
            contentEl.appendChild(warn);
          }
        })
        .catch(function (err) {
          if (seq !== loadSeq) return;
          countEl.textContent = '불러오기 실패';
          clearLoadMore();
          var msg = document.createElement('p');
          msg.className = 'series-empty';
          msg.textContent = err.message;
          grid.appendChild(msg);
        });
    }

    loadPage(null, null);
  }

  // ---- 라이브러리 상세 모드 ----
  var TYPE_LABELS = { novel: '문학', series: '시리즈', hof: '명예관', official: '공식' };

  function renderLibraryDetail(code) {
    titleEl.textContent = '북마크 라이브러리';
    subEl.innerHTML = '';
    var backLink = document.createElement('a');
    backLink.className = 'bkm-back-link';
    backLink.href = 'bookmarksPage.html?tab=library';
    backLink.textContent = '‹ 라이브러리로';
    subEl.appendChild(backLink);
    countEl.textContent = '불러오는 중...';

    contentEl.innerHTML = '';

    // 타입 필터 칩 — 내 북마크 상세(renderDetail)와 같은 UI. 다만 여기는
    // 남이 공개한 걸 구경만 하는 자리라 항목을 뺄 수 없으니, 그쪽의
    // onRemovedFromCurrentView 처리 없이 필터링만 한다.
    var chipBar = document.createElement('div');
    chipBar.className = 'bkm-filter-chips';
    contentEl.appendChild(chipBar);

    var grid = document.createElement('div');
    grid.className = 'series-grid';
    contentEl.appendChild(grid);

    var activeType = 'all';

    Promise.all([global.BookmarkLibrary.getOne(code), loadItemLookup()])
      .then(function (results) {
        var shared = results[0];
        var byId = results[1];

        titleEl.textContent = shared.name;

        // 실제로 데이터에서 찾아진 항목만 대상으로 삼는다(원본이 사라진
        // 항목은 카드로 못 그리므로 개수에서도 빼야 숫자가 맞는다)
        var resolved = [];
        (shared.items || []).forEach(function (entry) {
          var s = byId[entry.type] && byId[entry.type][entry.id];
          if (s) resolved.push({ type: entry.type, data: s });
        });

        function countOf(type) {
          if (type === 'all') return resolved.length;
          var n = 0;
          for (var i = 0; i < resolved.length; i++) if (resolved[i].type === type) n++;
          return n;
        }

        function updateCount() {
          countEl.textContent = activeType === 'all'
            ? resolved.length + '개의 항목이 공개돼 있어요!'
            : countOf(activeType) + '개의 ' + TYPE_LABELS[activeType] + ' 항목';
        }

        function showEmptyIfNeeded() {
          if (grid.children.length) return;
          var empty = document.createElement('p');
          empty.className = 'series-empty';
          empty.textContent = resolved.length
            ? (TYPE_LABELS[activeType] || '') + ' 항목이 없어요.'
            : '이 북마크에는 볼 수 있는 항목이 없어요.';
          grid.appendChild(empty);
        }

        function renderGrid() {
          grid.innerHTML = '';
          var shown = resolved.filter(function (r) {
            return activeType === 'all' || r.type === activeType;
          });
          // 카드의 북마크 버튼은 opts 없이 붙는다 — 그러면 BookmarkPicker 가
          // 기본 동작(내 북마크에 담기)을 하므로, 마음에 드는 항목을 바로
          // 내 북마크로 가져올 수 있다.
          shown.forEach(function (r) {
            grid.appendChild(createItemCard(r.type, r.data));
          });
          showEmptyIfNeeded();
        }

        function updateChips() {
          chipBar.innerHTML = '';
          var types = ['all'].concat(Object.keys(TYPE_LABELS).filter(function (t) {
            return countOf(t) > 0;
          }));
          if (activeType !== 'all' && types.indexOf(activeType) === -1) activeType = 'all';

          types.forEach(function (t) {
            var chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'bkm-chip' + (t === activeType ? ' is-active' : '');
            chip.textContent = (t === 'all' ? '전체' : TYPE_LABELS[t]) + ' ' + countOf(t);
            chip.addEventListener('click', function () {
              if (activeType === t) return;
              activeType = t;
              updateChips();
              updateCount();
              renderGrid();
            });
            chipBar.appendChild(chip);
          });
          chipBar.hidden = types.length <= 2;
        }

        updateChips();
        updateCount();
        renderGrid();
      })
      .catch(function (err) {
        countEl.textContent = '불러오기 실패';
        showMessage(err.message);
      });
  }

  // ---- 상세 모드 ----
  function renderDetail(bookmarkId) {
    if (!isLoggedIn()) {
      titleEl.textContent = '북마크';
      subEl.textContent = '';
      countEl.textContent = '';
      renderLoginGate(false);
      return;
    }
    var bookmark = global.Bookmarks.getBookmark(bookmarkId);
    if (!bookmark) {
      titleEl.textContent = '북마크';
      subEl.textContent = '';
      countEl.textContent = '';
      showMessage('북마크를 찾을 수 없어요.');
      return;
    }

    titleEl.textContent = bookmark.name;
    subEl.innerHTML = '';
    var backLink = document.createElement('a');
    backLink.className = 'bkm-back-link';
    backLink.href = 'bookmarksPage.html';
    backLink.textContent = '‹ 북마크 목록으로';
    subEl.appendChild(backLink);

    countEl.textContent = bookmark.items.length + '개의 항목이 있어요!';

    contentEl.innerHTML = '';

    // 타입 필터 칩 — 그리드는 하나로 두고 '전체'가 기본이라 담은 순서를
    // 그대로 볼 수 있고, 칩을 누르면 해당 타입만 남는다
    var chipBar = document.createElement('div');
    chipBar.className = 'bkm-filter-chips';
    contentEl.appendChild(chipBar);

    var grid = document.createElement('div');
    grid.className = 'series-grid';
    contentEl.appendChild(grid);

    var activeType = 'all';

    loadItemLookup().then(function (byId) {
      // 실제로 데이터에서 찾아진 항목만 대상으로 삼는다 (원본이 사라진
      // 항목은 카드로 못 그리므로 개수에서도 빼야 숫자가 맞는다)
      var resolved = [];
      bookmark.items.forEach(function (entry) {
        var s = byId[entry.type] && byId[entry.type][entry.id];
        if (s) resolved.push({ type: entry.type, data: s });
      });

      function countOf(type) {
        if (type === 'all') return resolved.length;
        var n = 0;
        for (var i = 0; i < resolved.length; i++) if (resolved[i].type === type) n++;
        return n;
      }

      function renderGrid() {
        grid.innerHTML = '';
        var shown = resolved.filter(function (r) {
          return activeType === 'all' || r.type === activeType;
        });

        shown.forEach(function (r) {
          var card = createItemCard(r.type, r.data, {
            viewingBookmarkId: bookmark.id,
            onRemovedFromCurrentView: function () {
              // 해제된 항목은 목록에서도 빼야 칩 개수가 어긋나지 않는다
              var idx = resolved.indexOf(r);
              if (idx !== -1) resolved.splice(idx, 1);
              card.remove();

              // 마지막 항목을 지워 그 타입 칩이 사라지면 updateChips 가
              // activeType 을 'all' 로 되돌린다 — 이때는 필터가 바뀐 것이므로
              // 그리드를 다시 그려야 남은 다른 타입 카드들이 나타난다
              var prevType = activeType;
              updateChips();
              updateCount();
              if (activeType !== prevType) renderGrid();
              else showEmptyIfNeeded();
            }
          });
          grid.appendChild(card);
        });

        showEmptyIfNeeded();
      }

      function showEmptyIfNeeded() {
        if (grid.children.length) return;
        var empty = document.createElement('p');
        empty.className = 'series-empty';
        empty.textContent = resolved.length
          ? (TYPE_LABELS[activeType] || '') + ' 항목이 없어요.'
          : '이 북마크에는 아직 항목이 없어요.';
        grid.appendChild(empty);
      }

      function updateCount() {
        countEl.textContent = activeType === 'all'
          ? resolved.length + '개의 항목이 있어요!'
          : countOf(activeType) + '개의 ' + TYPE_LABELS[activeType] + ' 항목';
      }

      function updateChips() {
        chipBar.innerHTML = '';
        var types = ['all'].concat(Object.keys(TYPE_LABELS).filter(function (t) {
          return countOf(t) > 0;   // 비어 있는 타입은 칩 자체를 숨긴다
        }));
        // 지금 보고 있던 타입이 비었으면 전체로 되돌린다
        if (activeType !== 'all' && types.indexOf(activeType) === -1) activeType = 'all';

        types.forEach(function (t) {
          var chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'bkm-chip' + (t === activeType ? ' is-active' : '');
          chip.textContent = (t === 'all' ? '전체' : TYPE_LABELS[t]) + ' ' + countOf(t);
          chip.addEventListener('click', function () {
            if (activeType === t) return;
            activeType = t;
            updateChips();
            updateCount();
            renderGrid();
          });
          chipBar.appendChild(chip);
        });
        // 타입이 한 종류뿐이면 굳이 칩을 보여줄 필요가 없다
        chipBar.hidden = types.length <= 2;
      }

      updateChips();
      updateCount();
      renderGrid();
    });
  }

  var params = new URLSearchParams(global.location.search);
  var bkmId = params.get('id');
  var libId = params.get('libraryId');

  function renderCurrentView() {
    if (bkmId) renderDetail(bkmId);
    else if (libId) renderLibraryDetail(libId);
    else renderList(params.get('tab') === 'library' ? 'library' : 'mine');
  }

  // 로그인/로그아웃하면 지금 보고 있던 화면을 그 자리에서 다시 그린다 —
  // 안내판에서 로그인한 사람이 새로고침하지 않아도 목록을 바로 보게 하고,
  // 반대로 로그아웃하면 남아 있던 목록이 즉시 안내판으로 바뀌게 한다.
  global.addEventListener('chokaguya:auth-change', renderCurrentView);

  renderCurrentView();
})(window);
