# 트래픽 폭증 / 렉 원인 조사 (2026-08-21)

이 문서는 "트래픽 폭증"과 "렉(버벅임)" 원인을 찾기 위해 렌더링 로직, 폰트, JSON 데이터 로딩, Cloudflare Worker를 조사한 결과를 정리한 것입니다.

---

## 결론 요약

| 항목 | 판정 | 비고 |
|---|---|---|
| 카드 리스트 / 이미지 렌더링 로직 | ✅ 문제 없음 | 이미 잘 최적화되어 있음 |
| 폰트(Pretendard 등) | ✅ 문제 없음 | 무거운 파일들이 실제로는 서빙 안 됨 |
| 일반 페이지별 JSON 로딩 | ✅ 문제 없음 | 페이지마다 필요한 파일 하나만 받음 |
| 북마크 / 공유 페이지 JSON 로딩 | ⚠️ 경미한 낭비 | 매번 4개 JSON(~782KB) 전부 받음 |
| **`favoritesShareWorker.js`의 `POST /share`** | 🚨 **가장 유력한 원인** | 인증/레이트리밋 전무, 무제한 호출 가능 |

**렉의 원인은 렌더링 코드 쪽에서는 거의 발견되지 않았고, 트래픽 폭증의 가장 유력한 용의자는 인증·레이트리밋이 없는 공유 링크 생성 엔드포인트입니다.**

---

## 1. 카드 리스트 / 이미지 렌더링 로직 — 문제 없음

조사 파일: `src/js/gridPage.js`, `postCard.js`, `postDetailSeries.js`, `cdnConfig.js`

이미 다음과 같이 최적화되어 있습니다.

- **페이지네이션**: `PAGE_SIZE = 50` 단위로 렌더링, `IntersectionObserver` 기반 무한 스크롤 (`gridPage.js:131, 412`)
- **이미지 지연 로딩**: 뷰포트 근처(±300px)에 들어오기 전엔 R2 요청 자체가 발생하지 않음 (`cdnConfig.js:85`)
- **썸네일 최적화**: 카드에는 원본 대신 600px webp 썸네일 서빙 (`cdnConfig.js:40`)
- **검색 디바운스**: 키 입력마다 리렌더하지 않고 150ms 디바운스 처리 (`gridPage.js:502`)
- **DOM 배치 삽입**: `DocumentFragment`로 묶어서 삽입, 리렌더 시 이전 lazy observer 정리까지 처리 (`gridPage.js:357, 375`)
- **시리즈 상세 모달**: read/write 단계를 분리해 강제 리플로우 최소화, 화면에 보이는 제목만 마퀴 애니메이션 실행 (`postDetailSeries.js:277`) — 화수 많은 시리즈에서도 컴포지터 부담 억제

미세한 낭비: `cdnConfig.js:66`의 `revealBackground`가 썸네일 존재 여부 확인을 위해 `new Image()`로 프로브 후 같은 URL을 다시 `background-image`로 세팅함. 브라우저 캐시로 중복 다운로드는 안 되지만 카드 수만큼 Image 객체가 생성됨 — 렉이라 부를 수준은 아님.

---

## 2. 폰트 — 문제 없음

조사 파일: `pageCommon.css`, `mainPage.css`, `loadingScreen.css`

실제로 `@font-face`로 로드되는 건:
- `PretendardVariable.woff2` (가변폰트 1개, 약 2MB)
- `CCElephantmen` (woff2 + woff)

세 CSS 파일에 동일한 `@font-face`가 중복 선언되어 있지만 URL이 같아 브라우저가 한 번만 받습니다.

`src/fonts/Pretendard-1.3.9/` 안에 있는 25MB+ 규모의 TTF/OTF 전체 굵기 세트(static + variable)는 **어디서도 참조되지 않아 방문자에게 전송되지 않습니다.** 저장소 용량은 차지하지만 트래픽과는 무관합니다. (원하면 저장소 정리 차원에서 별도로 삭제 제안 가능)

---

## 3. 일반 페이지별 JSON 로딩 — 문제 없음

- `seriesPage.js` → `Series.json`(136KB)만
- `novelPage.js` → `Novel.json`(627KB)만
- `HOFPage.js` → `HOF.json`(14KB)만
- `OfficialPage.js` → `Official.json`(4.8KB)만
- `mainPage.js` → `Series.json`만 (493KB인 `MoonHakdata.json` 대신 일부러 이걸 쓰도록 주석까지 남겨둠 — 의도적으로 최적화된 상태, `mainPage.js:43-46`)

`MoonHakdata.json`은 `src/scripts/*.py` 빌드 스크립트에서만 쓰이는 서버 사이드 원본 DB로, 클라이언트로 전송되지 않습니다.

---

