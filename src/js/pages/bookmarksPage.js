/**
 * ChoKaguya Bookmarks Page
 * - 목록 모드(URL 에 ?id= 없음): 탭 두 개.
 *   · 내 북마크: 내가 만든 북마크(이름 있는 모음)들을 폴더 카드로 보여줌.
 *   · 북마크 라이브러리(?tab=library): 다른 사람이 공개한 북마크 목록.
 * - 상세 모드(?id=<북마크id>): Lookup.json(Novel/Series/HOF/Official.json 을
 *   미리 합쳐 경량화해 둔 조회 인덱스, src/scripts/11_build_lookup.py)을
 *   불러와 그 북마크에 담긴 항목들을 담은 순서 그대로 하나의 그리드로
 *   보여줌 — 타입별로 안 나눔(유저가 문학/시리즈를 섞어 담을 수 있어서).
 * - 라이브러리 상세(?libraryId=<code>): 공개된 북마크 하나를 같은 방식으로
 *   보여줌. 카드의 북마크 버튼은 그대로 살아있어서 마음에 드는 항목을
 *   바로 내 북마크에 담을 수 있음.
 * - 공개/수정/삭제는 bookmarkLibrary.js 를 통해 Worker 로 나감
 *   (BOOKMARK_SYSTEM_PLAN.md 참고).
 */
