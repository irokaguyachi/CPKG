import { readJsonLimited } from './requestBody.js';
import { readLibraryIndex, updateLibraryIndex } from './libraryIndex.js';
/**
 * ChoKaguya Favorites Share Worker
 * - 2026-08-23: 별도 Worker(chokaguya-favorites-share, 독립된
 *   workers.dev 서브도메인)로 배포하던 걸 그만두고, 이 파일은 이제
 *   src/_worker.js가 import해서 cpkg Worker(정적 사이트와 같은 배포)의
 *   API 부분으로 합쳐졌다. 실제 배포 설정은 src/wrangler.toml에 있고, 이
 *   파일 자체를 위한 wrangler.toml은 더 이상 없다 — R2/KV 바인딩 이름
 *   (FAVORITES_BUCKET, RATE_LIMIT_KV)은 그대로라 코드는 안 바뀐다.
 * - The only piece of this project that can write to R2: the public
 *   pub-*.r2.dev bucket (src/js/config/cdnConfig.js) is read-only from the browser,
 *   and the only existing write path (src/scripts/sync_to_r2.py) holds a
 *   full-access secret key that must never reach client JS. This Worker
 *   holds an R2 binding instead (no secret key needed) and exposes narrow
 *   write endpoints.
 *
 * ---- Bookmark library (public, browsable, per-bookmark share) ----
 * - POST /library                body: { name, items:[{type,id}] }
 *     -> stores at library/<code>.json, returns { code, editToken } once.
 *     editToken is never stored in plaintext — only its SHA-256 hash is
 *     saved, because this whole bucket is public-read via pub-*.r2.dev, so
 *     anything written to the object body is effectively public.
 * - GET  /library?sort=&q=&offset=&limit=  -> listing (name/itemCount only,
 *     backed by a prebuilt R2 metadata index).
 *     sort: new (default, newest published) | updated | name. q filters on
 *     name. Offset paging over the complete metadata snapshot.
 * - GET  /library/<code>           -> full { code, name, items, ... }
 *     (editTokenHash is stripped before responding).
 * - PUT  /library/<code>           body: { editToken?, personalCode?, name?, items? } -> update.
 * - DELETE /library/<code>         body: { editToken?, personalCode? } -> delete.
 *     PUT/DELETE need at least one of editToken/personalCode, and only one of
 *     them has to match (see verifyLibraryAuth) — that's what lets a personal
 *     code alone recover edit rights without ever knowing the editToken.
 * All /library GET routes have to go through this Worker too, not the raw
 * pub-*.r2.dev URL: that bucket serves GET with no Access-Control-Allow-Origin
 * header, which blocks a cross-origin fetch() from reading the JSON body in JS.
 * GET /library/<code> additionally needs server-side redaction of editTokenHash
 * and ownerHash.
 *
 * ---- Personal recovery code (no login, browser-wide "account") ----
 * A real login (email/password, OAuth) was considered and rejected — this
 * project has no account/session/email infrastructure at all, and it would
 * be a lot of new surface for a hobby archive. Instead each browser keeps one
 * random "personal code" (src/js/core/bookmarkLibrary.js), sent as `personalCode`
 * on every publish/update/delete. Entering that one code on another device
 * recovers edit rights over *every* bookmark ever published from the
 * original browser, instead of juggling a code/editToken pair per bookmark.
 * - Every /library write may include `personalCode`. On create it links the
 *   new record to that code; on update/delete it's accepted as an
 *   alternative to editToken.
 * - Ownership proof is `ownerHash = sha256('owner:'+code+':'+personalCode)`,
 *   stored on the record (never the plaintext code, same reasoning as
 *   editTokenHash). Hashing the record's own `code` in too means two
 *   bookmarks owned by the same person don't share a recoverable value even
 *   if someone scrapes the whole public bucket — you can't tell they're
 *   linked without already knowing the personal code.
 * - POST /library/<code>/claim-owner   body: { editToken, personalCode }
 *     -> links a bookmark published *before* this feature (or from a
 *     session that skipped personalCode) to a personal code. Proves
 *     ownership via the existing editToken, one bookmark at a time. This is
 *     what the client's one-shot "이 브라우저의 기존 코드들을 내 개인 코드로
 *     가져오기" migration calls for each locally-remembered editToken.
 * - POST /owner/lookup   body: { personalCode }
 *     -> { items:[{code,name,itemCount,createdAt,updatedAt}], total } for
 *     every bookmark linked to that code — this is what "이 코드로 전체
 *     되찾기" shows on another device. Backed by an index object at
 *     owners/<sha256('owner-index:'+personalCode)>.json holding just the
 *     list of codes (R2 list() can't be queried by arbitrary field, so this
 *     index stands in for a lookup-by-owner query). Each code's
 *     name/itemCount/timestamps come from R2 head() + customMetadata, same
 *     as the library listing, so lookup never reads record bodies. A code
 *     already deleted from library/ is dropped from the index the next time
 *     someone looks it up (best-effort GC, not a background job).
 * - The index is a convenience for discovery only, not the source of
 *   authorization — PUT/DELETE always check ownerHash on the record itself.
 *   If an index write ever fails (e.g. right after create), the record is
 *   still fully usable via personalCode; it just won't surface in a lookup
 *   until claim-owner or another publish repairs the index.
 *
 * ---- Rate limiting ----
 * 공개 쓰기 엔드포인트 + 누구나 볼 수 있는 목록이라 스팸 표적이 되기 쉬워서
 * 라이브러리 기능과 함께 넣었다(TRAFFIC_LAG_AUDIT.md 참고).
 * - 2026-08-24: 원래는 전부 RATE_LIMIT_KV 고정 윈도우 카운터였는데, 허용되는
 *   요청마다 KV put 을 한 번씩 해서 무료 일일 쓰기 한도(1,000)를 갉아먹었다.
 *   게다가 try/catch 가 없어서 한도를 넘기면 예외가 그대로 전파돼 로그인·
 *   가입·동기화·라이브러리가 한꺼번에 500 이 됐다(TRAFFIC_SECURITY_AUDIT.md
 *   S1). 이제 라이브러리·소유권 조회·로그인·동기화는 Cloudflare 네이티브
 *   Rate Limiting 바인딩(RL_*, src/wrangler.toml)을 쓴다 — 원자적이고 KV
 *   할당량을 전혀 쓰지 않는다. 대신 period 가 10/60초로 제한돼 있어서
 *   창은 60초로 좁아졌다.
 * - 회원가입 일일 상한은 R2 CAS 예약으로 강제한다. 제한 저장소 장애 시
 *   신규 가입만 503으로 차단하며, 로그인과 동기화는 계속 동작한다.
 */

const CODE_RE = /^[A-Za-z0-9_-]{1,32}$/;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const CODE_LENGTH = 8;
const EDIT_TOKEN_LENGTH = 24;

// 클라이언트 쪽 src/js/config/libraryConfig.js의 TYPE_LABELS 키 목록/
// MAX_NAME_LENGTH와 맞물린 값이다 — 브라우저와 이 Worker는 런타임이 달라
// import로 공유할 수 없으니, 한쪽을 바꾸면 반드시 다른 쪽도 같이 볼 것.
const LIBRARY_ITEM_TYPES = ['novel', 'translation', 'series', 'hof', 'official'];
const LIBRARY_MAX_NAME = 20;
const LIBRARY_MAX_ITEMS = 300;
const LIBRARY_MAX_BODY_BYTES = 20480;
const LIBRARY_LIST_DEFAULT_LIMIT = 20;
const LIBRARY_LIST_MAX_LIMIT = 50;
// The listing reads a prebuilt R2 metadata index; cron scans are resumable.
const LIBRARY_MAX_QUERY = 40;

