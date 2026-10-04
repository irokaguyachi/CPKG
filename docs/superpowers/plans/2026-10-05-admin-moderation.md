# 관리 페이지 1단계 (공통 기반 + 유저 데이터 정리) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/admin` 관리 페이지와 `/api/admin/*` API로 랭킹·태그 투표·끌올·공개 서재를 사이트 안에서 정리한다.

**Architecture:** `worker/adminApi.js`(새 모듈)가 관리자 인증(계정 해시 + 비밀번호 → HMAC 세션)과 관리 엔드포인트를 맡고, `src/_worker.js`가 `/api/admin/*`를 넘긴다. 차단·잠금·숨김 상태는 같은 D1(`TAGS_DB`)의 새 테이블에 두고, 공개 API(`favoritesShareWorker.js`)가 이 테이블을 확인한다(조회 실패 시 기존 동작으로 통과). 화면은 기존 사이트 셸(site-header, colorTheme, tabsKit, modal-base)을 그대로 쓰는 `adminPage.html`.

**Tech Stack:** Cloudflare Workers(ES modules), D1(SQLite), R2, vanilla JS(IIFE, `var`), Node 테스트 러너 + `node:sqlite` 모형.

**Spec:** `docs/superpowers/specs/2026-10-05-admin-moderation-design.md`

## Global Constraints

