# 프로필 스탯과 레벨 설계

- 작성일: 2026-10-17
- 상태: 승인 대기 (대화에서 방향·레벨 공식·카드 모양·서버 구조 승인, 문서 검토 전)
- 선행: `2026-10-07-user-profile-design.md`, `2026-10-08-user-profile-display-design.md`

## 목표

프로필이 있는 유저의 활동 스탯 네 개를 서버에 쌓고, 그 스탯으로 계산한 레벨과 숫자를
프로필 카드에 모두에게 공개한다.

### 정해진 방향

- 공개 범위: 모두에게 공개. 프로필 칩을 눌러 여는 카드와 설정창 프로필 탭의 카드 미리보기에 보인다.
  목록 속 작은 칩에는 레벨을 붙이지 않는다.
- 스탯 네 개(숫자만, 어떤 작품인지 목록은 보여 주지 않는다):

| 스탯 | 세는 방법 |
| --- | --- |
| 본 문학 | 상세 창(`PostDetailSeries.open`)을 연 서로 다른 작품 수. 기능을 켠 날부터 센다 |
| 저장 | 서버 북마크에 한 번이라도 들어간 서로 다른 작품 수. 지웠다가 다시 넣어도 늘지 않고, 지워도 줄지 않는다 |
| 태그 투표 | 프로필을 만든 뒤(`linked_at` 이후) 투표한 서로 다른 게시물 수. 투표를 취소하면 줄어든다 |
| 끌올 | 프로필을 만든 뒤 신청한 끌올 수. 관리자가 취소·삭제한 끌올은 뺀다 |

- 공개 서재 수와 게임 점수는 넣지 않는다.
- 레벨은 저장하지 않고 스탯으로 계산한다. 서버는 숫자 네 개만 돌려주고, 공식은 브라우저 파일 하나에 둔다.
- 프로필이 없는 계정은 기록하지 않는다.

범위 밖: 작품 목록 공개, 칩의 레벨 표시, 랭킹·업적, 레벨 보상, 프로필을 만들기 전 활동의 소급(저장은 첫 동기화 때 자연히 들어온다).

## 1. 레벨

### 경험치

```
xp = viewed * 1 + saved * 2 + voted * 3 + bumped * 5
```

### 레벨 곡선

- 레벨 L 의 시작 경험치 `start(L) = 5 * L * (L - 1)` (Lv.1 = 0, Lv.2 = 10, Lv.3 = 30, Lv.5 = 100, Lv.10 = 450, Lv.20 = 1900).
- 다음 레벨까지 필요한 양은 `10 * L`. 상한 없음.
- 레벨은 `start(L) <= xp` 인 가장 큰 L.
- 예: 본 문학 130·저장 42·투표 20·끌올 5 → 299 → Lv.8 (start 280, 다음 360).

### 모듈 `src/js/core/profileLevel.js` (새 파일)

- `ProfileLevel.xp(stats)`, `ProfileLevel.fromStats(stats)` → `{ level, xp, levelStart, nextStart }`.
- 음수·숫자가 아닌 값은 0 으로 본다.

## 2. 데이터와 서버

### D1 `worker/stats_schema.sql` (새 파일, 모두 IF NOT EXISTS / OR IGNORE)

```sql
CREATE TABLE IF NOT EXISTS profile_activity (
  profile_id TEXT    NOT NULL,   -- profiles.profile_id
  kind       TEXT    NOT NULL,   -- 'view' | 'save' | 'bump'
  item_key   TEXT    NOT NULL,   -- view·save: '<type>:<id>' (LIBRARY_ITEM_TYPES), bump: bumps.id
  at         INTEGER NOT NULL,   -- 처음 기록한 시각(하루 한도 계산에 쓴다)
  PRIMARY KEY (profile_id, kind, item_key)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_tag_votes_voter ON tag_votes(voter_hash, created_at);

-- 지금 남아 있는 끌올을 한 번 옮겨 담는다(다시 실행해도 OR IGNORE 라 안전).
INSERT OR IGNORE INTO profile_activity (profile_id, kind, item_key, at)
  SELECT l.profile_id, 'bump', CAST(b.id AS TEXT), b.requested_at
  FROM bumps b JOIN profile_links l ON l.bump_hash = b.requester_hash
  WHERE b.requested_at >= l.linked_at
    AND b.id NOT IN (SELECT bump_id FROM bump_cancels);
```