// 클라이언트가 생성하는 개인 코드는 20자 커스텀 알파벳(chokaguya_personal_code)을
// 기대하지만, 서버 검증은 형태만 넉넉하게 확인한다(길이 16~64, URL-safe 문자) —
// 클라이언트 쪽 알파벳/길이가 나중에 바뀌어도 서버를 같이 고칠 필요가 없도록.
const PERSONAL_CODE_RE = /^[A-Za-z0-9_-]{16,64}$/;
// 개인 코드 하나가 공개(라이브러리 게시)할 수 있는 북마크 수 상한.
// 원래는 500이었는데, handleOwnerLookup/migrateFromOwnerIndex 둘 다 이
// 인덱스의 codes 배열을 순회하며 코드마다 R2 요청을 하나씩 순차로
// 날린다(Promise.all 이 아니라 for 루프 await) — Worker 무료 플랜은 요청
// 하나당 서브요청 50개 한도라, 500개를 다 채운 사용자는 owner-lookup
// 자체가 예외를 던져 실패한다(다른 기기에서 개인 코드로 로그인할 때
// 걸리는 경로라 사실상 로그인 불가가 된다). 5로 낮추면 최악의 경우에도
// 5회뿐이라 안전하다. handleLibraryCreate/handleLibraryClaimOwner가
// 이 상수로 상한을 실제로 강제한다(공개 자체를 막는다) — 아래
// addToOwnerIndex의 체크는 그 위에 얹는 이중 방어일 뿐이다.
const OWNER_MAX_PUBLISHED = 5;

// 시간당/일당 한도 상수는 더 이상 없다 — 라이브러리·소유권·로그인·동기화의
// 레이트리밋은 전부 Cloudflare 네이티브 Rate Limiting 바인딩(RL_*)으로 옮겼다.
// 네이티브 바인딩의 period 는 10초 또는 60초만 허용되므로 창 자체가 60초로
// 좁아졌다: 장시간 누적 총량 상한은 사라지지만 폭주는 더 확실히 막히고,
// 무엇보다 KV 일일 쓰기 한도(1,000)를 요청마다 갉아먹지 않는다.
// 한도 값은 src/wrangler.toml 의 [[ratelimits]] 에 있다.

// ---- 유저 계정 스토어(/user/*) ----
// 공개 라이브러리(library/)와 달리 여기엔 비공개 북마크까지 전부 들어간다.
// 스냅샷을 통째로 주고받으므로 본문이 library 쪽보다 훨씬 크다.
const USER_MAX_BODY_BYTES = 1048576;
const USER_MAX_BOOKMARKS = 100;
const USER_MAX_ITEMS_PER_BOOKMARK = 300;
const USER_MAX_TOMBSTONES = 500;
const USER_MAX_NAME = 200;
// 클라이언트 로컬 스토어(src/js/core/bookmarks.js)의 version 과 맞물린 값 —
// 한쪽만 올리면 동기화가 조용히 어긋나므로 반드시 같이 올려야 한다.
const USER_DATA_VERSION = 2;
// etag CAS 가 어긋났을 때 다시 읽고 시도하는 횟수. 넘기면 409로 넘겨서
// 클라이언트가 병합하게 한다(서버는 병합 로직을 갖지 않는다 — 아래 주석 참고).
const USER_SYNC_MAX_ATTEMPTS = 3;

// 신규 가입은 IP별 하루 5개. R2 CAS 예약으로 동시 요청에도 상한을 지킨다.
const RATE_LIMIT_USER_SIGNUP_PER_DAY = 5;
const DAY_MS = 86400000;

// ---- 유저 인기 태그 투표(/tags/*) ----
// 스팀 상점 페이지의 "이 제품의 인기 태그"를 본뜬 기능. 공식 태그(AI 장르
// 분류)를 대체하는 게 아니라 그 위에 얹는 별도 레이어다 — 신규·기존 글
// 구분 없이 모든 개별 문학이 투표 대상이다. 자유 입력 없이
// PageData/UserTagCatalog.json(빌드 산출물, 문학 정리/유저인기태그후보.md에서
// 사람이 직접 정한 후보)에서만 투표할 수 있다. 어뷰징 방지는 계정당 1표
// (D1 tag_votes의 PRIMARY KEY가 강제)와 레이트리밋만으로 충분하다 —
// 태그명이 자유 문자열이 아니라서 표기 정규화나 신고 기능이 필요 없다.
const TAG_MAX_VOTES_PER_POST = 5;

function cleanTagPostId(raw) {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0) return null;
  return raw;
}

// UserTagCatalog.json은 다른 PageData/*.json과 똑같이 정상 배포되는 정적
// 자산이다 — R2에 따로 복사하지 않고 같은 Worker의 ASSETS 바인딩으로 그대로
// 읽는다(src/_worker.js가 짧은 주소를 실제 파일로 매핑할 때 쓰는 것과 같은
// new URL + env.ASSETS.fetch 패턴).
async function loadTagCatalog(request, env) {
  var assetUrl = new URL(request.url);
  assetUrl.pathname = '/data/PageData/UserTagCatalog.json';
  var res = await env.ASSETS.fetch(new Request(assetUrl, { method: 'GET' }));
  if (!res.ok) return [];
  try {
    var list = await res.json();
    return Array.isArray(list) ? list.filter(function (t) { return typeof t === 'string'; }) : [];
  } catch (e) {
    return [];
  }
}

// 비로그인 방문자도 득표수는 볼 수 있어야 하므로 personalCode는 선택이다
// (readUserBody는 필수라 여기서는 못 쓴다). 그래서 레이트리밋도 걸지 않는다 —
// GET /library/<code>처럼 읽기 전용 조회는 이 프로젝트에서 원래 열려 있다.
async function handleTagsGet(request, env) {
  var body = await readJsonBody(request, USER_MAX_BODY_BYTES);
  if (body.error) return body.error;

  var postId = cleanTagPostId(body.value && body.value.postId);
  if (postId === null) return jsonResponse(request, { error: 'invalid payload shape' }, 400);

  var personalCode = null;
  if (body.value && body.value.personalCode != null) {
    personalCode = cleanPersonalCode(body.value.personalCode);
    if (personalCode === null) return jsonResponse(request, { error: 'invalid payload shape' }, 400);
  }

  try {
    var rows = await env.TAGS_DB.prepare(
      'SELECT tag_name, COUNT(*) AS votes FROM tag_votes WHERE post_id = ? GROUP BY tag_name'
    ).bind(postId).all();
    var votes = {};
    (rows.results || []).forEach(function (r) { votes[r.tag_name] = r.votes; });

    var myTags = [];
    if (personalCode) {
      var voterHash = await sha256Hex('tagvote:' + personalCode);
      var mine = await env.TAGS_DB.prepare(
        'SELECT tag_name FROM tag_votes WHERE post_id = ? AND voter_hash = ?'
      ).bind(postId, voterHash).all();
      myTags = (mine.results || []).map(function (r) { return r.tag_name; });
    }

    return jsonResponse(request, { votes: votes, myTags: myTags });
  } catch (e) {
    // 스키마 미적용 등 DB 장애 — 태그는 부가 정보라 페이지를 막지 않도록
    // 빈 결과로 조용히 넘어간다(gridPage.js의 스냅샷 병합과 같은 기조).
    return jsonResponse(request, { votes: {}, myTags: [] });
  }
}

