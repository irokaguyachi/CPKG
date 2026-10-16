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

-- 2단계(표시 연결, docs/superpowers/specs/2026-10-08-user-profile-display-design.md).
-- 프로필 ID 와 활동 해시를 잇는다. 기존 tag_votes·bumps·game_scores 는 그대로 두고,
-- 표시할 때 이 테이블과 JOIN 하되 활동 시각이 linked_at(= 프로필을 만든 시각) 이후인
-- 것만 프로필로 본다 — 프로필을 만들기 전의 활동은 익명으로 남는다. 프로필을 지우면
-- 이 행도 지워져 그 사람의 활동이 다시 익명이 된다.
CREATE TABLE IF NOT EXISTS profile_links (
  profile_id TEXT    PRIMARY KEY,   -- profiles.profile_id
  vote_hash  TEXT    NOT NULL,      -- sha256('tagvote:' + personalCode) = tag_votes.voter_hash
  bump_hash  TEXT    NOT NULL,      -- sha256('bump:' + personalCode)    = bumps.requester_hash
  game_hash  TEXT    NOT NULL,      -- sha256('spacegame-profile:' + profile_id) = 프로필 랭킹 줄의 player_hash
  linked_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_profile_links_vote ON profile_links(vote_hash);
CREATE INDEX IF NOT EXISTS idx_profile_links_bump ON profile_links(bump_hash);
CREATE INDEX IF NOT EXISTS idx_profile_links_game ON profile_links(game_hash);

-- 계정 삭제 표식(docs/superpowers/specs/2026-10-16-account-delete-design.md).
-- 지운 개인 코드로 다시 가입·동기화하지 못하게 막는다. 개인 코드 자체는 저장하지 않는다.
CREATE TABLE IF NOT EXISTS deleted_accounts (
  owner_hash TEXT    PRIMARY KEY,   -- sha256('profile:' + personalCode) = profiles.owner_hash
  deleted_at INTEGER NOT NULL,
  deleted_by TEXT    NOT NULL,      -- 'self' | 'admin'
  pending    INTEGER NOT NULL       -- 1 = 계정 본체를 아직 못 지움(관리자 삭제)
);
