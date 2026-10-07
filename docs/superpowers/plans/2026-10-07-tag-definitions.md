# 태그 정의 관리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리 페이지에서 태그의 이모지·색·순서, 새 태그, 이름 바꾸기·합치기, 유저 투표 목록을 배포 없이 바꾸고 1분 안에 사이트 전체에 반영한다.

**Architecture:** D1 `site_documents['tag-definitions']` 문서 하나 → 변경 시 공식 태그 덮어쓰기와 함께 R2 `tags/official-overrides.json`(v2: `items`+`tags`+`renames`)으로 재생성 → 공개 `GET /tags/official` → `cdnConfig.js` 가 pageData 를 읽기 전에 `TagConfig.applyDefinitions` 를 부르고 renames·투표 목록을 적용. 이름 바꾸기는 D1 `tag_votes`·`official_tag_overrides` 를 실제로 옮긴다.

**Tech Stack:** Cloudflare Workers, D1, R2, vanilla JS(ES5 스타일, IIFE + `global.*`), Node 테스트 러너(`npm test`, `tests/helpers/workerHarness.cjs`).

**Spec:** `docs/superpowers/specs/2026-10-07-tag-definitions-design.md`

## Global Constraints

- 커밋은 `main` 에만, 경로를 명시해 스테이징(`git add -A`/`.` 금지). push·`dev`·`release`·원격 D1 적용은 사용자가 요청할 때만.
- 커밋 메시지는 한국어 `type(scope): 제목`, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- 태그 이름: NFC·앞뒤 공백 제거, 1~20자(코드 포인트), 쉼표·제어·폭 없는·방향 문자 거부(`adminOfficialTags.js` 의 `BAD_TAG_RE`).
- 이모지 1~8자(코드 포인트), 같은 금지 문자 거부. 색 `/^#[0-9a-f]{6}$/i` 또는 `null`(소문자로 저장). 태그 최대 100개, 이름 중복 거부. `doc.v === 1`.
- 공개 쪽은 fail-open: 정의 문서·R2 파일·D1 조회 실패 시 코드에 박힌 값과 정적 파일로 동작.
- R2 파일 v2 형식: `{ "v": 2, "items": {...}, "tags": [...] | null, "renames": {...} }`. 클라이언트는 v1(`tags`·`renames` 없음)도 받아야 한다.
- `src/js/*.js` 는 난독화 대상이라 문법 오류 없이 `npm run build` 가 통과해야 한다.

## Review Focus

1. 정의 문서가 아직 없는 상태(첫 배포 직후) → 사이트는 지금과 똑같이 보이고 투표도 `UserTagCatalog.json` 그대로(Task 1·4 테스트).
2. 이름 바꾸기 뒤 같은 사람이 A·B 둘 다 투표해 둔 작품 → 한 표만 남고 PK 충돌로 batch 가 깨지지 않음(Task 3 테스트).
3. 한 작품이 A·B 를 둘 다 가진 상태에서 A→B → 정적 데이터·덮어쓰기 모두 B 하나만(Task 3·4 테스트).
4. 띄어쓰기·따옴표가 든 새 태그에 색 지정 → 생성 CSS 가 깨지지 않고 그 칩에만 적용(Task 5 테스트).
5. 관리 화면을 두 창에서 열고 저장 → 나중 저장이 409 로 거부되고 앞 저장이 남음(Task 2 테스트).

## 진행 기록

