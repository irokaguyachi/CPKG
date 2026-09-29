# -*- coding: utf-8 -*-
import re, glob, json, os, sys

sys.stdout.reconfigure(encoding="utf-8")

SERIES_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "문학 정리", "시리즈")

name_re = re.compile(r"^- \*\*시리즈명\*\*:\s*(.+)$", re.MULTILINE)
tag_re = re.compile(r"^- \*\*시리즈 태그\*\*:\s*(.+)$", re.MULTILINE)
# 게임북처럼 한 회차가 선택지로 갈리는 시리즈는 "### 시리즈 4-A:" 처럼
# 분기 접미사를 붙인다(카구야라고 불러줘). 예전 정규식은 숫자만 받아서
# 분기 회차가 통째로 빠졌다. 분기 회차의 num 은 "4-A" 문자열로 남겨
# 화면에 "4-A 화"로 보이게 하고, 정렬은 앞의 숫자 기준으로 한다.
chapter_re = re.compile(
    r"^### 시리즈 (\d+)(-[A-Za-z0-9]+)?: \[(\d+)\]\s*(.+?)\s*$",
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
        num, branch, pid, title = m.groups()
        chapters.append({
            "num": f"{num}{branch}" if branch else int(num),
            "_order": int(num),
            "id": int(pid),
            "title": title.strip(),
            "link": f"https://gall.dcinside.com/mgallery/board/view/?id=chokaguyahime&no={pid}",
        })
    # 같은 번호의 분기(4-A, 4-B)는 파일에 적힌 순서를 그대로 유지한다(안정 정렬).
    chapters.sort(key=lambda c: c["_order"])
    for c in chapters:
        del c["_order"]
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
