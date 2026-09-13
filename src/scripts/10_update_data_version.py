# -*- coding: utf-8 -*-
"""
DATA_VERSION 자동 갱신 스크립트 (10_update_data_version.py)
- src/data/ 아래에서 브라우저가 실제로 fetch하는 모든 .json 파일(PageData/,
  LoadingIcons.json, Tip.json, ForEvent/ 등)의 내용을 해시해서
  src/js/config/cdnConfig.js 의 DATA_VERSION 상수를 자동으로 갱신합니다.
  ColorTheme.json은 빌드 시점에만 쓰이고 브라우저가 직접 fetch하지 않으므로
  제외합니다(9_build_color_theme.py가 그 값을 CSS로 미리 구워냅니다).
- 데이터를 바꾸는 다른 빌드 스크립트(3, 5, 6, 7, 8번)를 전부 돌린 뒤
  마지막에 이 스크립트를 실행하세요 — 실제로 파일 내용이 바뀐 경우에만
  DATA_VERSION이 바뀌므로, 몇 번을 다시 실행해도 데이터가 그대로면
  아무것도 바뀌지 않습니다.
  (TRAFFIC_SECURITY_AUDIT_2.md N-T5 — DATA_VERSION이 수동 고정이라 캐시
  갱신을 사람이 매번 기억해야만 했던 문제를 해결합니다.)
"""
import hashlib
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "..", "data")
CDN_CONFIG_PATH = os.path.join(HERE, "..", "js", "config", "cdnConfig.js")

# 브라우저가 런타임에 fetch하지 않는 빌드 전용 JSON — 여기 넣지 않으면
# 이 파일들이 바뀔 때마다(크롤링·재빌드) 실제로 배포되는 데이터는 그대로인데도
# DATA_VERSION이 튀어서 전 사용자의 캐시가 헛되이 무효화된다.
#   - ColorTheme.json: 9_build_color_theme.py가 CSS로 미리 구워낸다.
#   - MoonHakdata.json: PageData/*.json 을 만들어내는 원본 통합 데이터셋.
#     .assetsignore 에 올라가 있어 배포조차 되지 않는다.
EXCLUDE_NAMES = {"ColorTheme.json", "MoonHakdata.json"}


def collect_json_files():
    found = []
    for root, _dirs, files in os.walk(DATA_DIR):
        for name in files:
            if not name.endswith(".json") or name in EXCLUDE_NAMES:
                continue
            path = os.path.join(root, name)
            rel = os.path.relpath(path, DATA_DIR).replace(os.sep, "/")
            found.append((rel, path))
    return sorted(found)


def compute_version():
    h = hashlib.sha256()
    for rel, path in collect_json_files():
        h.update(rel.encode("utf-8"))
        with open(path, "rb") as f:
            h.update(f.read())
    return h.hexdigest()[:12]


def main():
    version = compute_version()
    # newline="" 로 읽고 써서 cdnConfig.js 의 기존 줄바꿈(CRLF)을 그대로 둔다 —
    # 기본 텍스트 모드로 읽고 쓰면 한 줄만 고치려던 게 파일 전체를 LF 로
    # 바꿔버려서 애먼 diff 가 생긴다.
    with open(CDN_CONFIG_PATH, encoding="utf-8", newline="") as f:
        text = f.read()
    new_text, count = re.subn(
        r"var DATA_VERSION = '[^']*';",
        "var DATA_VERSION = '%s';" % version,
        text,
        count=1,
    )
    if count == 0:
        print("! cdnConfig.js에서 DATA_VERSION 선언을 못 찾았어요 — 아무것도 바꾸지 않았습니다.")
        sys.exit(1)
    if new_text == text:
        print("DATA_VERSION이 이미 최신입니다(%s) — 변경 없음." % version)
        return
    with open(CDN_CONFIG_PATH, "w", encoding="utf-8", newline="") as f:
        f.write(new_text)
    print("DATA_VERSION을 %s로 갱신했습니다." % version)


if __name__ == "__main__":
    main()
