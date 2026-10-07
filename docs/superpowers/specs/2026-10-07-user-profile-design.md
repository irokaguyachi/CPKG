# 유저 프로필 설계 (1단계: 프로필 기반)

- 작성일: 2026-10-07
- 상태: 승인됨 (대화에서 접근안 A와 섹션 1~3 승인)
- 유저 커스텀 기능 "프로필 꾸미기"의 1단계. 2단계(표시 연결)는 이 스펙 위에서 따로 설계한다.

## 목표

로그인한 유저가 닉네임·아이콘·색·자기소개로 된 공개 프로필을 만들고 고칠 수 있게 한다.
다른 사람의 프로필을 칩과 팝오버 카드로 그리는 컴포넌트를 완성해 두어, 2단계에서
공개 북마크·끌올·태그 투표·게임 랭킹에 바로 붙일 수 있게 한다. 관리자는 프로필을
검색하고 닉네임 초기화·자기소개 지우기·삭제를 할 수 있다.

### 정해진 방향

- 공개 범위: 널리 공개. 친목 방지 원칙 중 작품 쪽 규칙(작가 이름 가리기 `maskAuthor`)은
  그대로 두고, 유저 활동에만 프로필을 붙인다.
- 과거 활동은 연결하지 않는다. 프로필을 만든 뒤의 활동만 2단계에서 프로필 ID 와 함께 기록한다.
- 프로필은 선택 사항이다. 없는 사람의 활동은 지금처럼 익명이다.

범위 밖(이번 단계): 다른 화면에 프로필 표시(2단계), 게임 랭킹 닉네임 통합(2단계),
회원 계정 삭제(관리 도구 하위 프로젝트).

## 1. 데이터와 서버 API (접근안 A: D1 `profiles` 테이블)

### D1 스키마 `worker/profile_schema.sql` (cpkg-tags)

```sql
CREATE TABLE IF NOT EXISTS profiles (
  profile_id          TEXT    PRIMARY KEY,      -- 공개 ID, 무작위 12자 [A-Za-z0-9_-]
  owner_hash          TEXT    NOT NULL UNIQUE,  -- sha256('profile:' + personalCode)
  nickname            TEXT    NOT NULL,
  nickname_key        TEXT    NOT NULL UNIQUE,  -- NFC + toLowerCase, 중복 판정용
  icon                TEXT    NOT NULL,         -- ProfileIcons.json icons[].id
  color               TEXT    NOT NULL,         -- ProfileIcons.json colors[].id
  bio                 TEXT    NOT NULL DEFAULT '',
  nickname_changed_at INTEGER NOT NULL,         -- 0 = 바로 바꿀 수 있음
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_profiles_updated ON profiles(updated_at DESC);
```

### 검증 규칙

- 닉네임: `cleanGameNickname` 을 공용 함수 `cleanNickname(raw, max)` 로 옮긴다(NFC, 제어·폭 없는·방향
  문자 제거, 공백 하나로). 프로필은 1~12자, 게임 랭킹은 지금처럼 10자.
- 예약 형식 `/^유저[A-Za-z0-9_-]{6,12}$/` 은 유저가 고를 수 없다(관리자 초기화 전용).
- 금지어: 기존 `banned_nicknames` 를 닉네임과 자기소개 모두에 적용한다(소문자 포함 검사).
  테이블 조회가 실패하면 게임과 같이 막지 않는다.
- 자기소개: 같은 정리 규칙, 0~40자.
- 아이콘·색: `ProfileIcons.json` 에 있는 id 만 받는다.
- 계정 확인: R2 `user/<sha256('user-v2:'+code)>.json` 이 있을 때만 프로필을 만든다
  (가입 제한 우회 방지).
- 닉네임 변경 간격: 생성 때는 제한 없음. 이후 닉네임이 실제로 바뀌면 `nickname_changed_at = now`,
  다음 변경은 7일 뒤부터. 같은 닉네임으로 저장하면 간격과 무관하게 통과한다.
  아이콘·색·자기소개는 언제든 바꿀 수 있다.

### 아이콘·색 목록 `src/data/config/ProfileIcons.json`

```json
{ "icons": [ { "id": "fushi-nyam", "file": "/offlineSrc/loadingLogo/후시 냠냠.gif", "label": "후시 냠냠" } ],
  "colors": [ { "id": "rose", "hex": "#e0306e" } ] }
```

