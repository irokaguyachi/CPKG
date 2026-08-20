# 즐겨찾기 → 북마크(북마크 모음) 시스템 전환 계획

## Context

지금 "즐겨찾기"는 타입별(문학/시리즈/명예관/공식) 고정 4버킷에 ID만 넣는 단순 온오프 별표다. 사용자는 이걸 유튜브 재생목록처럼 **이름을 직접 지은 북마크 여러 개**를 만들고, 게시물/시리즈를 원하는 북마크에 하나씩 담는 방식으로 바꾸고 싶어한다. 한 항목은 여러 북마크에 동시에 들어갈 수 있다(유튜브 방식). "즐겨찾기"라는 이름 자체도 "북마크"로 바꾼다. 온라인 공유(다른 유저의 북마크 구경) 기능은 이번 스코프에서 명시적으로 제외 — 로컬 북마크 시스템만 구현한다.

기존 공유 인프라(`favoritesCodec.js`, `favoritesShareRemote.js`, `worker/favoritesShareWorker.js`, `sharedFavoritesPage.*`)는 페이로드 형태가 `{v:1, novel, series, hof, official}` 4개 고정 문자열 필드라 이름 있는 다중 북마크와 근본적으로 안 맞는다. 지금 안 고치고, 나중에 공유 기능을 다시 설계할 때 손댄다.

사용자 확정 사항:
1. 한 항목이 여러 북마크에 동시에 들어갈 수 있음 (다중 멤버십)
2. 기존 `chokaguya_favorites` localStorage 데이터는 마이그레이션 없이 폐기 — 새 키로 시작
3. 북마크 탭 = 목록(북마크 카드들) → 클릭 시 상세(그 북마크의 실제 게시물 그리드), `?id=` 쿼리 파라미터로 페이지 하나가 두 모드를 처리 (`sharedFavoritesPage.js`의 `?share=` 관례를 그대로 따름)
4. 카드의 별표 버튼 → 북마크 리본 아이콘으로 교체. 클릭하면 내가 만든 북마크 체크리스트 팝오버가 뜨고, 체크/해제로 담기/빼기, 팝오버 안에 "+ 새 북마크 만들기" 인라인 입력

## 1. 새 데이터 저장소 — `src/js/bookmarks.js`

`src/js/favorites.js`의 캐시/`storage` 이벤트 패턴을 그대로 재사용하되 저장 형태만 바꾼다. `favorites.js`는 완전히 대체되므로 **삭제**한다.

저장 키: `chokaguya_bookmarks` (신규 키, 기존 `chokaguya_favorites`는 건드리지 않고 방치).

```js
{
  version: 1,
  bookmarks: [
    { id: "m3k2f9x1a2b", name: "재밌게 본 것들", createdAt: 1755600000000,
      items: [ { type: "novel", id: 123456 }, { type: "series", id: 234567 } ] }
  ]
}
```
- `id` 생성: `Date.now().toString(36) + Math.random().toString(36).slice(2, 8)` — 충돌 검사 불필요 (로컬 전용 id)
- `isValidStore`: `version`/`bookmarks` 배열/각 항목의 `id,name`(string)·`items`(array) 형태 검증, 깨지면 `favorites.js`와 동일하게 `{version:1, bookmarks:[]}`로 리셋 (마이그레이션 시도 안 함)
- 캐시: `favorites.js`의 `cache`/`readAll`/`writeAll`/`storage` 이벤트 무효화 패턴 그대로 복사

API (`window.Bookmarks`):
- `getAllBookmarks()` / `getBookmark(id)` — 깊은 복사로 반환 (라이브 캐시 참조 노출 금지, 기존 `getAll()` 원칙 유지)
- `createBookmark(name)` → 새 id 반환. 이름 trim, 빈 값이면 `'새 북마크'` 기본값
- `renameBookmark(id, name)`, `deleteBookmark(id)` → `boolean`
- `isInBookmark(bookmarkId, type, id)`, `isInAnyBookmark(type, id)` → 카드 아이콘 채움 상태 판단용
- `getBookmarksContaining(type, id)` → 팝오버 체크박스 초기 상태용
- `addItemToBookmark`/`removeItemFromBookmark`/`toggleItemInBookmark(bookmarkId, type, id)` → 마지막 것이 새 멤버십 `boolean` 반환 (기존 `toggle`의 "새 상태 반환" 관례 유지)