// 투표 토글: 이미 투표했으면 취소, 아니면 추가. 로그인(personalCode) 필수라
// readUserBody + env.RL_TAG_WRITE로 레이트리밋과 본문 검증을 한 번에 처리한다.
async function handleTagsVote(request, env) {
  var parsed = await readUserBody(request, env, env.RL_TAG_WRITE);
  if (parsed.error) return parsed.error;

  if (!(await env.FAVORITES_BUCKET.head(await userStoreKey(parsed.personalCode)))) {
    return jsonResponse(request, { error: 'account not found' }, 401);
  }

  var raw = parsed.raw;
  var postId = cleanTagPostId(raw && raw.postId);
  var tagName = raw && typeof raw.tagName === 'string' ? raw.tagName : null;
  if (postId === null || !tagName) return jsonResponse(request, { error: 'invalid payload shape' }, 400);

  var catalog = await loadTagCatalog(request, env);
  if (catalog.indexOf(tagName) === -1) {
    return jsonResponse(request, { error: 'unknown tag' }, 400);
  }

  // 유저 태그 투표는 novel(공식+유저 태그 병행)과 translation(유저 태그
  // 전용) 두 페이지가 대상이다(gridPage.js의 config.userTags/userTagsOnly와
  // 짝을 맞춘다) — 위조된 postId로 아무 글에나 표가 쌓이는 걸 막기 위해,
  // 둘 중 하나의 실제 게시물 목록에 있는지 반드시 확인한다. 시리즈/명예관/
  // 공식은 원래부터 사용자가 직접 관리하는 영역이라 투표 대상이 아니다
  // (literature-data-scope-boundary).
  var TAG_VOTE_CATALOG_PATHS = ['/data/PageData/Novel.json', '/data/PageData/Translation.json'];
  var catalogResponses = await Promise.all(
    TAG_VOTE_CATALOG_PATHS.map(function (path) {
      return env.ASSETS.fetch(new Request(new URL(path, request.url)));
    })
  );
  if (catalogResponses.some(function (r) { return !r.ok; })) {
    return jsonResponse(request, { error: 'post catalog unavailable' }, 503);
  }
  var catalogLists = await Promise.all(catalogResponses.map(function (r) { return r.json(); }));
  var exists = catalogLists.some(function (posts) {
    return Array.isArray(posts) && posts.some(function (entry) {
      return Array.isArray(entry.posts) && entry.posts.some(function (post) { return post.id === postId; });
    });
  });
  if (!exists) return jsonResponse(request, { error: 'unknown post' }, 400);

  var voterHash = await sha256Hex('tagvote:' + parsed.personalCode);

  try {
    var existing = await env.TAGS_DB.prepare(
      'SELECT 1 FROM tag_votes WHERE post_id = ? AND tag_name = ? AND voter_hash = ?'
    ).bind(postId, tagName, voterHash).first();

    if (existing) {
      await env.TAGS_DB.prepare(
        'DELETE FROM tag_votes WHERE post_id = ? AND tag_name = ? AND voter_hash = ?'
      ).bind(postId, tagName, voterHash).run();
      return jsonResponse(request, { ok: true, voted: false });
    }

    // 개수 확인과 삽입을 한 SQL 문으로 묶어 원자적으로 처리한다 — 따로 세고
    // 나서 넣던 예전 방식은 거의 동시에 들어온 두 요청이 둘 다 통과해
    // 5개 상한을 넘기게 둘 수 있었다.
    var inserted = await env.TAGS_DB.prepare(
      'INSERT INTO tag_votes (post_id, tag_name, voter_hash, created_at) ' +
      'SELECT ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM tag_votes WHERE post_id = ? AND voter_hash = ?) < ?'
    ).bind(postId, tagName, voterHash, Date.now(), postId, voterHash, TAG_MAX_VOTES_PER_POST).run();

    if (!inserted.meta || inserted.meta.changes === 0) {
      return jsonResponse(request, { error: 'too many tags on this post' }, 400);
    }
    return jsonResponse(request, { ok: true, voted: true });
  } catch (e) {
    // 거의 동시에 두 번 클릭(더블클릭/재시도)해 위 SELECT가 둘 다 "미투표"로
    // 봤을 때만 PRIMARY KEY 위반이 난다 — 이미 목표한 상태(투표됨)이므로
    // 성공으로 취급한다. 그 외 DB 오류는 성공으로 위장하지 않고 그대로
    // 알려서, 클라이언트가 낙관적으로 반영한 투표를 되돌릴 수 있게 한다.
    var isDuplicate = e && typeof e.message === 'string' && e.message.indexOf('UNIQUE constraint failed') !== -1;
    if (isDuplicate) return jsonResponse(request, { ok: true, voted: true });
    return jsonResponse(request, { error: 'vote failed, try again' }, 500);
  }
}

// 목록/필터용 스냅샷 — src/_worker.js의 scheduled 핸들러가 5분마다 D1을
// 집계해 R2(tags/snapshot.json)에 구워 두면, 이 라우트는 그걸 그대로
// 내려주기만 한다. 공개 데이터라 개인 코드도, 레이트리밋도 필요 없다.
async function handleTagsSnapshot(request, env) {
  var object = await env.FAVORITES_BUCKET.get('tags/snapshot.json');
  var headers = Object.assign(
    { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
    corsHeaders(request)
  );
  if (!object) return new Response(JSON.stringify({ generatedAt: 0, posts: {} }), { headers: headers });
  return new Response(object.body, { headers: headers });
}

// ---- 생일 배너 팬케이크 카운터(/pancake) ----
// 클라이언트(src/js/components/pancakeCounter.js)가 클릭할 때마다 서버로 보내지 않고,
// 5초간 클릭이 멈추면 그동안 쌓인 개수를 한 번에 더한다 — 연타 한 번에
// R2 쓰기 하나만 나가면 된다. 인증도, 이벤트 종료 후 되돌릴 방법도 필요
// 없는 가벼운 카운터라 FAVORITES_BUCKET에 오브젝트 하나(count 필드)로 둔다.
const PANCAKE_KEY = 'pancake/count.json';
// 한 번의 배치 요청으로 더할 수 있는 최대치 — 5초 동안 사람이 실제로 누를
// 수 있는 양보다 넉넉히 크게 잡아서, 직접 API를 호출하는 악의적 요청 한
// 번의 피해만 제한한다.
const PANCAKE_MAX_AMOUNT = 300;
const PANCAKE_MAX_ATTEMPTS = 3;

function pancakePutOptions() {
  return { httpMetadata: { contentType: 'application/json' } };
}

async function readPancakeCount(env) {
  var object = await env.FAVORITES_BUCKET.get(PANCAKE_KEY);
  if (!object) return { count: 0, object: null };
  var record = await object.json();
  return { count: record.count || 0, object: object };
}

async function handlePancakeGet(request, env) {
  var current = await readPancakeCount(env);
  return jsonResponse(request, { count: current.count });
}

async function handlePancakeAdd(request, env) {
  if (!(await checkLimit(env.RL_PANCAKE, clientIp(request)))) {
    return jsonResponse(request, { error: 'too many requests, try again later' }, 429);
  }

  var body = await readJsonBody(request, 256);
  if (body.error) return body.error;
  var amount = body.value && body.value.amount;
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1 || amount > PANCAKE_MAX_AMOUNT) {
    return jsonResponse(request, { error: 'invalid payload shape' }, 400);
  }

  for (var attempt = 0; attempt < PANCAKE_MAX_ATTEMPTS; attempt++) {
    var current = await readPancakeCount(env);
    var next = { count: current.count + amount };
    var putOptions = Object.assign(
      { onlyIf: current.object ? { etagMatches: current.object.etag } : { etagDoesNotMatch: '*' } },
      pancakePutOptions()
    );
    var written = await env.FAVORITES_BUCKET.put(PANCAKE_KEY, JSON.stringify(next), putOptions);
    if (written) return jsonResponse(request, { ok: true, count: next.count });
    // etag 가 어긋났다 = 방금 사이에 누가 썼다. 다시 읽어서 재시도.
  }

  return jsonResponse(request, { error: 'conflict, try again' }, 409);
}

// API 는 이제 정적 사이트와 같은 Worker(src/_worker.js)라 모든 정상 호출이
// 동일 출처다(bookmarkLibrary.js/userData.js 의 WORKER_BASE = ''). 예전
// workers.dev 시절의 '*' 는 아무 사이트나 자기 방문자의 브라우저로 이 API 를
// 두드리게 하는 통로일 뿐이라, 자기 오리진일 때만 CORS 를 허용한다.
function corsHeaders(request) {
  var origin = request && request.headers.get('Origin');
  var self = request ? new URL(request.url).origin : null;
  if (origin && origin === self) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    };
  }
  // 교차 출처에는 허용 헤더를 아예 주지 않는다. 동일 출처 요청은 애초에
  // 프리플라이트를 하지 않으므로 정상 동작에는 영향이 없다.
  return { 'Vary': 'Origin' };
}

function jsonResponse(request, body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json' }, corsHeaders(request))
  });
}

function generateToken(length) {
  var bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  var chars = [];
  for (var i = 0; i < length; i++) chars.push(ALPHABET[bytes[i] % ALPHABET.length]);
  return chars.join('');
}
function generateCode() { return generateToken(CODE_LENGTH); }
function generateEditToken() { return generateToken(EDIT_TOKEN_LENGTH); }

