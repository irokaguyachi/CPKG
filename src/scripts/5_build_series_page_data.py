# -*- coding: utf-8 -*-
"""
시리즈 페이지 데이터 생성 스크립트 (5_build_series_page_data.py)

⚠️ 기존 Series.json 에 사용자가 수동으로 매핑해 둔 image 경로가 있으면
   그대로 보존합니다 (CLAUDE.md 최우선 규칙). 크롤링 자동 매칭은 image 가
   비어 있는 시리즈에만 적용됩니다. (7_build_novel_page_data.py 와 동일한 패턴)
"""
import json, os, re, sys
sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(__file__)
POST_LINK_BASE = "https://gall.dcinside.com/mgallery/board/view/?id=chokaguyahime&no="
LEADING_TAG_RE = re.compile(r"^\[([^\]]*)\]")

src_path = os.path.join(HERE, "..", "data", "MoonHakdata.json")
hof_md_path = os.path.join(HERE, "..", "data", "문학 정리", "명예관", "명예관.md")
photos_dir = os.path.join(HERE, "..", "assets", "Image", "크롤링사진", "시리즈")
out_dir = os.path.join(HERE, "..", "data", "PageData")
out_path = os.path.join(out_dir, "Series.json")

data = json.load(open(src_path, encoding="utf-8"))
posts_by_id = {p["i"]: p for p in data["posts"]}

# 기존 파일의 수동 image 매핑 보존 (CLAUDE.md 최우선 규칙 —
# 7_build_novel_page_data.py 의 existing_image 패턴과 동일).
# 시리즈명이 바뀌어도 매칭되도록 이름이 아니라 대표(첫 화) 게시물 id로 키를 잡는다.
existing_image_by_first_post = {}
page_dir = os.path.join(HERE, "..", "page")
if os.path.exists(out_path):
    try:
        for entry in json.load(open(out_path, encoding="utf-8")):
            posts = entry.get("posts") or []
            pid = posts[0]["id"] if posts else None
            img = entry.get("image")
            if pid is not None and img:
                img_abs = os.path.normpath(os.path.join(page_dir, img))
                if os.path.exists(img_abs):
                    existing_image_by_first_post[pid] = img
    except (ValueError, AttributeError, KeyError, IndexError):
        pass  # 비어 있거나 깨진 파일이면 새로 만듦

# 명예관 여부의 authoritative 출처는 문학 정리/명예관/명예관.md 입니다.
# MoonHakdata 의 per-post 태그에는 일부만 반영돼 있어(73건 중 소수), 이것만
# 보고 판정하면 명예관에 오른 화를 가진 시리즈에 태그가 안 붙습니다.
hof_ids = set()
if os.path.exists(hof_md_path):
    hof_src = open(hof_md_path, encoding="utf-8").read()
    hof_ids = {int(m) for m in re.findall(r"^###\s*\[(\d+)\]", hof_src, re.M)}

series_out = []
for s in data["series"]:
    m = LEADING_TAG_RE.match(s.get("g") or "")
    tags = [t.strip() for t in m.group(1).split(",")] if m else []
    tags = [t for t in tags if t]

    # the series-level tagline doesn't carry 명예관 (it's a per-post tag),
    # so promote it to the series if any chapter was individually tagged
    if "명예관" not in tags and any(
        ch["i"] in hof_ids or "명예관" in (posts_by_id.get(ch["i"], {}).get("g") or [])
        for ch in s.get("ch", [])
    ):
        tags.append("명예관")

    posts = [
        {
            "id": ch["i"],
            "title": ch["t"],
            "episode": ch["n"],
            "link": POST_LINK_BASE + str(ch["i"]),
        }
        for ch in s.get("ch", [])
    ]

    first_post_id = posts[0]["id"] if posts else None
    series_out.append({
        "name": s["n"],
        "image": existing_image_by_first_post.get(first_post_id),
        "tags": tags,
        "posts": posts,
    })

# ---- match cover images from 크롤링사진/시리즈/<folder>/<postId>_n.ext ----
# matched by post id (not by folder/series name — names get mangled by
# filesystem-safe renaming during crawling, but post ids are exact) so a
# folder is assigned to whichever series actually contains its post ids.
id_to_series = {}
for series in series_out:
    for post in series["posts"]:
        id_to_series.setdefault(post["id"], []).append(series)

if os.path.isdir(photos_dir):
    for folder in os.listdir(photos_dir):
        folder_path = os.path.join(photos_dir, folder)
        if not os.path.isdir(folder_path):
            continue
        files = sorted(os.listdir(folder_path))

        by_id = {}
        for fn in files:
            fm = re.match(r"(\d+)_", fn)
            if fm:
                by_id.setdefault(int(fm.group(1)), fn)

        vote_counts = {}
        for pid in by_id:
            for series in id_to_series.get(pid, []):
                key = id(series)
                vote_counts[key] = vote_counts.get(key, 0) + 1
        if not vote_counts:
            continue
        best_key = max(vote_counts, key=vote_counts.get)
        target = next(s for s in series_out if id(s) == best_key)
        if target["image"]:
            continue

        target_ids = [p["id"] for p in target["posts"]]
        cover_id = next((pid for pid in target_ids if pid in by_id), None)
        if cover_id is None:
            continue
        rel_path = "../assets/Image/크롤링사진/시리즈/" + folder + "/" + by_id[cover_id]
        target["image"] = rel_path

os.makedirs(out_dir, exist_ok=True)
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(series_out, f, ensure_ascii=False, indent=2)

matched = sum(1 for s in series_out if s["image"])
kept = sum(1 for s in series_out if s["posts"] and existing_image_by_first_post.get(s["posts"][0]["id"]))
print("wrote", out_path, "-", len(series_out), "series,", matched, "with a cover image (", kept, "kept from existing custom mapping)")
