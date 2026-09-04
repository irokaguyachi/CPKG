# 초카구야공주 문학 아카이브 (사이트 소스)

`index.html` + `main.css` + `main.js` + `data/MoonHakdata.json` 등으로 구성된 정적 웹 아카이브입니다.
`fetch()`로 정적 JSON 데이터를 불러오므로 로컬에서 열 때는 `file://`로 직접 열지 말고 로컬 서버를 띄워서 확인하세요.

```bash
cd src
python -m http.server 8000
# http://localhost:8000 접속
```

## 🛠️ 사이트 데이터 재생성 (빌드 파이프라인)

`data/문학 정리/` 및 크롤링 마크다운이 갱신되면 아래 순서로 실행해 사이트용 JSON 데이터를 갱신합니다.

```bash
cd src/scripts
python 1_parse_crawl.py            # 크롤링 파일 + 명예관 + 대회 → crawl_entries.json
python 2_parse_series.py           # 시리즈 마크다운 → series_entries.json
python 3_build_data.py             # 통합 MoonHakdata.json 생성
python 5_build_series_page_data.py # 시리즈 페이지 전용 Series.json 생성
python 7_build_novel_page_data.py  # 문학 페이지 전용 Novel.json 생성
python 8_build_recent_page_data.py # 메인 페이지 전용 Recent.json 생성 (최신 10+10건)
```

> 빌드 후 `js/cdnConfig.js` 의 `DATA_VERSION` 을 올려야 브라우저 캐시가 갱신됩니다.

## ☁️ Cloudflare R2 에셋 동기화

신규 사진/에셋이 추가되었을 때 R2 스토리지로 델타 동기화합니다.

```bash
python src/scripts/sync_to_r2.py
```

## 🔒 배포 (JS 난독화 빌드)

실제 사이트(cpkg.cloud)에 방문자가 원본 `src/js/*.js`를 그대로 받아가지
않도록, 배포 전 저장소 루트의 `build.js`가 `src/` 전체를 `dist/`로 복사하고
`dist/js/*.js`만 난독화합니다. `src/`는 계속 가독성 있는 개발용 소스로 남고,
`dist/`는 매 빌드마다 새로 생성되는 산출물이라 git에 커밋하지 않습니다.

```bash
# 저장소 루트에서 최초 1회
npm install

# 빌드 + 배포
npm run deploy
# == npm run build (src/ -> dist/, dist/js 난독화) 후 dist/에서 wrangler deploy

# 빌드만 하고 결과를 직접 확인하고 싶을 때
npm run build
cd dist && python -m http.server 8000   # http://localhost:8000 에서 난독화된 빌드를 직접 확인
```

> `_worker.js` / `statsApi.js` / `presenceDO.js`는 Cloudflare Workers 엣지에서만
> 실행되고 브라우저로 내려가지 않으므로 난독화 대상이 아닙니다.

