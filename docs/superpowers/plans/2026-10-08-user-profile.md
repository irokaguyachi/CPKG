# 유저 프로필 1단계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로그인한 유저가 닉네임·아이콘·색·자기소개로 된 공개 프로필을 만들고 고치며, 관리자가 프로필을 검색·초기화·삭제할 수 있게 한다.

**Architecture:** D1 `profiles` 테이블 하나에 프로필을 두고 `worker/profileApi.js` 가 공개 API 를,
`worker/adminProfiles.js` 가 관리 API 를 맡는다. 브라우저는 `profileStore.js`(데이터·캐시)와
`profileCard.js`(칩·카드·팝오버)를 공용 부품으로 두고 설정창 프로필 탭과 헤더가 이를 쓴다.

**Tech Stack:** Cloudflare Workers + D1 + R2, 바닐라 JS(IIFE, `global.X`), Node 테스트 러너(`npm test`), `tests/helpers/workerHarness.cjs`.

**Spec:** `docs/superpowers/specs/2026-10-07-user-profile-design.md`

## Global Constraints

- 닉네임 1~12자(코드 포인트), 정리 규칙은 기존 `cleanGameNickname` 과 같다. 게임 랭킹은 10자 그대로.
- 자기소개 0~40자, 같은 정리 규칙.
- 예약 형식 `/^유저[A-Za-z0-9_-]{6,12}$/` 은 유저가 고를 수 없다.
- 금지어는 `banned_nicknames` 를 닉네임·자기소개 모두에 적용하고, 조회 실패 시 막지 않는다.
- 닉네임 변경 간격 7일(`7 * 86400000`). 생성은 `nickname_changed_at = 0`(Ruling: 생성은 "변경"이 아니므로 한 번은 바로 고칠 수 있다).
- 공개 ID: 무작위 9바이트 base64url = 12자 `[A-Za-z0-9_-]`.
- `owner_hash = sha256('profile:' + personalCode)`. 계정 확인은 R2 `user/<sha256('user-v2:'+code)>.json` head.
- 공개 조회 최대 50개, `Cache-Control: public, max-age=30`.
- 오류 문자열: `invalid nickname`, `invalid bio`, `invalid icon`, `invalid color`, `reserved nickname`, `banned word`(400), `account not found`(404), `nickname taken`(409), `profile changed`(409), `nickname cooldown`(429 + `retryAt`), `profile unavailable`(503).
- 아이콘 파일은 `offlineSrc/` 아래만. `src/assets/image/` 와 기존 GIF 는 건드리지 않는다(CLAUDE.md 최우선 규칙).
- 새 UI 문구는 `I18n.t` 를 거치고 `src/data/i18n/English.json`·`Japanese.json` 에 번역을 넣는다(관리 페이지 문구는 기존처럼 번역하지 않는다).
- 커밋 메시지는 한국어 `type(scope): 제목` + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. 경로를 명시해 스테이징한다. 푸시하지 않는다.

## Review Focus

1. 같은 닉네임을 대소문자만 바꿔 두 계정이 동시에 저장 → 한쪽만 성공하고 다른 쪽은 409 `nickname taken`.
2. 닉네임은 그대로 두고 아이콘만 바꾸는 저장이 7일 제한에 걸리면 안 된다.
3. 관리자 닉네임 초기화가 다른 프로필의 초기화 이름과 겹칠 때(공개 ID 앞 6자 대소문자 무시 충돌) → 전체 ID 로 대체.
4. `GET /profiles` 에 잘못된 id·중복 id·51개 이상 → 잘못된 id 는 무시, 중복 제거, 50개 초과는 400.
5. 로그아웃 직후 이전 계정의 프로필이 헤더에 남지 않아야 한다(늦게 도착한 `/profile/me` 응답 무시).

---

### Task 1: 공용 닉네임 검사, 스키마, 아이콘 목록

**Files:**
- Create: `worker/nickname.js`, `worker/profile_schema.sql`, `src/data/config/ProfileIcons.json`
- Modify: `worker/favoritesShareWorker.js:646-668`(`cleanGameNickname` 을 `cleanNickname(raw, GAME_NICKNAME_MAX)` 위임으로), `gameSubmitBlocked` 의 금지어 검사를 `bannedWordIn` 으로
- Test: `tests/profile-api.test.cjs`(새 파일), `tests/file-references.test.cjs`

