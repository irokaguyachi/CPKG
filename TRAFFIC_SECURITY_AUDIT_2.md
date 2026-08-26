# 트래픽 · 보안 2차 정밀 점검 (2026-08-24)

`TRAFFIC_SECURITY_AUDIT.md`(1차, 같은 날짜)의 **후속·보완 문서**입니다. 1차가 다룬 항목을 다시 쓰지 않고,

1. 1차가 **놓친 것**을 새로 찾고,
2. 1차의 주장을 **실측으로 검증하거나 정정**하고,
3. 1차가 못 했던 **라이브 확인**을 실제로 수행

하는 데 집중했습니다.

## 이번에 새로 확보한 것 — 라이브 실측

1차는 "정적 분석만 했고 배포본 응답 헤더·R2 실사용은 확인 못 했다"고 적었습니다. 이번에는 **R2 공개 버킷(`pub-908f4390549649fbbdff99353f22c6d4.r2.dev`)이 살아 있어서 실제로 측정했습니다.**

| 측정 항목 | 실측값 | 방법 |
|---|---|---|
| 사이트가 참조하는 원본 이미지 | **638개 / 470.3 MB / 평균 755 KB / 최대 17.09 MB** | 649개 전 경로에 HEAD |
| 썸네일 | **632개 / 17.5 MB / 평균 28 KB** | 〃 |
| 썸네일 없는 이미지 | **17개** (그중 11개는 원본도 404) | 〃 |
| 중복 저장 | **110.1 MB (23%)** — 43개 그룹, 12.56 MB GIF 하나가 8벌 | ETag 비교 |
| R2 자산 응답 헤더 | `Cache-Control: public, max-age=31536000, immutable` ✅ | 실제 응답 |
| `cpkg.by-works.net` | MX는 있으나 **A/AAAA 레코드 없음 → 사이트 접속 불가** | 8.8.8.8 / 1.1.1.1 조회 |

> ⚠️ **여전히 확인 못 한 것**: 배포본(Worker)의 응답 헤더와 KV/Worker 실사용 지표. 도메인에 A 레코드가 없고 `cpkg.nwb10102.workers.dev` / `chokaguya-favorites-share.nwb10102.workers.dev` 둘 다 NXDOMAIN이라 API 엔드포인트에 닿을 수 없었습니다(→ **N-S8** 참고).
>
> 🔁 **[2026-08-26 정정]** 시도했던 workers.dev 서브도메인(`nwb10102`)이 틀렸을 뿐, 실제 계정 서브도메인은 `cpkg`였습니다. `https://cpkg.cpkg.workers.dev/`로 배포본에 정상적으로 닿습니다 — 이 문서가 "확인 못 했다"고 적은 배포본 응답 헤더는 이제 실측 가능합니다(N-T1 항목의 재확인 노트 참고, `/js/*`·`/css/*`·`/data/*`·`/fonts/*` 헤더를 실제로 검증함).
>
> 📌 **표기 규칙**: 각 항목에 `[실측]`(직접 측정/실행해 확인) · `[코드확인]`(소스에서 직접 확인) · `[문서확인]`(Cloudflare 공식 문서로 확인) · `[추정]`(근거는 있으나 확증 못 함)을 붙였습니다.

### 1차에서 "수정 진행 중"인 항목 (재보고하지 않음)

`Nwb10102/cpkg-audit-fixes` 브랜치에서 작업 중: **S1, S2, S3, S5, T1, T2, T4**. `main`에는 아직 코드가 그대로 있지만 여기서 다시 지적하지 않습니다. 다만 **S1/S2는 이번에 찾은 N-S3 때문에 원래 알려진 것보다 더 잘 터진다**는 점만 아래에 덧붙였습니다.

> 🔁 **[2026-08-26 재점검]** 위 브랜치는 더 이상 존재하지 않습니다(`git branch -a` 확인, `origin/main`만 남음) — 작업이 브랜치 병합이 아니라 `main`에 직접 커밋되는 방식으로 이어진 것으로 보입니다. 이 재점검은 **이 문서(2차)가 신규로 제기한 N- 항목들이 현재 `main`에서 실제로 고쳐졌는지**를 코드 대조 + 일부 라이브 재측정으로 확인한 결과입니다. 각 항목 제목 아래 `[2026-08-26 재확인]` 블록에 결과를 적었습니다. 1차 문서(S1~T11) 자체의 재검증은 이번 범위 밖입니다.

---

## 결론 요약

| # | 항목 | 심각도 | 성격 | 근거 |
|---|---|---|---|---|
| **N-S1** | Worker 무료 플랜 **서브요청 50개** 한도 vs 최대 500회 직렬 R2 호출 | 🔴 치명 | 가용성 | 코드확인+문서확인 |
| **N-T1** | 정적 자산 기본 캐시가 `max-age=0, must-revalidate` — 페이지 이동마다 **33~36건 재검증** | 🔴 높음 | 요청량 / 체감속도 | 문서확인 |
| **N-T2** | 상세 모달이 원본을 받음 — **평균 755 KB, 최대 17.09 MB** | 🔴 높음 | 대역폭 | **실측** |
| **N-S2** | 계정·라이브러리 데이터가 **공개 읽기 버킷에 그대로** — 서버 마스킹이 우회됨 | 🟠 중간 | 정보노출 / 남용 | 실측+코드확인 |
| **N-S7** | 19금 포함 **원문 229편 공개 배포** + 작성자 핸들 대량 노출 + **저장소가 PUBLIC** | 🟠 중간 | 노출 / 법적 | 실측 |
| **N-S8** | 배포 도메인에 A 레코드 없음 → **사이트가 지금 안 열림** | 🟠 중간 | 운영 | **실측** |
| **N-T3** | 썸네일 없는 카드 17건(최대 2.12 MB 원본 로드) + **완전히 깨진 이미지 11건** | 🟠 중간 | 대역폭 / UX | **실측** |
| **N-T4** | 참조 원본의 **23%(110 MB)가 중복 저장** | 🟠 중간 | 저장 / 배포시간 | **실측** |
| **N-T5** | `DATA_VERSION`이 4일째 고정 — 캐시 버스팅이 죽어 있음 | 🟠 중간 | 잠재 버그 | 코드확인 |
| **N-S3** | KV **키당 초당 1회** 쓰기 한도 — 레이트리밋이 버스트에서 정확히 무력화 | 🟠 중간 | 가용성 / 남용 | 문서확인 |
| **N-S4** | 클라이언트 호출자가 **하나도 없는 공개 엔드포인트 3개** | 🟠 중간 | 공격면 | 코드확인 |
| **N-S6** | `POST /user/head` 무제한 + 검사 전 1 MB 본문 읽기 | 🟠 중간 | 비용 / DoS | 코드확인 |
| **N-T6** | 북마크 상세 진입 시 카탈로그 4개(792 KB) 전량 로드 | 🟡 낮음 | 대역폭 | 코드확인 |
| **N-S5** | `claimToken`의 "아무것도 안 바꾸는 PUT"이 실제로는 `updatedAt`을 바꿈 | 🟡 낮음 | 데이터 정합성 | 코드확인 |
| **N-S9~S12** | 동기화 무한 재시도, 인덱스 CAS 없음, 코드 할당 실패, 페이로드 팽창 | 🟡 낮음 | 위생 | 코드확인 |
| **N-T7~T10** | 죽은 스크립트 2개, 라이브러리 검색 증폭, 고아 파일, 배포 71.5 MB 재해석 | 🟡 낮음 | 위생 | 실측+코드확인 |

---

## 🔁 2026-08-26 재점검 — 그때 이후 뭐가 바뀌었나

이 문서가 지적한 항목들을 오늘 `main` 기준 코드와 대조하고, 가능한 것은 R2에 직접 HEAD 요청을 다시 보내 실측했습니다(방법은 각 항목 아래 `[2026-08-26 재확인]`에 적음). 요약하면 **치명·높음 등급 중 절반이 실제로 고쳐졌습니다.**
>
> ⚠️ 이 재점검은 처음에 **N-S8("사이트가 안 열린다")을 잘못 재확인**했습니다 — `cpkg.nwb10102.workers.dev`가 NXDOMAIN인 것만 보고 "여전히 접속 불가"로 결론 냈는데, 실제 workers.dev 서브도메인은 `cpkg`였고 `https://cpkg.cpkg.workers.dev/`로 사이트가 정상적으로 열립니다(사용자가 직접 확인해줌). 이후 사용자가 **새 도메인 `ckpg.cloud`를 구매해 Cloudflare Custom Domain으로 직접 연결**했고, 지금은 이게 정식 프로덕션 주소입니다 — `cpkg.by-works.net`은 이 프로젝트에서 완전히 손을 뗐습니다. 아래 표와 N-S8 항목은 이 정정·해결을 반영했습니다.

| # | 상태 | 한 줄 요약 |
|---|---|---|
| **N-S1** | ✅ 완전 해결 | `OWNER_MAX_PUBLISHED` 500 → **5**로 하드 상한 (커밋 `7c417ca`, 코드 주석에 이 문서를 직접 인용) |
| **N-S2** | ⚠️ 부분 (주석만 정정) | 버킷 분리는 안 됐지만, 문제였던 "GET은 Worker만 거친다"는 틀린 주석은 사실에 맞게 다시 씀 |
| **N-S3** | ✅ 완전 해결 | KV 카운터 → Cloudflare 네이티브 Rate Limiting 바인딩 5종으로 교체 (`wrangler.toml` `[[ratelimits]]`) |
| **N-S4** | ❌ 그대로 | 죽은 export 6개·라우트 2개 여전히 외부 호출 0건 (재확인함) |
| **N-S6** | ❌ 그대로 | `/user/head` 레이트리밋 여전히 의도적으로 건너뜀, 1MB 사전읽기도 그대로 |
| **N-S7** | ✅ 대부분 해결 | `.assetsignore`에 `scripts/`, `data/문학 정리/`, `data/MoonHakdata.json`, `data/*.md` 추가 + **GitHub 저장소 PRIVATE 전환 확인**(실측) |
| **N-S8** | ✅ 완전 해결 (2026-08-26) | `cpkg.by-works.net`은 포기하고 **새 도메인 `ckpg.cloud`를 구매해 Cloudflare Custom Domain으로 연결** — A 레코드(104.21.96.20 등)로 정상 해석, `https://ckpg.cloud/`가 200으로 응답함(실측) |
| **N-S5 / S9 / S10 / S11 / S12** | ❌ 그대로 | 코드 변경 없음 (S10은 N-S1 덕에 노출 규모만 축소) |
| **N-T1** | ⚠️ 부분 해결 | `src/_headers` 생김 — 보안헤더 4종 + 폰트 immutable + `/data/*` 5분 캐시는 적용. **`/js/*`·`/css/*`는 배포 반영 지연 사고 때문에 오히려 도로 뺌** — 재검증 요청 다수는 여전함 |
| **N-T2** | ⚠️ 부분 완화 | `revealBackgroundProgressive` 도입으로 체감(권장조치 3번)은 개선. 중간 프리셋(1200px)은 미도입 — 최종 전송량은 그대로 |
| **N-T3** | ❌ 그대로(실측) | 확인한 원본 5건 모두 썸네일 여전히 404, 깨진 이미지 11건 전부 원본·썸네일 그대로 404 |
| **N-T4** | ❌ 그대로 | `sync_to_r2.py`에 해시 기반 중복 제거 로직 없음 (재측정은 비용상 생략) |
| **N-T5** | ⚠️ 완화 | 상수 자동화는 안 됐지만 값은 최신으로 수동 갱신됨 + `/data/*` 캐시를 문서 권장대로 5분으로 짧게 잡아 실질 위험 낮춤 |
| **N-T6** | ❌ 그대로 | `bookmarksPage.js`가 여전히 카탈로그 4개(792KB) 전량 로드 |
| **N-T7** | ✅ 완전 해결 | `postCard.js`/`recentSection.js` 파일 자체 삭제, `mainPage.html` 참조 제거 |
| **N-T8** | ❌ 그대로 | 디바운스 250ms 그대로 (다만 N-S3의 `RL_LIB_LIST`가 최악의 경우를 완충) |
| **N-T9** | ✅ 대부분 해결 | 고아 CSS 4개 + `loadingScreen.html/css` 삭제됨. 루트 `index.html` 중복만 남음 |
| **N-T10** | (근거 그대로 유효) | `.assetsignore` 확장으로 정보노출 목적은 N-S7에서 같이 해결됨 |