async function sha256Hex(str) {
  var data = new TextEncoder().encode(str);
  var digest = await crypto.subtle.digest('SHA-256', data);
  var bytes = new Uint8Array(digest);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

// ---- 개인 복구 코드 ----
// code(레코드 자신의 공개 코드)를 해시에 함께 섞어서, 같은 사람이 올린
// 북마크 두 개라도 ownerHash 값이 서로 달라지게 한다 — 공개 버킷을 통째로
// 긁어봐도 이 값들만으로는 "같은 사람 것"이라는 상관관계가 드러나지 않는다.
async function ownerHashFor(personalCode, code) {
  return sha256Hex('owner:' + code + ':' + personalCode);
}

// 개인 코드 → 소유한 공개 코드 목록을 찾기 위한 인덱스 오브젝트 키.
// R2 list()는 프리픽스로만 훑을 수 있고 임의 필드로 조회할 수 없어서,
// "이 개인 코드가 어떤 code들을 소유하는지"를 이 인덱스 오브젝트가 대신한다.
async function ownerIndexKey(personalCode) {
  return 'owners/' + (await sha256Hex('owner-index:' + personalCode)) + '.json';
}

function cleanPersonalCode(raw) {
  if (typeof raw !== 'string') return null;
  var trimmed = raw.trim();
  if (!PERSONAL_CODE_RE.test(trimmed)) return null;
  return trimmed;
}

// 인덱스는 조회 편의용일 뿐이라 실패해도 삼켜서 게시/연결 자체를 막지 않는다
// (문서 상단 주석 참고 — 권한 증명은 항상 레코드 자신의 ownerHash가 한다).
async function addToOwnerIndex(env, personalCode, code) {
  try {
    var key = await ownerIndexKey(personalCode);
    var object = await env.FAVORITES_BUCKET.get(key);
    var codes = [];
    if (object) {
      var data = await object.json();
      if (data && Array.isArray(data.codes)) {
        codes = data.codes.filter(function (c) { return typeof c === 'string'; });
      }
    }
    if (codes.indexOf(code) === -1) {
      // 정상 경로라면 handleLibraryCreate/handleLibraryClaimOwner가 이미
      // OWNER_MAX_PUBLISHED로 막았어야 한다 — 여기 걸리는 건 두 요청이
      // 거의 동시에 들어와 둘 다 사전 검사를 통과한 경합 상황뿐이다.
      if (codes.length >= OWNER_MAX_PUBLISHED) return;
      codes.push(code);
      await env.FAVORITES_BUCKET.put(key, JSON.stringify({ v: 1, codes: codes }), {
        httpMetadata: { contentType: 'application/json' }
      });
    }
  } catch (e) {
    // 인덱스 갱신 실패 — 개별 레코드는 여전히 personalCode로 정상 인증된다
  }
}

// handleLibraryCreate/handleLibraryClaimOwner가 실제로 새 공개를 막을지
// 판단하는 데 쓴다 — addToOwnerIndex 내부의 동일 검사와 달리 여기는
// 실패를 삼키지 않는다: 인덱스를 못 읽으면 개수를 모르는 채로 공개를
// 허용해버릴 수 있으니, 이 조회 자체가 실패하면 호출자가 요청을 통째로
// 실패시켜야 한다(막연히 통과시키는 쪽보다 안전한 기본값). 배열 자체를
// 돌려주는 이유는 handleLibraryClaimOwner가 "이미 연결된 코드의 재시도"를
// 상한 체크에서 빼야 하기 때문이다(codes.indexOf(code)로 구분).
async function getOwnerCodes(env, personalCode) {
  var object = await env.FAVORITES_BUCKET.get(await ownerIndexKey(personalCode));
  if (!object) return [];
  var data = await object.json();
  if (!data || !Array.isArray(data.codes)) return [];
  return data.codes.filter(function (c) { return typeof c === 'string'; });
}

// PUT/DELETE 공용 인증: editToken 또는 personalCode 중 하나만 record와
// 맞으면 통과한다. personalCode는 record.ownerHash가 세팅돼 있을 때만
// (즉 이 코드로 연결된 적이 있을 때만) 통할 수 있다.
async function verifyLibraryAuth(record, code, auth) {
  if (auth.editToken) {
    var providedHash = await sha256Hex(auth.editToken);
    if (providedHash === record.editTokenHash) return true;
  }
  if (auth.personalCode && record.ownerHash) {
    var providedOwnerHash = await ownerHashFor(auth.personalCode, code);
    if (providedOwnerHash === record.ownerHash) return true;
  }
  return false;
}

// PUT body와 DELETE body가 공유하는 인증 필드 파싱 — editToken/personalCode
// 중 최소 하나는 있어야 하고, personalCode가 있으면 형태를 검증한다.
function validateLibraryAuth(raw) {
  if (!raw || typeof raw !== 'object') return null;
  var hasEditToken = typeof raw.editToken === 'string' && raw.editToken;
  var hasPersonalCode = typeof raw.personalCode === 'string' && raw.personalCode;
  if (!hasEditToken && !hasPersonalCode) return null;
  var result = {};
  if (hasEditToken) result.editToken = raw.editToken;
  if (hasPersonalCode) {
    var personalCode = cleanPersonalCode(raw.personalCode);
    if (personalCode === null) return null;
    result.personalCode = personalCode;
  }
  return result;
}

// Cloudflare 네이티브 Rate Limiting 바인딩. KV 할당량을 전혀 쓰지 않고
// 원자적이라, 예전 KV 고정 윈도우 카운터(get→비교→put, 락 없음)가 갖고
// 있던 두 문제를 한 번에 없앤다. 바인딩이 없으면(아직 [[ratelimits]] 가
// 없는 구 배포, 로컬 wrangler dev) fail open 해서 기능 자체가 막히지 않게
// 한다 — 예전 checkRateLimit 이 RATE_LIMIT_KV 없이 통과시키던 것과 같다.
async function checkLimit(limiter, ip) {
  if (!limiter) return true;
  try {
    var r = await limiter.limit({ key: ip });
    return r.success;
  } catch (e) {
    return true;
  }
}

// R2 conditional writes serialize reservations for one IP. The fixed key is
// reused across days, so a returning IP does not create a new object every day.
// Store neither raw IPs nor personal codes. Failed creations conservatively keep
// their reservation; retrying the same personal code does not consume another.
async function reserveSignup(env, ip, personalCode) {
  var day = Math.floor(Date.now() / DAY_MS);
  var key = 'limits/signup/' + await sha256Hex('signup-ip:' + ip) + '.json';
  var reservation = await sha256Hex('signup-reservation:' + personalCode);
  for (var attempt = 0; attempt < 8; attempt++) {
    var object = await env.FAVORITES_BUCKET.get(key);
    var record = object ? await object.json() : null;
    if (!record || record.day !== day) {
      // Preserve the current day's pre-upgrade quota. KV failure must not reset
      // a quota to zero; the signup handler returns 503 in that case.
      var legacy = env.RATE_LIMIT_KV
        ? Number(await env.RATE_LIMIT_KV.get('rl:user-signup:' + ip + ':' + day)) || 0 : 0;
      record = { day: day, legacyCount: legacy, reservations: [] };
    }
    if (record.reservations.indexOf(reservation) !== -1) return true;
    if (record.legacyCount + record.reservations.length >= RATE_LIMIT_USER_SIGNUP_PER_DAY) return false;
    record.reservations.push(reservation);
    var written = await env.FAVORITES_BUCKET.put(key, JSON.stringify(record), {
      onlyIf: object ? { etagMatches: object.etag } : { etagDoesNotMatch: '*' },
      httpMetadata: { contentType: 'application/json' }
    });
    if (written) return true;
  }
  throw new Error('signup quota contention');
}

// ---- Legacy 1:1 favorites share ----

// ---- Bookmark library ----

function cleanLibraryName(raw) {
  if (typeof raw !== 'string') return null;
  var trimmed = raw.trim();
  if (!trimmed || trimmed.length > LIBRARY_MAX_NAME) return null;
  return trimmed;
}

function cleanLibraryItems(raw) {
  if (!Array.isArray(raw) || raw.length > LIBRARY_MAX_ITEMS) return null;
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var item = raw[i];
    if (!item || typeof item !== 'object') return null;
    if (LIBRARY_ITEM_TYPES.indexOf(item.type) === -1) return null;
    if (typeof item.id !== 'number' || !Number.isInteger(item.id) || item.id < 0) return null;
    out.push({ type: item.type, id: item.id });
  }
  return out;
}

