# 관리 페이지 1단계 — 공통 기반 + 유저 데이터 정리 설계

- 작성일: 2026-10-05
- 상태: 승인됨 (대화에서 섹션별 승인)
- 범위: 관리 도구 4개 하위 프로젝트 중 첫 번째. 회원 계정 관리, 공지·사이트 설정,
  태그 설정(작품별 태그 / 태그 정의)은 각각 별도 스펙으로 이어진다.

## 1. 목표

운영자가 배포나 로컬 스크립트 없이 사이트 안(`/admin`)에서 유저가 만든 데이터를
조회하고 정리할 수 있게 한다.

성공 기준:

- 문제가 된 랭킹 기록·태그 투표·끌올·공개 서재를 관리 페이지에서 찾아 1분 안에 처리할 수 있다.
- 모든 변경 작업이 작업 기록에 남고, 삭제는 원본 스냅샷을 함께 남겨 손으로 복구할 수 있다.
- 관리자 계정 + 관리자 비밀번호가 둘 다 맞아야만 관리 API에 접근할 수 있다.
- 관리 페이지가 기존 사이트 디자인(헤더, 색 토큰, 라이트/다크, 알약 탭, 모달)을 그대로 따른다.

하지 않는 것(이번 범위 밖): `/stats` 통계 화면 통합, 회원 계정 조회·삭제, 공지·설정 편집,
태그 정의·작품별 태그 편집, 기존 페이지 안에 관리 버튼 끼워 넣기.

## 2. 구조

- 접근 방식 A: 별도 관리 페이지 + 전용 API 모듈.
- `src/page/adminPage.html` + `src/js/pages/adminPage.js` + `src/css/pages/admin-page.css`
- `worker/adminApi.js` — `src/_worker.js` 가 `/api/admin/*` 를 이 모듈로 넘긴다
  (`statsApi.js` 와 같은 방식).
- `worker/admin_schema.sql` — 새 D1 테이블(같은 `cpkg-tags` D1, 바인딩 `TAGS_DB`).
- `worker/tagSnapshot.js` — `_worker.js` 의 `recordTagSnapshot` 을 모듈로 옮겨
  cron 과 관리 API가 같은 함수를 쓴다.
- `/admin` 슬러그를 `PAGE_SLUGS` 에 추가한다. `robots.txt` 는 이미 `Disallow: /`,
  페이지에는 `noindex, nofollow` 메타를 단다.

## 3. 인증

### 시크릿 (`wrangler secret put`, 코드/toml 금지)

| 이름 | 내용 |
| --- | --- |
| `ADMIN_USER_HASHES` | 관리자 계정 해시 목록(쉼표 구분). 해시 = `sha256('user-v2:' + personalCode)` = R2 `user/<hash>.json` 의 `<hash>`. 첫 값: `2a9d9ea58eb96dfe6a750a0a8c0057a115af206d7e0b02c3ab369345dc03bd98` |
| `ADMIN_PASSWORD` | 관리자 비밀번호 |
| `ADMIN_SESSION_SECRET` | 세션 토큰 HMAC 서명 키 |

- 셋 중 하나라도 비어 있으면 `/api/admin/*` 전체가 503 (fail-closed).
- 해시를 toml에 쓰지 않는 이유: 해시가 곧 공개 R2 버킷의 파일 경로라, 저장소에 노출되면
  관리자 계정의 북마크 파일을 누구나 읽을 수 있다.

### 흐름

1. `/admin` 은 브라우저 `localStorage` 의 개인 코드(기존 로그인)를 확인한다. 없으면
   "관리자 계정으로 먼저 로그인하세요" 안내만 보인다(헤더 프로필 메뉴로 로그인 가능).
2. 비밀번호 입력 → `POST /api/admin/login { personalCode, password }`.
3. 서버는 `sha256('user-v2:'+personalCode)` 가 `ADMIN_USER_HASHES` 에 있는지, 비밀번호가
   맞는지 둘 다 확인한다. 비교는 sha256 다이제스트끼리 상수 시간 비교. 어느 쪽이 틀렸는지
   구분하지 않고 401 `unauthorized`.