- 처음 목록: 기존 후시 GIF 4장(냠냠·눈물·물끄럼·잠)을 `offlineSrc/loadingLogo/` 경로 그대로
  연결한다. 파일은 복사하거나 옮기지 않는다(커스텀 에셋 보존 규칙).
- 새 그림은 저장소 루트 `offlineSrc/profileIcon/` 에 넣고 목록에 한 줄 추가한다. `offlineSrc/`
  는 사이트 서버가 직접 내보내므로 R2 동기화가 필요 없다.
- 색: 라이트·다크 모두에서 읽히는 12색 팔레트.
- 서버는 `loadTagCatalog` 와 같은 `env.ASSETS.fetch` 패턴으로 이 파일을 읽어 검증한다.

### API `worker/profileApi.js` (새 파일, 기존 rate limiter 재사용)

| 경로 | 제한기 | 동작 |
| --- | --- | --- |
| `POST /profile/me {personalCode}` | `RL_USER_AUTH` | `{ profile }` 또는 `{ profile: null }` |
| `POST /profile/save {personalCode, nickname, icon, color, bio}` | `RL_USER_SYNC` | 생성 또는 수정 후 `{ profile }` |
| `POST /profile/delete {personalCode}` | `RL_USER_SYNC` | `{ ok: true }`, 없으면 404 |
| `GET /profiles?ids=a,b,c` | `RL_LIB_LIST` | `{ profiles: { id: {...} } }`, 최대 50개, 없는 id 는 빠짐, `Cache-Control: max-age=30` |

- 내 프로필 응답: `{ id, nickname, icon, color, bio, nicknameChangeableAt }`.
  공개 응답에는 `id, nickname, icon, color, bio` 만 담는다.
- 오류: `invalid nickname` / `invalid bio` / `invalid icon` / `invalid color` / `reserved nickname`
  / `banned word`(400), `account not found`(404), `nickname taken`(409),
  `nickname cooldown`(429, `retryAt`), 테이블 없음 등 D1 오류는 503 `profile unavailable`.
- 닉네임 중복은 `nickname_key` UNIQUE 제약으로 판정한다. 동시에 같은 닉네임을 저장하면 한쪽은
  제약 오류 → 409.
- 2단계 준비: `export async function profileIdForCode(env, code)` 는 프로필 ID 또는 null.

## 2. 화면

### 설정창 "프로필" 탭 (`settingsModal.js` TABS 에서 "계정" 앞)

- 비로그인: "로그인하면 프로필을 만들 수 있어요" + 로그인 버튼(`AuthModal.openSignIn`).
- 프로필 없음: 만들기 화면. 안내 문구 "만든 뒤의 태그 투표·끌올·공개 북마크·랭킹 활동에
  이 프로필이 표시돼요".
- 편집 화면(위에서 아래로): 미리보기 카드(입력 즉시 반영, 공개 카드와 같은 컴포넌트) → 닉네임
  입력(간격 제한 중이면 잠그고 "○월 ○일부터 바꿀 수 있어요") → 아이콘 격자 → 12색 견본 →
  자기소개(글자 수 0/40) → "저장" / "프로필 삭제"(확인 창).
