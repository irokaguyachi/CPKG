-- 유저 프로필 D1 스키마 (TAGS_DB 바인딩, cpkg-tags). worker/profileApi.js 가 쓰고,
-- 관리 페이지(worker/adminProfiles.js)가 검색·초기화·삭제한다.
-- 배포 전 한 번 적용(src/wrangler.toml 이 있는 src/ 디렉터리에서 실행):
--   npx wrangler d1 execute cpkg-tags --local  --file=../worker/profile_schema.sql
--   npx wrangler d1 execute cpkg-tags --remote --file=../worker/profile_schema.sql
-- 전부 IF NOT EXISTS 라 여러 번 실행해도 안전하다. 테이블이 없으면 프로필 API 만
-- 503 을 돌려주고 다른 기능은 그대로 동작한다.
--
-- 계정 하나에 프로필 하나(owner_hash UNIQUE). 닉네임 중복은 nickname_key(NFC +
-- 소문자) UNIQUE 가 막아서, 두 사람이 같은 닉네임으로 동시에 저장해도 한쪽만 성공한다.
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

-- 관리 페이지 목록(최근 수정 순)에 쓴다.
CREATE INDEX IF NOT EXISTS idx_profiles_updated ON profiles(updated_at DESC);
