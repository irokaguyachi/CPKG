/**
 * ChoKaguya Bookmarks Page
 * - 목록 모드(URL 에 ?id= 없음): 내가 만든 북마크(이름 있는 모음)들을
 *   폴더 카드로 보여줌.
 * - 상세 모드(?id=<북마크id>): Novel/Series/HOF/Official.json 을 모두
 *   불러와 그 북마크에 담긴 항목들을 담은 순서 그대로 하나의 그리드로
 *   보여줌 — 타입별로 안 나눔(유저가 문학/시리즈를 섞어 담을 수 있어서).
 * - 옛 favoritesPage.js 의 "공유 링크 만들기" 위젯은 이번엔 안 옮김
 *   (BOOKMARK_SYSTEM_PLAN.md 참고 — 공유 기능은 나중에 다시 설계).
 */
(function (global) {
  var SECTIONS = [
    { type: 'novel', dataUrl: '../data/PageData/Novel.json', numberPrefix: 'N' },
    { type: 'series', dataUrl: '../data/PageData/Series.json', numberPrefix: 'S' },
    { type: 'hof', dataUrl: '../data/PageData/HOF.json', numberPrefix: 'H' },
    { type: 'official', dataUrl: '../data/PageData/Official.json', numberPrefix: 'O' }
  ];

  var PENCIL_ICON = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M11 2.5l2.5 2.5L5 13.5H2.5V11L11 2.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  var DELETE_ICON = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  var FOLDER_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5h12a.5.5 0 0 1 .5.5v16.2a.5.5 0 0 1-.77.42L12 16.4l-5.73 4.22A.5.5 0 0 1 5.5 20.2V4a.5.5 0 0 1 .5-.5z"/></svg>';

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

  // ---- 목록 모드 ----
  function renderList() {
    titleEl.textContent = '북마크';
    subEl.textContent = '내가 만든 북마크들을 모아봤어요';

    var bookmarks = global.Bookmarks.getAllBookmarks();
    countEl.textContent = bookmarks.length + '개의 북마크가 있습니다!';

    contentEl.innerHTML = '';

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
        global.Bookmarks.deleteBookmark(bookmark.id);
        card.remove();
        countEl.textContent = global.Bookmarks.getAllBookmarks().length + '개의 북마크가 있습니다!';
        showEmptyIfNeeded();
      });
      image.appendChild(deleteBtn);
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

  // ---- 상세 모드 ----
  function renderDetail(bookmarkId) {
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
    var grid = document.createElement('div');
    grid.className = 'series-grid';
    contentEl.appendChild(grid);

    var fetches = SECTIONS.map(function (section) {
      return fetch(DATA(section.dataUrl)).then(function (r) { return r.json(); }).catch(function () { return []; });
    });

    Promise.all(fetches).then(function (results) {
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

      function showEmptyIfNeeded() {
        if (grid.children.length) return;
        var empty = document.createElement('p');
        empty.className = 'series-empty';
        empty.textContent = '이 북마크에는 아직 항목이 없어요.';
        grid.appendChild(empty);
      }

      bookmark.items.forEach(function (entry) {
        var s = byId[entry.type] && byId[entry.type][entry.id];
        if (!s) return;
        var card = createItemCard(entry.type, s, {
          viewingBookmarkId: bookmark.id,
          onRemovedFromCurrentView: function () {
            card.remove();
            countEl.textContent = grid.querySelectorAll('.series-card').length + '개의 항목이 있어요!';
            showEmptyIfNeeded();
          }
        });
        grid.appendChild(card);
      });

      showEmptyIfNeeded();
    });
  }

  var bkmId = new URLSearchParams(global.location.search).get('id');
  if (bkmId) renderDetail(bkmId);
  else renderList();
})(window);
