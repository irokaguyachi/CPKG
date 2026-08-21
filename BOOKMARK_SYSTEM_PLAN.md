# 📑 북마크 시스템

이 문서는 옛 "즐겨찾기"(타입별 고정 4버킷 별표)를 대체한 **북마크**(이름 있는 다중 목록, 유튜브 재생목록 방식) 시스템의 현재 구현 상태를 정리한 것입니다. 원래는 전환 작업 전에 쓴 계획 문서였고, 계획대로 구현이 끝난 뒤 실제 구조에 맞춰 다시 정리했습니다. 다른 PC에서 이 저장소를 `git pull` 받아 개발을 이어갈 때 참고하세요.

기존 "즐겨찾기" 문서(`FAVORITES_SYSTEM.md`)는 이 전환으로 완전히 대체되어 삭제했습니다.

---

## 1. 전체 구조

```
[브라우저 localStorage]                    [Cloudflare Worker]              [Cloudflare R2]
  chokaguya_bookmarks      --공개하기-->   chokaguya-favorites-share  --put/get-->  chokaguya-assets
  { version:1, bookmarks:[...] }           (worker/favoritesShareWorker.js)        (library/<code>.json)
  chokaguya_library_tokens                                                         (owners/<indexHash>.json)
  { "<code>": { editToken, bookmarkId } }
  chokaguya_personal_code
  "<20자 개인 복구 코드>"
```

- **기본은 로컬 저장.** 내 북마크를 만들고 담는 동작은 서버 없이 완전히 동작합니다.
- **공개한 것만 서버로.** 북마크를 "라이브러리에 공개"했을 때만 그 북마크 하나가 R2로 올라가고, 다른 사람이 둘러볼 수 있게 됩니다 (아래 5번).
- 한 항목(게시물/시리즈)은 **여러 북마크에 동시에** 담길 수 있습니다 (유튜브 재생목록처럼 다중 소속).
- 마이그레이션 없음: 기존 `chokaguya_favorites` localStorage 키는 건드리지 않고 그대로 방치, 새 데이터는 `chokaguya_bookmarks`라는 새 키로 시작합니다.

---

## 2. 파일 목록

| 파일 | 역할 |
|---|---|
| `src/js/bookmarks.js` | 로컬 저장소 core. `getAllBookmarks()` / `getBookmark(id)` / `createBookmark(name)` / `renameBookmark(id,name)` / `deleteBookmark(id)` / `isInBookmark(bookmarkId,type,id)` / `isInAnyBookmark(type,id)` / `getBookmarksContaining(type,id)` / `addItemToBookmark` / `removeItemFromBookmark` / `toggleItemInBookmark` |
| `src/js/bookmarkPicker.js` | 카드에 붙는 북마크 리본 아이콘 버튼 + 클릭 시 뜨는 "담을 북마크 고르기" 팝오버(체크리스트 + 인라인 "새 북마크 만들기"). `document.body`에 append하는 싱글턴 팝오버(`position: fixed` + `getBoundingClientRect()` 좌표 계산) — `.series-card { overflow: hidden; }`가 카드 밖으로 나가는 절대배치 자식을 잘라버려서 상대배치로는 불가능했음 |
| `src/js/bookmarksPage.js` + `src/page/bookmarksPage.html` | 북마크 탭. 쿼리 파라미터로 4개 모드를 한 페이지가 처리 — 없으면 내 북마크 목록, `?tab=library` 라이브러리 목록, `?id=` 내 북마크 상세, `?libraryId=` 공개 북마크 상세 |
| `src/js/bookmarkLibrary.js` | 라이브러리 Worker 클라이언트, 개인 복구 코드 관리 포함 (5번 참고) |
| `src/js/authModal.js` | 로그인/회원가입 모달(사이트 전역, Figma SignInFrame/SignUpFrame 반영, 5-2번 참고) |
| `src/js/auth.js` | 헤더의 로그인/개인 코드 관리 버튼 주입 + 관리 패널(사이트 전역, 5-2번 참고) |
| `src/js/gridPage.js` | 시리즈/명예관/공식/문학 그리드 카드에 북마크 버튼 연결 (`global.BookmarkPicker.createButton(config.favType, favId)`) |
| `worker/favoritesShareWorker.js` + `worker/wrangler.toml` | Cloudflare Worker. `/library`, `/library/<code>/claim-owner`, `/owner/lookup` 라우트를 들고 있습니다(옛 `/share` 는 제거). 파일명은 이력상 그대로입니다 — 바꾸면 `wrangler.toml` 의 `main` 도 같이 고쳐야 합니다 |

**삭제됨:** `favorites.js`, `favoritesPage.js`, `favoritesPage.html`, `FAVORITES_SYSTEM.md`

**삭제됨 (옛 즐겨찾기 공유 인프라, 2026-08-21 정리):** `favoritesCodec.js`, `favoritesShareRemote.js`, `favoritesShare.js`, `sharedFavoritesPage.html`/`.js`, 그리고 Worker의 `/share` 라우트(`handleShare`/`handleGetShare`/`validatePayload`와 거기서만 쓰던 상수 포함). 어느 페이지에서도 로드되지 않는 죽은 코드였고, `/share` 의 공개 쓰기 엔드포인트에는 레이트리밋이 없어 그대로 두면 무방비로 열린 상태라 함께 제거했습니다.

---

## 3. 저장 형식

### `localStorage['chokaguya_bookmarks']`
```json
{
  "version": 1,
  "bookmarks": [
    {
      "id": "m3k2f9x1a2b",
      "name": "재밌게 본 것들",
      "createdAt": 1755600000000,
      "items": [
        { "type": "novel", "id": 123456 },
        { "type": "series", "id": 234567 }
      ]
    }
  ]
}
```
- `id`: `Date.now().toString(36) + Math.random().toString(36).slice(2, 8)` — 로컬 전용이라 충돌 검사 불필요
- `items[].id`: **대표 게시물 번호**(디시 게시물 번호) — 시리즈/명예관/공식/문학 모두 `posts[0].id`(1화 게시물 번호)를 씀
- 저장 형태가 깨져 있으면(`version`/`bookmarks` 배열/각 항목의 `id,name,items` 형태 검증 실패) 마이그레이션 시도 없이 `{version:1, bookmarks:[]}`로 리셋
- 동기 localStorage 읽기는 메인 스레드를 막으므로 `bookmarks.js` 내부에 `cache` 변수로 캐싱, 쓰기 때만 실제 localStorage를 건드림. 다른 탭에서 값이 바뀌면 `storage` 이벤트로 캐시를 무효화