## 4. 북마크 / 공유 페이지 JSON 로딩 — 경미한 낭비 ⚠️

`bookmarksPage.js:266-268`, `sharedFavoritesPage.js`는 북마크에 담긴 항목이 몇 개든 상관없이 **매번 4개 JSON을 전부** 받습니다:

```
Novel.json (627KB) + Series.json (136KB) + HOF.json (14KB) + Official.json (4.8KB)
≈ 782KB / 방문
```

항목 1~2개짜리 공유 링크를 열어도 782KB를 통째로 받는 구조라 낭비가 있지만, 렉이나 대규모 트래픽 폭증의 직접 원인이라 보기는 어렵습니다 (해당 페이지 방문 시에만 발생).

---

## 5. 🚨 `worker/favoritesShareWorker.js` — 가장 유력한 트래픽 폭증 원인

`POST /share` 엔드포인트 (`:63-97`)를 확인한 결과:

- **인증 없음, 레이트리밋 없음, 캡차 없음.** 유일한 제약은 body 크기 4096바이트 제한뿐.
- 누구나(봇 포함) 이 엔드포인트를 무제한으로 호출해 R2에 오브젝트를 계속 쓸 수 있음.
- 호출 1회당 **Cloudflare Worker 요청 1회 + R2 쓰기(PUT) 1회**가 발생하며, 둘 다 과금 대상.
- 스팸/크롤러/악의적 반복 호출이 있을 경우 R2 오브젝트 수 및 Worker 요청 수가 급격히 늘어날 수 있음 — **사용자가 말한 "트래픽 폭증"과 가장 부합하는 지점.**
- 부가적으로, 공유 링크가 실제로 퍼졌을 때 방문자마다 `GET /share/<code>` + 4번의 R2 JSON GET(위 782KB)이 함께 발생해 대역폭도 같이 증가함.

### ✅ 대응 상태 (2026-08-21 갱신)

북마크 라이브러리 기능을 추가하면서 **레이트리밋을 함께 구현했습니다** (`BOOKMARK_SYSTEM_PLAN.md` 5항 참고). `RATE_LIMIT_KV` 바인딩 기반 IP당 고정 윈도우 제한:
- 쓰기(`POST`/`PUT`/`DELETE /library`): 시간당 20회
- 목록 조회(`GET /library`): 시간당 120회

⚠️ **단, 두 가지가 남아있습니다:**
1. **`wrangler.toml`의 `RATE_LIMIT_KV` id가 아직 비어 있습니다.** 네임스페이스를 만들어 채우고 배포하기 전까지는 Worker가 레이트리밋을 건너뜁니다(fail open). 배포 절차는 `BOOKMARK_SYSTEM_PLAN.md` 6항 참고.
2. **기존 `POST /share`에는 레이트리밋을 적용하지 않았습니다.** 신규 `/library`만 보호됩니다. `/share`는 이제 프론트엔드에서 호출되지 않는 레거시 경로지만 엔드포인트 자체는 살아있으므로, 정리(삭제)하거나 같은 `checkRateLimit` 헬퍼를 적용하는 게 남은 과제입니다.

추가로 고려할 만한 것:
- Cloudflare Turnstile 등으로 봇 트래픽 차단
- R2 lifecycle rule로 오래된 `share/*.json` 자동 정리

---

## 6. 이미 과거에 진행된 최적화 이력 (git log)

이 프로젝트는 과거에 이미 한 차례 체계적인 성능 개선을 거쳤습니다. `git log`에서 확인:

```
1순위: 카드 썸네일 도입 (원본 51MB -> 0.85MB)
2순위: 검색 입력 렉 제거 (localStorage 폭주 + 옵저버 누수 + 디바운스)
3순위: cache no-store 전면 제거 + 메인 페이지 493KB 낭비 제거
4순위: CSS/JS 3중 중복 통합
5순위: 애니메이션/상시 타이머 정리 (폰트 축소는 별도 판단 대기)
```

- **2순위**는 정확히 "렉" 증상(검색 입력 시 버벅임)의 원인이 **매 키 입력마다 localStorage에 쓰기**였다는 걸 보여줌 — 지금 `gridPage.js`의 150ms 디바운스, `bookmarks.js`의 읽기 캐시(`cache` 변수)는 이 사건의 재발 방지책으로 보임. 즉 이번 조사에서 렌더링/localStorage 쪽에 문제가 없었던 건 우연이 아니라 이미 한 번 고쳐졌기 때문.
- **3순위**는 이번 조사에서 확인한 "mainPage.js가 493KB `MoonHakdata.json` 대신 136KB `Series.json`만 쓴다"는 내용과 정확히 일치 — 이미 처리된 항목.
- **5순위 커밋 메시지에 "폰트 축소는 별도 판단 대기"라고 명시** — 이번 조사에서 발견한 25MB+ 미사용 TTF/OTF 세트는 이미 알려진 채 보류된 항목이었습니다. 새로운 발견이 아니라 **미결 항목**입니다.

