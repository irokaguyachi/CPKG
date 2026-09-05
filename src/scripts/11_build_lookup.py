# -*- coding: utf-8 -*-
"""
북마크 조회 인덱스 생성 스크립트 (11_build_lookup.py)
- Novel.json / Series.json / HOF.json / Official.json 을 합쳐 Lookup.json 을
  만듭니다. bookmarksPage.js 는 북마크(내 북마크·라이브러리) 상세를 열 때마다
  "이 id가 어느 항목이었는지"를 알아야 하는데, 예전엔 그것 하나 때문에
  4개 파일(약 778KB)을 통째로 fetch했습니다(TRAFFIC_SECURITY_AUDIT_2.md N-T6).
  카드가 실제로 쓰는 필드(name/image/posts/charCount/tags)만 남기고 author
  등은 뺀 경량 인덱스로 대신합니다. tags는 postDetailSeries.js의 "공식 태그"
  줄이 북마크 상세 팝업에서도 떠야 해서 포함합니다(문자열 몇 개뿐이라
  author처럼 크기 부담이 크지 않습니다).
- 대표 게시물 id(posts[0].id, bookmarksPage.js 가 "대표게시물id"라 부르는 값)를
  키로 삼아 { type: { id: 항목 } } 모양으로 담습니다 — bookmarksPage.js 의
  기존 loadItemLookup() 이 4개 파일에서 매번 만들어 쓰던 것과 같은 모양이라
  그쪽 코드는 조회 방식을 바꿀 필요가 없습니다.
- charCount 는 SeriesUtil.countLine() 이 "posts 가 1개일 때만" 읽으므로,
  시리즈(posts 2개 이상)인 항목은 아예 뺍니다.

⚠️ 이 스크립트는 원본 4개 파일을 읽기만 하며, image 경로를 포함해 어떤 필드도
   가공하지 않고 그대로 복사합니다(CLAUDE.md 최우선 규칙).
⚠️ 반드시 3/5/7번(문학·시리즈 계열 PageData 빌드)을 먼저 돌린 뒤에 실행하세요.
   그리고 결과를 배포에 반영하려면 10_update_data_version.py 로
   DATA_VERSION 을 올려야 브라우저 캐시가 깨집니다.
"""
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE_DATA_DIR = os.path.join(HERE, "..", "data", "PageData")
OUT_PATH = os.path.join(PAGE_DATA_DIR, "Lookup.json")

# bookmarksPage.js 의 기존 SECTIONS 와 동일한 (type, 파일명) 목록.
SOURCES = [
    ("novel", "Novel.json"),
    ("series", "Series.json"),
    ("hof", "HOF.json"),
    ("official", "Official.json"),
]


def load_list(path):
    """PageData JSON 하나를 리스트로 읽습니다. 없거나 깨졌으면 빈 리스트."""
    if not os.path.exists(path):
        print("  ! 없음:", os.path.normpath(path))
        return []
    try:
        data = json.load(open(path, encoding="utf-8"))
    except ValueError:
        print("  ! 깨진 JSON:", os.path.normpath(path))
        return []
    return data if isinstance(data, list) else []


def slim_entry(item, item_type):
    posts = item.get("posts") or []
    slim_posts = [
        {
            "id": p.get("id"),
            "title": p.get("title"),
            "episode": p.get("episode"),
            "link": p.get("link"),
        }
        for p in posts
    ]
    entry = {
        "name": item.get("name"),
        "image": item.get("image"),
        "posts": slim_posts,
    }
    # postDetailSeries.js는 favType === 'novel'일 때만 태그 줄을 그린다 —
    # series/hof/official에까지 넣으면 아무도 안 읽는 필드로 용량만 늘어난다.
    if item_type == "novel" and item.get("tags"):
        entry["tags"] = item["tags"]
    if len(posts) <= 1 and item.get("charCount"):
        entry["charCount"] = item["charCount"]
    return entry


def main():
    lookup = {}
    src_bytes = 0
    total_items = 0
    for item_type, filename in SOURCES:
        path = os.path.join(PAGE_DATA_DIR, filename)
        if os.path.exists(path):
            src_bytes += os.path.getsize(path)
        items = load_list(path)
        by_id = {}
        skipped = 0
        for item in items:
            posts = item.get("posts") or []
            pid = posts[0].get("id") if posts else None
            if pid is None:
                skipped += 1
                continue
            by_id[str(pid)] = slim_entry(item, item_type)
        lookup[item_type] = by_id
        total_items += len(by_id)
        print("  %s: %d개 항목 중 %d개 수록%s"
              % (filename, len(items), len(by_id),
                 " (대표 게시물 없음 %d개 제외)" % skipped if skipped else ""))

    os.makedirs(PAGE_DATA_DIR, exist_ok=True)
    # 다른 PageData 산출물과 달리 들여쓰기 없이 압축해서 씁니다 — 사람이 diff로
    # 읽을 파일이 아니라 매 북마크 상세 진입마다 그대로 전송되는 파일이라,
    # 공백만으로도 무시 못 할 크기 차이가 났습니다(같은 내용 기준 약 30% 차이).
    with open(OUT_PATH, "w", encoding="utf-8", newline="\n") as f:
        json.dump(lookup, f, ensure_ascii=False, separators=(",", ":"))

    out_kb = os.path.getsize(OUT_PATH) / 1024
    src_kb = src_bytes / 1024
    print("wrote", os.path.normpath(OUT_PATH))
    print("  총 %d개 항목, %.1fKB -> %.1fKB (%.1fKB 절감, 북마크 상세 진입 시마다)"
          % (total_items, src_kb, out_kb, src_kb - out_kb))
    print("  ※ 배포 반영하려면 10_update_data_version.py 로 DATA_VERSION 을 올리세요.")


if __name__ == "__main__":
    main()