function validateLibraryCreate(raw) {
  if (!raw || typeof raw !== 'object') return null;
  var name = cleanLibraryName(raw.name);
  var items = cleanLibraryItems(raw.items);
  if (name === null || items === null) return null;
  var result = { name: name, items: items };
  // personalCode는 선택 — 없어도 게시는 되지만(옛 클라이언트/개인 코드
  // 생성 실패 등 대비), 있으면 형태가 맞아야 한다.
  if (typeof raw.personalCode === 'string' && raw.personalCode) {
    var personalCode = cleanPersonalCode(raw.personalCode);
    if (personalCode === null) return null;
    result.personalCode = personalCode;
  }
  return result;
}

function validateLibraryUpdate(raw) {
  var auth = validateLibraryAuth(raw);
  if (!auth) return null;
  var result = auth;
  if (raw.name !== undefined) {
    var name = cleanLibraryName(raw.name);
    if (name === null) return null;
    result.name = name;
  }
  if (raw.items !== undefined) {
    var items = cleanLibraryItems(raw.items);
    if (items === null) return null;
    result.items = items;
  }
  return result;
}

async function readJsonBody(request, maxBytes) {
  var result = await readJsonLimited(request, maxBytes);
  if (result.error) return { error: jsonResponse(request, { error: result.error }, result.status) };
  return result;
}