---

**가장 먼저 볼 것은 N-S1과 N-T1입니다.** N-S1은 "북마크를 50개 넘게 공개한 사용자는 자기 계정에 로그인할 수 없게 된다"는 재현 가능한 고장이고, N-T1은 한 줄짜리 파일 하나(`src/_headers`)로 페이지 이동당 30여 건의 왕복을 없애면서 1차의 S8(보안 헤더 부재)까지 같이 해결됩니다.

---

# 🔒 보안 · 가용성 (신규)

## 🔴 N-S1. Worker 서브요청 50개 한도 vs 최대 500회 직렬 R2 호출 `[코드확인 + 문서확인]`

Cloudflare 공식 문서(`workers/platform/limits`)를 직접 확인했습니다.

> Workers Free: **50 subrequests** per invocation / Workers Paid: 10,000
> "any request a Worker makes using the Fetch API **or to Cloudflare services like R2, KV, or D1**"
> R2의 `list()`, `get()`, `put()`, `delete()`, `head()`가 전부 서브요청으로 카운트됩니다.

그런데 이 Worker에는 **호출 횟수가 데이터 양에 비례해 늘어나는 직렬 루프가 두 군데** 있습니다.

**(1) `worker/favoritesShareWorker.js:645-657` — `handleOwnerLookup`**

```js
for (var i = 0; i < codes.length; i++) {
  var libCode = codes[i];
  var head = await env.FAVORITES_BUCKET.head('library/' + libCode + '.json');  // ← 코드 하나당 1 서브요청
```

`codes.length`의 상한은 `OWNER_MAX_CODES = 500`(`:118`)입니다. 앞서 `readJsonBody` 전에 KV `get`+`put` 2회를 이미 썼으므로, **개인 코드에 연결된 공개 북마크가 약 47개를 넘는 순간 50개 한도를 넘겨 Worker가 예외로 죽습니다.**

**(2) `worker/favoritesShareWorker.js:841-862` — `migrateFromOwnerIndex`** (← `POST /user/get`, 즉 **로그인** 경로)

```js
for (var i = 0; i < codes.length && bookmarks.length < USER_MAX_BOOKMARKS; i++) {
  var libObject = await env.FAVORITES_BUCKET.get('library/' + codes[i] + '.json');  // ← head가 아니라 본문 get
```

이쪽은 `head()`가 아니라 **본문을 통째로 읽는 `get()`**이고, 상한이 `USER_MAX_BOOKMARKS = 100`입니다. 구버전 개인 코드로 처음 로그인하는 사용자가 공개 북마크를 50개 이상 갖고 있으면 **로그인 자체가 500으로 실패**하고, 재시도해도 매번 같은 지점에서 죽습니다.

**왜 중요한가**: 이건 공격자가 필요 없는 고장입니다. 기능을 열심히 쓴 사용자일수록 확실하게 걸립니다. 그리고 1차 S1과 달리 UTC 자정에 저절로 낫지도 않습니다 — 영구적입니다.

**권장 조치**
1. 두 루프 모두 **한 번에 처리할 개수를 하드 상한(예: 30)으로 자르고**, 나머지는 `hasMore` + 커서로 클라이언트가 이어 받게 하세요. `OWNER_MAX_CODES = 500`은 저장 상한이지 한 요청에서 다 훑어도 된다는 뜻이 아닙니다.
2. 직렬 `await`를 `Promise.all` 배치로 바꾸면 지연은 줄지만 **서브요청 개수는 그대로**라 근본 해결이 아닙니다. 개수를 줄여야 합니다.
3. `migrateFromOwnerIndex`는 `get()` 대신 `head()` + `customMetadata`로 충분한지 검토하세요 — 현재는 `items`가 필요해서 `get`을 쓰지만, 마이그레이션을 여러 요청으로 쪼개면 그대로 둬도 됩니다.
4. 유료 플랜이라면 한도가 10,000이라 지금 당장은 안 터집니다. **어느 플랜인지부터 확인하세요** — 이 항목의 심각도가 🔴에서 🟡로 바뀝니다. *(플랜은 코드로 알 수 없어 확인 못 했습니다.)*

> ✅ **[2026-08-26 재확인] 완전 해결됨.** `worker/favoritesShareWorker.js:134`에 `OWNER_MAX_PUBLISHED = 5`가 도입됐고(원래 500), 주석이 이 문서의 N-S1 문제를 그대로 인용하며 이유를 설명합니다. `handleLibraryCreate`(:461-468)와 `handleLibraryClaimOwner`(:709-713)가 게시/연결 시점에 이 상한을 직접 강제하므로 `handleOwnerLookup`·`migrateFromOwnerIndex`의 순차 루프는 이제 최대 5회만 돕니다 — 50개 서브요청 한도에 걸릴 수 없습니다. 커밋 `7c417ca fix(worker): 개인 코드당 공개 북마크 수를 5개로 제한 (N-S1)`. 위 권장 조치 1번(하드 상한)과 다른 방식(개수 자체를 원천 축소)으로 같은 목적을 달성했습니다 — 4번(플랜 확인)은 여전히 미확인이지만 상한이 낮아져 무료 플랜이어도 더는 위험하지 않습니다.

---

## 🟠 N-S2. 계정·라이브러리 데이터가 공개 읽기 버킷에 그대로 있고, 서버 마스킹이 우회된다 `[실측 + 코드확인]`

`src/wrangler.toml:24-26`
```toml
[[r2_buckets]]
binding = "FAVORITES_BUCKET"
bucket_name = "chokaguya-assets"
```

`src/js/cdnConfig.js:7`
```js
var R2_CDN_BASE = 'https://pub-908f4390549649fbbdff99353f22c6d4.r2.dev';
```

**Worker가 `library/`, `owners/`, `user/` 오브젝트를 쓰는 버킷과, 브라우저가 이미지를 받아가는 공개 CDN 버킷이 같은 버킷입니다.** r2.dev 공개 도메인은 프리픽스 단위가 아니라 **버킷 전체**를 공개합니다. 실제로 확인했습니다 — 임의 키에 GET이 그대로 나갑니다(예: `/assets/Image/Logo/MainLogo_Dark.png` → 200, 63,372 B).

그래서 `worker/favoritesShareWorker.js:347-355`의 마스킹이 무의미해집니다.

```js
function libraryPublicView(code, record) {
  return { code, name, items, createdAt, updatedAt };   // editTokenHash / ownerHash 제거
}
```

- `GET /library`(`:440`)는 **모든 공개 북마크의 `code`를 그대로 목록으로 내려줍니다.**
- 그 code로 `https://pub-908f….r2.dev/library/<code>.json`을 직접 받으면 **`editTokenHash`와 `ownerHash`가 포함된 원본 레코드**가 나옵니다.
- 덤으로 **Worker의 레이트리밋·인증을 전부 우회**해서 라이브러리 전체를 긁을 수 있습니다.

> 🔍 **실제 위험도는 낮습니다** — 이건 정확히 짚고 넘어가야 합니다. `editToken`은 24자 × 64자 알파벳 ≈ 144비트, `ownerHash`는 `sha256('owner:'+code+':'+personalCode)`이고 개인 코드가 20자 × 31자 ≈ 99비트라 해시 역산은 불가능합니다. 레코드 자신의 `code`를 해시에 섞어 상관관계를 끊어둔 `:187-189`의 설계도 그대로 유효합니다. `user/<sha256('user-v2:'+code)>.json`도 키를 모르면 못 찾습니다.
>
> 즉 **비밀이 새는 건 아닙니다.** 문제는 `:34-38`의 주석이 근거로 삼는 전제 — "GET은 반드시 Worker를 거쳐야 하고 거기서 마스킹한다" — 가 **사실이 아니라는 점**입니다. 지금은 다행히 마스킹 대상이 둘 다 강한 해시라서 무해하지만, 앞으로 레코드에 필드를 하나라도 더 넣을 때(예: 게시자 표시명, 통계, 신고 상태) 그게 자동으로 전세계 공개가 됩니다.

**권장 조치**
1. **가장 깔끔한 방법**: 계정/라이브러리용 R2 버킷을 이미지 CDN 버킷과 **분리**하고, 새 버킷에는 공개 도메인을 붙이지 마세요. Worker 바인딩만 있으면 되므로 기능에 영향이 없습니다. 마이그레이션은 `library/`, `owners/`, `user/` 프리픽스만 복사하면 됩니다.
2. 분리가 부담스럽다면 최소한 **`worker/favoritesShareWorker.js:34-38` 주석을 사실에 맞게 고치고**, "이 버킷에 쓰는 모든 값은 공개된다고 가정한다"를 불변 규칙으로 못박아 두세요.
3. `r2.dev` 공개 도메인은 Cloudflare가 프로덕션 용도로 권장하지 않고 자체 레이트리밋을 겁니다. 커스텀 도메인을 붙이면 이 문제도 같이 정리됩니다.

> ⚠️ **[2026-08-26 재확인] 부분 조치.** 권장 조치 2번(주석 정정)은 됐습니다 — `worker/favoritesShareWorker.js:34-38`이 이제 "GET이 반드시 Worker를 거쳐야 마스킹된다"는 틀린 전제 대신, "r2.dev 버킷은 `Access-Control-Allow-Origin` 헤더가 없어 브라우저 JS의 교차 출처 fetch가 막힌다"는 사실에 맞는 이유로 바뀌어 있습니다. 다만 **1번(버킷 분리)은 안 됐습니다** — `wrangler.toml`의 `FAVORITES_BUCKET`은 여전히 `chokaguya-assets` 하나뿐이고, 실측으로도 `pub-908f….r2.dev/assets/Image/...`가 그대로 200을 반환합니다(같은 버킷). 원래 분석대로 지금 당장 비밀이 새는 건 아니지만(에디트토큰/오너해시 둘 다 강한 해시), 구조적 위험은 그대로 남아 있습니다.

---

## 🟠 N-S3. KV는 키당 **초당 1회**만 쓸 수 있다 — 레이트리밋이 버스트에서 정확히 무력화된다 `[문서확인]`

Cloudflare KV 문서 확인 결과, 무료 플랜 한도는 1차가 적은 "하루 쓰기 1,000회"에 더해 **`키당 초당 1회 쓰기`(무료·유료 공통)**가 있습니다.

`worker/favoritesShareWorker.js:268-278`의 키는

```js
var key = 'rl:' + bucket + ':' + ip + ':' + windowStart;
```

**IP 하나 + 버킷 하나 + 시간창 하나 = 키 하나**입니다. 즉 같은 사용자가 1초에 2번 이상 요청하면 **같은 키에 초당 2회 쓰기**가 되어 KV가 이를 거부합니다.

이게 두 가지를 동시에 망칩니다.