| Task | 상태 | 메모 |
| --- | --- | --- |
| 1. 스키마 + 공용 모듈 + v2 공개 파일 + 투표 목록 | ✅ | site_documents, worker/tagDocs.js(cleanTagName·readTagDefinitions·publishTagFile), /tags/official v2, 투표 후보가 정의 문서를 따름. npm test 64/64 |
| 2. 관리 API `tag-defs` 조회·저장 | ✅ | worker/adminTagDefs.js, version 409(충돌 시 작업 기록도 남지 않게 조건부 기록), 본문 32KB. npm test 69/69 |
| 3. 관리 API 이름 바꾸기·되돌리기 | ✅ | rename(투표·덮어쓰기·정의·renames 한 batch + 스냅샷 재생성), unrename. npm test 73/73 |
| 4. 클라이언트 로더(cdnConfig) | ✅ | renames 적용·중복 제거, UserTagCatalog 바꿔치기, TagConfig/__tagDefinitions 전달. npm test 76/76 |
| 5. `TagConfig.applyDefinitions` | ✅ | 순서·이모지 제자리 교체, definitionCss·glowColor, 표지 색. tests/tag-config.test.cjs. npm test 79/79 |
| 6. 관리 화면 "태그 정의" 탭 | ✅ | 로컬 wrangler dev 에서 저장·이름 바꾸기·문학 목록 필터와 칩·라이트/다크 색 확인. build OK |
| 7. 전체 검증 | ✅ | npm test 79/79, npm run build exit 0. 원격 D1 적용은 사용자 요청 시 |

---

### Task 1: 스키마 + 공용 모듈 + v2 공개 파일 + 투표 목록

**Files:**
- Modify: `worker/admin_schema.sql` (끝에 `site_documents`, 스펙 1절 SQL 그대로 + 주석)
- Create: `worker/tagDocs.js`
- Modify: `worker/adminOfficialTags.js` (`cleanTags` 가 `cleanTagName` 사용, `publishOverrides` → `publishTagFile`)
- Modify: `worker/favoritesShareWorker.js` (`handleOfficialTags` 기본값, `loadTagCatalog`)
- Test: `tests/admin-api.test.cjs`

**Interfaces (Produces, `worker/tagDocs.js`):**
- `export var TAG_DEFS_KEY = 'tag-definitions'`
- `export function cleanTagName(raw) -> string | null` — Global Constraints 의 이름 규칙.
- `export async function readTagDefinitions(env) -> { doc, version } | null` — 행이 없으면 null, 예외는 호출부로 던짐.
- `export async function publishTagFile(env) -> boolean` — `official_tag_overrides` 전체 + 정의 문서로 v2 파일을 R2 `tags/official-overrides.json` 에 씀. 정의 문서가 없으면 `tags: null, renames: {}`. 실패 시 false.

- [ ] **Step 1: 실패 테스트**
  - 기존 `public official tag overrides default to empty` 의 기대값을 `{ v: 2, items: {}, tags: null, renames: {} }` 로 바꾸고, R2 에 v1 파일을 넣으면 그대로 내려주는 부분은 유지.
  - `official tag edits publish the v2 file with tag definitions` — D1 에 `site_documents('tag-definitions', '{"v":1,"tags":[{"name":"슬픔","emoji":"💧","color":null,"votable":true}],"renames":{"짧문":"짧은글"}}', 1, now)` 를 직접 넣고 `official-tags/set` 후 `/tags/official` 이 `{ v: 2, items: { 'novel:123': ['슬픔'] }, tags: [...그 태그], renames: { '짧문': '짧은글' } }`.
  - `tag voting follows votable definitions when present` — 문서 없으면 `UserTagCatalog.json`(하네스: 일상·로맨스·피폐)의 '일상' 투표 200, '슬픔' 400. 위 문서를 넣으면 '슬픔' 200, '일상' 400.
  - `schema applies cleanly` 는 그대로 통과해야 한다.
- [ ] **Step 2:** `npm test` → 새 테스트 FAIL 확인.
- [ ] **Step 3: 구현** — `tagDocs.js` 작성, `adminOfficialTags.js` 가 이를 쓰도록 교체(동작 동일), `handleOfficialTags` 기본 응답 v2, `loadTagCatalog` 는 `readTagDefinitions` 성공 + 문서 있으면 `doc.tags.filter(t => t.votable).map(t => t.name)`, 예외·없음이면 기존 ASSETS 경로.
- [ ] **Step 4:** `npm test` → 전부 PASS.
- [ ] **Step 5: 커밋** — `git add worker/admin_schema.sql worker/tagDocs.js worker/adminOfficialTags.js worker/favoritesShareWorker.js tests/admin-api.test.cjs`, `feat(admin): 태그 정의 문서 저장소와 v2 공개 태그 파일 추가`.