---

## 4. 동작 요약

- **카드의 북마크 버튼**: `Bookmarks.isInAnyBookmark(type,id)`로 초기 채움 상태 결정. 클릭은 토글이 아니라 팝오버를 엶(한 항목이 여러 북마크에 들어갈 수 있어 클릭 한 번 = on/off가 성립하지 않음)
- **팝오버**: 내가 만든 북마크 전부를 체크박스 행으로 표시, 행 클릭 시 `toggleItemInBookmark` → 체크 상태/카드 아이콘 갱신. 맨 아래 "+ 새 북마크 만들기" 인라인 입력이 항상 표시됨. 북마크가 하나도 없으면 안내 문구
- **북마크 탭 목록 모드** (`bookmarksPage.html`, `?id=` 없음): `Bookmarks.getAllBookmarks()`로 폴더 카드 그리드. 커버 이미지 자리엔 아이콘 placeholder만 표시(목록 모드에서 `Novel/Series/HOF/Official.json` 4개를 전부 fetch하는 비용을 피하기 위함). 카드 클릭 → `bookmarksPage.html?id=<id>` 이동. 인라인으로 이름 변경(연필 버튼)·삭제(모서리 버튼, `confirm` 확인) 가능
- **북마크 탭 상세 모드** (`?id=<북마크id>`): `Novel/Series/HOF/Official.json` 4개를 병렬 fetch(`Promise.all`) 후 `SeriesUtil.assignPostNumbers`/`assignSeriesNumbers` 적용, id로 조회맵 생성. 그리드는 하나로 두고 상단에 **타입 필터 칩**(`전체 / 문학 / 시리즈 / 명예관 / 공식`)을 둡니다. 기본값 `전체`에서는 `bookmark.items` 저장 순서 그대로 보이고(문학/시리즈가 섞여도 담은 순서 유지), 칩을 누르면 그 타입만 남습니다. 항목이 없는 타입은 칩 자체를 숨기고, 타입이 한 종류뿐이면 칩 바를 통째로 감춥니다. 보고 있던 타입의 마지막 항목을 해제하면 `전체`로 되돌아가며 그리드를 다시 그립니다. 카드의 북마크 버튼엔 `{ viewingBookmarkId, onRemovedFromCurrentView }`를 넘겨서, 지금 보고 있는 북마크를 팝오버에서 해제하면 새로고침 없이 카드가 그리드에서 바로 사라짐
- **카드 클릭**: `PostDetailSeries.open(...)`으로 기존 시리즈 상세 모달이 그대로 열림 (그리드 페이지와 동일한 동작)

---

## 5. 북마크 라이브러리 (공개 공유)

내 북마크 하나를 통째로 공개해서 다른 사람이 둘러보게 하는 기능입니다. 로컬 저장이 기본이고, 공개한 것만 서버(Cloudflare Worker + R2)로 올라갑니다.

> ✅ **현재 상태: 2026-08-21 배포 완료.** `RATE_LIMIT_KV` 네임스페이스(`564a89b5…`) 생성 후 `wrangler deploy` 까지 마쳤고, 실서버에서 게시 → 조회 → 목록 → 삭제 왕복과 CORS 프리플라이트를 확인했습니다(7번 참고).

### 파일
| 파일 | 역할 |
|---|---|
| `src/js/bookmarkLibrary.js` | Worker 클라이언트. `publish` / `update` / `unpublish` / `list` / `getOne` / `getPublishedInfo` / `claimToken` (예전 방식) / `getPersonalCode` / `claimAllByPersonalCode` / `migrateExistingToPersonalCode` / `linkLocalBookmark` / `getLocalLinkForCode` (개인 복구 코드, 5-1번 참고) |
| `worker/favoritesShareWorker.js` | `/library`, `/library/<code>/claim-owner`, `/owner/lookup` 라우트 (아래 표) |

### Worker API
| 메서드 | 경로 | 설명 |
|---|---|---|
| `POST` | `/library` | body `{name, items, personalCode?}` → `{code, editToken}` 반환. editToken은 **이 응답에서 딱 한 번만** 나옴. `personalCode`를 같이 보내면 그 자리에서 이 레코드를 그 개인 코드에 연결함 |
| `GET` | `/library?sort=&q=&offset=&limit=` | 목록. `sort`는 `new`(기본, 공개 최신순)/`updated`/`name`, `q`는 이름 부분검색. R2 `customMetadata`에 이름·개수·생성시각을 같이 저장해둬서 항목마다 GET 하지 않음 |
| `GET` | `/library/<code>` | 상세 `{code, name, items, createdAt, updatedAt}` |
| `PUT` | `/library/<code>` | body `{editToken?, personalCode?, name?, items?}` → 갱신. 인증은 둘 중 하나만 맞으면 통과(`verifyLibraryAuth`) |
| `DELETE` | `/library/<code>` | body `{editToken?, personalCode?}` → 삭제. 인증 규칙은 위와 동일 |
| `POST` | `/library/<code>/claim-owner` | body `{editToken, personalCode}` → 기존 editToken으로 소유권을 증명해 그 레코드를 개인 코드에 연결(5-1번, "1회성 마이그레이션") |
| `POST` | `/owner/lookup` | body `{personalCode}` → `{items:[{code,name,itemCount,createdAt,updatedAt}], total}`. 그 개인 코드에 연결된 공개 북마크 전부의 요약(5-1번, "전체 되찾기") |