- **가용성** (1차 S1과 곱해짐): `checkRateLimit`에 `try/catch`가 없으므로 KV가 던진 오류가 그대로 전파됩니다. 하루 1,000회를 채우지 않아도, **라이브러리 탭에서 검색어를 빠르게 타이핑하는 것만으로** API가 죽을 수 있습니다.
- **남용 억제** (1차 S2와 곱해짐): 하필 **버스트일 때** 리미터가 동작을 멈춥니다. 리미터가 막아야 할 유일한 상황에서 정확히 무력해지는 구조입니다.

**권장 조치**: 1차 S1의 `try/catch` fail-open은 필수이되 그것만으로는 억제 효과가 사라집니다. 결국 1차가 이미 권한 **Cloudflare 네이티브 Rate Limiting 바인딩**이 정답입니다 — KV 할당량을 안 쓰고, 원자적이며, 초당 한도가 없습니다.

> ✅ **[2026-08-26 재확인] 완전 해결됨, 권장안 그대로 채택.** `src/wrangler.toml`에 `[[ratelimits]]`가 5개(`RL_LIB_WRITE`, `RL_LIB_LIST`, `RL_OWNER_LOOKUP`, `RL_USER_AUTH`, `RL_USER_SYNC`, 전부 60초 창) 생겼고, 라이브러리·조회·로그인·동기화 전부 KV 대신 이걸 씁니다(`checkLimit()`). KV 카운터(`rateLimitKey`/`peekRateLimit`/`bumpRateLimit`)는 **회원가입 일일 한도 하나에만** 남았고, 그마저 조회(peek)와 증가(bump)를 분리해 실제 계정 생성 성공 시에만 KV 쓰기가 일어나도록 바꿨습니다 — "버스트에서 정확히 무력화"되던 원래 문제 자체가 사라졌습니다. try/catch fail-open도 `checkLimit`/`peekRateLimit`/`bumpRateLimit` 전부에 그대로 있습니다.

---

## 🟠 N-S4. 클라이언트 호출자가 하나도 없는 공개 엔드포인트가 3개 있다 `[코드확인]`

`src/js/bookmarkLibrary.js`가 export하는 함수들의 실제 호출 횟수를 전수 조사했습니다(정의 파일 제외).

| export | 외부 호출 수 | 대응 Worker 라우트 |
|---|---|---|
| `claimToken` (`:292`) | **0** | `PUT /library/<code>` (no-op 검증) |
| `claimAllByPersonalCode` (`:322`) | **0** | **`POST /owner/lookup`** |
| `linkToPersonalCode` (`:272`) | 0 (죽은 `claimToken`만 호출) | **`POST /library/<code>/claim-owner`** |
| `restorePublishedToLocal` (`:354`) | **0** | — |
| `linkLocalBookmark` (`:169`) | **0** | — |
| `confirmPersonalCode` (`:103`) | **0** | — |

즉 **`POST /owner/lookup`과 `POST /library/<code>/claim-owner`는 이제 사이트 어디에서도 호출되지 않습니다.** (`migrateFromOwnerIndex`는 Worker 내부에서 `ownerIndexKey()`를 직접 계산하므로 HTTP 라우트를 쓰지 않습니다 — `:830-831` 확인.)

**왜 중요한가**: 아무도 안 쓰는 라우트가 인증 없이 공개돼 있고, 그중 `/owner/lookup`은 **N-S1의 500회 직렬 `head()` 폭탄이 있는 바로 그 핸들러**입니다. 유지보수 대상에서 빠진 코드가 가장 큰 비용을 낼 수 있는 자리에 남아 있는 상태입니다.

**권장 조치**
1. `worker/favoritesShareWorker.js:976-978`, `:996-1000`의 라우트 등록을 지우고, `handleOwnerLookup` / `handleLibraryClaimOwner`도 함께 제거하세요. `src/_worker.js:20`의 `API_EXACT_PATHS`에서 `/owner/lookup`도 빼야 합니다.
2. 나중에 되살릴 계획이 있다면 최소한 N-S1의 상한부터 먼저 넣으세요.
3. `src/js/bookmarkLibrary.js`의 죽은 export 6개도 정리하면 클라이언트 번들이 줄고, "이 기능이 아직 살아 있다"는 오해도 사라집니다.

> ❌ **[2026-08-26 재확인] 그대로.** `src/js/bookmarkLibrary.js`의 `claimToken`, `claimAllByPersonalCode`, `linkToPersonalCode`, `restorePublishedToLocal`, `linkLocalBookmark`, `confirmPersonalCode` 6개 export를 `src/js/`, `src/page/` 전수 grep으로 다시 확인했는데 여전히 외부 호출 0건입니다(서로만 내부 호출). `/owner/lookup`, `/library/<code>/claim-owner` 라우트도 `route()`에 그대로 남아 있습니다. 흥미롭게도 파일 상단 주석은 "이 코드로 전체 되찾기"를 마치 살아 있는 기능처럼 자세히 설명하는데, 실제로는 새로 생긴 계정 시스템(`userData.js`의 `/user/get` → 서버 내부 `migrateFromOwnerIndex`)이 **HTTP 라우트를 안 거치고** 같은 일을 대신하고 있어서, 이 죽은 코드가 여전히 죽어 있는 이유만 더 분명해졌을 뿐입니다.

---

## 🟠 N-S6. `POST /user/head`는 레이트리밋 없이 1 MB 본문을 먼저 읽는다 `[코드확인]`

`worker/favoritesShareWorker.js:896-898`
```js
async function handleUserHead(request, env) {
  var parsed = await readUserBody(request, env, null, 0);   // bucket=null → 레이트리밋 건너뜀
```

`readUserBody`(`:781-798`)는 `bucket`이 falsy면 레이트리밋을 통째로 건너뛴 뒤 `readJsonBody(request, USER_MAX_BODY_BYTES)`를 호출합니다. 그리고 `readJsonBody`(`:337-345`)는 **먼저 `await request.text()`로 전부 읽고 나서** 길이를 봅니다.

결과적으로 **인증도 제한도 없이, 누구나, 무제한으로** Worker에 1 MB짜리 본문을 던져 전체 읽기 + `JSON.parse`를 시킬 수 있습니다. 각 요청이 무료 플랜 **하루 10만 Worker 호출**을 소모합니다(정적 자산 요청은 무료·무제한이므로, 이 할당량을 쓰는 건 사실상 API 호출뿐입니다 — `[문서확인]`).

> ⚠️ **1차 T7의 권고 정정**: 1차는 "폴링이 사라졌으니 `/user/head`가 실제로 쓰이는지 확인하고 안 쓰이면 라우트를 지우라"고 했는데, **지금도 쓰입니다.** `src/js/userData.js:369`의 `pullIfStale()`이 동기화 버튼(`requestSync`)을 누를 때마다 호출합니다. 지우면 동기화가 깨집니다.

**권장 조치**: 라우트를 지우지 말고,
1. `readUserBody`에 `Content-Length` 선검사를 넣어 초과분은 본문을 읽기 전에 413으로 끊으세요(1차 S6과 같은 수정).
2. `/user/head`에도 느슨한 레이트리밋(예: 시간당 300)을 다시 붙이되, **KV가 아니라 네이티브 Rate Limiting 바인딩**을 쓰세요 — 원래 KV를 아끼려고 뺀 것이므로 N-S3의 해결책과 같이 가면 이유가 사라집니다.
3. 개인 코드는 최대 64자입니다. `/user/head`는 본문에서 `personalCode` 하나만 쓰므로 **이 라우트 전용으로 본문 상한을 1 KB 정도로 낮추면** 위 문제 대부분이 한 줄로 사라집니다.

> ❌ **[2026-08-26 재확인] 그대로.** `handleUserHead`(:1017-1029)는 여전히 `readUserBody(request, env, null)`로 레이트리밋을 건너뛰고, `readJsonBody`(:425-433)도 여전히 `Content-Length` 확인 없이 `request.text()`로 전체를 먼저 읽습니다. 다만 코드 주석(:891-895)이 이제 이걸 실수가 아니라 **의도**라고 밝힙니다 — "head는 R2 `head()` 조회뿐이라 남용돼도 부담이 가볍다"는 이유로 일부러 열어뒀다는 것. N-S3에서 네이티브 Rate Limiting 바인딩을 이미 도입했으므로(`RL_USER_AUTH` 등), 권장 조치 2번(같은 바인딩을 `/user/head`에도 붙이기)은 지금 구조에서 비용이 사실상 0에 가깝습니다 — 여전히 검토해볼 만합니다.

---

## 🟠 N-S7. 19금 포함 원문 229편이 공개 배포되고, 작성자 핸들이 대량 노출되며, 저장소가 PUBLIC이다 `[실측]`

1차 T3이 "원본 마크다운 전체, 후방주의 포함"으로 한 줄 언급한 부분인데, 실제 규모를 재보니 별도 항목으로 다룰 값어치가 있습니다.

**(1) 원문 전편이 정적 자산으로 배포됨** — `src/data/문학 정리/` 하위 **229개 `.md`, 2.8 MB**

```
src/data/문학 정리/대회/일문대/[105671] 일문대) 카구야가 임신해서 이로하를 임신시킴.txt.md
src/data/문학 정리/대회/카문대/[47883] 카문대) 19)로카마미 소설은 왜 없음.md
```

파일명 자체가 제목이라 내용 성격이 그대로 드러납니다. `src/.assetsignore`에는 `wrangler.toml`과 `_worker.js`만 있어서 이 폴더 전체가 배포에 포함됩니다. 사이트 UI에는 링크가 없지만 **연령 확인도, 경고도, 인증도 없이 URL만 알면 열립니다.**

**(2) 작성자 핸들이 통째로 노출됨** `[실측]`

| 파일 | 크기 | 클라이언트 사용 | 내용 |
|---|---|---|---|
| `src/scripts/crawl_entries.json` | **682 KB** | ❌ 없음 | 전 게시물 + `"author": "양아양양(always8495)"` 형태 핸들 + 원본 파일명 |
| `src/data/MoonHakdata.json` | **543 KB** | ❌ 없음 (빌드 전용) | 전 게시물 + 작성자 핸들 |
| `src/scripts/series_entries.json` | **132 KB** | ❌ 없음 | 크롤링 중간 산출물 |
| `src/data/PageData/Novel.json` | 613 KB | ✅ 사용 | 작성자 핸들 포함 (UI에는 표시 안 됨) |

앞의 3개는 **클라이언트 코드 어디서도 참조하지 않습니다**(`src/js/`, `src/page/` 전수 grep 확인). 순수하게 배포에만 얹혀 있는 1.36 MB짜리 개인정보 덩어리입니다.

**(3) 그리고 GitHub 저장소가 PUBLIC입니다** `[실측]`

```
github.com/irokaguyachi/CPKG  →  visibility: PUBLIC
```

즉 `robots.txt`의 `Disallow: /`나 사이트 접근 차단과 **무관하게**, 위 내용 전부가 GitHub에서 검색·클론·아카이빙 가능합니다. GitHub는 검색엔진에 정상 색인되고, 코드 학습용 크롤러의 1순위 대상입니다.