- 서버 오류 코드를 문구로 바꿔 보여 준다("이미 쓰이는 닉네임이에요", "쓸 수 없는 단어가
  들어 있어요" 등).

### 헤더 계정 메뉴 (`siteHeader.js`)

- 프로필이 있으면 버튼의 사람 아이콘 대신 내 아이콘을 내 색 배경 위에 그린다.
- 메뉴 머리말 "로그인됨" 자리에 닉네임. 가린 개인 코드 줄은 그대로.
- 메뉴 링크에 "프로필 편집" 추가 → `SettingsModal.open('profile')`.

### 새 컴포넌트

- `src/js/components/profileStore.js` (`global.ProfileStore`)
  - 내 프로필: 로그인 상태가 되면 `/profile/me` 로 받아 오고, 로그아웃하면 지운다.
    바뀌면 `chokaguya:profile-change` 이벤트.
  - `fetchMany(ids)`: 같은 순간(마이크로태스크)에 들어온 요청을 모아 `GET /profiles` 한 번으로
    보내고 메모리에 캐시한다. 50개씩 나눈다.
  - `icons()`: `ProfileIcons.json` 을 한 번 받아 둔다.
- `src/js/components/profileCard.js` (`global.ProfileCard`)
  - `badge(profile)`: 목록용 작은 칩(아이콘 + 닉네임). `profile` 이 null 이면 "알 수 없는 유저".
  - `card(profile)`: 큰 아이콘·닉네임·자기소개·색 띠. 설정창 미리보기도 이것을 쓴다.
  - `open(profileId, anchor)`: `popoverKit.js` 팝오버로 `card` 를 띄운다.
  - 1단계에서 다른 사람의 프로필이 실제로 나오는 곳은 없다. 2단계에서 붙인다.

### 번역·테마

- 새 문구는 `I18n.t` 를 거치고 `src/data/i18n/English.json`·`Japanese.json` 에 번역을 추가한다.
- 색은 `--card-*` 변수를 써서 다크 모드 규칙을 따로 두지 않는다. 프로필 색만 고른 hex 를 쓴다.

## 3. 관리, 테스트, 배포

### 관리 페이지 "프로필" 탭 (`worker/adminProfiles.js`, `adminPage.js`)

- `GET /api/admin/profiles?q=`: q 가 없으면 최근 수정 50개, 있으면 `nickname_key` 부분 일치 50개.
  행: 아이콘, 닉네임, 자기소개, 공개 ID, 만든 날짜.
- `POST /api/admin/profiles/reset-nickname {id}`: 닉네임을 `유저` + 공개 ID 앞 6자로 바꾸고
  `nickname_changed_at = 0`(본인이 바로 다시 정할 수 있게). 앞 6자가 다른 초기화 이름과 대소문자
  무시로 겹치면 `유저` + 전체 ID 를 쓴다.
- `POST /api/admin/profiles/clear-bio {id}`, `POST /api/admin/profiles/delete {id}`.
- 모든 작업은 변경과 같은 batch 로 `admin_actions` 에 남기고 detail 에 바뀌기 전 행을 담는다
  (`profile.reset-nickname`, `profile.clear-bio`, `profile.delete`). 작업 기록 필터에 "프로필".
- 금지어는 게임 탭의 기존 목록을 쓰고 설명을 "랭킹·프로필 닉네임과 자기소개에 적용"으로 고친다.

### 테스트 (Node 테스트 러너, `tests/helpers/workerHarness.cjs`)

- `tests/profile-api.test.cjs`: 생성·수정, 계정 없는 코드 거부, 대소문자 무시 중복, 동시 같은 닉네임
  한쪽만 성공, 7일 간격과 생성 예외, 같은 닉네임 재저장 통과, 금지어(닉네임·자기소개), 예약 형식,
  목록 밖 아이콘·색, 12자·40자 경계, 삭제, 공개 조회(50개 상한, 없는 id 빠짐, 공개 필드만).
- `tests/admin-api.test.cjs`: 세 관리 작업과 기록, 초기화 뒤 바로 닉네임 변경 가능.
- `tests/profile-client.test.cjs` (vm): `badge` 출력, null 은 "알 수 없는 유저", `fetchMany` 묶기.
- 로컬 wrangler dev 로 생성·편집·헤더·관리 탭을 브라우저에서 확인한다.

### 배포

- 원격 D1 스키마를 먼저 적용한다(`src/` 에서 실행):
  `cd src && npx wrangler d1 execute cpkg-tags --remote --file=../worker/profile_schema.sql`
- 테이블이 없으면 프로필 API 는 503, 화면은 "잠시 후 다시 시도해 주세요". 다른 기능에는 영향 없음.
- `ProfileIcons.json` 은 새 파일이라 `DATA_VERSION` 을 올리지 않는다.

## 후속 과제

- 2단계: 공개 북마크·끌올·태그 투표·게임 랭킹에 프로필 표시. `tag_votes`·`bumps` 등에 프로필 ID 열을
  추가하고 기록 시 `profileIdForCode` 로 채운다. 게임 랭킹 닉네임 길이(10자)와 프로필(12자)을 맞춘다.
- 보류안 C: 조회량이 문제가 되면 전체 프로필을 R2 공개 JSON 스냅숏으로 구워 CDN 캐시로 내려보낸다
  (태그 정의의 `tags/official-overrides.json` 패턴).
- 회원 계정 삭제를 만들 때 프로필도 함께 지운다.
