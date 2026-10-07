# 태그 정의 관리 설계

- 작성일: 2026-10-07
- 상태: 승인됨 (대화에서 접근안 A와 섹션별 설계 승인)
- 선행: `2026-10-05-admin-moderation-design.md`(관리 페이지 1단계),
  `2026-10-05-official-tag-edit-design.md`(공식 태그 편집)
- 관리 도구 남은 세 하위 프로젝트(태그 정의 → 공지·사이트 설정 → 회원 계정) 중 첫 번째.

## 목표

관리 페이지에서 배포 없이 다음을 바꾸고 1분 안에 사이트 모든 화면에 반영한다.
Python 데이터 빌드를 다시 돌려도 바뀐 내용이 사라지지 않는다.

1. 태그의 이모지·색·정렬 순서
2. 새 태그 등록(공식 태그 편집에서 자유 입력한 태그에 이모지·색·자리 주기)
3. 태그 이름 바꾸기·합치기(모든 작품, 공식 태그 덮어쓰기, 유저 투표에 한 번에 반영)
4. 유저가 투표할 수 있는 태그 목록(지금의 `UserTagCatalog.json`)

범위 밖: `태그보정.md`·Python 빌드 스크립트에 이름 변경을 역반영하는 일(런타임 레이어가 처리한다).

## 1. 데이터와 전달 (접근안 A — 공식 태그 덮어쓰기 레이어 확장)

### D1 `site_documents`

```sql
CREATE TABLE IF NOT EXISTS site_documents (
  key        TEXT    PRIMARY KEY,
  doc        TEXT    NOT NULL,     -- JSON
  version    INTEGER NOT NULL,     -- 저장할 때마다 +1, 낙관적 잠금용
  updated_at INTEGER NOT NULL
);
```

태그 정의는 `key = 'tag-definitions'` 문서 하나다. 다음 하위 프로젝트(공지·사이트 설정)도
같은 테이블에 다른 key 로 둔다.

```json
{ "v": 1,
  "tags": [ { "name": "짧문", "emoji": "✍️", "color": null, "votable": false } ],
  "renames": { "옛이름": "새이름" } }
```

- `tags` 배열 순서 = 정렬 순서. 목록에 없는 태그는 지금처럼 🏷️·기본색·맨 뒤.
- `color: null` = `tags.css` 에 손으로 맞춘 색 유지. `#rrggbb` 일 때만 덮어쓴다.
- `votable` = 유저 투표 후보. 문서가 있으면 `UserTagCatalog.json` 을 대체한다.
- `renames` 는 `tag-defs/rename`·`unrename` 으로만 바뀐다(`save` 는 기존 값을 유지).

### 공개 파일

R2 `tags/official-overrides.json` 을 `{ "v": 2, "items": {...}, "tags": [...] | null, "renames": {...} }`
로 넓힌다. 공식 태그 덮어쓰기 저장, 태그 정의 저장 어느 쪽이든 두 D1 소스를 모아 이 파일
전체를 다시 굽는 공용 함수 하나를 쓴다. `GET /tags/official` 은 그대로(요청 수 늘지 않음).
태그 정의 문서가 없으면 `tags: null`, `renames: {}`.

### 브라우저

- `cdnConfig.js`: `/tags/official` 을 받으면 데이터를 그리기 전에
  `TagConfig.applyDefinitions({ tags, renames })` 를 부른다. `tagConfig.js` 가 아직 실행 전이면
  `window.__tagDefinitions` 에 두고 `tagConfig.js` 가 초기화 때 가져간다.
- `applyOfficialTagOverrides` 는 덮어쓰기 적용 뒤 `renames` 로 각 작품 tags 를 바꾸고 중복을
  제거한다(덮어쓰기 값은 서버가 이미 새 이름으로 바꿔 두지만, 같은 함수로 같이 거른다).
