/**
 * ChoKaguya Bookmark Library (public bookmark sharing)
 * - 내 북마크(bookmarks.js, 로컬 전용) 하나를 라이브러리에 공개하고, 다른
 *   사람이 공개한 북마크 목록을 훑어볼 수 있게 해주는 Worker 클라이언트.
 * - 로그인이 없으므로 "내가 올린 것"이라는 증명은 게시할 때 서버가 한 번만
 *   돌려주는 editToken 을 이 브라우저 localStorage 에 들고 있는 것으로 대신함
 *   (pastebin 류의 삭제 키 패턴). 토큰을 잃으면 그 게시물은 수정/삭제 불가.
 * - 계정/세션/이메일 인프라를 새로 두지 않고, 브라우저마다 한 번 생성해
 *   저장하는 20자 개인 코드(personalCode)를 "로그인"으로 취급함 —
 *   localStorage 에 코드가 있으면 로그인 상태, 없으면 비로그인. 회원가입은
 *   순수 로컬 동작(코드를 만들어 저장할 뿐, 서버는 코드 발급 API가 없음)이고,
 *   로그인은 그 코드로 이미 공개한 게 있으면 서버(/owner/lookup)에서 목록을
 *   받아와 로컬로 복원함. 로그인 상태의 북마크는 자동으로 이 코드에
 *   연결되고, 다른 기기에서 같은 코드로 로그인하면 전부 되찾을 수 있음.
 *   editToken 과 마찬가지로 서버엔 원문이 저장되지 않고 SHA-256 해시로만
 *   남음. UI는 src/js/components/authModal.js(로그인/회원가입 모달), src/js/components/auth.js
 *   (헤더 로그인 버튼/상태 패널) 참고.
 * - 로그인 상태가 바뀌면(adoptPersonalCode/logout) window 에
 *   'chokaguya:auth-change' 커스텀 이벤트가 발생함 — 헤더 등 다른 UI가
 *   새로고침 없이 상태를 동기화하는 데 씀.
 * - 서버 라우트와 저장 형식은 worker/favoritesShareWorker.js 참고.
 */
