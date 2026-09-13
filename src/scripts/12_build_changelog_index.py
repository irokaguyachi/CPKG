# -*- coding: utf-8 -*-
"""
업데이트 로그 인덱스 생성 스크립트 (12_build_changelog_index.py)
- src/data/changelog/ 아래의 .md 파일들을 스캔해 src/data/changelog/index.json
  을 만듭니다. changelogPage.html 은 정적 사이트라 브라우저가 폴더 목록을
  직접 읽을 수 없으므로, 어떤 파일이 있는지는 이 index.json 하나로만 압니다.
- .md 파일 형식(첫 줄에 헤더, 그 아래가 본문):
    # <버전> - <YYYY-MM-DD> - <제목>

    - 본문은 마크다운. changelogPage.js 가 렌더링합니다.
- index.json 에는 본문을 복사해 넣지 않습니다 — 목록(버전/날짜/제목/파일명)만
  담은 가벼운 인덱스이고, 본문은 changelogPage.js 가 상세를 열 때 그 항목의
  .md 파일을 직접 fetch 해서 읽습니다. 본문이 파일 하나에만 존재해야
  index.json 과 어긋날 일이 없습니다.
- 정렬: 날짜 내림차순(최신이 먼저), 날짜가 같으면 버전을 숫자 단위로 비교해
  내림차순.
- 새 .md 파일을 추가/수정한 뒤에는 이 스크립트를 다시 돌리고, 배포에
  반영하려면 src/js/config/cdnConfig.js 의 DATA_VERSION 도 올리세요
  (10_update_data_version.py).
"""
import json
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
CHANGELOG_DIR = os.path.join(HERE, "..", "data", "changelog")
OUT_PATH = os.path.join(CHANGELOG_DIR, "index.json")

HEADER_RE = re.compile(r"^#\s*(\S+)\s*-\s*(\d{4}-\d{2}-\d{2})\s*-\s*(.+?)\s*$")


def version_key(version):
    """'1.2.0' -> (1, 2, 0) 처럼 숫자 단위 비교가 되게 쪼갠다. 숫자가 아닌
    조각(예: '1.2.0-beta')이 섞여 있어도 죽지 않게 문자열로 남겨둔다."""
    parts = re.split(r"[.\-_]", version)
    key = []
    for p in parts:
        key.append((0, int(p))) if p.isdigit() else key.append((1, p))
    return tuple(key)


def parse_file(name, path):
    with open(path, encoding="utf-8") as f:
        first_line = f.readline()

    m = HEADER_RE.match(first_line.rstrip("\n"))
    if not m:
        print("  ! 첫 줄 헤더 형식이 아님(# 버전 - YYYY-MM-DD - 제목), 건너뜀:", name)
        return None

    version, date, title = m.group(1), m.group(2), m.group(3)
    return {"version": version, "date": date, "title": title, "file": name}


def main():
    if not os.path.isdir(CHANGELOG_DIR):
        print("! changelog 폴더가 없습니다:", os.path.normpath(CHANGELOG_DIR))
        sys.exit(1)

    entries = []
    for name in sorted(os.listdir(CHANGELOG_DIR)):
        if not name.endswith(".md"):
            continue
        entry = parse_file(name, os.path.join(CHANGELOG_DIR, name))
        if entry:
            entries.append(entry)

    entries.sort(key=lambda e: (e["date"], version_key(e["version"])), reverse=True)

    with open(OUT_PATH, "w", encoding="utf-8", newline="\n") as f:
        json.dump(entries, f, ensure_ascii=False, indent=2)

    print("wrote", os.path.normpath(OUT_PATH))
    print("  %d개의 업데이트 로그 항목을 담았습니다." % len(entries))
    print("  ※ 배포 반영하려면 src/scripts/10_update_data_version.py 를 실행해서 DATA_VERSION 을 올리세요.")


if __name__ == "__main__":
    main()
