# -*- coding: utf-8 -*-
import json, os, re, sys
sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(__file__)

crawl = json.load(open(os.path.join(HERE, "crawl_entries.json"), encoding="utf-8"))
series = json.load(open(os.path.join(HERE, "series_entries.json"), encoding="utf-8"))

# ---- 태그 보정 (문학 정리/태그보정.md) ----
# 크롤링 원문 태그가 잘못 붙은 글을 사람이 바로잡는 유일한 자리입니다.
# 표 한 줄이 게시물 하나의 태그를 통째로 교체합니다(추가가 아니라 교체이며,
# 태그 칸을 비워 두면 그 글의 태그를 전부 지운다는 뜻입니다).
corrections_path = os.path.join(HERE, "..", "data", "문학 정리", "태그보정.md")
tag_overrides = {}
if os.path.exists(corrections_path):
    row_re = re.compile(r"^\|\s*(\d+)\s*\|([^|]*)\|", re.MULTILINE)
    for m in row_re.finditer(open(corrections_path, encoding="utf-8").read()):
        pid = int(m.group(1))
        tag_overrides[pid] = [t.strip() for t in m.group(2).split(",") if t.strip()]

posts = [
    {
        "id": e["id"],
        "title": e["title"],
        "tags": tag_overrides.get(e["id"], e["tags"]),
        "chars": e["chars"],
        "author": e["author"],
    }
    for e in crawl
]

# series: tagline 문자열 앞머리의 "[ ... ]" 를 태그 배열로 승격합니다.
# 예전에는 이 문자열을 그대로 실어 두고 5_build_series_page_data.py 가
# 매번 정규식으로 앞부분만 뜯어냈는데, 그 파싱을 여기로 옮겨 한 번만 합니다.
LEADING_TAG_RE = re.compile(r"^\[([^\]]*)\]")


def parse_series_tags(tagline):
    m = LEADING_TAG_RE.match(tagline or "")
    if not m:
        return []
    return [t.strip() for t in m.group(1).split(",") if t.strip()]


series_out = [
    {
        "name": s["name"],
        "tags": parse_series_tags(s["tagline"]),
        "count": s["count"],
        "chapters": [
            {"id": c["id"], "title": c["title"], "episode": c["num"]}
            for c in s["chapters"]
        ],
    }
    for s in series
]

# ---- 유저 인기 태그 후보 (문학 정리/유저인기태그후보.md) ----
# 공식 태그(AI 장르 분류)는 그대로 유지하고, 그 위에 얹는 유저 투표 레이어의
# 후보 목록만 사람이 이 파일에서 직접 정한다(하드코딩하지 않음). 신규 제안이
# 없는 구조라 여기 적힌 것만 후보가 되고, 안 적힌 건 후보가 아니다.
catalog_path = os.path.join(HERE, "..", "data", "문학 정리", "유저인기태그후보.md")
user_tag_catalog = []
if os.path.exists(catalog_path):
    catalog_text = open(catalog_path, encoding="utf-8").read()
    # "## 후보 목록" 헤딩 아래의 "- 태그" 줄만 대상으로 삼는다 — 그 위
    # 설명 문단도 마크다운 리스트(-)를 쓰므로, 헤딩으로 구획을 나누지
    # 않으면 설명 문장까지 태그로 잘못 파싱된다.
    heading_m = re.search(r"^##\s*후보\s*목록\s*$", catalog_text, re.MULTILINE)
    list_text = catalog_text[heading_m.end():] if heading_m else catalog_text
    line_re = re.compile(r"^-\s*(.+?)\s*$", re.MULTILINE)
    user_tag_catalog = [m.group(1) for m in line_re.finditer(list_text)]

bundle = {"posts": posts, "series": series_out}
out_path = os.path.join(HERE, "..", "data", "MoonHakdata.json")
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(bundle, f, ensure_ascii=False, indent=2)
size = os.path.getsize(out_path)
print("posts:", len(posts), "series:", len(series_out), "bytes:", size)
print("tag overrides applied:", sum(1 for e in crawl if e["id"] in tag_overrides),
      "of", len(tag_overrides), "rows in 태그보정.md")
print("user tag catalog:", len(user_tag_catalog), "개 —", user_tag_catalog)

catalog_out = os.path.join(HERE, "..", "data", "pageData", "UserTagCatalog.json")
os.makedirs(os.path.dirname(catalog_out), exist_ok=True)
with open(catalog_out, "w", encoding="utf-8", newline="\n") as f:
    json.dump(user_tag_catalog, f, ensure_ascii=False, indent=2)
    f.write("\n")

# ---- loading screen icon manifest ----
# offlineSrc/ 는 src/ 밖(저장소 루트)에 있고, build.js 가 dist/ 로 복사해 서빙한다.
icon_dir = os.path.join(HERE, "..", "..", "offlineSrc", "loadingLogo")
icon_exts = (".png", ".jpg", ".jpeg", ".gif", ".webp")
icons = sorted(f for f in os.listdir(icon_dir) if f.lower().endswith(icon_exts)) if os.path.isdir(icon_dir) else []
icons_out = os.path.join(HERE, "..", "data", "config", "LoadingIcons.json")
with open(icons_out, "w", encoding="utf-8") as f:
    json.dump(icons, f, ensure_ascii=False, indent=2)
print("loading icons:", len(icons))
