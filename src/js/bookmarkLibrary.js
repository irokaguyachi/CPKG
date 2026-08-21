/**
 * ChoKaguya Bookmark Library (public bookmark sharing)
 * - 내 북마크(bookmarks.js, 로컬 전용) 하나를 라이브러리에 공개하고, 다른
 *   사람이 공개한 북마크 목록을 훑어볼 수 있게 해주는 Worker 클라이언트.
 * - 로그인이 없으므로 "내가 올린 것"이라는 증명은 게시할 때 서버가 한 번만
 *   돌려주는 editToken 을 이 브라우저 localStorage 에 들고 있는 것으로 대신함
 *   (pastebin 류의 삭제 키 패턴). 토큰을 잃으면 그 게시물은 수정/삭제 불가.
 * - 정식 로그인은 만들지 않았음(계정/세션/이메일 인프라가 전혀 없어 사이트
 *   규모에 비해 과함). 대신 브라우저마다 한 번 생성해 저장하는 "개인 복구
 *   코드"(personalCode)가 비밀번호 없는 브라우저 단위 계정 역할을 함 —
 *   이 브라우저에서 공개하는 모든 북마크가 자동으로 이 코드에 연결되고,
 *   다른 기기에서 그 코드 하나만 입력하면 연결된 북마크 전부의 수정 권한을
 *   한 번에 되찾을 수 있음. editToken 과 마찬가지로 서버엔 원문이 저장되지
 *   않고 SHA-256 해시로만 남음.
 * - 서버 라우트와 저장 형식은 worker/favoritesShareWorker.js 참고.
 */
