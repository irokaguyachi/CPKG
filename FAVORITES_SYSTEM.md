# ⭐ 즐겨찾기 시스템 (로컬 저장 + 온라인 공유)

이 문서는 2026-08-20에 구현한 즐겨찾기 기능 전체를 정리한 것입니다. 다른 PC에서 이 저장소를 `git pull` 받아 개발을 이어갈 때 참고하세요.

---

## 1. 전체 구조

```
[브라우저 localStorage]              [Cloudflare Worker]              [Cloudflare R2]
  chokaguya_favorites   --POST/share-->  chokaguya-favorites-share  --put/get-->  chokaguya-assets
  { novel, series,                       (worker/favoritesShareWorker.js)         (share/<code>.json)
    hof, official: [id...] }
```

- **로컬 저장**: 별표를 누르면 브라우저 `localStorage`에만 저장됩니다. 서버 없이도 완전히 동작.
- **온라인 공유**: "공유 링크 만들기"를 누르면 로컬 즐겨찾기를 압축 인코딩해서 Worker에 POST → Worker가 코드를 만들어 R2에 저장 → `sharedFavoritesPage.html?share=코드` 링크 생성.
- **공유받기**: 그 링크로 들어가면 Worker의 GET 라우트로 R2에서 데이터를 읽어와 읽기 전용으로 보여줌 (내 즐겨찾기에는 저장되지 않음).

---

## 2. 파일 목록

| 파일 | 역할 |
|---|---|
| `src/js/favorites.js` | 로컬 저장소 core. `localStorage['chokaguya_favorites']`를 `{novel:[], series:[], hof:[], official:[]}` 형태(ID 배열)로 관리. `isFavorite(type,id)` / `toggle(type,id)` / `getAll()` / `getBucket(type)` |
| `src/js/favoritesCodec.js` | ID 배열 ↔ 압축 문자열 순수 인코더/디코더. `encodeFavorites(ids)` / `decodeFavorites(str)`. V(가변길이)/F(고정폭)/D(정렬+델타) 세 방식 중 가장 짧은 걸 자동 선택 |
| `src/js/favoritesShare.js` | 파일로 내보내기/불러오기 (다운로드 `.json` 파일). 아직 어느 페이지에도 버튼으로 연결 안 돼있음, 콘솔에서 직접 호출용 |
| `src/js/favoritesShareRemote.js` | R2 기반 온라인 공유. `createShareLink()` (Worker에 POST, 링크 생성) / `fetchShared(code)` (Worker에 GET, 디코딩까지) |
| `src/js/favoritesPage.js` + `src/page/favoritesPage.html` | **내 즐겨찾기 페이지**. 시리즈/명예관/공식 즐겨찾기를 실제 카드로 렌더링, 별 눌러서 바로 해제 가능, "공유 링크 만들기" 버튼 |
| `src/js/sharedFavoritesPage.js` + `src/page/sharedFavoritesPage.html` | **공유받은 즐겨찾기 페이지**. `?share=코드`를 읽어서 읽기 전용으로 렌더링 |
| `src/js/gridPage.js` | 시리즈/명예관/공식 그리드 카드에 별표 버튼 연결 (`createFavButton`, 471번째 줄 근처) |
| `worker/favoritesShareWorker.js` | Cloudflare Worker 소스. `POST /share` (저장), `GET /share/<code>` (조회) |
| `worker/wrangler.toml` | Worker 배포 설정. R2 버킷 바인딩 포함 |

---

## 3. 저장 형식

### 로컬 (`localStorage['chokaguya_favorites']`)
```json
{
  "novel": [],
  "series": [222943, 81917],
  "hof": [251514],
  "official": []
}
```
- ID는 **대표 게시물 번호**(디시 게시물 번호) — 시리즈/명예관/공식 항목은 `posts[0].id`(1화 게시물 번호)를 씀.
- `novel` 버킷은 문학 그리드 페이지가 아직 없어서 항상 비어있음 (자리만 마련해둔 상태).

### 공유 payload (Worker에 저장되는 R2 객체, `share/<code>.json`)
```json
{ "v": 1, "novel": "V", "series": "FMS2bfT_9Iyg...", "hof": "D-j-BgsD61Cw...", "official": "V" }
```
- 각 필드는 `encodeFavorites()`로 압축한 문자열 (이름/시간 등 메타데이터는 저장 안 함, 용량 절감).

---

## 4. 다른 PC에서 개발 이어가기

### 4-1. 저장소 클론 후 바로 되는 것
`worker/wrangler.toml`, `worker/favoritesShareWorker.js`는 커밋돼 있어서 그대로 딸려옵니다. 버킷 이름(`chokaguya-assets`)도 이미 채워져 있어서 별도 설정 없이 코드는 완전합니다.

### 4-2. Worker를 다시 배포하려면 (코드 수정 후)
Wrangler 로그인 세션은 로컬 PC에만 저장되는 정보라, **PC를 옮기면 다시 로그인**해야 합니다.

```bash
cd worker
npx wrangler login      # 브라우저 열림 → 같은 Cloudflare 계정(nwb10102)으로 로그인
npx wrangler deploy     # 배포 (wrangler.toml의 name이 같아서 기존 Worker가 그대로 업데이트됨, 주소 안 바뀜)
```

배포된 Worker 주소는 이미 코드에 박혀 있어서 (`src/js/favoritesShareRemote.js`의 `WORKER_URL`) 별도로 바꿀 필요 없습니다:
```
https://chokaguya-favorites-share.nwb10102.workers.dev/share
```

### 4-3. 로컬에서 사이트 확인
```bash
python -m http.server 8000
# http://localhost:8000/src/page/favoritesPage.html
```

### 4-4. 이 기능과 무관하지만 같은 카테고리 — 이미지 R2 동기화
`sync_to_r2.py`가 쓰는 `.r2_config.json`은 `.gitignore`에 있어서 커밋되지 않습니다. 이미지 업로드도 다른 PC에서 하려면 그 파일을 새로 만들어야 합니다 (`account_id`, `access_key_id`, `secret_access_key`, `bucket_name: "chokaguya-assets"`, `public_url`).

---

## 5. 아직 안 된 것 (TODO)

- **문학(novel) 탭 연결**: 문학 그리드 페이지 자체가 아직 없음 (`mainPage.html`의 "문학" 링크가 `#`). 페이지가 생기면 `Favorites.toggle('novel', dcPostId)` 패턴으로 바로 연결 가능.
- **`favoritesShare.js`(파일 내보내기/불러오기)**: 함수는 있지만 어느 페이지에도 버튼으로 연결 안 돼있음.
- **공유 데이터 만료/정리**: R2에 쌓이는 `share/*.json`은 자동으로 안 지워짐. 필요하면 Cloudflare R2 대시보드에서 lifecycle rule(예: 90일 후 자동 삭제)을 설정하면 됨 — 코드 변경 없이 대시보드에서만 하면 됨.
- **남용 방지**: Worker의 `POST /share`는 로그인 없는 공개 쓰기 API라 크기 제한(4KB)만 걸어뒀음. 남용이 실제로 발생하면 Cloudflare Turnstile이나 Rate Limiting 추가 검토 필요.

---

## 6. Worker API 요약

| 메서드 | 경로 | 설명 |
|---|---|---|
| `POST` | `/share` | body `{v:1, novel, series, hof, official}` → `{code, url}` 반환, R2에 저장 |
| `GET` | `/share/<code>` | 저장된 payload를 CORS 헤더 포함해서 반환 (R2 공개 버킷은 CORS가 없어서 이 라우트를 거쳐야 브라우저 `fetch()`로 읽힘) |
