# 초카구야공주 문학 아카이브 (사이트 소스)

`index.html` + `style.css` + `script.js` + `data.json`으로 구성된 정적 사이트입니다.
`fetch()`로 `data.json`을 불러오므로 로컬에서 열 때는 `file://`로 직접 열지 말고 간단한 로컬 서버로 띄워서 확인하세요.

```
cd src
python -m http.server 8000
# http://localhost:8000 접속
```

## data.json 재생성

`문학 정리/` 아래 원본 마크다운이 갱신되면 아래 순서로 다시 실행해 `data.json`을 갱신합니다.

```
cd src/scripts
python 1_parse_crawl.py    # 크롤링 파일 + 명예관 + 대회 → crawl_entries.json
python 2_parse_series.py   # 시리즈 → series_entries.json
python 3_build_data.py     # 위 둘을 합쳐 ../data.json 생성
```
