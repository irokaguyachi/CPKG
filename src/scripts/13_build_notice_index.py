# -*- coding: utf-8 -*-
"""
공지사항 인덱스 생성 스크립트 (13_build_notice_index.py)
- src/data/notice/ 아래의 .md 파일들을 스캔해 src/data/notice/index.json 을
  만듭니다. 12_build_changelog_index.py 와 같은 이유로(정적 사이트라 브라우저가
  폴더 목록을 직접 읽을 수 없음) 인덱스 파일 하나로만 어떤 공지가 있는지 압니다.
- .md 파일 형식(첫 줄에 헤더, 그 아래가 본문) — 업데이트 로그와 달리 버전이
  없습니다:
    # <YYYY-MM-DD> - <제목>

    본문은 마크다운. changelogPage.js 가 렌더링합니다(업데이트 로그와 공지사항이
    같은 페이지의 두 탭이라 렌더러를 공유합니다).
- index.json 에는 본문을 복사해 넣지 않습니다 — 목록(날짜/제목/파일명)만 담은
  가벼운 인덱스이고, 본문은 상세를 열 때 그 항목의 .md 파일을 그때그때 fetch해서
  읽습니다.
- 정렬: 날짜 내림차순(최신이 먼저).
- 새 .md 파일을 추가/수정한 뒤에는 이 스크립트를 다시 돌리고, 배포에 반영하려면
  src/js/cdnConfig.js 의 DATA_VERSION 도 올리세요(10_update_data_version.py).
"""
import json
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
NOTICE_DIR = os.path.join(HERE, "..", "data", "notice")
OUT_PATH = os.path.join(NOTICE_DIR, "index.json")

HEADER_RE = re.compile(r"^#\s*(\d{4}-\d{2}-\d{2})\s*-\s*(.+?)\s*$")


def parse_file(name, path):
    with open(path, encoding="utf-8") as f:
        first_line = f.readline()

    m = HEADER_RE.match(first_line.rstrip("\n"))
    if not m:
        print("  ! 첫 줄 헤더 형식이 아님(# YYYY-MM-DD - 제목), 건너뜀:", name)
        return None

    date, title = m.group(1), m.group(2)
    return {"date": date, "title": title, "file": name}


def main():
    if not os.path.isdir(NOTICE_DIR):
        os.makedirs(NOTICE_DIR, exist_ok=True)

    entries = []
    for name in sorted(os.listdir(NOTICE_DIR)):
        if not name.endswith(".md"):
            continue
        entry = parse_file(name, os.path.join(NOTICE_DIR, name))
        if entry:
            entries.append(entry)

    entries.sort(key=lambda e: e["date"], reverse=True)

    with open(OUT_PATH, "w", encoding="utf-8", newline="\n") as f:
        json.dump(entries, f, ensure_ascii=False, indent=2)

    print("wrote", os.path.normpath(OUT_PATH))
    print("  %d개의 공지사항 항목을 담았습니다." % len(entries))
    print("  ※ 배포 반영하려면 src/scripts/10_update_data_version.py 를 실행해서 DATA_VERSION 을 올리세요.")


if __name__ == "__main__":
    main()