- 끌올을 따로 담는 이유: `bumps` 는 7일 지난 행을 5분 주기 정리가 지워서, 거기서 세면 숫자가 줄어든다.
- 태그 투표는 `tag_votes` 에서 바로 센다(행이 정리되지 않는다).

### 모듈 `worker/profileStats.js` (새 파일)

- `profileIdForCode(env, personalCode)` — `sha256('profile:' + code)` 로 `profiles` 에서 `profile_id` 를 찾는다. 없으면 `null`.
- `recordView(env, profileId, key, now)` / `recordSaves(env, profileId, keys, now)` — 하루 한도 안에서
  `INSERT OR IGNORE`. 한도: 본 문학·저장 각각 KST 하루 200개(그날 `at` 으로 새로 들어간 행 수 기준).
  `recordSaves` 는 키 목록을 JSON 으로 한 번에 넘겨 `json_each` 로 넣는다(쿼리 1개).
  이미 있는 키는 한도에 세지 않도록 새 키만 남긴 뒤 남은 한도만큼 넣는다.
  북마크가 200개를 넘는 계정은 기능을 켠 뒤 며칠에 걸쳐(동기화할 때마다 그날 한도만큼) 저장 수가 채워진다.
- `recordBump(env, personalCode, bumpId, now)` — 프로필이 있으면 `('bump', bumpId)` 기록.
- `readStats(env, profileId)` — 쿼리 1개(서브쿼리)로 `{ viewed, saved, voted, bumped }`.
  `voted = COUNT(DISTINCT post_id) FROM tag_votes WHERE voter_hash = links.vote_hash AND created_at >= links.linked_at`.
- `deleteStatements(env, profileId)` — 삭제 경로의 batch 에 넣을 `DELETE FROM profile_activity WHERE profile_id = ?`.
- 키 형식 검사: `type` 이 `LIBRARY_ITEM_TYPES` 중 하나, `id` 가 양의 정수.

### API

- `POST /profile/view { personalCode, type, id }` — 프로필이 있으면 `Lookup.json`(isolate 당 캐시)에 있는 작품만
  기록하고 `{ ok: true, counted }`, 하루 한도 때문에 새 작품을 못 넣었으면 `capped: true` 를 더한다(브라우저는 이 작품을
  기억하지 않고 다음에 다시 보낸다). 프로필이 없으면 Lookup 을 읽지 않고 `{ ok: true, counted: false }`.
  형식이 틀리면 400, 프로필이 있는데 없는 작품이면 400 `unknown post`. 제한기 `RL_TAG_WRITE`(키 `'view:' + ip`). 표가 없으면 503.
- `GET /profile/stats?id=<profileId>` — `{ viewed, saved, voted, bumped }`. 프로필이 없으면 404, 표가 없으면 503.
  제한기 `RL_LIB_LIST`. 응답에 `Cache-Control: public, max-age=60`, 200 은 Workers 엣지 캐시(`caches.default`)에
  60초 둔다(cpkg.cloud 에서만 동작, workers.dev 는 매번 D1).
- `profile_activity(profile_id, kind, at)` 색인으로 하루 한도 계산이 그날 행만 읽는다.
- 두 경로를 `PROFILE_PATHS` 와 `_worker.js` 의 `API_EXACT_PATHS` 에 더한다.

### 기존 경로에 붙이는 기록

- `/user/sync` 성공 뒤: 새 북마크의 모든 항목 키로 `recordSaves`. 응답을 늦추지 않도록 가능하면 `ctx.waitUntil` 로 돌린다.
- `/bump/request` 성공 뒤: `recordBump`.
- 관리자 끌올 취소·삭제(`worker/adminBumps.js`): 같은 batch 에 `DELETE FROM profile_activity WHERE kind = 'bump' AND item_key = ?`.
- 기록이 실패해도(표 없음, D1 오류) 원래 요청은 그대로 성공한다.

