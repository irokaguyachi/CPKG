# 회원 계정 삭제 설계

- 작성일: 2026-10-16
- 상태: 승인 대기 (대화에서 접근안 A와 섹션 1~3 승인, 문서 검토 전)
- 선행: `2026-10-07-user-profile-design.md`(후속 과제 "회원 계정 삭제를 만들 때 프로필도 함께 지운다")

## 목표

사용자는 설정창에서 자기 계정을 지우고, 관리자는 관리 페이지에서 프로필이 있는 계정을 지운다.
지우면 그 사람의 개인 데이터가 서버에 남지 않고, 지운 계정이 다른 기기에서 되살아나지 않는다.

### 정해진 방향

- 삭제 주체: 사용자 본인(설정창 계정 탭)과 관리자(관리 페이지 프로필 탭). 서버 삭제 로직은 하나를 같이 쓴다.
- 지우는 것: 계정 본체(서버 북마크), 프로필, 공개 서재, 프로필로 등록한 랭킹 줄.
- 남기는 것: 태그 투표·끌올 신청(작품 집계에 쓰이므로 익명으로 남김. 프로필 연결 행이 사라져 누구 것인지 안 보임),
  이 브라우저의 로컬 북마크(로그아웃과 같음).
- 사용자 삭제 확인: 확인 패널에서 '삭제'라고 입력해야 영구 삭제 버튼이 켜진다.
- 관리자는 프로필이 있는 계정만 찾아 지울 수 있다. 프로필 없는 계정의 공개 서재는 지금처럼 공개 서재 탭에서 숨기거나 지운다.

### 왜 삭제 표식이 필요한가

- 다른 기기의 `userData.js` 는 동기화가 404 를 받으면 자동으로 다시 가입한다(구버전 코드 대응). 지우기만 하면 계정이 되살아난다.
- 관리자는 프로필의 `owner_hash = sha256('profile:' + code)` 만 알고, 계정 본체 키 `sha256('user-v2:' + code)` 는
  계산할 수 없다(해시를 일부러 분리해 둔 설계). 그래서 관리자 삭제는 닿는 것만 바로 지우고 나머지는 그 코드로
  다음 요청이 올 때 정리한다(접근안 A).

범위 밖: 프로필 없는 계정의 관리자 삭제, 태그 투표·끌올 기록 삭제, 로컬 북마크 삭제, 관리자 삭제 뒤 접속하지 않는
계정 본체의 강제 정리(키를 아는 사람이 없어 읽을 수 없다).

## 1. 데이터와 서버

### D1 `deleted_accounts` (`worker/profile_schema.sql` 에 덧붙임)

```sql
CREATE TABLE IF NOT EXISTS deleted_accounts (
  owner_hash TEXT    PRIMARY KEY,   -- sha256('profile:' + personalCode) = profiles.owner_hash
  deleted_at INTEGER NOT NULL,
  deleted_by TEXT    NOT NULL,      -- 'self' | 'admin'
  pending    INTEGER NOT NULL       -- 1 = 계정 본체를 아직 못 지움(관리자 삭제)
);
```

### 모듈 `worker/accountDelete.js` (새 파일)

- `purgeByCode(env, personalCode, by)` — 코드를 알 때 전부 지운다. 단계마다 멱등이라 중간에 실패해도 다시 부르면 이어서 끝난다.
  1. 표식 기록: `INSERT ... ON CONFLICT(owner_hash) DO NOTHING` (`deleted_by = by`, `pending = 1`). 이후 단계가 실패해도 되살아나지 않게 가장 먼저 한다.
  2. 공개 서재: 소유 색인(`ownerIndexKey`)의 코드마다 `library/<code>.json` 을 읽어 `ownerHashFor(code)` 로 주인이 맞을 때만
     R2 원본 삭제 + `updateLibraryIndex(env, code, null)` + `library_hidden` 행 삭제. 끝나면 소유 색인 삭제.
  3. 프로필: `profiles`·`profile_links` 행, 프로필 랭킹 줄(`game_scores` 의 `player_hash = sha256('spacegame-profile:' + profile_id)`)을 한 batch 로 삭제.
  4. 계정 본체 `user/<hash>.json` 삭제 후 표식을 `pending = 0` 으로.
- `purgeByProfile(env, profileRow)` — 관리자용. 표식(`deleted_by = 'admin'`, `pending = 1`) + 위 3번 + 공개 목록 색인에서
  `profileId` 가 같은 서재를 2번과 같은 방식(R2·색인·숨김 행)으로 삭제. 해당 서재의 소유 색인 정리는 나중의 `purgeByCode` 가 맡는다.
- `checkDeleted(env, personalCode)` — 표식을 찾아 `null | { pending }` 을 돌려준다. 테이블이 없거나 D1 오류면 `null`(표식 없음)로 본다.

### API

- `POST /user/delete { personalCode }` — 사용자 삭제. 계정 본체가 있거나 표식이 있으면 `purgeByCode(…, 'self')` 후 `{ ok: true }`,
  둘 다 없으면 404 `account not found`. 제한기 `RL_USER_SYNC`. `_worker.js` 의 `API_EXACT_PATHS` 에 추가.
  D1 표식 테이블이 없으면 503(표식 없이 지우면 되살아날 수 있으므로 지우지 않는다).
- `POST /profiles/delete-account`(관리, `worker/adminProfiles.js`) — `purgeByProfile` 후 `admin_actions` 에
  `profile.delete-account` 로 기록(detail 에 지운 프로필 행·연결 행·서재 코드 목록). 기존 `POST /profiles/delete` 는 그대로.

### 표식 검사

