# -*- coding: utf-8 -*-
import re, glob, json, os, sys

sys.stdout.reconfigure(encoding="utf-8")

SERIES_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "문학 정리", "시리즈")

name_re = re.compile(r"^- \*\*시리즈명\*\*:\s*(.+)$", re.MULTILINE)
tag_re = re.compile(r"^- \*\*시리즈 태그\*\*:\s*(.+)$", re.MULTILINE)
chapter_re = re.compile(
    r"^### 시리즈 (\d+): \[(\d+)\]\s*(.+?)\s*$",
    re.MULTILINE,
)

series_list = []
files = glob.glob(os.path.join(SERIES_DIR, "*.md"))
for fp in files:
    with open(fp, encoding="utf-8") as f:
        text = f.read()
    name_m = name_re.search(text)
    tag_m = tag_re.search(text)
    name = name_m.group(1).strip() if name_m else os.path.basename(fp)[:-3]
    tagline = tag_m.group(1).strip() if tag_m else ""
    chapters = []
    for m in chapter_re.finditer(text):
        num, pid, title = m.groups()
        chapters.append({
            "num": int(num),
            "id": int(pid),
            "title": title.strip(),
            "link": f"https://gall.dcinside.com/mgallery/board/view/?id=chokaguyahime&no={pid}",
        })
    chapters.sort(key=lambda c: c["num"])
    series_list.append({
        "name": name,
        "tagline": tagline,
        "count": len(chapters),
        "chapters": chapters,
    })

series_list.sort(key=lambda s: -s["count"])
print("total series:", len(series_list))
print("total chapters:", sum(s["count"] for s in series_list))

out_path = os.path.join(os.path.dirname(__file__), "series_entries.json")
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(series_list, f, ensure_ascii=False)
print("wrote", out_path)
