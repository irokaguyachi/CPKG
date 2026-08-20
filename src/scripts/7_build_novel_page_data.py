# -*- coding: utf-8 -*-
"""
문학 페이지 데이터 생성 스크립트 (7_build_novel_page_data.py)
- MoonHakdata.json 에서 '단독 게시물'만 골라 Novel.json 을 만듭니다.
- 단독 = 어떤 시리즈의 화(ch)에도 속하지 않는 글. 시리즈는 이미 전용
  페이지(Series.json)가 있어서 여기에 또 넣으면 중복 노출됩니다.
- ignoreID.md 에 올라온 ID(끌올/잡담/크롤링 제외분)는 빼고 만듭니다.
- 스키마는 Series.json / HOF.json 과 동일해서 gridPage.js 를 그대로 씁니다.

⚠️ 기존 Novel.json 에 사용자가 수동으로 매핑해 둔 image 경로가 있으면
   그대로 보존합니다 (CLAUDE.md 최우선 규칙). 크롤링 자동 매칭은 image 가
   비어 있는 항목에만 적용됩니다.
"""
import json
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
SEP = chr(92)  # 윈도우 경로 구분자

src_path = os.path.join(HERE, "..", "data", "MoonHakdata.json")
ignore_path = os.path.join(HERE, "..", "data", "ignoreID.md")
photos_root = os.path.join(HERE, "..", "assets", "Image", "크롤링사진")
out_dir = os.path.join(HERE, "..", "data", "PageData")
out_path = os.path.join(out_dir, "Novel.json")

POST_LINK_BASE = "https://gall.dcinside.com/mgallery/board/view/?id=chokaguyahime&no="


def load_ignore_ids():
    """ignoreID.md 의 표에서 제외 대상 ID를 읽습니다."""
    if not os.path.exists(ignore_path):
        return set()
    text = open(ignore_path, encoding="utf-8").read()
    return {int(m) for m in re.findall(r"^\|\s*(\d+)\s*\|", text, re.M)}


def build_image_index():
    """크롤링사진 전체에서 <게시물ID>_n.<ext> 파일을 찾아 ID -> 상대경로로 색인.

    같은 글에 사진이 여러 장이면 파일명 순서상 첫 장을 대표로 씁니다.
    """
    index = {}
    if not os.path.isdir(photos_root):
        return index
    for root, _, files in os.walk(photos_root):
        for fn in sorted(files):
            m = re.match(r"^(\d+)_", fn)
            if not m:
                continue
            pid = int(m.group(1))
            if pid in index:
                continue
            abs_path = os.path.join(root, fn)
            rel = os.path.relpath(abs_path, os.path.join(HERE, "..", "assets"))
            index[pid] = "../assets/" + rel.replace(SEP, "/")
    return index


def main():
    data = json.load(open(src_path, encoding="utf-8"))
    posts = data["posts"]
    series = data["series"]

    in_series = {ch["i"] for s in series for ch in s.get("ch", [])}
    ignore_ids = load_ignore_ids()

    # 기존 파일의 수동 image 매핑 보존
    existing_image = {}
    if os.path.exists(out_path):
        try:
            for entry in json.load(open(out_path, encoding="utf-8")):
                pid = (entry.get("posts") or [{}])[0].get("id")
                if pid is not None and entry.get("image"):
                    existing_image[pid] = entry["image"]
        except (ValueError, AttributeError):
            pass  # 비어 있거나 깨진 파일이면 새로 만듦

    images = build_image_index()

    novels = []
    for p in posts:
        pid = p["i"]
        if pid in in_series or pid in ignore_ids:
            continue
        novels.append({
            "name": p["t"],
            "image": existing_image.get(pid) or images.get(pid),
            "tags": list(p.get("g") or []),
            "charCount": p.get("c"),
            "author": p.get("a"),
            "posts": [{
                "id": pid,
                "title": p["t"],
                "episode": 1,
                "link": POST_LINK_BASE + str(pid),
            }],
        })

    os.makedirs(out_dir, exist_ok=True)
    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(novels, f, ensure_ascii=False, indent=2)

    with_image = sum(1 for n in novels if n["image"])
    kept = sum(1 for n in novels if n["posts"][0]["id"] in existing_image)
    print("wrote", os.path.normpath(out_path))
    print("  전체 게시물 %d건 중 단독 %d건" % (len(posts), len(novels)))
    print("  제외: 시리즈 소속 %d건 / ignoreID %d건" % (len(in_series), len(ignore_ids)))
    print("  대표 이미지 %d건 (%.1f%%), 그중 기존 수동 매핑 보존 %d건"
          % (with_image, with_image / len(novels) * 100 if novels else 0, kept))


if __name__ == "__main__":
    main()
