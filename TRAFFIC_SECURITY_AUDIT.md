# 트래픽 · 보안 정밀 점검 (2026-08-24)

계정 시스템(`auth.js` / `userData.js` / `/user/*`) 도입 이후 기준으로 **트래픽·비용을 부풀리는 요소**와 **보안 취약점**을 전수 조사한 결과입니다.

> ⚠️ 기존 `TRAFFIC_LAG_AUDIT.md`(2026-08-21)는 이제 상당 부분 낡았습니다. 그 문서가 다루는 `favoritesShare.js`, `sharedFavoritesPage.js`, `POST /share`, `worker/wrangler.toml`은 전부 삭제됐고, "비어 있다"고 지적한 `RATE_LIMIT_KV` id는 채워졌습니다. 이 문서가 그걸 대체합니다.
>
> 📡 배포 도메인(`cpkg.by-works.net`)이 지금 DNS에서 해석되지 않아 **실제 응답 헤더는 확인하지 못했습니다.** 아래 내용은 전부 코드/설정 기준 정적 분석입니다.

---

## 결론 요약

| # | 항목 | 심각도 | 성격 |
|---|---|---|---|
| S1 | KV 일일 쓰기 한도 초과 시 API 전체가 500으로 죽음 | 🔴 치명 | 가용성 / DoS |
| T1 | 메인 페이지가 787KB JSON을 받음 (과거 최적화 회귀) | 🔴 높음 | 대역폭 |
| T2 | 2MB 가변 폰트를 전 페이지에서 `preload` | 🔴 높음 | 대역폭 / 체감 렉 |
| T3 | 배포 자산 73MB — 그중 68MB가 안 쓰는 폰트, 빌드 스크립트까지 공개 | 🔴 높음 | 대역폭 / 정보 노출 |
| S2 | 레이트리밋이 동시 요청·IP 로테이션에 무력 | 🟠 중간 | 남용 |
| S3 | `Access-Control-Allow-Origin: *` 가 이제 불필요하고 남용 통로가 됨 | 🟠 중간 | 남용 |
| S4 | 공개 라이브러리에 **관리자 삭제 경로가 없음** | 🟠 중간 | 운영 리스크 |
| S5 | 회원가입 1일 1회/IP 한도가 정상 사용자를 막음 | 🟠 중간 | 기능 장애 |
| T4 | 모든 페이지에서 로고 404 1회 + 이미지 2번 로드 | 🟠 중간 | 낭비 / UX |
| T5 | CSS `@import` 폭포수 — 렌더 블로킹 2단 왕복 | 🟠 중간 | 체감 속도 |
| T6 | `GET /library` 가 매 요청마다 버킷 전체 스캔 (Class A) | 🟠 중간 | R2 비용 |
| T7 | 레이트리밋 없는 공개 읽기 엔드포인트 2개 | 🟠 중간 | 비용 |
| L1 | 로더가 페이지 이동마다 최소 2.2초를 강제 | 🟠 중간 | 체감 렉 |
| S6~S8, T8~T10 | 본문 크기 검사, 인증 순서, 보안 헤더, 캐시 헤더 등 | 🟡 낮음 | 위생 |

**가장 급한 건 S1입니다.** 다른 것들은 돈과 체감 속도 문제지만, S1은 **하루 약 1,000번의 API 호출만으로 로그인·가입·동기화·라이브러리가 전부 동시에 죽는** 구조적 결함입니다.

---

# 🔒 보안 · 가용성

## 🔴 S1. KV 일일 쓰기 한도(1,000)를 넘기면 API 전체가 500으로 죽는다

`worker/favoritesShareWorker.js:268-278`

```js
async function checkRateLimit(env, ip, bucket, limit, windowMs) {
  if (!env.RATE_LIMIT_KV) return true;
  ...
  var current = await env.RATE_LIMIT_KV.get(key);       // KV 읽기 1회
  var count = current ? parseInt(current, 10) : 0;
  if (count >= limit) return false;
  await env.RATE_LIMIT_KV.put(key, String(count + 1), { ... });  // KV 쓰기 1회
  return true;
}
```

**허용되는 요청마다 KV에 `put`을 한 번씩 합니다.** Workers KV 무료 한도는 **하루 쓰기 1,000회**입니다(읽기는 10만회로 넉넉하지만 쓰기가 병목).

그리고 이 코드에는 `try/catch`가 **어디에도 없습니다** — `checkRateLimit` 안에도, 이걸 `await` 하는 핸들러들에도, 최상위 `fetch()`에도 없습니다. 한도를 넘겨 `put`이 throw하면 그대로 전파돼 Worker가 예외로 죽고 Cloudflare 1101 에러가 나갑니다.

`checkRateLimit`을 거치는 경로:

| 엔드포인트 | 용도 |
|---|---|
| `POST /library` | 북마크 공개 |
| `GET /library` | **라이브러리 탭 목록** |
| `PUT` / `DELETE /library/<code>` | 수정·삭제 |
| `POST /library/<code>/claim-owner` | 소유권 연결 |
| `POST /owner/lookup` | 코드로 되찾기 |
| `POST /user/signup` | **회원가입** |
| `POST /user/get` | **로그인** |
| `PUT /user/sync` | **동기화** |