function libraryPublicView(code, record) {
  return {
    code: code,
    name: record.name,
    items: record.items,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

async function handleLibraryCreate(request, env) {
  var ip = clientIp(request);
  if (!(await checkLimit(env.RL_LIB_WRITE, ip))) {
    return jsonResponse(request, { error: 'too many requests, try again later' }, 429);
  }

  var body = await readJsonBody(request, LIBRARY_MAX_BODY_BYTES);
  if (body.error) return body.error;

  var clean = validateLibraryCreate(body.value);
  if (!clean) return jsonResponse(request, { error: 'invalid payload shape' }, 400);

  // 개인 코드 하나당 공개(라이브러리 게시) 상한 — 위 OWNER_MAX_PUBLISHED
  // 주석 참고. personalCode 없이 게시하는(구형/익명) 경우는 애초에
  // owner-index에 안 걸리므로 owner-lookup의 순차 R2 호출 문제와 무관해
  // 여기서 막지 않는다.
  if (clean.personalCode) {
    if (!(await env.FAVORITES_BUCKET.head(await userStoreKey(clean.personalCode)))) {
      return jsonResponse(request, { error: 'account not found' }, 401);
    }
    var existingCodes = await getOwnerCodes(env, clean.personalCode);
    if (existingCodes.length >= OWNER_MAX_PUBLISHED) {
      return jsonResponse(request, {
        error: '개인 코드당 공개 가능한 북마크는 최대 ' + OWNER_MAX_PUBLISHED + '개예요. 기존 공개를 취소하고 다시 시도해주세요.'
      }, 409);
    }
  }

  var code = null;
  for (var attempt = 0; attempt < 3; attempt++) {
    var candidate = generateCode();
    var existing = await env.FAVORITES_BUCKET.head('library/' + candidate + '.json');
    if (!existing) { code = candidate; break; }
  }
  if (!code) return jsonResponse(request, { error: 'could not allocate code, try again' }, 500);

  var editToken = generateEditToken();
  var editTokenHash = await sha256Hex(editToken);
  var ownerHash = clean.personalCode ? await ownerHashFor(clean.personalCode, code) : null;
  var now = Date.now();
  var record = {
    v: 1,
    name: clean.name,
    items: clean.items,
    editTokenHash: editTokenHash,
    ownerHash: ownerHash,
    createdAt: now,
    updatedAt: now
  };

  await env.FAVORITES_BUCKET.put('library/' + code + '.json', JSON.stringify(record), {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: {
      name: clean.name,
      itemCount: String(clean.items.length),
      createdAt: String(now),
      updatedAt: String(now)
    }
  });

  if (clean.personalCode) {
    await addToOwnerIndex(env, clean.personalCode, code);
  }

  await updateLibraryIndex(env, code, record);
  return jsonResponse(request, { code: code, editToken: editToken }, 201);
}

async function handleLibraryList(url, request, env) {
  var ip = clientIp(request);
  if (!(await checkLimit(env.RL_LIB_LIST, ip))) {
    return jsonResponse(request, { error: 'too many requests, try again later' }, 429);
  }

  var limit = parseInt(url.searchParams.get('limit'), 10);
  if (!limit || limit < 1 || limit > LIBRARY_LIST_MAX_LIMIT) limit = LIBRARY_LIST_DEFAULT_LIMIT;
  var offset = parseInt(url.searchParams.get('offset'), 10);
  if (!offset || offset < 0) offset = 0;

  var sort = url.searchParams.get('sort') || 'new';
  if (sort !== 'new' && sort !== 'updated' && sort !== 'name') sort = 'new';

  var q = (url.searchParams.get('q') || '').trim().slice(0, LIBRARY_MAX_QUERY).toLowerCase();

  var rows = await readLibraryIndex(env);
  if (!Array.isArray(rows)) {
    return jsonResponse(request, { error: 'library index is preparing, try again shortly' }, 503);
  }

  if (q) {
    rows = rows.filter(function (r) { return r.name.toLowerCase().indexOf(q) !== -1; });
  }

  rows.sort(function (a, b) {
    // 'ko' is pinned rather than relying on the runtime default locale —
    // Korean collation sorts Hangul ahead of Latin, which is what a Korean
    // reader expects from 가나다순
    if (sort === 'name') return a.name.localeCompare(b.name, 'ko') || b.createdAt - a.createdAt;
    if (sort === 'updated') return b.updatedAt - a.updatedAt;
    return b.createdAt - a.createdAt;
  });

  var total = rows.length;
  var items = rows.slice(offset, offset + limit);

  return jsonResponse(request, {
    items: items,
    total: total,
    offset: offset,
    limit: limit,
    hasMore: offset + items.length < total,
    sort: sort,
    q: q,
    truncated: false
  });
}

async function handleLibraryGet(code, request, env) {
  if (!CODE_RE.test(code)) return jsonResponse(request, { error: 'invalid code' }, 400);

  var object = await env.FAVORITES_BUCKET.get('library/' + code + '.json');
  if (!object) return jsonResponse(request, { error: 'not found' }, 404);

  var record = await object.json();
  return jsonResponse(request, libraryPublicView(code, record));
}

async function handleLibraryUpdate(code, request, env) {
  var ip = clientIp(request);
  if (!(await checkLimit(env.RL_LIB_WRITE, ip))) {
    return jsonResponse(request, { error: 'too many requests, try again later' }, 429);
  }
  if (!CODE_RE.test(code)) return jsonResponse(request, { error: 'invalid code' }, 400);

  var object = await env.FAVORITES_BUCKET.get('library/' + code + '.json');
  if (!object) return jsonResponse(request, { error: 'not found' }, 404);
  var record = await object.json();

  var body = await readJsonBody(request, LIBRARY_MAX_BODY_BYTES);
  if (body.error) return body.error;

  var clean = validateLibraryUpdate(body.value);
  if (!clean) return jsonResponse(request, { error: 'invalid payload shape' }, 400);

  var authorized = await verifyLibraryAuth(record, code, clean);
  if (!authorized) {
    return jsonResponse(request, { error: 'invalid edit token' }, 403);
  }

  if (clean.name !== undefined) record.name = clean.name;
  if (clean.items !== undefined) record.items = clean.items;
  record.updatedAt = Date.now();

  await env.FAVORITES_BUCKET.put('library/' + code + '.json', JSON.stringify(record), {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: {
      name: record.name,
      itemCount: String(record.items.length),
      createdAt: String(record.createdAt || record.updatedAt),
      updatedAt: String(record.updatedAt)
    }
  });

  await updateLibraryIndex(env, code, record);
  return jsonResponse(request, libraryPublicView(code, record));
}

async function handleLibraryDelete(code, request, env) {
  var ip = clientIp(request);
  if (!(await checkLimit(env.RL_LIB_WRITE, ip))) {
    return jsonResponse(request, { error: 'too many requests, try again later' }, 429);
  }
  if (!CODE_RE.test(code)) return jsonResponse(request, { error: 'invalid code' }, 400);

  var object = await env.FAVORITES_BUCKET.get('library/' + code + '.json');
  if (!object) return jsonResponse(request, { error: 'not found' }, 404);
  var record = await object.json();

  var body = await readJsonBody(request, LIBRARY_MAX_BODY_BYTES);
  if (body.error) return body.error;
  var auth = validateLibraryAuth(body.value);
  if (!auth) return jsonResponse(request, { error: 'invalid payload shape' }, 400);

  var authorized = await verifyLibraryAuth(record, code, auth);
  if (!authorized) {
    return jsonResponse(request, { error: 'invalid edit token' }, 403);
  }

  await env.FAVORITES_BUCKET.delete('library/' + code + '.json');
  await updateLibraryIndex(env, code, null);
  // 인덱스에서 이 code를 빼는 건 베스트 에포트로만 한다: 인증이 editToken을
  // 통해 이뤄졌다면 서버는 personalCode 평문을 모르므로 인덱스 키(해시)를
  // 계산할 수 없다 — 이런 잔여 항목은 owner/lookup 조회 시 head()가 404를
  // 반환하면 그때 정리된다(handleOwnerLookup 참고).
  if (auth.personalCode) {
    try {
      var indexKey = await ownerIndexKey(auth.personalCode);
      var indexObject = await env.FAVORITES_BUCKET.get(indexKey);
      if (indexObject) {
        var indexData = await indexObject.json();
        var codes = (indexData && Array.isArray(indexData.codes)) ? indexData.codes : [];
        var next = codes.filter(function (c) { return c !== code; });
        if (next.length !== codes.length) {
          await env.FAVORITES_BUCKET.put(indexKey, JSON.stringify({ v: 1, codes: next }), {
            httpMetadata: { contentType: 'application/json' }
          });
        }
      }
    } catch (e) {}
  }
  return jsonResponse(request, { ok: true });
}

async function handleLibraryClaimOwner(code, request, env) {
  var ip = clientIp(request);
  if (!(await checkLimit(env.RL_LIB_WRITE, ip))) {
    return jsonResponse(request, { error: 'too many requests, try again later' }, 429);
  }
  if (!CODE_RE.test(code)) return jsonResponse(request, { error: 'invalid code' }, 400);

  var object = await env.FAVORITES_BUCKET.get('library/' + code + '.json');
  if (!object) return jsonResponse(request, { error: 'not found' }, 404);
  var record = await object.json();

  var body = await readJsonBody(request, LIBRARY_MAX_BODY_BYTES);
  if (body.error) return body.error;
  if (!body.value || typeof body.value.editToken !== 'string' || !body.value.editToken) {
    return jsonResponse(request, { error: 'invalid payload shape' }, 400);
  }
  var personalCode = cleanPersonalCode(body.value.personalCode);
  if (personalCode === null) return jsonResponse(request, { error: 'invalid payload shape' }, 400);
  if (!(await env.FAVORITES_BUCKET.head(await userStoreKey(personalCode)))) {
    return jsonResponse(request, { error: 'account not found' }, 401);
  }

  var providedHash = await sha256Hex(body.value.editToken);
  if (providedHash !== record.editTokenHash) {
    return jsonResponse(request, { error: 'invalid edit token' }, 403);
  }

  // 이미 인덱스에 연결된 코드의 재요청(재시도 등)은 상한 체크에서 뺀다 —
  // 새로 하나를 더 늘리는 게 아니라 이미 있던 연결을 재확인하는 것뿐이다.
  var linkedCodes = await getOwnerCodes(env, personalCode);
  if (linkedCodes.indexOf(code) === -1 && linkedCodes.length >= OWNER_MAX_PUBLISHED) {
    return jsonResponse(request, {
      error: '개인 코드당 공개 가능한 북마크는 최대 ' + OWNER_MAX_PUBLISHED + '개예요. 기존 공개를 취소하고 다시 시도해주세요.'
    }, 409);
  }

  // 이미 공개된 내용을 그대로 둔 채 소유권 표지만 붙인다 — name/items는 물론
  // updatedAt도 건드리지 않는다(연결 자체는 "수정"이 아니므로 목록 정렬
  // 순서에 영향을 주면 안 된다).
  record.ownerHash = await ownerHashFor(personalCode, code);
  await env.FAVORITES_BUCKET.put('library/' + code + '.json', JSON.stringify(record), {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: {
      name: record.name,
      itemCount: String(record.items.length),
      createdAt: String(record.createdAt || record.updatedAt),
      updatedAt: String(record.updatedAt)
    }
  });
  await addToOwnerIndex(env, personalCode, code);

  return jsonResponse(request, { ok: true });
}

async function handleOwnerLookup(request, env) {
  var ip = clientIp(request);
  if (!(await checkLimit(env.RL_OWNER_LOOKUP, ip))) {
    return jsonResponse(request, { error: 'too many requests, try again later' }, 429);
  }

  var body = await readJsonBody(request, LIBRARY_MAX_BODY_BYTES);
  if (body.error) return body.error;
  var personalCode = cleanPersonalCode(body.value && body.value.personalCode);
  if (personalCode === null) return jsonResponse(request, { error: 'invalid payload shape' }, 400);

  var indexKey = await ownerIndexKey(personalCode);
  var indexObject = await env.FAVORITES_BUCKET.get(indexKey);
  if (!indexObject) return jsonResponse(request, { items: [], total: 0 });

  var indexData = await indexObject.json();
  var codes = (indexData && Array.isArray(indexData.codes))
    ? indexData.codes.filter(function (c) { return typeof c === 'string'; })
    : [];

  var items = [];
  var staleFound = false;
  for (var i = 0; i < codes.length; i++) {
    var libCode = codes[i];
    var head = await env.FAVORITES_BUCKET.head('library/' + libCode + '.json');
    if (!head) { staleFound = true; continue; }
    var meta = head.customMetadata || {};
    items.push({
      code: libCode,
      name: meta.name || '',
      itemCount: parseInt(meta.itemCount || '0', 10) || 0,
      createdAt: parseInt(meta.createdAt || meta.updatedAt || '0', 10) || 0,
      updatedAt: parseInt(meta.updatedAt || '0', 10) || 0
    });
  }

  items.sort(function (a, b) { return b.updatedAt - a.updatedAt; });

  if (staleFound) {
    // 이미 삭제된 코드가 인덱스에 남아 있었다 — 다음 조회가 깨끗하도록
    // 정리해둔다(베스트 에포트, 실패해도 이번 응답에는 영향 없음).
    try {
      var liveCodes = items.map(function (it) { return it.code; });
      await env.FAVORITES_BUCKET.put(indexKey, JSON.stringify({ v: 1, codes: liveCodes }), {
        httpMetadata: { contentType: 'application/json' }
      });
    } catch (e) {}
  }

  return jsonResponse(request, { items: items, total: items.length });
}

// ---- 유저 계정 스토어 ----
// 공개 라이브러리와 완전히 분리된 프라이빗 저장소. 키가 개인 코드의 해시라
// 버킷이 공개 읽기 가능해도 키를 모르면 닿을 수 없다. owner-index 와는 해시
// prefix 가 달라서(user-v2: vs owner-index:) 같은 개인 코드라도 두 키가
// 전혀 다른 값이 된다 — 마이그레이션할 땐 양쪽을 따로 계산해야 한다.
async function userStoreKey(personalCode) {
  return 'user/' + (await sha256Hex('user-v2:' + personalCode)) + '.json';
}

function emptyUserData() {
  return { version: USER_DATA_VERSION, bookmarks: [], deletedBookmarks: [] };
}

function cleanUserItems(raw) {
  if (!Array.isArray(raw) || raw.length > USER_MAX_ITEMS_PER_BOOKMARK) return null;
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var item = raw[i];
    if (!item || typeof item !== 'object') return null;
    if (LIBRARY_ITEM_TYPES.indexOf(item.type) === -1) return null;
    if (typeof item.id !== 'number' || !Number.isInteger(item.id) || item.id < 0) return null;
    out.push({
      type: item.type,
      id: item.id,
      addedAt: typeof item.addedAt === 'number' ? item.addedAt : 0
    });
  }
  return out;
}

function cleanUserTombstones(raw, stampField) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > USER_MAX_TOMBSTONES) return null;
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var t = raw[i];
    if (!t || typeof t !== 'object') return null;
    var stamp = typeof t[stampField] === 'number' ? t[stampField] : 0;
    if (stampField === 'deletedAt') {
      if (typeof t.id !== 'string' || !t.id || t.id.length > 64) return null;
      out.push({ id: t.id, deletedAt: stamp });
    } else {
      if (LIBRARY_ITEM_TYPES.indexOf(t.type) === -1) return null;
      if (typeof t.id !== 'number' || !Number.isInteger(t.id)) return null;
      out.push({ type: t.type, id: t.id, removedAt: stamp });
    }
  }
  return out;
}