4. 레이트리밋 `RL_ADMIN_LOGIN` (IP당 60초 5회, namespace_id 1011) — prod·dev 둘 다 선언.
5. 성공 시 세션 토큰 발급: `base64url(JSON{k:'admin', a:<계정해시 앞 12자>, e:<만료 ms>}) + '.' + base64url(HMAC-SHA256)`.
   유효 기간 12시간. 클라이언트는 `sessionStorage` 에 저장, 이후 요청마다
   `Authorization: Bearer <token>`.
6. 모든 관리 요청은 서명·만료·`k`를 확인한다. 토큰의 `a` 가 현재 `ADMIN_USER_HASHES`
   중 하나의 앞 12자와 일치해야 한다(목록에서 빠진 관리자의 세션 무효화).
7. `ADMIN_SESSION_SECRET` 교체 = 전체 세션 강제 만료.

## 4. 데이터 (worker/admin_schema.sql)

```sql
CREATE TABLE IF NOT EXISTS admin_actions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         INTEGER NOT NULL,
  actor      TEXT    NOT NULL,   -- 세션 토큰의 a (계정 해시 앞 12자)
  action     TEXT    NOT NULL,   -- 예: game.delete, tags.reset, bump.cancel, library.hide
  target     TEXT    NOT NULL,   -- 사람이 읽을 대상 식별자
  detail     TEXT                -- JSON. 삭제 시 원본 행 스냅샷
);
CREATE INDEX IF NOT EXISTS idx_admin_actions_at ON admin_actions(at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_actions_action ON admin_actions(action, at DESC);

CREATE TABLE IF NOT EXISTS game_bans (
  player_hash TEXT PRIMARY KEY, reason TEXT, banned_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS banned_nicknames (
  word TEXT PRIMARY KEY, added_at INTEGER NOT NULL   -- 소문자로 저장
);
CREATE TABLE IF NOT EXISTS tag_vote_locks (
  post_id INTEGER PRIMARY KEY, locked_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bump_cancels (
  bump_id INTEGER PRIMARY KEY, cancelled_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS library_hidden (
  code TEXT PRIMARY KEY, name TEXT, hidden_at INTEGER NOT NULL
);
```

## 5. 관리 API (`/api/admin/*`, 로그인 외 전부 Bearer 필요)

| 메서드·경로 | 동작 |
| --- | --- |
| `POST /api/admin/login` | 세션 발급 |
| `GET /api/admin/game/scores?period=all\|weekly` | 순위표(상위 100, 닉네임·기록·달성시각·player_hash 앞 8자·차단 여부) |
| `POST /api/admin/game/delete {playerHash, scope:'period'\|'all', period?}` | 기록 삭제 |
| `POST /api/admin/game/rename {playerHash, nickname}` | 모든 기간 닉네임 강제 변경 (`cleanGameNickname` 규칙 동일) |
| `POST /api/admin/game/ban {playerHash, reason?}` / `.../unban` | 차단 = 모든 기록 삭제 + `game_bans` 추가 |
| `GET /api/admin/game/nicknames` / `POST .../nicknames/add {word}` / `.../nicknames/remove {word}` | 금지 닉네임 목록 |
| `GET /api/admin/tags/post?postId=` | 작품 태그별 득표 + 잠금 여부 |
| `GET /api/admin/tags/recent?limit=` | 최근 투표(post_id, tag, voter_hash 앞 8자, 시각) |
| `POST /api/admin/tags/reset {postId, tagName?}` | 작품×태그(또는 작품 전체) 투표 삭제 |
| `POST /api/admin/tags/purge-voter {voterPrefix}` | 해당 투표자의 모든 투표 삭제 (prefix 는 정확히 1명과 일치해야 함, 아니면 409) |
| `POST /api/admin/tags/lock {postId}` / `.../unlock` | 투표 잠금 |
| `GET /api/admin/bumps` | 활성·대기·최근 7일 목록(취소 여부 포함) |
| `POST /api/admin/bumps/cancel {id}` | 끌올 취소 |
| `GET /api/admin/library?q=` | 공개 서재 목록(인덱스) + 숨김 목록 |
| `POST /api/admin/library/hide {code}` / `.../unhide` | 숨기기 |
| `POST /api/admin/library/delete {code}` | 영구 삭제 (R2 + 공개 인덱스 + 숨김 행) |
| `GET /api/admin/actions?action=&before=` | 작업 기록 50건씩 |