### 소유권 (로그인 없이)
로그인 시스템이 없으므로 "내가 올린 것"이라는 증명은 게시 시 서버가 한 번 돌려주는 `editToken`을 브라우저가 들고 있는 것으로 대신합니다 (pastebin류의 삭제 키 패턴). `localStorage['chokaguya_library_tokens']` → `{ "<code>": { editToken, bookmarkId } }`. `editToken`은 이 브라우저·이 북마크 하나에만 묶이는 값이라, 여러 개를 공개할수록 코드를 여러 벌 관리해야 하는 문제가 있었습니다 — 이를 해결한 것이 아래 5-1번 개인 복구 코드입니다.

> 🔐 **이 R2 버킷은 `pub-*.r2.dev`로 전체 공개 read이므로, editToken 원문은 절대 저장하지 않고 SHA-256 해시(`editTokenHash`)만 저장합니다.** `GET /library/<code>` 응답을 만들 때도 이 필드는 반드시 빠져야 합니다 — R2 body 를 그대로 프록시하면 안 되고, `libraryPublicView()` 가 내려줄 필드만 골라 담는 화이트리스트 방식이라 새 필드를 추가해도 실수로 새지 않습니다. 아래 5-1번의 `ownerHash`도 같은 이유로 이 화이트리스트에서 제외해 공개 응답에 실리지 않습니다.

토큰을 잃으면(브라우저 데이터 삭제, 기기 변경) 그 게시물은 수정·삭제할 수 없습니다. 그래서 게시 직후 관리 코드를 한 번 보여주고 백업을 권합니다 — 다만 이제는 같은 화면에서 "이 북마크는 개인 코드에도 자동으로 연결됐다"고 함께 안내하므로, 보통은 이 코드를 따로 적어둘 필요 없이 개인 코드 하나로 충분합니다.

---

## 5-1. 개인 복구 코드 (여러 북마크를 코드 하나로)

**배경**: editToken 방식은 공개한 북마크마다 code+editToken 한 쌍이 따로 생기기 때문에, 다른 기기에서 여러 개를 되찾으려면 그 쌍을 북마크 수만큼 반복 입력해야 했습니다. 정식 로그인(이메일/비밀번호, OAuth)도 검토했지만, 이 프로젝트엔 계정·세션·이메일 발송 같은 인증 인프라가 전혀 없어 사이트 규모에 비해 과한 작업이라 판단해 만들지 않았습니다. 대신 **비밀번호 없는 브라우저 단위 "계정"** 역할을 하는 개인 복구 코드를 추가했습니다.

### 클라이언트: 개인 코드 발급·저장
`src/js/bookmarkLibrary.js`가 브라우저마다 한 번, 헷갈리기 쉬운 글자(`0/O`, `1/I/L`)를 뺀 알파벳으로 20자 코드를 생성해 `localStorage['chokaguya_personal_code']`에 저장합니다(`getPersonalCode()` — 없으면 그 자리에서 생성). 이후 이 브라우저에서 나가는 모든 `POST/PUT/DELETE /library` 요청에 이 코드가 자동으로 실립니다. 표시할 때는 5자씩 대시로 묶어(`formatPersonalCodeForDisplay`) 가독성을 높이고, 사용자가 입력할 땐 대시·공백·대소문자를 정규화(`normalizePersonalCode`)해서 원래 저장 형태(대시 없는 대문자 20자)와 항상 같은 값으로 비교합니다.

### 서버: ownerHash와 owners/ 인덱스
개인 코드도 editToken과 같은 보안 패턴을 따릅니다 — 서버엔 원문이 저장되지 않고, `ownerHash = sha256('owner:'+code+':'+personalCode)`만 레코드에 저장됩니다. 레코드 자신의 공개 코드(`code`)를 해시에 함께 섞어 넣은 게 핵심으로, 같은 사람이 올린 북마크 두 개라도 `ownerHash` 값이 서로 달라집니다 — 공개 버킷(`pub-*.r2.dev`)을 통째로 긁어봐도 이 값들만으로는 "같은 사람 것"이라는 상관관계가 드러나지 않습니다.

R2 `list()`는 키(프리픽스) 순서로만 훑을 수 있고 임의 필드로 조회할 수 없어서("이 개인 코드가 가진 code 목록"을 바로 질의할 방법이 없음), 대신 인덱스 오브젝트를 둡니다:
```
owners/<sha256('owner-index:'+personalCode)>.json
{ "v": 1, "codes": ["ABC12345", "XyZ98765", ...] }
```
게시(`personalCode` 포함)나 `/claim-owner` 성공 시 이 인덱스에 code를 추가합니다. **이 인덱스는 조회 편의용일 뿐 권한 증명의 근거가 아닙니다** — `PUT`/`DELETE`의 실제 인증은 항상 레코드 자신의 `ownerHash`를 확인하므로, 인덱스 갱신이 실패해도(베스트 에포트) 그 레코드는 personalCode로 여전히 정상 인증됩니다. 인덱스가 없으면 그 레코드가 "전체 되찾기" 목록에만 안 뜰 뿐입니다. 이미 삭제된 code가 인덱스에 남아 있으면 `/owner/lookup` 조회 시 `head()`가 404를 반환하는 걸 신호로 그때 정리합니다(별도 배치 작업 없음).

### 흐름 1 — 이후 공개하는 것은 자동으로 연결됨
`publish()`가 매번 `personalCode`를 실어 보내므로, 이 기능이 추가된 뒤 공개하는 북마크는 별도 조작 없이 전부 이 브라우저의 개인 코드에 연결됩니다.