// 클라이언트 로컬 스토어를 그대로 받되, 남이 버킷에 쓰레기를 밀어 넣지
// 못하도록 형태와 크기만 확인하고 아는 필드만 재조립한다.
function cleanUserData(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.version !== USER_DATA_VERSION) return null;
  if (!Array.isArray(raw.bookmarks) || raw.bookmarks.length > USER_MAX_BOOKMARKS) return null;

  var bookmarks = [];
  for (var i = 0; i < raw.bookmarks.length; i++) {
    var b = raw.bookmarks[i];
    if (!b || typeof b !== 'object') return null;
    if (typeof b.id !== 'string' || !b.id || b.id.length > 64) return null;
    if (typeof b.name !== 'string' || b.name.length > USER_MAX_NAME) return null;
    var items = cleanUserItems(b.items);
    if (items === null) return null;
    var removedItems = cleanUserTombstones(b.removedItems, 'removedAt');
    if (removedItems === null) return null;
    // 공개 라이브러리(library/<code>.json)에 이미 올라가 있으면 그 code —
    // 클라이언트가 같은 북마크를 다른 기기에서 또 공개하지 않도록 이 값을
    // 계정 데이터에 함께 실어 나른다(bookmarks.js 상단 주석 참고).
    var publishedCode = (typeof b.publishedCode === 'string' && CODE_RE.test(b.publishedCode))
      ? b.publishedCode : null;
    bookmarks.push({
      id: b.id,
      name: b.name,
      createdAt: typeof b.createdAt === 'number' ? b.createdAt : 0,
      updatedAt: typeof b.updatedAt === 'number' ? b.updatedAt : 0,
      items: items,
      removedItems: removedItems,
      publishedCode: publishedCode,
      // publishedCode 전용 타임스탬프 — 공용 updatedAt에 얹으면 이름 변경 같은
      // 무관한 수정이 "더 최신"으로 잡혀서 공개 취소가 되살아나는 병합 버그가
      // 생긴다(src/js/core/userData.js의 mergePublishedCode 참고).
      publishedCodeUpdatedAt: typeof b.publishedCodeUpdatedAt === 'number' ? b.publishedCodeUpdatedAt : 0
    });
  }

  var deletedBookmarks = cleanUserTombstones(raw.deletedBookmarks, 'deletedAt');
  if (deletedBookmarks === null) return null;

  return { version: USER_DATA_VERSION, bookmarks: bookmarks, deletedBookmarks: deletedBookmarks };
}

// head() 만으로 "서버가 나보다 최신인지"를 판단할 수 있게 메타로도 남긴다 —
// 폴링이 매번 본문 전체를 내려받지 않아도 되게 하는 게 목적(library 레코드가
// customMetadata 로 목록을 만드는 것과 같은 수법).
function userStorePutOptions(record) {
  return {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: {
      syncVersion: String(record.syncVersion),
      updatedAt: String(record.updatedAt)
    }
  };
}

// 공통 본문 검증. 계정 존재 검증은 각 핸들러가 별도로 수행한다.
async function readUserBody(request, env, limiter) {
  if (limiter) {
    var ip = clientIp(request);
    if (!(await checkLimit(limiter, ip))) {
      return { error: jsonResponse(request, { error: 'too many requests, try again later' }, 429) };
    }
  }
  var body = await readJsonBody(request, USER_MAX_BODY_BYTES);
  if (body.error) return { error: body.error };
  var personalCode = cleanPersonalCode(body.value && body.value.personalCode);
  if (personalCode === null) return { error: jsonResponse(request, { error: 'invalid payload shape' }, 400) };
  return { personalCode: personalCode, raw: body.value };
}

async function handleUserSignup(request, env) {
  var ip = clientIp(request);
  // Reuse the auth burst limiter. Daily reservations below are independent of
  // the approximate edge limit and remain enforced even when it is unavailable.
  if (!(await checkLimit(env.RL_USER_AUTH, ip))) {
    return jsonResponse(request, { error: 'too many requests, try again later' }, 429);
  }

  var parsed = await readUserBody(request, env, null);
  if (parsed.error) return parsed.error;

  var key = await userStoreKey(parsed.personalCode);
  var existing = await env.FAVORITES_BUCKET.head(key);
  if (existing) {
    var meta = existing.customMetadata || {};
    return jsonResponse(request, { ok: true, existed: true, syncVersion: parseInt(meta.syncVersion || '1', 10) || 1 });
  }

  try {
    if (!(await reserveSignup(env, ip, parsed.personalCode))) {
      return jsonResponse(request, { error: 'too many requests, try again later' }, 429);
    }
  } catch (error) {
    return jsonResponse(request, { error: 'signup temporarily unavailable' }, 503);
  }

  var now = Date.now();
  var record = { v: 1, createdAt: now, updatedAt: now, syncVersion: 1, data: emptyUserData() };
  // etagDoesNotMatch:'*' = "없을 때만 만들어라". 두 기기가 같은 코드로 동시에
  // 가입을 눌러도 한쪽만 성공하고, 진 쪽은 이미 있는 계정을 그대로 쓰면 된다.
  var written = await env.FAVORITES_BUCKET.put(
    key, JSON.stringify(record),
    Object.assign({ onlyIf: { etagDoesNotMatch: '*' } }, userStorePutOptions(record))
  );
  if (!written) return jsonResponse(request, { ok: true, existed: true, syncVersion: 1 });


  return jsonResponse(request, { ok: true, createdAt: now, syncVersion: 1 }, 201);
}

