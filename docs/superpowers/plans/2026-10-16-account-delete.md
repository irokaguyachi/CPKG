# 회원 계정 삭제 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자(설정창)와 관리자(관리 페이지 프로필 탭)가 계정을 지울 수 있게 하고, 지운 계정이 다른 기기에서 되살아나지 않게 한다.

**Architecture:** D1 `deleted_accounts` 표식 + 삭제 로직 모듈 `worker/accountDelete.js` 하나를 사용자·관리자 경로가 같이 쓴다.
표식이 있는 코드의 계정·프로필·서재 요청은 410 을 받고, 관리자 삭제로 남은 계정 본체는 그 코드의 다음 요청 때 정리한다.
브라우저는 410(`error: 'account deleted'`)을 공통 함수 하나로 받아 로그아웃한다.

**Tech Stack:** Cloudflare Workers(ES modules), D1, R2, 브라우저 ES5 스크립트, Node 테스트 러너(`npm test`).

**Spec:** `docs/superpowers/specs/2026-10-16-account-delete-design.md`

## Global Constraints

- 지우는 것: 계정 본체 `user/<sha256('user-v2:'+code)>.json`, 소유 색인과 주인이 확인된 공개 서재, `profiles`·`profile_links` 행, 프로필 랭킹 줄(`game_scores`·`game_runs` 의 `player_hash = gameHashFor(profile_id)`).
- 남기는 것: `tag_votes`, `bumps` 행(연결 행이 사라져 익명), 브라우저 로컬 북마크.
- 표식 키: `owner_hash = sha256('profile:' + personalCode)` (= `profiles.owner_hash`). `deleted_by` 는 `'self' | 'admin'`, `pending` 1 = 계정 본체 미삭제.
- 410 응답 본문은 정확히 `{ error: 'account deleted' }`. 서재 GET 의 기존 410(숨김 서재, `{ error: 'hidden' }`)과 구분하려고 브라우저는 상태 코드가 아니라 `error` 값으로 판별한다.
- 표식 테이블이 없거나 D1 오류: 표식 검사는 "표식 없음", `/user/delete`·관리자 계정 삭제는 503.
- 브라우저 코드는 ES5(`var`, `function`), 새 문구는 `I18n.t` + `src/data/i18n/English.json`·`Japanese.json`. i18n 을 고치면 `python src/scripts/10_update_data_version.py`.
- 커밋은 사용자가 요청했을 때만, `main` 에만, 경로를 명시해 스테이징(`git add -A`/`.` 금지). 메시지는 한국어 컨벤션(`feat(account): …`).

## Review Focus

- 다른 기기가 삭제 직후 404 자동 재가입(`userData.js` `pushNow` 404 경로)을 타는 경우 — 가입이 410 이어야 하고 그 기기는 로그아웃돼야 한다. (Task 2 서버 테스트, Task 4 브라우저 테스트)
- 숨김 서재 GET 의 410 을 계정 삭제로 오인해 로그아웃시키는 경우 — `error` 가 `'account deleted'` 일 때만 로그아웃. (Task 4 테스트)
- 소유 색인(`owners/…`)에 남의 서재 코드가 섞인 경우 — `record.ownerHash` 가 맞지 않으면 지우지 않는다. (Task 1 테스트)
- 삭제 도중 실패 후 재시도 — 표식이 먼저 기록돼 있어 다시 부르면 나머지가 지워진다. (Task 1 테스트)
- 관리자가 지운 계정으로 다시 접속 — 410 과 함께 계정 본체가 지워지고 `pending = 0`. (Task 3 테스트)

---

### Task 1: 키 모듈, 표식 테이블, 삭제 모듈, `/user/delete`

**Files:**
- Create: `worker/accountKeys.js`, `worker/accountDelete.js`, `tests/account-delete.test.cjs`
- Modify: `worker/profile_schema.sql`(끝에 `deleted_accounts`), `worker/favoritesShareWorker.js`(키 함수 3개를 import 로 교체, `/user/delete` 라우트·핸들러), `src/_worker.js`(`API_EXACT_PATHS` 에 `'/user/delete'`)

