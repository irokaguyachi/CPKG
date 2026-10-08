# 유저 프로필 2단계(표시 연결) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로필을 만든 뒤의 공개 북마크·끌올·태그 투표·게임 랭킹 활동에 프로필 칩을 붙여 보여 준다.

**Architecture:** D1 `profile_links`(프로필 ID ↔ 투표·끌올·게임 해시 + `linked_at`)를 두고, 표시할 때
기존 활동 행을 이 테이블과 JOIN 하되 `활동 시각 >= linked_at` 인 것만 프로필로 본다. 기존 활동 테이블과
쓰기 코드는 바꾸지 않는다. 공개 북마크는 R2 기록·색인 메타데이터에 `profileId` 를 넣는다. 브라우저는
1단계의 `ProfileStore.fetchMany` 와 `ProfileCard` 를 쓴다.

**Tech Stack:** Cloudflare Workers + D1 + R2, 바닐라 JS(IIFE), Node 테스트 러너(`npm test`), `tests/helpers/workerHarness.cjs`.

**Spec:** `docs/superpowers/specs/2026-10-08-user-profile-display-design.md` (선행: `2026-10-07-user-profile-design.md`)

## Global Constraints

- `profile_links` 해시: `vote_hash = sha256('tagvote:' + code)`, `bump_hash = sha256('bump:' + code)`,
  `game_hash = sha256('spacegame-profile:' + profile_id)`, `linked_at = profiles.created_at`.
- 표시 조건: 활동 시각(`tag_votes.created_at`, `bumps.requested_at`) `>= linked_at`. 게임은 `player_hash = game_hash` 인 줄.
- 연결·프로필 조회가 실패하면 막지 않고 익명(`null`)으로 처리한다. 투표·끌올·게시·랭킹 등록 자체는 그대로 동작해야 한다.
- 투표자 목록: 최근 순 최대 50 프로필, 나머지는 `anonymous`.
- 게임 직접 입력 닉네임 1~12자. 남의 프로필 닉네임(`profiles.nickname_key`)과 같으면 `nickname taken`.
- 새 API 경로는 `src/_worker.js` `API_EXACT_PATHS` 에 추가한다.
- 새 UI 문구는 `I18n.t` + `src/data/i18n/English.json`·`Japanese.json`. 관리 페이지 문구는 번역하지 않는다.
- 커밋: 한국어 `type(scope): 제목` + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, 경로 명시 스테이징, 푸시 안 함.
- JS 정규식에 `\u` 이스케이프가 필요한 줄은 Write 도구 대신 python/Edit 로 넣는다(1단계 Task 1 Ruling).

## Review Focus

1. 프로필을 지웠다가 다시 만든 사람의 이전 표·끌올이 새 프로필로 표시되면 안 된다(`linked_at` 갱신).
2. 같은 사람이 브라우저 줄과 프로필 줄을 둘 다 가진 랭킹에서 순위표에 같은 사람이 두 번 나오는 것은 허용하되, "내 순위"는 개인 코드가 오면 프로필 줄을 쓴다.
3. `profiles`·`profile_links` 테이블이 없는 환경(스키마 미적용)에서 게임 등록·투표·끌올·게시가 503 이 되면 안 된다.
4. 북마크 수정 때 남의 개인 코드를 보내 편집 토큰으로 인증된 경우 `profileId` 가 바뀌면 안 된다.
5. 관리자가 프로필 랭킹 줄을 차단하면 그 프로필은 다른 기기(다른 playerId)에서도 등록이 막혀야 한다.

---

### Task 1: 연결 테이블과 생성·채우기·삭제

**Files:**
- Modify: `worker/profile_schema.sql`(끝에 `profile_links` DDL과 인덱스 3개), `worker/profileApi.js`, `worker/adminProfiles.js`
- Test: `tests/profile-api.test.cjs`, `tests/admin-api.test.cjs`

**Interfaces:**
- Produces (`profileApi.js`):
  - `export function gameHashFor(profileId) -> Promise<string>`
  - `export async function profileLinkForCode(env, personalCode) -> { profileId, linkedAt, gameHash } | null`(실패 시 null)
  - `export async function profileIdByNicknameKey(env, key) -> string|null`(실패 시 null)
  - 내부: `linkStatement(env, row, personalCode)` = `INSERT OR IGNORE INTO profile_links ... VALUES (...)`