**Interfaces:**
- Produces: `cleanNickname(raw: any, max: number) -> string|null`, `bannedWordIn(env, texts: string[]) -> Promise<boolean>`(조회 실패 시 false), `RESERVED_NICKNAME_RE`
- `ProfileIcons.json`: `{ icons: [{id, file, label}], colors: [{id, hex}] }`

- [ ] **Step 1: 실패하는 테스트 작성** (`tests/profile-api.test.cjs`)

```js
test('cleanNickname trims, strips invisible chars and enforces max', async () => {
  const { cleanNickname } = await load('worker/nickname.js');
  assert.equal(cleanNickname('  카구야​  짱 ', 12), '카구야 짱');
  assert.equal(cleanNickname('가'.repeat(12), 12), '가'.repeat(12));
  assert.equal(cleanNickname('가'.repeat(13), 12), null);
  assert.equal(cleanNickname('   ', 12), null);
  assert.equal(cleanNickname(5, 12), null);
});
test('bannedWordIn matches lowercase substrings and fails open', async () => {
  const { bannedWordIn } = await load('worker/nickname.js');
  const db = new D1(['admin_schema.sql']);
  db.db.exec("INSERT INTO banned_nicknames VALUES ('bad', 1)");
  assert.equal(await bannedWordIn({ TAGS_DB: db }, ['ok', 'xBADx']), true);
  assert.equal(await bannedWordIn({ TAGS_DB: db }, ['ok']), false);
  assert.equal(await bannedWordIn({ TAGS_DB: new D1([]) }, ['bad']), false);
});
test('profile schema applies twice', () => {
  assert.doesNotThrow(() => new D1(['profile_schema.sql', 'profile_schema.sql']));
});
```

`tests/file-references.test.cjs` 에 추가: `ProfileIcons.json` 의 모든 `icons[].file` 이 `root/offlineSrc/...` 에 있고, id 가 중복 없고, `colors` 가 12개이며 hex 가 `/^#[0-9a-f]{6}$/`.

- [ ] **Step 2: 실행해서 실패 확인** — `npm test` → 새 테스트들이 모듈·파일 없음으로 FAIL.

- [ ] **Step 3: 구현**
  - `nickname.js`: `cleanGameNickname` 본문을 옮기고 최대 길이를 인자로. `RESERVED_NICKNAME_RE = /^유저[A-Za-z0-9_-]{6,12}$/`.
  - `profile_schema.sql`: 스펙 1절의 DDL 그대로(+ 상단 주석에 `src/` 기준 적용 명령).
  - `ProfileIcons.json` icons: `fushi-nyam`/`후시 냠냠.gif`, `fushi-tears`/`후시 눈물.gif`, `fushi-stare`/`후시 물끄럼.gif`, `fushi-sleep`/`후시 잠.gif`, file 은 `/offlineSrc/loadingLogo/<파일명>`, label 은 파일명에서 `.gif` 를 뺀 것. colors: `rose #e0306e`, `coral #f06543`, `amber #e5a00d`, `lime #7cb518`, `green #2f9e44`, `teal #12a594`, `sky #1c9bd6`, `blue #3b5bdb`, `indigo #5f3dc4`, `purple #9c36b5`, `brown #8d6e63`, `slate #607089`.
  - `favoritesShareWorker.js`: `export function cleanGameNickname(raw) { return cleanNickname(raw, GAME_NICKNAME_MAX); }`, `gameSubmitBlocked` 는 차단 조회만 남기고 금지어는 `bannedWordIn(env, [nickname])`.

- [ ] **Step 4: 실행해서 통과 확인** — `npm test` → 전부 PASS(기존 게임 랭킹 테스트 포함).

- [ ] **Step 5: 커밋** — `feat(profile): 공용 닉네임 검사와 프로필 스키마·아이콘 목록 추가`

### Task 2: 공개 프로필 API