**Interfaces:**
- Produces (`accountKeys.js`): `userStoreKey(personalCode) → Promise<string>`, `ownerIndexKey(personalCode) → Promise<string>`, `ownerHashFor(personalCode, code) → Promise<string>`, `profileOwnerHash(personalCode) → Promise<string>` (`sha256('profile:'+code)`). 공식은 `favoritesShareWorker.js` 의 기존 정의 그대로 옮긴다(로컬 `sha256Hex` 사본 사용 — 기존 파일들과 같은 패턴).
- Produces (`accountDelete.js`):
  - `checkDeleted(env, personalCode) → Promise<null | { pending: boolean }>` — D1 오류면 `null`.
  - `purgeByCode(env, personalCode, by) → Promise<void>` — `by` 는 `'self' | 'admin'`. 표식 테이블이 없으면 throw(호출자가 503).
  - `deleteLibraryRecord(env, code) → Promise<void>` — R2 `library/<code>.json` 삭제 + `updateLibraryIndex(env, code, null)` + `DELETE FROM library_hidden WHERE code = ?`(D1 오류 무시).
- Consumes: `gameHashFor` (`worker/profileApi.js`), `updateLibraryIndex` (`worker/libraryIndex.js`).

- [ ] **Step 1: 실패하는 테스트** — `tests/account-delete.test.cjs`, `profile-display.test.cjs` 의 `setupDisplay` 와 같은 env(모든 스키마 + `RL_*: allow`)를 쓰는 `setupAccount()`. 테스트:
  - `user delete removes account, profile, libraries and profile ranking rows` — 가입(`/user/signup`) → `/profile/save` → `/library` 게시(personalCode 포함) → 프로필로 게임 등록(`profile-display.test.cjs` 의 등록 헬퍼 흐름) → 태그 투표·끌올 → `POST /user/delete { personalCode }` 가 `200 {ok:true}`. 이후 단언: `user/<hash>` 키 없음, `owners/<hash>` 없음, `library/<code>.json` 없음, 공개 목록(`GET /library`)에 그 코드 없음, `profiles`·`profile_links`·`game_scores` 해당 행 0, `tag_votes`·`bumps` 행 남음, `/tags/voters` 결과 `profileIds: []`·`anonymous: 1`, `deleted_accounts` 행 `deleted_by='self'`·`pending=0`.
  - `user delete without profile works` — 가입만 한 계정 삭제가 200, 계정 본체 없음.
  - `user delete is idempotent` — 두 번째 호출도 200.
  - `user delete resumes after a partial failure` — `env.TAGS_DB.batch` 를 한 번만 throw 하게 감싼 뒤 첫 호출은 503, 표식 행은 `pending=1` 로 남아 있다. 감싼 것을 풀고 다시 호출하면 200 이고 모든 데이터가 지워진다.
  - `user delete keeps libraries it cannot prove ownership of` — 소유 색인에 남의 서재 코드를 직접 끼워 넣고 삭제 → 남의 `library/<code>.json` 은 남는다.
  - `user delete of unknown code is 404`, `user delete without deleted_accounts table is 503 and deletes nothing` (스키마에서 `deleted_accounts` 를 뺀 D1 — `profile_schema.sql` 을 빼고 `profiles` 없이 구성해도 된다).
- [ ] **Step 2: 실행해서 실패 확인** — `npm test` → 새 테스트가 404/모듈 없음으로 FAIL.
- [ ] **Step 3: 구현** — 스키마는 스펙 1절 SQL 그대로. `purgeByCode` 순서: ① `INSERT INTO deleted_accounts … ON CONFLICT(owner_hash) DO NOTHING`(`pending=1`) ② 소유 색인 코드마다 `record.ownerHash === await ownerHashFor(personalCode, code)` 일 때만 `deleteLibraryRecord`, 끝나면 소유 색인 삭제 ③ `profileOwnerHash` 로 프로필 행을 찾아 있으면 `profiles`·`profile_links`·`game_scores`·`game_runs` 를 한 batch 로 삭제 ④ 계정 본체 삭제 ⑤ `UPDATE deleted_accounts SET pending = 0`. `/user/delete` 핸들러: `readUserBody(request, env, env.RL_USER_SYNC)` → 계정 본체 head 도 표식도 없으면 404 → `purgeByCode(…, 'self')` 를 try/catch 로 감싸 실패 시 503 `account delete unavailable` → `{ ok: true }`.
- [ ] **Step 4: 통과 확인** — `npm test` → 전부 PASS(기존 147개 포함).
- [ ] **Step 5: 커밋**(요청 시) — `feat(account): 계정 삭제 API와 삭제 표식 추가`