- 변경 API는 실제 변경과 `admin_actions` 기록을 하나의 D1 `batch` 로 묶는다.
- R2 변경(서재 삭제)은 R2 성공 후 기록을 남기고, 기록 실패 시 응답에 `warning` 을 싣는다.
- 태그 투표를 바꾸는 API는 끝난 뒤 `recordTagSnapshot` 을 바로 돌린다(`ctx.waitUntil`).
- 응답은 `Cache-Control: no-store`, CORS 헤더 없음(같은 출처 전용).

## 6. 공개 API 변경

- **랭킹** `/game/submit`: `game_bans` 에 있는 player_hash 또는 `banned_nicknames` 단어를
  (소문자 비교로) 포함한 닉네임이면 기존과 같은 400 `invalid nickname`.
  기존 판 소모·기록 갱신 전에 확인한다.
- **태그** `/tags/vote`: `tag_vote_locks` 에 있으면 403 `voting locked`.
  `/tags/get` 응답에 `locked: boolean` 추가. `postDetailSeries.js` 는 잠긴 작품에서
  투표 버튼을 비활성화하고 "이 작품은 투표가 잠겨 있어요"를 보여준다.
- **끌올**:
  - 활성 판정은 그대로 두되, 활성 행이 `bump_cancels` 에 있으면 `/bump/get` 은 `active: null`.
  - 활성 끌올을 취소하면 가장 이른 대기 행의 `start_at` 을 지금으로 당긴다(취소 행 `end_at` = 지금).
  - 대기 중인 끌올 취소는 행 삭제.
  - `/bump/request`: 중복 검사에서 취소된 활성 행은 제외하고, 큐 맨 끝이 취소된 활성 행이면
    새 신청의 시작 시각은 지금.
  - `_worker.js` 의 `cleanupBumps` 는 `bumps` 에 없는 `bump_cancels` 행도 정리.
- **공개 서재**:
  - `GET /library` 목록은 `library_hidden` 코드를 걸러낸다.
  - `GET /library/<code>` 는 숨김이면 410 `hidden`.
  - `bookmarkLibrary.js` 는 410 을 "관리자에 의해 숨겨진 서재예요."로 보여준다.
  - 주인의 수정·삭제와 계정 데이터는 그대로 동작한다.
- 공개 API 쪽 확인 쿼리가 실패(스키마 미적용 등)하면 기존 동작으로 통과시킨다
  (부가 제약이 본 기능을 막지 않도록 — 기존 `/tags/get` 장애 처리와 같은 기조).

## 7. 화면

### 디자인 원칙 — 기존 사이트 디자인 그대로

- 다른 페이지와 같은 2단 `site-header` + `footer`, `colorTheme.css` 토큰, `theme.css`
  라이트/다크, Pretendard. 헤더 프로필 메뉴에서 바로 로그인 가능.
- 탭: `tabsKit.js` 알약 탭(`.bkm-tabs`, 움직이는 인디케이터).
- 확인 창: `modal-base.css`.
- 태그 칩: `tags.css` 의 태그별 색·이모지(`TagConfig`).
- 새 CSS는 `css/pages/admin-page.css` 하나, 표·행 버튼 등 없는 부품만 기존 토큰으로 만든다.
- 상단에 항상 경고 배너: "⚠️ 이 화면의 작업은 실서버 데이터에 반영됩니다"
  (dev 워커도 prod D1·R2 를 공유하므로).