### Task 2: 관리 API `tag-defs` 조회·저장

**Files:**
- Create: `worker/adminTagDefs.js`
- Modify: `worker/adminCommon.js` (`readBody(request, maxBytes?)` — 기본 4096 유지)
- Modify: `worker/adminApi.js` (`tagDefRoutes` 를 `ROUTES` 에 합침)
- Test: `tests/admin-api.test.cjs`

**Interfaces:**
- Consumes: Task 1 `cleanTagName`, `readTagDefinitions`, `publishTagFile`, `TAG_DEFS_KEY`.
- Produces: `export var tagDefRoutes = { 'GET /tag-defs', 'POST /tag-defs/save', 'POST /tag-defs/rename', 'POST /tag-defs/unrename' }`(뒤 둘은 Task 3), 내부 `cleanDefinitionTags(raw) -> Array | null`, `writeDocStatement(env, doc, version) -> D1PreparedStatement`(version 은 새 값; 0→1 은 INSERT, 그 외 `UPDATE ... WHERE key = ? AND version = ?` 로 이전 version 확인).
- 응답: GET `{ doc, version }`(없으면 `{ doc: null, version: 0 }`), save `{ ok: true, version }`(+ R2 실패 시 `warning`), 409 `{ error: 'version conflict' }`.
- save 본문 한도 32768 바이트.

- [ ] **Step 1: 실패 테스트**
  - `admin saves tag definitions and republishes` — GET 은 `{ doc: null, version: 0 }`; save `{ doc: { v:1, tags:[{name:' 슬픔 ',emoji:'💧',color:'#6688CC',votable:true}, {name:'새 태그',emoji:'✨',color:null,votable:false}] }, version: 0 }` → 200 `version: 1`; GET 은 이름 trim·색 소문자 `#6688cc`·`renames: {}`; `/tags/official` 의 `tags` 같음; 작업 기록 `tag-defs.save` detail `{ before: null, after: <doc> }`.
  - `stale tag definition saves are rejected` — version 0 으로 두 번째 저장 → 409, D1 문서는 첫 저장 그대로.
  - `save keeps the server renames` — D1 문서에 `renames: {a:'b'}` 를 직접 넣고 save 본문에 `renames: {}` → 저장 후 renames `{a:'b'}`.
  - `tag definitions are validated` — 각각 400: `v:2`, tags 비배열, 101개, 이름 중복(`'슬픔'`과 `' 슬픔'`), 이름 `'a,b'`, 21자, 이모지 `''`, 이모지 9자, 색 `'red'`, votable 비불리언. 그리고 D1 행 0개.
  - `a large definition document fits` — 한글 20자 이름 100개 문서 저장 200.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: 구현** — save 는 `[writeDocStatement, logAction(...'tag-defs.save', 'tag-definitions', {before, after})]` batch, `UPDATE` 의 `meta.changes === 0` 이면 409(batch 결과로 판단; 하네스 D1 이 `meta.changes` 를 주는지 확인하고 안 주면 저장 전 version 비교 + UPDATE 조건 둘 다 둔다). 이어서 `publishTagFile`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: 커밋** — `feat(admin): 태그 정의 조회·저장 API 추가`.

### Task 3: 관리 API 이름 바꾸기·되돌리기

**Files:** `worker/adminTagDefs.js`, `tests/admin-api.test.cjs`

