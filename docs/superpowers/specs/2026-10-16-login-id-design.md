# 아이디 로그인 전환 설계

- 작성일: 2026-10-16
- 상태: 승인 대기 (대화에서 접근 방식과 섹션 1~3 승인, 문서 검토 전)
- 선행: `2026-10-16-account-delete-design.md`(계정 삭제)

## 목표

20자리 로그인 코드를 없애고, 유저가 정하는 아이디만으로 로그인하게 한다(비밀번호 없음).
기존 코드 사용자는 2026-11-30 23:59(KST)까지 아이디를 만들어야 하고, 만들지 않은 계정은 2026-12-01 00:00(KST)부터 자동으로 지워진다.

### 정해진 방향

- 아이디만으로 로그인한다. 아이디를 아는 사람은 누구나 그 계정에 들어갈 수 있다는 위험은 사용자가 알고 감수했다(사이트 규모가 작아 간편함 우선).
- 아이디는 프로필 닉네임과 별개이며 어디에도 공개하지 않는다.
- 규칙: 영문 소문자·숫자·`_` 4~20자, 대소문자 구분 없음(입력을 trim 후 소문자로 저장·비교). 정규식 `^[a-z0-9_]{4,20}$`.
- 아이디는 바꿀 수 있되 마지막 변경 뒤 1일(`LOGIN_ID_COOLDOWN_MS = 86400000`)이 지나야 다시 바꿀 수 있다. 처음 만드는 것(코드 → 아이디 전환, 새 가입)은 제한 없음. 바꾸면 예전 아이디는 바로 다른 사람이 쓸 수 있다.
- 서버 안에서는 기존 개인 코드를 계속 계정 열쇠로 쓴다(아이디 → 코드 대응). 모든 해시 키가 그대로라 데이터 이전이 없다.
- 마감 시각 상수 `LOGIN_CODE_DEADLINE = Date.UTC(2026, 10, 30, 15, 0, 0)` (= 2026-12-01 00:00 KST, 2026-10-17 에 10/31 에서 연기). 서버와 브라우저가 같은 값을 쓴다.
- 안내 문구(그대로 사용): "이제 로그인 코드는 폐지됩니다! 아이디를 변경하세요! 11월 30일 오후 11:59에 변경하지 않은 로그인 코드는 계정이 삭제됩니다!"

범위 밖: 비밀번호·PIN, 관리자의 아이디 쿨타임 해제, 아이디 금지어, 아이디 공개 표시, 정리 작업의 미리보기·수동 실행.

## 1. 데이터와 서버

### D1 `worker/login_schema.sql` (새 파일, 모두 IF NOT EXISTS)

```sql
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
```

아이디만으로 로그인하는 이상 아이디를 아는 사람은 코드도 얻으므로, 코드를 평문으로 저장해도 위험이 늘지 않는다.

### API (모듈 `worker/loginIdApi.js`)

- `POST /user/login { loginId }` → 200 `{ personalCode, loginId }`, 없는 아이디 404 `login id not found`, 형식 오류 400. 제한기 `RL_USER_AUTH`.
- `POST /user/signup { personalCode, loginId }` — 아이디가 있으면 계정 본체와 `login_ids` 행을 함께 만든다. 이미 쓰이는 아이디 409 `login id taken`, 형식 오류 400.
  아이디 없이 코드만 보낸 가입은 마감 전에는 지금처럼 처리하고, 마감 뒤에는 410 `{ error: 'account deleted' }`(옛 브라우저의 404 → 자동 재가입으로 계정이 되살아나는 것을 막는다).
  `login_ids` 를 쓸 수 없으면(테이블 없음·D1 오류) 아이디 가입은 503.
- `POST /login-id/set { personalCode, loginId }` — 코드 → 아이디 전환과 아이디 변경. 계정 본체가 없으면 404, 중복 409.
  이미 아이디가 있고 `now < changed_at + LOGIN_ID_COOLDOWN_MS` 면 429 `{ error: 'login id cooldown', retryAt }`(프로필 닉네임 쿨타임과 같은 형식). 같은 아이디로 다시 설정하면 아무것도 바꾸지 않고 200. 표식 검사(`deletedAccountResponse`) 적용. 제한기 `RL_USER_SYNC`.