### 탭

`랭킹 | 태그 투표 | 끌올 | 공개 서재 | 작업 기록`

- **랭킹**: 주간/전체 전환. 행 동작: 기록 삭제(이 기간/전체), 닉네임 변경, 차단/해제.
  아래에 금지 닉네임 목록(추가/삭제).
- **태그 투표**: `Lookup.json` 으로 작품 검색 → 태그별 득표 + 태그별 초기화·작품 잠금.
  아래에 최근 투표 피드 + 투표자 일괄 삭제.
- **끌올**: 활성 / 대기 / 최근 7일. 행 동작: 취소.
- **공개 서재**: 이름·코드 검색, 숨김 서재 별도 표시. 행 동작: 숨기기/해제, 영구 삭제.
- **작업 기록**: 최근 기록, 기능별 필터, 더 보기.

### 동작 규칙

- 되돌릴 수 있는 작업(숨기기·잠금·차단)은 확인 창 한 번.
- 영구 삭제는 확인 창에서 대상 이름(닉네임/서재 코드)을 다시 입력해야 실행.
- 요청 중 버튼 비활성화. 성공 시 해당 목록 새로고침, 실패 시 화면 유지 + 토스트.
- 401 이면 세션을 지우고 비밀번호 화면으로, 503 이면 "관리 기능이 아직 설정되지 않았어요".

## 8. 에러 처리

| 상황 | 상태 | 화면 |
| --- | --- | --- |
| 시크릿 미설정 | 503 | 설정 안내 |
| 세션 없음/만료/위조 | 401 | 비밀번호 화면 |
| 로그인 실패 | 401 | "인증 실패" |
| 로그인 과다 | 429 | "잠시 후 다시 시도" |
| 잘못된 요청 | 400 | 해당 동작 옆 오류 |
| 대상 없음 | 404 | "이미 처리된 항목" + 새로고침 |
| D1/R2 실패 | 500 | 토스트, 상태 유지 |

## 9. 테스트

`tests/admin-api.test.cjs` (Node 테스트 러너 + 메모리 SQLite D1 + 메모리 R2, 기존 테스트 구조 따름):

- 인증: 해시만 맞음 / 비번만 맞음 / 둘 다 맞음 / 만료 / 위조 / 시크릿 없음 / 목록에서 빠진 관리자 토큰
- 레이트리밋: 로그인 6번째 429
- 랭킹: 기간·전체 삭제, 닉네임 변경, 차단 후 submit 거부, 금지 단어 닉네임 거부, 해제 후 허용
- 태그: 초기화, 투표자 일괄 삭제(유일하지 않은 prefix 409), 잠금 후 vote 403·get locked, 해제
- 끌올: 대기 취소, 활성 취소 시 다음 대기 즉시 활성, 대기 없을 때 활성 취소 후 get null·새 신청 즉시 시작
- 서재: 숨기기 후 목록 제외·GET 410, 해제, 영구 삭제
- 작업 기록: 모든 변경이 1줄, 삭제는 스냅샷 포함
- 회귀: 기존 `npm test` 전부, `npm run build` 난독화 통과

수동 확인(사용자, dev 배포 후): 시크릿 3개 → `admin_schema.sql` 원격 적용 → 로그인 →
라이트/다크 각 탭 → 테스트 기록 삭제와 작업 기록 확인.

## 10. 배포 체크리스트 (사용자가 실행)

1. `npx wrangler d1 execute cpkg-tags --remote --file=worker/admin_schema.sql`
2. `npx wrangler secret put ADMIN_USER_HASHES` / `ADMIN_PASSWORD` / `ADMIN_SESSION_SECRET`
   (dev 는 각각 `--env dev`)
3. 정적 데이터 변경이 없으므로 `DATA_VERSION` 갱신은 불필요.