## 2. 공유 UI 모듈 — `src/js/bookmarkPicker.js` (신규)

기존에 `gridPage.js`와 `favoritesPage.js`에 각각 따로 있던 `STAR_ICON`/`createFavButton` 중복을 이번에 하나로 합친다.

- 북마크 리본 아이콘 SVG 상수 (별 아이콘과 같은 방식으로 `.is-fav` 클래스에서 `fill` 전환 — 기존 CSS 기법 그대로 재사용)
- `BookmarkPicker.createButton(type, id, opts)` — `opts.onRemovedFromCurrentView`(선택, 북마크 상세 페이지 전용). `Bookmarks.isInAnyBookmark`으로 초기 `.is-fav` 세팅, 클릭 시 토글이 아니라 `BookmarkPicker.open(btn, type, id, opts)` 호출 (한 항목이 여러 북마크에 들어갈 수 있어서 클릭 한 번 = 토글이 성립하지 않음)
- `BookmarkPicker.open/close` — **`document.body`에 append하는 싱글턴 팝오버**(`postDetailSeries.js`의 `ensureOverlay()` 패턴), `position: fixed` + `anchorEl.getBoundingClientRect()`로 좌표 계산.
  - **왜 `.series-filter-panel`(`position:absolute`, 부모 상대 배치)을 그대로 못 쓰는지**: `.series-card { overflow: hidden; }`(`pageCommon.css:389`, 직접 확인함)가 카드 밖으로 나가는 절대배치 자식을 잘라버린다. 카드마다 다른 위치에서 열리는 팝오버라 `position:fixed` + body 싱글턴이 유일한 답.
  - 문서 레벨 click으로 닫힘 + 팝오버/트리거 버튼은 `stopPropagation` (gridPage.js의 필터 패널 열고 닫는 로직, 331-358줄과 동일한 2단 리스너 관례 재사용), Escape로도 닫힘
  - 렌더: `Bookmarks.getAllBookmarks()`를 `.sfp-option`/`.sfp-checkbox`/`.sfp-label` 클래스 그대로 써서 체크박스 행으로 그림 (새 CSS 불필요, 기존 필터 패널 스타일 재사용). 행 클릭 → `toggleItemInBookmark` → 체크 상태/트리거 버튼 `.is-fav` 갱신 → `opts.viewingBookmarkId`가 방금 해제된 북마크면 `onRemovedFromCurrentView()` 호출
  - 리스트 맨 아래 "+ 새 북마크 만들기" 인라인 입력 행 (항상 표시) — 제출 시 `createBookmark` → `addItemToBookmark` → 목록 다시 그림
  - 북마크 0개면 "아직 만든 북마크가 없어요" 안내 + 새 북마크 입력행만 표시

## 3. `gridPage.js` 수정

- `STAR_ICON` 상수 삭제, 로컬 `createFavButton` 함수(165-181줄) 삭제
- 카드 생성부(469줄 근처) `createFavButton(config.favType, favId)` → `global.BookmarkPicker.createButton(config.favType, favId)`로 교체 (list 모드라 `opts` 불필요)
- 검색/필터 패널/무한스크롤 등 나머지 전부 그대로
- `novelPage.html`/`seriesPage.html`/`HOFPage.html`/`OfficialPage.html`에서 `<script src="../js/favorites.js">`를 `bookmarks.js` + `bookmarkPicker.js`로 교체 (해당 페이지 스크립트보다 앞에 로드)

## 4. 새 페이지 — `src/page/bookmarksPage.html` + `src/js/bookmarksPage.js` (favoritesPage.* 대체)

`favoritesPage.html`/`favoritesPage.js` **삭제**하고 새로 만든다.