**권장 조치** (우선순위 순)
1. **저장소를 Private으로 전환**하는 것을 먼저 검토하세요. Cloudflare의 GitHub 연동 배포는 Private 저장소에서도 동일하게 동작합니다. 이 한 번의 설정으로 (3)이 통째로 사라집니다.
2. `src/.assetsignore`를 확장해 `data/문학 정리/`, `data/MoonHakdata.json`, `scripts/`를 배포에서 제외하세요(1차 T3의 조치와 동일 — 이 항목까지 같이 해결됩니다).
3. 원문을 사이트에서 열람 가능하게 할 계획이 아니라면 `src/data/문학 정리/`와 `src/scripts/*_entries.json`을 아예 저장소 밖(로컬 또는 별도 Private 저장소)으로 옮기는 게 가장 확실합니다. 지금은 어차피 빌드 입력물이지 배포물이 아닙니다.
4. 작성자 핸들이 사이트 UI에 표시되지 않는다면, `7_build_novel_page_data.py`가 `Novel.json`을 만들 때 `author` 필드를 아예 빼는 것도 검토할 만합니다. 표시하지 않는 개인정보를 전 방문자에게 내려보낼 이유는 없습니다.

> ✅ **[2026-08-26 재확인] 1·2번 완료, 3·4번은 아직.** ① 저장소 visibility를 `gh repo view`로 직접 조회 — **`PRIVATE`로 전환되어 있습니다**(`github.com/irokaguyachi/CPKG`). ② `src/.assetsignore`에 `scripts/`, `data/문학 정리/`, `data/MoonHakdata.json`, `data/*.md`가 전부 추가돼 있어 `crawl_entries.json`/`series_entries.json`도 `scripts/` 프리픽스로 같이 빠집니다 — 이제 배포물에는 안 실립니다(단, 저장소 자체 히스토리에는 그대로 남아있고 이제 Private이라 그건 괜찮습니다). 저장소가 Private으로 바뀌면서 애초에 3번(저장소 밖으로 이전)의 긴급성은 낮아졌습니다. ④(author 필드 제거)는 아직 코드 변경 없음 — `Novel.json`에 `author` 필드가 여전히 포함됩니다(UI 미표시는 그대로).

---

## ✅ N-S8. 배포 도메인에 A/AAAA 레코드가 없다 — ~~사이트가 지금 안 열린다~~ **해결됨: 새 도메인 `ckpg.cloud` 연결 완료** `[실측 · 2026-08-26 해결]`

```
cpkg.by-works.net   A     → (없음)
cpkg.by-works.net   AAAA  → (없음)
cpkg.by-works.net   MX    → kr1-aspmx1.worksmobile.com (10), kr1-aspmx2.worksmobile.com (20)
by-works.net        NS    → ns1-1.ns-ncloud.com, ns1-2.ns-ncloud.com
```

이름 자체는 DNS에 존재하지만(NOERROR) **주소 레코드가 하나도 없습니다.** MX는 살아 있어서 `cpkg@cpkg.by-works.net` 메일은 정상이지만, 웹은 접속 불가입니다. 실제로 `https://cpkg.by-works.net/`에 연결이 되지 않습니다.

권한 네임서버가 **Naver Cloud(`ns-ncloud.com`)**라는 점이 원인 후보입니다 `[추정]`. Cloudflare Workers의 커스텀 도메인 바인딩은 해당 존이 Cloudflare에서 관리될 때 동작합니다. 지금 구조라면 존을 Cloudflare로 옮기거나, Cloudflare for SaaS(커스텀 호스트네임)로 붙이거나, `workers.dev` 서브도메인을 활성화해야 합니다.

**왜 중요한가**: 이 문서와 1차 문서에서 지적한 트래픽 최적화가 전부 "배포본이 살아 있을 때"의 이야기입니다. 지금은 그 앞 단계가 막혀 있습니다. 그리고 6개 페이지 푸터(`src/page/*.html:63/76/83`)가 이 도메인 메일을 문의처로 안내하고 있어, 사용자가 사이트에 못 들어오면 문의 경로도 같이 닫힙니다.

> ⚠️ **[2026-08-26 정정] 푸터 문의 메일은 애초에 이 도메인과 무관했습니다.** 6개 페이지(`bookmarksPage.html`, `HOFPage.html`, `mainPage.html`, `novelPage.html`, `OfficialPage.html`, `seriesPage.html`) 푸터를 직접 grep해보니 `문의 : iroyachikagu168@gmail.com`으로, `by-works.net` 도메인 메일이 아니라 일반 Gmail 주소입니다. 저장소 전체(`src/`)에 `by-works.net` 문자열 자체가 없습니다 — 이 문단의 "문의 경로도 같이 닫힌다"는 원래도 사실이 아니었던 것으로 보입니다. 어느 쪽이든 지금은 N-S8이 해결돼서 무의미해진 우려입니다.

**권장 조치**: Cloudflare 대시보드에서 `cpkg` Worker의 라우트/커스텀 도메인 설정 상태부터 확인하세요. 임시로는 `*.workers.dev` 서브도메인을 켜두면 즉시 접근 가능해집니다.

> ⚠️ **[2026-08-26 재확인 → 정정] "사이트가 안 열린다"는 틀렸습니다. `https://cpkg.cpkg.workers.dev/`로 실제로 열립니다.** 커스텀 도메인(`cpkg.by-works.net`)에 A/AAAA 레코드가 없다는 사실 자체는 지금도 맞습니다 — Google DoH로 다시 조회해도 `Answer` 없이 `by-works.net`의 SOA만 도는 `Authority` 응답뿐이고, `curl https://cpkg.by-works.net/`은 여전히 `Could not resolve host`로 실패합니다. **하지만 처음에 이 재확인에서 `cpkg.nwb10102.workers.dev`를 찔러보고 NXDOMAIN이 나오자 "workers.dev도 안 열려 있다"고 잘못 결론 내렸습니다** — 계정의 실제 workers.dev 서브도메인은 `nwb10102`가 아니라 **`cpkg`**였습니다(사용자가 직접 `https://cpkg.cpkg.workers.dev/page/mainPage.html`로 확인해줌). 이 URL로 `curl`을 다시 보내니 `200 OK`, `/library` API도 실제 데이터(공개 라이브러리 2건)를 정상 반환합니다. 덕분에 **N-T1의 실배포 캐시 헤더도 직접 검증**했습니다 — `/js/*`·`/css/*`는 `max-age=0, must-revalidate`, `/data/*`는 `max-age=300`, `/fonts/*`는 `max-age=31536000, immutable`, 보안 헤더 4종 전부 응답에 실제로 붙어 있어 `src/_headers` 코드 분석과 라이브 결과가 정확히 일치합니다. 즉 **실제 위험은 "사이트 다운"이 아니라 "정식 도메인/문의 메일 경로가 막혀 있고, 지금 켜져 있는 접속 경로가 사람이 외우기 힘든 workers.dev 임시 주소뿐"**입니다 — 심각도를 🟠에서 🟡로 낮춥니다. 원래 권장 조치(커스텀 도메인 설정 확인)는 여전히 유효합니다.

> ✅ **[2026-08-26 완전 해결]** `cpkg.by-works.net`(Naver Cloud 관리, MX 때문에 건드리기 부담스러웠던 도메인)은 포기하고, **새 도메인 `ckpg.cloud`를 구매해 Cloudflare 존으로 추가 → 가비아 네임서버를 Cloudflare 네임서버로 교체 → Workers 대시보드에서 `cpkg` Worker에 Custom Domain으로 `ckpg.cloud` 연결**하는 방식으로 해결했습니다. 실측 확인: Google DoH로 `ckpg.cloud` A 레코드 조회 시 `104.21.96.20`, `172.67.150.68`(Cloudflare Anycast IP) 정상 응답, `curl https://ckpg.cloud/`와 `https://ckpg.cloud/page/mainPage.html` 둘 다 `200 OK`. **이제 `ckpg.cloud`가 이 사이트의 정식 프로덕션 도메인입니다** — 이 문서와 1차 문서에서 "배포 도메인"을 언급하는 다른 항목들도 이 주소를 기준으로 읽으면 됩니다. `cpkg.by-works.net`은 더 이상 이 프로젝트와 무관하며, 그 도메인의 이메일(MX)은 이 변경과 별개로 그대로 살아 있습니다(네임서버를 옮긴 게 아니라 아예 다른 도메인으로 갈아탔으므로).

---

## 🟡 N-S5. `claimToken`의 "아무것도 안 바꾸는 PUT"이 실제로는 `updatedAt`을 바꾼다 `[코드확인]`

`src/js/bookmarkLibrary.js:287-301`
```js
// There's no dedicated verify route, so this does a no-op PUT: the Worker checks the
// token hash before touching anything, so a wrong token 403s and a right one
// succeeds without changing name or items.
```

주석대로 `name`/`items`는 안 바뀝니다. 그런데 `worker/favoritesShareWorker.js:519-531`은

```js
if (clean.name !== undefined) record.name = clean.name;
if (clean.items !== undefined) record.items = clean.items;
record.updatedAt = Date.now();              // ← 무조건 갱신
await env.FAVORITES_BUCKET.put(...)          // ← Class A 쓰기 1회
```

**소유권 "확인"만 했는데 레코드가 최신 수정 시각으로 갱신되고 R2 쓰기가 한 번 발생합니다.** 라이브러리 목록의 `최근 수정순` 정렬(`:468`)이 이 값을 쓰므로, 확인만 해도 그 항목이 목록 맨 위로 올라옵니다.

같은 파일의 `handleLibraryClaimOwner`(`:605-607`)는 정확히 이 문제를 인지하고 주석까지 달아 `updatedAt`을 일부러 안 건드립니다. 두 경로의 처리가 어긋나 있는 상태입니다.

**지금은 실害가 없습니다** — N-S4대로 `claimToken`을 부르는 코드가 없기 때문입니다. 되살릴 때를 대비한 기록입니다.

**권장 조치**: 인증 전용 라우트(`POST /library/<code>/verify`)를 따로 두거나, `handleLibraryUpdate`에서 `clean.name`/`clean.items`가 둘 다 `undefined`면 R2 쓰기 없이 `libraryPublicView`만 돌려주도록 하세요.

> ❌ **[2026-08-26 재확인] 그대로.** `handleLibraryUpdate`(:598-635)는 지금도 `clean.name`/`clean.items`가 둘 다 없어도 `record.updatedAt = Date.now()`를 무조건 실행하고 R2 `put`을 한 번 합니다. 다만 실질 영향은 이전과 같이 없습니다 — N-S4대로 `claimToken`이 여전히 죽은 코드라 아무도 이 경로를 타지 않습니다.

## 🟡 N-S9. `pushNow()`의 409 재시도에 횟수 제한이 없다 `[코드확인]`

`src/js/userData.js:312-339`

```js
if (res.status === 409) {
  return res.json().then(function (data) {
    if (!data.serverStore) return;
    applyRemote(data.serverStore);
    pendingPush = true;            // ← 무조건 재시도 예약
  });
}
...
}).then(function () {
  inFlight = false;
  if (pendingPush) { pendingPush = false; return pushNow(); }   // ← 상한 없는 재귀
});
```

서버가 계속 409를 돌려주는 상황(다른 기기가 동시에 쓰는 중, `syncVersion` 불일치가 안 풀리는 경우)에서 **재시도 횟수 상한도, 백오프도 없이 무한 재귀**합니다. 매 회차가 스토어 전체 스냅샷(최대 ~1 MB) PUT이고, `requestSync`의 120초 쿨타임은 이 내부 재시도에 적용되지 않습니다(`:439-464`는 진입점에만 걸림).

서버 쪽 `handleUserSync`는 `USER_SYNC_MAX_ATTEMPTS = 3`으로 자기 루프를 제한하는데(`:137`, `:927`), 클라이언트에는 대응하는 상한이 없습니다.

**권장 조치**: `pushNow`에 시도 카운터(3회)와 지수 백오프를 넣고, 넘으면 `status = 'error'`로 끝내세요.

