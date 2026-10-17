# 프로필 스탯과 레벨 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로필이 있는 유저의 본 문학·저장·태그 투표·끌올 수를 D1 에 쌓고, 그 숫자와 계산한 레벨을 프로필 카드에 공개한다.

**Architecture:** 새 D1 표 `profile_activity` 에 본 문학·저장·끌올을 (프로필, 종류, 작품) 단위로 한 번씩만 기록하고, 태그 투표는 기존 `tag_votes` 에서 센다. 서버(`worker/profileStats.js`)는 숫자 네 개만 돌려주고, 레벨은 브라우저 `src/js/core/profileLevel.js` 가 계산한다. 기록은 상세 창 열기(`/profile/view`), 북마크 동기화, 끌올 신청에 붙는다.

**Tech Stack:** Cloudflare Workers(ES 모듈), D1(SQLite), 브라우저 바닐라 JS(IIFE + `window` 전역), `node:test` + `node:sqlite` 하네스.

**Spec:** `docs/superpowers/specs/2026-10-17-profile-stats-level-design.md`

## Global Constraints

- 커밋·푸시는 사용자가 요청할 때만, `main` 에만. 각 작업은 커밋하지 않고 작업 트리에 남긴다(검토는 스냅숏 diff).
- `git add -A`/`git add .` 금지. `wrangler deploy`/`npm run deploy*` 실행 금지.
- 경험치: `xp = viewed*1 + saved*2 + voted*3 + bumped*5`. 레벨 L 시작 경험치 `5*L*(L-1)`, 상한 없음.
- 하루 한도: 본 문학·저장 각각 KST 하루 200개(새로 들어간 행 기준). KST 하루 시작 = `Math.floor((now + 9*3600000) / 86400000) * 86400000 - 9*3600000`.
- 작품 키: `'<type>:<id>'`, `type` ∈ `LIBRARY_ITEM_TYPES`(`novel/translation/series/hof/official`), `id` 는 0 이상 정수이며 `Lookup.json` 에 있어야 한다. 끌올 키: `String(bumps.id)`.
- 기록 실패(표 없음·D1 오류)는 원래 요청(동기화·끌올·상세 창)의 결과를 바꾸지 않는다.
- 새 문구는 `I18n.t` + `src/data/i18n/English.json`·`Japanese.json`. i18n 을 고치면 `python src/scripts/10_update_data_version.py`.
- 색은 `profile.css` 의 `--card-*` 변수와 `--profile-color`. 라이트·다크 모두 확인.
- 엣지 전용 파일(`worker/*.js`)은 난독화 대상이 아니다. `src/js/**` 는 `npm run build`(엄격) 를 통과해야 한다.

## Review Focus

1. 한 번의 동기화로 새 작품이 200개를 넘게 들어올 때 — 그날은 200개만 세고, 다음 날 동기화에서 나머지가 이어서 들어와야 한다(Task 1 테스트 `recordSaves caps a day at 200 and continues the next day`).
2. 북마크에서 지웠다가 다시 넣은 작품 — `saved` 가 그대로여야 한다(Task 3 테스트 `saved never decreases and re-adding does not count twice`).
3. `profile_links` 행이 없는 프로필(1단계에서 만들고 `/profile/me` 를 아직 안 부른 경우) — 스탯 조회가 오류 없이 `voted: 0, bumped: 0` 이어야 한다(Task 1 테스트 `readStats without a link row counts votes as 0`).
4. `stats_schema.sql` 을 적용하지 않은 D1 — 동기화 200, 끌올 201, 프로필 삭제 200 이 그대로여야 하고 스탯 API 만 503 이어야 한다(Task 3 테스트 `missing stats table never breaks sync, bump or profile delete`).
5. 로그아웃 상태나 프로필이 없는 상태에서 상세 창을 열 때 — 서버로 아무 요청도 보내지 않아야 한다(Task 4 테스트 `noteView sends nothing without a login or a profile`).

---

### Task 1: D1 스키마와 기록·조회 모듈

**Files:**
- Create: `worker/stats_schema.sql`, `worker/profileStats.js`
- Modify: `tests/helpers/profileSetup.cjs` (`ALL_SCHEMAS` 끝에 `'stats_schema.sql'` 추가 — `profile_schema.sql` 뒤여야 옮겨 담기 SQL 이 `profile_links` 를 찾는다)
- Test: `tests/profile-stats.test.cjs` (새 파일)