HTML: 로더/헤더/푸터는 기존 페이지 골격 그대로, `<title>북마크</title>`, nav 자기 자신 링크 `header-nav-strong`. `.fav-share-box` 마크업은 통째로 뺀다(공유 기능 이번엔 제외). `#bkm-count` 통계 줄 + `<div id="bkm-content">` 하나만 두고 목록/상세 모드 렌더링을 JS가 전부 맡음. 스크립트: `cdnConfig.js, bookmarks.js, bookmarkPicker.js, loading.js, theme.js, seriesUtil.js, postDetailSeries.js, bookmarksPage.js` (`favoritesCodec/Share/ShareRemote.js`는 안 실음).

JS 진입점:
```js
var bkmId = new URLSearchParams(location.search).get('id');
if (bkmId) renderDetail(bkmId); else renderList();
```

**목록 모드**: `Bookmarks.getAllBookmarks()`로 폴더 카드 그리드. `.series-card`/`.series-grid` 클래스 그대로 재사용해서 시각적 통일성 유지하되, 이미지 자리엔 커버 이미지 대신 (목록 모드에서 PageData 4개를 다 fetch하는 비용을 피하려고) 북마크 아이콘 placeholder만 표시. 제목=북마크 이름(인라인 편집 가능, 연필 버튼 → input 스왑 → `renameBookmark`), 카운트=`N개`, 모서리에 삭제 버튼(`window.confirm` 확인 후 `deleteBookmark`). 카드 클릭 → `bookmarksPage.html?id=<id>` 이동. 목록 상단에 "+ 새 북마크" 인라인 생성 행(팝오버의 것과 별도 소규모 구현, 공유 모듈로 묶을 만큼 크지 않음). 빈 상태: `.series-empty` 재사용.

**상세 모드**: `Bookmarks.getBookmark(id)` 없으면 안내 메시지. 헤더에 북마크 이름(+인라인 rename) 및 "‹ 북마크 목록으로" 뒤로가기 링크. `favoritesPage.js`와 동일하게 `Novel/Series/HOF/Official.json` 4개 병렬 fetch 후 `SeriesUtil.assignPostNumbers`/`assignSeriesNumbers` 적용, `{type: {id: post}}` 조회맵 생성. **타입별 섹션 나누지 않고** `bookmark.items` 저장 순서 그대로 순회하며 단일 `.series-grid`로 렌더 (사용자가 원하는 순서 그대로, 타입 섞여도 됨). 카드 클릭 시 `PostDetailSeries.open(...)`은 기존 로직 그대로. 카드의 북마크 버튼엔 `{ viewingBookmarkId: bookmark.id, onRemovedFromCurrentView: 카드 즉시 제거 }` 전달 (옛 `favoritesPage.js`의 `onRemoved` 콜백과 동일한 역할). 항목 0개/전부 조회 실패 시 `.series-empty`.

## 5. 파일 삭제 vs 유지

**삭제**: `src/js/favorites.js`, `src/page/favoritesPage.html`, `src/js/favoritesPage.js` — 완전히 대체되고 남는 호출자가 없음.

**그대로 유지(안 건드림)**: `favoritesCodec.js`, `favoritesShareRemote.js`, `favoritesShare.js`, `worker/*`, `sharedFavoritesPage.html`/`.js` — 나중에 공유 기능 다시 설계할 때 쓸 재료. `sharedFavoritesPage.js`는 `Favorites`를 아예 호출하지 않는 걸 확인했으므로 `favorites.js` 삭제와 무관하게 안전. 다만 그 페이지의 nav 링크 텍스트/href는 6번 항목대로 갱신.

삭제 전 `grep -rn "Favorites\.\|favorites\.js\|favoritesPage\.html\|favoritesPage\.js\|STAR_ICON" src/`로 남는 참조가 유지 대상 파일들뿐인지 최종 확인.

## 6. 네비게이션 텍스트/링크 전면 교체

`즐겨찾기` → `북마크`, `favoritesPage.html` → `bookmarksPage.html`. 대상: `mainPage.html`, `novelPage.html`, `seriesPage.html`, `HOFPage.html`, `OfficialPage.html`, `sharedFavoritesPage.html`, 그리고 새 `bookmarksPage.html` 자신(자기 링크는 `header-nav-strong`).