> ❌ **[2026-08-26 재확인] 그대로.** `src/js/userData.js:335-338`은 지금도 `if (pendingPush) { pendingPush = false; return pushNow(); }`로 상한·백오프 없이 재귀합니다.

## 🟡 N-S10. owner 인덱스 갱신에 CAS가 없다 `[코드확인]`

`worker/favoritesShareWorker.js:207-228`(`addToOwnerIndex`), `:562-577`(delete 시 정리), `:661-670`(lookup GC) 세 곳 모두 `get` → 수정 → `put` 패턴인데 `onlyIf`/etag 검사가 없습니다. `handleUserSync`(`:945-948`)와 `handleUserSignup`(`:818-821`)이 `etagMatches`/`etagDoesNotMatch`로 제대로 CAS를 쓰는 것과 대조적입니다.

같은 개인 코드로 두 기기에서 동시에 공개하면 한쪽 code가 인덱스에서 조용히 사라집니다. `:75-78` 주석대로 인덱스는 권한의 근거가 아니라 조회 편의용이므로 데이터가 소실되진 않지만, "되찾기 목록에 안 뜨는" 증상이 재현될 수 있습니다. N-S4대로 조회 경로가 이미 죽어 있어 현재 영향은 거의 없습니다.

> ❌ **[2026-08-26 재확인] 그대로, 다만 노출 규모는 줄었습니다.** `addToOwnerIndex`(:242-266)는 여전히 `get`→수정→`put`이고 `onlyIf`/etag가 없습니다. 다만 N-S1 해결로 `OWNER_MAX_PUBLISHED = 5`가 되면서 인덱스 배열 자체가 최대 5칸으로 작아져, 경합이 나도 잃어버릴 수 있는 항목 수가 원래(최대 500)보다 훨씬 작아졌습니다.

## 🟡 N-S11. 코드 할당 실패 시 500 / 개인 코드는 철회·교체 수단이 없다 `[코드확인]`

- `worker/favoritesShareWorker.js:370-375`: 8자 코드를 3번 뽑아 전부 충돌하면 500을 냅니다. 48비트라 현실적으로 안 일어나지만, 재시도 횟수를 10으로 올리는 데 드는 비용이 사실상 0입니다.
- **개인 코드는 이 시스템의 유일한 자격증명**이고 `localStorage`(`chokaguya_personal_code`)에만 있습니다. 로테이션·폐기·재발급 경로가 없습니다. 코드가 새면(스크린샷 공유, 공용 PC, 확장 프로그램) **그 계정은 영구히 열립니다.** 지금은 XSS가 없어서(아래 확인 목록 참조) 실현 경로가 좁지만, 설계상 단일 실패점이라는 점은 기록해 둡니다.
  → 조치: `PUT /user/rotate`(옛 코드로 인증 → 새 코드로 오브젝트 이전 → 옛 키 삭제)를 두면 사고 대응이 가능해집니다.

> ❌ **[2026-08-26 재확인] 그대로.** 코드 할당 재시도는 여전히 3회(`handleLibraryCreate:471`)이고, `/user/rotate` 같은 라우트는 `route()`에 없습니다.

## 🟡 N-S12. `cleanUserData`가 페이로드를 팽창시켜 1 MB 검사가 저장 크기를 못 묶는다 `[코드확인]`

`worker/favoritesShareWorker.js:688-766`은 입력을 그대로 저장하지 않고 **아는 필드만 재조립**하는데, 이 과정에서 없던 필드가 추가됩니다.

```
입력  {"type":"novel","id":1}                       (23 B)
저장  {"type":"novel","id":1,"addedAt":0}           (35 B)   ← :696-700
```

북마크 단위로도 `createdAt`/`updatedAt`/`publishedCode`/`publishedCodeUpdatedAt`이 붙습니다(`:747-759`). 따라서 `USER_MAX_BODY_BYTES = 1048576` 검사를 통과한 본문이 **1.5~2배로 부풀어 R2에 기록**될 수 있습니다. 1차 S6이 지적한 "UTF-16 길이 vs UTF-8 바이트" 문제와 방향이 반대인, 두 번째 팽창 경로입니다.

**권장 조치**: 본문 크기가 아니라 **`JSON.stringify(next)`의 최종 크기**를 `put` 직전에 확인해 상한을 넘으면 413으로 거절하세요.

> ❌ **[2026-08-26 재확인] 그대로.** `cleanUserItems`(:798-813)와 `cleanUserData`(:837-876)는 지금도 `addedAt`/`createdAt`/`updatedAt`/`publishedCode`/`publishedCodeUpdatedAt`을 무조건 채워 넣고, `handleUserSync`(:1035-1081)의 `put` 직전에 최종 크기 검사가 없습니다.

---

# 📈 트래픽 · 대역폭 (신규)

## 🔴 N-T1. 정적 자산이 매번 재검증된다 — 페이지 이동당 33~36건 왕복 `[문서확인]`

Cloudflare Workers Static Assets 문서를 확인했습니다.

> 모든 정적 자산에 동일하게 적용되는 기본 헤더: **`Cache-Control: public, max-age=0, must-revalidate`**
> (HTML과 `.js`/`.css`/`.json`을 구분하지 않습니다. ETag는 자동으로 붙습니다.)

`src/`에 **`_headers` 파일이 없습니다**(확인함). 즉 이 기본값이 그대로 적용됩니다.

`max-age=0, must-revalidate`는 "캐시에 넣어도 되지만 **쓸 때마다 서버에 물어보라**"는 뜻입니다. 본문은 304로 안 오지만 **왕복은 매번 발생합니다.**

페이지당 요청 수를 실제로 세어봤습니다 `[실측]`.

| 페이지 | 요청 수 | JS | CSS | JSON | 폰트 | 콜드 캐시 총 전송량 |
|---|---|---|---|---|---|---|
| `mainPage.html` | **36건** | 15개 (132 KB → 45 KB gz) | 14개 (78 KB → 22 KB gz) | 4개 (792 KB → **81 KB gz**) | 1.96 MB | **~2.11 MB** |
| `novelPage.html` | **33건** | 14개 (138 KB → 48 KB gz) | 13개 (74 KB → 20 KB gz) | 3개 (618 KB → **66 KB gz**) | 1.96 MB | **~2.10 MB** |

**따뜻한 캐시에서도 이 33~36건이 전부 조건부 요청으로 다시 나갑니다.** 이 사이트는 SPA가 아니라 링크마다 전체 새로고침이므로, 탭을 옮길 때마다 반복됩니다.

**권장 조치**: `src/_headers` 파일 하나로 해결됩니다. **1차 S8(보안 헤더 전무)도 같은 파일에서 같이 처리됩니다.**

```
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: geolocation=(), camera=(), microphone=()

/js/*
  Cache-Control: public, max-age=604800

/css/*
  Cache-Control: public, max-age=604800

/fonts/*
  Cache-Control: public, max-age=31536000, immutable

/data/*
  Cache-Control: public, max-age=3600
```

> ⚠️ **`/data/*`에 긴 캐시를 걸기 전에 반드시 N-T5(`DATA_VERSION` 고정)를 먼저 고치세요.** 지금 상태에서 캐시를 켜면 데이터 갱신이 사용자에게 안 보이게 됩니다.
>
> ⚠️ `.assetsignore`는 `.gitignore` 문법을 씁니다 `[문서확인]`. `_headers`를 추가할 때 실수로 무시 목록에 걸리지 않게 확인하세요.

> ⚠️ **[2026-08-26 재확인, 실배포로 직접 검증] 부분 해결 — 그리고 새로운 사건이 하나 있었습니다.** `src/_headers`가 실제로 생겼고, `https://cpkg.cpkg.workers.dev/`(실제 배포본)에 직접 요청해 응답 헤더로 확인했습니다: `/fonts/*`는 `max-age=31536000, immutable`, `/data/*`는 `max-age=300`, 보안 헤더 4종 전부 실제 응답에 붙어 있어 코드와 라이브 동작이 일치합니다. 그런데 **`/js/*`, `/css/*`는 여전히 `max-age=0, must-revalidate`(기본값)** — 604800초(7일) 캐시 규칙이 빠져 있는 것도 실측으로 확인됩니다. `_headers` 파일의 주석에 이유가 적혀 있습니다: `.js`/`.css`에는 `DATA_VERSION` 같은 캐시버스터가 없어서, 배포한 새 코드가 재방문자 브라우저에 최대 7일간 안 닿는 문제가 실제로 있었고(2026-08-26, `bookmarksPage.js` 수정이 이걸로 퍼지지 않은 사례) — 커밋 `5a66fbb fix(cache): js/css 7일 캐시 제거 - 배포 반영 지연 문제 해결`로 되돌렸습니다. 즉 **JS/CSS 29건(15개+14개)의 재검증 왕복은 여전히 매 페이지 이동마다 발생**합니다 — 캐시버스터 없이 장기 캐시를 걸었다가 사고가 나서 롤백한 것이므로, 다시 켜려면 파일명에 콘텐츠 해시를 붙이는 등 버스팅 메커니즘부터 갖춰야 합니다.

## 🔴 N-T2. 상세 모달이 원본을 받는다 — 평균 755 KB, **최대 17.09 MB** `[실측]`

1차 T9가 "확인 못 했다"고 남긴 부분을 R2에서 직접 측정했습니다.

`src/js/postDetailSeries.js:93-96`
```js
if (data.imageUrl) {
  var finalImg = window.resolveAssetUrl ? window.resolveAssetUrl(data.imageUrl) : data.imageUrl;
  image.style.backgroundImage = 'url("' + finalImg + '")';
}
```

`resolveThumbUrl`이 아니라 `resolveAssetUrl` — 즉 **원본**입니다.

**실측 결과 (649개 이미지 경로 전수 HEAD)**

| | 개수 | 총 크기 | 평균 | 최대 |
|---|---|---|---|---|
| 원본 | 638 | **470.3 MB** | **755 KB** | **17.09 MB** |
| 썸네일 (600px webp) | 632 | 17.5 MB | **28 KB** | — |

**카드 클릭 한 번의 비용이 평균 27배, 최악의 경우 600배입니다.** 상위 10개는 이렇습니다.

```
17.09 MB   (썸네일 38 KB)
14.48 MB   (썸네일 37 KB)
12.56 MB   (썸네일 57 KB)  ← 이 GIF 하나가 서로 다른 8개 항목에 걸려 있음
10.78 MB   (썸네일 없음)
```

그런데 이 이미지는 `.pds-image`의 CSS 배경으로 들어가고, 카드는 `--pds-scale: 0.62`로 축소돼 표시됩니다(`postDetailSeries.js:14`). **17 MB GIF를 수백 px 폭으로 그리려고 받는 셈입니다.** 모바일 데이터 사용자에게는 카드 하나 눌렀다가 17 MB가 나가는 상황입니다.

> R2 이그레스는 무료라 **Cloudflare 청구서에는 안 잡힙니다** `[문서확인]`. 비용을 내는 건 방문자의 데이터 요금과 대기 시간입니다.

**권장 조치**
1. `6_build_thumbnails.py`에 **중간 프리셋(예: 1200px webp, `assets/Image/detail/`)**을 추가하고, `postDetailSeries.js:94`가 그걸 쓰게 하세요. 평균 755 KB → 100 KB 수준으로 떨어집니다.
2. 최소한 **GIF만이라도** 별도 처리하세요. GIF 21개가 원본 총량의 150 MB(32%)를 차지합니다. 정지 이미지로 충분하다면 첫 프레임 webp로, 애니메이션이 필요하면 webp/mp4 변환이 극적으로 작습니다.
3. 즉시 적용 가능한 완충책: 상세 모달을 열 때 **먼저 썸네일을 배경으로 깔고**, 원본은 뒤에서 받아 도착하면 교체하세요(`cdnConfig.js:66-83`의 `revealBackground`와 같은 패턴). 체감이 즉시 좋아집니다.

