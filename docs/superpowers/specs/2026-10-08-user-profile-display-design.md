# 유저 프로필 설계 (2단계: 표시 연결)

- 작성일: 2026-10-08
- 상태: 승인됨 (대화에서 접근안 A와 섹션 1~3 승인)
- 선행: `2026-10-07-user-profile-design.md`(1단계: 프로필 기반)

## 목표

프로필을 만든 뒤의 활동에 프로필을 붙여 보여 준다. 대상은 공개 북마크, 끌올, 태그 투표, 게임 랭킹이다.
프로필이 없거나 지워졌으면 지금처럼 익명으로 보인다.

### 정해진 방향

- 과거 활동은 연결하지 않는다. 프로필을 만든 시각(`linked_at`) 이후의 활동만 프로필로 표시한다.
- 게임 랭킹: 로그인해서 프로필이 있으면 닉네임 입력 없이 프로필로 등록한다. 없으면 지금처럼 입력한다.
- 태그 투표자 목록은 "태그 보기 및 변경" 창에서 "n표"를 눌러 펼친다. 작품 상세 메인 줄의 태그 알약은
  지금처럼 누르면 바로 투표된다.

## 1. 데이터와 서버 (접근안 A: 연결 테이블 + 시각 필터)

### D1 `profile_links` (`worker/profile_schema.sql` 에 덧붙임)

```sql
CREATE TABLE IF NOT EXISTS profile_links (
  profile_id TEXT    PRIMARY KEY,   -- profiles.profile_id
  vote_hash  TEXT    NOT NULL,      -- sha256('tagvote:' + personalCode) = tag_votes.voter_hash
  bump_hash  TEXT    NOT NULL,      -- sha256('bump:' + personalCode)    = bumps.requester_hash
  game_hash  TEXT    NOT NULL,      -- sha256('spacegame-profile:' + profile_id) = 프로필 랭킹 줄의 player_hash
  linked_at  INTEGER NOT NULL       -- 이 시각 이후의 활동만 프로필로 표시(= profiles.created_at)
);
CREATE INDEX IF NOT EXISTS idx_profile_links_vote ON profile_links(vote_hash);
CREATE INDEX IF NOT EXISTS idx_profile_links_bump ON profile_links(bump_hash);
CREATE INDEX IF NOT EXISTS idx_profile_links_game ON profile_links(game_hash);
```

- 기존 `tag_votes`·`bumps`·`game_scores` 의 스키마와 쓰기 코드는 바꾸지 않는다. 관리 도구의 태그 이름 바꾸기·
  투표 초기화도 그대로 동작한다(voter_hash 는 그대로이므로 연결이 유지된다).
- 프로필을 만들 때 연결 행을 같은 batch 로 만든다. 1단계에서 이미 만든 프로필은 `/profile/me`·`/profile/save`
  를 호출할 때 `INSERT OR IGNORE` 로 채운다(`linked_at = profiles.created_at`). 해시에 개인 코드가 필요해서
  본인 요청 때만 만들 수 있다.
- 프로필 삭제(본인·관리자)는 같은 batch 로 연결 행도 지운다. 그 사람의 활동은 익명으로 돌아간다.
  다시 만들면 새 `linked_at` 이 잡혀 그 전 활동은 익명으로 남는다.
- 연결 테이블 조회가 실패하면(스키마 미적용 등) 막지 않고 익명으로 처리한다.

### 태그 투표

- 새 API `POST /tags/voters {postId, tagName}` → `{ profileIds: [...], anonymous: n }`.
  `tag_votes` 를 `profile_links.vote_hash` 로 JOIN 하고 `created_at >= linked_at` 인 표만 프로필로 센다.
  `profileIds` 는 최근 순 최대 50개, 나머지 표는 `anonymous` 에 센다(50개를 넘는 프로필 표도 포함).
  제한기는 `RL_LIB_LIST`. `_worker.js` 의 `API_EXACT_PATHS` 에 추가한다.

### 끌올

- `/bump/get` 응답의 `active` 에 `requesterProfileId` 를 추가한다. `requested_at >= linked_at` 일 때만 값,
  아니면 `null`.

### 공개 북마크

- 게시(`POST /library`) 때 개인 코드가 있고 프로필이 있으면 서재 기록과 공개 색인 줄에 `profileId` 를 넣는다.
- 수정(`PUT /library/<code>`)은 편집 토큰 인증 그대로이고, 본문에 개인 코드가 함께 오고 그 코드가 기록의
  `ownerHash` 와 맞을 때만 `profileId` 를 넣거나 갱신한다(프로필이 없으면 지운다). 맞지 않으면 무시한다.
- 공개 응답(목록·단건)에 `profileId` 를 담는다. 프로필이 조회되지 않으면 화면은 아무것도 붙이지 않는다.

### 게임 랭킹