- `UserTagCatalog.json` 경로도 같은 로더를 거치게 해서, 정의 문서가 있으면 `votable` 태그
  목록으로 바꿔 돌려준다(`gridPage.js`, `postDetailSeries.js` 두 곳).
- `applyDefinitions`:
  - `TAG_ORDER` 를 문서 순서로, `TAG_EMOJI` 를 내장값 + 문서 이모지로 바꾼다
    (기존 참조가 끊기지 않도록 객체·배열을 제자리에서 고친다).
  - 색이 있는 태그는 `<style id="tag-defs-style">` 하나에 규칙을 생성한다: 라이트 배경
    (흰색과 섞은 옅은 색), 다크 배경·글자·테두리(rgba 0.22 / 밝게 / rgba 0.35), 표지 빛 RGB.
    선택자는 `[data-tag="${CSS.escape(name)}"]` 라 띄어쓰기 들어간 태그도 된다.
  - 표지(`applyTextCover`·`coverTags`)는 정의 색이 있으면 CSS 변수 이름을 거치지 않고 값을
    바로 쓴다. 이모지가 정의된 새 태그도 표지 대표 태그 후보가 된다.
- 받기 실패 시 코드에 박힌 값과 정적 파일을 그대로 쓴다.

### 서버 투표 검증

`loadTagCatalog`(favoritesShareWorker.js)는 D1 `tag-definitions` 문서의 `votable` 목록을 먼저
보고, 문서가 없거나 읽기 실패면 지금처럼 `UserTagCatalog.json` 을 본다.

### 처음 사용

D1 에 문서가 없으면 관리 화면이 현재 `TagConfig`(TAG_ORDER·TAG_EMOJI) + `UserTagCatalog.json`
으로 초기 목록을 채워 보여 준다(`color` 는 전부 null). 첫 저장부터 D1 문서를 쓴다.

## 2. 이름 바꾸기·합치기

`A → B` 한 동작. 서버 기준으로 B 가 정의 목록(`tags`)에 없으면 이름 바꾸기, 있으면 합치기.
B 가 정의 목록엔 없지만 데이터에는 이미 붙어 있는 경우는 화면 확인 창이 "B 가 붙은 작품 N개와
합쳐진다"고 따로 알린다(정의 처리는 이름 바꾸기와 같다). 서버가 한 D1 batch 로 처리한다.

| 대상 | 처리 |
| --- | --- |
| 정적 작품 데이터 | `renames` 에 `A → B` 추가. 브라우저가 읽을 때 바꾸고 중복 제거. 재빌드해도 유지 |
| 공식 태그 덮어쓰기 | `official_tag_overrides` 각 행의 A 를 B 로 실제 교체, 중복 제거 |
| 유저 투표 `tag_votes` | `UPDATE OR IGNORE ... SET tag_name = B WHERE tag_name = A` 후 남은 A 행 삭제 (같은 사람이 둘 다 찍었으면 한 표). 이어서 `tagSnapshot.js` 로 스냅샷 즉시 재생성 |
| 태그 정의 | 이름 바꾸기: A 항목의 이모지·색·자리·votable 을 B 가 물려받음. 합치기: B 설정 유지, A 항목 삭제 |
| 기존 `renames` | `X → A` 는 `X → B` 로 고쳐 연결 유지, `B → B` 같은 자기 자신 항목은 삭제 |

- 작업 기록 `tag-defs.rename`, detail `{ from, to, merged, movedVotes, changedOverrides, before }`
  (`before` = 바뀌기 전 문서).
- 되돌리기: `B → A` 를 다시 실행하면 이름은 돌아온다. 합치기는 완전히 되돌릴 수 없다(원래 B
  였던 작품·표도 A 로 간다). 그래서 확인 창에 합치기 여부와 영향받는 작품 수를 보여 준다.
- `unrename A`: `renames` 항목만 지운다. 정적 데이터는 다시 A 로 보이지만 이미 옮긴 표·덮어쓰기는
  B 로 남는다. 화면에 이 안내를 적는다. 작업 기록 `tag-defs.unrename`.

