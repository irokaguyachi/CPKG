/**
 * ChoKaguya Bookmark Picker
 * - gridPage.js 와 favoritesPage.js 에 각각 따로 있던 STAR_ICON/즐겨찾기
 *   버튼을 하나로 합친 자리. 카드에 붙는 북마크 아이콘 버튼과, 클릭하면
 *   뜨는 "담을 북마크 고르기" 팝오버를 여기서 전부 만든다.
 * - 팝오버는 document.body 에 하나만 붙는 싱글턴 + position:fixed 다.
 *   .series-card 에 overflow:hidden 이 걸려있어서(카드 밖으로 나가는
 *   절대배치 자식은 잘림) 카드 안에 상대배치로 넣을 수가 없다 —
 *   postDetailSeries.js 의 ensureOverlay() 싱글턴 패턴 + 버튼 위치 기준
 *   getBoundingClientRect() 좌표 계산을 합친 방식.
 */
(function (global) {
  var BOOKMARK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
  var CHECK_ICON = '<svg viewBox="0 0 10 10" fill="none"><path d="M1.5 5L4 7.5L8.5 2.5" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  var popoverEl = null;
  var docListenersBound = false;
  // 지금 팝오버가 어떤 버튼/항목을 위해 열려있는지 — 체크 토글이나 새
  // 북마크 만들기가 이 항목 기준으로 동작함
  var state = null;

  function ensurePopoverEl() {
    if (popoverEl) return popoverEl;
    popoverEl = document.createElement('div');
    popoverEl.className = 'bkm-picker';
    popoverEl.addEventListener('click', function (e) { e.stopPropagation(); });
    document.body.appendChild(popoverEl);
    if (!docListenersBound) {
      document.addEventListener('click', function () { close(); });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') close();
      });
      docListenersBound = true;
    }
    return popoverEl;
  }

  function isOpenFor(anchorEl) {
    return !!state && state.anchorEl === anchorEl && popoverEl && popoverEl.classList.contains('is-open');
  }

  function updateAnchorFillState() {
    if (!state) return;
    state.anchorEl.classList.toggle('is-fav', global.Bookmarks.isInAnyBookmark(state.type, state.id));
  }

  function renderRow(bookmark) {
    var row = document.createElement('div');
    row.className = 'sfp-option' + (global.Bookmarks.isInBookmark(bookmark.id, state.type, state.id) ? ' is-checked' : '');

    var box = document.createElement('span');
    box.className = 'sfp-checkbox';
    box.innerHTML = CHECK_ICON;
    row.appendChild(box);

    var label = document.createElement('span');
    label.className = 'sfp-label';
    label.textContent = bookmark.name;
    row.appendChild(label);

    row.addEventListener('click', function () {
      var nowIn = global.Bookmarks.toggleItemInBookmark(bookmark.id, state.type, state.id);
      row.classList.toggle('is-checked', nowIn);
      updateAnchorFillState();
      if (!nowIn && state.opts.viewingBookmarkId === bookmark.id && state.opts.onRemovedFromCurrentView) {
        state.opts.onRemovedFromCurrentView();
      }
    });

    return row;
  }

  function renderNewRow() {
    var row = document.createElement('div');
    row.className = 'bkm-picker-new';

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'bkm-picker-new-input';
    input.placeholder = '새 북마크 이름';
    input.maxLength = 40;
    row.appendChild(input);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bkm-picker-new-btn';
    btn.textContent = '추가';
    row.appendChild(btn);

    function submit() {
      if (!input.value.trim()) return;
      var newId = global.Bookmarks.createBookmark(input.value);
      global.Bookmarks.addItemToBookmark(newId, state.type, state.id);
      updateAnchorFillState();
      render();
      position(state.anchorEl);
    }

    btn.addEventListener('click', submit);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });

    return row;
  }

  function render() {
    popoverEl.innerHTML = '';

    var header = document.createElement('div');
    header.className = 'sfp-header';
    header.textContent = '담을 북마크를 고르세요';
    popoverEl.appendChild(header);

    var list = document.createElement('div');
    list.className = 'sfp-options';
    var bookmarks = global.Bookmarks.getAllBookmarks();
    if (!bookmarks.length) {
      var empty = document.createElement('div');
      empty.className = 'sfp-empty';
      empty.textContent = '아직 만든 북마크가 없어요';
      list.appendChild(empty);
    } else {
      bookmarks.forEach(function (b) { list.appendChild(renderRow(b)); });
    }
    popoverEl.appendChild(list);

    popoverEl.appendChild(renderNewRow());
  }

  // 버튼 우측 하단에 붙이되 화면 밖으로 안 나가게 클램프
  function position(anchorEl) {
    var rect = anchorEl.getBoundingClientRect();
    var popW = popoverEl.offsetWidth || 260;
    var left = Math.max(8, Math.min(rect.right - popW, global.innerWidth - popW - 8));
    var top = Math.min(rect.bottom + 8, global.innerHeight - 8);
    popoverEl.style.left = Math.round(left) + 'px';
    popoverEl.style.top = Math.round(top) + 'px';
  }

  function open(anchorEl, type, id, opts) {
    ensurePopoverEl();
    state = { anchorEl: anchorEl, type: type, id: id, opts: opts || {} };
    render();
    position(anchorEl);
    popoverEl.classList.add('is-open');
  }

  function close() {
    if (popoverEl) popoverEl.classList.remove('is-open');
    state = null;
  }

  function toggle(anchorEl, type, id, opts) {
    if (isOpenFor(anchorEl)) { close(); return; }
    open(anchorEl, type, id, opts);
  }

  function isLoggedIn() {
    return !!(global.BookmarkLibrary && global.BookmarkLibrary.isLoggedIn());
  }

  // 로그인/로그아웃이나 다른 기기에서 넘어온 동기화로 담긴 목록이 바뀌면
  // 이미 그려진 카드 버튼들도 따라가야 한다. 버튼마다 자기 상태를 다시
  // 계산하는 함수를 달아두고 문서 전체를 훑는 방식이라, 카드를 다시 그리지
  // 않아도 되고 type/id 를 문자열 속성으로 왕복시키지 않아 타입도 안 어긋난다.
  function refreshButtons() {
    var btns = document.querySelectorAll('.bkm-fav-btn');
    for (var i = 0; i < btns.length; i++) {
      if (typeof btns[i]._bkmSync === 'function') btns[i]._bkmSync();
    }
  }

  // opts: { viewingBookmarkId, onRemovedFromCurrentView } — 북마크 상세
  // 페이지에서만 씀. 지금 보고 있는 북마크를 팝오버에서 체크 해제하면
  // onRemovedFromCurrentView 로 카드를 즉시 그리드에서 뺄 수 있게 함
  function createButton(type, id, opts) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'series-card-fav bkm-fav-btn';
    btn.innerHTML = BOOKMARK_ICON;
    btn.setAttribute('aria-label', '북마크에 담기');
    // 로그아웃 상태에서는 담긴 표시(채운 아이콘)를 내보내지 않는다 — 열지도
    // 못하는 북마크에 담겨 있다고 보여주면, 눌렀을 때 로그인 모달이 뜨는 게
    // 앞뒤가 안 맞는다. 로그인하면 refreshButtons 가 곧바로 되살린다.
    btn._bkmSync = function () {
      var marked = isLoggedIn() && global.Bookmarks && global.Bookmarks.isInAnyBookmark(type, id);
      btn.classList.toggle('is-fav', !!marked);
    };
    btn._bkmSync();
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      // 북마크는 계정에 딸린 기능이라 로그인부터 받는다. 가입/로그인이
      // 끝나면 누르려던 그 버튼의 팝오버를 그대로 이어서 연다.
      if (!isLoggedIn()) {
        global.AuthModal.requireLogin({
          reason: '북마크에 담으려면 먼저 로그인해주세요',
          onSuccess: function () { open(btn, type, id, opts); }
        });
        return;
      }
      toggle(btn, type, id, opts);
    });
    return btn;
  }

  global.addEventListener('chokaguya:auth-change', function () {
    close();
    refreshButtons();
  });
  global.addEventListener('chokaguya:bookmarks-change', refreshButtons);

  global.BookmarkPicker = {
    createButton: createButton,
    open: open,
    close: close,
    refreshButtons: refreshButtons
  };
})(window);
