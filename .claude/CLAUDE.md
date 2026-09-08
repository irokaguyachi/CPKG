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

## 🌓 테마 (Dark / Light Mode) 수칙

- 테마 전환 시 `theme.js`와 `theme.css`를 기반으로 작동합니다.
- 명예관 헤더 로고는 `data-light-src`(`명예관_Dark.png`)와 `data-dark-src`(`명예관_Light.png`)로 자동 전환됩니다.
- 카드 및 팝업 이미지 배경 속성은 `background-color`를 사용하여 `background-size: cover;`가 리셋되지 않도록 유지해야 합니다.

---

## 🚀 [필수 준수] 배포 및 브랜치 규칙

이 사이트는 GitHub 저장소 `irokaguyachi/CPKG` 에 연결된 Cloudflare Workers Builds 로 배포되며, 세 브랜치의 역할이 서로 완전히 다릅니다.

### 1. 브랜치 역할

| 브랜치 | 역할 |
| --- | --- |
| `main` | 사용자가 실제로 작업하는 공간입니다 (작업 브랜치). |
| `dev` | 만든 기능을 서버에서 직접 확인하는 테스트 빌드입니다. |
| `release` | 유저들이 실제로 보는 프로덕션 빌드입니다. |

테스트 빌드는 `cpkg-dev` 워커(`*.workers.dev`), 프로덕션 빌드는 `cpkg` 워커(`cpkg.cloud`)로 나갑니다. 브랜치와 Workers Build 트리거의 연결은 Cloudflare 대시보드의 각 워커 `Settings → Build` 에서 관리합니다.

### 2. 커밋·푸시 가드레일 (절대 준수)

- **AI 에이전트는 사용자가 커밋이나 푸시를 명시적으로 요청했을 때만** 그 작업을 수행합니다. 소작업마다 자동으로 커밋하지 않습니다.
- **커밋·푸시 대상은 언제나 `main` 브랜치 하나뿐입니다.** `dev` 와 `release` 는 사용자가 직접 허락하거나 먼저 언급했을 때만 건드립니다. AI 가 "dev 에도 반영할까요?" 처럼 먼저 제안하지도 않습니다.
- `dev` 나 `release` 에 반영하라는 지시를 받은 시점에만 해당 브랜치를 정리합니다. fast-forward 가 가능하면 `git merge main --ff-only` 를 사용하고, 브랜치 고유 커밋 때문에 막히면 그 커밋의 내용을 확인한 뒤 사용자에게 물어보고 진행합니다.
- **스테이징은 반드시 경로를 명시합니다.** `git add -A` 와 `git add .` 는 사용하지 않습니다 (무관한 변경이 함께 커밋되어 사고가 난 이력이 있습니다).
- **`wrangler deploy` 와 `npm run deploy` 계열 명령을 AI 가 직접 실행하지 않습니다.** 필요한 명령을 안내하고, 실제 배포 실행 여부는 사용자가 판단합니다.

### 3. 배포로 이어질 변경 점검 체크리스트