> ⚠️ **[2026-08-26 재확인] 3번(체감 완충)만 적용됨.** `cdnConfig.js`에 `revealBackgroundProgressive()`가 새로 생겼고, `postDetailSeries.js:74-81`이 `resolveAssetUrl` 대신 이걸 씁니다 — 썸네일을 먼저 배경으로 깔고 원본이 도착하면 교체하는, 정확히 권장 조치 3번 패턴입니다(커밋 `c10006e perf(modal): 상세 모달 이미지 점진적 로딩(썸네일 우선) 적용`). 다만 **1번(중간 프리셋)과 2번(GIF 별도 처리)은 아직입니다** — `6_build_thumbnails.py`에 1200px급 프리셋이 없고, 최종적으로 화면에 남는 이미지는 여전히 원본(평균 755KB~최대 17MB)입니다. 체감 대기시간은 줄었지만 실제 전송량은 그대로입니다.

## 🟠 N-T3. 썸네일 없는 카드 17건, 그중 11건은 **완전히 깨져 있다** `[실측]`

`src/js/cdnConfig.js:66-83`의 `revealBackground`는 썸네일을 `new Image()`로 먼저 찔러보고 실패하면 원본으로 넘어갑니다.

```js
var probe = new Image();
probe.onload  = function () { target.style.backgroundImage = 'url("' + thumb + '")'; };
probe.onerror = function () { target.style.backgroundImage = 'url("' + full + '")'; };
probe.src = thumb;
```

**썸네일 커버리지 실측: 632/649 (97.4%)** — 설계는 잘 동작합니다. 다만 나머지 17건이 문제입니다.

**(a) 썸네일만 없는 6건** → 카드가 원본을 그대로 로드합니다.

```
2.12 MB   [Series] 66956_4.jpg
1.40 MB   [Novel]  (로그인관련.png)
0.91 MB   [Official] (코믹스.webp)
0.84 MB   [Official] (가이드북.webp)
0.80 MB   [Official] (소설.png)
0.11 MB   [Official] (초카구야.jpg)
```

**공식 페이지는 4개 항목 전부가 여기 해당**해서, 그 페이지의 카드 4장이 전부 원본을 받습니다. `6_build_thumbnails.py`를 다시 돌리면 됩니다.

**(b) 원본조차 R2에 없는 11건** → 썸네일 404 + 원본 404 = **요청 2건 낭비 + 이미지 없음**

```
282314_1.jpg  282967_1.jpg  286087_1.jpg  286887_1.jpg  288040_1.jpg
288394_1.jpg  288487_1.jpg  289813_1.jpg  290101_1.jpg  291315_1.jpg  293575_1.jpg
```

전부 최근(28xxxx~29xxxx)이라 **`sync_to_r2.py`가 마지막으로 안 돌았거나 일부 실패한 것으로 보입니다** `[추정]`. 즉 최신 문학 11편의 카드 이미지가 지금 깨져 있습니다 — 메인 페이지 "최신 등록 문학" 10장에 직접 걸리는 범위입니다.

**권장 조치**
1. `python src/scripts/sync_to_r2.py` 실행 → (b) 해결.
2. `python src/scripts/6_build_thumbnails.py` 재실행 → (a) 해결.
3. 빌드 파이프라인 끝에 **"PageData의 모든 `image` 경로가 R2에 실제로 있는지" 검증 단계**를 추가하세요. 이 문서의 실측이 바로 그 검사입니다 — 스크립트 20줄이면 CI에서 돌릴 수 있습니다.

> ❌ **[2026-08-26 재확인] 둘 다 그대로 — R2에 직접 다시 HEAD 요청을 보내 확인함.** (b) 깨진 11건 전부(`282314_1.jpg` ~ `293575_1.jpg`) 원본·썸네일 모두 지금도 404입니다. (a) 원본은 있고 썸네일만 없던 항목 중 확인 가능했던 5건(`66956_4.jpg`, 공식 페이지의 `소설.png`/`가이드북.webp`/`코믹스.webp`/`초카밥.jpg` — 마지막 파일은 이름이 `초카구야.jpg`에서 바뀐 것으로 보임)도 원본은 그대로 살아있지만 썸네일은 여전히 404입니다. 즉 `sync_to_r2.py`와 `6_build_thumbnails.py`가 이 항목들에 대해 재실행되지 않았습니다 — CLAUDE.md 규칙상 R2 업로드/이미지 재빌드는 사용자가 직접 실행해야 하는 작업이라 이번 재점검에서도 실행하지 않았습니다.

## 🟠 N-T4. 참조 원본의 23%(110 MB)가 바이트 단위 중복이다 `[실측]`

638개 원본의 ETag를 비교했습니다.

```
고유 ETag        553개
중복 그룹         43개
중복으로 낭비된 저장량   110.1 MB (전체의 23%)
```

가장 큰 것들:

| 크기 | 사본 수 | 낭비 |
|---|---|---|
| 12.56 MB | **8벌** | 87.9 MB |
| 2.12 MB | 4벌 | 6.4 MB |
| 0.08 MB | **15벌** | 1.1 MB |

**왜 중요한가**: R2 저장은 10 GB까지 무료라 **지금 당장 돈이 나가지는 않습니다** `[문서확인]`. 실질 비용은 두 가지입니다.
- `sync_to_r2.py`가 매번 같은 파일을 여러 키로 업로드/검사합니다(`:106`의 델타 동기화는 키+크기 기준이라 중복을 못 잡습니다).
- 같은 그림이 8개 항목에 서로 다른 키로 걸려 있어, 브라우저 캐시가 재사용되지 않습니다 — **8번 다운로드됩니다.** N-T2와 곱해지면 12.56 MB × 8 입니다.

**권장 조치**: `sync_to_r2.py`에 콘텐츠 해시 기반 중복 제거를 넣거나(같은 해시면 기존 키를 재사용), 빌드 단계에서 동일 이미지를 하나의 정식 경로로 모으고 PageData가 그 경로를 가리키게 하세요.
> 🚨 이때 **CLAUDE.md 최우선 규칙**을 반드시 지키세요 — 사용자가 수동으로 매핑해 둔 `image` 경로(로고, 시리즈 대표 이미지 등)는 자동 정리 대상에서 제외해야 합니다.

> ❌ **[2026-08-26 재확인] 코드 변경 없음.** `src/scripts/sync_to_r2.py`에 해시/dedup 관련 코드가 없습니다(`hash`/`sha256`/`md5`/`중복` 어떤 키워드로도 안 걸림) — 여전히 키+크기 기준 델타 동기화뿐입니다. 638개 원본 전수를 다시 HEAD로 훑어 23%를 재계산하는 건 이번 재점검 범위에서 비용 대비 실익이 낮다고 판단해 실측은 생략했지만, 구조가 그대로이므로 결론(23% 중복)도 그대로일 가능성이 높습니다.

## 🟠 N-T5. `DATA_VERSION`이 4일째 고정 — 캐시 버스팅이 죽어 있다 `[코드확인]`

`src/js/cdnConfig.js:9-17`
```js
// Cache normally instead and bust it explicitly by bumping this
// when the data under src/data/ changes.
var DATA_VERSION = '20260820';
```

git 기록을 확인했습니다.

```
DATA_VERSION 마지막 변경:  9d05215  2026-08-20
그 이후 src/data/PageData 를 바꾼 커밋:
  c6bd10a  2026-08-23  부기1숨김
  0cc0aba  2026-08-23  북마크 레이아웃 변경 및 UI 변경
  57e7dd1  2026-08-23  index.html 생성
  99e6c9f  2026-08-22  부기2 숨김
  2d680f4  2026-08-21  즐겨찾기를 이름 있는 다중 북마크 시스템으로 전환
(작업 트리의 Novel.json/Series.json 은 2026-08-24 수정)
```

**데이터가 최소 4번 바뀌는 동안 버전 토큰은 한 번도 안 올라갔습니다.** 이 메커니즘은 사실상 작동을 멈춘 상태입니다.

**지금은 우연히 무해합니다** — N-T1대로 기본 캐시가 `max-age=0`이라 ETag 재검증이 변경을 잡아주기 때문입니다. 문제는 순서입니다: **N-T1을 고쳐 `/data/*`에 실제 `max-age`를 주는 순간, 재방문자는 며칠 지난 데이터에 갇힙니다.**

**권장 조치**
1. 사람이 손으로 올리는 상수를 없애세요. 빌드 스크립트(`3_build_data.py` 등)가 마지막에 `cdnConfig.js`의 `DATA_VERSION`을 오늘 날짜 또는 파일 해시로 자동 갱신하게 하면 됩니다.
2. 더 나은 방법: 버전 쿼리를 아예 버리고 **ETag 재검증에만 의존**하되, `/data/*`에는 짧은 `max-age`(예: 300~3600초)만 주세요. 지금 구조에서는 이쪽이 더 안전합니다.

> ⚠️ **[2026-08-26 재확인] 2번 채택, 1번은 미완.** `DATA_VERSION`은 여전히 `cdnConfig.js`의 손으로 올리는 상수이고(`3_build_data.py`류 빌드 스크립트에서 자동 갱신하는 코드는 없음 — `8_build_recent_page_data.py`는 "DATA_VERSION을 올리세요"라는 안내 문구만 출력합니다), 값 자체는 오늘 날짜(`20260826`)로 수동 갱신되어 있습니다. 대신 정확히 권장 조치 2번대로 **`src/_headers`가 `/data/*`에 `max-age=300`(5분)의 짧은 캐시만 줍니다** — `_headers` 파일 주석에 "이 상수가 최근 여러 번 안 올라간 이력이 있어서 5분은 그래도 안전한 값"이라고 이유까지 적혀 있습니다. 즉 근본 원인(수동 상수)은 안 고쳐졌지만, 문서가 제안한 안전장치가 정확히 그 이유로 적용되어 실질 위험은 크게 줄었습니다.

## 🟡 N-T6. 북마크 상세를 열면 카탈로그 4개(792 KB)를 전부 받는다 `[코드확인]`

`src/js/bookmarksPage.js:16-21`, `:50-68`
```js
var SECTIONS = [
  { type: 'novel',    dataUrl: '../data/PageData/Novel.json'    },   // 613 KB
  { type: 'series',   dataUrl: '../data/PageData/Series.json'   },   // 174 KB
  { type: 'hof',      dataUrl: '../data/PageData/HOF.json'      },   //  15 KB
  { type: 'official', dataUrl: '../data/PageData/Official.json' }    //   5 KB
];
```

`loadItemLookup()`은 목록 모드에서는 안 불리고, **상세 모드에서만** 호출됩니다(`:810` 라이브러리 상세, `:952` 내 북마크 상세 — 전수 확인). 그래도 북마크 하나에 항목이 3개뿐이어도 **1,416개 항목 전체를 받아 `{ id: 항목 }` 맵을 만듭니다.**

압축 후 약 81 KB이므로 대역폭 자체는 크지 않습니다. 실질 비용은 **파싱과 메모리**입니다 — 모바일에서 613 KB JSON 파싱은 메인 스레드를 눈에 띄게 잡습니다.

**권장 조치**: 1차 T1의 `Recent.json` 작업을 할 때, 같은 자리에서 **id → {name, image, tags, posts[0]} 만 담은 경량 조회 인덱스**(`Lookup.json`, 약 100~150 KB)를 하나 더 만들어 이 경로가 그걸 쓰게 하세요.