- `/game/submit` 이 `personalCode` 를 선택적으로 받는다. 계정과 프로필이 있으면:
  닉네임 입력을 보지 않고, 기록 줄의 `player_hash` 를 `game_hash` 로 쓰며(기기가 달라도 한 줄),
  `nickname` 열에는 등록 때의 프로필 닉네임을 저장한다(관리 화면·프로필 삭제 뒤 표시용).
  게임 닉네임 중복 검사는 하지 않는다(프로필 닉네임이 기준).
- 순위 응답(`/game/ranking`)의 각 줄과 내 순위에 `profileId` 를 담는다. `profile_links.game_hash` 로 연결된
  줄만 값이 있다. 내 순위는 프로필 줄과 브라우저 줄 중 개인 코드가 오면 프로필 줄을 쓴다.
- 직접 입력 닉네임은 1~12자(`cleanNickname(raw, 12)`)로 늘리고, 다른 사람의 프로필 닉네임과 같으면
  (`profiles.nickname_key`) `nickname taken` 으로 거부한다.
- 차단 확인은 브라우저 ID 해시와 `game_hash` 를 모두 본다.

## 2. 화면

- 공개 북마크(`bookmarksPage.js`): 공개 서재 목록 항목과 서재 상세 머리말에 `ProfileCard.badge`. 목록의
  프로필은 `ProfileStore.fetchMany` 로 한 번에 받는다. 프로필이 없거나 지워졌으면 칩을 붙이지 않는다.
  게시·수정 때 로그인 상태면 개인 코드를 함께 보낸다(`bookmarkLibrary.js`).
- 끌올(`mainPage.js` 끌올 배너): 노출 중인 작품 아래 "끌올: [칩]" 한 줄. `requesterProfileId` 가 있을 때만.
- 태그 투표(`postDetailSeries.js` "태그 보기 및 변경" 창): 각 줄의 "n표" 를 버튼으로 바꿔 누르면 그 줄 아래에
  투표자 칩 목록을 펼치고 다시 누르면 접는다. 익명 표가 있으면 끝에 "익명 n명".
- 게임 랭킹(`spaceRanking.js`): `profileId` 가 있는 줄은 프로필 칩, 나머지는 글자. 등록 창은 프로필이 있으면
  입력칸 대신 내 칩 + "내 프로필로 등록", 없으면 입력(최대 12자). `nickname taken` 문구는
  "이미 쓰이고 있는 닉네임이에요(다른 사람의 프로필 닉네임 포함)". 내 순위 줄도 프로필 닉네임.
- 칩·카드·팝오버는 1단계 `profileCard.js` 를 쓴다. 새 문구는 `I18n.t` + English/Japanese 번역.
  라이트·다크 모두 확인한다.

## 3. 관리, 테스트, 배포

### 관리 페이지

- 랭킹 탭: 프로필 줄은 닉네임 옆에 "프로필" 배지. 이런 줄은 "닉네임 강제 변경" 버튼 대신 "프로필 탭에서
  초기화하세요" 안내(다음 등록 때 프로필 닉네임으로 다시 덮이기 때문). 차단·삭제는 그대로.
  순위 응답처럼 관리 목록에도 `profileId` 를 담는다.
- 프로필 탭: 삭제 때 연결 행도 지우고 작업 기록 detail 에 `link` 로 함께 남긴다.

### 테스트

- 연결 행: 생성 때 생김, 1단계 프로필은 `/profile/me` 때 채워짐(`linked_at = created_at`), 본인·관리자 삭제 때 사라짐.
- 태그 투표자: 생성 뒤 표만 프로필, 그 전 표와 지운 프로필의 표는 익명, 50개 상한, 태그 이름 바꾸기 뒤 연결 유지.
- 끌올: 생성 뒤 신청에만 `requesterProfileId`.
- 공개 북마크: 게시 때 기록·색인에 `profileId`, 수정은 `ownerHash` 가 맞을 때만 갱신(남의 코드는 무시).
- 게임: 프로필 등록은 기기가 달라도 한 줄, 남의 프로필 닉네임 입력 거부, 12자 경계, 차단 양쪽 적용,
  비로그인 등록 흐름 유지.
- 브라우저(vm): 랭킹 줄 그리기(칩·글자), 투표자 목록 펼치기·익명 수.
- 로컬 wrangler dev 로 네 화면을 브라우저에서 확인한다.

### 배포

- 같은 명령으로 스키마를 다시 적용한다(모두 IF NOT EXISTS):
  `cd src && npx wrangler d1 execute cpkg-tags --remote --file=../worker/profile_schema.sql`
- 적용 전에 배포돼도 투표·끌올·게시·랭킹 등록은 그대로 되고 프로필 표시만 빠진다.
- 1단계 최종 리뷰(사용량 한도로 중단)는 2단계 구현 뒤 1·2단계를 합쳐 한 번에 받는다.