- **데이터 버전**: `src/scripts/` 빌드 스크립트로 JSON 데이터를 다시 생성했다면 `src/js/cdnConfig.js` 의 `DATA_VERSION` 을 올려야 브라우저가 새 데이터를 받아 갑니다.
- **JS 난독화 (fail-closed)**: `npm run build` 는 `src/` 를 `dist/` 로 복사한 뒤 `dist/js/**/*.js` 만 난독화합니다. `src/js/*.js` 에 문법 오류가 있어 난독화가 깨지면 종료 코드 1 로 빌드가 실패하고, Workers Builds 도 그 시점에 배포를 중단합니다. 로컬에서 산출물만 확인할 때에 한해 `npm run build -- --loose` 를 사용합니다.
- **엣지 전용 코드**: `_worker.js` 와 `statsApi.js`, `presenceDO.js` 는 Cloudflare 엣지에서만 실행되고 브라우저로 내려가지 않으므로 난독화 대상이 아닙니다. 난독화를 이유로 이 파일들의 구조를 바꾸지 않습니다.
- **D1 스키마**: `cpkg-tags` D1 의 스키마(`worker/tags_schema.sql`)를 변경했다면 원격에 먼저 적용해야 합니다. `npx wrangler d1 execute cpkg-tags --remote --file=worker/tags_schema.sql`
- **시크릿**: 새 시크릿(`STATS_ADMIN_TOKEN`, `CF_ANALYTICS_TOKEN` 등)이 필요하면 `npx wrangler secret put <이름>` 으로 주입합니다. 토큰이나 키를 코드나 `wrangler.toml` 에 하드코딩하지 않습니다.
- **dev 환경 라우트**: `wrangler.toml` 의 `[env.dev]` 블록에서 `routes = []` 가 비어 있어야 합니다. 이 값을 비우지 않으면 `dev` 배포가 `cpkg.cloud` 커스텀 도메인을 프로덕션에서 가져가 버립니다.
- **커스텀 에셋**: 위 최우선 수칙 그대로, 빌드와 배포 과정에서도 사용자 커스텀 이미지·에셋을 기본값이나 크롤링 원본으로 되돌리지 않습니다.

### 4. 로컬 배포 명령 (사용자가 직접 실행)

```bash
npm run build        # dist/ 생성 + 난독화. 원본 JS 가 남으면 exit 1
npm run deploy       # build 후 npx wrangler deploy --config dist/wrangler.toml  (cpkg)
npm run deploy:dev   # 위와 동일하되 --env dev  (cpkg-dev)
```

Workers Builds 를 사용할 때 각 워커의 Build 명령은 `npm run build`, Deploy 명령은 `npx wrangler deploy --config dist/wrangler.toml`(dev 워커는 `--env dev` 추가), Root directory 는 저장소 루트로 맞춥니다.

---

## 📝 [필수 준수] 커밋 메시지 규칙

이 프로젝트에서 git 커밋을 생성할 때는(사용자가 명시적으로 커밋을 요청한 경우) **예외 없이** 아래 컨벤션을 따라야 합니다.

### 기본 구조

커밋 메시지는 제목(Header) / 본문(Body) / 바닥글(Footer) 3개 파트로 구성하며, 제목 외 영역은 선택 사항입니다.

```
<type>(<scope>): <subject>

<body>

<footer>
```

### 1. 타입(Type) 분류

- `feat`: 새로운 기능 추가
- `fix`: 버그 수정
- `refactor`: 버그 수정이나 기능 추가 없이 코드 구조만 개선
- `perf`: 성능 향상을 위한 코드 변경
- `style`: 코드 동작에 영향 없는 포맷팅, 세미콜론 누락, 공백 수정
- `docs`: 문서 수정 (README, 주석, 위키 등)
- `test`: 테스트 코드 추가 또는 기존 테스트 수정
- `chore`: 빌드 업무 수정, 패키지 매니저 설정, 기타 자잘한 작업
- `ci`: CI/CD 설정 파일 및 스크립트 변경 (GitHub Actions 등)

### 2. 작성 규칙

- **커밋 메시지는 무조건 한국어로 작성**합니다.
- 제목(Subject)
  - 50자 내외로 간결하게 작성하며 마침표(`.`)를 찍지 않습니다.
  - 명확한 명사형 종결이나 간결한 서술형을 유지합니다 (`~ 수정`, `~ 추가` 등).
- 스코프(Scope, 선택)
  - 변경된 모듈이나 범위를 괄호 안에 표기합니다 (`feat(auth): ...`, `fix(ui): ...`).
- 본문(Body, 선택)
  - "무엇을 어떻게"보다는 **"왜(Why)" 변경했는지**를 72자 줄바꿈 규칙에 맞춰 설명합니다.
- 바닥글(Footer, 선택)
  - 이슈 트래킹 번호나 Breaking Changes(주요 하위 호환성 깨짐)를 명시합니다 (예: `Resolves: #42`, `BREAKING CHANGE: ...`).