// 구버전 개인 코드 사용자를 위한 1회성 통합. 예전엔 "공개한 북마크"만 서버에
// 있었으므로, owners 인덱스에 걸린 공개 북마크들을 새 계정 스토어의 북마크로
// 옮겨 담는다. 이 기기의 로컬 북마크와 합치는 건 클라이언트가 이어서 한다.
async function migrateFromOwnerIndex(env, personalCode, userKey) {
  var indexObject = await env.FAVORITES_BUCKET.get(await ownerIndexKey(personalCode));
  if (!indexObject) return null;

  var indexData = await indexObject.json();
  var codes = (indexData && Array.isArray(indexData.codes))
    ? indexData.codes.filter(function (c) { return typeof c === 'string'; })
    : [];
  if (!codes.length) return null;

  var bookmarks = [];
  for (var i = 0; i < codes.length && bookmarks.length < USER_MAX_BOOKMARKS; i++) {
    var libObject = await env.FAVORITES_BUCKET.get('library/' + codes[i] + '.json');
    if (!libObject) continue;
    var rec = await libObject.json();
    var stamp = rec.createdAt || Date.now();
    // 되찾기(restorePublishedToLocal)로 이미 로컬에 복원해 둔 사용자가 있으므로,
    // 클라이언트가 code 로 짝을 찾아 중복 폴더를 합칠 수 있도록 id 에 code 를 심는다.
    bookmarks.push({
      id: 'lib_' + codes[i],
      name: rec.name || '',
      createdAt: stamp,
      updatedAt: rec.updatedAt || stamp,
      items: (rec.items || []).map(function (it) {
        return { type: it.type, id: it.id, addedAt: stamp };
      }),
      removedItems: [],
      // 이 항목은 정의상 이미 공개돼 있던 것(owners 인덱스에 걸려 있었음) —
      // 안 채우면 마이그레이션 직후 다른 기기에서 또 공개할 수 있게 된다.
      publishedCode: codes[i],
      publishedCodeUpdatedAt: stamp
    });
  }
  if (!bookmarks.length) return null;

  var now = Date.now();
  var record = {
    v: 1, createdAt: now, updatedAt: now, syncVersion: 1,
    data: { version: USER_DATA_VERSION, bookmarks: bookmarks, deletedBookmarks: [] }
  };
  var written = await env.FAVORITES_BUCKET.put(
    userKey, JSON.stringify(record),
    Object.assign({ onlyIf: { etagDoesNotMatch: '*' } }, userStorePutOptions(record))
  );
  if (!written) {
    // 다른 기기가 한발 먼저 마이그레이션을 끝냈다 — 그쪽 결과를 쓴다
    var raced = await env.FAVORITES_BUCKET.get(userKey);
    if (raced) return raced.json();
  }
  return record;
}

async function handleUserGet(request, env) {
  var parsed = await readUserBody(request, env, env.RL_USER_AUTH);
  if (parsed.error) return parsed.error;

  var key = await userStoreKey(parsed.personalCode);
  var object = await env.FAVORITES_BUCKET.get(key);
  if (object) return jsonResponse(request, { userStore: await object.json() });

  var migrated = await migrateFromOwnerIndex(env, parsed.personalCode, key);
  if (migrated) return jsonResponse(request, { userStore: migrated, migrated: true });

  return jsonResponse(request, { error: 'account not found' }, 404);
}

async function handleUserHead(request, env) {
  var parsed = await readUserBody(request, env, null);
  if (parsed.error) return parsed.error;

  var head = await env.FAVORITES_BUCKET.head(await userStoreKey(parsed.personalCode));
  if (!head) return jsonResponse(request, { error: 'account not found' }, 404);

  var meta = head.customMetadata || {};
  return jsonResponse(request, {
    syncVersion: parseInt(meta.syncVersion || '0', 10) || 0,
    updatedAt: parseInt(meta.updatedAt || '0', 10) || 0
  });
}

// 병합은 서버가 하지 않는다. 클라이언트가 이미 mergeStores 를 갖고 있는데
// 서버에 같은 로직을 하나 더 두면 두 구현이 조용히 어긋날 수 있어서다.
// 서버는 syncVersion 비교 + etag CAS 로 "덮어써도 되는가"만 판정하고,
// 뒤처진 요청에는 409와 함께 서버 사본을 돌려줘 클라이언트가 병합하게 한다.
async function handleUserSync(request, env) {
  var parsed = await readUserBody(request, env, env.RL_USER_SYNC);
  if (parsed.error) return parsed.error;

  var raw = parsed.raw;
  var data = cleanUserData(raw && raw.data);
  if (data === null) return jsonResponse(request, { error: 'invalid payload shape' }, 400);
  var clientSyncVersion = raw.clientSyncVersion;
  if (typeof clientSyncVersion !== 'number' || !Number.isInteger(clientSyncVersion) || clientSyncVersion < 0) {
    return jsonResponse(request, { error: 'invalid payload shape' }, 400);
  }

  var key = await userStoreKey(parsed.personalCode);
  for (var attempt = 0; attempt < USER_SYNC_MAX_ATTEMPTS; attempt++) {
    var object = await env.FAVORITES_BUCKET.get(key);
    if (!object) return jsonResponse(request, { error: 'account not found' }, 404);

    var etag = object.etag;
    var current = await object.json();
    if (clientSyncVersion !== current.syncVersion) {
      return jsonResponse(request, { error: 'sync version conflict', serverStore: current }, 409);
    }

    var now = Date.now();
    var next = {
      v: 1,
      createdAt: current.createdAt || now,
      updatedAt: now,
      syncVersion: current.syncVersion + 1,
      data: data
    };
    var written = await env.FAVORITES_BUCKET.put(
      key, JSON.stringify(next),
      Object.assign({ onlyIf: { etagMatches: etag } }, userStorePutOptions(next))
    );
    if (written) {
      return jsonResponse(request, { ok: true, serverSyncVersion: next.syncVersion, updatedAt: now });
    }
    // etag 가 어긋났다 = 방금 사이에 누가 썼다. 다시 읽어서 판정한다.
  }

  var latest = await env.FAVORITES_BUCKET.get(key);
  return jsonResponse(request, {
    error: 'sync version conflict',
    serverStore: latest ? await latest.json() : null
  }, 409);
}

// 라우팅 본체. 예외 처리는 아래 fetch() 가 한 겹 감싸서 담당한다.
async function route(request, env) {
  var url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  if (url.pathname === '/library' && request.method === 'POST') {
    return handleLibraryCreate(request, env);
  }
  if (url.pathname === '/library' && request.method === 'GET') {
    return handleLibraryList(url, request, env);
  }
  if (url.pathname === '/owner/lookup' && request.method === 'POST') {
    return handleOwnerLookup(request, env);
  }
  // 개인 코드가 URL/서버 로그에 남지 않도록 조회도 POST 로 받는다
  // (/owner/lookup 이 POST 인 것과 같은 이유).
  if (url.pathname === '/user/signup' && request.method === 'POST') {
    return handleUserSignup(request, env);
  }
  if (url.pathname === '/user/get' && request.method === 'POST') {
    return handleUserGet(request, env);
  }
  if (url.pathname === '/user/head' && request.method === 'POST') {
    return handleUserHead(request, env);
  }
  if (url.pathname === '/tags/get' && request.method === 'POST') {
    return handleTagsGet(request, env);
  }
  if (url.pathname === '/tags/vote' && request.method === 'POST') {
    return handleTagsVote(request, env);
  }
  if (url.pathname === '/tags/snapshot' && request.method === 'GET') {
    return handleTagsSnapshot(request, env);
  }
  if (url.pathname === '/user/sync' && request.method === 'PUT') {
    return handleUserSync(request, env);
  }
  if (url.pathname === '/pancake' && request.method === 'GET') {
    return handlePancakeGet(request, env);
  }
  if (url.pathname === '/pancake/add' && request.method === 'POST') {
    return handlePancakeAdd(request, env);
  }
  if (url.pathname.indexOf('/library/') === 0) {
    var libRest = url.pathname.slice('/library/'.length);
    var claimSuffix = '/claim-owner';
    if (request.method === 'POST' && libRest.length > claimSuffix.length &&
        libRest.slice(-claimSuffix.length) === claimSuffix) {
      var claimCode = libRest.slice(0, libRest.length - claimSuffix.length);
      return handleLibraryClaimOwner(claimCode, request, env);
    }
    if (request.method === 'GET') return handleLibraryGet(libRest, request, env);
    if (request.method === 'PUT') return handleLibraryUpdate(libRest, request, env);
    if (request.method === 'DELETE') return handleLibraryDelete(libRest, request, env);
  }

  return jsonResponse(request, { error: 'not found' }, 404);
}

export default {
  // 어떤 예외든 여기서 잡아 500 JSON 으로 떨어뜨린다. 이게 없으면 핸들러가
  // 던진 예외가 그대로 런타임까지 올라가 Cloudflare 1101 흰 화면이 나가고,
  // 클라이언트(userData.js/bookmarkLibrary.js)는 JSON 을 기대하다 파싱에서
  // 또 한 번 깨진다.
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (e) {
      return jsonResponse(request, { error: 'internal error' }, 500);
    }
  }
};
