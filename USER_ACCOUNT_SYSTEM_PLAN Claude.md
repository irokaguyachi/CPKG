# 개인 코드 → 진짜 "유저 데이터" 계정 전환 기획

작성일: 2026-08-22. **이 문서는 기획 전용이며, 아직 아무 코드도 수정하지 않았다.**
실제 구현은 별도 세션에서 이 문서를 보고 착수한다.

---

## 🔴 조사 결과: 지금 로그인이 실제로 동작하지 않는 이유 (2026-08-22 추가)

아래 "왜 바꾸나" 절 이하의 기획 내용(personalCode의 구조적 한계)은 코드(`auth.js`,
`authModal.js`, `bookmarkLibrary.js`, `bookmarks.js`, `worker/favoritesShareWorker.js`)와
대조해 확인했고, 서술된 그대로 정확하다. 다만 그보다 더 급하고 더 근본적인 문제가
하나 있다 — **애초에 지금 배포된 실서버가 클라이언트 코드보다 낡아서, "로그인"이라는
기능 자체가 프로덕션에서 완전히 죽어 있다.**

### 확인한 사실

- 클라이언트(`bookmarkLibrary.js`)의 로그인 흐름은 `claimAllByPersonalCode()` →
  `POST /owner/lookup`을 호출해 이 개인 코드로 게시된 목록을 받아온다.
- 실서버 `chokaguya-favorites-share.nwb10102.workers.dev`에 직접
  `POST /owner/lookup`을 호출해보니 **404**가 돌아왔다 — 이 라우트 자체가 아직 없는
  옛 버전이 떠 있다는 뜻(정상 배포됐다면 코드가 없어도 `{items:[],total:0}`을
  200으로 반환해야 한다).