- `/profile/save` 생성 batch 에 연결 INSERT, `/profile/me`·`/profile/save`(기존 프로필) 때 `INSERT OR IGNORE`(linked_at = created_at).
  `/profile/delete` 와 관리자 삭제는 같은 batch 로 연결 행 삭제. 관리자 삭제 detail 에 `link` 추가.

- [ ] **Step 1: 실패하는 테스트**
  - `profile creation writes a link row`: 생성 뒤 `profile_links` 1행, `vote_hash = hash('tagvote:'+code)`, `bump_hash = hash('bump:'+code)`, `game_hash = hash('spacegame-profile:'+id)`, `linked_at` = 생성 시각.
  - `me backfills a missing link for stage-1 profiles`: 연결 행을 D1 에서 지운 뒤 `/profile/me` → 행이 다시 생기고 `linked_at = created_at`(clock 을 옮긴 뒤 호출해도 생성 시각).
  - `deleting a profile removes its link`: 본인 삭제 뒤 0행.
  - (admin) `admin delete removes the link and logs it`: 관리자 삭제 뒤 0행, detail.link.vote_hash 존재.
  - `profileLinkForCode and profileIdByNicknameKey`: 값 확인, 없는 코드·키는 null, `profile_links` 테이블 없는 D1 에서 null(throw 없음).
- [ ] **Step 2: 실행해서 실패 확인** — `npm test` → 새 테스트 FAIL.
- [ ] **Step 3: 구현** — `ADMIN` 삭제는 `DELETE FROM profile_links WHERE profile_id = ?` 를 batch 에 추가.
- [ ] **Step 4: 통과 확인** — `npm test` 전부 PASS.
- [ ] **Step 5: 커밋** — `feat(profile): 프로필과 활동 해시를 잇는 연결 테이블 추가`

### Task 2: 태그 투표자 API와 끌올 신청자

**Files:**
- Modify: `worker/favoritesShareWorker.js`(`handleTagsVoters` 새 핸들러와 route, `handleBumpGet`·`bumpPublicRow`), `src/_worker.js`(`'/tags/voters'`)
- Test: `tests/profile-display.test.cjs`(새 파일, `setupDisplay()` 하네스: tags·bump·admin·profile 스키마, ASSETS 에 UserTagCatalog·ProfileIcons)

**Interfaces:**
- `POST /tags/voters {postId, tagName}` → `{ profileIds: string[], anonymous: number }`. 제한기 `RL_LIB_LIST`.
  SQL: `SELECT l.profile_id FROM tag_votes v JOIN profile_links l ON l.vote_hash = v.voter_hash AND v.created_at >= l.linked_at WHERE v.post_id = ? AND v.tag_name = ? ORDER BY v.created_at DESC LIMIT 50` + 전체 `COUNT(*)`. 연결 조회 실패 시 `{ profileIds: [], anonymous: total }`, 전체 실패 시 `{ profileIds: [], anonymous: 0 }`.
- `/bump/get` 의 `active.requesterProfileId: string|null`(연결 조회는 별도 try, 실패 시 null).

- [ ] **Step 1: 실패하는 테스트**
  - `voters lists profiles only for votes after the profile existed`: 계정 A 가 투표 → 프로필 생성 → 다른 작품에 투표 / 계정 B 는 프로필 생성 뒤 투표. 첫 작품 태그: `profileIds = []`, `anonymous = 1`. B 작품: `[idB]`.
  - `recreated profiles do not claim older votes`: 생성 → 투표 → 삭제 → 재생성 → 투표 결과가 익명 1 + 새 id 0(이전 표) 확인.
  - `voters survive an admin tag rename`: 관리 API 로 태그 이름 바꾸기 뒤 새 이름으로 조회해도 id 유지.
  - `voters caps profile ids at fifty`: 프로필 55명이 투표 → `profileIds.length === 50`, `anonymous === 5`.
  - `voters works without link tables`: profile 스키마 없이 → `{ profileIds: [], anonymous: n }` 200.
  - `bump get reports the requester profile`: 프로필 생성 뒤 끌올 신청 → `active.requesterProfileId === id`; 생성 전 신청이면 null; 스키마 없으면 null 이고 200.
  - `tags/voters route is exposed by the site worker`(`_worker.js` 문자열 확인).
- [ ] **Step 2: 실패 확인** — `npm test`.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인** — `npm test`.
- [ ] **Step 5: 커밋** — `feat(profile): 태그 투표자 목록 API와 끌올 신청자 프로필 추가`