- `POST /login-id/me { personalCode }` → `{ loginId | null, changeableAt }` (`changeableAt` 은 다시 바꿀 수 있는 시각, 바로 가능하면 0). 제한기 `RL_USER_SYNC`. 표식 검사 적용.
- `/user/get` 과 `/user/signup` 응답에 `loginId`(없으면 `null`)를 담는다.
- `src/_worker.js` `API_EXACT_PATHS` 에 `/user/login`, `/login-id/set`, `/login-id/me` 추가.
- 관리자 로그인은 바꾸지 않는다. 관리 페이지는 이 브라우저에 로그인된 계정의 코드 + 비밀번호로 들어가는데(`adminPage.js` `personalCode()`), 아이디로 로그인해도 브라우저는 코드를 받아 두므로 그대로 동작한다. 관리자 계정도 마감 전에 아이디를 만들어야 마감 뒤 다시 로그인할 수 있다.

### 계정 삭제와 연결 (`worker/accountDelete.js`)

- `purgeByCode` 는 마지막 단계에서 `DELETE FROM login_ids WHERE personal_code = ?`.
- `purgeByProfile` 은 먼저 `login_ids` 에서 `owner_hash` 로 코드를 찾는다. 찾으면 `purgeByCode(env, code, 'admin')` 로 그 자리에서 전부 지우고, 못 찾으면 지금처럼 남은 정리를 다음 요청에 맡긴다.

### 마감 뒤 자동 정리 (`worker/loginCodeSweep.js`, `_worker.js` `scheduled` 에서 매분 호출)

- 실행 조건: `Date.now() >= LOGIN_CODE_DEADLINE` 이고 `env.ACCOUNT_SWEEP_ENABLED === '1'` 이고 `maintenance_jobs` 의 `login-code-sweep` 가 `done = 0`(없으면 새로 시작).
  `ACCOUNT_SWEEP_ENABLED` 는 프로덕션 `[vars]` 에만 넣는다. dev(cpkgdev)는 프로덕션과 같은 D1·R2 를 쓰므로 dev 에서 정리가 돌면 실서버 데이터가 지워진다 — `[env.dev.vars]` 에는 절대 넣지 않는다.
- 남길 계정 = `login_ids` 의 모든 코드. 이 목록을 읽지 못하면 그 틱은 아무것도 하지 않는다.
- 단계(한 틱에 단계당 최대 200개, 상태를 `maintenance_jobs` 에 저장해 이어서 진행):
  1. `user/*`: 남길 코드의 `userStoreKey` 가 아니고 `ADMIN_USER_HASHES` 의 계정도 아니면 삭제.
  2. `owners/*`: 남길 코드의 `ownerIndexKey` 가 아니면 삭제.
  3. `library/*.json`: `ownerHash` 가 있고 남길 코드 중 어느 것의 `ownerHashFor(code, libCode)` 와도 맞지 않으면 `deleteLibraryRecord`. `ownerHash` 가 없는 익명 서재는 남긴다.
  4. D1 `profiles`: `owner_hash` 가 남길 코드의 `profileOwnerHash` 가 아니면 프로필·연결 행·프로필 랭킹 줄 삭제(`deleteProfileRows`).
- 단계가 끝날 때마다 `admin_actions` 에 `account.sweep` (actor `'system'`, detail 에 단계와 삭제 개수) 기록. 마지막 단계가 끝나면 `done = 1`.
- 태그 투표·끌올은 계정 삭제 때와 같이 익명으로 남긴다.

## 2. 화면

### 로그인 창 (`authModal.js`)

- 기본: 아이디 입력칸 + [로그인], 아래 "계정이 없으신가요? 새로 만들기".
- 새로 만들기: 아이디 입력 + [가입] → 바로 로그인. 20자리 코드 확인 화면은 없앤다. 형식 오류 "영문 소문자, 숫자, _ 로 4~20자", 중복 "이미 쓰이고 있는 아이디예요"를 입력칸 아래에.
- 마감 전에만 맨 아래 "기존 로그인 코드로 로그인" 링크 → 예전 코드 입력 화면. 성공하면 곧바로 아이디 변경 창으로 넘어간다. 마감 뒤에는 링크를 숨긴다.

