# 📚 CPK_Literature_Site (초카구야 공주 갤러리 문학 아카이브)

디시인사이드 **초카구야 공주 갤러리(`chokaguyahime`)**의 창작 문학, 연재 시리즈, 명예의 전당, 대회 출품작을 수집하고 정밀하게 분류하여 감상할 수 있는 **정적 웹 아카이브 플랫폼**입니다.

---

## 🌟 주요 기능 및 특징

- 🏷️ **맥락 중심 정밀 태그 시스템**
  - **분량 태그**: `짧문` (1,000자 미만), `소설` (5,000자 이상), `단편` (3화 이하 시리즈), `장편` (10화 이상 시리즈)
  - **장르/감정선 태그**: `감동`, `슬픔`, `로맨스`, `피폐`, `코미디`, `일상` 등 핵심 서사 기준 최대 2~3개 정밀 부여
  - **특수 태그**: `🏆 명예관`, `🎯 대회`, `🌸 로카` (수동 전용)
- 📖 **다양한 뷰어 및 섹션**
  - **문학 전체 보기**: 단편 및 일반 문학 모아보기
  - **시리즈 문학 (`seriesPage`)**: 다회차 연재 시리즈 전용 카드 및 회차 뷰어
  - **명예의 전당 (`HOFPage`)**: 우수 추천 작품 전용 뷰어
  - **문학 대회 (`대회`)**: 일문대, 카문대, 카백대 등 역대 갤러리 문학 대회 출품작 분류
- 🔍 **실시간 검색 & 태그 필터링**: 제목, 작가, 장르 태그별 즉각적인 필터링 지원
- 🌓 **다크 / 라이트 모드 (Theme Engine)**: 테마 맞춤 UI 및 전용 에셋 자동 전환
- ☁️ **Cloudflare R2 스토리지 동기화**: 대용량 첨부 사진/에셋의 효율적인 CDN 서빙 및 Delta Sync 지원

---

## 📂 프로젝트 구조

```text
문학/
├── src/                         # 사이트 소스 (로컬 웹 서버의 루트)
│   ├── page/                    # HTML 페이지
│   ├── js/                      # 브라우저 JavaScript
│   │   ├── config/              # CDN·사이트·태그·라이브러리 설정
│   │   ├── core/                # 테마·저장·사용자 데이터 등 공통 기능
│   │   ├── components/          # 모달·사이드바·플레이어 등 UI
│   │   └── pages/               # 페이지별 실행 코드와 공통 목록 렌더러
│   ├── css/                     # CSS (base / layout / components / pages)
│   ├── data/
│   │   ├── config/              # 공통 JSON 설정 (사이트·색상·로딩 아이콘·팁)
│   │   ├── pageData/            # 페이지별 JSON 데이터
│   │   ├── forEvent/            # 이벤트 JSON 데이터
│   │   ├── changelog/           # 변경 내역 Markdown 및 목록 JSON
│   │   ├── notice/              # 공지 Markdown 및 목록 JSON
│   │   ├── 문학 정리/           # 문학 원문·분류 자료
│   │   ├── 번역 정리/           # 번역 원문
│   │   └── MoonHakdata.json     # 빌드 전용 통합 데이터
│   ├── scripts/                # Python 데이터 빌더·동기화 도구
│   ├── assets/                 # 커스텀 이미지 및 CDN 에셋
│   ├── audioNovel/             # 오디오 노벨 원문·이미지·음원 묶음
│   ├── fonts/                  # 폰트
│   ├── index.html              # 메인 페이지 이동 진입점
│   ├── _worker.js              # Cloudflare 요청 라우팅 진입점
│   ├── sw.js                   # 루트 범위를 사용하는 서비스 워커
│   └── wrangler.toml           # 배포 설정
├── offlineSrc/                 # 오리진에서 직접 제공하는 로고·아이콘 (빌드 시 dist/offlineSrc/ 로 복사)
├── worker/                     # 서버 JavaScript 및 D1 스키마
├── tests/                      # 보안·기능·파일 참조 회귀 검증
├── build.js                    # 배포 산출물 생성·JS 난독화
├── dist/                       # 자동 생성되는 배포 산출물
├── scratch/                    # 기존 일회성 작업 스크립트
├── .agent/                     # 작업 규칙 및 분류 가이드
├── AGENTS.md                   # 프로젝트 작업 수칙
└── README.md
```

