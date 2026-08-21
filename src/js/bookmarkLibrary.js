/**
 * ChoKaguya Bookmark Library (public bookmark sharing)
 * - 내 북마크(bookmarks.js, 로컬 전용) 하나를 라이브러리에 공개하고, 다른
 *   사람이 공개한 북마크 목록을 훑어볼 수 있게 해주는 Worker 클라이언트.
 * - 로그인이 없으므로 "내가 올린 것"이라는 증명은 게시할 때 서버가 한 번만
 *   돌려주는 editToken 을 이 브라우저 localStorage 에 들고 있는 것으로 대신함
 *   (pastebin 류의 삭제 키 패턴). 토큰을 잃으면 그 게시물은 수정/삭제 불가.
 * - 서버 라우트와 저장 형식은 worker/favoritesShareWorker.js 참고.
 */
(function (global) {
  var WORKER_BASE = 'https://chokaguya-favorites-share.nwb10102.workers.dev';
  var LIBRARY_URL = WORKER_BASE + '/library';
  var TOKEN_KEY = 'chokaguya_library_tokens';

  // { "<code>": { editToken, bookmarkId } } — bookmarkId 는 어느 로컬
  // 북마크에서 게시했는지 기억해두는 용도(폴더 카드가 "공개됨" 상태를
  // 보여줄 수 있게). 쓰기 빈도가 낮아 bookmarks.js 처럼 캐시하진 않음.
  function readTokens() {
    try {
      var raw = localStorage.getItem(TOKEN_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function writeTokens(map) {
    try {
      localStorage.setItem(TOKEN_KEY, JSON.stringify(map));
    } catch (e) {}
  }

  function rememberToken(code, editToken, bookmarkId) {
    var map = readTokens();
    map[code] = { editToken: editToken, bookmarkId: bookmarkId };
    writeTokens(map);
  }

  function forgetToken(code) {
    var map = readTokens();
    delete map[code];
    writeTokens(map);
  }

  function getEditToken(code) {
    var entry = readTokens()[code];
    return entry ? entry.editToken : null;
  }

  // 이 로컬 북마크가 이미 라이브러리에 올라가 있는지 — 올라가 있으면 code 반환
  function getPublishedInfo(bookmarkId) {
    var map = readTokens();
    for (var code in map) {
      if (Object.prototype.hasOwnProperty.call(map, code) && map[code].bookmarkId === bookmarkId) {
        return { code: code, editToken: map[code].editToken };
      }
    }
    return null;
  }

  function parseError(res) {
    return res.json().catch(function () { return {}; }).then(function (data) {
      if (res.status === 429) throw new Error('요청이 너무 잦아요. 잠시 후 다시 시도해주세요.');
      if (res.status === 403) throw new Error('이 북마크를 수정할 권한이 없어요 (관리 코드 불일치).');
      if (res.status === 404) throw new Error('존재하지 않거나 이미 삭제된 북마크예요.');
      throw new Error((data && data.error) || ('요청에 실패했어요 (' + res.status + ')'));
    });
  }

  function publish(name, items, bookmarkId) {
    return fetch(LIBRARY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, items: items })
    }).then(function (res) {
      if (!res.ok) return parseError(res);
      return res.json();
    }).then(function (data) {
      rememberToken(data.code, data.editToken, bookmarkId);
      return data;
    });
  }

  function update(code, patch) {
    var editToken = getEditToken(code);
    if (!editToken) {
      return Promise.reject(new Error('이 브라우저에는 이 북마크의 관리 코드가 없어요.'));
    }
    var body = { editToken: editToken };
    if (patch && patch.name !== undefined) body.name = patch.name;
    if (patch && patch.items !== undefined) body.items = patch.items;

    return fetch(LIBRARY_URL + '/' + encodeURIComponent(code), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) return parseError(res);
      return res.json();
    });
  }

  function unpublish(code) {
    var editToken = getEditToken(code);
    if (!editToken) {
      return Promise.reject(new Error('이 브라우저에는 이 북마크의 관리 코드가 없어요.'));
    }
    return fetch(LIBRARY_URL + '/' + encodeURIComponent(code), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ editToken: editToken })
    }).then(function (res) {
      if (!res.ok) return parseError(res);
      return res.json();
    }).then(function (data) {
      forgetToken(code);
      return data;
    });
  }

  // opts: { sort: 'new'|'updated'|'name', q: string, offset: number, limit: number }
  // Server sorts/filters across the whole prefix, so paging is by offset —
  // a cursor can't survive a re-sort (see worker/favoritesShareWorker.js).
  function list(opts) {
    opts = opts || {};
    var params = [];
    if (opts.sort) params.push('sort=' + encodeURIComponent(opts.sort));
    if (opts.q) params.push('q=' + encodeURIComponent(opts.q));
    if (opts.offset) params.push('offset=' + encodeURIComponent(opts.offset));
    if (opts.limit) params.push('limit=' + encodeURIComponent(opts.limit));
    var url = LIBRARY_URL + (params.length ? '?' + params.join('&') : '');
    return fetch(url).then(function (res) {
      if (!res.ok) return parseError(res);
      return res.json();
    });
  }

  // Recover management rights for a published bookmark on a device that never
  // held its editToken (browser data cleared, different machine). There's no
  // dedicated verify route, so this does a no-op PUT: the Worker checks the
  // token hash before touching anything, so a wrong token 403s and a right one
  // succeeds without changing name or items.
  function claimToken(code, editToken, bookmarkId) {
    code = (code || '').trim();
    editToken = (editToken || '').trim();
    if (!code || !editToken) {
      return Promise.reject(new Error('공유 코드와 관리 코드를 모두 입력해주세요.'));
    }
    return fetch(LIBRARY_URL + '/' + encodeURIComponent(code), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ editToken: editToken })
    }).then(function (res) {
      if (res.status === 403) throw new Error('관리 코드가 이 공유 코드와 맞지 않아요.');
      if (res.status === 404) throw new Error('존재하지 않는 공유 코드예요.');
      if (!res.ok) return parseError(res);
      return res.json();
    }).then(function (data) {
      rememberToken(code, editToken, bookmarkId || null);
      return data;
    });
  }

  function getOne(code) {
    return fetch(LIBRARY_URL + '/' + encodeURIComponent(code)).then(function (res) {
      if (!res.ok) return parseError(res);
      return res.json();
    });
  }

  global.BookmarkLibrary = {
    publish: publish,
    update: update,
    unpublish: unpublish,
    list: list,
    getOne: getOne,
    claimToken: claimToken,
    getPublishedInfo: getPublishedInfo
  };
})(window);
