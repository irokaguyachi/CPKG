# Claude Project Guidelines (CLAUDE.md)

이 문서는 이 프로젝트에서 작업하는 모든 Claude 및 AI 에이전트가 반드시 준수해야 하는 최우선 핵심 규칙입니다.

---

## 🚨 [최우선 절대 금지] 사용자 커스텀 이미지 및 에셋 덮어쓰기/롤백 금지

### 1. 사용자 변경 이미지 에셋 절대 보존
- **대상 폴더**: `src/assets/Image/` 및 모든 하위 경로
- **보존 항목**: 로고(`Logo.png`, `Logo_HOF.png`, `명예관_Light.png`, `명예관_Dark.png`, `Logo_Series.png`), 배너, 커버 이미지, 일러스트, 아이콘, 썸네일 등
- **수칙**:
  - 사용자가 직접 제작, 추가, 교체 또는 위치를 조정한 이미지 에셋은 **절대 이전 원본 크롤링 이미지나 기본 템플릿 이미지로 되돌리거나(롤백) 덮어쓰지 마십시오**.
  - 스크립트 실행, 데이터 재빌드, 리팩토링, 스타일 수정 시에도 사용자의 커스텀 이미지 파일과 파일명, 경로를 그대로 유지해야 합니다.

### 2. 데이터 빌더 및 스크립트 실행 시 커스텀 이미지 경로 보호
- `src/scripts/` 내의 파서 및 데이터 빌더(`3_build_data.py`, `5_build_series_page_data.py` 등) 실행 시:
  - `Series.json`, `HOF.json`, `MoonHakdata.json` 등 DB에 사용자가 수동으로 매핑해 둔 시리즈 대표 이미지(`image` 필드) 또는 로고 경로가 존재할 경우, 이를 크롤링 기본 이미지로 덮어쓰지 말고 **기존 커스텀 이미지 경로를 반드시 보존**하십시오.

### 3. HTML / CSS / JS 내 이미지 연결 보호
- `<img>` 태그(`src`, `data-light-src`, `data-dark-src`), CSS `background-image`, JS 렌더링 코드 등에서 사용자가 지정한 에셋 연결을 사용자의 명시적인 지시 없이 임의로 수정하거나 기본값으로 변경하지 마십시오.

---

## 🏷️ 태그 시스템 수칙
- `장문` 태그는 모두 `소설`로 통합되었습니다 (`.agent/rules/tag.md` 참조).
- `판타지`, `SF`, `미스테리`, `AI` 태그는 사용하지 않습니다.
- `로카`, `IF 스토리` 태그는 **사용자 수동 지정 전용**입니다 (AI 자동 부여 절대 금지).

---

## 🌓 테마 (Dark / Light Mode) 수칙
- 테마 전환 시 `theme.js`와 `theme.css`를 기반으로 작동합니다.
- 명예관 헤더 로고는 `data-light-src`(`명예관_Dark.png`)와 `data-dark-src`(`명예관_Light.png`)로 자동 전환됩니다.
- 카드 및 팝업 이미지 배경 속성은 `background-color`를 사용하여 `background-size: cover;`가 리셋되지 않도록 유지해야 합니다.