### Task 3: 공개 북마크 profileId

**Files:**
- Modify: `worker/favoritesShareWorker.js`(`handleLibraryCreate`, `handleLibraryUpdate`, `libraryPublicView`, put 의 `customMetadata`), `worker/libraryIndex.js`(`metadataRow`, `updateLibraryIndex` 줄에 `profileId`)
- Test: `tests/profile-display.test.cjs`

**Interfaces:**
- 기록 `record.profileId: string|null`, customMetadata `profileId`(없으면 빈 문자열), 색인 줄·공개 응답 `profileId: string|null`.
- 수정: `clean.personalCode` 가 있고 `ownerHashFor(personalCode, code) === record.ownerHash` 일 때만 `record.profileId = await profileIdForCode(...)`(없으면 null). 편집 토큰만 맞고 코드가 주인이 아니면 그대로 둔다.

- [ ] **Step 1: 실패하는 테스트**
  - `publishing with a profile stores profileId`: 프로필 있는 계정으로 게시 → 응답·`GET /library/<code>`·`GET /library` 목록 줄의 `profileId === id`. 프로필 없는 계정·코드 없이 게시 → `null`.
  - `owner edits refresh profileId but strangers cannot`: 게시 뒤 프로필 생성 → 편집 토큰 + 주인 코드로 PUT → `profileId` 생김. 편집 토큰 + 다른 계정(프로필 있음) 코드로 PUT → 바뀌지 않음.
  - `index rebuild keeps profileId`: `refreshLibraryIndex` 뒤 목록 줄에 `profileId` 유지.
- [ ] **Step 2~4**: 실패 확인 → 구현 → `npm test` PASS.
- [ ] **Step 5: 커밋** — `feat(profile): 공개 북마크에 만든 사람 프로필 연결`

### Task 4: 게임 랭킹 서버

**Files:**
- Modify: `worker/favoritesShareWorker.js`(`GAME_NICKNAME_MAX = 12`, `handleGameSubmit`, `readGameRanking`, `handleGameRanking`, `gameSubmitBlocked`), `worker/adminGame.js`(`handleScores` 에 `profileId`, `handleRename` 은 프로필 줄이면 400 `profile row`)
- Test: `tests/profile-display.test.cjs`, `tests/game-ranking.test.cjs`

**Interfaces:**
- `/game/submit` 본문에 선택 `personalCode`. 프로필 있으면 `player_hash = link.gameHash`, `nickname = profile.nickname`, 닉네임 검사·게임 닉네임 중복 검사 생략. 차단은 `[browserHash, gameHash]` 둘 다.
- `/game/ranking` 본문에 선택 `personalCode`; 응답 줄 `{ rank, nickname, scoreMs, profileId }`, `me` 는 프로필 줄 우선.
- 직접 입력: `cleanNickname(raw, 12)`, `profileIdByNicknameKey(env, nicknameKey(nickname))` 가 있으면 409 `nickname taken`.

- [ ] **Step 1: 실패하는 테스트**
  - `profile submissions merge across devices`: 같은 계정이 playerId 두 개로 각각 등록 → 전체 순위에 그 프로필 줄 1개, 높은 점수, `profileId === id`, `nickname` = 프로필 닉네임(본문 nickname 무시).
  - `typed nicknames cannot copy a profile nickname`: 프로필 `Kaguya` 가 있으면 비로그인 `kaguya` 등록 → 409 `nickname taken`.
  - `typed nicknames allow twelve characters`: 12자 200, 13자 400 `invalid nickname`.
  - `banning a profile row blocks every device`: 관리 API 로 프로필 줄 `player_hash` 차단 → 다른 playerId + 같은 계정 등록 → 400 `invalid nickname`.
  - `ranking me prefers the profile row`: 브라우저 줄과 프로필 줄이 있을 때 `personalCode` 와 함께 조회하면 `me.all.scoreMs` 가 프로필 줄 점수.
  - `game works without profile tables`: profile 스키마 없는 D1 에서 personalCode 와 함께 등록해도 200(직접 닉네임 사용).
  - (admin) `admin scores mark profile rows and refuse renaming them`: `items[].profileId` 존재, rename → 400.
  - `tests/game-ranking.test.cjs:184` 의 `'ABCDEFGHIJK'`(11자) 를 13자 `'ABCDEFGHIJKLM'` 로 바꾼다(Ruling: 12자로 늘린 스펙에 맞춤).