- 같은 방식으로 `POST /library/<code>/claim-owner`(헤더의 "이 브라우저의 기존
  코드들을 여기 연결하기" 버튼이 부르는 라우트)도 배포되지 않았을 것으로 보인다 —
  같은 커밋(`9139a26`)에서 함께 추가됐고 소스에만 존재한다.
- `POST /library`(북마크 공개 게시)에 `personalCode` 필드를 얹어 호출해보면 에러
  없이 201로 정상 처리된다 — 옛 서버는 이 필드를 그냥 모르는 채 무시하고 게시만
  진행한다(클라이언트 쪽 `validateLibraryCreate`가 필드를 optional로 다루는 것과
  맞물려 겉보기엔 "성공"으로 보인다). 하지만 서버가 `ownerHash`를 세팅하지 않으므로
  이 게시물은 실제로는 어떤 개인 코드에도 연결되지 않은 채 남는다.
- `git log`/`git status`로는 `worker/`가 이미 커밋되어 있고 워킹 트리도 깨끗함 —
  즉 **코드 문제가 아니라 순수하게 배포 문제**다. 세션 메모리
  (`bookmark-library-personal-code-deploy-pending`)에도 2026-08-21에 같은 사실이
  기록되어 있었고, 오늘 재확인해도 그대로다.

### 결과적으로 지금 무엇이 되고, 무엇이 안 되는가

| 동작 | 상태 |
|---|---|
| 회원가입(새 개인 코드 발급, `issueNewPersonalCode`+`confirmPersonalCode`) | **정상** — 순수 로컬 동작이라 서버 배포와 무관 |
| 북마크 공개 게시(`publish`) | **정상** — 다만 `personalCode`가 무시되어 개인 코드에 연결되지 않은 채 게시됨 |
| "이 코드로 로그인"(`claimAllByPersonalCode` → `/owner/lookup`) | **항상 실패** — 라우트 자체가 404 |
| "이 브라우저의 기존 코드들을 여기 연결하기"(`claim-owner`) | **항상 실패**로 추정 — 같은 미배포 커밋에 포함 |
| 로그아웃 | **정상** — 로컬 스토리지만 지움 |

즉 지금 사용자 눈에는 "로그인 코드를 넣었는데 항상 '아직 공개한 게 없거나 코드가
틀렸다'는 에러만 뜬다"로 보일 것이다 — 실제로는 코드가 맞아도 서버가 그 라우트를
아예 모르기 때문에 절대 성공할 수 없는 상태다.

### 조치

- `cd worker && npx wrangler deploy`로 재배포해야 이 문제가 풀린다. 이 저장소
  규칙상 프로덕션 배포는 사용자 승인 없이 임의로 실행하지 않았다 — 이번 조사에서도
  배포는 하지 않았고, 라우트 존재 여부 확인을 위해 `POST /library`로 빈 테스트
  게시물 하나(`library/Mi3pX8gJ.json`, name: `probe-test`)를 실제 프로덕션 버킷에
  만들었다. 삭제(`DELETE /library/Mi3pX8gJ`, editToken: `kcvDteUiy3bZrTyoRB08GesB`)는
  권한 정책에 막혀 이 세션에서 실행하지 못했으니, 정리가 필요하면 알려달라.
- 재배포 전까지 배포 갭 동안 게시된 북마크(`personalCode`를 보냈지만 무시된 것들)는
  재배포 후에도 자동으로 개인 코드에 연결되지 않는다 — `claim-owner` 마이그레이션
  버튼으로 사후 연결해야 하므로, 배포 시점을 기준으로 그 사이 게시분이 있는지 한 번
  점검할 필요가 있다.
- 아래 "유저 데이터 계정 전환" 기획은 이 배포 갭과는 별개의, 더 다음 단계 작업이다.
  지금 만들어져 있는 개인 복구 코드 기능부터 실제로 배포해서 동작을 확인한 뒤에
  착수하는 게 순서상 맞다.

### 코드 자체의 문제는 없었는지

`auth.js`/`authModal.js`/`sidebar.js`가 전 페이지(`bookmarksPage.html`,
`HOFPage.html`, `mainPage.html`, `novelPage.html`, `OfficialPage.html`,
`seriesPage.html`)의 `<script>` 태그에 빠짐없이 포함되어 있고, `.header-nav`/
`.sidebar`/`.sidebar-toggle-btn` 요소도 각 페이지 HTML에 정상적으로 존재한다 —
스크립트 누락이나 DOM 훅 불일치 같은 프런트엔드 배선 문제는 발견되지 않았다.
(`mainPage.html`만 `bookmarks.js`가 빠져 있는데, 이건 주석에 이미 의도로 명시된
정상 설계다 — 그 페이지엔 로컬 북마크 목록 자체가 없으므로.)

## 왜 바꾸나

지금 `personalCode`("로그인")는 계정이 아니라 **공개 게시물의 소유권 증명**일 뿐이다.

- `worker/favoritesShareWorker.js`가 실제로 저장하는 건 두 종류뿐:
  - `library/<code>.json` — 사용자가 "공개 게시"를 누른 북마크 하나의 스냅샷(`name`, `items`, `editTokenHash`, `ownerHash`).
  - `owners/<sha256(personalCode)>.json` — 이 개인 코드가 게시한 `library` code 목록 인덱스. 조회 편의용일 뿐 권한 증명 자체는 각 레코드의 `ownerHash`가 한다.
- `src/js/bookmarkLibrary.js`의 `isLoggedIn()`은 그냥 "이 브라우저 localStorage에 personalCode가 있는가"이고, "로그인해서 불러오기"(`claimAllByPersonalCode` → `restorePublishedToLocal`)도 결국 **이 코드로 예전에 공개 게시한 것들의 목록**을 서버에서 받아와 로컬로 복사하는 것뿐이다.
- 정작 진짜 북마크 데이터(`src/js/bookmarks.js`, `localStorage["chokaguya_bookmarks"]`, `{ version:1, bookmarks:[{id,name,createdAt,items}] }`)는 **완전히 로컬**이다. 서버에는 전혀 존재하지 않는다. 그래서 "공개 게시"를 누르지 않은 북마크는 다른 기기에서 절대 못 본다 — 로그인의 의미가 사실상 없다.

원하는 그림: personalCode를 진짜 계정 키로 쓰고, 그 계정 아래에 **북마크 전체(비공개 포함)**, 그리고 향후 **좋아요** 같은 유저 전용 데이터를 통째로 얹는 `user/<code>.json` 오브젝트 하나를 만든다. 로그인 = 이 오브젝트를 받아와 로컬과 동기화하는 것.

## 새 데이터 모델

### 서버: `user/<sha256('user:'+personalCode)>.json`

```json
{
  "v": 1,
  "bookmarks": [
    { "id": "abc123", "name": "내 북마크", "createdAt": 1755800000000, "items": [{ "type": "novel", "id": 1318 }] }
  ],
  "likes": [
    { "type": "novel", "id": 1318, "likedAt": 1755800000000 }
  ],
  "updatedAt": 1755800000000
}
```

- `bookmarks` 배열의 형태는 `src/js/bookmarks.js`의 로컬 저장 형태(`{id,name,createdAt,items}`)와 **의도적으로 동일**하게 잡는다 — 로컬 스토어를 그대로 직렬화해서 올리고, 받은 걸 그대로 로컬 스토어에 앉히면 되도록. 변환 계층을 최소화하는 게 목적.
- `likes`는 지금 당장은 빈 배열로만 두고, 실제 좋아요 기능은 이번 기획 범위 밖(설계만 자리를 잡아둔다).
- 오브젝트 키는 `owners/` 인덱스와 같은 이유로 `personalCode` 원문이 아니라 해시로 만든다 — 이 버킷은 `pub-*.r2.dev`로 전체 공개 읽기이므로, 키 자체가 사람이 추측 못 하는 값이어야 한다.

### personalCode의 역할 변화

- 지금: "공개 게시물 여러 개를 하나로 묶어 보는 조회 편의 키" + "그 게시물들의 수정 권한 중 하나".
- 이후: **그 자체로 계정 자격 증명**. `user/<hash>.json`을 통째로 읽고 쓸 수 있는 유일한 열쇠. 별도의 `editToken`/`ownerHash` 이중 증명 체계가 필요 없다 — 유저 데이터는 애초에 비공개이고 소유자가 한 명(그 코드를 아는 사람)뿐이므로.

## 동기화 전략 (초안)

- **로그인(코드 입력 또는 새 코드 발급 확인) 시점**: 서버에 `GET /user`(personalCode를 body/헤더로) 호출 → 있으면 그 `bookmarks`로 로컬 `chokaguya_bookmarks`를 교체, 없으면(첫 로그인) 지금 로컬에 있는 북마크를 그대로 첫 업로드해서 서버 쪽 유저 데이터를 새로 만든다.
- **로컬 변경 시점**(북마크 생성/이름변경/삭제/아이템 추가삭제, 향후 좋아요 토글): 로그인 상태일 때만, 디바운스(예: 1~2초) 후 `PUT /user`로 로컬 스토어 전체를 스냅샷 업로드. 지금 게시(publish)가 이미 쓰는 "통째로 덮어쓰기" 패턴을 그대로 재사용 — 항목 단위 diff는 만들지 않는다(초기 버전에서는 단순함을 우선).
- **비로그인 상태**: 지금과 동일하게 완전 로컬만 사용, 서버 동기화 없음. 로그인은 여전히 선택 사항으로 남는다.
- **다중 기기 충돌**: 처음 버전은 `updatedAt` 비교조차 없이 **마지막에 PUT한 쪽이 이긴다**(last-write-wins, 통째로 덮어쓰기). 두 기기를 동시에 쓰는 사람이 드물 것이라 가정하고 단순하게 시작 — 나중에 실제로 데이터 유실 사례가 생기면 그때 `updatedAt` 비교나 병합 로직을 추가한다.

## 기존 "공개 게시 라이브러리" 기능과의 관계

공개 게시(다른 사람이 볼 수 있는 공유 링크, `library/<code>.json`)는 **그대로 유지**한다 — 이건 "계정"과는 다른 목적(누구나 볼 수 있는 스냅샷 공유)이라 없앨 이유가 없다. 다만 이제 이렇게 재배치된다:

- 게시(publish)할 때 원본은 이제 유저 데이터의 북마크 하나가 된다. 게시는 여전히 그 시점의 **스냅샷 복사본**을 `library/`에 새로 만드는 것 — 원본을 나중에 고쳐도 이미 게시된 공유 링크는 안 바뀌는 지금 특성을 그대로 유지.
- **`owner/lookup` + `claim-owner` 라우트는 이 전환으로 사실상 대체된다.** 지금 이 둘이 하던 일("이 코드로 예전에 공개한 것들을 되찾기")은, 로그인하면 `user/<hash>.json` 하나로 이미 다 들어있게 되므로 더 이상 필요 없어진다. 완전 제거는 마이그레이션 기간을 두고 나중에 결정(아래 마이그레이션 절 참고) — 이번 기획에서 삭제까지 확정하지는 않는다.

## 마이그레이션 (기존 사용자 보호)

- 이미 personalCode로 여러 개 게시해둔 사용자가, 새 유저 데이터 시스템으로 처음 로그인할 때 `user/<hash>.json`이 아직 없는 경우: 예전처럼 `owner/lookup`을 1회 호출해 "이 코드로 게시된 것들"을 가져오고, 그 항목들을 유저 데이터의 `bookmarks`에 시드로 채워 넣은 뒤 새로 `user/<hash>.json`을 생성한다. 이후로는 `owner/lookup` 없이 `user` 라우트만 쓴다.
- 이 마이그레이션은 "유저 데이터가 서버에 아직 없을 때 한정"으로만 실행되므로, 한 번 유저 데이터가 생기고 나면 두 번 다시 안 돈다(중복 시드 방지).

## 구현 범위 (실제 착수 시 파일 단위 체크리스트)

**백엔드 — `worker/favoritesShareWorker.js`**
- [ ] `GET /user` (body 또는 쿼리로 personalCode) — 유저 데이터 조회, 없으면 `owner/lookup` 폴백 시드 로직 포함해 `{ bookmarks, likes, updatedAt, seeded: true|false }` 형태로 응답
- [ ] `PUT /user` — 통째로 덮어쓰기, `bookmarks`/`likes` 형태 검증(개수·크기 상한 필요 — `LIBRARY_MAX_ITEMS`류 상수 재사용 검토)
- [ ] rate limit 버킷 추가(`user-read`, `user-write`)
- [ ] 기존 `owner/lookup`, `claim-owner`는 당장 유지(제거는 별도 결정)

**프론트엔드**
- [ ] 신규 `src/js/userData.js`: `GET/PUT /user` 래퍼 + 동기화 디바운스, `chokaguya:bookmarks-change` 같은 이벤트를 구독해 로컬 변경을 감지(현재 `bookmarks.js`에 변경 이벤트가 있는지부터 확인 필요 — 없으면 최소 훅 추가)
- [ ] `src/js/bookmarks.js`: **데이터 모델과 로컬 저장 로직 자체는 그대로 둔다**(최우선 규칙 — 이 파일은 건드리지 않기로 이미 합의됨). 동기화는 바깥에서 이 모듈의 공개 함수만 호출하는 방식으로 얹는다.
- [ ] `src/js/bookmarkLibrary.js`: `isLoggedIn`/로그인·로그아웃 흐름은 유지하되, 로그인 성공 시점 훅에 `userData.js`의 최초 동기화 호출을 연결
- [ ] `src/js/authModal.js`: 로그인 완료 후 "유저 데이터 동기화 중" 상태 표시 여부 검토(첫 로그인은 `owner/lookup` 폴백까지 있어 느릴 수 있음)

## 확인이 필요한 지점 (구현 착수 전 결정)

1. **공개 게시 라이브러리 기능을 계속 남길지** — 이 문서는 "남긴다"로 가정하고 설계함. 맞는지.
2. **좋아요 기능의 대상 범위** — 게시물(novel/series/hof/official) 전체에 거는 건지, 특정 타입만인지는 아직 미정. `likes` 스키마는 지금 `{type,id}` 형태로 열어만 뒀다.
3. **동기화 시점** — "로그인 상태면 항상 자동 동기화"로 가정. 대신 수동 "동기화" 버튼을 따로 두고 싶은지.
4. **로컬-서버 충돌 시 last-write-wins로 시작하는 것**에 동의하는지, 아니면 처음부터 `updatedAt` 비교 정도는 넣을지.

이 네 가지만 확정되면 바로 구현 계획(파일별 diff 단위)으로 넘어갈 수 있다.