- 커밋·푸시 금지(사용자가 요청할 때만). 각 Task 의 마지막 단계는 커밋 대신 "진행 기록 갱신"이다.
- 시크릿 이름: `ADMIN_USER_HASHES`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`. 값을 코드·toml에 쓰지 않는다.
- 관리자 해시 = `sha256('user-v2:' + personalCode)`. 세션 토큰 `k:'admin'`, `a` = 해시 앞 12자, 유효 12시간.
- 레이트리밋 바인딩 `RL_ADMIN_LOGIN`, namespace_id `1011`, limit 5, period 60 — `[[ratelimits]]`와 `[[env.dev.ratelimits]]` 둘 다.
- 공개 API 쪽 새 확인 쿼리는 try/catch로 감싸 실패 시 통과(fail-open). 관리 API는 실패 시 500.
- 관리 응답: `Cache-Control: no-store`, CORS 헤더 없음.
- 브라우저 JS는 기존 스타일(IIFE, `var`, 세미콜론). `adminPage.js`는 운영자 전용이라 `t()`를 쓰지 않는다(번역 사전 대상 아님). 공개 화면에 새로 생기는 문구는 `t()` + English/Japanese 사전 + `10_update_data_version.py`.
- 사용자 커스텀 이미지·로고 경로는 건드리지 않는다(헤더 마크업은 기존 페이지에서 그대로 복사).

## Review Focus

1. 관리자 목록에서 빠진 계정의 살아 있는 세션 → 401 이어야 한다 (Task 2 테스트로 고정).
2. 아직 `admin_schema.sql`이 원격에 적용되지 않은 상태로 배포 → 공개 랭킹·투표·끌올·서재가 그대로 동작해야 한다 (Task 3~6에서 "관리 테이블 없는 D1" 테스트로 고정).
3. 대기열이 비어 있을 때 활성 끌올 취소 → 이전 끌올이 되살아나지 않아야 하고, 다음 신청은 즉시 시작해야 한다 (Task 5).
4. 투표자 prefix 가 여러 명과 겹침 → 아무것도 지우지 않고 409 (Task 4).
5. 숨긴 서재를 주인이 수정 → 여전히 숨김 상태, 공개 목록에 다시 나타나지 않음 (Task 6).

---

## 진행 기록

| Task | 상태 | 메모 |
| --- | --- | --- |
| 1. 스키마 + 테스트 하네스 + tagSnapshot 분리 | ✅ | admin_schema.sql, tests/helpers/workerHarness.cjs, worker/tagSnapshot.js. npm test 32/32 |
| 2. 관리자 인증 + 작업 기록 API + 라우팅 | ✅ | adminApi.js(인증·세션·작업기록) + adminCommon.js, _worker.js 라우팅, RL_ADMIN_LOGIN(prod/dev). npm test 37/37 |
| 3. 랭킹 관리 | ✅ | worker/adminGame.js(순위·삭제·닉네임 변경·차단·금지어), 공개 /game/submit 차단 확인(fail-open). npm test 41/41 |
| 4. 태그 투표 관리 | ✅ | worker/adminTags.js(득표·최근 투표·초기화·투표자 일괄 삭제·잠금), 공개 /tags/vote 403·/tags/get locked. npm test 45/45 |
| 5. 끌올 관리 | ✅ | worker/adminBumps.js(목록·취소), 공개 /bump/get·/bump/request 취소 반영, cleanupBumps 정리. npm test 49/49 |
| 6. 공개 서재 관리 | ✅ | worker/adminLibrary.js(목록·숨기기·해제·영구 삭제), 공개 /library 목록 제외·GET 410. npm test 52/52 |
| 7. 공개 화면 문구(잠금·숨김) + 번역 | ✅ | postDetailSeries.js 투표 잠금 표시·버튼 비활성, bookmarkLibrary.js 410 문구, 영어·일본어 번역 2개, DATA_VERSION d0a676e3d87c. npm test 52/52 |
| 8. 관리 페이지 화면 | ✅ | adminPage.html/js + admin-page.css(기존 헤더·알약 탭·auth 카드·settings-btn 재사용), /admin 슬러그. 로컬 wrangler dev에서 라이트/다크·5개 탭·차단·잠금·영구 삭제·공개 잠금/숨김 표시 확인. npm test 52/52, build OK |
| 9. 최종 검증 | ✅ | npm test 52/52, npm run build exit 0, check_i18n 새 키 정상. 자체 리뷰(별도 리뷰어 없음)에서 확인 창 Enter 버그 1건 수정 |

### 실행 중 내린 결정

- 브랜치·워크트리 없이 `main` 작업 트리에서 진행하고 커밋하지 않음 (프로젝트 규칙: 커밋은 요청 시에만).
- 관리 API를 `adminApi.js`(인증·라우팅·작업 기록) + `adminCommon.js` + 기능별 모듈 4개(`adminGame/Tags/Bumps/Library.js`)로 나눔 — 파일 하나가 비대해지는 것과 순환 import 를 피하려고.
- `RL_ADMIN_LOGIN` 바인딩이 없거나 장애면 로그인을 막음(공개 API 와 반대로 fail-closed) — 비밀번호 대입 방지.
- 랭킹 탭에 차단 목록을 함께 보여줌(`game/nicknames` 응답의 `bans`) — 차단하면 기록이 지워져서 해제할 대상을 볼 곳이 필요.
- 관리자 닉네임 변경도 다른 플레이어가 쓰는 이름이면 거부(409) — 공개 등록과 같은 규칙.
- 테스트 하네스(`tests/helpers/workerHarness.cjs`)는 루트 모듈에서 한 번만 link — 공유 import 가 있는 모듈 그래프에서 기존 방식이 깨짐.
- 공개 화면 두 곳(투표 잠금 표시, 숨긴 서재 문구)은 DOM 테스트 환경이 없어 로컬 브라우저로 확인.
- `/admin` 에는 로딩 화면·방문 집계·동시 접속 스크립트를 넣지 않음 — 운영자 화면이 방문 통계에 잡히지 않게.
- 로컬 확인 중 발견해 고침: 확인 창 입력란 포커스(전환 시작 전 hidden), 취소 버튼에서 Enter 가 확인으로 처리되던 문제.

### 남겨둔 사소한 점

- 숨긴 서재는 주인이 예전 "공개 서재에서 복원" 경로를 쓸 때도 410 이 남(계정 동기화는 영향 없음).
- 로컬에서 `src/` 를 바로 띄우면 헤더·푸터 로고가 안 보임(빌드가 `offlineSrc/` 를 합치기 때문, 기존 동작).

---

### Task 1: 스키마, 테스트 하네스, tagSnapshot 분리

**Files:**
- Create: `worker/admin_schema.sql` (스펙 §4 그대로)
- Create: `worker/tagSnapshot.js` — `export async function recordTagSnapshot(env)` (`src/_worker.js:182-206` 본문 이동)
- Modify: `src/_worker.js` — 로컬 함수 삭제, `import { recordTagSnapshot } from '../worker/tagSnapshot.js'`
- Create: `tests/helpers/workerHarness.cjs`
- Create: `tests/admin-api.test.cjs`

**Interfaces:**
- Produces: `workerHarness.cjs` exports `{ load(file, overrides), D1 (생성자 인자: 적용할 schema 파일 배열), Bucket, clock, hash(text), post(url, body, headers) }`. `D1`/`Bucket`은 `game-ranking.test.cjs`·`security-regressions.test.cjs`의 모형과 같은 동작(D1 `prepare/bind/first/run/all/batch`, Bucket `get/head/put(onlyIf)/delete/list`). `clock.now`를 쓰는 `FakeDate`를 `load` 컨텍스트에 넣는다.
- Produces: `recordTagSnapshot(env) -> Promise<void>`.

- [x] Step 1: 하네스 작성 후 `admin-api.test.cjs`에 스모크 테스트 `schema applies cleanly` — 다섯 개 스키마(`game`, `tags`, `bump`, `admin`) 적용 후 `admin_actions`, `game_bans`, `banned_nicknames`, `tag_vote_locks`, `bump_cancels`, `library_hidden` 테이블이 `sqlite_master`에 있다.
- [x] Step 2: `node --experimental-vm-modules --test tests/admin-api.test.cjs` → admin_schema.sql 없음으로 FAIL.
- [x] Step 3: `admin_schema.sql`, `tagSnapshot.js` 작성, `_worker.js` import 교체.
- [x] Step 4: `npm test` → 32 pass.
- [x] Step 5: 진행 기록 갱신.

### Task 2: 관리자 인증, 작업 기록 API, 라우팅

**Files:**
- Create: `worker/adminApi.js`
- Modify: `src/_worker.js` — `/api/admin/` 접두사를 `adminApi.fetch(request, env, ctx)`로 (`isStatsPath` 분기 바로 뒤), `PAGE_SLUGS`에 `admin: 'adminPage.html'`
- Modify: `src/wrangler.toml` — `RL_ADMIN_LOGIN` 두 곳
- Test: `tests/admin-api.test.cjs`

**Interfaces:**
- Produces (adminApi.js 내부, 이후 Task가 사용):
  - `json(body, status) -> Response` (no-store)
  - `requireSession(request, env) -> Promise<{ actor: string } | Response>`
  - `logAction(env, actor, action, target, detail) -> D1PreparedStatement` (batch에 끼워 넣는 용도, `at = Date.now()`, detail은 `JSON.stringify` 또는 null)
  - `readBody(request) -> Promise<object | Response>` (`readJsonLimited`, 최대 4096바이트)
  - 라우트 표: `ROUTES = { 'METHOD /path': handler(request, env, ctx, session, url) }` — 이후 Task는 여기에 항목만 추가.
- Endpoints: `POST /api/admin/login`, `GET /api/admin/actions?action=&before=` → `{ items:[{id,at,actor,action,target,detail}], nextBefore }` (50건, `id < before` 내림차순, `detail` 파싱해서 반환)

- [x] Step 1: 실패 테스트 작성:
  - `login requires both the admin account and the password` — 해시만 맞음 401, 비번만 맞음 401, 둘 다 맞음 200 + `token`, 응답 본문 `{error:'unauthorized'}`는 두 실패 모두 동일.
  - `admin routes fail closed without secrets` — 세 시크릿 중 하나 삭제 시 login·actions 둘 다 503.
  - `sessions expire, reject forgery, and die when the admin is removed` — `clock.now += 12h+1` → 401; 서명 바꾼 토큰 401; `ADMIN_USER_HASHES`에서 해시 제거 후 기존 토큰 401; `Authorization` 없음 401.
  - `login is rate limited` — `RL_ADMIN_LOGIN.limit`가 `{success:false}`면 429.
  - `admin responses are not cached` — `Cache-Control: no-store`, `Access-Control-Allow-Origin` 없음.
- [x] Step 2: 테스트 실행 → FAIL.
- [x] Step 3: `adminApi.js` 구현. 비교는 양쪽 sha256 hex를 `safeEqual`로. HMAC 키는 `ADMIN_SESSION_SECRET`.
- [x] Step 4: `npm test` 전부 PASS.
- [x] Step 5: 진행 기록 갱신.

### Task 3: 랭킹 관리

**Files:**
- Modify: `worker/adminApi.js` — 랭킹 라우트
- Modify: `worker/favoritesShareWorker.js` `handleGameSubmit` — 닉네임 정리 직후·판 소모 전에 차단/금지어 확인
- Test: `tests/admin-api.test.cjs`

**Interfaces:**
- Consumes: Task 2의 `ROUTES`, `logAction`, `requireSession`.
- Endpoints (스펙 §5): `GET game/scores?period=all|weekly` → `{ period, items:[{playerHash, playerShort, nickname, scoreMs, achievedAt, banned}] }` (상위 100, `weekly`는 이번 주 키 — `gameWeekKey`와 같은 계산을 adminApi에 복제하지 말고 favoritesShareWorker에서 `export function gameWeekKey`로 내보내 import), `POST game/delete`, `game/rename`, `game/ban`, `game/unban`, `GET game/nicknames`, `POST game/nicknames/add`, `game/nicknames/remove`. 이름 정리는 `export function cleanGameNickname`을 import.
- action 이름: `game.delete`, `game.rename`, `game.ban`, `game.unban`, `game.nickname.add`, `game.nickname.remove`. 삭제·차단의 detail = 지워진 행 배열.

- [x] Step 1: 실패 테스트:
  - `admin can delete a weekly or every record of a player` — 플레이 2명 → period 삭제 후 주간만 사라지고 전체 유지 → all 삭제 후 둘 다 없음 → 작업 기록 2줄, detail에 원본 행.
  - `admin rename applies to every period` — 공개 `/game/ranking`에 새 이름.
  - `banned players and banned words cannot submit` — ban 후 submit 400 `invalid nickname`, unban 후 200; 금지어 `바보` 추가 후 `나는바보` 400, 대소문자 무시(`ABC` 추가 → `xabcx` 400); 제거 후 200.
  - `public submit still works when admin tables are missing` — game_schema만 적용한 D1에서 submit 200.
- [x] Step 2: FAIL 확인.
- [x] Step 3: 구현.
- [x] Step 4: `npm test` 전부 PASS (기존 game-ranking 포함).
- [x] Step 5: 진행 기록 갱신.

### Task 4: 태그 투표 관리

**Files:**
- Modify: `worker/adminApi.js`
- Modify: `worker/favoritesShareWorker.js` — `handleTagsVote` 잠금 확인(계정 확인 뒤, 카탈로그 확인 전) → 403 `voting locked`; `handleTagsGet` 응답에 `locked`
- Test: `tests/admin-api.test.cjs`

**Interfaces:**
- Consumes: `recordTagSnapshot` (Task 1) — 변경 API 끝에 `ctx.waitUntil(recordTagSnapshot(env))`.
- Endpoints: `GET tags/post?postId=` → `{ postId, locked, votes:{tag:n} }`; `GET tags/recent?limit=`(기본 50, 최대 200) → `{ items:[{postId, tagName, voter, createdAt}] }`(`voter` = voter_hash 앞 8자); `POST tags/reset {postId, tagName?}`; `POST tags/purge-voter {voterPrefix}`(8~64자 hex, 일치하는 서로 다른 voter_hash가 정확히 1개가 아니면 409 `ambiguous voter`/404); `POST tags/lock|unlock {postId}`.
- action: `tags.reset`, `tags.purge-voter`, `tags.lock`, `tags.unlock`.

- [x] Step 1: 실패 테스트:
  - `admin resets votes per tag or per post and refreshes the snapshot` — R2 `tags/snapshot.json`에 반영 확인.
  - `purging a voter needs an unambiguous prefix` — 같은 앞자리 두 해시로 409, 아무것도 안 지워짐; 고유 prefix면 그 사람 표만 삭제.
  - `locked posts reject new votes and report locked` — lock 후 `/tags/vote` 403, `/tags/get` `locked:true`, 기존 표 유지; unlock 후 200.
- [x] Step 2: FAIL 확인.
- [x] Step 3: 구현.
- [x] Step 4: `npm test` 전부 PASS.
- [x] Step 5: 진행 기록 갱신.

### Task 5: 끌올 관리

**Files:**
- Modify: `worker/adminApi.js`
- Modify: `worker/favoritesShareWorker.js` — `handleBumpGet`, `handleBumpRequest`
- Modify: `src/_worker.js` `cleanupBumps` — batch에 `DELETE FROM bump_cancels WHERE bump_id NOT IN (SELECT id FROM bumps)` 추가(별도 try로, 실패해도 기존 정리는 진행)
- Test: `tests/admin-api.test.cjs`

**Interfaces:**
- Endpoints: `GET bumps` → `{ now, items:[{id, itemType, itemId, requester, requestedAt, startAt, endAt, state:'active'|'waiting'|'done', cancelled}] }` (최근 7일 + 대기, `requester` = 해시 앞 8자; 제목은 화면이 Lookup.json으로 채운다); `POST bumps/cancel {id}`.
- 취소 규칙(스펙 §6): 대기 행 → 삭제. 활성 행 → `bump_cancels` 삽입 + `end_at = now` + 가장 이른 대기 행 `start_at = now`. 지난 행 → 400 `not cancellable`.
- 공개 쪽: `handleBumpGet` 활성 행이 취소됐으면 `active:null`. `handleBumpRequest` 중복 조건의 `id = ACTIVE` 부분에 `AND id NOT IN (SELECT bump_id FROM bump_cancels)`, 맨 끝 행이 취소된 활성 행이면 `startAt = now`. 관리 테이블이 없으면 기존 SQL로 재시도(fail-open).
- action: `bump.cancel`, detail = 원본 행.

- [x] Step 1: 실패 테스트 (`bump_schema.sql` + 계정/Lookup 모형):
  - `cancelling a waiting bump removes it from the queue`
  - `cancelling the active bump promotes the next one now`
  - `cancelling the only active bump shows nothing and the next request starts now` — 이전(지난) 끌올이 되살아나지 않음, 새 신청 `startAt === now`.
  - `bump endpoints still work without admin tables`
- [x] Step 2: FAIL 확인.
- [x] Step 3: 구현.
- [x] Step 4: `npm test` 전부 PASS.
- [x] Step 5: 진행 기록 갱신.

### Task 6: 공개 서재 관리

**Files:**
- Modify: `worker/adminApi.js`
- Modify: `worker/favoritesShareWorker.js` — `handleLibraryList`(숨김 코드 제외), `handleLibraryGet`(숨김이면 410 `{error:'hidden'}`)
- Test: `tests/admin-api.test.cjs`

**Interfaces:**
- Consumes: `readLibraryIndex`, `updateLibraryIndex` (`worker/libraryIndex.js`).
- Endpoints: `GET library?q=` → `{ items:[{code,name,itemCount,createdAt,updatedAt,hidden}], hidden:[{code,name,hiddenAt}] }` (q는 이름·코드 부분일치, 최대 200건); `POST library/hide|unhide {code}`; `POST library/delete {code}` — R2 원본 읽어 스냅샷 → R2 삭제 → `updateLibraryIndex(env, code, null)` → batch(`DELETE FROM library_hidden`, `logAction`), 기록 실패 시 200 + `warning`.
- action: `library.hide`, `library.unhide`, `library.delete`.

- [x] Step 1: 실패 테스트:
  - `hidden libraries leave the public list and return 410` — 주인이 PUT 수정 후에도 목록에 없고 GET 410; unhide 후 복귀.
  - `admin can permanently delete a library` — R2·인덱스에서 사라짐, 기록 detail에 원본(`editTokenHash`, `ownerHash` 제외).
  - `library endpoints still work without admin tables`
- [x] Step 2: FAIL 확인.
- [x] Step 3: 구현.
- [x] Step 4: `npm test` 전부 PASS.
- [x] Step 5: 진행 기록 갱신.

### Task 7: 공개 화면 문구(잠금·숨김) + 번역

**Files:**
- Modify: `src/js/components/postDetailSeries.js` — `/tags/get`의 `locked`이면 투표 버튼 비활성 + `t('이 작품은 투표가 잠겨 있어요')`; `/tags/vote` 403도 같은 처리
- Modify: `src/js/core/bookmarkLibrary.js` — `/library/<code>` 410 → `t('관리자에 의해 숨겨진 서재예요.')`
- Modify: `src/data/i18n/English.json`, `Japanese.json` — 두 키 번역
- Run: `python src/scripts/10_update_data_version.py`

- [x] Step 1: 구현.
- [x] Step 2: `python src/scripts/check_i18n.py` → 빠진 키 0.
- [x] Step 3: `npm test` PASS.
- [x] Step 4: 진행 기록 갱신.

### Task 8: 관리 페이지 화면

**Files:**
- Create: `src/page/adminPage.html` — `bookmarksPage.html`의 `<head>` CSS·헤더·푸터 마크업과 공통 스크립트 순서를 그대로 복사(검색·북마크 전용 스크립트 제외), `<meta name="robots" content="noindex, nofollow">`, 본문에 경고 배너·게이트·탭 컨테이너·패널 5개
- Create: `src/css/pages/admin-page.css` — `colorTheme.css` 토큰만 사용(하드코딩 색 금지), 표·행 버튼·배너·토스트
- Create: `src/js/pages/adminPage.js`

**Interfaces:**
- Consumes: `window.BookmarkLibrary.getPersonalCode()`(실제 이름은 `bookmarkLibrary.js:68` 노출부 확인), `window.TabsKit.createTabs(items, {onActivate})`, `window.TagConfig`(이모지), `chokaguya:auth-change` 이벤트, `Lookup.json`(`fetchJsonCached`가 있으면 사용).
- 세션 키: `sessionStorage['cpkg_admin_session']`.
- 상태 화면: 로그인 안 됨 / 비밀번호 입력 / 503 미설정 / 본 화면.
- 확인 모달: `modal-base.css` 구조. 영구 삭제는 대상 이름 재입력 일치 시에만 확인 버튼 활성.

- [x] Step 1: HTML/CSS/JS 작성.
- [x] Step 2: `npm test`(file-references 포함) PASS.
- [x] Step 3: `npm run build` → exit 0 (난독화 통과).
- [x] Step 4: 로컬 확인 — `src/.dev.vars`에 테스트용 시크릿, `npx wrangler d1 execute cpkg-tags --local --file=../worker/admin_schema.sql`(+ 기존 스키마), `npx wrangler dev` 후 브라우저로 `/admin` 라이트/다크·각 탭 확인. 원격 리소스에 쓰지 않는다.
- [x] Step 5: 진행 기록 갱신.

### Task 9: 최종 검증

- [x] Step 1: `npm test` 전부 PASS, `npm run build` exit 0, `check_i18n.py` 깨끗.
- [x] Step 2: 스펙 §1 성공 기준과 Review Focus 5개를 하나씩 대조해 진행 기록에 메모.
- [x] Step 3: 사용자에게 배포 체크리스트(스펙 §10) 안내. 커밋은 요청 시.