### Task 2: 표식 검사(410)와 남은 데이터 정리

**Files:**
- Modify: `worker/favoritesShareWorker.js`(`deletedAccountResponse` 추가, `handleUserSignup`·`handleUserGet`·`handleUserSync`·`handleLibraryCreate`·`handleLibraryUpdate`·`handleLibraryClaimOwner` 에서 호출, `PROFILE_TOOLS` 에 추가), `worker/profileApi.js`(`handleMe`·`handleSave` 에서 `tools.deletedAccountResponse` 호출)
- Test: `tests/account-delete.test.cjs`

**Interfaces:**
- Consumes: `checkDeleted`, `purgeByCode` (Task 1).
- Produces: `deletedAccountResponse(request, env, personalCode) → Promise<Response | null>` — 표식 없으면 `null`. 표식이 있고 `pending` 이면 `purgeByCode(env, personalCode, 'admin')` 를 try/catch(실패해도 410)한 뒤 `jsonResponse(request, { error: 'account deleted' }, 410)`. `profileApi.js` 는 순환 import 를 피하려고 `tools.deletedAccountResponse` 로만 쓴다.

- [ ] **Step 1: 실패하는 테스트**
  - `deleted code is rejected everywhere` — 삭제 뒤 같은 코드로 `/user/signup`, `/user/get`, `PUT /user/sync`, `/profile/me`, `/profile/save`, `/library` 게시(personalCode 포함)가 모두 `410` 이고 본문 `error === 'account deleted'`. 특히 signup 뒤에도 `user/<hash>` 키가 생기지 않는다.
  - `deleted code can still vote anonymously` — 삭제한 코드의 `/tags/vote` 는 기존 동작(검사 없음)대로 처리된다(410 아님).
  - `guards are skipped when the table is missing` — `deleted_accounts` 가 없는 D1 에서 가입·로그인·동기화가 그대로 200.
- [ ] **Step 2: 실패 확인** — `npm test`.
- [ ] **Step 3: 구현** — 각 핸들러에서 `personalCode` 를 확인한 직후(계정 조회·쓰기 전) 호출. 서재 수정·소유 연결은 본문에 `personalCode` 가 있을 때만 검사(editToken 인증은 검사 없음).
- [ ] **Step 4: 통과 확인** — `npm test`.
- [ ] **Step 5: 커밋**(요청 시) — `feat(account): 삭제된 계정 코드의 요청을 410 으로 막기`

### Task 3: 관리자 계정 삭제

**Files:**
- Modify: `worker/accountDelete.js`(`purgeByProfile`), `worker/adminProfiles.js`(`POST /profiles/delete-account`, 상단 주석의 라우트 목록)
- Test: `tests/account-delete.test.cjs`(admin 은 `tests/admin-api.test.cjs` 의 `setupAdmin` 방식으로 `worker/adminApi.js` 를 함께 load)

**Interfaces:**
- Consumes: `deleteLibraryRecord`, `gameHashFor`, `readLibraryIndex` (`worker/libraryIndex.js`).
- Produces: `purgeByProfile(env, profileRow) → Promise<{ link: object|null, libraryCodes: string[] }>` — `profileRow` 는 `profiles` 전체 행. 표식(`deleted_by='admin'`, `pending=1`, `ON CONFLICT DO NOTHING`) → 연결 행 읽기 → `profiles`·`profile_links`·`game_scores`·`game_runs` batch 삭제 → `readLibraryIndex` 항목 중 `profileId === profileRow.profile_id` 인 코드마다 `deleteLibraryRecord`. 표식 테이블이 없으면 throw.

- [ ] **Step 1: 실패하는 테스트**
  - `admin delete-account removes profile-reachable data and leaves a pending mark` — 사용자 A: 가입·프로필·서재 게시·프로필 랭킹 등록. `api('POST', 'profiles/delete-account', { id })` → `{ok:true}`. 프로필·연결 행·랭킹 줄·서재 원본과 목록 항목 없음, 계정 본체는 아직 있음, 표식 `deleted_by='admin'`·`pending=1`, `admin_actions` 에 `action='profile.delete-account'` 행(detail 에 `before`·`link`·`libraryCodes`).
  - `next request from an admin-deleted code finishes the purge` — 이어서 A 코드로 `/user/get` → 410 `account deleted`, 계정 본체·소유 색인 없음, 표식 `pending=0`, `deleted_by` 는 여전히 `'admin'`.
  - `delete-account of unknown id is 404`, `delete-account without the marker table is 503`.