**Interfaces:**
- Produces (모두 `worker/profileStats.js` 의 export):
  - `STATS_DAILY_LIMIT = 200`
  - `kstDayStart(now: number) -> number`
  - `itemKey(type, id) -> string | null` — 형식(타입·정수)만 검사, 틀리면 `null`
  - `profileIdForCode(env, personalCode) -> Promise<string|null>` — `sha256('profile:' + code)` 로 `profiles.profile_id`
  - `recordView(env, profileId, key, now) -> Promise<boolean>` — 새로 들어갔으면 `true`
  - `recordSaves(env, profileId, keys: string[], now) -> Promise<number>` — 새로 들어간 수, 쿼리 1개
  - `recordBump(env, personalCode, bumpId, now) -> Promise<void>` — 프로필이 없으면 아무것도 안 함
  - `readStats(env, profileId) -> Promise<{viewed, saved, voted, bumped}>` — 쿼리 1개
  - `deleteActivityStatement(env, profileId) -> D1PreparedStatement` — `DELETE FROM profile_activity WHERE profile_id = ?`
  - `deleteBumpStatement(env, bumpId) -> D1PreparedStatement` — `DELETE FROM profile_activity WHERE kind = 'bump' AND item_key = ?`

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/profile-stats.test.cjs`. `load('worker/profileStats.js')` 와 `new D1(ALL_SCHEMAS)` 로 모듈을 직접 부른다. 프로필 행은 `setupDisplay().makeProfile` 로 만든다.

```js
test('recordView counts each work once', async () => {
  // 같은 키 두 번 → 두 번째는 false, readStats.viewed === 1
});
test('recordView caps a KST day at 200', async () => {
  // 서로 다른 키 201개 → 201번째 false. clock 을 KST 다음 날 00:00 으로 옮기면 다시 true
});
test('recordSaves caps a day at 200 and continues the next day', async () => {
  // 키 250개 → 200 반환, saved 200. 다음 날 같은 250개 → 50 반환, saved 250
});
test('recordSaves ignores keys already saved when counting the limit', async () => {
  // 150개 저장 → 같은 150개 + 새 60개 → 60 반환(이미 있는 150은 한도에 안 셈)
});
test('readStats counts votes after linked_at only', async () => {
  // 프로필 전 투표 1, /profile/me 로 연결 뒤 다른 게시물 투표 2(같은 게시물 다른 태그 1 포함) → voted 2
});
test('readStats without a link row counts votes as 0', async () => {
  // profile_links 행을 지운 프로필 → { viewed:0, saved:0, voted:0, bumped:0 }
});
test('recordBump records only for accounts with a profile', async () => {
  // 프로필 없는 코드 → 행 없음. 있는 코드 → kind 'bump', item_key '17'
});
test('stats schema backfills current bumps after linked_at, skipping cancelled ones', async () => {
  // profile_schema 까지 적용한 D1 에 bumps 3행(연결 전 1, 연결 뒤 2 중 하나는 bump_cancels) 넣고
  // stats_schema.sql 을 exec → bump 행 1개. 한 번 더 exec 해도 1개
});
```

- [ ] **Step 2: 실패 확인** — Run: `node --test tests/profile-stats.test.cjs` / Expected: FAIL (`worker/profileStats.js` 없음)

- [ ] **Step 3: `worker/stats_schema.sql` 작성** — 스펙 2절의 SQL 그대로(`profile_activity` WITHOUT ROWID, `idx_tag_votes_voter`, 끌올 옮겨 담기). 맨 위에 다른 스키마 파일처럼 적용 명령 주석.

- [ ] **Step 4: `worker/profileStats.js` 구현** — 위 Interfaces 의 시그니처. `recordSaves` 는 키를 JSON 문자열 하나로 넘기는 아래 문장 하나로 한다(한도 계산이 SQL 안에 있어야 쿼리 1개가 된다).

```sql
INSERT OR IGNORE INTO profile_activity (profile_id, kind, item_key, at)
SELECT ?1, 'save', j.value, ?2 FROM json_each(?3) j
WHERE NOT EXISTS (SELECT 1 FROM profile_activity a
                  WHERE a.profile_id = ?1 AND a.kind = 'save' AND a.item_key = j.value)
LIMIT max(0, ?5 - (SELECT COUNT(*) FROM profile_activity
                   WHERE profile_id = ?1 AND kind = 'save' AND at >= ?4))