**Interfaces:**
- Consumes: Task 2 내부 함수, `recordTagSnapshot(env)`(`worker/tagSnapshot.js`).
- Produces: `POST tag-defs/rename { from, to, version }` → `{ ok, merged, movedVotes, changedOverrides, version }`; `POST tag-defs/unrename { from, version }` → `{ ok, version }` / 404.
- 문서가 없을 때(version 0) rename 은 빈 문서 `{ v:1, tags: [], renames: {} }` 에서 시작한다.

순수 함수 `renameDoc(doc, from, to) -> { doc, merged }`(스펙 2절 표의 "태그 정의"·"기존 renames" 두 줄):
`merged = tags 에 to 가 있음`. 합치기면 from 항목 삭제, 아니면 from 항목의 name 을 to 로. renames 의 모든 값 중 from 을 to 로 바꾸고 `renames[from] = to`, 그 뒤 키 === 값인 항목 삭제.

- [ ] **Step 1: 실패 테스트**
  - `renaming a tag moves votes, overrides and definitions` — 정의 `[A(이모지 🅰️, votable), C]`; 투표: voter1 post10 A, voter2 post10 A, voter2 post10 B; 덮어쓰기 novel:123 `['A','B']`, novel:456 `['A','C']`. rename A→B(version 1) → 200, `merged:false`, `movedVotes:2`(옮기기 전 A 행 수), `changedOverrides:2`. 확인: `tag_votes` 에 A 없음, post10 B 표 2개; 덮어쓰기 `['B']`, `['B','C']`; 정의 `[B(🅰️, votable), C]`; renames `{A:'B'}`; `tags/snapshot.json` 에 post10 `{tag:'B', votes:2}`; 작업 기록 `tag-defs.rename` detail 의 `from`,`to`,`merged`,`before`.
  - `merging keeps the target definition and chains renames` — 정의 `[A(🅰️), B(🅱️)]`, renames `{X:'A'}` → A→B: `merged:true`, 정의 `[B(🅱️)]`, renames `{X:'B', A:'B'}`. 이어서 B→A: renames 에 `B→B` 같은 자기 항목 없음(`{X:'A', B:'A'}`), 정의 `[A(🅱️)]`.
  - `rename and unrename are validated` — `from === to` 400, 이름 규칙 위반 400, 낡은 version 409, unrename 없는 키 404, unrename 정상 시 renames 에서 빠지고 `tag-defs.unrename` 기록, `/tags/official` 반영.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: 구현** — 한 batch: 문서 쓰기 문(Task 2 `writeDocStatement`), `UPDATE OR IGNORE tag_votes SET tag_name = ? WHERE tag_name = ?`, `DELETE FROM tag_votes WHERE tag_name = ?`(from), 바뀐 덮어쓰기 행마다 `UPDATE official_tag_overrides SET tags = ?, updated_at = ? WHERE item_type = ? AND item_id = ?`, 작업 기록. `movedVotes` 는 batch 전 `SELECT COUNT(*) FROM tag_votes WHERE tag_name = ?`(from). 그 뒤 `recordTagSnapshot`, `publishTagFile`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: 커밋** — `feat(admin): 태그 이름 바꾸기·합치기 API 추가`.

### Task 4: 클라이언트 로더(cdnConfig)

**Files:** `src/js/config/cdnConfig.js`, `tests/official-tags.test.cjs`

**Interfaces:**
- Consumes: `/tags/official` v1/v2.
- Produces:
  - 내부 `officialTagOverrides()` 가 `{ items, tags, renames }` 로 resolve(실패·v1 이면 `tags: null, renames: {}`).
  - 받은 뒤 한 번: `tags !== null || renames 비어있지 않음` 이면 `global.TagConfig && global.TagConfig.applyDefinitions({ tags, renames })`, TagConfig 가 없으면 `global.__tagDefinitions = { tags, renames }`.
  - `global.applyOfficialTagOverrides(path, data, items, defs?)` — 기존 3인자 호출 호환. `defs.renames` 가 있으면 덮어쓰기 적용 뒤 모든 작품 tags 에 renames 적용 + 순서 유지 중복 제거.
  - `pageDataName` 이 `UserTagCatalog.json` 도 인식: `defs.tags` 가 배열이면 `votable` 이름 배열로 교체, 아니면 원본.