- 대상: `/user/signup`, `/user/get`, `/user/sync`, `/profile/me`, `/profile/save`, 서재 게시·수정·소유 연결(개인 코드를 보낸 경우).
- 표식이 있으면 `410 { error: 'account deleted' }`. `pending = 1` 이면 응답 전에 `purgeByCode(…, 'admin')` 로 남은 것을 정리한다
  (표식의 `deleted_by` 는 처음 값을 유지).
- 비용: 위 요청마다 D1 읽기 1회. 자동 폴링은 없어서 사용자 동작이 있을 때만 생긴다.
- 태그 투표·끌올은 검사하지 않는다(익명으로 남기는 데이터이고, 410 을 받은 브라우저는 바로 로그아웃한다).

## 2. 화면

### 설정창 계정 탭 (`auth.js`, 로그인 상태)

- "로그아웃" 아래 `is-danger` "계정 삭제" 버튼. 누르면 아래에 확인 패널을 펼친다(새 모달 없음).
  - 문구: "계정을 삭제하면 되돌릴 수 없어요." / "지워지는 것: 서버에 저장된 북마크, 프로필, 공개한 서재, 프로필로 올린 랭킹 기록" /
    "남는 것: 태그 투표·끌올 신청(익명으로), 이 브라우저에 있는 북마크" / "계속하려면 아래에 '삭제'라고 입력해 주세요."
  - 입력칸, [취소], [영구 삭제]. 입력값을 trim 한 결과가 `t('삭제')` 와 같을 때만 영구 삭제가 켜진다.
- 진행 중에는 버튼을 잠그고 "삭제하는 중…". 성공하면 `BookmarkLibrary.logout()` → 계정 탭을 로그아웃 화면으로 다시 그리고
  "계정을 삭제했어요" 안내. 헤더 프로필 표시는 로그아웃과 같은 경로로 사라진다.
- 실패: 패널 안에 문구를 띄우고 재시도 가능. 429 "잠시 후 다시 시도해 주세요", 503·네트워크 오류 "지금은 계정을 삭제할 수 없어요".

### 410 공통 처리

- `userData.js` 에 `UserData.handleAccountDeleted()` — 로그아웃하고, 탭당 한 번 "삭제된 계정이라 로그아웃됐어요" 안내.
- 410 을 받는 곳: `userData.js`(동기화·불러오기·404 재가입 경로), 프로필 저장소(`profileStore`), `bookmarkLibrary.js`(게시·수정·소유 연결).
- 로그인 창(`authModal.js`): 삭제된 코드로 로그인하면 "삭제된 계정의 코드예요" 를 보여 주고 로그인하지 않는다.

### 관리 페이지 프로필 탭 (`adminPage.js`)

- 줄마다 "계정 삭제" 버튼. confirm: "이 프로필의 계정을 삭제할까요? 프로필, 랭킹 기록, 프로필로 게시한 공개 서재가 바로 지워지고,
  서버에 저장된 북마크는 그 사람이 다음에 접속할 때 지워져요. 되돌릴 수 없어요." 성공하면 줄을 목록에서 뺀다.
- 기존 "삭제" 버튼 이름을 "프로필 삭제" 로 바꾼다.

### 번역·테마

- 새 문구는 `I18n.t` + English/Japanese 번역. i18n JSON 을 고쳤으므로 `python src/scripts/10_update_data_version.py` 로 `DATA_VERSION` 을 올린다.
- 패널은 설정창 기존 변수와 `is-danger` 버튼을 써서 라이트·다크 모두 맞춘다.

## 3. 테스트와 배포

### 서버 테스트 (`tests/account-delete.test.cjs`, `tests/helpers/workerHarness.cjs`)

- 사용자 삭제: 가입 → 프로필 → 서재 게시 → 프로필 랭킹 등록 → 태그 투표·끌올 → `/user/delete`. 계정 본체·소유 색인·서재 원본과 목록 색인·
  프로필·연결 행·랭킹 줄이 없고, 태그 투표·끌올 행은 남으며 투표자 목록에서 익명.
- 되살아나지 않음: 삭제한 코드로 signup·get·sync·profile/save·서재 게시가 모두 410.
- 멱등: `/user/delete` 두 번째 호출도 `ok`. 3단계 실패를 흉내 낸 뒤 다시 부르면 나머지가 지워진다.
- 남의 서재 보호: 소유 색인에 남의 코드가 섞여 있어도 주인이 맞지 않으면 지우지 않는다.
- 관리자 삭제: 프로필·연결 행·랭킹 줄·같은 `profileId` 의 서재가 바로 사라지고 표식 `pending = 1`. 그 코드의 다음 요청에서 410 과 함께
  계정 본체가 지워지고 `pending = 0`. `admin_actions` 기록.
- 프로필 없는 계정의 사용자 삭제도 정상.
- 표식 테이블이 없을 때: `/user/delete` 503, 로그인·동기화는 그대로.

### 브라우저 테스트 (vm, `tests/profile-client.test.cjs` 방식)

- '삭제' 입력 전에는 영구 삭제 버튼이 꺼져 있다. 성공하면 로그아웃이 불린다.
- 410 공통 처리가 로그아웃하고 안내는 한 번만.
- 새 문구가 i18n 목록에 있다.

### 마무리 확인

- `npm test` 전부 통과, `npm run build` 성공.
- 로컬 wrangler dev 에서 설정창 삭제 흐름과 관리 페이지 계정 삭제를 라이트·다크로 확인.

### 배포 (사용자가 직접 실행)

- 원격 D1 스키마를 먼저 적용한다(모두 IF NOT EXISTS):
  `cd src && npx wrangler d1 execute cpkg-tags --remote --file=../worker/profile_schema.sql`
- 적용 전에 배포되면 `/user/delete`·관리자 계정 삭제만 503 이고 나머지 기능은 그대로다.