**Files:**
- Create: `worker/profileApi.js`
- Modify: `worker/favoritesShareWorker.js`(`route()` 에서 위임), `src/_worker.js:48`(`API_EXACT_PATHS` 에 `/profile/me`, `/profile/save`, `/profile/delete`, `/profiles`)
- Test: `tests/profile-api.test.cjs`

**Interfaces:**
- Consumes: Task 1 의 `cleanNickname`, `bannedWordIn`, `RESERVED_NICKNAME_RE`
- Produces:
  - `export const PROFILE_PATHS = ['/profile/me', '/profile/save', '/profile/delete', '/profiles']`
  - `export async function handleProfileRequest(request, env, tools) -> Response`, `tools = { jsonResponse, checkLimit, clientIp, readJsonBody, cleanPersonalCode, userStoreKey }`(favoritesShareWorker 내부 함수를 넘긴다. 순환 import 를 피하려는 것)
  - `export async function profileIdForCode(env, personalCode) -> string|null`
  - 응답 모양: 내 프로필 `{ id, nickname, icon, color, bio, nicknameChangeableAt }`, 공개 `{ id, nickname, icon, color, bio }`

- [ ] **Step 1: 실패하는 테스트 작성** — `setupProfiles()` 하네스: `load('worker/favoritesShareWorker.js')`, env 에 `TAGS_DB: new D1(['admin_schema.sql','profile_schema.sql'])`, `FAVORITES_BUCKET: new Bucket()`, `RL_USER_AUTH/RL_USER_SYNC/RL_LIB_LIST: allow`, `ASSETS` 가 `ProfileIcons.json` 실제 파일 내용을 돌려주게. `signup(code)` 는 `/user/signup` 호출(또는 Bucket 에 `user/<hash('user-v2:'+code)>.json` 직접 put). 테스트(이름과 핵심 단언):
  - `save creates a profile and me returns it`: 200, `profile.id` 가 `/^[A-Za-z0-9_-]{12}$/`, `nicknameChangeableAt === 0`; `/profile/me` 가 같은 값.
  - `me returns null without a profile`: `{ profile: null }`.
  - `save rejects codes without an account`: 404 `account not found`.
  - `nicknames are unique ignoring case`: A 가 `Kaguya`, B 가 `kaguya` → 409 `nickname taken`.
  - `concurrent saves of one nickname let only one win`: `Promise.all` 두 계정 → 상태 `[200, 409]`(순서 무관).
  - `nickname change waits seven days after the first change`: 생성 → 바로 변경 200 → 다시 변경 429, `retryAt === 변경시각 + 7*86400000` → `clock.now` 를 7일 옮기면 200.
  - `same nickname or icon-only saves skip the cooldown`: 쿨다운 중 아이콘·색·자기소개만 바꾼 저장 200.
  - `banned words are rejected in nickname and bio`: 각각 400 `banned word`.
  - `reserved and invalid fields are rejected`: `유저abc123` → `reserved nickname`; 13자 → `invalid nickname`; 41자 bio → `invalid bio`; `icon:'nope'` → `invalid icon`; `color:'nope'` → `invalid color`. 12자·40자는 200.
  - `delete removes the profile`: 200 → me null → 다시 delete 404.
  - `public lookup returns only public fields`: `GET /profiles?ids=<a>,<a>,bad!,<missing>` → `profiles` 키가 `[a]` 뿐, 값에 `nicknameChangeableAt` 없음, `Cache-Control` 에 `max-age=30`; id 51개 → 400.
  - `profileIdForCode finds the id`: 만든 계정은 id, 없는 계정은 null.
  - `missing table returns 503`: `profile_schema.sql` 없이 save → 503 `profile unavailable`.

- [ ] **Step 2: 실행해서 실패 확인** — `npm test` → 위 테스트 404/모듈 없음으로 FAIL.