## 3. 관리 API (`worker/adminTagDefs.js`)

| 경로 | 동작 |
| --- | --- |
| `GET tag-defs` | `{ doc, version }` (문서 없으면 `doc: null, version: 0`) |
| `POST tag-defs/save { doc, version }` | 문서 저장. version 불일치면 409 `version conflict`. `renames` 는 서버 값을 유지 |
| `POST tag-defs/rename { from, to, version }` | 2절 처리. 응답 `{ ok, merged, movedVotes, changedOverrides, version }` |
| `POST tag-defs/unrename { from, version }` | `renames` 항목 삭제. 없으면 404 |

- 검증: 태그 이름은 공식 태그와 같은 규칙(NFC·앞뒤 공백 제거, 1~20자, 쉼표·제어·폭 없는·방향
  문자 거부 — `adminOfficialTags.js` 의 `cleanTags` 규칙을 공용으로 뺀다). 이모지 1~8자(코드 포인트),
  제어 문자 거부. 색 `#rrggbb` 또는 null. 태그 최대 100개, 이름 중복 거부. `from === to` 거부.
  `doc.v` 는 1.
- D1 변경 + `admin_actions` 기록(`tag-defs.save` detail `{ before, after }`)을 한 batch. 그 뒤 R2
  공개 파일 재생성, 실패하면 200 + `warning`.
- `adminApi.js` 에 `tagDefRoutes` 등록.

## 4. 관리 화면: 탭 "태그 정의"

- 태그 한 줄: `▲▼` 순서 / 미리보기 칩(사이트와 같은 `data-tag` 스타일, 라이트·다크) / 이모지 입력 /
  색(`<input type="color">` + "기본색" 버튼) / 투표 허용 체크 / 삭제.
- "태그 추가" 입력란. 자동완성은 데이터(Lookup.json)와 덮어쓰기에 쓰였지만 목록에 없는 태그.
- 저장 버튼 하나. 저장 안 한 변경 표시, 탭을 떠나거나 창을 닫으면 경고. 409 면 "다른 곳에서
  바뀌었으니 새로 불러오라"는 안내.
- "이름 바꾸기·합치기": A(정의 목록 + 데이터 태그) / B(입력 + 자동완성) → 확인 창(이름 바꾸기인지
  합치기인지, Lookup.json 기준 A 가 붙은 작품 수) → 실행. 아래에 현재 `renames` 목록과 삭제 버튼.
- 저장 안 한 변경이 있으면 이름 바꾸기를 막고 먼저 저장하라고 안내한다(문서 version 이 엇갈리지 않게).

## 5. 테스트

- 관리 API: 저장, version 409, 검증 거부, `save` 가 renames 를 건드리지 않음, 이름 바꾸기, 합치기,
  renames 연결 고쳐 쓰기·자기 자신 제거, 표 합치기와 중복 제거, 덮어쓰기 고쳐 쓰기, 작업 기록,
  R2 파일 내용(v2), unrename.
- 공식 태그 덮어쓰기 저장도 v2 파일을 굽는지(정의 문서 유지).
- 투표 검증: 문서 있으면 votable 목록, 없으면 `UserTagCatalog.json`.
- `cdnConfig.js`: renames 적용·중복 제거, `UserTagCatalog.json` 바꿔치기, v1 파일, 받기 실패 시 원본.
- `tagConfig.js` `applyDefinitions`: 순서·이모지, 생성 색 스타일, 띄어쓰기 태그, 표지 색.
- `npm test`, `npm run build`, 로컬 브라우저 라이트·다크 확인.

## 배포

`worker/admin_schema.sql` 에 `site_documents` 를 추가하므로 원격 D1 에 다시 적용
(`IF NOT EXISTS`, 기존 테이블 영향 없음):
`npx wrangler d1 execute cpkg-tags --remote --file=worker/admin_schema.sql`