### 흐름 2 — 다른 기기에서 개인 코드 하나로 전체 되찾기(=로그인)
`claimAllByPersonalCode(rawCode)`가 `POST /owner/lookup`으로 요약 목록을 받아온 뒤, 성공하면 **이 브라우저도 그 개인 코드를 채택**합니다(`adoptPersonalCode` — 앞으로 이 기기에서 공개하는 것도 같은 코드로 이어지도록, 동시에 `chokaguya:auth-change` 이벤트도 쏨). 받아온 항목마다 `getOne(code)`로 실제 내용을 가져와 로컬 북마크로 복원하고 `linkLocalBookmark`로 그 code에 연결하는 로직은 `bookmarkLibrary.js`의 `restorePublishedToLocal(code)`로 옮겨졌습니다(5-2번 UI가 이걸 씀) — 이미 로컬에 연결된 북마크가 있으면 재사용해서, 같은 개인 코드로 반복 실행해도 중복 폴더가 생기지 않습니다. 이렇게 되찾은 북마크는 이 브라우저에 `editToken`을 모른 채로 남지만(`{ editToken: null, bookmarkId }`), 서버 인증이 personalCode만으로도 통과하므로 이후 수정·공개취소에 문제가 없습니다.

### 흐름 3 — 기존(이 기능 이전) 공개물 1회성 마이그레이션
이 기능 추가 전에 이미 공개된 북마크들은 `ownerHash`가 없어 개인 코드로 안 잡힙니다. `migrateExistingToPersonalCode()`가 이 브라우저에 남아있는 `editToken` 보유 항목을 모두 훑어 `POST /library/<code>/claim-owner`를 순차 호출, 성공/실패를 모아 돌려줍니다. 로그인 상태일 때 헤더의 "개인 코드 관리" 패널(`auth.js`)에서 "이 브라우저의 기존 코드들을 여기 연결하기" 버튼으로 실행합니다.

### 흐름 4 — 예전 방식(공유 코드+관리 코드)도 계속 지원, 자동 승격
`claimToken(code, editToken)`(북마크 하나짜리 되찾기)은 그대로 남아 있고, 성공하면 그 자리에서 같은 code를 이 브라우저의 개인 코드에도 연결합니다(`linkToPersonalCode`, 베스트 에포트). 다만 5-2번(사이트 전역 로그인) 도입 후 이 경로는 전용 UI가 없어졌습니다 — `bookmarkLibrary.js`에 함수와 export는 그대로 남겨뒀지만(아주 오래된 게시물을 코드+토큰만으로 복구해야 하는 드문 경우의 안전망), 지금 UI 어디서도 호출하지 않는 죽은 경로입니다. 필요해지면 관리 패널이나 로그인 모달에 다시 노출하면 됩니다.

## 5-2. 사이트 전역 로그인 (Figma SignInFrame/SignUpFrame)

