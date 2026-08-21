# 📑 북마크 시스템

이 문서는 옛 "즐겨찾기"(타입별 고정 4버킷 별표)를 대체한 **북마크**(이름 있는 다중 목록, 유튜브 재생목록 방식) 시스템의 현재 구현 상태를 정리한 것입니다. 원래는 전환 작업 전에 쓴 계획 문서였고, 계획대로 구현이 끝난 뒤 실제 구조에 맞춰 다시 정리했습니다. 다른 PC에서 이 저장소를 `git pull` 받아 개발을 이어갈 때 참고하세요.

기존 "즐겨찾기" 문서(`FAVORITES_SYSTEM.md`)는 이 전환으로 완전히 대체되어 삭제했습니다.

---

## 1. 전체 구조

```
[브라우저 localStorage]                    [Cloudflare Worker]              [Cloudflare R2]
  chokaguya_bookmarks      --공개하기-->   chokaguya-favorites-share  --put/get-->  chokaguya-assets
  { version:1, bookmarks:[...] }           (worker/favoritesShareWorker.js)        (library/<code>.json)
  chokaguya_library_tokens
  { "<code>": { editToken, bookmarkId } }
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
| `src/js/bookmarkLibrary.js` | 라이브러리 Worker 클라이언트 (5번 참고) |
| `src/js/gridPage.js` | 시리즈/명예관/공식/문학 그리드 카드에 북마크 버튼 연결 (`global.BookmarkPicker.createButton(config.favType, favId)`) |
| `worker/favoritesShareWorker.js` + `worker/wrangler.toml` | Cloudflare Worker. `/library` 라우트(신규, 라이브러리용)와 `/share` 라우트(레거시)를 함께 들고 있음 |

**옛 즐겨찾기 잔재 (아직 정리 안 함):** `favoritesCodec.js`, `favoritesShareRemote.js`, `favoritesShare.js`, `sharedFavoritesPage.html`/`.js`, 그리고 Worker의 `/share` 라우트. 어느 페이지에서도 로드되지 않는 죽은 코드지만 삭제하지 않고 뒀습니다 (7번 후속 과제).

**삭제됨:** `favorites.js`, `favoritesPage.js`, `favoritesPage.html`, `FAVORITES_SYSTEM.md`

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
- **북마크 탭 상세 모드** (`?id=<북마크id>`): `Novel/Series/HOF/Official.json` 4개를 병렬 fetch(`Promise.all`) 후 `SeriesUtil.assignPostNumbers`/`assignSeriesNumbers` 적용, id로 조회맵 생성. **타입별 섹션을 나누지 않고** `bookmark.items` 저장 순서 그대로 하나의 그리드로 렌더링(문학/시리즈가 섞여도 담은 순서 그대로 보임). 카드의 북마크 버튼엔 `{ viewingBookmarkId, onRemovedFromCurrentView }`를 넘겨서, 지금 보고 있는 북마크를 팝오버에서 해제하면 새로고침 없이 카드가 그리드에서 바로 사라짐
- **카드 클릭**: `PostDetailSeries.open(...)`으로 기존 시리즈 상세 모달이 그대로 열림 (그리드 페이지와 동일한 동작)

---

## 5. 북마크 라이브러리 (공개 공유)

내 북마크 하나를 통째로 공개해서 다른 사람이 둘러보게 하는 기능입니다. 로컬 저장이 기본이고, 공개한 것만 서버(Cloudflare Worker + R2)로 올라갑니다.

> 🚧 **현재 상태: 코드는 완성됐지만 아직 배포 전입니다.** Worker의 `/library` 라우트가 실제 서비스에 올라가 있지 않아, 지금 사이트에서 "공개하기"를 누르면 404가 납니다. 배포 절차는 6번 참고 — **KV 네임스페이스 생성과 `wrangler deploy`가 남았습니다.**

### 파일
| 파일 | 역할 |
|---|---|
| `src/js/bookmarkLibrary.js` | Worker 클라이언트. `publish` / `update` / `unpublish` / `list` / `getOne` / `getPublishedInfo` |
| `worker/favoritesShareWorker.js` | `/library` 라우트 (아래 표) |

### Worker API
| 메서드 | 경로 | 설명 |
|---|---|---|
| `POST` | `/library` | body `{name, items}` → `{code, editToken}` 반환. editToken은 **이 응답에서 딱 한 번만** 나옴 |
| `GET` | `/library?cursor=&limit=` | 목록 (커서 페이지네이션). R2 `customMetadata`에 이름·개수를 같이 저장해둬서 항목마다 GET 하지 않음 |
| `GET` | `/library/<code>` | 상세 `{code, name, items, createdAt, updatedAt}` |
| `PUT` | `/library/<code>` | body `{editToken, name?, items?}` → 갱신 |
| `DELETE` | `/library/<code>` | body `{editToken}` → 삭제 |

### 소유권 (로그인 없이)
로그인 시스템이 없으므로 "내가 올린 것"이라는 증명은 게시 시 서버가 한 번 돌려주는 `editToken`을 브라우저가 들고 있는 것으로 대신합니다 (pastebin류의 삭제 키 패턴). `localStorage['chokaguya_library_tokens']` → `{ "<code>": { editToken, bookmarkId } }`.

> 🔐 **이 R2 버킷은 `pub-*.r2.dev`로 전체 공개 read이므로, editToken 원문은 절대 저장하지 않고 SHA-256 해시(`editTokenHash`)만 저장합니다.** `GET /library/<code>` 응답을 만들 때도 이 필드는 반드시 제거하고 내려줍니다 — 기존 `/share`의 GET처럼 R2 body를 그대로 프록시하면 안 됩니다.

토큰을 잃으면(브라우저 데이터 삭제, 기기 변경) 그 게시물은 수정·삭제할 수 없습니다. 그래서 게시 직후 관리 코드를 한 번 보여주고 백업을 권합니다.

### 레이트리밋
공개 목록이 생기면서 스팸 유인이 커졌기 때문에, 라이브러리 기능과 **같이** 추가했습니다 (`TRAFFIC_LAG_AUDIT.md` 3항에서 지적한 문제). `RATE_LIMIT_KV` 바인딩을 써서 IP당 고정 윈도우로 제한:
- 쓰기(`POST`/`PUT`/`DELETE /library`): 시간당 20회
- 목록 조회(`GET /library`): 시간당 120회

KV는 최종 일관성이라 완벽한 원자성은 아니지만(동시 요청 시 약간의 오차 가능) 스팸 억제엔 충분합니다. **`RATE_LIMIT_KV`가 바인딩되지 않으면 Worker는 레이트리밋을 건너뛰고 동작하므로(fail open), 운영 배포 전에 반드시 네임스페이스를 만들어 `wrangler.toml`의 `id`를 채워야 합니다.**

### UI
북마크 탭 목록 모드 상단에 **내 북마크 | 북마크 라이브러리** 알약 토글 (`?tab=library`). 내 북마크의 폴더 카드 좌상단 공유 버튼을 누르면 공개/업데이트/공개취소 패널이 뜹니다(공개 중이면 아이콘이 초록색). 라이브러리 카드를 클릭하면 `?libraryId=<code>` 상세로 가고, 거기 카드들의 북마크 버튼이 그대로 살아있어서 마음에 드는 항목을 바로 내 북마크에 담을 수 있습니다.

### 옛 즐겨찾기 공유 인프라
`favoritesCodec.js`/`favoritesShareRemote.js`/`favoritesShare.js`/`sharedFavoritesPage.*`와 Worker의 `/share` 라우트는 옛 4버킷 즐겨찾기용이라 이 라이브러리와 무관합니다. 아직 정리하지 않고 그대로 뒀습니다(후속 과제).

---

## 6. 배포 / 로컬에서 확인하기

라이브러리를 뺀 나머지(내 북마크)는 순수 로컬이라 서버 없이 동작합니다:
```bash
python -m http.server 8000
# http://localhost:8000/src/page/bookmarksPage.html
```

라이브러리 기능을 실제로 쓰려면 Worker 배포가 필요합니다:
```bash
cd worker
npx wrangler login
npx wrangler kv namespace create RATE_LIMIT_KV   # 출력된 id 를 wrangler.toml 의 id = "" 에 채움
npx wrangler deploy
```
Worker 주소는 이미 `src/js/bookmarkLibrary.js`의 `WORKER_BASE`에 박혀 있어서(`chokaguya-favorites-share.nwb10102.workers.dev`) `wrangler.toml`의 `name`이 그대로면 주소가 안 바뀌므로 손댈 필요 없습니다.

---

## 7. 검증 상태

라이브러리 기능은 다음까지 확인했습니다:

**Worker 로직 (R2/KV를 메모리 목으로 대체한 22개 테스트, 전부 통과)**
- 생성 → editToken 원문이 저장 객체에 **없고** 해시(64자)만 들어감
- `GET /library/<code>` 응답에서 `editTokenHash` 제거됨
- 목록에 이름·항목수가 실림, items 왕복 무결성
- 잘못된 editToken으로 `PUT`/`DELETE` → 403, 올바른 토큰 → 정상
- 이름 공백/40자 초과, 잘못된 type, 숫자 아닌 id → 400
- 같은 IP 21번째 쓰기 → 429, 다른 IP는 영향 없음
- 기존 `/share` 라우트 정상 동작(회귀 없음)

**브라우저 (fetch 스텁으로 Worker 응답을 흉내내어 UI 흐름 확인)**
- 탭 토글, 공개 → 링크·관리코드 표시 → 새로고침 후에도 "업데이트/공개취소" 상태 유지
- 라이브러리 목록 → 상세 → 실제 카드 렌더 + 북마크 버튼으로 내 북마크에 담기
- 공유 패널이 `.series-card`의 `overflow:hidden`에 안 잘림 (이 설계의 핵심 검증 포인트)
- 다크/라이트 양쪽 확인 — 다크모드에서 주요 버튼이 파란색을 잃는 CSS 특이도 문제를 발견해 `theme.css`에 `.is-primary` 재지정으로 수정

**아직 검증 못 한 것: 실제 Cloudflare 환경에서의 동작.** 배포를 안 했기 때문에 실제 R2 `list()` 커서 페이지네이션(목 구현과 실제 동작이 다를 수 있음), 실제 KV의 최종 일관성 하에서의 레이트리밋 정확도, CORS 프리플라이트(`PUT`/`DELETE`는 `OPTIONS`를 유발함 — 핸들러는 있지만 실서버에서 미확인)는 배포 후 확인이 필요합니다.

---

## 8. 아직 안 된 것 / 향후 과제

### 바로 해야 할 것
- **⚠️ Worker 배포** — 이게 안 되면 라이브러리 기능이 아예 동작하지 않습니다 (6번 절차).
- **⚠️ `wrangler.toml`의 `RATE_LIMIT_KV` id가 비어 있음** — 채우지 않고 배포하면 Worker가 레이트리밋을 건너뛴 채(fail open) 공개 쓰기 API가 무방비로 열립니다. 반드시 채우고 배포하세요.

### 기능적으로 안 만든 것
- **라이브러리 목록 정렬**: R2 `list()`는 키(랜덤 코드) 순으로만 정렬되므로 최신순/인기순이 없습니다. 지금은 사실상 무작위 순서로 나옵니다. 필요해지면 별도 인덱스(KV)를 설계해야 합니다.
- **검색·필터**: 라이브러리 목록에 검색이 없습니다. 목록이 커지면 "더 보기"로 계속 넘기는 수밖에 없습니다.
- **게시자 표시**: 누가 올렸는지 표시할 방법이 없습니다(로그인이 없어서). 이름만 보입니다.
- **신고·모더레이션**: 공개 목록에 부적절한 게시물이 올라와도 지울 방법이 게시자의 editToken뿐입니다. 관리자용 삭제 경로가 없습니다.
- **관리 코드 복구**: 토큰을 잃으면 그 게시물은 영영 수정·삭제 불가입니다. 코드를 직접 입력해 관리 권한을 되찾는 UI가 없습니다(서버는 `editToken`을 body로 받으므로, 입력창만 만들면 가능한 구조이긴 함).
- **만료/정리**: `library/*.json`은 자동으로 안 지워집니다. 필요하면 R2 대시보드에서 lifecycle rule을 걸면 됩니다.
- **이름 변경 동기화**: 내 북마크 이름을 바꿔도 이미 공개된 사본은 그대로입니다 — 공유 패널에서 "최신 내용으로 업데이트"를 눌러야 반영됩니다(의도된 동작).
- 북마크 안 항목 순서를 드래그로 재정렬하는 기능은 없음 (담은 순서 = `items` 배열 push 순서 고정)

### 정리 대상 (죽은 코드)
- 옛 즐겨찾기 공유 인프라 삭제: `favoritesCodec.js`, `favoritesShareRemote.js`, `favoritesShare.js`, `sharedFavoritesPage.html`/`.js`, Worker의 `/share` 라우트
- `/share`에는 레이트리밋을 적용하지 않았습니다. 삭제하지 않고 남길 거라면 같은 `checkRateLimit` 헬퍼를 적용해야 합니다 (`TRAFFIC_LAG_AUDIT.md` 참고).
