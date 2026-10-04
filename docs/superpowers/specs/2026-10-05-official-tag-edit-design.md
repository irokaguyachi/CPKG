# 공식 태그 편집 설계

- 작성일: 2026-10-05
- 상태: 승인됨 (대화에서 접근안 A와 설계 승인)
- 선행: `2026-10-05-admin-moderation-design.md` (관리 페이지 1단계)

## 목표

관리 페이지에서 작품(문학·번역·시리즈·명예관·공식)의 공식 태그를 배포 없이 고치고,
1분 안에 사이트 모든 화면(목록 카드, 태그 필터, 상세 팝업, 통합 검색, 랜덤·룰렛·슬롯,
후방주의 가리기)에 반영한다. Python 데이터 빌드를 다시 돌려도 수정이 사라지지 않는다.

범위 밖: 태그 이모지·색·순서 같은 태그 정의 관리, `태그보정.md` 내보내기.

## 구조 (접근안 A — 클라이언트 덮어쓰기 레이어)

- 작품 식별: `item_type`(`novel`/`translation`/`series`/`hof`/`official`) + 첫 게시물 ID
  (`posts[0].id`). `Lookup.json` 의 키와 같다.
- D1 `official_tag_overrides(item_type, item_id, tags, updated_at)`, PK(item_type, item_id).
  `tags` 는 JSON 배열 문자열. 빈 배열 = 태그 전부 제거(태그보정.md 와 같은 "교체" 의미).
- 변경할 때마다 서버가 전체 목록으로 R2 `tags/official-overrides.json` 을 다시 쓴다:
  `{ "v": 1, "items": { "novel:327776": ["슬픔"], ... } }`.
- 공개 `GET /tags/official` 이 그 JSON 을 내려준다(`Cache-Control: public, max-age=60`).
  없으면 `{ "v": 1, "items": {} }`.
- 클라이언트 `cdnConfig.js`:
  - `applyOfficialTagOverrides(path, data, items)` — 파일 형식별로 tags 를 교체한다.
    - `Novel`·`Translation`·`Series`·`HOF`·`Official`: 배열, 항목의 `posts[0].id` 로 매칭.
    - `Lookup`: `{ type: { id: entry } }`.
    - `Recent`: `novels` 배열(type novel).
  - 덮어쓰기 JSON 은 페이지당 한 번만 받는다. 받기 실패 시 원래 데이터 그대로.
  - `fetchJsonCached` 와 새 `fetchPageData`(캐시 없이 새로 받기) 둘 다 적용.
  - 직접 fetch 하던 6곳을 바꾼다: `gridPage.js`(목록), `rouletteModal.js`, `slotModal.js`,
    `bookmarksPage.js`(Lookup), `mainPage.js`(Official, Recent).

## 관리 API (`worker/adminOfficialTags.js`)

| 경로 | 동작 |
| --- | --- |
| `GET official-tags` | 덮어쓰기 목록 `{ items: [{ itemType, itemId, tags, updatedAt }] }` |
| `POST official-tags/set { itemType, itemId, tags, before? }` | 저장(덮어쓰기 생성/교체) |
| `POST official-tags/reset { itemType, itemId }` | 덮어쓰기 삭제(원래 태그로) |

- 검증: 종류 5개 중 하나, ID 양의 정수, 태그 최대 10개, 태그 하나 1~20자(NFC, 앞뒤 공백 제거),
  쉼표·제어 문자 거부, 중복 제거. 실제 작품인지 `Lookup.json`(ASSETS)으로 확인 — 없으면 400 `unknown item`.
- D1 변경과 작업 기록(`official-tags.set` / `official-tags.reset`, detail `{ before, after }`)을 한 batch.
- 그 뒤 R2 JSON 재생성. 실패하면 200 + `warning`(다음 변경 때 다시 만들어진다).

## 관리 화면: 탭 "공식 태그"

- 제목 검색(Lookup.json, 다섯 종류 전부) → 작품 선택.
- 원래 태그(덮어쓰기 없는 원본 데이터 파일에서)와 현재 태그를 보여준다.
- 칩 × 로 빼기, 입력란 + 자동완성(datalist: TagConfig 의 태그 + 덮어쓰기에 쓰인 태그)으로 추가.
  새 태그 자유 입력 허용 — 이모지 🏷️·기본 색으로 표시되고 정렬 맨 뒤.
- 버튼: 저장 / 원래대로. 아래에 덮어쓰기가 걸린 작품 목록(원래대로 버튼 포함).

## 테스트

- 관리 API: 저장·교체·되돌리기·작업 기록·R2 JSON, 검증 거부, 없는 작품 거부.
- 공개 `/tags/official`: R2 있음/없음.
- `applyOfficialTagOverrides`: 일곱 파일 형식, 덮어쓰기 없음, 빈 배열(전부 제거), 받기 실패 시 원본.
- 기존 `npm test`, `npm run build`, 로컬 브라우저 확인.

## 배포

`worker/admin_schema.sql` 에 테이블을 추가하므로 원격 D1 에 다시 적용
(`IF NOT EXISTS`, 기존 테이블 영향 없음).