- [ ] **Step 3: 구현** — 저장 순서: 본문(최대 2048바이트) → 코드 → 필드 검증(카탈로그는 `env.ASSETS.fetch('/data/config/ProfileIcons.json')`, 읽지 못하면 503) → 예약 형식 → 금지어 → 계정 head → 기존 행 조회 → INSERT 또는 UPDATE. 닉네임이 바뀌는 UPDATE 는 `WHERE owner_hash = ? AND nickname_changed_at = ?`(읽은 값)로 걸고 changes 0 이면 409 `profile changed`. UNIQUE 오류는 메시지에 `nickname_key` 가 있으면 `nickname taken`, 그 밖에는 `profile changed`. 핸들러 전체를 try/catch 로 감싸 D1 오류는 503. 제한기: me=`RL_USER_AUTH`, save/delete=`RL_USER_SYNC`, `/profiles`=`RL_LIB_LIST`.

- [ ] **Step 4: 실행해서 통과 확인** — `npm test` → 전부 PASS.

- [ ] **Step 5: 커밋** — `feat(profile): 프로필 조회·저장·삭제 API 추가`

### Task 3: 관리 API

**Files:**
- Create: `worker/adminProfiles.js`
- Modify: `worker/adminApi.js`(import 하고 ROUTES 에 합침)
- Test: `tests/admin-api.test.cjs`(`ALL_SCHEMAS` 에 `profile_schema.sql` 추가, `setupAdmin` env 에 `RL_USER_SYNC: allow` 와 `ProfileIcons.json` ASSETS 응답 추가)

**Interfaces:**
- Produces: `export var profileRoutes = { 'GET /profiles', 'POST /profiles/reset-nickname', 'POST /profiles/clear-bio', 'POST /profiles/delete' }`
- 목록 응답 `{ items: [{ id, nickname, icon, color, bio, createdAt, updatedAt }] }`, 작업 응답 `{ ok: true, profile? }`, 기록 action `profile.reset-nickname` / `profile.clear-bio` / `profile.delete`, target = 공개 ID, detail `{ before: <행> }`.

- [ ] **Step 1: 실패하는 테스트 작성**
  - `admin lists and searches profiles`: 두 프로필 생성 → `GET profiles` 2개(최근 수정 순), `GET profiles?q=KAG` 는 `Kaguya` 하나, `q=%` 는 0개(LIKE 이스케이프).
  - `admin reset nickname lets the owner rename right away`: 유저가 닉네임 변경해 쿨다운 → 관리자 초기화 → 닉네임 `유저` + id 앞 6자, 기록 1줄(detail.before.nickname 이 이전 이름) → 유저가 바로 새 닉네임 저장 200.
  - `reset nickname falls back to the full id on collision`: 두 번째 프로필 id 앞 6자를 대소문자만 다르게 만들어 둔 뒤(테스트에서 D1 직접 UPDATE) 둘 다 초기화 → 두 번째는 `유저` + 전체 id.
  - `admin clears bio and deletes profiles with logs`: bio `''`, 삭제 후 404, 기록 2줄.
  - `unknown profile ids return 404`.

- [ ] **Step 2: 실행해서 실패 확인** — `npm test` → 404 not found 로 FAIL.

