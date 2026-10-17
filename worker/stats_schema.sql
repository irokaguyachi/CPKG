-- 프로필 활동 통계 D1 스키마 (TAGS_DB 바인딩, cpkg-tags). worker/profileStats.js 가 쓴다.
-- profile_schema.sql, bump_schema.sql, admin_schema.sql 을 적용한 뒤 한 번 적용(src/ 디렉터리에서 실행):
--   npx wrangler d1 execute cpkg-tags --local  --file=../worker/stats_schema.sql
--   npx wrangler d1 execute cpkg-tags --remote --file=../worker/stats_schema.sql
-- 전부 IF NOT EXISTS / OR IGNORE 라 여러 번 실행해도 안전하다. 테이블이 없으면 스탯 API 만
-- 503 을 돌려주고 동기화·끌올 등 다른 기능은 그대로 동작한다.
-- 설계: docs/superpowers/specs/2026-10-17-profile-stats-level-design.md
CREATE TABLE IF NOT EXISTS profile_activity (
  profile_id TEXT    NOT NULL,   -- profiles.profile_id
  kind       TEXT    NOT NULL,   -- 'view' | 'save' | 'bump'
  item_key   TEXT    NOT NULL,   -- view·save: '<type>:<id>' (LIBRARY_ITEM_TYPES), bump: bumps.id
  at         INTEGER NOT NULL,   -- 처음 기록한 시각(하루 한도 계산에 쓴다)
  PRIMARY KEY (profile_id, kind, item_key)
) WITHOUT ROWID;

-- 하루 한도(오늘 들어간 view·save 수) COUNT 가 프로필의 기록 전체를 훑지 않게 한다.
CREATE INDEX IF NOT EXISTS idx_profile_activity_day ON profile_activity(profile_id, kind, at);

-- 투표 수(voter_hash 별, linked_at 이후) 조회에 쓴다.
CREATE INDEX IF NOT EXISTS idx_tag_votes_voter ON tag_votes(voter_hash, created_at);

-- 지금 남아 있는 끌올을 한 번 옮겨 담는다(bumps 는 7일 뒤 정리되므로 따로 담는다).
INSERT OR IGNORE INTO profile_activity (profile_id, kind, item_key, at)
  SELECT l.profile_id, 'bump', CAST(b.id AS TEXT), b.requested_at
  FROM bumps b JOIN profile_links l ON l.bump_hash = b.requester_hash
  WHERE b.requested_at >= l.linked_at
    AND b.id NOT IN (SELECT bump_id FROM bump_cancels);