> ❌ **[2026-08-26 재확인] 그대로.** `bookmarksPage.js:16-21`의 `SECTIONS`는 지금도 `Novel.json`/`Series.json`/`HOF.json`/`Official.json` 4개 전체를 `loadItemLookup()`(:71-83)으로 로드합니다. `Lookup.json` 같은 경량 인덱스는 아직 없습니다.

## 🟡 N-T7. 메인 페이지가 죽은 스크립트 2개를 로드한다 `[코드확인]`

`src/page/mainPage.html:89-90`
```html
<script src="../js/postCard.js"></script>      <!-- 3,688 B -->
<script src="../js/recentSection.js"></script> <!-- 1,266 B -->
```

두 파일은 각각 `global.PostCard`, `global.RecentSection`을 정의하지만 **전 코드베이스에서 아무도 참조하지 않습니다**(전수 grep 확인). `mainPage.js`는 `createCard`(`:82`)와 `createRecentSection`(`:155`)을 자체 구현해서 씁니다.

**비용**: 메인 페이지 방문마다 렌더 블로킹 요청 2건 + 4,954 B. N-T1과 곱해지면 재방문에서도 매번 재검증 2건입니다.

**권장 조치**: `<script>` 두 줄을 지우고, 파일도 삭제하세요.

> ✅ **[2026-08-26 재확인] 완전 해결됨.** `src/js/postCard.js`, `src/js/recentSection.js` 파일 자체가 삭제됐고, `mainPage.html`에서도 참조가 사라졌습니다. 덤으로 `mainPage.html`의 나머지 `<script>` 태그들도 전부 `defer`가 붙어 렌더 블로킹까지 같이 줄었습니다.

## 🟡 N-T8. 라이브러리 검색이 키 입력마다 버킷 전체 스캔을 유발한다 `[코드확인]`

`src/js/bookmarksPage.js:709-713`
```js
searchInput.addEventListener('input', function () {
  libQuery = searchInput.value.trim();
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(resetAndLoad, 250);     // 250ms 디바운스
});
```

디바운스가 250 ms라, 천천히 입력하는 사용자는 **글자마다 한 번씩** 서버 요청을 만듭니다. 요청 하나의 비용은:

```
KV get 1 + KV put 1          (checkRateLimit — worker:268-278)
+ R2 list() 1회 이상          (scanLibrary — worker:408-437, Class A)
```

즉 **"라이브러리"를 한 글자씩 치면 KV 쓰기 5회 + 버킷 전체 스캔 5회**입니다. 1차 S1(하루 KV 쓰기 1,000회)과 N-S3(키당 초당 1회)에 동시에 걸리는 가장 현실적인 경로입니다. 정렬 변경(`:714-717`)과 "더 보기"(`:746-750`)도 각각 전체 스캔을 새로 유발합니다.

**권장 조치**
1. 디바운스를 500~700 ms로 늘리고, 2글자 미만이면 요청 자체를 보내지 마세요.
2. **더 근본적으로는** 1차 T6의 권고(`caches.default`로 `GET /library` 30~60초 캐시)를 적용하세요. 검색어별로 캐시 키가 갈리긴 하지만, 같은 사람이 같은 글자를 다시 지웠다 쓰는 흔한 패턴이 전부 캐시에 맞습니다.

> ❌ **[2026-08-26 재확인] 그대로, 다만 안전망은 새로 생겼습니다.** `bookmarksPage.js:736`은 여전히 250ms 디바운스만 있고 최소 글자수 제한이 없습니다. 다만 N-S3에서 `GET /library`에 네이티브 `RL_LIB_LIST`(60초당 30회)가 새로 붙었으므로, 예전처럼 "레이트리밋 자체가 KV 초당-1회 제한에 걸려 무력화"되는 일은 없습니다 — 폭주해도 31번째 요청부터는 429로 깔끔하게 막힙니다.

## 🟡 N-T9. 배포에 고아 파일이 섞여 있다 `[코드확인]`

| 파일 | 크기 | 상태 |
|---|---|---|
| `src/page/pageCommon.css` | 96 B | 어떤 HTML도 참조 안 함 (`@import "../css/common.css"` 한 줄) |
| `src/page/mainPage.css` | 92 B | 〃 |
| `src/page/theme.css` | 89 B | 〃 |
| `src/page/loadingScreen.css` | 99 B | 〃 |
| `src/page/loadingScreen.html` | 1,240 B | 어떤 페이지에서도 링크 안 됨 |
| `src/css/loader.css` | 330 B | 위 `loadingScreen.html`만 씀 |
| `src/fonts/CCElephantmen Italic/*.ttf` | 90,868 B | CSS는 woff2/woff만 씀 (`base/fonts.css:11-12`) |
| `src/index.html` | 451 B | 루트 `index.html`과 중복 (경로만 다름) |

크기는 작지만 **`loadingScreen.html`은 실제로 열리는 페이지**라, 사이트 UI 밖에 노출된 별도 화면이 하나 존재합니다. 1차 T3의 `.assetsignore` 확장 작업에 같이 넣으세요.

> ✅ 참고: `CCElephantmen` 폰트는 **실제로 존재하고 사용됩니다**(`components/loader.css:64`, `components/series-card.css:170`). 404가 나지 않습니다 — 파일이 없을까 우려할 필요는 없었습니다.

> ✅ **[2026-08-26 재확인] 대부분 해결됨.** `src/page/pageCommon.css`, `mainPage.css`, `theme.css`, `loadingScreen.css`, `loadingScreen.html`, `src/css/loader.css` 전부 저장소에서 삭제됐습니다(커밋 `2b31afd refactor(cleanup): 고아 파일·죽은 CSS 셀렉터·도달 불가 코드 제거`로 보임). 다만 루트 `index.html`과 `src/index.html`의 중복은 **그대로 남아 있습니다**.

## 🟡 N-T10. 배포 71.5 MB — 1차 T3의 비용 판단을 정정합니다 `[실측 + 문서확인]`

git 추적 기준 실측: **367개 파일 / 71.5 MB**

| 경로 | 크기 | 파일 수 |
|---|---|---|
| `src/fonts` | **70,169,006 B (66.9 MB)** | 63 |
| `src/data` | 3,658,580 B | 238 |
| `src/scripts` | 863,791 B | 11 |
| `src/js` | 195,714 B | 21 |
| `src/css` | 79,101 B | 17 |
| `src/page` | 28,940 B | 11 |

1차 T3의 "68 MB짜리 폰트 디렉터리는 나쁜 봇에게 좋은 대역폭 표적"이라는 판단은 **비용 측면에서는 정정이 필요합니다.**

Cloudflare 문서 확인 결과:
- **정적 자산 요청은 Worker 호출로 과금되지 않습니다** — "Requests to static assets are free and unlimited."
- 정적 자산이 매칭되면 **Worker가 아예 실행되지 않습니다**(assets-first 라우팅, `run_worker_first` 기본값 `false`). `src/wrangler.toml`에 `run_worker_first` 설정이 없으므로 이 기본값이 적용됩니다.

즉 봇이 66.9 MB 폰트를 아무리 긁어도 **Cloudflare 청구서와 하루 10만 Worker 호출 한도에는 영향이 없습니다.** 무료 플랜의 Worker 호출 10만 건을 쓰는 것은 사실상 API 요청(`/library`, `/user/*`)과 `/`(루트, `_worker.js:37-41`), 그리고 존재하지 않는 경로에 대한 404 요청뿐입니다.

**그래도 `.assetsignore` 확장은 여전히 해야 합니다.** 이유가 바뀔 뿐입니다.
- ❌ ~~대역폭 비용~~ → 해당 없음
- ✅ **정보 노출** (N-S7: 원문 229편, 작성자 핸들 1.36 MB, 빌드 파이프라인 전체)
- ✅ **배포 시간** (매 배포마다 71.5 MB 업로드 검증)
- ✅ **잘못된 파일이 열릴 위험** (`loadingScreen.html`, `.py` 소스)

> ✅ **[2026-08-26 재확인] 세 이유 모두 해소됨.** "정보 노출"은 N-S7(저장소 Private 전환 + `.assetsignore` 확장)로, "잘못된 파일이 열릴 위험"은 N-T9(`loadingScreen.html` 삭제 + `.assetsignore`의 `scripts/` 제외)로 이미 같이 정리됐습니다. "배포 시간"만 근본적으로는 그대로지만(폰트 66.9MB는 여전히 배포에 포함), 애초에 이 항목의 핵심 논지("대역폭 비용은 해당 없다")는 바뀌지 않았습니다.

---

# 🔄 1차 문서에 대한 정정

| 1차 항목 | 1차 주장 | 이번 확인 결과 |
|---|---|---|
| **T1** | "메인 페이지가 **787 KB** JSON을 받는다" | ⚠️ **전송량 기준으로는 과대**입니다. `Novel.json` 613 KB → **gzip 65 KB / brotli 49 KB**, `Series.json` 174 KB → **gzip 15 KB / brotli 11 KB**. 실제 와이어 전송은 약 **81 KB**입니다 `[실측]`. 파싱·메모리 비용은 여전히 유효하니 `Recent.json` 도입은 옳지만, **절감 효과는 770 KB가 아니라 약 70 KB**입니다. 콜드 로드 2.11 MB 중 **93%는 폰트**입니다 — 1순위는 T1이 아니라 T2입니다. |
| **T3** | "68 MB 폰트는 봇의 대역폭 표적, 비용 위험" | ⚠️ **비용 판단 정정.** 정적 자산 요청은 무료·무제한이고 Worker를 호출하지도 않습니다 `[문서확인]`. 조치는 그대로 필요하지만 근거는 정보 노출·배포 시간입니다(→ N-T10). |
| **T4 (주석)** | "`seriesPage.html:33`의 `Logo_Series_Dark.png` 경로가 R2에 없으면 시리즈 로고가 깨져 있을 수 있다" | ✅ **깨지지 않았습니다.** R2에 실재합니다 — `assets/Image/Logo_Series_Dark.png` = 200, **19,258 B** `[실측]`. `assets/Image/Logo/Logo_Series_Dark.png`(19,944 B)도 별도로 존재합니다. |
| **T6 (각주)** | "R2 `list()`에 `include`를 주면 `limit` 상한이 1000에서 **100으로 낮아진다**고 알고 있다" | ⚠️ **부정확합니다.** 공식 문서상 최대는 그대로 1000이고, "`include`를 지정하면 메타데이터를 담느라 `limit`보다 **적게 올 수 있다**"입니다 `[문서확인]`. 고정 100이 아니라 가변입니다. 따라서 "4,000개에 40회 Class A"라는 최악 추정은 성립하지 않습니다. |
| **T7** | "`/user/head`가 실제로 쓰이는지 확인하고, 안 쓰이면 라우트를 지우는 게 가장 깔끔" | ❌ **지우면 안 됩니다.** `src/js/userData.js:369`의 `pullIfStale()`이 동기화 버튼을 누를 때마다 호출합니다 `[코드확인]`. 조치는 삭제가 아니라 본문 상한 축소 + 레이트리밋 복구입니다(→ N-S6). |
| **T9** | "원본 실제 용량은 확인하지 못했다" | ✅ **측정했습니다.** 평균 755 KB, 최대 17.09 MB, 썸네일 대비 27배 `[실측]`(→ N-T2). |
| **T8** | "Worker 응답에 `Cache-Control`이 없다" | ✅ 유효합니다. 다만 **정적 자산 쪽 기본값(`max-age=0, must-revalidate`)이 훨씬 큰 문제**라는 점이 1차에는 없었습니다(→ N-T1). |
| **T10/T11** | `LoadingIcons.json` 중복 fetch / favicon 없음 | ✅ 둘 다 유효합니다. `loading.js:28`과 `gridPage.js:145`가 각각 받는 것, 모든 페이지에 `<link rel="icon">`이 없는 것 확인했습니다. |
| **"공개 라이브러리에 관리자 삭제 경로 없음" (S4)** | 유효 | ✅ 재확인. 추가로 `library/` 오브젝트에 **lifecycle rule도 없어서 총량 상한이 없다**는 1차 지적도 그대로입니다. N-S2(공개 버킷)와 겹치면 도배 시 정리가 더 번거로워집니다. |