- [ ] **Step 3: 구현** — 기존 `adminGame.js` 형식(`readBody`, `json`, `logAction`, 같은 batch). 검색은 `cleanNickname` 없이 NFC + 소문자 후 `nickname_key LIKE ? ESCAPE '\'`(`%`, `_`, `\` 이스케이프), 50개.

- [ ] **Step 4: 실행해서 통과 확인** — `npm test` → 전부 PASS.

- [ ] **Step 5: 커밋** — `feat(admin): 프로필 검색·닉네임 초기화·삭제 관리 API 추가`

### Task 4: 브라우저 공용 부품 (profileStore, profileCard)

**Files:**
- Create: `src/js/components/profileStore.js`, `src/js/components/profileCard.js`, `src/css/components/profile.css`
- Modify: `settingsModal.js` 를 싣는 10개 HTML(`src/page/*.html` 중 adminPage 포함)에 `popoverKit.js` 뒤·`settingsModal.js` 앞으로 두 스크립트와 CSS 링크 추가
- Test: `tests/profile-client.test.cjs`(새 파일)

**Interfaces:**
- `global.ProfileStore`:
  - `catalog() -> Promise<{icons, colors}>`(`'../data/config/ProfileIcons.json'` 한 번만 fetch), `iconFile(catalog, id) -> string|null`, `colorHex(catalog, id) -> string|null`
  - `mine() -> profile|null`, `loadMine() -> Promise<profile|null>`, `saveMine({nickname, icon, color, bio}) -> Promise<profile>`(실패 시 `Error` 에 `.code` = 서버 오류 문자열, `.retryAt`), `deleteMine() -> Promise<void>`
  - `fetchMany(ids) -> Promise<{[id]: profile|null}>`: 같은 마이크로태스크의 요청을 모아 50개씩 `GET /profiles?ids=`, 결과 캐시
  - 이벤트 `chokaguya:profile-change`(detail `{ profile }`). `chokaguya:auth-change` 로그인 → `loadMine`, 로그아웃 → 비우고 이벤트. 로그아웃 뒤 도착한 `loadMine` 응답은 버린다(요청 번호 비교).
- `global.ProfileCard`:
  - `avatar(profile, catalog, size?) -> HTMLElement`(`span.profile-avatar`, `--profile-color`, 안에 `img`)
  - `badge(profile, catalog) -> HTMLElement`: profile 이 있으면 `button.profile-badge[data-profile-id]`(누르면 `open`), null 이면 `span.profile-badge.is-unknown` 텍스트 `t('알 수 없는 유저')`
  - `card(profile, catalog) -> HTMLElement`(`div.profile-card`: 색 띠, 큰 avatar, 닉네임, 자기소개)
  - `open(profileId, anchor)`: `PopoverKit.createPopover('profile-popover', 280)` 로 `card` 표시

- [ ] **Step 1: 실패하는 테스트 작성** — vm 에 최소 가짜 DOM(createElement·appendChild·className·textContent·setAttribute·style.setProperty·addEventListener)과 `I18n.t = s => s`, 가짜 `fetch` 를 넣어 두 파일을 실행.
  - `badge renders nickname and avatar color`: 텍스트에 닉네임, avatar style `--profile-color` 가 `#e0306e`, `data-profile-id` 설정.
  - `badge for a missing profile says unknown user`: className 에 `is-unknown`, 텍스트 `알 수 없는 유저`.
  - `fetchMany batches requests in the same tick`: `fetchMany(['a'])`, `fetchMany(['b','a'])` 동시 호출 → fetch 1회, URL 에 `ids=a,b`, 결과에 없는 id 는 null; 다시 `fetchMany(['a'])` 는 fetch 없음.
  - `logout drops a late loadMine response`: loadMine 진행 중 로그아웃 이벤트 → 응답 도착 후 `mine()` 은 null.

- [ ] **Step 2: 실행해서 실패 확인** — `npm test` → 파일 없음으로 FAIL.

- [ ] **Step 3: 구현** — 개인 코드는 `BookmarkLibrary.getPersonalCode()`, 요청은 상대 경로(`'/profile/me'` 등, POST JSON). CSS 는 `--card-*` 변수만 쓰고 프로필 색은 `var(--profile-color)`.

- [ ] **Step 4: 실행해서 통과 확인** — `npm test` → 전부 PASS(HTML 참조 테스트 포함).

- [ ] **Step 5: 커밋** — `feat(profile): 프로필 데이터 저장소와 칩·카드 컴포넌트 추가`

### Task 5: 설정창 프로필 탭과 헤더

**Files:**
- Modify: `src/js/components/settingsModal.js`(TABS 에 `{ id: 'profile', label: t('프로필') }` 를 'account' 앞에, `renderPane` 분기, `renderProfilePane`), `src/js/components/siteHeader.js`(`makeAvatar`, 메뉴 머리말, "프로필 편집" 링크, `chokaguya:profile-change` 구독, 모바일 시트 포함), `src/css/components/settings-modal.css` 또는 `profile.css`, `src/data/i18n/English.json`, `Japanese.json`
- Test: `tests/profile-client.test.cjs`

**Interfaces:**
- Consumes: Task 4 의 `ProfileStore`, `ProfileCard`.
- 오류 문구 표(`code -> 문구`): `nickname taken` → '이미 쓰이는 닉네임이에요', `banned word` → '쓸 수 없는 단어가 들어 있어요', `reserved nickname` → '쓸 수 없는 닉네임 형식이에요', `invalid nickname` → '닉네임은 1~12자로 정해 주세요', `invalid bio` → '자기소개는 40자까지 쓸 수 있어요', `nickname cooldown` → '{date}부터 닉네임을 바꿀 수 있어요', `account not found` → '계정을 찾지 못했어요. 다시 로그인해 주세요', 그 밖 → '잠시 후 다시 시도해 주세요'.

- [ ] **Step 1: 실패하는 테스트 작성** — `profileErrorMessage(code, retryAt)` 를 `ProfileStore.errorMessage` 로 노출하고 테스트: 위 표의 각 코드, 알 수 없는 코드는 기본 문구, `nickname cooldown` 은 날짜(`M월 D일`)를 포함. 추가로 `English.json`·`Japanese.json` 에 위 문구와 탭 문구(`프로필`, `프로필 편집`, `프로필 만들기`, `로그인하면 프로필을 만들 수 있어요`, `알 수 없는 유저`, 안내 문구)가 모두 있는지.

- [ ] **Step 2: 실행해서 실패 확인** — `npm test` → FAIL.

- [ ] **Step 3: 구현** — 스펙 2절 화면 순서 그대로: 미리보기(`ProfileCard.card` 를 입력마다 다시 그림) → 닉네임(쿨다운이면 `disabled` + 날짜 안내) → 아이콘 격자(radio 역할 버튼) → 색 견본 → 자기소개(`0/40`) → 저장 / 프로필 삭제(기존 `.auth-overlay` 확인 창 패턴). 비로그인·프로필 없음 상태 분기. 헤더: 프로필이 있으면 `site-avatar` 안을 `ProfileCard.avatar` 로, 머리말 제목을 닉네임으로, 링크 목록 맨 앞에 "프로필 편집"(`SettingsModal.open('profile')`).

- [ ] **Step 4: 실행해서 통과 확인** — `npm test` → 전부 PASS.

- [ ] **Step 5: 커밋** — `feat(profile): 설정창 프로필 탭과 헤더 프로필 표시 추가`

### Task 6: 관리 페이지 프로필 탭

**Files:**
- Modify: `src/js/pages/adminPage.js`(TABS 에 `{ key: 'profiles', label: '프로필', href: '#profiles' }` 를 'library' 뒤에, ACTION_LABELS 세 개, 작업 기록 필터 "프로필", 게임 탭 금지어 설명 문구), `src/css/pages/admin-page.css`(필요한 만큼)
- Test: 브라우저 확인(Task 7). 이 태스크는 서버 동작이 Task 3 테스트로 고정되어 있어 화면 연결만 한다.

- [ ] **Step 1: 구현** — 검색창 + 표(아이콘은 `ProfileCard.avatar`, 닉네임, 자기소개, 공개 ID `admin-mono`, 만든 날짜) + 행 버튼 3개(모두 기존 확인 dialog). 금지어 설명: '랭킹·프로필 닉네임과 자기소개에 적용돼요'.
- [ ] **Step 2: 확인** — `npm test` PASS, `npm run build -- --loose` 성공.
- [ ] **Step 3: 커밋** — `feat(admin): 관리 페이지에 프로필 탭 추가`

### Task 7: 로컬 통합 확인

- [ ] **Step 1:** `npm run build -- --loose` 로 `dist/` 를 만들고(아이콘이 `offlineSrc/` 에 있어서), 스크래치패드를 `--persist-to` 로 지정해 `dist` 기준 wrangler dev 를 띄운다. 로컬 D1 에 `admin_schema.sql`, `profile_schema.sql` 적용. 관리자 로그인용 값은 임시 `.dev.vars` 로 넣고 끝나면 지운다.
- [ ] **Step 2:** 브라우저에서 확인: 비로그인 프로필 탭 안내 → 가입·로그인 → 프로필 만들기(미리보기 즉시 반영) → 헤더 아이콘·닉네임 → 닉네임 변경 후 쿨다운 안내 → 중복 닉네임 오류 문구 → 라이트·다크 → 관리 탭 검색·초기화·삭제·작업 기록.
- [ ] **Step 3:** 서버 종료, 임시 파일 삭제. 발견한 문제는 원래 태스크의 테스트를 먼저 추가해 고친다.