(function (global) {
  var t = global.I18n.t;
  // API가 이제 이 사이트와 같은 Worker(cpkg)에 합쳐져 있어서, 같은 오리진에
  // 상대 경로로 호출하면 된다 — 별도 도메인을 안 거치니 CORS 프리플라이트도
  // 필요 없다. src/_worker.js, src/wrangler.toml 참고.
  var WORKER_BASE = '';
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

  // 이 브라우저가 로그인(회원가입)된 상태인지 — 개인 코드가 저장돼 있으면
  // 로그인, 없으면 비로그인. 예전엔 없으면 그 자리에서 자동 생성했지만,
  // 그러면 "로그아웃"이 성립할 수 없어서(지우자마자 다음 호출에서 새로
  // 생기므로) 이제 순수 조회만 한다 — 코드 발급은 회원가입 흐름
  // (issueNewPersonalCode + confirmPersonalCode)에서만 일어난다.
  function getPersonalCode() {
    try {
      return localStorage.getItem(PERSONAL_CODE_KEY);
    } catch (e) {
      return null;
    }
  }

  function isLoggedIn() {
    return !!getPersonalCode();
  }

  // 회원가입 화면이 "확인"을 누르기 전에 보여줄 후보 코드 — 아직 저장하지
  // 않는다(순수 함수). 실제 저장은 confirmPersonalCode 가 한다.
  function issueNewPersonalCode() {
    return generatePersonalCode();
  }

  function dispatchAuthChange(loggedIn) {
    try {
      global.dispatchEvent(new CustomEvent('chokaguya:auth-change', { detail: { loggedIn: loggedIn } }));
    } catch (e) {}
  }

  // 다른 기기에서 되찾기에 성공했을 때, 이 기기도 그 개인 코드를 쓰도록
  // 채택한다 — 그래야 되찾은 뒤 이 기기에서 새로 공개하는 북마크도 같은
  // 코드 하나로 계속 관리된다.
  function adoptPersonalCode(code) {
    try { localStorage.setItem(PERSONAL_CODE_KEY, code); } catch (e) {}
    dispatchAuthChange(true);
  }

  // 회원가입 "확인" 버튼 — issueNewPersonalCode 가 보여준 후보 코드를
  // 실제로 채택한다. 서버는 코드 발급/등록 API가 따로 없으므로(개인 코드는
  // 그 코드로 뭔가를 공개해야만 서버에 흔적이 남는다) 순수 로컬 동작이고
  // 네트워크 호출이 없다.
  function confirmPersonalCode(code) {
    adoptPersonalCode(code);
  }

  // 진짜 로그아웃 — 이 브라우저의 개인 코드를 지운다. chokaguya_library_tokens
  // (editToken 맵)는 건드리지 않으므로, 이 브라우저가 직접 editToken 을 쥐고
  // 있는 게시물은 로그아웃 후에도 여전히 수정·삭제할 수 있다(개인 코드
  // 로그인과 editToken 소유권은 서로 다른 층이라 생기는 당연한 결과).
  function logout() {
    try { localStorage.removeItem(PERSONAL_CODE_KEY); } catch (e) {}
    dispatchAuthChange(false);
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

  // 메시지는 지금 언어로 번역돼 있어서 문구로 원인을 가릴 수 없다 — 호출부가
  // 상태 코드로 판단할 수 있게 err.status 를 같이 싣는다.
  function httpError(message, status) {
    var err = new Error(message);
    err.status = status;
    return err;
  }

  function parseError(res) {
    return res.json().catch(function () { return {}; }).then(function (data) {
      if (res.status === 429) throw httpError(t('요청이 너무 잦아요. 잠시 후 다시 시도해주세요.'), 429);
      if (res.status === 403) throw httpError(t('이 북마크를 수정할 권한이 없어요 (이 브라우저와 연결되어 있지 않아요).'), 403);
      if (res.status === 404) throw httpError(t('존재하지 않거나 이미 삭제된 북마크예요.'), 404);
      // 관리 페이지에서 숨긴 공개 서재(worker/adminLibrary.js) — 주인 데이터는 그대로다.
      if (res.status === 410) throw httpError(t('관리자에 의해 숨겨진 서재예요.'), 410);
      throw httpError((data && data.error && t(data.error)) || t('요청에 실패했어요 ({code})', { code: res.status }), res.status);
    });
  }

  function publish(name, items, bookmarkId) {
    var body = { name: name, items: items };
    var personalCode = getPersonalCode();
    if (personalCode) body.personalCode = personalCode;
    return fetch(LIBRARY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
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
    var body = {};
    var personalCode = getPersonalCode();
    if (personalCode) body.personalCode = personalCode;
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
    var personalCode = getPersonalCode();
    if (!personalCode) {
      return Promise.reject(new Error(t('로그인이 필요해요.')));
    }
    return fetch(LIBRARY_URL + '/' + encodeURIComponent(code) + '/claim-owner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ editToken: editToken, personalCode: personalCode })
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
      return Promise.reject(new Error(t('공유 코드와 관리 코드를 모두 입력해주세요.')));
    }
    return fetch(LIBRARY_URL + '/' + encodeURIComponent(code), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ editToken: editToken })
    }).then(function (res) {
      if (res.status === 403) throw new Error(t('관리 코드가 이 공유 코드와 맞지 않아요.'));
      if (res.status === 404) throw new Error(t('존재하지 않는 공유 코드예요.'));
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
      return Promise.reject(new Error(t('개인 코드 형식이 올바르지 않아요. 20자리 코드를 정확히 입력해주세요.')));
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

  function getOne(code) {
    return fetch(LIBRARY_URL + '/' + encodeURIComponent(code)).then(function (res) {
      if (!res.ok) return parseError(res);
      return res.json();
    });
  }

  // 공개된 북마크 하나를 로컬 북마크로 복원 — 로그인(회원가입/되찾기)
  // 직후 "내 데이터를 이 기기로 가져오는" 동작에 씀. bookmarks.js(Bookmarks
  // 전역)가 로드된 페이지에서만 가능하고, 없는 페이지(mainPage.html 등)에서
  // 로그인하면 이 복원만 조용히 건너뛴다 — 로그인 자체는 그래도 성공한다.
  // 이미 이 code에 연결된 로컬 북마크가 있으면(살아있으면) 재사용해서
  // 반복 호출해도 중복 폴더가 안 생기게 한다.
  function restorePublishedToLocal(code) {
    if (typeof global.Bookmarks === 'undefined') {
      return Promise.reject(new Error(t('이 페이지에서는 로컬 북마크를 지원하지 않아요.')));
    }
    var link = getLocalLinkForCode(code);
    if (link && link.bookmarkId && global.Bookmarks.getBookmark(link.bookmarkId)) {
      return Promise.resolve(link.bookmarkId);
    }
    return getOne(code).then(function (pub) {
      var newId = global.Bookmarks.createBookmark(pub.name || t('되찾은 북마크'));
      (pub.items || []).forEach(function (it) {
        global.Bookmarks.addItemToBookmark(newId, it.type, it.id);
      });
      linkLocalBookmark(code, newId);
      return newId;
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
    linkLocalBookmark: linkLocalBookmark,
    getLocalLinkForCode: getLocalLinkForCode,
    isLoggedIn: isLoggedIn,
    issueNewPersonalCode: issueNewPersonalCode,
    confirmPersonalCode: confirmPersonalCode,
    // userData.js 가 서버 계정 생성/조회에 성공한 뒤에야 이 기기에 코드를
    // 채택하려고 쓴다 — 여기서 서버를 직접 부르면 두 모듈이 서로를 참조하게 된다
    adoptPersonalCode: adoptPersonalCode,
    logout: logout,
    restorePublishedToLocal: restorePublishedToLocal
  };
})(window);
