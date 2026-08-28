# -*- coding: utf-8 -*-
"""
공지사항 인덱스 생성 스크립트 (13_build_notice_index.py)
- src/data/notice/ 아래의 .md 파일들을 스캔해 src/data/notice/index.json 을
  만듭니다. 12_build_changelog_index.py 와 같은 이유로(정적 사이트라 브라우저가
  폴더 목록을 직접 읽을 수 없음) 인덱스 파일 하나로만 어떤 공지가 있는지 압니다.
- .md 파일 형식(첫 줄에 헤더, 그 아래가 본문) — 업데이트 로그의 "버전" 자리에
  "카테고리"가 들어간다는 점만 다르고 구조는 같습니다:
    # <카테고리> - <YYYY-MM-DD> - <제목>

  예) # 이벤트 - 2026-08-28 - 이벤트 진행중!
      # 공지 - 2026-08-28 - 서버 점검 안내

- 진행 상태(진행중/예정/종료)는 이벤트류 공지에만 해당하는 선택 필드라
  헤더에 안 넣고, 헤더 바로 다음 줄에 있으면만 읽습니다(없으면 그냥 본문
  시작):
    status: 진행중

  일반 공지는 이 줄 자체를 안 넣으면 됩니다 — status 없이도 정상 동작합니다.
- index.json 에는 본문을 복사해 넣지 않습니다 — 목록(카테고리/날짜/제목/
  상태/파일명)만 담은 가벼운 인덱스이고, 본문은 상세를 열 때 그 항목의
  .md 파일을 그때그때 fetch해서 읽습니다.
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

HEADER_RE = re.compile(r"^#\s*(.+?)\s*-\s*(\d{4}-\d{2}-\d{2})\s*-\s*(.+?)\s*$")
STATUS_RE = re.compile(r"^status:\s*(진행중|예정|종료)\s*$")
STATUS_VALUES = {"진행중", "예정", "종료"}


def parse_file(name, path):
    with open(path, encoding="utf-8") as f:
        first_line = f.readline()
        second_line = f.readline()

    m = HEADER_RE.match(first_line.rstrip("\n"))
    if not m:
        print("  ! 첫 줄 헤더 형식이 아님(# 카테고리 - YYYY-MM-DD - 제목), 건너뜀:", name)
        return None

    category, date, title = m.group(1), m.group(2), m.group(3)
    entry = {"category": category, "date": date, "title": title, "file": name}

    sm = STATUS_RE.match(second_line.strip())
    if sm:
        entry["status"] = sm.group(1)

    return entry


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

    with_status = sum(1 for e in entries if "status" in e)
    print("wrote", os.path.normpath(OUT_PATH))
    print("  %d개의 공지사항 항목을 담았습니다 (그중 진행 상태 있음 %d개)." % (len(entries), with_status))
    print("  ※ 배포 반영하려면 src/scripts/10_update_data_version.py 를 실행해서 DATA_VERSION 을 올리세요.")


if __name__ == "__main__":
    main()