- [ ] **Step 2: 실패 확인** — `npm test`.
- [ ] **Step 3: 구현** — 핸들러는 기존 `handleDelete` 처럼 `readTarget` 으로 행을 읽고, `purgeByProfile` 을 try/catch(실패 503 `account delete unavailable`), 이어서 `logAction(env, session.actor, 'profile.delete-account', row.profile_id, { before: row, link, libraryCodes })` 를 실행(기록 실패 시 `{ ok: true, warning: … }`, `adminLibrary.js` 의 delete 와 같은 방식).
- [ ] **Step 4: 통과 확인** — `npm test`.
- [ ] **Step 5: 커밋**(요청 시) — `feat(admin): 프로필 탭에서 계정 삭제 추가`

### Task 4: 브라우저 410 공통 처리

**Files:**
- Modify: `src/js/core/userData.js`(`handleAccountDeleted`, `deleteAccount`, `messageForStatus` 의 410, 동기화·불러오기·로그인·404 재가입 경로), `src/js/components/profileStore.js`, `src/js/core/bookmarkLibrary.js`(게시·수정·소유 연결 응답)
- Test: `tests/account-delete-client.test.cjs`(`tests/profile-client.test.cjs` 의 vm·가짜 DOM·`storage()` 헬퍼 방식)

**Interfaces:**
- Produces (`window.UserData`):
  - `isAccountDeletedBody(data) → boolean` — `data && data.error === 'account deleted'`.
  - `handleAccountDeleted() → void` — `BookmarkLibrary.logout()` 후, 탭당 처음 한 번만 `global.alert(t('삭제된 계정이라 로그아웃됐어요.'))`.
  - `deleteAccount() → Promise<void>` — 현재 개인 코드로 `POST WORKER_BASE + '/user/delete'`. 200 이면 `BookmarkLibrary.logout()` 후 resolve. 실패면 `Error` 로 reject(메시지: 429 `t('요청이 너무 잦아요. 잠시 후 다시 시도해주세요.')`, 그 밖과 네트워크 `t('지금은 계정을 삭제할 수 없어요.')`).
- `messageForStatus(410)` → `t('삭제된 계정의 코드예요.')` — 로그인 창은 기존처럼 reject 메시지를 보여 주고 코드를 채택하지 않는다.

- [ ] **Step 1: 실패하는 테스트**
  - `handleAccountDeleted logs out and alerts once` — 두 번 불러도 `alert` 는 1회, 두 번 모두 뒤에 개인 코드가 지워진 상태.
  - `sync 410 account deleted logs out instead of re-signing up` — 가짜 fetch: `/user/sync` → `410 {error:'account deleted'}` → `/user/signup` 이 호출되지 않고 로그아웃.
  - `sync 404 then signup 410 logs out` — 404 재가입 경로에서 signup 이 410 이면 로그아웃.
  - `hidden library 410 does not log out` — `bookmarkLibrary` 요청이 `410 {error:'hidden'}` 이면 로그아웃하지 않는다.
  - `login with a deleted code fails with the deleted message` — `/user/get` → 410 이면 reject 메시지 `삭제된 계정의 코드예요.`, 개인 코드 저장 안 됨.
  - `deleteAccount logs out on success`.
- [ ] **Step 2: 실패 확인** — `npm test`.
- [ ] **Step 3: 구현** — 410 을 받는 각 지점에서 응답 본문을 읽어 `isAccountDeletedBody` 면 `UserData.handleAccountDeleted()` 를 부르고 진행 중 작업을 중단(`bookmarkLibrary.js`·`profileStore.js` 는 실행 시점에 `global.UserData` 를 찾는다 — 로드 순서 무관).
- [ ] **Step 4: 통과 확인** — `npm test`.
- [ ] **Step 5: 커밋**(요청 시) — `feat(account): 삭제된 계정 응답을 받으면 로그아웃`