```
`recordView` 도 같은 모양(`SELECT ... WHERE (오늘 view 수) < ?` + `INSERT OR IGNORE`). 키 목록은 중복을 없앤 뒤 넘긴다. `readStats` 의 `voted` 는 `COUNT(DISTINCT post_id) FROM tag_votes WHERE voter_hash = (SELECT vote_hash FROM profile_links WHERE profile_id = ?) AND created_at >= (SELECT linked_at ...)` — 연결 행이 없으면 NULL 비교라 0 이 된다. `bumped` 는 `profile_activity` 의 `kind = 'bump'` 수.

- [ ] **Step 5: 통과 확인** — Run: `node --test tests/profile-stats.test.cjs` / Expected: PASS. 이어서 `npm test` 전부 PASS(`ALL_SCHEMAS` 변경이 기존 테스트를 깨지 않는지).

---

### Task 2: `/profile/view` 와 `/profile/stats` API

**Files:**
- Modify: `worker/profileStats.js` (핸들러 추가), `worker/favoritesShareWorker.js` (라우터, `PROFILE_TOOLS` 옆에 `STATS_TOOLS`), `src/_worker.js:49` (`API_EXACT_PATHS` 에 두 경로)
- Test: `tests/profile-stats.test.cjs`

**Interfaces:**
- Consumes: Task 1 의 `itemKey`, `profileIdForCode`, `recordView`, `readStats`
- Produces:
  - `STATS_PATHS = ['/profile/view', '/profile/stats']`
  - `handleStatsRequest(request, env, tools) -> Promise<Response>` — `tools` 는 `{ jsonResponse, checkLimit, clientIp, readJsonBody, cleanPersonalCode, itemExists }`, `itemExists(request, env, type, id) -> Promise<boolean>` 는 기존 `bumpItemExists` 를 그대로 넘긴다.
  - `POST /profile/view { personalCode, type, id }` → 200 `{ ok: true, counted: boolean }` / 400 `invalid payload shape`(형식) / 400 `unknown post`(Lookup 에 없음) / 429 / 503 `stats unavailable`. 제한기 `env.RL_TAG_WRITE`. 프로필이 없으면 `counted: false`.
  - `GET /profile/stats?id=<12자 프로필 ID>` → 200 `{ viewed, saved, voted, bumped }` + `Cache-Control: public, max-age=60` / 400(형식) / 404 `profile not found` / 429 / 503. 제한기 `env.RL_LIB_LIST`.
- 라우터에서 `STATS_PATHS` 검사는 `PROFILE_PATHS` 검사 **앞**에 둔다(두 목록이 겹치지 않지만 `/profile/*` 를 한곳에서 보게).

- [ ] **Step 1: 실패하는 테스트 작성** — `setupDisplay().send` 로 실제 라우터를 탄다.

```js
test('POST /profile/view counts once and reports counted', async () => {
  // 첫 호출 { ok:true, counted:true }, 같은 작품 두 번째 counted:false, GET /profile/stats viewed 1
});
test('POST /profile/view rejects bad shapes and unknown posts', async () => {
  // type 'poem' → 400 invalid payload shape, id 1.5 → 400, id 999(Lookup 에 없음) → 400 unknown post
});
test('POST /profile/view without a profile is a no-op', async () => {
  // 계정만 있는 코드 → 200 counted:false, profile_activity 행 없음
});
test('GET /profile/stats returns four numbers with a 60s public cache', async () => {
  // 200, Object.keys === ['viewed','saved','voted','bumped'], Cache-Control 'public, max-age=60'
});
test('GET /profile/stats: bad id 400, unknown id 404, missing table 503', async () => {
  // setupDisplay(BASE_SCHEMAS + profile_schema) 로 표 없는 D1 → 503 stats unavailable
});
test('both paths are listed in API_EXACT_PATHS', () => {
  // src/_worker.js 원문에 '/profile/view', '/profile/stats' 포함
});
```

- [ ] **Step 2: 실패 확인** — Run: `node --test tests/profile-stats.test.cjs` / Expected: 새 테스트 FAIL (404 not found)

- [ ] **Step 3: 핸들러·라우터·`API_EXACT_PATHS` 구현** — 핸들러 전체를 try/catch 로 감싸 D1 오류는 503 `stats unavailable`(profileApi.js 의 `handleProfileRequest` 와 같은 모양). 본문 상한 512바이트.

- [ ] **Step 4: 통과 확인** — Run: `node --test tests/profile-stats.test.cjs` 후 `npm test` / Expected: 전부 PASS

---

### Task 3: 기존 경로에 기록·삭제 붙이기

**Files:**
- Modify: `worker/favoritesShareWorker.js` (`handleUserSync` 성공 직후, `handleBumpRequest` 201 직전), `worker/adminBumps.js` (`handleCancel` 두 batch), `worker/profileApi.js` (`handleDelete`), `worker/adminProfiles.js` (`handleDelete`), `worker/accountDelete.js` (`deleteProfileRows`, `purgeByProfile` 이 프로필 행을 지우는 batch)
- Test: `tests/profile-stats.test.cjs`

**Interfaces:**
- Consumes: Task 1 의 `profileIdForCode`, `recordSaves`, `recordBump`, `itemKey`, `deleteActivityStatement`, `deleteBumpStatement`
- 동기화: R2 쓰기가 성공한 뒤, 응답 전에 `try { ... } catch (e) {}` 안에서 새 `data.bookmarks[].items` 의 키를 모아 `Lookup.json` 에 있는 것만 남겨 `recordSaves`. `fetch(request, env)` 에 `ctx` 가 없으므로 `await` 한다(쿼리 2개: 프로필 조회 + 넣기).
- 끌올: 삽입이 성공한 경우에만 방금 넣은 행 id 를 `SELECT id FROM bumps WHERE requester_hash = ? AND requested_at = ?` 로 찾아 `recordBump`. try/catch.
- 삭제 batch: 표가 없을 수 있으므로 `profile_activity` DELETE 는 기존 batch 에 넣지 말고 batch 뒤에 따로 실행하고 `no such table` 이면 무시한다(`accountDelete.js` 의 `deleteLoginId` 와 같은 방식). 그 밖의 D1 오류는 기존 경로의 오류 처리를 따른다.
- 관리자 끌올 취소: 대기·활성 두 경우 모두 batch 뒤에 같은 방식으로 `deleteBumpStatement(env, id)` 실행.

- [ ] **Step 1: 실패하는 테스트 작성**

```js
test('sync records saved works once and only known works', async () => {
  // 북마크에 novel 123, 456, 999(Lookup 에 없음) → saved 2. 같은 내용 다시 sync → saved 2
});
test('saved never decreases and re-adding does not count twice', async () => {
  // 123 빼고 sync → saved 2, 다시 넣고 sync → saved 2
});
test('sync without a profile records nothing', async () => {});
test('a bump after the profile counts; admin cancel removes it', async () => {
  // /bump/request 201 → bumped 1. 관리자 POST bumps/cancel(adminSetup 사용) → bumped 0
});
test('profile delete, account delete and admin account delete remove activity rows', async () => {
  // 세 경로 각각 뒤 SELECT COUNT(*) FROM profile_activity WHERE profile_id = ? → 0
});
test('missing stats table never breaks sync, bump or profile delete', async () => {
  // stats_schema 없는 D1: sync 200, bump 201, /profile/delete 200, /user/delete 200
});
```

- [ ] **Step 2: 실패 확인** — Run: `node --test tests/profile-stats.test.cjs` / Expected: 새 테스트 FAIL

- [ ] **Step 3: 구현** — 위 Interfaces 대로. 기존 응답 본문·상태 코드는 바꾸지 않는다.

- [ ] **Step 4: 통과 확인** — Run: `npm test` / Expected: 전부 PASS (특히 `account-delete*`, `login-code-sweep`, `admin-api` 회귀 없음)

---

### Task 4: 브라우저 레벨 공식과 본 문학 기록

**Files:**
- Create: `src/js/core/profileLevel.js`, `src/js/components/profileStats.js`
- Modify: `src/js/components/postDetailSeries.js` (`open(data)` 시작부, 성인 차단 분기 뒤), `profileCard.js` 를 싣는 모든 `src/page/*.html` (`profileCard.js` 바로 앞에 `../js/core/profileLevel.js`, `../js/components/profileStats.js`), `postDetailSeries.js` 를 싣지만 `profileCard.js` 가 없는 페이지가 있으면 그 페이지에도
- Test: `tests/profile-stats-client.test.cjs` (새 파일, `tests/profile-client.test.cjs` 의 vm·fakeElement 방식)

**Interfaces:**
- Produces:
  - `window.ProfileLevel.xp(stats) -> number`, `window.ProfileLevel.fromStats(stats) -> { level, xp, levelStart, nextStart }` (음수·비숫자는 0)
  - `window.ProfileStats.noteView(type: string, id: number) -> void` — `BookmarkLibrary.getPersonalCode()` 와 `ProfileStore.mine()` 이 모두 있을 때만 `POST /profile/view`. 보낸 키는 `localStorage['chokaguya_profile_views:' + codeTag]` (JSON 배열, 최근 2000개) 에 남겨 다시 보내지 않는다. `codeTag` 는 profileStore.js 와 같은 방식(코드 전체를 남기지 않음). 모든 storage 접근 try/catch, 실패는 조용히.
  - `window.ProfileStats.fetch(profileId) -> Promise<{viewed,saved,voted,bumped} | null>` — `GET /profile/stats`, 실패면 `null`, 같은 ID 60초 메모리 캐시.
- `postDetailSeries.open`: `data.favType` 과 `data.postId != null` 이 있을 때 `ProfileStats.noteView(data.favType, data.postId)`. 성인 차단으로 막힌 경우는 기록하지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성**

```js
test('ProfileLevel boundaries', () => {
  // xp 0→Lv1, 9→Lv1, 10→Lv2, 29→Lv2, 30→Lv3, 299→Lv8 { levelStart:280, nextStart:360 }
  // xp({viewed:130,saved:42,voted:20,bumped:5}) === 299, xp({viewed:-3, saved:'x'}) === 0
});
test('noteView posts once per work and remembers it', async () => {
  // 같은 (novel,123) 두 번 → fetch 1번, body { personalCode, type:'novel', id:123 }
});
test('noteView sends nothing without a login or a profile', () => {
  // getPersonalCode null → fetch 0번, mine() null → fetch 0번
});
test('noteView still works when localStorage throws', () => {});
test('fetch caches for 60s and returns null on failure', async () => {});
```

- [ ] **Step 2: 실패 확인** — Run: `node --test tests/profile-stats-client.test.cjs` / Expected: FAIL

- [ ] **Step 3: 구현** — 위 Interfaces 대로, 기존 컴포넌트처럼 `(function (global) { ... })(window)`.

- [ ] **Step 4: 통과 확인** — Run: `npm test` (특히 `file-references` 가 새 script 경로를 확인) / Expected: 전부 PASS

---

### Task 5: 프로필 카드 스탯 영역, 번역, 화면 확인

**Files:**
- Modify: `src/js/components/profileCard.js` (`card()`), 프로필 카드 스타일 파일(`profile.css`, `profile-card` 규칙이 있는 곳), `src/data/i18n/English.json`, `src/data/i18n/Japanese.json`, `src/js/config/cdnConfig.js`(스크립트가 갱신)
- Test: `tests/profile-stats-client.test.cjs`

**Interfaces:**
- Consumes: Task 4 의 `ProfileLevel.fromStats`, `ProfileStats.fetch`
- `card(profile, catalog)` 는 `profile` 이 있으면 본문 끝에 `.profile-card-stats`(처음엔 `is-loading`) 를 붙이고 `ProfileStats.fetch(profile.id)` 로 채운다. 성공: `.profile-card-level`("Lv.{n}") + 진행 막대(`.profile-card-xp`, 너비 = `(xp-levelStart)/(nextStart-levelStart)`, 글자 "{xp}/{next}") + 네 칸(`.profile-card-stat` ×4: 숫자 + 이름 "본 문학"·"저장"·"태그 투표"·"끌올", 이 순서). 실패(`null`): 영역 제거. `profile` 이 null 이면 영역 없음.
- 새 i18n 키: `Lv.{n}`, `본 문학`, `저장`(이미 있으면 재사용), `태그 투표`, `끌올`(이미 있으면 재사용). 영어 "Viewed"/"Saved"/"Tag votes"/"Bumps", 일본어 "閲覧"/"保存"/"タグ投票"/"アゲ".

- [ ] **Step 1: 실패하는 테스트 작성**

```js
test('card fills level, bar and four stats in order', async () => {
  // fetch → {viewed:130,saved:42,voted:20,bumped:5}: 'Lv.8', '299/360', 숫자 [130,42,20,5], 이름 순서 고정
});
test('card removes the stats area when stats fail', async () => {});
test('card for an unknown profile has no stats area', () => {});
test('new stats strings exist in English and Japanese', () => {});
```

- [ ] **Step 2: 실패 확인** — Run: `node --test tests/profile-stats-client.test.cjs` / Expected: 새 테스트 FAIL

- [ ] **Step 3: 구현** — 카드 DOM, CSS(자리 표시는 흐린 막대, 다크는 `--card-*` 로 자동), 번역 추가, `python src/scripts/10_update_data_version.py`.

- [ ] **Step 4: 통과 확인** — Run: `npm test` 와 `npm run build` / Expected: 전부 PASS, 빌드 exit 0

- [ ] **Step 5: 화면 확인** — `src` 에서 `npx wrangler d1 execute cpkg-tags --local --file=../worker/stats_schema.sql` 후 로컬 wrangler dev. 프로필 계정으로 상세 창 두 개 열기 → 프로필 칩 카드에 본 문학 2, 레벨·막대 표시. 설정창 프로필 탭 미리보기. 라이트·다크 스크린샷.
