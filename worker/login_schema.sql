-- 아이디 로그인(설계: docs/superpowers/specs/2026-10-16-login-id-design.md). 모두 IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS login_ids (
  id_key        TEXT    PRIMARY KEY,       -- 소문자 아이디
  personal_code TEXT    NOT NULL UNIQUE,   -- 이 아이디의 계정 코드
  owner_hash    TEXT    NOT NULL,          -- sha256('profile:' + personal_code)
  changed_at    INTEGER NOT NULL,          -- 마지막 아이디 변경 시각(처음 만들 때는 0 = 바로 바꿀 수 있음)
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_ids_owner ON login_ids(owner_hash);

CREATE TABLE IF NOT EXISTS maintenance_jobs (
  job        TEXT    PRIMARY KEY,   -- 'login-code-sweep'
  state      TEXT    NOT NULL,      -- JSON: { phase, cursor, counts }
  done       INTEGER NOT NULL,      -- 1 = 끝남, 다시 돌지 않음
  updated_at INTEGER NOT NULL
);