HTML에는 화면 구조를, JS에는 실행 코드를, CSS에는 스타일을 둡니다. JSON은
`data/config`와 `data/pageData`에서 관리합니다. 데이터 빌더가 사용하는 원문,
공지의 Markdown·목록 JSON, 오디오 노벨의 음원·메타데이터는 기능 단위로 함께
보관합니다. 이미지와 CDN 경로는 유지합니다. `dist/`는 직접 수정하지 않습니다.

자주 수정하는 파일:

- 사이트 이름·버전: `src/data/config/SiteConfig.json`
- 색상 설정: `src/data/config/ColorTheme.json`
- 로딩 팁: `src/data/config/Tip.json`
- 메인 화면: `src/page/mainPage.html`, `src/js/pages/mainPage.js`
- 공통 모달: `src/js/components/`, `src/css/components/`
- API: `worker/favoritesShareWorker.js`, `worker/statsApi.js`

---

## 🚀 실행 및 빌드 방법

### 1. 로컬 웹 서버 실행
정적 JSON 데이터를 `fetch()`로 로드하므로 로컬 웹 서버 환경에서 실행합니다.

```bash
cd src
python -m http.server 8000
```
브라우저에서 `http://localhost:8000`으로 접속하여 사이트를 확인합니다.

로고·아이콘·파비콘은 `src/` 밖의 `offlineSrc/`에 있어서 위 서버로는 보이지 않습니다.
이 파일들까지 확인하려면 `npm run build -- --loose`로 `dist/`를 만든 뒤
`python -m http.server 8000 --directory dist`로 띄웁니다.

---

### 2. 데이터 빌드 파이프라인
마크다운 데이터가 추가되거나 태그가 갱신되었을 때 아래 스크립트를 순서대로 실행하여 사이트 데이터를 재생성합니다.

```bash
cd src/scripts

# 1. 크롤링 배치 / 명예관 / 대회 마크다운 파싱
python 1_parse_crawl.py

# 2. 시리즈 마크다운 파싱
python 2_parse_series.py

# 3. 통합 MoonHakdata.json 빌드 (data/문학 정리/태그보정.md 의 태그 교체가 여기서 반영됨)
python 3_build_data.py

# 4. 시리즈 페이지용 Series.json 데이터 빌드
python 5_build_series_page_data.py

# 5. 문학 페이지용 Novel.json 데이터 빌드
python 7_build_novel_page_data.py

# 6. 메인 페이지용 Recent.json 데이터 빌드 (4·5의 결과에서 최신 10+10건만 추림)
python 8_build_recent_page_data.py
```

> 데이터를 다시 빌드했으면 `src/js/config/cdnConfig.js` 의 `DATA_VERSION` 을 올려야
> 브라우저가 새 JSON 을 받아 갑니다.

---

### 3. Cloudflare R2 에셋 동기화
새로 추가된 사진 및 에셋을 CDN 스토리지에 동기화할 때 실행합니다.

```bash
python src/scripts/sync_to_r2.py
```

---

## 🚨 개발 및 유지보수 핵심 수칙

1. **커스텀 에셋 영구 보존 (`AGENTS.md` 참조)**
   - `src/assets/image/` 내 사용자가 직접 제작하거나 배치한 커스텀 로고, 배너, 커버 이미지는 스크립트 실행이나 리팩토링 시 **절대 덮어쓰거나 기본 크롤링 이미지로 롤백하지 않습니다.**
2. **본문 파싱 고립성 (`.agent/rules/crawling.md` 참조)**
   - 게시글 수집 시 오직 순수 본문 구획(`<div class="write_div">`)만 격리 추출하여 댓글/광고 등의 텍스트 혼입을 원천 차단합니다.
3. **태그 체계 무결성 유지 (`.agent/rules/tag.md` 참조)**
   - 태그 부여 전 `.agent/tag_example/` 레퍼런스 예시를 벤치마킹하고, 키워드 기계적 매칭이 아닌 **전체 서사/맥락 중심**으로 분류합니다.
   - `로카`는 사용자 직접 수동 지정 전용 태그입니다.
