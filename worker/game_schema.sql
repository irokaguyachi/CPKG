-- 우주 미니게임 「카구야 유성 피하기」 랭킹 D1 스키마 — 태그 투표·끌올과 같은
-- D1(TAGS_DB 바인딩, database_name=cpkg-tags)을 재사용한다.
-- 배포 전 한 번 적용(src/wrangler.toml이 있는 src/ 디렉터리에서 실행):
--   wrangler d1 execute cpkg-tags --local  --file=../worker/game_schema.sql
--   wrangler d1 execute cpkg-tags --remote --file=../worker/game_schema.sql
--
-- 로그인 없이 닉네임만으로 참여한다. 플레이어는 브라우저가 만든 무작위
-- playerId(localStorage)로 구분하고, 서버에는 그 해시만 남긴다.

-- 등록된 판의 nonce. 판 시작·종료는 서명 토큰만 주고받고 D1에 쓰지 않으며,
-- 등록(/game/submit)할 때만 이 줄을 넣는다 — 같은 판이 두 번 등록되지 않게
-- PRIMARY KEY 충돌로 막는 용도다(favoritesShareWorker.js의 /game/* 참고).
-- used 는 예전 방식과 맞추려고 남긴 컬럼이라 늘 1이다.
-- 오래된 줄은 _worker.js의 5분 주기 정리가 걷어낸다.
CREATE TABLE IF NOT EXISTS game_runs (
  run_id      TEXT    PRIMARY KEY,
  player_hash TEXT    NOT NULL,   -- sha256('spacegame:' + playerId)
  started_at  INTEGER NOT NULL,
  used        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_game_runs_started ON game_runs(started_at);

-- 기간(period)별 플레이어 최고 기록 한 줄. period 는 전체 기간이 'all',
-- 주간은 그 주 월요일(한국 시간)의 날짜 'w2026-09-28' 형식이다.
-- 닉네임은 등록할 때마다 모든 줄에서 최신 값으로 바뀐다.
CREATE TABLE IF NOT EXISTS game_scores (
  period      TEXT    NOT NULL,
  player_hash TEXT    NOT NULL,
  nickname    TEXT    NOT NULL,
  score_ms    INTEGER NOT NULL,
  achieved_at INTEGER NOT NULL,
  PRIMARY KEY (period, player_hash)
);

-- 순위표(점수 내림차순, 같으면 먼저 세운 사람이 위)와 내 순위 계산에 쓴다.
CREATE INDEX IF NOT EXISTS idx_game_scores_rank ON game_scores(period, score_ms DESC, achieved_at);
-- 다른 플레이어가 이미 쓰는 닉네임인지 확인에 쓴다.
CREATE INDEX IF NOT EXISTS idx_game_scores_nickname ON game_scores(nickname COLLATE NOCASE);
