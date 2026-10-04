-- 관리 페이지(/admin, worker/adminApi.js) D1 스키마 (TAGS_DB 바인딩, cpkg-tags)
-- 배포 전 한 번 적용(저장소 루트에서 실행):
--   npx wrangler d1 execute cpkg-tags --remote --file=worker/admin_schema.sql
-- 전부 IF NOT EXISTS 라 여러 번 실행해도 안전하다. 공개 API는 이 테이블들을
-- 못 읽으면(아직 미적용) 확인을 건너뛰고 기존대로 동작한다.

-- 관리 작업 기록. 데이터를 바꾸는 관리 요청은 실제 변경과 같은 batch 로 한 줄씩
-- 남긴다. 삭제는 detail 에 지워진 원본 행을 JSON 으로 담아 손으로 복구할 수 있게 한다.
CREATE TABLE IF NOT EXISTS admin_actions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         INTEGER NOT NULL,
  actor      TEXT    NOT NULL,   -- 세션 토큰의 a (관리자 계정 해시 앞 12자)
  action     TEXT    NOT NULL,   -- game.delete, tags.reset, bump.cancel, library.hide ...
  target     TEXT    NOT NULL,
  detail     TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_actions_at ON admin_actions(at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_actions_action ON admin_actions(action, at DESC);

-- 랭킹 등록 차단(game_scores.player_hash 와 같은 sha256('spacegame:' + playerId)).
CREATE TABLE IF NOT EXISTS game_bans (
  player_hash TEXT    PRIMARY KEY,
  reason      TEXT,
  banned_at   INTEGER NOT NULL
);

-- 랭킹 닉네임 금지어. 소문자로 저장하고 닉네임에 포함되면 거부한다.
CREATE TABLE IF NOT EXISTS banned_nicknames (
  word     TEXT    PRIMARY KEY,
  added_at INTEGER NOT NULL
);

-- 태그 투표 잠금. 잠긴 작품은 기존 표를 유지한 채 새 투표만 거부한다.
CREATE TABLE IF NOT EXISTS tag_vote_locks (
  post_id   INTEGER PRIMARY KEY,
  locked_at INTEGER NOT NULL
);

-- 취소된 활성 끌올. 활성 행을 지우면 이미 끝난 이전 끌올이 다시 활성으로
-- 잡히므로(활성 = 이미 시작한 행 중 가장 늦게 시작한 행), 지우지 않고 여기에 표시한다.
CREATE TABLE IF NOT EXISTS bump_cancels (
  bump_id      INTEGER PRIMARY KEY,
  cancelled_at INTEGER NOT NULL
);

-- 공식 태그 덮어쓰기(관리 페이지의 공식 태그 탭). 작품 = 종류 + 첫 게시물 ID.
-- tags 는 JSON 배열 문자열이고, 빈 배열은 "태그 전부 제거"다(태그보정.md 와 같은
-- 교체 의미). 바뀔 때마다 R2 tags/official-overrides.json 으로 다시 굽는다.
CREATE TABLE IF NOT EXISTS official_tag_overrides (
  item_type  TEXT    NOT NULL,   -- novel / translation / series / hof / official
  item_id    INTEGER NOT NULL,
  tags       TEXT    NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (item_type, item_id)
);

-- 관리자가 숨긴 공개 서재. R2 레코드는 주인이 계속 수정하므로 숨김 상태는 여기 둔다.
CREATE TABLE IF NOT EXISTS library_hidden (
  code      TEXT    PRIMARY KEY,
  name      TEXT,
  hidden_at INTEGER NOT NULL
);
