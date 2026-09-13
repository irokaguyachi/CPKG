# 사이트 소스 안내

- `page/`: HTML
- `js/config/`: CDN·사이트·태그 등 설정 코드
- `js/core/`: 테마·저장·사용자 데이터 등 공통 기능
- `js/components/`: 모달·사이드바·플레이어 등 UI 동작
- `js/pages/`: 페이지별 실행 코드
- `css/`: 스타일 (base / layout / components / pages)
- `data/config/`: 공통 JSON 설정
- `data/PageData/`: 페이지별 JSON
- `scripts/`: Python 데이터 처리 도구

서버 API와 접속자 집계 코드는 저장소 루트의 `worker/`에 있습니다.
`_worker.js`는 그 모듈을 연결하는 요청 라우터입니다.
`index.html`, `sw.js`, `wrangler.toml`, `_headers`, `.assetsignore`,
`manifest.webmanifest`, `robots.txt`는 진입점·루트 범위·배포 설정을 위해
이 위치를 유지합니다.

이미지, 로고, 음원, 원문과 CDN 경로는 유지합니다. 공지·변경 내역의 Markdown과
목록 JSON, 오디오 노벨의 미디어와 메타데이터는 각각 기능 단위로 묶습니다.

## 로컬 확인

저장소 루트에서 실행합니다.

```bash
python -m http.server 8000 --directory src
npm test
npm run build
```

빌드는 `src/`를 `dist/`로 복사하고 `js/` 하위 폴더까지 재귀적으로
난독화합니다. 서버 코드는 난독화하지 않습니다. 생성된 `dist/`는 직접
수정하지 마세요. 데이터 변경 뒤에는 다음 명령으로 캐시 버전을 갱신합니다.

```bash
python src/scripts/10_update_data_version.py
```

전체 데이터 빌드 순서와 폴더 설명은 [프로젝트 README](../README.md),
배포·브랜치 규칙은 [AGENTS.md](../AGENTS.md)를 참고하세요.