즉 **KV 쓰기 한도가 소진되는 순간 로그인·회원가입·동기화·라이브러리 목록이 한꺼번에 전부 실패합니다.** 다음 UTC 자정까지 복구되지 않습니다.

이건 사고로도 일어나고 고의로도 일어납니다.

- **사고**: 라이브러리 탭을 한 번 열면 KV 쓰기 1회. 하루 방문/새로고침이 1,000번 쌓이면 그날 API가 죽습니다.
- **고의**: 누구나 `GET /library`를 1,000번 치면 끝입니다. 인증도, 캡차도, 비용도 필요 없는 **전체 API DoS**입니다.

### 권장 조치 (우선순위 순)

1. **KV 호출을 `try/catch`로 감싸 fail open** — 최소한 레이트리밋이 사이트를 죽이지는 않게. 한 줄짜리 방어입니다.
   ```js
   async function checkRateLimit(env, ip, bucket, limit, windowMs) {
     if (!env.RATE_LIMIT_KV) return true;
     try {
       // ... 기존 로직
     } catch (e) {
       return true;  // KV가 죽어도 사이트는 살아있게
     }
   }
   ```
2. **Cloudflare 네이티브 Rate Limiting 바인딩으로 교체** — KV 할당량을 전혀 쓰지 않고, 원자적이며(S2도 같이 해결), 무료입니다. 이게 정답입니다.
3. 최상위 `fetch()`에도 `try/catch`를 둬서 어떤 예외든 500 JSON으로 떨어지게 (1101 흰 화면 방지).

---

## 🟠 S2. 레이트리밋이 동시 요청과 IP 로테이션에 무력하다

같은 함수의 두 번째 문제입니다.

- **원자적이지 않음**: `get` → 비교 → `put` 사이에 락이 없습니다. 병렬로 500개를 쏘면 전부 `count = 0`을 읽고 전부 통과합니다.
- **KV는 최종 일관성**: 쓴 값이 다른 엣지 위치로 전파되는 데 최대 60초가 걸립니다. 여러 지역에서 동시에 때리면 카운터가 사실상 안 오릅니다.
- **IP 기준**: IPv6는 /64 블록을 통째로 받으므로 로테이션이 공짜입니다.
- **고정 윈도우**: 윈도우 경계에 걸쳐 쏘면 순간적으로 한도의 2배가 통과합니다.

의도적으로 "best-effort 억제책"이라고 주석에 밝혀두셨고, 스팸 억제 목적으로는 그 판단이 맞습니다. 다만 **S1과 겹치면 성격이 달라집니다** — 우회가 쉬운 리미터가 동시에 전체 API의 단일 장애점이라서, 우회 시도 자체가 사이트를 죽이는 공격이 됩니다. S1을 고치면 S2는 원래 의도대로 "느슨해도 되는" 문제로 돌아갑니다.

---

## 🟠 S3. `Access-Control-Allow-Origin: '*'` 가 이제 불필요하고, 남용 통로가 된다

`worker/favoritesShareWorker.js:147-151`

```js
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  ...
};
```

이 `*`는 API가 별도 `workers.dev` 서브도메인에 있던 시절의 잔재입니다. `src/_worker.js`가 API를 정적 사이트와 같은 Worker로 합친 뒤로 **모든 호출이 동일 출처**가 됐고(`bookmarkLibrary.js:28`, `userData.js:23`의 `WORKER_BASE = ''`), CORS 헤더 자체가 필요 없습니다.

지금 상태에서는 **아무 웹사이트나 자기 방문자의 브라우저를 시켜 이 API를 호출**할 수 있습니다. 인증이 쿠키가 아니라 body의 `personalCode`라서 계정 탈취(CSRF)로 이어지지는 않지만, **분산 남용 통로**로는 그대로 열려 있습니다 — 수천 명의 실제 IP에서 요청이 들어오면 IP당 레이트리밋은 아무 의미가 없고, S1의 KV 고갈까지 순식간에 도달합니다.

**조치**: 자기 오리진만 반영하거나(`Origin` 헤더 검사 후 echo), 동일 출처 전용이니 CORS 헤더를 아예 빼도 됩니다. `Content-Type: application/json` POST는 프리플라이트가 필수라, CORS를 막으면 브라우저발 크로스 오리진 호출은 차단됩니다.

---

## 🟠 S4. 공개 라이브러리에 관리자 삭제 경로가 없다

`handleLibraryDelete`는 `verifyLibraryAuth`(= 게시자의 `editToken` 또는 `personalCode`)를 통과해야만 지웁니다. **Worker 전체에 관리자 우회 경로가 없습니다.**

그런데 라이브러리는:
- 누구나 로그인만 하면 게시 가능 (IP당 시간당 20건)
- 이름 40자, 필터링·검열 없음
- `북마크 라이브러리` 탭에 **전원에게 그대로 노출**

즉 욕설·광고·불쾌한 이름으로 도배되면 **지울 방법이 없습니다.** R2 대시보드에서 오브젝트를 직접 삭제하는 수동 작업만 남습니다. 갤러리 기반 커뮤니티 사이트에서 공개 쓰기 기능을 여는 이상, 이건 "혹시 모를 일"이 아니라 준비해둬야 하는 일입니다.