- [ ] **Step 1: 실패 테스트** (`loadConfig` 에 window.TagConfig 모형 주입 옵션 추가)
  - `renames apply to every page data shape and remove duplicates` — v2 `{ items: { 'novel:1': ['A','B'] }, tags: null, renames: { A: 'B', 로맨스: '사랑' } }` → Novel `[['B'], ['사랑']]`, Lookup·Recent 동일.
  - `the user tag catalog follows votable definitions` — `UserTagCatalog.json` 정적 `['일상']`, defs `tags: [{name:'슬픔',votable:true},{name:'감동',votable:false}]` → `['슬픔']`; `tags: null` 이면 `['일상']`.
  - `definitions reach TagConfig once, even if it loads later` — TagConfig 모형 있으면 `applyDefinitions` 1회 호출(인자 확인); 없으면 `window.__tagDefinitions` 에 담김; v1 응답이면 둘 다 없음.
  - 기존 세 테스트 그대로 PASS(v1 응답).
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: 커밋** — `feat(tags): 태그 정의와 이름 바꾸기를 사이트 데이터에 적용`.

### Task 5: `TagConfig.applyDefinitions`

**Files:** `src/js/config/tagConfig.js`, `tests/tag-config.test.cjs`(새)

**Interfaces (Produces, `global.TagConfig` 에 추가):**
- `BUILTIN: { order: string[], emoji: {name: emoji} }` — 정의 적용 전 내장값 복사본(관리 화면 초기값).
- `definitionCss(tags) -> string` — color 있는 태그마다 규칙 생성. 선택자 `[data-tag="<CSS 문자열 이스케이프>"]`(`CSS.escape` 가 있으면 사용, 없으면 `\` 와 `"` 를 이스케이프하는 대체 함수 — 테스트는 대체 함수 경로). 라이트: `--tag-bg` = 색 12% + 흰색 88%. 다크(`[data-theme="dark"] [data-tag=...]`): `--tag-bg: rgba(r,g,b,0.22)`, `--tag-text` = 색 45% + 흰색 55%, `--tag-border: rgba(r,g,b,0.35)`.
- `glowColor(tag) -> 'r, g, b' | null` — 정의 색의 RGB.
- `applyDefinitions({ tags, renames })` — `tags` 가 배열이면 `TAG_ORDER` 를 제자리에서 그 순서로 교체, 정의의 이모지를 `TAG_EMOJI` 에 덮어씀(삭제된 정의의 내장 이모지는 남김), 색을 저장하고 `document` 가 있으면 `<style id="tag-defs-style">` 내용 교체. `renames` 는 `TagConfig.renames` 로 보관. 초기화 때 `global.__tagDefinitions` 가 있으면 바로 적용.
- `applyTextCover` 는 `glowColor(tag)` 가 있으면 `--cover-color` 에 그 값을 바로 넣는다.

- [ ] **Step 1: 실패 테스트** (vm 에 `window` 만, `document` 없음 / 간단한 document 모형 둘 다)
  - `definitions reorder tags and set emoji in place` — `const order = TagConfig.TAG_ORDER` 참조를 잡고 apply `[{name:'로맨스',emoji:'💘'},{name:'새 태그',emoji:'✨'}]` → `order[0..1]` 이 그 둘, `TAG_EMOJI['새 태그'] === '✨'`, `TAG_EMOJI['일상'] === '☀️'`, `sortTags(['일상','새 태그','로맨스'])` → `['로맨스','새 태그','일상']`, `BUILTIN.order[0] === '짧문'`.
  - `generated colors cover light, dark and quoted names` — `definitionCss([{name:'새 "태그"', color:'#6688cc'}])` 에 `[data-tag="새 \"태그\""]`, `--tag-bg: #edf1f9`(=round(0.12*c+0.88*255)), `rgba(102, 136, 204, 0.22)`, `rgba(102, 136, 204, 0.35)`; color null 인 태그는 규칙 없음; `glowColor('새 "태그"') === '102, 136, 204'`.
  - `pending definitions are applied on load` — `window.__tagDefinitions` 를 먼저 두고 로드하면 반영됨; document 모형이면 `tag-defs-style` 요소 하나만 생기고 두 번 apply 해도 하나.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: 커밋** — `feat(tags): 태그 정의로 이모지·순서·색을 바꾸는 applyDefinitions 추가`.

### Task 6: 관리 화면 "태그 정의" 탭

**Files:** `src/js/pages/adminPage.js`, `src/css/pages/admin-page.css`

**Interfaces:** Consumes Task 2·3 API, Task 5 `TagConfig.BUILTIN`·`definitionCss`. `TABS` 에 `{ key: 'tagdefs', label: '태그 정의', href: '#tagdefs' }` 를 '공식 태그' 다음에.

- [ ] **Step 1: 구현** (스펙 4절)
  - 초기값: `doc === null` 이면 `BUILTIN.order` + `BUILTIN.emoji` 의 나머지 + `UserTagCatalog.json`(`fetch(dataUrl(...))` 로 덮어쓰기 없이)로 `votable` 을 채우고 color 는 null. 안내 문구 "아직 저장된 정의가 없어 지금 코드 값을 보여 줘요".
  - 줄: ▲▼, 미리보기 칩(`data-tag`, 편집 중 색은 `definitionCss(draft)` 를 탭 전용 `<style>` 에 넣어 즉시 반영), 이모지 입력, `<input type="color">` + "기본색", 투표 체크, 삭제.
  - 태그 추가 입력 + datalist(Lookup.json 다섯 종류의 tags + `official-tags` 덮어쓰기 태그 중 목록에 없는 것).
  - 저장(변경 표시, `beforeunload`·탭 이동 경고, 409 안내), 저장 안 한 변경이 있으면 이름 바꾸기 버튼 비활성 + 안내.
  - 이름 바꾸기: A select / B input+datalist → 기존 `dialog(opts)`(`adminPage.js`, opts `{ title, desc, confirmLabel, danger }`; 합치기면 `danger: true`)로 "이름 바꾸기|합치기, A 작품 N개, (B 가 데이터에 있으면) B 작품 M개와 합쳐짐, 합치기는 완전히 되돌릴 수 없음" → 실행 → 결과(옮긴 표·바꾼 덮어쓰기 수).
  - 현재 renames 목록 + 삭제(안내: 옮긴 표·덮어쓰기는 B 로 남음).
- [ ] **Step 2:** `npm test`, `npm run build` PASS.
- [ ] **Step 3: 브라우저 확인** — 로컬 `npx wrangler dev`(src/ 기준, 원격 아님)에서 관리자 로그인 → 정의 저장(색·이모지·순서) → 문학 목록의 필터·카드 칩·텍스트 표지 반영, 라이트·다크 둘 다. 새 태그(띄어쓰기) 색. A→B 이름 바꾸기 후 목록·상세·투표 칩. 두 창 저장 409.
- [ ] **Step 4: 커밋** — `feat(admin): 관리 페이지에 태그 정의 탭 추가`.

### Task 7: 전체 검증

- [ ] `npm test` 전부 PASS, `npm run build` exit 0(출력 확인).
- [ ] 이 문서 진행 기록 갱신, 스펙 "배포" 절의 원격 D1 명령을 사용자에게 안내(실행은 사용자 요청 시).
- [ ] 커밋 — `docs(admin): 태그 정의 구현 계획 진행 기록 갱신`. push·dev 반영은 사용자가 요청할 때만.