---

# ✅ 조사했고 문제 없던 것들

같은 곳을 다시 파지 않도록 남깁니다. (1차의 확인 목록과 중복되는 항목은 **재검증 결과만** 적었습니다.)

| 항목 | 판정 | 근거 |
|---|---|---|
| **저장형 XSS** | ✅ 없음 (재검증) | `src/js/` 21개 파일의 `innerHTML` 사용처 **전수 확인**. 전부 하드코딩 SVG 상수(`theme.js:12-13`, `bookmarksPage.js:23-25`, `sidebar.js:13-14`, `bookmarkPicker.js:13-14`, `postDetailSeries.js:2-4`), 고정 문자열 연결(`auth.js:160,179` — `label`/`text`는 상수 테이블에서만 옴), 또는 비우기(`= ''`)입니다. 남이 지은 라이브러리 이름은 `bookmarksPage.js:641`에서 `textContent`로만 들어갑니다. |
| **경로 순회 (`/library/../..`)** | ✅ 차단됨 | `CODE_RE = /^[A-Za-z0-9_-]{1,32}$/`(`worker:90`)가 `/`, `.`, `%`를 전부 거부합니다. `url.pathname`은 퍼센트 디코딩되지 않으므로 `%2E%2E`도 `%` 때문에 걸립니다. |
| **커밋된 시크릿** | ✅ 없음 (재검증) | 전체 히스토리를 `secret_access_key`, `AKIA…`, `ghp_`, `xox[baprs]-`, 40자 base64 패턴으로 재스캔 → 실제 키 0건. `sync_to_r2.py:23`은 gitignore된 `.r2_config.json`에서만 읽습니다. |
| **`console.*` 유출** | ✅ 0건 (재검증) | `src/js/` + `worker/` 전체에서 0건. |
| **백엔드 소스 노출** | ✅ 없음 | `worker/`가 `src/` 밖이라 자산에 포함되지 않고, `.assetsignore`가 `_worker.js`/`wrangler.toml`을 제외합니다. 두 파일 요청은 자산 매칭 실패 → Worker → `env.ASSETS.fetch` → 404. |
| **R2 이미지 캐시 헤더** | ✅ 정상 (**라이브 확인**) | `Cache-Control: public, max-age=31536000, immutable` + ETag. `sync_to_r2.py:86`이 업로드 시 명시적으로 설정합니다. 이미지 재방문 트래픽은 이미 최적입니다. |
| **R2 버킷 리스팅** | ✅ 불가 | `pub-…r2.dev/`, `/library/`, `?list-type=2` 모두 404 `[실측]`. 키를 모르면 열거할 수 없습니다. |
| **썸네일 시스템 동작** | ✅ 정상 | 커버리지 632/649(97.4%), 평균 28 KB. `IntersectionObserver` 지연 로딩(`cdnConfig.js:85-104`)과 재렌더 시 `unobserveAllLazy()` 정리(`gridPage.js:348`)까지 제대로 되어 있습니다. |
| **폰트 파일 실재** | ✅ 확인 | `CCElephantmen Italic.woff2/.woff` 모두 존재. `@font-face` 404 없음. |
| **자동 폴링** | ✅ 없음 (재검증) | `userData.js`에 `setInterval`·`focus`·`visibilitychange` 기반 자동 동기화가 전혀 없습니다. 유일한 진입점은 `requestSync()`이고 120초 쿨타임이 `localStorage`에 저장돼 새로고침으로 우회되지 않습니다(`:442-450`). |
| **검색 입력 디바운스** | ✅ 있음 | `gridPage.js:492-499`(150 ms), `bookmarksPage.js:709-713`(250 ms). 플레이스홀더 타이핑 애니메이션도 `visibilitychange` + `IntersectionObserver`로 게이팅됩니다(`gridPage.js:210-216`). |
| **동일 페이지 링크 클릭** | ✅ 차단됨 | `loading.js:183-222`가 현재 페이지로 가는 링크의 네비게이션을 막아 불필요한 전체 새로고침을 방지합니다. |
| **`_worker.js` 라우팅** | ✅ 안전 | 정적 자산이 먼저 처리되므로(`run_worker_first` 미설정 = false) API 경로만 Worker에 도달합니다. `src/` 안에 `library`/`user`/`owner`라는 이름의 파일이 없어 경로 충돌도 없습니다. |
| **`handleUserSync` 동시성** | ✅ 제대로 됨 | `etagMatches` CAS + 3회 재시도 + 409 반환(`worker:927-959`). 병합을 클라이언트에만 두고 서버는 판정만 하는 설계도 타당합니다. |
| **`handleUserSignup` 경합** | ✅ 제대로 됨 | `etagDoesNotMatch: '*'`로 "없을 때만 생성"(`worker:818-821`). 두 기기 동시 가입에서 한쪽만 성공합니다. |
| **개인 코드 엔트로피** | ✅ 충분 (재검증) | 20자 × 31자 알파벳 ≈ 99비트. 1차가 지적한 모듈로 편향(`bookmarkLibrary.js:43`, `A`~`H`가 12.5% 더 자주 나옴)은 실질 위험이 없습니다. |
| **`editToken` 엔트로피** | ✅ 충분 | 24자 × 64자 알파벳 = 144비트, 편향 없음(64는 2의 거듭제곱). |
| **평문 비밀 저장** | ✅ 없음 (재검증) | R2에는 `editTokenHash`/`ownerHash`만 저장됩니다. 다만 이 마스킹의 전제가 깨져 있다는 점은 N-S2 참고. |
| **개인 코드 URL 노출** | ✅ 없음 | `/owner/lookup`, `/user/*` 전부 POST(`worker:970-992`). 서버 로그·리퍼러에 남지 않습니다. |

---

# ✅ 권장 조치 순서 (1차 문서와 통합)

**0단계 — ~~정식 주소를 연결하세요~~ 완료됨**
1. ~~**N-S8** — `cpkg.by-works.net`에 A/AAAA 또는 커스텀 도메인 바인딩.~~ **[2026-08-26 완료]** `ckpg.cloud`를 새로 구매해 Cloudflare Custom Domain으로 연결 완료. `https://ckpg.cloud/`가 정식 프로덕션 주소입니다.

**1단계 — 지금 (한 파일, 두 명령)**
2. **N-T1 + 1차 S8** — `src/_headers` 추가. 페이지 이동당 33~36건 재검증 제거 + 보안 헤더 4종. ⚠️ 단 N-T5를 먼저.
3. **N-T5** — `DATA_VERSION` 자동 갱신 (또는 버전 쿼리 폐기 + 짧은 max-age).
4. **N-T3** — `sync_to_r2.py` + `6_build_thumbnails.py` 재실행. 깨진 이미지 11건 + 원본 로드 6건 해결.

**2단계 — 이번 주 (돈·체감속도·고장)**
5. **N-S1** — `handleOwnerLookup` / `migrateFromOwnerIndex`의 직렬 루프에 하드 상한. (플랜이 무료면 🔴, 유료면 순위 내려도 됨)
6. **1차 T2** — 폰트 서브셋 또는 최소한 `preload` 제거. **콜드 로드 2.11 MB 중 1.96 MB**입니다. *(수정 진행 중)*
7. **N-T2** — 상세 모달용 중간 프리셋(1200px). 카드 클릭당 평균 755 KB → ~100 KB.
8. **N-S4** — 죽은 라우트 2개(`/owner/lookup`, `/library/<code>/claim-owner`) 제거. 5번을 절반으로 줄여줍니다.
9. **N-S7 + 1차 T3** — 저장소 Private 전환 검토 + `.assetsignore` 확장.

**3단계 — 구조 개선**
10. **N-S3 + 1차 S1/S2** — KV 레이트리밋을 Cloudflare 네이티브 Rate Limiting 바인딩으로 교체. 세 항목이 한 번에 정리됩니다.
11. **N-S2** — 계정/라이브러리용 R2 버킷 분리.
12. **N-S6** — `/user/head` 본문 상한 1 KB + 레이트리밋 복구.
13. **1차 S4** — 관리자 삭제 키.
14. **N-T4** — 이미지 중복 제거 (⚠️ CLAUDE.md의 커스텀 이미지 경로 보존 규칙 준수).
15. **N-T6** — 경량 조회 인덱스(`Lookup.json`).

**4단계 — 위생**
16. N-T7(죽은 스크립트 2개), N-T8(검색 디바운스), N-T9(고아 파일), N-S5/S9/S10/S11/S12, 1차 S6/S7/T10/T11.

---

## 조사 범위

| 대상 | 내용 |
|---|---|
| 백엔드 | `worker/favoritesShareWorker.js` (1,008줄 전체 정독), `src/_worker.js`, `src/wrangler.toml`, `src/.assetsignore` |
| 클라이언트 | `src/js/` 21개 파일 전부 — 특히 `userData.js`, `bookmarkLibrary.js`, `bookmarks.js`, `bookmarksPage.js`, `gridPage.js`, `cdnConfig.js`, `postDetailSeries.js`, `loading.js`, `theme.js` |
| 페이지/스타일 | `src/page/*.html` 7개, `src/page/*.css` 4개, `src/css/**` 17개 |
| 데이터/빌드 | `src/data/**` 238개 파일, `src/scripts/*.py` 11개, `src/fonts/**` 63개 |
| 저장소 | git 전체 히스토리 시크릿 재스캔, `DATA_VERSION` 변경 이력, `git ls-files` 기반 배포 크기 실측, GitHub 저장소 공개 여부 |
| **라이브 실측** | R2 공개 버킷에 **1,300여 건 HEAD** — 원본/썸네일 존재·크기·ETag·응답 헤더. DNS 조회(8.8.8.8 / 1.1.1.1)로 도메인·MX·NS 확인 |
| **문서 검증** | Cloudflare 공식 문서 5종 — Workers 한도(서브요청), Workers 요금(정적 자산 무료), KV 한도(일 1,000 쓰기 / 키당 초당 1회), R2 요금(Class A/B, 이그레스 무료), R2 Workers API(`list` limit/include), Static Assets 헤더(기본 `max-age=0, must-revalidate`) 및 라우팅(assets-first) |
| **미확인** | ~~배포 Worker의 실제 응답 헤더~~(2026-08-26 확인 완료 — 아래 참고), KV/R2/Worker 실사용 지표, **Cloudflare 플랜(무료/유료)** — N-S1은 이제 상한 자체가 낮아져(N-S1 참고) 이 미확인 사실의 영향이 크지 않습니다 |
| **2026-08-26 추가 확인** | `https://cpkg.cpkg.workers.dev/`(실제 배포본, 워크스 서브도메인이 `nwb10102`가 아니라 `cpkg`)에 직접 요청해 정적 자산 캐시 헤더(N-T1)와 `GET /library` API 응답을 라이브로 검증함. KV/R2 사용량 지표와 Cloudflare 플랜 등급은 대시보드 접근이 필요해 여전히 미확인 |