(function (global) {
  var t = global.I18n.t;
  // ---- 이 페이지 안에서만 쓰는 라우팅 + 캐시 ----
  // "내 북마크"/"라이브러리" 탭, 목록/상세 전환이 전부 <a href="/bookmarks?...">
  // 진짜 페이지 이동이었다 — 왔다갔다할 때마다 로더 애니메이션이 다시 재생되고,
  // 라이브러리 쪽은 서버 요청도 매번 새로 나갔다. pushState + 다시 그리기로
  // 바꾸고, 서버에서 받은 것들은 이 세션(페이지를 안 벗어나는 동안) 안에서
  // 재사용한다.
  var itemLookupPromise = null;   // Lookup.json — 상세를 몇 번 열어도 1회만
  var libraryListCache = null;    // 라이브러리 목록 — 탭을 오갈 때 재요청 방지
  var libraryDetailCache = {};    // code -> 라이브러리 상세 Promise

  function navigate(url) {
    global.history.pushState(null, '', url);
    // 원래는(진짜 페이지 이동이었을 때) 새로고침 자체가 사이드바를 닫힌
    // 상태로 되돌렸다 — pushState로 안 바뀌므로 여기서 직접 닫아준다
    // (loading.js의 같은-페이지 링크 보호 로직이 하던 것과 동일).
    if (global.Sidebar && typeof global.Sidebar.close === 'function') {
      global.Sidebar.close();
    }
    renderCurrentView();
  }

  var KEBAB_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="12" cy="19" r="1.9"/></svg>';
  var SHARE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="M8.3 10.8l7.4-4.3M8.3 13.2l7.4 4.3"/></svg>';
  var DELETE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>';

  var contentEl = document.getElementById('bkm-content');
  var countEl = document.getElementById('bkm-count');
  var titleEl = document.getElementById('bkm-title');
  var subEl = document.getElementById('bkm-sub');
  var DATA = global.dataUrl || function (p) { return p; };

  // #bkm-title(h1)은 헤더 로고 개편 때 다른 페이지들과 함께 주석 처리됐다 —
  // 거긴 정적 텍스트라 안전했지만 여기는 JS가 매 화면마다 갱신하므로,
  // 엘리먼트가 없어도 죽지 않게 null-safe 로 감싼다.
  function setTitle(text) {
    if (titleEl) titleEl.textContent = text;
  }

  function showMessage(text) {
    contentEl.innerHTML = '';
    var p = document.createElement('p');
    p.className = 'series-empty';
    p.textContent = text;
    contentEl.appendChild(p);
  }

  // 상세 모드(내 북마크 / 라이브러리)가 공통으로 쓰는 조회맵 로더 —
  // src/scripts/11_build_lookup.py 가 미리 { type: { 대표게시물id: 항목 } }
  // 모양으로 구워둔 Lookup.json 하나만 받는다. 예전엔 이거 하나 때문에
  // Novel/Series/HOF/Official.json 4개(~778KB)를 통째로 받았다
  // (TRAFFIC_SECURITY_AUDIT_2.md N-T6).
  function loadItemLookup() {
    // 상세를 여러 번 열어도(내 북마크든 라이브러리든) 이 세션 안에서는
    // 한 번만 받는다 — 실패해도 빈 조회맵으로 대체하므로(catch) 이 Promise는
    // 사실상 항상 resolve된다.
    if (itemLookupPromise) return itemLookupPromise;

    itemLookupPromise = fetch(DATA('../data/pageData/Lookup.json'))
      .then(function (r) { return r.json(); })
      .catch(function () { return { novel: {}, series: {}, hof: {}, official: {} }; });
    return itemLookupPromise;
  }

  // 목록 모드 상단의 "내 북마크 | 북마크 라이브러리" 알약 토글 —
  // src/js/components/tabsKit.js 가 탭 바 DOM(+움직이는 인디케이터)을 한 번만 만들고
  // setActive()로 상태만 갱신한다. 이 페이지는 이미 문서 전체에 링크
  // 가로채기(맨 아래 document.addEventListener('click', ...))가 있으므로
  // onActivate는 안 넘긴다 — 탭 클릭도 그 공통 경로(navigate)를 그대로 탄다.
  var tabsKitInstance = null;
  function ensureTabs() {
    if (tabsKitInstance) return tabsKitInstance;
    tabsKitInstance = TabsKit.createTabs([
      { key: 'mine', label: t('내 북마크'), href: '/bookmarks' },
      { key: 'library', label: t('북마크 라이브러리'), href: '/bookmarks?tab=library' }
    ]);
    return tabsKitInstance;
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
    } else if (global.TagConfig && global.TagConfig.applyTextCover) {
      // 이미지가 없는 작품은 제목·작가를 올린 책 표지 모양으로 자리를 채운다.
      global.TagConfig.applyTextCover(image, {
        name: s.name,
        author: s.author,
        tags: (s.tags && s.tags.length) ? s.tags : s.popularUserTags
      });
    }

    var favId = s.posts && s.posts[0] && s.posts[0].id;
    if (favId != null) {
      image.appendChild(global.BookmarkPicker.createButton(type, favId, opts));
    }
    if (favId != null && global.BumpButton) {
      image.appendChild(global.BumpButton.createButton(type, favId, s.name));
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
    count.textContent = SeriesUtil.countLine(s);
    info.appendChild(count);

    card.appendChild(info);

    card.addEventListener('click', function () {
      if (!global.PostDetailSeries) return;
      PostDetailSeries.open({
        seriesName: s.name,
        imageUrl: s.image,
        favType: type,
        postId: favId,
        tags: s.tags,
        audio: s.audio,
        episodes: (s.posts || []).map(function (post) {
          return {
            title: post.title,
            dcId: post.id,
            link: post.link,
            episodeLabel: t('{n} 화', { n: post.episode })
          };
        })
      });
    });

    return card;
  }

  // ---- 공개(공유) 패널 ----
  // bookmarkPicker.js/auth.js와 같은 앵커 팝오버 메커니즘(싱글턴 +
  // 바깥클릭/Escape로 닫힘 + 뷰포트 클램프) — popoverKit.js가 담당하고,
  // 여기는 내용(버튼 두어 개)만 그린다.
  var sharePanelEl = null;
  var sharePanel = global.PopoverKit.createPopover('bkm-picker bkm-share-panel', 280);

  function ensureSharePanel() {
    sharePanelEl = sharePanel.ensure();
    return sharePanelEl;
  }

  function closeSharePanel() {
    sharePanel.close();
  }

  function positionSharePanel(anchorEl) {
    sharePanel.position(anchorEl);
  }

  function sharePanelHeader(text) {
    return global.PopoverKit.header(text);
  }

  function sharePanelButton(label, variant) {
    return global.PopoverKit.button(label, variant);
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
    panel.appendChild(sharePanelHeader(t('라이브러리에 공개했어요!')));

    var linkLabel = document.createElement('p');
    linkLabel.className = 'bkm-share-note';
    linkLabel.textContent = t('공개 링크');
    panel.appendChild(linkLabel);

    var linkInput = document.createElement('input');
    linkInput.type = 'text';
    linkInput.className = 'bkm-share-code';
    linkInput.readOnly = true;
    linkInput.value = global.location.origin + global.location.pathname + '?libraryId=' + code;
    linkInput.addEventListener('focus', function () { linkInput.select(); });
    panel.appendChild(linkInput);

    panel.appendChild(sharePanelNote(t('로그인된 계정에 연결됐어요. 다른 기기에서도 같은 개인 코드로 로그인하면 수정·공개취소까지 그대로 할 수 있어요.')));
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

  // 목록 카드 부제 — 공개된 북마크는 그 공개 코드를, 비공개면 만든 날짜를
  // 보여준다(둘 다 없는 경우는 없음: createBookmark 가 항상 createdAt 을 채움).
  function formatBookmarkMeta(bookmark) {
    var code = getPublishedCode(bookmark);
    if (code) return t('공개 코드 {code}', { code: code });
    var d = new Date(bookmark.createdAt || Date.now());
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return t('{date} 생성', { date: d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate()) });
  }

  function openSharePanel(anchorEl, bookmark, onStateChange) {
    var panel = ensureSharePanel();
    panel.innerHTML = '';

    var publishedCode = getPublishedCode(bookmark);

    if (!publishedCode) {
      panel.appendChild(sharePanelHeader(t('이 북마크를 라이브러리에 공개할까요?')));
      panel.appendChild(sharePanelNote(t('{n}개의 항목이 함께 공개돼요. 누구나 볼 수 있어요.', { n: bookmark.items.length })));

      var publishBtn = sharePanelButton(t('라이브러리에 공개하기'), 'is-primary');
      function doPublish() {
        publishBtn.disabled = true;
        publishBtn.textContent = t('공개하는 중...');
        global.BookmarkLibrary.publish(bookmark.name, bookmark.items, bookmark.id)
          .then(function (data) {
            global.Bookmarks.setPublishedCode(bookmark.id, data.code);
            // 스토어는 갱신됐지만 이 함수가 들고 있는 bookmark 는 카드 생성
            // 시점의 스냅샷이라 따로 갱신 안 하면 이 화면 안에서는 여전히
            // "공개 안 됨"으로 보인다.
            bookmark.publishedCode = data.code;
            // 방금 공개한 게 라이브러리 탭에 바로 보여야 하니 캐시를 비운다
            libraryListCache = null;
            renderPublishedResult(panel, data.code);
            positionSharePanel(anchorEl);
            if (onStateChange) onStateChange();
          })
          .catch(function (err) {
            panel.innerHTML = '';
            panel.appendChild(sharePanelHeader(t('공개하지 못했어요')));
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
            reason: t('북마크를 공개하려면 먼저 로그인해주세요'),
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
      panel.appendChild(sharePanelHeader(t('이미 라이브러리에 공개된 북마크예요')));

      var viewLink = document.createElement('a');
      viewLink.className = 'bkm-share-link';
      viewLink.href = '/bookmarks?libraryId=' + encodeURIComponent(publishedCode);
      viewLink.textContent = t('공개된 모습 보기 →');
      panel.appendChild(viewLink);

      var updateBtn = sharePanelButton(t('최신 내용으로 업데이트'), 'is-primary');
      updateBtn.addEventListener('click', function () {
        updateBtn.disabled = true;
        updateBtn.textContent = t('업데이트 중...');
        global.BookmarkLibrary.update(publishedCode, { name: bookmark.name, items: bookmark.items })
          .then(function () {
            updateBtn.textContent = t('업데이트 완료!');
            // 이름/항목이 바뀌었으니 목록·상세 캐시 둘 다 낡은 값이다
            libraryListCache = null;
            delete libraryDetailCache[publishedCode];
          })
          .catch(function (err) {
            updateBtn.disabled = false;
            updateBtn.textContent = t('최신 내용으로 업데이트');
            // 이미 지워진 게시물이면(다른 기기에서 먼저 공개 취소) 로컬에
            // 남아있던 publishedCode도 같이 지워서 다음엔 "공개 안 됨"으로
            // 정확히 보이게 한다.
            if (err.status === 404) {
              global.Bookmarks.setPublishedCode(bookmark.id, null);
              bookmark.publishedCode = null;
            }
            panel.appendChild(sharePanelNote(err.message));
            positionSharePanel(anchorEl);
          });
      });
      panel.appendChild(updateBtn);

      var unpublishBtn = sharePanelButton(t('공개 취소'), 'is-danger');
      unpublishBtn.addEventListener('click', function () {
        if (!global.confirm(t('"{name}" 북마크의 공개를 취소할까요? 라이브러리에서 사라져요.', { name: bookmark.name }))) return;
        unpublishBtn.disabled = true;
        unpublishBtn.textContent = t('취소하는 중...');
        global.BookmarkLibrary.unpublish(publishedCode)
          .then(function () {
            global.Bookmarks.setPublishedCode(bookmark.id, null);
            bookmark.publishedCode = null;
            // 목록에서 빠져야 하고, 상세는 더 이상 존재하지 않는다
            libraryListCache = null;
            delete libraryDetailCache[publishedCode];
            closeSharePanel();
            if (onStateChange) onStateChange();
          })
          .catch(function (err) {
            unpublishBtn.disabled = false;
            unpublishBtn.textContent = t('공개 취소');
            if (err.status === 404) {
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

  // 상세 화면 헤더의 케밥(⋮) 버튼 — 목록 카드에서 빠진 이름 바꾸기·공개·
  // 삭제를 여기로 모았다. 패널은 openSharePanel 과 같은 싱글턴을 쓰므로
  // "공개하기"를 누르면 자연스럽게 그 UI로 이어진다.
  function openBookmarkMenu(anchorEl, bookmark, callbacks) {
    var panel = ensureSharePanel();
    panel.innerHTML = '';
    panel.appendChild(sharePanelHeader(t('북마크 관리')));

    var renameBtn = sharePanelButton(t('이름 바꾸기'));
    renameBtn.addEventListener('click', function () {
      panel.innerHTML = '';
      panel.appendChild(sharePanelHeader(t('이름 바꾸기')));

      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'bkm-share-code';
      input.value = bookmark.name;
      input.maxLength = global.LibraryConfig ? global.LibraryConfig.MAX_NAME_LENGTH : 20;
      panel.appendChild(input);

      var saveBtn = sharePanelButton(t('저장'), 'is-primary');
      saveBtn.addEventListener('click', function () {
        if (input.value.trim() && global.Bookmarks.renameBookmark(bookmark.id, input.value)) {
          bookmark.name = input.value.trim();
          if (callbacks.onRenamed) callbacks.onRenamed(bookmark.name);
        }
        closeSharePanel();
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); }
      });
      panel.appendChild(saveBtn);

      positionSharePanel(anchorEl);
      input.focus();
      input.select();
    });
    panel.appendChild(renameBtn);

    var shareBtn = sharePanelButton(getPublishedCode(bookmark) ? t('공개 관리') : t('라이브러리에 공개하기'));
    shareBtn.addEventListener('click', function () {
      openSharePanel(anchorEl, bookmark, null);
    });
    panel.appendChild(shareBtn);

    var deleteBtn = sharePanelButton(t('북마크 삭제'), 'is-danger');
    deleteBtn.addEventListener('click', function () {
      if (!global.confirm(t('"{name}" 북마크를 삭제할까요?', { name: bookmark.name }))) return;
      var publishedCode = getPublishedCode(bookmark);
      if (publishedCode) {
        global.BookmarkLibrary.unpublish(publishedCode).catch(function () {});
        libraryListCache = null;
        delete libraryDetailCache[publishedCode];
      }
      global.Bookmarks.deleteBookmark(bookmark.id);
      closeSharePanel();
      if (callbacks.onDeleted) callbacks.onDeleted();
    });
    panel.appendChild(deleteBtn);

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
    if (withTabs) { contentEl.appendChild(ensureTabs().el); ensureTabs().setActive('mine'); }

    var box = document.createElement('div');
    box.className = 'bkm-login-gate';

    var heading = document.createElement('p');
    heading.className = 'bkm-login-gate-title';
    heading.textContent = t('북마크는 로그인한 뒤에 쓸 수 있어요');
    box.appendChild(heading);

    var desc = document.createElement('p');
    desc.className = 'bkm-login-gate-desc';
    var localCount = global.Bookmarks ? global.Bookmarks.getAllBookmarks().length : 0;
    desc.textContent = localCount
      ? t('이 기기에 저장해 둔 북마크 {n}개가 있어요. 로그인하면 계정으로 옮겨져서 다른 기기에서도 그대로 볼 수 있어요.', { n: localCount })
      : t('로그인하면 북마크가 계정에 저장돼서, 다른 기기에서도 그대로 이어서 볼 수 있어요.');
    box.appendChild(desc);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bkm-inline-create-btn bkm-login-gate-btn';
    btn.textContent = localCount ? t('로그인하고 이어서 쓰기') : t('로그인하기');
    btn.addEventListener('click', function () {
      global.AuthModal.requireLogin({ reason: t('북마크를 쓰려면 먼저 로그인해주세요') });
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

    setTitle(t('북마크'));
    subEl.textContent = t('내가 만든 북마크들을 모아봤어요');

    if (!isLoggedIn()) {
      countEl.textContent = '';
      renderLoginGate(true);
      return;
    }

    var bookmarks = global.Bookmarks.getAllBookmarks();
    countEl.textContent = t('{n}개의 북마크가 있습니다!', { n: bookmarks.length });

    contentEl.innerHTML = '';
    contentEl.appendChild(ensureTabs().el);
    ensureTabs().setActive('mine');

    var toolbar = document.createElement('div');
    toolbar.className = 'bkm-list-toolbar';
    var form = document.createElement('div');
    form.className = 'bkm-inline-create';
    var newInput = document.createElement('input');
    newInput.type = 'text';
    newInput.className = 'bkm-inline-create-input';
    newInput.placeholder = t('새 북마크 이름');
    newInput.maxLength = global.LibraryConfig ? global.LibraryConfig.MAX_NAME_LENGTH : 20;
    var newBtn = document.createElement('button');
    newBtn.type = 'button';
    newBtn.className = 'bkm-inline-create-btn';
    newBtn.textContent = t('+ 새 북마크');
    form.appendChild(newInput);
    form.appendChild(newBtn);
    toolbar.appendChild(form);

    contentEl.appendChild(toolbar);

    var grid = document.createElement('div');
    grid.className = 'bkm-row-list';
    contentEl.appendChild(grid);

    function showEmptyIfNeeded() {
      if (grid.children.length) return;
      var empty = document.createElement('p');
      empty.className = 'series-empty';
      empty.textContent = t('아직 만든 북마크가 없어요. 카드의 북마크 아이콘을 눌러 새로 만들어보세요!');
      grid.appendChild(empty);
    }

    // Figma "Button_BookMark" 참고 — 가로형 리스트 버튼. 삭제·공유·이름
    // 바꾸기는 더 이상 카드 위에 아이콘으로 얹지 않고, 카드를 눌러 들어간
    // 상세 화면의 케밥 메뉴(openBookmarkMenu)로 옮겼다.
    function createFolderCard(bookmark) {
      var card = document.createElement('article');
      card.className = 'bkm-row-card';

      var info = document.createElement('div');
      info.className = 'bkm-row-info';

      var title = document.createElement('p');
      title.className = 'bkm-row-title';
      title.textContent = bookmark.name;
      info.appendChild(title);

      var sub = document.createElement('p');
      sub.className = 'bkm-row-sub';
      sub.textContent = formatBookmarkMeta(bookmark);
      info.appendChild(sub);

      card.appendChild(info);

      var right = document.createElement('div');
      right.className = 'bkm-row-right';

      var count = document.createElement('p');
      count.className = 'bkm-row-count';
      count.textContent = t('{n}개', { n: bookmark.items.length });
      right.appendChild(count);

      var shareBtn = document.createElement('button');
      shareBtn.type = 'button';
      shareBtn.className = 'bkm-row-icon-btn';
      shareBtn.innerHTML = SHARE_ICON;
      shareBtn.setAttribute('aria-label', t('라이브러리에 공개하기'));
      function syncShareState() {
        shareBtn.classList.toggle('is-published', !!getPublishedCode(bookmark));
        sub.textContent = formatBookmarkMeta(bookmark);
      }
      syncShareState();
      shareBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openSharePanel(shareBtn, bookmark, syncShareState);
      });
      right.appendChild(shareBtn);

      var deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'bkm-row-icon-btn is-danger';
      deleteBtn.innerHTML = DELETE_ICON;
      deleteBtn.setAttribute('aria-label', t('북마크 삭제'));
      deleteBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (!global.confirm(t('"{name}" 북마크를 삭제할까요?', { name: bookmark.name }))) return;
        var publishedCode = getPublishedCode(bookmark);
        if (publishedCode) {
          global.BookmarkLibrary.unpublish(publishedCode).catch(function () {});
          libraryListCache = null;
          delete libraryDetailCache[publishedCode];
        }
        global.Bookmarks.deleteBookmark(bookmark.id);
        card.remove();
        countEl.textContent = t('{n}개의 북마크가 있습니다!', { n: global.Bookmarks.getAllBookmarks().length });
        showEmptyIfNeeded();
      });
      right.appendChild(deleteBtn);

      card.appendChild(right);

      card.addEventListener('click', function () {
        navigate('/bookmarks?id=' + encodeURIComponent(bookmark.id));
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
      countEl.textContent = t('{n}개의 북마크가 있습니다!', { n: global.Bookmarks.getAllBookmarks().length });
    }
    newBtn.addEventListener('click', submitCreate);
    newInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submitCreate(); }
    });
  }

  // ---- 라이브러리 목록 모드 ----
  function renderLibraryList() {
    setTitle(t('북마크 라이브러리'));
    subEl.textContent = t('다른 사람들이 공개한 북마크를 둘러보세요');

    contentEl.innerHTML = '';
    contentEl.appendChild(ensureTabs().el);
    ensureTabs().setActive('library');

    var grid = document.createElement('div');
    grid.className = 'bkm-row-list';
    contentEl.appendChild(grid);

    var total = 0;

    // 내 북마크 목록(createFolderCard)과 같은 Figma "Button_BookMark" 형식.
    // 부제 자리는 항상 공개 코드 — 라이브러리는 공개된 것만 모아두는
    // 곳이라 formatBookmarkMeta 의 "비공개면 생성일" 분기가 필요 없다.
    function createLibraryCard(entry) {
      var card = document.createElement('article');
      card.className = 'bkm-row-card';

      var info = document.createElement('div');
      info.className = 'bkm-row-info';

      var title = document.createElement('p');
      title.className = 'bkm-row-title';
      title.textContent = entry.name || t('(이름 없음)');
      info.appendChild(title);

      var sub = document.createElement('p');
      sub.className = 'bkm-row-sub';
      sub.textContent = t('공개 코드 {code}', { code: entry.code });
      info.appendChild(sub);

      card.appendChild(info);

      var count = document.createElement('p');
      count.className = 'bkm-row-count';
      count.textContent = t('{n}개', { n: entry.itemCount });
      card.appendChild(count);

      card.addEventListener('click', function () {
        navigate('/bookmarks?libraryId=' + encodeURIComponent(entry.code));
      });

      return card;
    }

    // 서버가 전체를 훑어 정렬·검색한 뒤 잘라주므로 offset 페이징을 쓴다
    // (정렬이 바뀌면 커서가 의미를 잃는다 — worker/favoritesShareWorker.js 참고).
    var LIB_PAGE = 20;
    // 탭을 나갔다 돌아왔을 때 마지막으로 보던 정렬/검색을 그대로 이어가려고
    // libraryListCache 에서 초기값을 가져온다(없으면 기본값).
    var libSort = (libraryListCache && libraryListCache.sort) || 'new';
    var libQuery = (libraryListCache && libraryListCache.query) || '';
    var libOffset = 0;
    var loadedItems = [];
    var searchTimer = null;
    // 빠르게 입력하면 이전 요청이 늦게 도착해 목록을 덮어쓰거나 '더 보기'
    // 버튼을 중복으로 붙일 수 있어, 세대 번호로 낡은 응답을 버린다
    var loadSeq = 0;

    var toolbar = document.createElement('div');
    toolbar.className = 'bkm-list-toolbar bkm-library-toolbar';

    var searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'bkm-inline-create-input bkm-library-search';
    searchInput.placeholder = t('북마크 이름으로 검색');
    searchInput.autocomplete = 'off';
    searchInput.value = libQuery;

    var sortSelect = document.createElement('select');
    sortSelect.className = 'bkm-library-sort';
    [['new', t('최신순')], ['updated', t('최근 수정순')], ['name', t('이름순')]].forEach(function (opt) {
      var o = document.createElement('option');
      o.value = opt[0];
      o.textContent = opt[1];
      sortSelect.appendChild(o);
    });
    sortSelect.value = libSort;

    toolbar.appendChild(searchInput);
    toolbar.appendChild(sortSelect);
    contentEl.insertBefore(toolbar, grid);

    function clearLoadMore() {
      var stale = contentEl.querySelectorAll('.bkm-load-more');
      for (var i = 0; i < stale.length; i++) stale[i].remove();
    }

    function resetAndLoad() {
      libOffset = 0;
      loadedItems = [];
      // gridPage.js와 같은 이유로, 그리드를 비우기 전에 지연 로딩
      // 옵저버부터 정리한다 — 안 그러면 검색/정렬을 반복할 때마다 사라진
      // 카드가 detached 상태로 옵저버에 계속 쌓인다.
      if (global.unobserveAllLazy) global.unobserveAllLazy();
      grid.innerHTML = '';
      clearLoadMore();
      countEl.textContent = t('불러오는 중...');
      loadPage();
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

    // 새로 받아온 페이지(또는 캐시에서 복원한 페이지)를 그리고, 이 세션의
    // 최신 상태로 libraryListCache 를 갱신한다 — 다음에 이 탭에 다시
    // 들어오면(정렬/검색이 그대로라면) 여기서 그린 결과를 그대로 재사용한다.
    function renderPage(items, data) {
      items.forEach(function (entry) { grid.appendChild(createLibraryCard(entry)); });
      loadedItems = loadedItems.concat(items);
      libOffset += items.length;
      total = data.total || 0;

      if (libQuery) {
        countEl.textContent = total
          ? t('"{query}" 검색 결과 {n}개', { query: libQuery, n: total })
          : t('"{query}" 검색 결과가 없어요', { query: libQuery });
      } else {
        countEl.textContent = t('{n}개의 공개 북마크가 있어요!', { n: total });
      }

      clearLoadMore();

      if (data.hasMore) {
        var moreBtn = document.createElement('button');
        moreBtn.type = 'button';
        moreBtn.className = 'bkm-load-more';
        moreBtn.textContent = t('더 보기') + ' (' + libOffset + '/' + total + ')';
        moreBtn.addEventListener('click', function () {
          moreBtn.disabled = true;
          moreBtn.textContent = t('불러오는 중...');
          loadPage();
        });
        contentEl.appendChild(moreBtn);
      } else if (!libOffset) {
        var empty = document.createElement('p');
        empty.className = 'series-empty';
        empty.textContent = libQuery
          ? t('검색 결과가 없어요. 다른 이름으로 찾아보세요.')
          : t('아직 공개된 북마크가 없어요. 내 북마크 탭에서 공유 버튼을 눌러 처음으로 공개해보세요!');
        grid.appendChild(empty);
      }

      if (data.truncated) {
        var warn = document.createElement('p');
        warn.className = 'bkm-share-note';
        warn.textContent = t('공개 북마크가 너무 많아 일부만 정렬해 보여주고 있어요.');
        contentEl.appendChild(warn);
      }

      libraryListCache = {
        sort: libSort, query: libQuery, items: loadedItems.slice(),
        offset: libOffset, total: total,
        hasMore: !!data.hasMore, truncated: !!data.truncated
      };
    }

    function loadPage() {
      var seq = ++loadSeq;
      return global.BookmarkLibrary.list({ sort: libSort, q: libQuery, offset: libOffset, limit: LIB_PAGE })
        .then(function (data) {
          if (seq !== loadSeq) return;   // 낡은 응답 — 버린다
          renderPage(data.items || [], data);
        })
        .catch(function (err) {
          if (seq !== loadSeq) return;
          countEl.textContent = t('불러오기 실패');
          clearLoadMore();
          var msg = document.createElement('p');
          msg.className = 'series-empty';
          msg.textContent = err.message;
          grid.appendChild(msg);
        });
    }

    // 캐시가 있고 지금 정렬/검색과 일치하면 서버에 다시 묻지 않고 그대로
    // 복원한다 — publish/unpublish/update 가 일어나면 libraryListCache 를
    // null 로 비워서 다음 진입 때는 이 분기를 안 타고 새로 받아오게 한다.
    if (libraryListCache && libraryListCache.sort === libSort && libraryListCache.query === libQuery) {
      renderPage(libraryListCache.items, libraryListCache);
    } else {
      countEl.textContent = t('불러오는 중...');
      loadPage();
    }
  }

  // ---- 라이브러리 상세 모드 ----
  // libraryConfig.js — worker의 LIBRARY_ITEM_TYPES와 짝을 맞춰야 하는 값이라 옮김
  var TYPE_LABELS = global.LibraryConfig.TYPE_LABELS;

  // renderLibraryDetail(남의 공개 북마크, 읽기 전용)과 renderDetail(내
  // 북마크, 항목 해제 가능)이 타입별 개수 세기와 필터 칩 바를 완전히
  // 동일한 코드로 각자 구현하고 있었다 — 그 두 조각만 여기로 뽑았다.
  // 카드 렌더링/빈 상태 문구/개수 문구는 두 화면이 실제로 다르므로
  // (예: 항목 해제 가능 여부, "공개돼 있어요" vs "있어요!") 그대로 각자 둔다.
  function countOfType(resolved, type) {
    if (type === 'all') return resolved.length;
    var n = 0;
    for (var i = 0; i < resolved.length; i++) if (resolved[i].type === type) n++;
    return n;
  }

  // state: 호출부가 들고 있는 { activeType } — 칩 클릭 시 여기 값을 바꾸고
  // onSelect 를 부른다. 호출부의 renderGrid/showEmptyIfNeeded도
  // 같은 state.activeType 을 읽어야 필터가 맞물린다.
  function renderTypeChips(chipBar, state, countOf, onSelect) {
    chipBar.innerHTML = '';
    var types = ['all'].concat(Object.keys(TYPE_LABELS).filter(function (type) {
      return countOf(type) > 0;
    }));
    if (state.activeType !== 'all' && types.indexOf(state.activeType) === -1) state.activeType = 'all';

    types.forEach(function (type) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'bkm-chip' + (type === state.activeType ? ' is-active' : '');
      chip.textContent = (type === 'all' ? t('전체') : TYPE_LABELS[type]) + ' ' + countOf(type);
      chip.addEventListener('click', function () {
        if (state.activeType === type) return;
        state.activeType = type;
        onSelect();
      });
      chipBar.appendChild(chip);
    });
    chipBar.hidden = types.length <= 2;
  }

  function renderLibraryDetail(code) {
    setTitle(t('북마크 라이브러리'));
    subEl.textContent = '';
    countEl.textContent = '';

    contentEl.innerHTML = '';

    // renderDetail 과 같은 이유로 subEl(#bkm-sub) 대신 contentEl 안에
    // 헤더를 직접 그린다 — 그 자리는 .site-info--hidden 으로 화면에서
    // 아예 지워져 있다.
    var header = document.createElement('div');
    header.className = 'bkm-detail-header';

    var titleH = document.createElement('h2');
    titleH.className = 'bkm-detail-title';
    titleH.textContent = t('북마크 라이브러리');
    header.appendChild(titleH);

    contentEl.appendChild(header);

    // 타입 필터 칩 — 내 북마크 상세(renderDetail)와 같은 UI. 다만 여기는
    // 남이 공개한 걸 구경만 하는 자리라 항목을 뺄 수 없으니, 그쪽의
    // onRemovedFromCurrentView 처리 없이 필터링만 한다.
    var chipBar = document.createElement('div');
    chipBar.className = 'bkm-filter-chips';
    contentEl.appendChild(chipBar);

    var grid = document.createElement('div');
    grid.className = 'series-grid';
    contentEl.appendChild(grid);

    var state = { activeType: 'all' };

    // 같은 code를 이 세션에서 다시 열면(뒤로 갔다 다시 들어오는 등) 서버에
    // 재요청하지 않는다. 실패는 캐시하지 않는다 — 잠깐의 네트워크 문제였을
    // 수 있으니 다음 진입에서 다시 시도할 수 있어야 한다.
    if (!libraryDetailCache[code]) {
      libraryDetailCache[code] = global.BookmarkLibrary.getOne(code).catch(function (err) {
        delete libraryDetailCache[code];
        throw err;
      });
    }
    Promise.all([libraryDetailCache[code], loadItemLookup()])
      .then(function (results) {
        var shared = results[0];
        var byId = results[1];

        setTitle(shared.name);
        titleH.textContent = shared.name;

        // 실제로 데이터에서 찾아진 항목만 대상으로 삼는다(원본이 사라진
        // 항목은 카드로 못 그리므로 개수에서도 빼야 숫자가 맞는다)
        var resolved = [];
        (shared.items || []).forEach(function (entry) {
          var s = byId[entry.type] && byId[entry.type][entry.id];
          if (s) resolved.push({ type: entry.type, data: s });
        });

        function countOf(type) { return countOfType(resolved, type); }

        function showEmptyIfNeeded() {
          if (grid.children.length) return;
          var empty = document.createElement('p');
          empty.className = 'series-empty';
          empty.textContent = resolved.length
            ? t('{type} 항목이 없어요.', { type: TYPE_LABELS[state.activeType] || '' })
            : t('이 북마크에는 볼 수 있는 항목이 없어요.');
          grid.appendChild(empty);
        }

        function renderGrid() {
          // gridPage.js와 같은 이유로, 그리드를 비우기 전에 지연 로딩
          // 옵저버부터 정리한다 — 안 그러면 필터 칩을 반복 클릭할 때마다
          // 사라진 카드가 detached 상태로 옵저버에 계속 쌓인다.
          if (global.unobserveAllLazy) global.unobserveAllLazy();
          grid.innerHTML = '';
          var shown = resolved.filter(function (r) {
            return state.activeType === 'all' || r.type === state.activeType;
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
          renderTypeChips(chipBar, state, countOf, function () {
            updateChips();
            renderGrid();
          });
        }

        updateChips();
        renderGrid();
      })
      .catch(function (err) {
        showMessage(err.message);
      });
  }

  // ---- 상세 모드 ----
  function renderDetail(bookmarkId) {
    if (!isLoggedIn()) {
      setTitle(t('북마크'));
      subEl.textContent = '';
      countEl.textContent = '';
      renderLoginGate(false);
      return;
    }
    var bookmark = global.Bookmarks.getBookmark(bookmarkId);
    if (!bookmark) {
      setTitle(t('북마크'));
      subEl.textContent = '';
      countEl.textContent = '';
      showMessage(t('북마크를 찾을 수 없어요.'));
      return;
    }

    setTitle(bookmark.name);
    subEl.textContent = '';
    countEl.textContent = '';

    contentEl.innerHTML = '';

    // 상세 화면 헤더(이름 + 관리 메뉴) — 항목 수는 바로 아래 필터 칩의
    // "전체 N" 이 이미 보여주므로 따로 안 두고, 뒤로가기 링크도 안 좋아
    // 보인다는 피드백으로 뺐다(사이드바 "북마크" 링크나 브라우저 뒤로가기로
    // 돌아갈 수 있다). 예전엔 subEl(#bkm-sub)에 붙였는데, /bookmarks의
    // 그 자리는 .site-info--hidden(display:none !important)으로 화면에서
    // 아예 지워져 있어서 관리(⋮) 메뉴가 DOM엔 있어도 절대 눈에 보이지
    // 않았다 — 실제로 보이는 contentEl 안으로 옮긴다.
    var header = document.createElement('div');
    header.className = 'bkm-detail-header';

    var titleH = document.createElement('h2');
    titleH.className = 'bkm-detail-title';
    titleH.textContent = bookmark.name;
    header.appendChild(titleH);

    // 케밥 아이콘이 제목 글자에 바싹 붙어있으면 너무 작고 눈에 안 띈다 —
    // 제목과 한 줄에 묶지 않고 헤더 오른쪽 바깥으로 뺐다
    // (CSS: .bkm-detail-menu-btn 이 position:absolute 로 배치).
    var menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'bkm-detail-menu-btn';
    menuBtn.innerHTML = KEBAB_ICON;
    menuBtn.setAttribute('aria-label', t('북마크 관리'));
    menuBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      openBookmarkMenu(menuBtn, bookmark, {
        onRenamed: function (newName) { titleH.textContent = newName; setTitle(newName); },
        onDeleted: function () { navigate('/bookmarks'); }
      });
    });
    header.appendChild(menuBtn);

    contentEl.appendChild(header);

    // 타입 필터 칩 — 그리드는 하나로 두고 '전체'가 기본이라 담은 순서를
    // 그대로 볼 수 있고, 칩을 누르면 해당 타입만 남는다
    var chipBar = document.createElement('div');
    chipBar.className = 'bkm-filter-chips';
    contentEl.appendChild(chipBar);

    var grid = document.createElement('div');
    grid.className = 'series-grid';
    contentEl.appendChild(grid);

    var state = { activeType: 'all' };

    loadItemLookup().then(function (byId) {
      // 실제로 데이터에서 찾아진 항목만 대상으로 삼는다 (원본이 사라진
      // 항목은 카드로 못 그리므로 개수에서도 빼야 숫자가 맞는다)
      var resolved = [];
      bookmark.items.forEach(function (entry) {
        var s = byId[entry.type] && byId[entry.type][entry.id];
        if (s) resolved.push({ type: entry.type, data: s });
      });

      function countOf(type) { return countOfType(resolved, type); }

      function renderGrid() {
        // gridPage.js와 같은 이유로, 그리드를 비우기 전에 지연 로딩
        // 옵저버부터 정리한다 — 안 그러면 필터 칩을 반복 클릭하거나
        // 항목을 해제할 때마다 사라진 카드가 detached 상태로 옵저버에
        // 계속 쌓인다.
        if (global.unobserveAllLazy) global.unobserveAllLazy();
        grid.innerHTML = '';
        var shown = resolved.filter(function (r) {
          return state.activeType === 'all' || r.type === state.activeType;
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
              var prevType = state.activeType;
              updateChips();
              if (state.activeType !== prevType) renderGrid();
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
          ? t('{type} 항목이 없어요.', { type: TYPE_LABELS[state.activeType] || '' })
          : t('이 북마크에는 아직 항목이 없어요.');
        grid.appendChild(empty);
      }

      function updateChips() {
        renderTypeChips(chipBar, state, countOf, function () {
          updateChips();
          renderGrid();
        });
      }

      updateChips();
      renderGrid();
    });
  }

  // pushState 로 URL만 바뀔 수 있으므로 전역 변수로 한 번만 읽어두면 안
  // 되고, 호출할 때마다 지금 URL을 새로 읽어야 한다.
  function renderCurrentView() {
    // 뷰 전환마다(다른 북마크 상세로 이동, 상세→목록 등) 이전 화면에 지연
    // 로딩 카드가 떠 있었을 수 있다 — contentEl을 어떤 render* 함수가
    // 통째로 지우든 여기 한 곳에서 먼저 옵저버를 정리해두면 개별 함수마다
    // 따로 챙길 필요가 없다.
    if (global.unobserveAllLazy) global.unobserveAllLazy();

    var params = new URLSearchParams(global.location.search);
    var bkmId = params.get('id');
    var libId = params.get('libraryId');
    if (bkmId) renderDetail(bkmId);
    else if (libId) renderLibraryDetail(libId);
    else renderList(params.get('tab') === 'library' ? 'library' : 'mine');
  }

  // 로그인/로그아웃하면 지금 보고 있던 화면을 그 자리에서 다시 그린다 —
  // 안내판에서 로그인한 사람이 새로고침하지 않아도 목록을 바로 보게 하고,
  // 반대로 로그아웃하면 남아 있던 목록이 즉시 안내판으로 바뀌게 한다.
  global.addEventListener('chokaguya:auth-change', renderCurrentView);

  // 뒤로/앞으로 가기 — pushState 로 바뀐 히스토리 항목으로 돌아오면
  // location.search 는 브라우저가 이미 되돌려놓은 뒤이므로 다시 그리기만
  // 하면 된다.
  global.addEventListener('popstate', renderCurrentView);

  // 이 페이지 안의 링크(/bookmarks?... 로 가는 <a>)를 전부 가로채
  // 진짜 페이지 이동 대신 pushState + 다시 그리기로 바꾼다. 탭 전환
  // (createTabs), 공유 패널의 "공개된 모습 보기" 링크가 전부 여기 한 곳에서
  // 처리된다 — 매번 개별 <a> 마다 클릭 핸들러를 달 필요가 없다.
  // 캡처 단계에서 잡는 이유: popoverKit.js 의 팝오버들이 "바깥 클릭 감지"용
  // document 클릭 리스너를 버블링 단계에 걸어두고, 패널 내부 클릭은
  // stopPropagation 으로 그 리스너에 안 닿게 막아둔다(예: 공유 패널의
  // "공개된 모습 보기" 링크). 버블링 단계에 있으면 그 stopPropagation에
  // 걸려 이 리스너까지 이벤트가 못 올라온다 — 캡처 단계는 target에
  // 도달하기 전에 먼저 실행되므로 그 문제와 무관하게 항상 잡힌다.
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a');
    if (!a) return;
    if (a.target && a.target !== '_self') return;
    var href = a.getAttribute('href');
    if (!href || href.indexOf('/bookmarks') !== 0) return;
    e.preventDefault();
    navigate(href);
  }, true);

  renderCurrentView();
})(window);