**조치**: Worker 시크릿(`wrangler secret put ADMIN_KEY`) 하나를 두고, `DELETE /library/<code>`가 `adminKey`를 받으면 `verifyLibraryAuth`를 건너뛰게 하세요. 10줄이면 됩니다.

```js
if (body.value && body.value.adminKey && env.ADMIN_KEY &&
    body.value.adminKey === env.ADMIN_KEY) {
  await env.FAVORITES_BUCKET.delete('library/' + code + '.json');
  return jsonResponse({ ok: true, admin: true });
}
```

덧붙여 R2 lifecycle rule로 오래된 `library/*` 를 자동 정리하는 것도 검토할 만합니다 — 지금은 오브젝트 총량에 상한이 없습니다.

---

## 🟠 S5. 회원가입 1일 1회/IP 한도가 정상 사용자를 막는다

`worker/favoritesShareWorker.js:144`
```js
const RATE_LIMIT_USER_SIGNUP_PER_DAY = 1;
```

의도(같은 IP에서 계정 찍어내기 방지)는 타당하지만, **한국 환경에서는 정상 사용자를 막습니다.** 통신 3사 모바일 데이터, 학교·회사·PC방 네트워크는 CGNAT으로 수백~수천 명이 하나의 공인 IP를 공유합니다. 같은 망에서 두 번째 사람은 그날 가입이 불가능합니다.

두 가지가 이걸 더 나쁘게 만듭니다.

1. **카운터가 성공 여부와 무관하게 먼저 오릅니다.** `handleUserSignup`이 제일 먼저 `readUserBody(..., 'user-signup', 1, DAY_MS)`를 호출하는데, 이 안에서 이미 `checkRateLimit`이 `put`을 마칩니다 — 계정이 실제로 만들어졌는지와 상관없이 그날 몫이 소진됩니다.
2. **가입 화면을 여는 순간 소진됩니다.** `authModal.js:147-162`의 `renderSignUp()`은 "새로 발급받으세요!"를 누르는 즉시 `UserData.signup(code)`를 서버로 보냅니다. 사용자가 코드를 보기도 전에, 확인 버튼을 누르기도 전에 이미 하루치를 씁니다. 실수로 눌렀다가 닫으면 그날은 끝입니다.

**조치**: 한도를 3~5회/일 정도로 올리고, 카운터는 **실제로 새 계정이 생성됐을 때만**(`written === true`) 증가시키세요. `existed: true`로 끝난 요청은 계정을 늘리지 않으므로 셀 이유가 없습니다.

---

## 🟡 S6. 본문 크기 검사가 바이트가 아니라 UTF-16 길이 기준

`worker/favoritesShareWorker.js:337-345`
```js
async function readJsonBody(request, maxBytes) {
  var text = await request.text();          // ← 전체를 먼저 메모리에 읽음
  if (text.length > maxBytes) return { ... };   // ← UTF-16 코드 유닛 길이
```

두 가지 문제가 겹쳐 있습니다.

- **`text.length`는 바이트가 아닙니다.** 한글은 UTF-16 1유닛이지만 UTF-8로는 3바이트입니다. `USER_MAX_BODY_BYTES = 1048576`("1MB")짜리 검사를 통과한 한글 페이로드가 실제로는 약 3MB로 R2에 저장될 수 있습니다.
- **검사 전에 전체를 다 읽습니다.** `await request.text()`가 끝난 다음에야 길이를 봅니다. 100MB 본문을 보내면 Worker가 그걸 통째로 메모리에 올린 뒤 거절합니다(Worker 메모리 한도 128MB).

**조치**: `request.headers.get('Content-Length')`를 먼저 보고 초과면 즉시 413, 통과한 것만 읽으세요. 정확한 바이트 수가 필요하면 `new TextEncoder().encode(text).length`로 재세요.

## 🟡 S7. R2 `get()`이 인증 검사보다 먼저 실행된다

`handleLibraryUpdate`(:497~), `handleLibraryDelete`(:536~), `handleLibraryClaimOwner`(:581~) 모두 순서가 이렇습니다.

```
레이트리밋 → code 정규식 → R2 get()  →  본문 파싱 → 검증 → 인증 확인
                            ^^^^^^^^
                     인증 전에 이미 R2를 읽음
```

인증 없는 호출자가 아무 payload나 던져도 R2 읽기(Class B)가 발생합니다. 시간당 20회 제한이 있어 심각하진 않지만, 본문 파싱·검증을 R2 접근보다 앞으로 옮기면 공짜로 없어지는 낭비입니다.

## 🟡 S8. 보안 헤더가 전무하다

CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options` 중 어느 것도 설정돼 있지 않습니다. `_worker.js`가 모든 정적 요청을 `env.ASSETS.fetch()`로 그대로 넘기고 헤더를 덧붙이지 않습니다.

Cloudflare Workers 정적 자산은 `_headers` 파일을 지원하므로 `src/_headers`를 추가하면 됩니다.

```
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: geolocation=(), camera=(), microphone=()
```

⚠️ CSP를 넣을 때 주의: 각 페이지 `<head>`에 FOUC 방지용 인라인 `<script>`가 있어서(`novelPage.html:10-16` 등) `script-src`에 해시나 nonce가 필요합니다. 그거 없이 `script-src 'self'`만 걸면 테마가 깜빡입니다.

---

## ✅ 확인 결과 문제 없던 것들

조사했지만 **안전하다고 판정한** 항목입니다. (다음에 같은 곳을 또 파지 않도록 남겨둡니다.)

| 항목 | 판정 | 근거 |
|---|---|---|
| **저장형 XSS** | ✅ 없음 | 남이 지은 라이브러리 이름은 전부 `textContent`로만 들어갑니다 (`bookmarksPage.js:516`, `:597` 등). `innerHTML` 사용처는 전부 하드코딩된 SVG 상수이거나 비우기(`= ''`)입니다. |
| **개인 코드 강도** | ✅ 충분 | 20자 × 31자 알파벳 ≈ **99비트**. 버킷이 공개 읽기여도 `user/sha256('user-v2:'+code).json` 키를 추측하는 건 불가능합니다. |
| **평문 비밀 저장** | ✅ 없음 | R2에는 `editTokenHash` / `ownerHash`만 남고, `libraryPublicView()`가 응답에서 둘 다 제거합니다. `ownerHash`에 레코드 자신의 `code`를 섞어 같은 사람의 게시물끼리 상관관계가 드러나지 않게 한 설계도 적절합니다. |
| **커밋된 시크릿** | ✅ 없음 | `sync_to_r2.py`는 gitignore된 `.r2_config.json`에서 읽습니다. 전체 히스토리에서 키/토큰 패턴 0건. |
| **백엔드 소스 노출** | ✅ 없음 | `worker/`는 `src/` 밖이라 자산에 안 들어가고, `.assetsignore`가 `_worker.js`와 `wrangler.toml`을 제외합니다. |
| **개인 코드 URL 노출** | ✅ 없음 | `/owner/lookup`, `/user/*` 전부 POST — 서버 로그·리퍼러에 코드가 안 남습니다. |
| **콘솔 로그 유출** | ✅ 0건 | `src/js/`, `worker/` 전체에 `console.*` 호출이 하나도 없습니다. |
| **동기화 폴링** | ✅ 제거됨 | `userData.js`가 자동 폴링·포커스 감지를 전부 걷어내고 수동 버튼 + 120초 쿨타임으로 바꿨습니다. 이전에 우려했던 "탭당 분당 1회" 트래픽은 없습니다. |
| **검색 입력 렉** | ✅ 해결됨 | 150ms 디바운스 + `bookmarks.js`의 읽기 캐시 + 플레이스홀더 타이머의 `visibilitychange`/`IntersectionObserver` 게이팅까지 이미 들어가 있습니다. |

> 🔍 사소한 것 하나: `generateToken`의 `bytes[i] % ALPHABET.length`는 알파벳이 64자(2의 거듭제곱)라 편향이 없지만, `bookmarkLibrary.js:41`의 개인 코드는 알파벳이 **31자**라 `A`~`H`가 다른 글자보다 12.5% 더 자주 나옵니다(모듈로 편향). 99비트에서 몇 비트 깎이는 정도라 실질 위험은 없습니다. 신경 쓰인다면 거절 샘플링(`if (b >= 248) 재추출`)으로 없앨 수 있습니다.

---

# 📈 트래픽 · 대역폭

## 🔴 T1. 메인 페이지가 787KB JSON을 받는다 (과거 최적화 회귀)

`src/js/mainPage.js:186-189`

```js
Promise.all([
  fetch(DATA('../data/PageData/Novel.json')).then(...),   // 613 KB
  fetch(DATA('../data/PageData/Series.json')).then(...)   // 174 KB
]).then(function (results) {
  ...
  var recentNovels = novels.slice(0, 10);   // ← 10개만 씀
  var recentSeries = series.slice(0, 10);   // ← 10개만 씀
```

**최신 10개 + 10개, 총 20장의 카드를 그리려고 787KB를 받습니다.** 사이트의 첫 페이지, 즉 방문자당 무조건 한 번은 발생하는 요청입니다.

이건 과거에 이미 한 번 고쳤던 문제의 회귀입니다 — 커밋 `9d05215` "3순위: cache no-store 전면 제거 + **메인 페이지 493KB 낭비 제거**"에서 잡았던 것과 같은 패턴이고, 당시엔 `MoonHakdata.json` 대신 `Series.json`만 쓰도록 바꿨었습니다. 지금은 오히려 그때보다 더 많이 받습니다.

**조치**: 빌드 시점에 최신 20건만 담은 작은 JSON을 만드세요. `5_build_series_page_data.py` / `7_build_novel_page_data.py`와 같은 자리에 20줄이면 됩니다.

```
src/data/PageData/Recent.json   →  약 8~15 KB
```

**787KB → 15KB, 방문자당 약 770KB 절감.** 이 문서 전체에서 투자 대비 효과가 가장 큰 항목입니다.

---

## 🔴 T2. 2MB 가변 폰트를 전 페이지에서 `preload` 한다

```
src/fonts/Pretendard-1.3.9/web/variable/woff2/PretendardVariable.woff2
→ 2,057,688 바이트 (약 2.0 MB)
```

이게 **6개 페이지 전부**의 `<head>` 7번째 줄에 있습니다.

```html
<link rel="preload" href="../fonts/.../PretendardVariable.woff2" as="font" type="font/woff2" crossorigin />
```

`preload`는 "최우선으로 지금 당장 받아라"는 지시입니다. 즉 CSS·JS·JSON과 대역폭을 놓고 경쟁하며 2MB를 끌어옵니다. Chromium 계열에서는 preload 응답이 `window.load` 집계에 포함되는데, `loading.js`가 바로 그 `load` 이벤트를 기다렸다 로딩 화면을 걷습니다 — **폰트가 다 안 받아지면 로딩 화면이 안 걷힙니다.** L1의 2.2초 하한과 곱해지면 콜드 캐시 첫 방문의 체감이 크게 나빠집니다.

(브라우저 캐시에 들어가면 재방문은 괜찮습니다. 문제는 첫 방문과 캐시가 비워진 방문입니다.)

이전 감사에서 "폰트 — 문제 없음"으로 판정했던 건 **안 쓰이는 파일들이 서빙되지 않는다**는 뜻이었고, 그건 맞습니다. 다만 **실제로 쓰이는 그 하나가 2MB**라는 점은 짚히지 않았습니다.

### 선택지 (효과 순)

1. **동적 서브셋 사용 (권장)** — Pretendard는 `unicode-range`로 쪼갠 dynamic-subset 빌드를 제공합니다. 브라우저가 페이지에 실제로 쓰인 글자 구간만 받으므로 페이지당 **약 30~60KB**로 떨어집니다. 지금 로컬 패키지(`Pretendard-1.3.9/`)에는 이 빌드가 없어서 별도로 받아와야 합니다.
2. **직접 서브셋** — `pyftsubset`(fonttools)으로 KS X 1001 한글 2,350자 + 기본 라틴만 남기면 **약 250~400KB**. 로컬 패키지의 `web/static/woff2-subset/*.subset.woff2`가 약 267KB인 게 이 크기의 기준입니다.
3. **최소한 `preload`만 제거** — 파일 크기는 그대로지만 최우선 경쟁에서 빠지고, `font-display: swap`이 이미 걸려 있어 텍스트는 폴백 폰트로 먼저 보입니다. 한 줄 수정으로 체감이 즉시 개선됩니다.

---

## 🔴 T3. 배포 자산이 73MB — 68MB가 안 쓰는 폰트, 빌드 스크립트까지 공개

`src/wrangler.toml`
```toml
[assets]
directory = "."      # ← src/ 전체
```
`src/.assetsignore`
```
wrangler.toml
_worker.js
```

**`src/` 아래 전부가 공개 정적 자산으로 배포됩니다.** 제외되는 건 저 두 파일뿐입니다.

| 경로 | 크기 | 상태 |
|---|---|---|
| `/fonts/Pretendard-1.3.9/**` | **68 MB** (63개 파일) | 실제 사용은 `variable/woff2/` 1개뿐. 나머지 62개는 순수 낭비 |
| `/data/MoonHakdata.json` | 543 KB | **클라이언트 코드 어디서도 참조 안 함** (빌드 스크립트 전용 원본 DB) |
| `/data/문학 정리/**` | 2.8 MB | 원본 마크다운 전체 — `후방주의` 작품 포함, 사이트 UI를 거치지 않고 직접 열람·수집 가능 |
| `/scripts/*.py` | — | `sync_to_r2.py`(R2 설정 파일명·버킷 구조 노출), 크롤러, 빌더 전부 |
| `/scripts/crawl_entries.json` | 624 KB | 크롤링 중간 산출물 |
| `/scripts/series_entries.json` | 104 KB | 〃 |

시크릿이 들어 있진 않으니 "유출"은 아닙니다. 다만 **내부 파이프라인 구조와 원본 데이터가 통째로 공개돼 있고**, 68MB짜리 폰트 디렉터리는 나쁜 봇에게 좋은 대역폭 표적입니다. `robots.txt`가 `Disallow: /`여도 그걸 지키는 건 착한 크롤러뿐입니다.

**조치**: `src/.assetsignore`를 확장하세요. 배포 자산이 73MB → 약 4MB로 줄고, 배포 자체도 빨라집니다.

```
wrangler.toml
_worker.js

# 실제로 쓰는 가변 폰트 하나만 남기고 전부 제외
fonts/Pretendard-1.3.9/public/*
fonts/Pretendard-1.3.9/web/static/*
fonts/CCElephantmen Italic/*.ttf

# 빌드 파이프라인 (서버 사이드 전용)
scripts/*

# 클라이언트가 안 쓰는 원본 데이터
data/MoonHakdata.json
data/문학 정리/*
data/*.md
```

> ⚠️ `.assetsignore` 수정 후 반드시 배포본에서 `/page/mainPage.html`, 폰트, `PageData/*.json`이 정상인지 확인하세요. 패턴을 넓게 잡으면 쓰는 파일까지 빠질 수 있습니다.

---

## 🟠 T4. 모든 페이지에서 로고 404가 1회씩 나고, 이미지를 두 번 받는다

`src/page/novelPage.html:33` (다른 페이지도 동일 패턴)
```html
<img class="header-logo"
     src="../assets/Image/Logo/MainLogo_Dark.png"
     data-light-src="../assets/Image/Logo/Logo_Novel_Dark.png"
     data-dark-src="../assets/Image/Logo/Logo_Novel_Light.png" />
```

`src`는 **사이트 오리진 기준 상대 경로**입니다. 그런데 `src/assets`는 `.gitignore`에 등록돼 있어(`.gitignore:33`) 저장소에 없고, 따라서 **배포에도 없습니다**(`git ls-files src/assets` → 0건).

그래서 페이지가 열릴 때마다:

1. 브라우저가 `/assets/Image/Logo/MainLogo_Dark.png` 요청 → **404**
2. 깨진 이미지 아이콘이 잠깐 보임
3. `theme.js`의 `updateLogos()`가 `DOMContentLoaded`에서 실행돼 `src`를 R2 URL로 교체
4. 진짜 로고를 그제서야 다운로드

**모든 페이지, 모든 방문마다 낭비 요청 1건 + 로고 깜빡임 1회.** 트래픽 자체는 작지만 첫인상에 직접 닿는 부분입니다.

**조치**: `src`를 비워두고(또는 1x1 투명 data URI) `theme.js`가 채우게 하거나, 빌드 시점에 R2 절대 URL을 박아 넣으세요.

> 추가로 `seriesPage.html:33`만 경로 체계가 다릅니다 — `../assets/Image/Logo_Series_Dark.png`로, 다른 페이지들이 쓰는 `Logo/` 하위 폴더가 없습니다. R2에 그 경로가 실제로 있는지 확인해보세요. 없다면 시리즈 페이지 로고는 지금 완전히 깨져 있습니다.

---

## 🟠 T5. CSS `@import` 폭포수 — 렌더 블로킹 2단 왕복

```
novelPage.html
  └─ <link href="../css/common.css">        752 B
       ├─ @import base/fonts.css            ← 2단계에서야 발견됨
       ├─ @import base/reset.css
       ├─ @import layout/header.css
       ├─ @import layout/sidebar.css
       ├─ @import layout/site-info.css
       ├─ @import layout/footer.css
       ├─ @import components/loader.css
       ├─ @import components/series-toolbar.css
       ├─ @import components/series-card.css
       ├─ @import components/modal-series.css
       ├─ @import components/auth.css
       └─ @import components/bookmarks.css
  └─ <link href="../css/theme.css">          21 KB
```

브라우저는 `common.css`를 **다 받아서 파싱한 뒤에야** 12개의 `@import`가 있다는 걸 압니다. 즉 렌더 블로킹 CSS 13개가 **두 번의 직렬 왕복**으로 나뉘어 들어옵니다. 지연 시간이 긴 회선(모바일)에서 그대로 흰 화면 시간이 됩니다.

부수 효과로 `@font-face`가 든 `base/fonts.css`도 2단계에서야 발견되므로, CCElephantmen 폰트 요청은 그 뒤에야 시작됩니다. (Pretendard는 T2의 `preload`가 이걸 가려주고 있습니다 — 그게 preload를 넣은 이유였을 겁니다.)

**조치**: 모듈 구조는 유지하되 빌드 때 하나로 합치세요. 파이썬 스크립트 20줄이면 충분합니다.

```
src/css/common.css (@import 12개) → src/css/common.bundle.css (1개, 약 55KB)
```

빌드가 부담스럽다면 차선책으로 `@import` 대신 HTML에 `<link>` 12개를 직접 나열해도 됩니다 — 요청 수는 같지만 전부 1단계에서 병렬로 시작하므로 왕복이 한 번 줄어듭니다.

---

## 🟠 T6. `GET /library` 가 매 요청마다 버킷 전체를 스캔한다 (Class A)

`worker/favoritesShareWorker.js:408-437`

```js
async function scanLibrary(env) {
  while (true) {
    var page = await env.FAVORITES_BUCKET.list({
      prefix: 'library/', cursor: cursor,
      limit: LIBRARY_SCAN_PAGE,          // 1000
      include: ['customMetadata']
    });
    ...
    if (all.length >= LIBRARY_SCAN_MAX) { ... }   // 4000
  }
}
```

정렬(`new`/`updated`/`name`)과 이름 검색을 지원하려면 전체를 봐야 하니 설계 자체는 이해됩니다. 문제는 **캐시가 전혀 없다는 점**입니다.

- 라이브러리 탭을 **열 때마다** 전체 스캔
- "더 보기"를 누를 때마다(오프셋 페이징) **처음부터 전체를 다시** 스캔
- R2 `list()`는 **Class A 작업**입니다 — Class B(`get`/`head`)보다 단가가 12.5배 비쌉니다 (백만당 $4.50 vs $0.36)

지금은 오브젝트가 적어서 페이지당 `list()` 1회로 끝나지만, 라이브러리가 커지면 요청 1건이 최대 4회(또는 아래 각주대로면 그 이상)의 Class A로 불어납니다. IP당 시간당 120회 허용이니 상한이 꽤 높습니다.

> 🔎 **확인 필요**: R2 `list()`는 `include`를 지정하면 `limit`의 실효 상한이 1000이 아니라 **100**으로 낮아진다고 알고 있습니다. 사실이라면 4,000개를 훑는 데 4회가 아니라 **40회의 Class A**가 듭니다. 실제 배포에서 R2 지표로 한 번 확인해보시면 좋겠습니다.

**조치**: `caches.default`로 30~60초만 캐시해도 대부분 사라집니다. 쿼리 문자열(`sort`/`q`/`offset`/`limit`)을 캐시 키로 쓰면 됩니다.

```js
var cache = caches.default;
var cached = await cache.match(request);
if (cached) return cached;
// ... 기존 로직으로 res 생성
res.headers.set('Cache-Control', 'public, max-age=30');
ctx.waitUntil(cache.put(request, res.clone()));
return res;
```
(이러려면 핸들러에 `ctx`를 넘겨야 합니다 — 지금 시그니처는 `(url, request, env)`입니다.)

---

## 🟠 T7. 레이트리밋이 전혀 없는 공개 읽기 엔드포인트 2개

| 엔드포인트 | 레이트리밋 | 요청당 비용 |
|---|---|---|
| `GET /library/<code>` (`:487`) | **없음** | Worker 호출 1 + R2 `get()` 1 (Class B) |
| `POST /user/head` (`:896`) | **없음** (의도적) | Worker 호출 1 + R2 `head()` 1 (Class B) |

`/user/head`는 KV 할당량을 아끼려고 일부러 뺐다고 주석에 명시돼 있고(`:781-788`), S1을 보면 그 판단은 오히려 옳았습니다. 다만 결과적으로 **아무나 무제한으로 때릴 수 있는 엔드포인트**가 두 개 열려 있습니다. R2 Class B는 무료 한도가 월 1,000만이라 여유가 있지만, Worker 호출 수는 별도로 과금됩니다(무료 일 10만).

폴링이 사라진 지금 `/user/head`가 실제로 쓰이는 곳이 있는지 확인하고, 안 쓰인다면 라우트를 지우는 게 가장 깔끔합니다.

---

## 🟡 T8~T10. 나머지 위생 항목

**T8. Worker 응답에 `Cache-Control`이 없다** — `jsonResponse()`가 `Content-Type`과 CORS만 붙입니다. `GET /library/<code>`처럼 거의 안 바뀌는 응답도 매번 오리진까지 갑니다. 공유 링크가 퍼지면 그대로 요청 수가 됩니다.

**T9. 시리즈 상세 모달이 원본 이미지를 받는다** — `postDetailSeries.js:94`가 `resolveThumbUrl`이 아닌 `resolveAssetUrl`(원본)을 씁니다. 고화질을 원한다는 의도적 설계지만, 원본이 GIF나 고해상도 PNG면 카드 썸네일(수십 KB) 대비 수 MB가 나갑니다. `Novel.json`의 이미지 606장 중 GIF가 19장, PNG가 186장입니다. 카드 클릭당 비용이라 빈도는 낮지만 건당 비용은 사이트에서 가장 큽니다. 1200px 정도의 중간 프리셋을 `6_build_thumbnails.py`에 추가하는 걸 검토해볼 만합니다. (`src/assets`가 저장소에 없어 원본 실제 용량은 이번에도 확인하지 못했습니다 — 로컬에서 대표 몇 장 크기를 재보시면 판단이 섭니다.)

**T10. `LoadingIcons.json` 중복 fetch** — 그리드 페이지에서 `loading.js:28`과 `gridPage.js:145`가 같은 파일을 각각 받습니다. `?v=` 버전 쿼리가 붙어 있어 브라우저가 대개 합쳐주지만, 한쪽이 다른 쪽 결과를 재사용하는 게 맞습니다.

**T11. favicon 링크가 없다** — 모든 페이지에 `<link rel="icon">`이 없어서 브라우저가 매번 `/favicon.ico`를 요청하고 404를 받습니다. 페이지당 낭비 요청 1건.

---

# ⏱️ 체감 렉

## 🟠 L1. 로더가 페이지 이동마다 최소 2.2초를 강제한다

`src/js/loading.js`

```js
var OUTRO_REVEAL_MS = 700;
var MIN_VISIBLE_MS = 1500;
...
window.addEventListener('load', ready);   // ← 모든 리소스 로드 완료를 기다림
function ready() {
  var wait = Math.max(0, MIN_VISIBLE_MS - (Date.now() - startedAt));
  setTimeout(window.finishLoading, wait);  // → 다시 OUTRO_REVEAL_MS 700ms
}
```

페이지가 아무리 빨리 준비돼도 **`load` 이후 최소 1,500ms + 700ms = 2.2초**가 지나야 내용이 보입니다. 그리고 이 사이트는 SPA가 아니라 링크마다 전체 새로고침이 일어나는 다중 페이지 구조라, **탭을 옮길 때마다 매번** 이 2.2초를 다시 냅니다.

여기에 T2가 곱해집니다. `load`는 preload한 2MB 폰트까지 기다리므로, 콜드 캐시에서는 "폰트 2MB 다운로드 시간 + 2.2초"가 첫 화면까지의 시간이 됩니다.

이건 버그가 아니라 **의도된 연출**이고, 브랜딩으로서 가치가 있는 것도 사실입니다. 다만 "사이트가 느리다"는 체감의 가장 큰 단일 원인이 렌더링 코드가 아니라 이 두 상수라는 점은 알고 계시는 게 좋겠습니다. 조정한다면:

- `MIN_VISIBLE_MS` 1500 → 600~800
- `OUTRO_REVEAL_MS` 700 → 400
- `load` 대신 `DOMContentLoaded` 기준으로 (폰트/이미지를 안 기다리게)

셋 다 적용하면 이동당 체감이 2.2초 → 약 1초로 줄고, 연출 자체는 그대로 남습니다.

---

# 📊 유입(SEO) 측면 — 별개 논점

"트래픽을 증가시키는 요소"를 **방문자 유입**으로 읽으셨다면, 지금 상태는 정반대로 잠겨 있습니다.

- **`src/robots.txt` = `User-agent: * / Disallow: /`** — 검색 엔진 유입이 구조적으로 0입니다. 커밋 `7e81229`에서 의도적으로 하신 결정이라 그대로 두는 게 맞다고 봅니다(팬메이드 아카이브 + 원작자 비공식 + 성인 태그 작품 포함이라 오히려 합리적입니다). 다만 **유입을 늘리고 싶다면 이게 1순위 차단 요인**이라는 점만 짚어둡니다.
- **`<meta name="description">`, Open Graph, Twitter Card 태그가 전무합니다.** 이건 크롤링 차단과 **무관하게 손해입니다** — 디시·디스코드·카카오톡에 링크를 붙여넣을 때 뜨는 미리보기 카드가 OG 태그를 읽기 때문입니다. 지금은 제목도 이미지도 설명도 없는 맨 링크로 보입니다. 각 페이지 `<head>`에 4줄이면 됩니다.

  ```html
  <meta property="og:title" content="초카공 문학 아카이브" />
  <meta property="og:description" content="초카구야 공주 갤러리의 창작 문학·연재 시리즈·명예의 전당 모음" />
  <meta property="og:image" content="https://pub-908f....r2.dev/assets/Image/Logo/MainLogo_Dark.png" />
  <meta property="og:type" content="website" />
  ```
- `sitemap.xml`은 크롤링을 막아둔 이상 의미가 없습니다.

---

# ✅ 권장 조치 순서

**지금 바로 (사이트가 죽는 걸 막는 것)**
1. **S1** — `checkRateLimit`의 KV 호출을 `try/catch`로 감싸 fail open. 최상위 `fetch()`에도 `try/catch`. *(수정 한 줌, 효과 최대)*

**이번 주 안에 (돈과 속도)**
2. **T1** — `Recent.json` 빌드해서 메인 페이지 787KB → 15KB
3. **T3** — `.assetsignore` 확장해 배포 자산 73MB → 4MB
4. **T2** — 폰트 서브셋 적용, 또는 최소한 `preload` 제거
5. **S5** — 회원가입 한도 3~5회/일로 완화 + 성공 시에만 카운트

**여유 있을 때 (구조 개선)**
6. **S4** — 관리자 삭제 키 도입 *(사고 나기 전에 해두는 게 사고 후보다 훨씬 쌉니다)*
7. **S3** — CORS `*` 제거 (동일 출처라 이제 불필요)
8. **T5** — CSS 번들링
9. **T6** — `/library` 목록에 `caches.default` 30초 캐시
10. **T4** — 로고 `src` 404 제거
11. **L1** — 로더 상수 조정 여부 결정 *(취향 문제 — 판단은 사용자 몫)*

**언젠가**
12. S6·S7·S8, T7~T11, 그리고 S1을 네이티브 Rate Limiting 바인딩으로 완전 교체

---

## 조사 범위

| 대상 | 파일 |
|---|---|
| 백엔드 | `worker/favoritesShareWorker.js` (1,006줄 전체), `src/_worker.js`, `src/wrangler.toml`, `src/.assetsignore` |
| 인증·동기화 | `auth.js`, `authModal.js`, `userData.js`, `bookmarkLibrary.js`, `bookmarks.js` |
| 렌더링 | `gridPage.js`, `mainPage.js`, `bookmarksPage.js`, `postCard.js`, `postDetailSeries.js`, `cdnConfig.js`, `loading.js`, `theme.js`, `sidebar.js` |
| 자산·스타일 | `src/page/*.html` 7개, `src/css/**` 17개, `src/fonts/**`, `src/data/**` |
| 저장소 | 전체 git 히스토리 시크릿 스캔, `.gitignore`, `sync_to_r2.py` |
| **미확인** | **배포본의 실제 응답 헤더 · R2/KV 실사용 지표** — `cpkg.by-works.net`이 DNS에서 해석되지 않아 라이브 검증 불가 |