(function (global) {
  var WORKER_BASE = 'https://chokaguya-favorites-share.nwb10102.workers.dev';
  var LIBRARY_URL = WORKER_BASE + '/library';
  var OWNER_LOOKUP_URL = WORKER_BASE + '/owner/lookup';
  var TOKEN_KEY = 'chokaguya_library_tokens';
  var PERSONAL_CODE_KEY = 'chokaguya_personal_code';

  // 헷갈리기 쉬운 글자(0/O, 1/I/L)를 뺀 알파벳 — 사람이 손으로 옮겨 적어도
  // 실수가 적도록. 대문자 고정(입력받을 땐 normalizePersonalCode 로 통일).
  var PERSONAL_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  var PERSONAL_CODE_LENGTH = 20;

  function generatePersonalCode() {
    var bytes = new Uint8Array(PERSONAL_CODE_LENGTH);
    crypto.getRandomValues(bytes);
    var chars = [];
    for (var i = 0; i < PERSONAL_CODE_LENGTH; i++) {
      chars.push(PERSONAL_ALPHABET[bytes[i] % PERSONAL_ALPHABET.length]);
    }
    return chars.join('');
  }

  // 저장/전송 형태(대시 없는 20자 대문자)로 정규화. 사용자가 대소문자를
  // 섞어 붙여넣거나 표시용 대시를 그대로 붙여넣어도 같은 코드로 인식되게
  // 함 — 대시가 포함된 채 저장/해시되면 표시 형식이 조금만 달라져도(대시
  // 위치 오타 등) 서버 해시가 안 맞는 문제가 생기므로, 코드의 "진짜 값"은
  // 항상 대시 없는 원문으로 통일하고 대시는 표시할 때만 넣는다.
  function normalizePersonalCode(raw) {
    return (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function formatPersonalCodeForDisplay(code) {
    var groups = code.match(/.{1,5}/g);
    return groups ? groups.join('-') : code;
  }

  // 이 브라우저의 개인 코드 — 없으면 처음 호출될 때 한 번 생성해서 저장.
  function getPersonalCode() {
    try {
      var existing = localStorage.getItem(PERSONAL_CODE_KEY);
      if (existing) return existing;
    } catch (e) {}
    var fresh = generatePersonalCode();
    try { localStorage.setItem(PERSONAL_CODE_KEY, fresh); } catch (e) {}
    return fresh;
  }

  // 다른 기기에서 되찾기에 성공했을 때, 이 기기도 그 개인 코드를 쓰도록
  // 채택한다 — 그래야 되찾은 뒤 이 기기에서 새로 공개하는 북마크도 같은
  // 코드 하나로 계속 관리된다.
  function adoptPersonalCode(code) {
    try { localStorage.setItem(PERSONAL_CODE_KEY, code); } catch (e) {}
  }

  // { "<code>": { editToken, bookmarkId } } — bookmarkId 는 어느 로컬
  // 북마크에서 게시했는지 기억해두는 용도(폴더 카드가 "공개됨" 상태를
  // 보여줄 수 있게). editToken 은 개인 코드로 되찾은 항목의 경우 null 일 수
  // 있음(그 브라우저가 editToken 원문을 몰라도 personalCode 만으로 인증
  // 가능하므로). 쓰기 빈도가 낮아 bookmarks.js 처럼 캐시하진 않음.
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
    map[code] = { editToken: editToken || null, bookmarkId: bookmarkId != null ? bookmarkId : (map[code] ? map[code].bookmarkId : null) };
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

  // 개인 코드로 되찾은 공개물을 로컬 북마크로 복원한 뒤, 그 북마크 id를
  // 이 code 에 연결한다. editToken 은 모르는 채로 남아도(null) personalCode
  // 인증만으로 이후 수정·공개취소가 계속 가능하다.
  function linkLocalBookmark(code, bookmarkId) {
    rememberToken(code, getEditToken(code), bookmarkId);
  }

  // 이 code가 이미 이 브라우저의 어느 로컬 북마크에 연결돼 있는지 조회 —
  // "전체 되찾기"를 반복 실행해도 이미 복원된 항목은 중복으로 새로 만들지
  // 않기 위해 씀(bookmarksPage.js의 restorePublished 참고).
  function getLocalLinkForCode(code) {
    var entry = readTokens()[code];
    return entry ? { editToken: entry.editToken, bookmarkId: entry.bookmarkId } : null;
  }

  function parseError(res) {
    return res.json().catch(function () { return {}; }).then(function (data) {
      if (res.status === 429) throw new Error('요청이 너무 잦아요. 잠시 후 다시 시도해주세요.');
      if (res.status === 403) throw new Error('이 북마크를 수정할 권한이 없어요 (이 브라우저와 연결되어 있지 않아요).');
      if (res.status === 404) throw new Error('존재하지 않거나 이미 삭제된 북마크예요.');
      throw new Error((data && data.error) || ('요청에 실패했어요 (' + res.status + ')'));
    });
  }

  function publish(name, items, bookmarkId) {
    return fetch(LIBRARY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, items: items, personalCode: getPersonalCode() })
    }).then(function (res) {
      if (!res.ok) return parseError(res);
      return res.json();
    }).then(function (data) {
      rememberToken(data.code, data.editToken, bookmarkId);
      return data;
    });
  }

  // PUT/DELETE 인증 본문 — 이 브라우저가 이 code 의 editToken 을 알고
  // 있으면 같이 보내고(구형 경로), 언제나 이 브라우저의 개인 코드도 함께
  // 보낸다. 서버는 둘 중 하나만 맞아도 통과시키므로(worker 의
  // verifyLibraryAuth), 개인 코드로 되찾아 editToken 이 없는 항목도 그대로
  // 수정·공개취소할 수 있다.
  function authBody(code) {
    var body = { personalCode: getPersonalCode() };
    var editToken = getEditToken(code);
    if (editToken) body.editToken = editToken;
    return body;
  }

  function update(code, patch) {
    var body = authBody(code);
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
    var body = authBody(code);
    return fetch(LIBRARY_URL + '/' + encodeURIComponent(code), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
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

  // 공유 코드+editToken 을 이 브라우저의 개인 코드에도 연결해둔다 — 성공하면
  // 다음부턴 이 항목도 개인 코드 하나로 관리 가능. 실패해도(레이트리밋 등)
  // 호출부는 보통 이미 끝난 되찾기를 무효화할 필요가 없어 무시 가능하도록
  // 별도 함수로 뺐다.
  function linkToPersonalCode(code, editToken) {
    return fetch(LIBRARY_URL + '/' + encodeURIComponent(code) + '/claim-owner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ editToken: editToken, personalCode: getPersonalCode() })
    }).then(function (res) {
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
      rememberToken(code, editToken, bookmarkId);
      // 이 기기의 개인 코드에도 자동으로 연결해서, 다음부턴 이 항목도 개인
      // 코드 하나로 관리할 수 있게 한다. 되찾기 자체는 이미 성공했으므로
      // 이 연결이 실패해도(레이트리밋 등) 무시한다.
      linkToPersonalCode(code, editToken).catch(function () {});
      return data;
    });
  }

  // 개인 코드 하나로, 그 코드에 연결된 모든 공개 북마크의 요약(code/name/
  // itemCount 등)을 받아온다. 실제 항목 목록(items)은 안 실려 있으므로
  // 로컬로 복원하려면 항목별로 getOne(code) 을 따로 불러야 한다(호출부인
  // bookmarksPage.js 참고). 성공하면 이 브라우저도 이 개인 코드를 채택한다
  // (앞으로 이 기기에서 공개하는 것도 같은 코드로 이어지게).
  function claimAllByPersonalCode(rawCode) {
    var personalCode = normalizePersonalCode(rawCode);
    if (personalCode.length < 16) {
      return Promise.reject(new Error('개인 코드 형식이 올바르지 않아요. 20자리 코드를 정확히 입력해주세요.'));
    }
    return fetch(OWNER_LOOKUP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personalCode: personalCode })
    }).then(function (res) {
      if (!res.ok) return parseError(res);
      return res.json();
    }).then(function (data) {
      var items = data.items || [];
      if (items.length) adoptPersonalCode(personalCode);
      return items;
    });
  }

  // 이 브라우저에 이미 저장돼 있던(이 기능 추가 전에 발급된) editToken들을
  // 한 번에 개인 코드로 연결하는 1회성 마이그레이션. code별로 순차 처리하고
  // 성공/실패를 모두 모아서 돌려준다(하나 실패해도 나머지는 계속 진행).
  function migrateExistingToPersonalCode() {
    var map = readTokens();
    var codes = Object.keys(map).filter(function (code) { return !!map[code].editToken; });
    if (!codes.length) return Promise.resolve({ linked: [], failed: [] });

    var linked = [];
    var failed = [];
    var chain = Promise.resolve();
    codes.forEach(function (code) {
      chain = chain.then(function () {
        return linkToPersonalCode(code, map[code].editToken)
          .then(function () { linked.push(code); })
          .catch(function (err) { failed.push({ code: code, message: err.message }); });
      });
    });
    return chain.then(function () { return { linked: linked, failed: failed }; });
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
    getPublishedInfo: getPublishedInfo,
    getPersonalCode: getPersonalCode,
    formatPersonalCodeForDisplay: formatPersonalCodeForDisplay,
    normalizePersonalCode: normalizePersonalCode,
    claimAllByPersonalCode: claimAllByPersonalCode,
    migrateExistingToPersonalCode: migrateExistingToPersonalCode,
    linkLocalBookmark: linkLocalBookmark,
    getLocalLinkForCode: getLocalLinkForCode
  };
})(window);