### 삭제 연동

- 프로필 삭제(`profileApi.js` `/profile/delete`, 관리자 `adminProfiles.js` 프로필 삭제), 계정 삭제(`accountDelete.js`
  `purgeByCode`·`purgeByProfile`, 마감 뒤 자동 정리가 이것을 쓴다)에서 `deleteStatements` 를 기존 batch 에 넣는다.
- 프로필을 지우고 새로 만들면 프로필 ID 가 바뀌어 스탯이 처음부터 다시 쌓인다(저장은 다음 동기화 때 다시 들어온다).

## 3. 화면

### 본 문학 기록 (`postDetailSeries.js`)

- `open(data)` 에서 작품 키를 만들고, 로그인 상태이며 프로필이 있으면 `ProfileStats.noteView(type, id)`.
- `src/js/components/profileStats.js`(새 파일): 이미 보낸 키를 계정별 `localStorage` 에 기억해 다시 보내지 않는다
  (try/catch, 없으면 매번 보내도 서버가 중복을 막는다). 실패는 조용히 넘긴다.

### 프로필 카드 (`profileCard.js`)

- `card()` 아래에 스탯 영역: `Lv.8` + 진행 막대(`299/360`) + 숫자 네 칸(본 문학 · 저장 · 태그 투표 · 끌올).
- 카드를 그린 뒤 `ProfileStats.fetch(profileId)` 로 채운다. 불러오는 동안 흐린 자리 표시, 실패하면 스탯 영역만 숨긴다.
- 같은 프로필은 탭 안에서 60초 캐시.
- 설정창 프로필 탭 미리보기도 같은 카드라 그대로 나온다(프로필이 아직 없으면 스탯 영역 없음).
- 색은 `profile.css` 의 `--card-*` 변수와 `--profile-color` 로 라이트·다크를 맞춘다.

### 번역

- 새 문구("본 문학", "저장", "태그 투표", "끌올", "Lv.{n}" 등)는 `I18n.t` + English/Japanese. i18n JSON 을 고쳤으므로
  `python src/scripts/10_update_data_version.py` 로 `DATA_VERSION` 을 올린다.

## 4. 테스트와 배포

### 서버 테스트 (`tests/profile-stats.test.cjs`)

- 본 문학: 기록·중복·하루 한도 200·형식 오류 400·프로필 없는 계정은 counted false·표 없으면 503.
- 저장: 동기화 뒤 서로 다른 작품 수, 다시 동기화해도 그대로, 지워도 줄지 않음, 하루 한도.
- 끌올: 신청하면 늘고, 관리자 취소·삭제하면 줄고, 프로필을 만들기 전 끌올은 세지 않음. 스키마의 옮겨 담기 SQL.
- 태그 투표: `linked_at` 이후만, 취소하면 줄어듦.
- 조회: `/profile/stats` 숫자, 없는 프로필 404.
- 삭제 연동: 프로필 삭제·계정 삭제·관리자 계정 삭제 뒤 `profile_activity` 행이 없음.
- 기록 실패가 동기화·끌올 응답을 바꾸지 않음.

### 브라우저 테스트 (vm)

- `ProfileLevel` 공식(경계값: 0, 9, 10, 29, 30, 299).
- 카드 스탯 영역 채우기·실패 시 숨김, `noteView` 중복 전송 안 함.
- 새 문구가 i18n 목록에 있음.

### 마무리 확인

- `npm test` 전부 통과, `npm run build` 성공.
- 로컬 wrangler dev 에서 상세 창 열기 → 카드 숫자 증가, 라이트·다크 확인.

### 배포

- 원격 D1 에 먼저 적용: `cd src && npx wrangler d1 execute cpkg-tags --remote --file=../worker/stats_schema.sql`
  (파일 업로드 방식이 인증 오류를 내면 `--command` 로 SQL 을 넘긴다).
- 적용 전에 배포되면 스탯 조회만 503 이라 카드에서 스탯 영역이 숨고, 나머지 기능은 그대로다.