## 7. CSS (`pageCommon.css` + `theme.css`)

`pageCommon.css`의 `.fav-section-title`/`.fav-share-*` 블록(937-1015줄 근처, `favoritesPage.js` 삭제로 죽는 코드)을 걷어내고 그 자리에 새 클래스 추가:
- `.bkm-back-link`, `.bkm-list-toolbar`, `.bkm-inline-create*` (입력+버튼, `.fav-share-input`/`.fav-share-copy-btn`과 비슷한 필 스타일)
- `.bkm-folder-card`용 보조 클래스(`.series-card` 그대로 쓰고 커버 없을 때 아이콘 placeholder만 추가), `.bkm-folder-delete`(모서리 버튼, `.series-card-fav`와 같은 포지셔닝 공식이되 반대쪽 코너), `.bkm-rename-btn`/`.bkm-rename-input`
- `.bkm-picker`(팝오버 컨테이너, `.series-filter-panel`과 시각 속성 동일하게 베끼되 `position: fixed`만 다르게), 리스트 행 자체는 `.sfp-options`/`.sfp-option`/`.sfp-checkbox`/`.sfp-label` 그대로 재사용, `.bkm-picker-new`(하단 고정 입력 행, `.sfp-header`의 구분선 스타일을 위쪽 테두리로 미러링)

`theme.css`: 기존 `.sfp-*`/`.fav-share-*` 다크모드 블록 패턴 그대로 새 클래스에 맞춰 추가, 죽는 `.fav-section-title`/`.fav-share-*` 다크 블록은 제거.

## 검증

1. `node --check src/js/bookmarks.js src/js/bookmarkPicker.js src/js/bookmarksPage.js src/js/gridPage.js`
2. `python -m http.server`로 로컬 구동 후 브라우저 확인:
   - 카드 아이콘 초기 상태(빈 로컬스토리지에서 outline) → 클릭 시 카드 바로 옆에 팝오버가 뜨는지(overflow:hidden에 안 잘리는지 = 이 설계의 핵심 검증 포인트)
   - 새 북마크 만들기 → 체크됨 → 아이콘 채워짐 → 새로고침 후에도 유지
   - 같은 항목을 북마크 2개에 담기(다중 멤버십) → 하나만 해제해도 아이콘은 여전히 채워짐 → 전부 해제하면 outline으로
   - 북마크 탭 목록 모드(이름/개수 카드) → 클릭 시 `?id=`로 이동, 상세 모드에서 담은 항목들이 저장 순서대로 한 그리드에 표시
   - 상세 모드에서 지금 보고 있는 북마크를 팝오버에서 해제 → 카드 즉시 그리드에서 사라짐(새로고침 없이)
   - 목록 모드에서 이름 변경/삭제 → 새로고침 후에도 반영
   - `sharedFavoritesPage.html?share=...` 여전히 정상 동작(콘솔 에러 없음), nav 텍스트만 "북마크"로 바뀌어 있는지
   - 다크모드 토글 시 팝오버/북마크 페이지 대비 확인
3. 최종 grep: `grep -rn "Favorites\.\|favorites\.js\|favoritesPage\.html\|favoritesPage\.js\|STAR_ICON" src/` — 유지 대상 5개 파일군 밖에서 0건이어야 함

## 대상 파일 요약
- 신규: `src/js/bookmarks.js`, `src/js/bookmarkPicker.js`, `src/js/bookmarksPage.js`, `src/page/bookmarksPage.html`
- 삭제: `src/js/favorites.js`, `src/js/favoritesPage.js`, `src/page/favoritesPage.html`
- 수정: `src/js/gridPage.js`, `src/page/{mainPage,novelPage,seriesPage,HOFPage,OfficialPage,sharedFavoritesPage}.html` (nav), `src/page/pageCommon.css`, `src/page/theme.css`
- 안 건드림: `favoritesCodec.js`, `favoritesShareRemote.js`, `favoritesShare.js`, `worker/*`, `sharedFavoritesPage.html`/`.js` (nav 텍스트 제외)
