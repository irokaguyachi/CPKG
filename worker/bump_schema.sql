-- 끌올(부스트) 대기열 D1 스키마 — 태그 투표와 같은 D1(TAGS_DB 바인딩,
-- database_name=cpkg-tags)을 재사용한다. 별도 D1을 새로 파지 않는 이유는
-- tags_schema.sql과 같다: 이미 프로비저닝돼 있고 wrangler.toml 바인딩도
-- 그대로 쓸 수 있다.
-- 배포 전 한 번 적용(src/wrangler.toml이 있는 src/ 디렉터리에서 실행):
--   wrangler d1 execute cpkg-tags --local  --file=../worker/bump_schema.sql
--   wrangler d1 execute cpkg-tags --remote --file=../worker/bump_schema.sql
--
-- 한 번에 활성(끌올 중)인 항목은 항상 하나뿐인 진짜 줄서기 큐다: 신청이
-- 들어오면 큐의 맨 끝(현재 끝나지 않은 행들 중 가장 늦은 end_at, 없으면
-- 지금 이 순간)에 이어붙고 그 시점부터 정확히 1시간(3600000ms)짜리 구간을
-- 얻는다. 구간끼리 서로 겹치지 않게 미리 잘라두므로 "지금 활성인 항목"은
-- start_at <= now < end_at 조건 하나로 구할 수 있고, 대기 중인 항목을 다음
-- 차례로 승격시키는 별도 배치 작업이 필요 없다(favoritesShareWorker.js의
-- handleBumpGet/handleBumpRequest 참고). 행은 처리 후에도 지우지 않고,
-- 오래된 것만 _worker.js의 5분 주기 정리가 걷어낸다.
CREATE TABLE IF NOT EXISTS bumps (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  item_type      TEXT    NOT NULL,   -- novel/translation/series/hof/official (LIBRARY_ITEM_TYPES)
  item_id        INTEGER NOT NULL,
  requester_hash TEXT    NOT NULL,   -- sha256('bump:' + personalCode)
  requested_at   INTEGER NOT NULL,
  start_at       INTEGER NOT NULL,
  end_at         INTEGER NOT NULL
);

-- "지금 활성" 조회(start_at/end_at 범위)와 큐 꼬리 계산(MAX(end_at))에 쓴다.
CREATE INDEX IF NOT EXISTS idx_bumps_end_at ON bumps(end_at);
-- 계정당 10분 쿨다운 조회(requester_hash별 최신 requested_at)에 쓴다.
CREATE INDEX IF NOT EXISTS idx_bumps_requester ON bumps(requester_hash, requested_at);
-- 같은 항목이 이미 활성/대기 중인지(중복 신청 거부) 조회에 쓴다.
CREATE INDEX IF NOT EXISTS idx_bumps_item ON bumps(item_type, item_id, end_at);