5-1번의 개인 코드를 "로그인"이라는 UX 은유로 사이트 전역(모든 페이지 헤더)에 노출한 것입니다. 실제 인프라(계정/세션/이메일)는 추가되지 않았고, 여전히 5-1번의 개인 코드 그대로입니다 — 이름과 화면만 로그인/회원가입으로 재구성했습니다. Figma 파일 "개인 공간"(node #2222, SignInFrame/SignUpFrame)의 디자인을 반영했습니다.

### "로그인 상태"의 정의가 바뀜
이전에는 `getPersonalCode()`가 코드가 없으면 그 자리에서 자동 생성했습니다 — 즉 전원이 암묵적으로 "로그인"된 상태였고 로그아웃이 성립할 수 없었습니다. 이제 `getPersonalCode()`는 `localStorage['chokaguya_personal_code']`를 순수 조회만 하고(없으면 `null`), 코드 발급은 회원가입 흐름에서만 명시적으로 일어납니다. 기존에 이미 코드를 발급받았던 브라우저는 그대로 로그인 상태로 보이므로 재가입을 강요하지 않습니다.

### 새 API (`bookmarkLibrary.js`)
- `isLoggedIn()` — `!!getPersonalCode()`.
- `issueNewPersonalCode()` — 회원가입 화면이 "확인" 누르기 전 보여줄 후보 코드(순수 함수, 미저장).
- `confirmPersonalCode(code)` — 회원가입 확정(`adoptPersonalCode` 호출). **서버 호출 없음** — Worker에 코드 발급/등록 API가 따로 없고, personalCode는 그 코드로 뭔가를 공개해야만 서버에 흔적이 남기 때문입니다.
- `logout()` — `chokaguya_personal_code`만 삭제(**`chokaguya_library_tokens`는 안 건드림** — 이 브라우저가 직접 editToken을 쥔 게시물은 로그아웃 후에도 여전히 관리 가능, 개인 코드 로그인과 editToken 소유권은 서로 다른 층이라 생기는 당연한 결과).
- `restorePublishedToLocal(code)` — 옛 `bookmarksPage.js`의 `restorePublished`를 옮겨온 것. `Bookmarks` 전역(로컬 북마크 저장소, `bookmarks.js`)이 없는 페이지(`mainPage.html`)에서는 reject되고 호출부가 조용히 무시합니다 — 로그인 자체는 그래도 성공합니다.
- 로그인 상태가 바뀌는 두 지점(`adoptPersonalCode`, `logout`)에서 `window`에 `chokaguya:auth-change` 커스텀 이벤트를 쏩니다 — 헤더 버튼이 새로고침 없이 상태를 동기화하는 데 씀.

### `authModal.js` — 로그인/회원가입 모달
`postDetailSeries.js`의 싱글턴 오버레이 패턴(`position:fixed;inset:0` 딤 배경 + 중앙 카드 + `.is-open` 토글 + scale 팝인, ESC/바깥클릭 닫힘)을 그대로 본떠 `.auth-overlay`/`.auth-card`로 새로 만들었습니다. `global.AuthModal = { openSignIn(opts), openSignUp(opts), close() }` — `opts.reason`(상단 안내문), `opts.onSuccess(code)`(완료 콜백).
- **SignIn**: 코드 입력 → `claimAllByPersonalCode` → 성공하면 반환된 항목마다 `restorePublishedToLocal`을 순차 실행(있으면) → `onSuccess`. `items.length === 0`이면(코드가 틀렸는지, 맞는데 아직 공개한 게 없는지 서버가 구분 못 함 — Worker 한계, 문구로만 완화) 안내 문구를 보여줍니다. "새로 발급받으세요!" 링크로 SignUp 전환.
- **SignUp**: `issueNewPersonalCode()`로 후보 코드 표시(Figma와 동일한 `00000-00000-00000-00000` 형식, `formatPersonalCodeForDisplay` 재사용) → "확인" → `confirmPersonalCode` → `onSuccess`. "이미 코드가 있으신가요? 로그인하기" 링크로 SignIn 전환(Figma에는 없지만, 실수로 새 코드를 또 만드는 걸 막는 안전장치로 추가).
- 카드 자체 클릭에 `e.stopPropagation()`이 걸려 있습니다 — 없으면 이 안의 버튼 클릭이 `document`까지 버블링되어, 다른 UI가 "바깥 클릭하면 닫기"용으로 걸어둔 `document` 클릭 리스너(예: `bookmarksPage.js`의 공유 패널)를 엉뚱하게 트리거해 그 패널이 같이 닫혀버리는 문제가 있었습니다.

### `auth.js` — 헤더 버튼 + 관리 패널
`theme.js`의 `injectThemeToggle()` 패턴(`.header-nav`를 찾아 버튼 append)을 그대로 따라, 모든 페이지 로드 시 헤더에 `.auth-header-btn`을 주입합니다.
- **비로그인**: "로그인" 버튼 → `AuthModal.openSignIn()`(코드 입력창이 먼저 뜸).
- **로그인**: "개인 코드 관리" 버튼(파란색) → 버튼 옆에 뜨는 작은 팝오버(`bookmarkPicker.js`/`openSharePanel`과 같은 앵커 팝오버 패턴, 딤 없음) — 코드 보기·복사, "이 브라우저의 기존 코드들을 여기 연결하기"(마이그레이션, 흐름 3), "로그아웃".
- **북마크 공개하기 게이트**: `bookmarksPage.js`의 `openSharePanel`에서 "라이브러리에 공개하기" 클릭 시 `isLoggedIn()`이 false면 `AuthModal.openSignUp()`을 먼저 띄우고(이번엔 SignUp이 기본 — "북마크 기능을 쓰려면 회원가입부터"), 완료되면 `doPublish()`를 이어서 호출합니다. 게시 게이트는 서버 쓰기가 실제로 일어나는 지점(`publish()`)에만 걸려 있고, 목록/상세 열람(`list`/`getOne`)은 비로그인이어도 그대로 볼 수 있습니다.

### 어느 페이지에 로드되는가
`bookmarkLibrary.js` → `authModal.js` → `auth.js` 순서(뒤 파일이 앞 파일의 전역을 참조)로 **6개 페이지 전부**(`mainPage.html`, `novelPage.html`, `seriesPage.html`, `OfficialPage.html`, `HOFPage.html`, `bookmarksPage.html`)에 로드됩니다. `mainPage.html`은 `pageCommon.css`가 아니라 별도 `mainPage.css`를 쓰는 예외적인 페이지라, `.auth-*`/`.bkm-picker` 계열 CSS를 `mainPage.css`에도 그대로 복제해뒀습니다(두 파일을 같이 고쳐야 함 — 아래 "검증 중 발견해 고친 것" 참고).

### 레이트리밋
공개 목록이 생기면서 스팸 유인이 커졌기 때문에, 라이브러리 기능과 **같이** 추가했습니다 (`TRAFFIC_LAG_AUDIT.md` 3항에서 지적한 문제). `RATE_LIMIT_KV` 바인딩을 써서 IP당 고정 윈도우로 제한:
- 쓰기(`POST`/`PUT`/`DELETE /library`, `POST /library/<code>/claim-owner`): 시간당 20회 (같은 `lib-write` 버킷 공유)
- 목록 조회(`GET /library`): 시간당 120회
- 개인 코드 조회(`POST /owner/lookup`): 시간당 60회 (`owner-lookup` 버킷)

KV는 최종 일관성이라 완벽한 원자성은 아니지만(동시 요청 시 약간의 오차 가능) 스팸 억제엔 충분합니다. **`RATE_LIMIT_KV`가 바인딩되지 않으면 Worker는 레이트리밋을 건너뛰고 동작하므로(fail open), 운영 배포 전에 반드시 네임스페이스를 만들어 `wrangler.toml`의 `id`를 채워야 합니다.**

### UI
북마크 탭 목록 모드 상단에 **내 북마크 | 북마크 라이브러리** 알약 토글 (`?tab=library`). 내 북마크의 폴더 카드 좌상단 공유 버튼을 누르면 공개/업데이트/공개취소 패널이 뜹니다(공개 중이면 아이콘이 초록색). 라이브러리 카드를 클릭하면 `?libraryId=<code>` 상세로 가고, 거기 카드들의 북마크 버튼이 그대로 살아있어서 마음에 드는 항목을 바로 내 북마크에 담을 수 있습니다.

> 개인 코드를 다루는 UI(코드 보기·복사, 다른 기기에서 되찾기, 마이그레이션, 로그아웃)는 더 이상 이 북마크 탭 안에 있지 않고, 사이트 전역 헤더로 옮겨졌습니다 — **5-2번** 참고. "라이브러리에 공개하기" 버튼은 비로그인 상태면 그 자리에서 회원가입 모달을 띄우고, 완료되면 원래 게시를 이어서 진행합니다.

### 목록 정렬·검색
R2 `list()`는 키(랜덤 코드) 순서로만 반환하기 때문에 커서 페이지 하나만 읽어서는 최신순 정렬도 이름 검색도 할 수 없습니다. 그래서 목록 라우트는 `library/` 프리픽스 전체를 훑어(`scanLibrary`) 정렬·필터한 뒤 잘라서 돌려줍니다. 정렬이 바뀌면 커서가 의미를 잃으므로 **offset 페이징**을 씁니다.

폭주 방지로 스캔은 `LIBRARY_SCAN_MAX`(4000건)까지만 하고, 넘으면 응답에 `truncated: true`가 실려 UI가 "일부만 정렬해 보여주고 있어요"를 띄웁니다. 정렬 기준인 `createdAt`은 게시 시 `customMetadata`에 같이 적고 수정 시에도 보존하며, 이 필드가 없던 옛 항목은 `updatedAt`으로 폴백합니다.

이름순은 `localeCompare(b, 'ko')`로 로케일을 못박았습니다 — 런타임 기본 로케일에 기대지 않기 위함이고, 한국어 콜레이션에서는 한글이 라틴 문자보다 앞에 옵니다(가나다 → ABC).

### 관리 코드 복구
브라우저 데이터를 지웠거나 기기를 옮겨 권한을 되찾는 흐름은 이제 개인 복구 코드가 기본입니다 — 자세한 설계는 **5-1번**을 보세요. 공유 코드 하나짜리 예전 방식(`claimToken`)도 그대로 남아 있습니다: 토큰 검증 전용 라우트를 따로 만들지 않고 **아무것도 바꾸지 않는 PUT**으로 확인하며(Worker가 토큰 해시를 먼저 대조하므로 틀리면 403, 맞으면 `name`/`items`를 안 건드리고 성공), 성공하면 `getOne`으로 공개된 내용을 받아 로컬 북마크로 복원한 뒤 그 id에 토큰을 연결합니다. 이 방식으로 되찾으면 그 자리에서 개인 코드에도 자동으로 연결됩니다(5-1번 흐름 4).

---

## 6. 배포 / 로컬에서 확인하기

라이브러리를 뺀 나머지(내 북마크)는 순수 로컬이라 서버 없이 동작합니다:
```bash
python -m http.server 8000
# http://localhost:8000/src/page/bookmarksPage.html
```

라이브러리 기능을 실제로 쓰려면 Worker 배포가 필요합니다:
```bash
npx wrangler login    # 저장소 루트에서 (worker/ 아님 — 아래 설명 참고)
cd worker
npx wrangler deploy
```
KV 네임스페이스는 **이미 만들어져 `wrangler.toml` 에 id 가 채워져 있으므로 다시 만들 필요 없습니다.** (새 계정에 처음 세팅하는 경우에만 `npx wrangler kv namespace create RATE_LIMIT_KV` 로 만들고 출력된 id 를 기입하세요.)

⚠️ `wrangler` 는 `login` 을 포함해 거의 모든 명령에서 `wrangler.toml` 을 먼저 검증합니다. 그래서 `id` 가 비어 있는 상태에서는 `worker/` 안에서 `login` 조차 설정 오류로 막힙니다 — **로그인은 `wrangler.toml` 이 없는 저장소 루트에서** 실행하세요(계정 단위라 위치와 무관하게 적용됩니다).
Worker 주소는 이미 `src/js/bookmarkLibrary.js`의 `WORKER_BASE`에 박혀 있어서(`chokaguya-favorites-share.nwb10102.workers.dev`) `wrangler.toml`의 `name`이 그대로면 주소가 안 바뀌므로 손댈 필요 없습니다.

> ⚠️ **개인 복구 코드(5-1번) 배포 안 됨.** 이 코드가 작성된 시점 기준 실서버엔 옛 버전 Worker가 떠 있어서, `personalCode`/`/library/<code>/claim-owner`/`/owner/lookup`이 아직 반영되지 않았습니다. 클라이언트(`bookmarkLibrary.js`)는 이미 매 게시마다 `personalCode`를 보내지만, 옛 서버는 이를 그냥 무시하고 게시 자체는 정상 처리합니다 — `/owner/lookup`처럼 새 라우트가 아예 없는 요청만 404가 납니다. 즉 **재배포 전까지는 "개인 코드로 되찾기"가 실제로 동작하지 않습니다.** 위 배포 명령(`cd worker && npx wrangler deploy`)으로 반영하세요.

---

## 7. 검증 상태

라이브러리 기능은 다음까지 확인했습니다:

**Worker 로직 (R2/KV를 메모리 목으로 대체)**
- 생성 → editToken 원문이 저장 객체에 **없고** 해시(64자)만 들어감, 저장 본문 어디에도 토큰 문자열이 나오지 않음
- `GET /library/<code>` 응답에서 `editTokenHash` 제거됨 — `libraryPublicView()`가 필드 화이트리스트라 구조적으로 빠짐(새 필드를 추가해도 실수로 새지 않음)
- 목록에 이름·항목수·생성시각이 실리고 `editTokenHash`는 안 실림, items 왕복 무결성
- 잘못된 editToken으로 `PUT`/`DELETE` → 403, 올바른 토큰 → 정상
- 이름 공백/40자 초과, 잘못된 type, 숫자 아닌 id → 400
- 같은 IP 반복 쓰기 → 429, 다른 IP는 영향 없음
- 정렬(`new`/`name`)·검색(`q`, 대소문자 무시)·offset 페이징·`total`/`hasMore` 정상
- `/share` 라우트 제거 후에도 라이브러리 라우트 회귀 없음

**개인 복구 코드 — Worker 로직 (2026-08-21, R2/KV 목)**
- `personalCode` 없이 게시 → `ownerHash: null`, personalCode로 인증 시도하면 403 (연결 안 된 레코드는 개인 코드로 못 건드림)
- `personalCode`와 함께 게시 → 그 즉시 personalCode만으로(editToken 없이) `PUT` 성공
- 연결 전인 레코드에 `personalCode`로 `PUT` 시도 → 403, `/claim-owner`로 연결한 뒤 재시도 → 성공
- `/owner/lookup`이 그 개인 코드에 연결된 레코드만 정확히 반환, 다른 개인 코드로 조회하면 빈 목록
- personalCode로 `DELETE` 성공 후 `/owner/lookup`에서 그 code가 사라짐(삭제된 code가 인덱스에 남아도 다음 조회에서 스스로 정리됨)
- 짧은/형식이 안 맞는 personalCode → 400
- `GET`/목록 응답 어디에도 `ownerHash` 미노출

**브라우저 (fetch 스텁으로 Worker 응답을 흉내내어 UI 흐름 확인)**
- 탭 토글, 공개 → 링크·관리코드 표시 → 새로고침 후에도 "업데이트/공개취소" 상태 유지
- 라이브러리 목록 → 상세 → 실제 카드 렌더 + 북마크 버튼으로 내 북마크에 담기
- 공유 패널이 `.series-card`의 `overflow:hidden`에 안 잘림 (이 설계의 핵심 검증 포인트)
- 검색·정렬 전환 시 목록/개수 갱신, `더 보기` 진행 표시, 검색 결과 없음 문구
- 관리 코드 복구(예전 방식): 틀린 토큰은 안내 문구와 함께 거부되고 **토큰이 저장되지 않음**, 맞는 토큰은 공개 내용을 로컬 북마크로 복원하고 토큰까지 연결
- 다크/라이트 양쪽 확인 — 다크모드에서 주요 버튼이 파란색을 잃는 CSS 특이도 문제를 발견해 `theme.css`에 `.is-primary` 재지정으로 수정

**개인 복구 코드 — 브라우저 (2026-08-21, 실제 UI 클릭 + in-page fetch 스텁)**
- 게시 시 개인 코드가 자동으로 실리고, 공개 직후 패널에 "개인 코드에도 자동 연결됐다"는 안내가 뜸
- localStorage 전체 초기화("다른 기기" 시뮬레이션) → "이 코드로 되찾기"에 원래 개인 코드 입력 → 공개했던 북마크가 로컬로 복원되고 카드가 곧바로 "공개됨" 상태(초록 아이콘)로 표시됨
- 위 상태에서 `editToken`을 전혀 모르는 채로(로컬에 없음) "최신 내용으로 업데이트" 클릭 → personalCode만으로 서버 인증 통과, "업데이트 완료!" 표시
- 되찾기에 성공한 브라우저가 그 개인 코드를 스스로 채택함(`localStorage['chokaguya_personal_code']`가 원래 코드와 일치) 확인
- "내 개인 코드"/"이 코드로 되찾기"/그 안의 "공유 코드 하나만 따로 되찾기" 세 패널 모두 토글 정상 동작

**검증 중 발견해 고친 것**
- 라이브러리 검색을 빠르게 입력하면 요청이 겹쳐 "더 보기" 버튼이 중복 생성되고 늦게 도착한 응답이 목록을 덮어썼습니다 → 세대 번호(`loadSeq`) 가드로 낡은 응답을 버리고, 버튼은 매번 전부 정리하도록 수정
- 이름순 정렬이 런타임 기본 로케일에 의존 → `'ko'` 명시
- (2026-08-21) `.bkm-claim-panel`이 자기 클래스에 `display:flex`를 직접 지정하고 있어서, `hidden` 속성(브라우저 기본 `[hidden]{display:none}`)이 같은 특이도의 author 규칙에 밀려 무시되는 버그를 발견 — 패널이 하나(관리 코드 복구)일 때는 안 드러났지만 개인 코드 추가로 패널이 세 개가 되며 토글이 전혀 안 먹는 형태로 표면화됨. `pageCommon.css`에 전역 `[hidden]{display:none!important;}` 가드를 추가해 해결(이 사이트의 `hidden` 속성 사용 전체에 적용되는 근본 수정)

**실서버 검증 (2026-08-21 배포 후, 개인 복구 코드 이전 버전)**
- `GET /library` 200 + `total`/`hasMore`/`sort` 필드 정상
- 게시 → 상세 조회에서 `editTokenHash` 미노출 → 목록 반영 → 올바른 토큰으로 삭제까지 왕복 성공
- 잘못된 editToken `DELETE` → 403
- CORS 프리플라이트 `OPTIONS /library/<code>` → 204 + `Allow-Methods: GET, POST, PUT, DELETE, OPTIONS`
- 레이트리밋이 실제 KV 에 `rl:lib-write:<ip>:<window>` / `rl:lib-list:...` 카운터를 만료시각과 함께 기록하는 것 확인 (한도를 소진하면 한 시간 동안 게시가 막히므로 429 자체는 일부러 유발하지 않음)

**사이트 전역 로그인 — 브라우저 (2026-08-22, 실제 UI 클릭 + in-page fetch 스텁, 6개 페이지)**
- 6개 페이지 모두 헤더에 로그인 버튼이 뜨고, 페이지 최상단(히어로 상태)에서도 클릭 가능 확인
- 회원가입(SignUp) → 코드 확인 → 헤더가 새로고침 없이 "개인 코드 관리"로 즉시 전환(`chokaguya:auth-change` 이벤트 확인), `localStorage`에 코드 저장 확인
- 로그아웃 → 헤더가 "로그인"으로 복귀, `chokaguya_personal_code`만 삭제되고 `chokaguya_library_tokens`는 그대로 남음 확인
- 비로그인 상태에서 "라이브러리에 공개하기" 클릭 → 회원가입 모달이 뜨고("북마크를 공개하려면 먼저 회원가입해주세요" 안내 문구 포함) → 확인 → 공유 패널이 다시 열리며 게시가 자동으로 이어져 "라이브러리에 공개했어요!" 결과까지 표시됨
- 로그인 모달(SignIn)이 Figma SignInFrame과, 회원가입 모달(SignUp)이 SignUpFrame과 시각적으로 일치하는 것을 스크린샷으로 확인. 다크모드 전환 후에도 재확인(카드 배경/텍스트/민트 버튼 색 유지)

**검증 중 발견해 고친 것 (2026-08-22, 사이트 전역 로그인)**
- `mainPage.html`은 `pageCommon.css`가 아니라 별도 `mainPage.css`를 쓰는 예외적인 페이지라는 걸 처음엔 놓쳐서, 로그인 모달이 완전히 스타일 없이(투명/좌상단) 렌더링되는 문제가 있었음 → `mainPage.css`에 `.auth-*`/`.bkm-picker` 계열 CSS 전체를 복제해 해결
- `mainPage.css`에 추가한 CSS 블록 주석 안에 `.auth-*/.bkm-picker`라는 표현을 썼는데, 이 안의 `*/`가 CSS 주석을 조기 종료시켜서 그 뒤 텍스트가 깨진 CSS로 파싱되고, 결국 `.auth-overlay` 규칙 자체가 통째로 무시되는 문제를 발견 → 주석 문구를 `*/`가 안 생기게 수정. (교훈: CSS 주석 안에 클래스명을 나열할 때 `.a/.b` 같은 슬래시 구분을 쓰면 `*/`가 우연히 만들어질 수 있음 — 주석엔 `및`/쉼표로 구분하는 게 안전)
- `authModal.js`의 로그인/회원가입 카드 클릭이 `stopPropagation` 없이 `document`까지 버블링되어, `bookmarksPage.js`가 "바깥 클릭하면 공유 패널 닫기"용으로 걸어둔 `document` 클릭 리스너를 엉뚱하게 트리거 — 회원가입 완료 직후 공유 패널이 도로 닫혀버려 게시 결과가 안 보이는 문제가 있었음 → `.auth-card`에 `e.stopPropagation()` 추가로 해결
- 위 두 CSS 버그를 디버깅하며 겪은 것: 정적 서버(`python -m http.server`)로 서빙되는 CSS/JS를 브라우저가 디스크 캐시로 재사용해서, 파일을 고쳐도 `navigate`만으로는 반영이 안 될 때가 있었음 — `<link>`/`<script>`의 `src`에 캐시버스팅 쿼리(`?cb=Date.now()`)를 붙여 강제로 다시 로드해야 확인 가능했음. 이후 세션에서 "분명히 고쳤는데 반영이 안 된다"고 느껴지면 캐시부터 의심할 것

**아직 검증 못 한 것**: 항목이 많을 때 `scanLibrary` 의 다중 페이지 순회(현재 공개물이 0건이라 단일 페이지만 탐), 실제 KV 최종 일관성 하에서의 429 경계 정확도. **개인 복구 코드는 아직 실서버(`chokaguya-favorites-share.nwb10102.workers.dev`)에 배포되지 않았습니다** — 코드 작성 시점 기준 실서버는 이전 버전(`/library`만 있고 `personalCode`/`/claim-owner`/`/owner/lookup` 없음)이 떠 있는 상태라, 위 "실서버 검증"은 개인 복구 코드 이전 항목만 해당됩니다. 위 개인 복구 코드 검증은 전부 목/스텁으로 한 것이며, `cd worker && npx wrangler deploy`로 배포한 뒤에는 실제 R2 `head()`/`list()` 동작(특히 `/owner/lookup`의 순차 `head()` 다건 조회, `owners/*.json` 인덱스 오브젝트 크기)까지 실서버로 한 번 더 확인하는 걸 권합니다.

> 참고: 위 목 테스트는 임시로 돌린 것이라 저장소에 커밋돼 있지 않습니다. 재현하려면 `worker/favoritesShareWorker.js`를 ESM으로 import 하고 R2/KV를 Map 기반 목으로 주입하면 됩니다.

## 8. 아직 안 된 것 / 향후 과제

### 기능적으로 안 만든 것
- **게시자 표시**: 누가 올렸는지 표시할 방법이 없습니다(닉네임·프로필 개념이 없는 익명 코드 기반이라). 이름만 보입니다.
- **신고·모더레이션**: 공개 목록에 부적절한 게시물이 올라와도 지울 방법이 게시자의 editToken뿐입니다. 관리자용 삭제 경로가 없습니다.
- **만료/정리**: `library/*.json`은 자동으로 안 지워집니다. 필요하면 R2 대시보드에서 lifecycle rule을 걸면 됩니다(코드 변경 불필요).
- **이름 변경 동기화**: 내 북마크 이름을 바꿔도 이미 공개된 사본은 그대로입니다 — 공유 패널에서 "최신 내용으로 업데이트"를 눌러야 반영됩니다(의도된 동작).
- 북마크 안 항목 순서를 드래그로 재정렬하는 기능은 없음 (담은 순서 = `items` 배열 push 순서 고정)
- **인기순 정렬**: 조회수·담은 수를 세지 않으므로 불가능합니다. 하려면 별도 카운터(KV/Durable Object)가 필요합니다.

### 2026-08-21 완료
- ~~Worker 배포~~ → `RATE_LIMIT_KV` 생성(`564a89b518d544eeabec62fb758d17ed`) 후 배포, 실서버 검증까지 완료
- ~~`wrangler.toml` 의 `RATE_LIMIT_KV` id 비어 있음~~ → 기입 완료. KV 에 `rl:lib-write` / `rl:lib-list` 카운터가 실제로 쌓이는 것 확인
- ~~라이브러리 목록 정렬~~ → `sort=new|updated|name` 구현 (5번 참고)
- ~~검색·필터~~ → `q` 이름 부분검색 구현
- ~~관리 코드 복구~~ → "관리 코드로 되찾기" UI + `claimToken` 구현 (이후 개인 복구 코드로 대체·보완, 아래 항목)
- ~~옛 즐겨찾기 공유 인프라 삭제~~ → 파일 5개 + Worker `/share` 라우트 제거
- ~~`/share`에 레이트리밋 미적용~~ → 라우트 자체를 없애서 해소
- ~~북마크마다 따로 코드를 관리해야 하는 문제~~ → 개인 복구 코드 추가(5-1번). 브라우저마다 코드 하나로 이후 공개물 전부 자동 연결, 다른 기기에서 그 코드 하나로 전체 되찾기, 기존 공개물 1회성 마이그레이션, 예전 코드+토큰 방식도 계속 지원(성공 시 자동 연결). **코드 작성만 했고 실서버엔 미배포** — 배포는 사용자 판단에 맡김(6번 참고)

### 2026-08-22 완료
- ~~북마크 페이지에 흩어진 개인 코드 UI~~ → Figma "개인 공간" 파일(SignInFrame/SignUpFrame)을 반영해 사이트 전역 로그인/회원가입으로 통합(5-2번). 헤더에 로그인 상태 버튼, 딤 처리된 중앙 모달, 북마크 공개 시 자동 회원가입 게이트까지 6개 페이지 전체 적용. **여전히 실서버 미배포**(personalCode 관련 라우트 전부 포함, 6번 참고)
