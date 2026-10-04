# 공식 태그 편집 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리 페이지에서 작품의 공식 태그를 고치면 배포 없이 사이트 전 화면에 반영한다.

**Architecture:** D1 `official_tag_overrides` → 변경 시 R2 `tags/official-overrides.json` 재생성 → 공개 `GET /tags/official` → 클라이언트 `cdnConfig.js` 가 pageData JSON 을 읽을 때 tags 를 교체.

**Tech Stack:** Cloudflare Workers, D1, R2, vanilla JS, Node 테스트 러너.

**Spec:** `docs/superpowers/specs/2026-10-05-official-tag-edit-design.md`

## Global Constraints

- 사용자가 요청한 흐름: 구현 후 `main` 커밋(경로 명시) → `dev` fast-forward. `release` 는 건드리지 않는다.
- 종류: `novel`, `translation`, `series`, `hof`, `official`. 키 문자열 `"<type>:<id>"`.
- 태그 최대 10개, 하나 1~20자, 쉼표·제어 문자 거부.
- 공개 쪽 실패는 원본 데이터로 통과(fail-open).

## Review Focus

1. 덮어쓰기 JSON 받기 실패 → 원본 태그로 화면이 정상(Task 3 테스트).
2. 같은 작품이 Lookup·Recent·목록 파일에 동시에 있음 → 셋 다 같은 태그(Task 3 테스트).
3. 빈 배열 덮어쓰기 → 태그 없음으로 표시, 원래대로로 복구(Task 2·3 테스트).
4. 없는 작품 ID 로 저장 시도 → 400, D1·R2 변화 없음(Task 2 테스트).
5. 관리 테이블 미적용 상태에서 `/tags/official` → 빈 목록으로 정상 응답(Task 1 테스트).

## 진행 기록

| Task | 상태 | 메모 |
| --- | --- | --- |
| 1. 스키마 + 공개 `/tags/official` | ✅ | official_tag_overrides 테이블, 공개 GET /tags/official(R2, 60초 캐시). npm test 57/57 |
| 2. 관리 API `official-tags` | ✅ | worker/adminOfficialTags.js(목록·저장·원래대로, 검증, Lookup 존재 확인, R2 재생성). npm test 59/59 |
| 3. 클라이언트 덮어쓰기(cdnConfig) + 6곳 교체 | ✅ | cdnConfig.js applyOfficialTagOverrides·fetchPageData, fetchJsonCached 자동 적용, 직접 fetch 6곳 교체(gridPage·룰렛·슬롯·북마크 Lookup·메인 Official/Recent). tests/official-tags.test.cjs. npm test 62/62 |
| 4. 관리 화면 "공식 태그" 탭 | ✅ | adminPage.js 공식 태그 탭(검색·원래/바꿀 태그 칩·자동완성·저장·원래대로·덮어쓰기 목록). 로컬에서 저장→문학 목록 카드·필터·Lookup 반영 확인. 확인 페이지 무한 새로고침 방지(?gate=1) 추가. npm test 62/62, build OK |
| 5. 검증 + 커밋 + dev | ✅ | 원격 D1 official_tag_overrides 적용, main 커밋(3b97c1a feat, 문서 커밋) → push → dev ff → Workers Builds 확인 |

---

### Task 1: 스키마 + 공개 `/tags/official`

**Files:** `worker/admin_schema.sql`, `worker/favoritesShareWorker.js`(라우트 + `handleOfficialTags`), `src/_worker.js`(`API_EXACT_PATHS` 에 `/tags/official`), `tests/admin-api.test.cjs`

- [x] 실패 테스트: `public official tag overrides default to empty` — R2 없으면 `{v:1,items:{}}`, 있으면 그대로, `Cache-Control: public, max-age=60`.
- [x] 구현 → `npm test` PASS.

### Task 2: 관리 API `official-tags`

**Files:** `worker/adminOfficialTags.js`(새), `worker/adminApi.js`(라우트 등록), `tests/admin-api.test.cjs`

**Interfaces:** `officialTagRoutes = { 'GET /official-tags', 'POST /official-tags/set', 'POST /official-tags/reset' }`; R2 키 `tags/official-overrides.json`.

- [x] 실패 테스트:
  - `admin sets and resets official tags and republishes the overrides` — set 후 `/tags/official` items 에 `novel:123`, 교체, 빈 배열, reset 후 사라짐, 작업 기록 2종 + detail before/after.
  - `official tag edits are validated` — 잘못된 종류/ID/쉼표/21자/11개 400, 중복 제거, 없는 작품 400 `unknown item` 이고 D1·R2 변화 없음.
- [x] 구현 → `npm test` PASS.

### Task 3: 클라이언트 덮어쓰기

**Files:** `src/js/config/cdnConfig.js`, `src/js/pages/gridPage.js`, `src/js/components/rouletteModal.js`, `src/js/components/slotModal.js`, `src/js/pages/bookmarksPage.js`, `src/js/pages/mainPage.js`, `tests/official-tags.test.cjs`(새)

**Interfaces:** `global.applyOfficialTagOverrides(path, data, items) -> data`, `global.fetchPageData(path) -> Promise<json>`, `fetchJsonCached` 는 pageData 경로에 자동 적용.

- [x] 실패 테스트(vm 으로 cdnConfig.js 실행, fetch 모형): 일곱 형식 교체, 덮어쓰기 없는 항목 그대로, 빈 배열, `/tags/official` 실패 시 원본, 덮어쓰기는 페이지당 1회 요청.
- [x] 구현 + 6곳 교체 → `npm test` PASS.

### Task 4: 관리 화면 "공식 태그" 탭

**Files:** `src/js/pages/adminPage.js`, `src/css/pages/admin-page.css`

- [x] 탭 추가, 검색·칩 편집·저장·원래대로·덮어쓰기 목록. 원래 태그는 `fetch(dataUrl(...))` 로 덮어쓰기 없이 읽는다.
- [x] `npm test`, `npm run build`, 로컬 wrangler dev 에서 저장 → 목록·필터·상세 반영 확인.

### Task 5: 검증 + 커밋 + dev

- [x] 원격 D1 에 `admin_schema.sql` 재적용(IF NOT EXISTS).
- [x] `main` 커밋(경로 명시) → push → `dev` ff → Workers Builds 성공 확인.