### Task 5: 설정창 계정 삭제 패널과 관리 페이지 버튼

**Files:**
- Modify: `src/js/components/auth.js`(`renderLoggedIn` 로그아웃 아래), `src/css/components/settings-modal.css`(패널), `src/js/pages/adminPage.js`(프로필 탭 1077행 부근), `src/data/i18n/English.json`·`Japanese.json`, `src/js/config/cdnConfig.js`(스크립트로 `DATA_VERSION`)
- Test: `tests/account-delete-client.test.cjs`

**Interfaces:**
- Consumes: `UserData.deleteAccount()` (Task 4), 관리 API `POST profiles/delete-account { id }` (Task 3).

- [ ] **Step 1: 실패하는 테스트**
  - `delete button stays disabled until 삭제 is typed` — `auth.js` 계정 탭을 그린 뒤 "계정 삭제" → 패널의 영구 삭제 버튼 `disabled`, 입력값 `' 삭제 '` 의 input 이벤트 뒤 활성.
  - `successful delete re-renders the logged-out pane` — 가짜 `UserData.deleteAccount` resolve → 로그아웃 화면 + `계정을 삭제했어요.` 문구.
  - `failed delete shows the error in the panel and keeps it open`.
  - i18n 목록에 새 문구가 모두 있다: `계정 삭제`, `계정을 삭제하면 되돌릴 수 없어요.`, `지워지는 것: 서버에 저장된 북마크, 프로필, 공개한 서재, 프로필로 올린 랭킹 기록`, `남는 것: 태그 투표·끌올 신청(익명으로), 이 브라우저에 있는 북마크`, `계속하려면 아래에 '삭제'라고 입력해 주세요.`, `삭제`, `취소`, `영구 삭제`, `삭제하는 중…`, `계정을 삭제했어요.`, `지금은 계정을 삭제할 수 없어요.`, `삭제된 계정이라 로그아웃됐어요.`, `삭제된 계정의 코드예요.`
- [ ] **Step 2: 실패 확인** — `npm test`.
- [ ] **Step 3: 구현**
  - 패널: `settings-btn is-danger` "계정 삭제" → 아래에 패널 펼침(다시 누르거나 취소로 접힘). 입력값 `trim() === t('삭제')` 일 때만 영구 삭제 활성. 진행 중 버튼 잠금 + `삭제하는 중…`.
  - 관리 페이지: 기존 버튼 라벨을 `프로필 삭제` 로, 옆에 `계정 삭제` 버튼 — `dialog({ title: '계정 삭제', desc: '이 프로필의 계정을 삭제할까요? 프로필, 랭킹 기록, 프로필로 게시한 공개 서재가 바로 지워지고, 서버에 저장된 북마크는 그 사람이 다음에 접속할 때 지워져요. 되돌릴 수 없어요.', confirmLabel: '계정 삭제', danger: true, requireText: p.nickname })` → `run(btn, …, '계정을 삭제했어요.')`.
  - 번역 추가 후 `python src/scripts/10_update_data_version.py`.
- [ ] **Step 4: 통과 확인** — `npm test` 전부 PASS, `npm run build` 성공.
- [ ] **Step 5: 커밋**(요청 시) — `feat(account): 설정창과 관리 페이지에 계정 삭제 화면 추가`

### Task 6: 로컬 통합 확인

- [ ] `npm run build -- --loose` → 스크래치패드 `--persist-to` 로 `dist` wrangler dev, 로컬 D1 에 모든 스키마 적용, 임시 `dist/.dev.vars`(관리자 시크릿).
- [ ] 브라우저(라이트·다크): 가입 → 프로필 → 서재 게시 → 설정창에서 계정 삭제(입력 전 비활성 확인) → 로그아웃 화면. 두 번째 탭(같은 코드)에서 동기화 → "삭제된 계정이라 로그아웃됐어요". 다른 계정으로 관리 페이지 프로필 탭 → 계정 삭제 → 그 계정 탭에서 동기화 → 로그아웃.
- [ ] 정리: 서버 종료, `.dev.vars`·로컬 상태·테스트 자격 삭제.
- [ ] 배포 안내만 한다(실행 금지): `cd src && npx wrangler d1 execute cpkg-tags --remote --file=../worker/profile_schema.sql` 를 배포 전에 먼저.