## 7. 추가로 확인해 정상 판정한 것들

- **외부 스크립트/트래킹**: 전체 HTML 페이지에서 `<script src>`는 전부 로컬 `../js/*.js` 뿐 — 구글 애널리틱스, GTM 등 외부 추적 스크립트 없음. 외부 요청으로 인한 트래픽 증가 요인 아님.
- **robots.txt**: 이미 `User-agent: * / Disallow: /`로 사이트 전체 크롤링을 차단해 둔 상태 (최근 커밋 `7e81229`). 크롤러발 트래픽은 이미 조치됨.
- **theme.js**: localStorage 읽기/쓰기가 토글 클릭 시에만 발생, 폭주 패턴 없음.
- **bookmarks.js**: 2순위 교훈이 반영되어 `cache` 변수로 동기 localStorage 읽기를 최소화, 쓰기도 변경 시에만 발생.

## 8. 새로 발견된 경미한 이슈 — 죽은 코드(dead code)

`favoritesShare.js` / `favoritesShareRemote.js`는 북마크 시스템 전환(`2d680f4`) 이전의 구 즐겨찾기 시스템(`Favorites`)을 참조하는 코드로, **현재 어떤 페이지에서도 로드되지 않는 것으로 보이며 `favoritesShare.js` 자체 주석에도 "No page wires this up yet"라고 명시**되어 있습니다. 실행되지 않으므로 트래픽/렉과는 무관하지만, `favoritesShareRemote.js`가 호출하는 `worker/favoritesShareWorker.js`의 `POST /share`는 **프론트엔드 연결 여부와 무관하게 URL만 알면 누구나 직접 호출 가능**하므로 위 3항의 취약점은 이 코드가 죽어있는 것과 별개로 여전히 유효합니다.

---

## 렉(버벅임) 관련 결론

렌더링 로직(카드 리스트, 이미지, 모달, 테마, 북마크)에서는 구조적 문제가 발견되지 않았습니다 — 대부분 과거 "2순위" 개선에서 이미 해결된 상태입니다. 체감 렉이 남아있다면 다음 중 하나일 가능성이 높습니다:
- 네트워크 자체 지연 (3항의 트래픽 폭증으로 인한 R2/Worker 응답 지연)
- 클라이언트 기기/브라우저 특이 케이스 (미조사 — 재현 필요)

## 9. 시리즈 상세 모달의 원본 이미지 로딩 — 새로 발견한 최적화 여지

조사 파일: `src/js/postDetailSeries.js:83-88`, `src/scripts/6_build_thumbnails.py`

카드 그리드는 600px WebP 썸네일을 쓰지만, 카드를 클릭해 여는 **시리즈 상세 모달은 `resolveAssetUrl()`로 원본 이미지를 그대로 로딩**합니다 (썸네일 빌더가 만드는 `thumb/` 트리를 거치지 않음 — 의도적 설계, 상세 모달은 고화질을 원한다는 주석 있음).

- 카드 클릭은 곧 "사용자가 관심을 보인 항목"이므로 발생 빈도 자체는 낮지만, 원본이 GIF/고해상도 PNG일 경우 썸네일(수십 KB) 대비 수 MB급 요청이 될 수 있습니다.
- `src/assets`는 `.gitignore`에 등록되어 있어(`git status`에도 안 잡힘) **이 저장소 체크아웃 상태로는 실제 원본 파일 용량을 확인할 수 없었습니다.** 로컬 `src/assets/Image/` 안에서 대표 몇 개 파일 용량을 직접 확인해보시는 게 다음 단계입니다.
- 만약 원본이 수 MB급이라면: 모달 전용으로 1200px 안팎의 중간 크기 WebP를 별도 생성해 쓰는 걸 제안합니다 (`6_build_thumbnails.py`와 같은 구조로 두 번째 사이즈 프리셋 추가). 카드 클릭 시 체감 렉과 트래픽 둘 다 개선됩니다.

---

## 다음 액션 후보 (우선순위 제안)
1. `worker/favoritesShareWorker.js`의 `POST /share`에 레이트리밋 추가 (3항)
2. `src/fonts/Pretendard-1.3.9/` 미사용 TTF/OTF 세트 삭제 여부 결정 (2항, 5순위 커밋에서 보류됐던 항목)
3. 시리즈 상세 모달용 중간 크기 이미지 프리셋 도입 검토 — 원본 용량 직접 확인 후 판단 (9항)
4. 죽은 코드(`favoritesShare.js`) 정리 여부 결정 — 유지보수 부담용, 트래픽과 무관
