-- 유저 태그 투표 시스템 D1 스키마 (TAGS_DB 바인딩)
-- 배포 전 한 번 적용(src/wrangler.toml이 있는 src/ 디렉터리에서 실행):
--   wrangler d1 execute cpkg-tags --local  --file=../worker/tags_schema.sql
--   wrangler d1 execute cpkg-tags --remote --file=../worker/tags_schema.sql
--
-- tag_name은 자유 입력이 아니라 pageData/UserTagCatalog.json(빌드 산출물)에
-- 있는 이름만 서버가 허용한다(favoritesShareWorker.js의 handleTagsVote 참고).
-- 득표수는 별도 컬럼을 두지 않고 COUNT(*)로 센다 — 카운터 컬럼과 실제 투표
-- 행이 어긋나는 사고를 원천적으로 없앤다.

CREATE TABLE IF NOT EXISTS tag_votes (
  post_id    INTEGER NOT NULL,
  tag_name   TEXT    NOT NULL,
  voter_hash TEXT    NOT NULL,     -- sha256('tagvote:' + personalCode)
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, tag_name, voter_hash)
);

CREATE INDEX IF NOT EXISTS idx_tag_votes_post ON tag_votes(post_id);