### 아이디 변경 창 (새 컴포넌트 `src/js/components/loginIdModal.js`)

- 전환 모드: 제목 "아이디를 만들어 주세요", 안내 문구(위 원문 그대로), 아이디 입력칸 + 규칙 안내, [아이디 만들기]. 성공하면 "이제 {id} 아이디로 로그인할 수 있어요" 후 닫힘.
- 변경 모드: 제목 "아이디 변경", 현재 아이디 표시, 입력칸, [변경]. 쿨타임 중이면 입력칸·버튼을 잠그고 "{시각} 이후에 다시 바꿀 수 있어요"(429 응답의 `retryAt` 으로도 같은 문구).
- 닫기(X) 가능. 코드만 있는 계정이고 마감 전이면 브라우저 세션당 한 번(`sessionStorage`) 자동으로 연다.

### 코드만 있는 계정 판별

- `UserData.getLoginId()` — `localStorage` 에 코드별로 기억한 아이디. 없으면 `POST /login-id/me` 로 확인해 기억한다. 로그인·가입·아이디 설정 응답으로도 갱신하고 로그아웃·계정 삭제 때 지운다.

### 프로필 쪽 안내

- 헤더 프로필 메뉴(`siteHeader.js`)와 설정창 프로필 탭 맨 위에, 코드만 있는 계정이고 마감 전일 때 안내 문구 + [아이디 만들기](변경 창 열기).

### 설정창 계정 탭 (`auth.js`)

- "개인 코드" 표시·복사 칸을 없애고 "아이디: {id} [변경]". 코드만 있는 계정이면 그 자리에 안내 문구 + [아이디 만들기].
- 로그아웃 확인 문구를 "로그아웃할까요? 다시 로그인하려면 아이디를 알고 있어야 해요." 로 바꾼다. 동기화·계정 삭제는 그대로.

### 번역·테마

- 새 문구는 `I18n.t` + English/Japanese, `python src/scripts/10_update_data_version.py`. 기존 로그인 창·설정창 스타일 변수로 라이트·다크.

## 3. 테스트와 배포

### 서버 테스트

- 아이디 가입(형식 오류, 중복, 대소문자 무시), 아이디 로그인, 없는 아이디 404, 전환·변경(예전 아이디 해제), `/login-id/me`.
- 쿨타임: 전환 직후 바로 변경 가능, 변경 직후 다시 변경하면 429·`retryAt`, 1일 뒤(시계 이동) 변경 가능, 같은 아이디 재설정은 200.
- 마감 뒤 코드만 가입 410(시계를 마감 뒤로).
- 계정 삭제 시 `login_ids` 행 삭제, 관리자 삭제가 아이디 있는 계정을 즉시 전부 삭제.
- 아이디로 로그인한 브라우저에서 관리자 로그인(코드 + 비밀번호)이 그대로 된다.
- 정리 작업: 마감 전 무동작, `ACCOUNT_SWEEP_ENABLED` 없으면 무동작, 아이디 있는 계정의 본체·소유 색인·서재·프로필은 남고 없는 계정 것만 삭제, 익명 서재·관리자 계정 본체 보존,
  여러 틱에 나눠 끝까지 진행, `done` 뒤 재실행 없음, `login_ids` 를 못 읽으면 중단.

### 브라우저 테스트

- 로그인·가입 화면, 마감 전후 코드 로그인 링크 표시·숨김, 코드 로그인 뒤 변경 창, 세션당 한 번 자동 열림, 안내 문구 원문, 계정 탭 표시.

### 마무리 확인

- `npm test`, `npm run build` 통과. 로컬 wrangler dev 에서 가입·아이디 로그인·코드 로그인 → 전환·아이디 변경·아이디 로그인 뒤 관리 페이지 진입을 브라우저로 확인.

### 배포

- 원격 D1 에 `worker/login_schema.sql` 적용(`cd src && npx wrangler d1 execute cpkg-tags --remote --file=../worker/login_schema.sql`).
- 먼저 `dev`(cpkgdev)에 테스트 버전으로 반영하고, 마감(11/30 23:59) 전에 `release` 에 반영한다. 정리는 `release`(프로덕션)에서만 돈다.
- `release` 를 마감 뒤에 반영하면 반영 즉시 정리가 실행된다.
