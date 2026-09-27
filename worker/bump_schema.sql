-- 끌올(부스트) 대기열 D1 스키마 — 태그 투표와 같은 D1(TAGS_DB 바인딩,
-- database_name=cpkg-tags)을 재사용한다. 별도 D1을 새로 파지 않는 이유는
-- tags_schema.sql과 같다: 이미 프로비저닝돼 있고 wrangler.toml 바인딩도
-- 그대로 쓸 수 있다.
-- 배포 전 한 번 적용(src/wrangler.toml이 있는 src/ 디렉터리에서 실행):
--   wrangler d1 execute cpkg-tags --local  --file=../worker/bump_schema.sql
--   wrangler d1 execute cpkg-tags --remote --file=../worker/bump_schema.sql
--
-- 한 번에 활성(끌올 중)인 항목은 항상 하나뿐인 진짜 줄서기 큐다. v0.5부터
-- 끌올은 다음 신청이 들어오기 전까지 끝나지 않는다: 신청이 들어오면 큐의
-- 맨 끝 행이 교체될 시각을 규칙(favoritesShareWorker.js의 bumpSwitchAt)으로
-- 정해 그 행의 end_at에 적고, 새 행은 그 시각을 start_at으로 받는다.
-- "지금 활성인 항목"은 start_at <= now 인 행 중 가장 늦게 시작한 행이고
-- 대기 중은 start_at > now 인 행이라, 다음 차례로 승격시키는 별도 배치
-- 작업이 필요 없다(handleBumpGet/handleBumpRequest 참고). 교체 시각이 아직
-- 없는 맨 끝 행의 end_at은 시작 + 1시간을 임시로 넣어 두는 호환용 값이다 —
-- 스키마는 v0.4와 같아서 다시 적용할 필요가 없다. 행은 처리 후에도 지우지
-- 않고, 오래된 것만 _worker.js의 5분 주기 정리가 걷어낸다.
CREATE TABLE IF NOT EXISTS bumps (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  item_type      TEXT    NOT NULL,   -- novel/translation/series/hof/official (LIBRARY_ITEM_TYPES)
  item_id        INTEGER NOT NULL,
  requester_hash TEXT    NOT NULL,   -- sha256('bump:' + personalCode)
  requested_at   INTEGER NOT NULL,
  start_at       INTEGER NOT NULL,
  end_at         INTEGER NOT NULL
);

-- _worker.js의 오래된 행 정리(end_at < 7일 전)에 쓴다.
CREATE INDEX IF NOT EXISTS idx_bumps_end_at ON bumps(end_at);
-- 계정당 10분 쿨다운 조회(requester_hash별 최신 requested_at)에 쓴다.
CREATE INDEX IF NOT EXISTS idx_bumps_requester ON bumps(requester_hash, requested_at);
-- 같은 항목이 이미 활성/대기 중인지(중복 신청 거부) 조회에 쓴다.
CREATE INDEX IF NOT EXISTS idx_bumps_item ON bumps(item_type, item_id, end_at);