- [ ] **Step 2~4**: 실패 확인 → 구현 → `npm test` PASS.
- [ ] **Step 5: 커밋** — `feat(game): 프로필로 랭킹에 등록하고 사칭 닉네임 막기`

### Task 5: 브라우저 — 공개 북마크·끌올·태그 투표자

**Files:**
- Modify: `src/js/components/profileCard.js`(`voterList`, `nameCell`), `src/js/core/bookmarkLibrary.js`(게시·수정 본문에 로그인 시 `personalCode`), `src/js/pages/bookmarksPage.js`(`renderLibraryList`·`renderLibraryDetail` 칩), `src/js/pages/mainPage.js`(끌올 배너 "끌올: [칩]"), `src/js/components/postDetailSeries.js`(피커 줄 "n표" 버튼 → 투표자 펼치기, `POST /tags/voters`), `src/css/components/profile.css`, i18n 두 파일
- Test: `tests/profile-client.test.cjs`

**Interfaces:**
- `ProfileCard.voterList(profileIds, anonymous, profiles, catalog) -> HTMLElement`(`div.profile-voters`: 조회된 프로필은 badge, null 은 익명 수에 더함, 익명 > 0 이면 `t('익명 {n}명')`)
- `ProfileCard.nameCell(profile, fallbackText, catalog) -> HTMLElement`(profile 있으면 badge, 없으면 `span` 글자) — 랭킹(Task 6)도 쓴다.
- 확인: 북마크·끌올 페이지는 `profileStore.js`·`profileCard.js` 를 이미 싣는다(1단계 Task 4).

- [ ] **Step 1: 실패하는 테스트**
  - `voterList shows badges and anonymous count`: ids `[a, gone]`, anonymous 2, profiles `{a: P, gone: null}` → 칩 1개, 텍스트에 `익명 3명`.
  - `voterList without anyone says no voters`: `([], 0)` → `t('아직 투표한 사람이 없어요')`.
  - `nameCell falls back to text`: null → `SPAN` 텍스트 fallback, profile → `BUTTON.profile-badge`.
  - i18n 테스트 목록에 `익명 {n}명`, `아직 투표한 사람이 없어요`, `끌올`, `만든 사람` 추가.
- [ ] **Step 2~4**: 실패 확인 → 구현 → `npm test` PASS.
- [ ] **Step 5: 커밋** — `feat(profile): 공개 북마크·끌올·태그 투표자에 프로필 표시`

### Task 6: 브라우저 — 게임 랭킹과 관리 랭킹 탭

**Files:**
- Modify: `src/js/components/spaceRanking.js`(순위 줄 `nameCell`, 등록 창 프로필 분기, `NICKNAME_MAX = 12`, 오류 문구, 조회·등록 본문 `personalCode`), `src/js/pages/adminPage.js`(랭킹 탭 "프로필" 배지, 프로필 줄 rename 버튼 대신 안내), i18n 두 파일, 게임 페이지 HTML 이 프로필 스크립트를 싣는지 확인(없으면 추가)
- Test: `tests/profile-client.test.cjs`(i18n 목록에 `내 프로필로 등록`, `이미 쓰이고 있는 닉네임이에요(다른 사람의 프로필 닉네임 포함)`, `닉네임은 1~12자로 입력해 주세요`)

- [ ] **Step 1: 실패하는 테스트**(i18n 목록 추가) → **Step 2** 실패 확인 → **Step 3** 구현 → **Step 4** `npm test` PASS, `npm run build` 성공.
- [ ] **Step 5: 커밋** — `feat(game): 랭킹에 프로필 칩과 프로필 등록 추가`

### Task 7: 로컬 통합 확인

- [ ] `npm run build -- --loose` → 스크래치패드 `--persist-to` 로 `dist` wrangler dev, 로컬 D1 에 모든 스키마 적용, 임시 `dist/.dev.vars`.
- [ ] 브라우저: 프로필 계정으로 북마크 게시 → 공개 서재 목록·상세 칩, 끌올 신청 → 메인 배너 칩, 태그 투표 → 피커 "n표" 펼치기, 게임 등록(프로필·비로그인), 관리 랭킹 배지. 라이트·다크.
- [ ] 정리: 서버 종료, `.dev.vars`·상태·테스트 자격 삭제, 탭 닫기.
- [ ] 1·2단계 합친 최종 리뷰(review-package `076efde..HEAD`).
