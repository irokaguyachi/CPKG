# -*- coding: utf-8 -*-
import json, os, sys
sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(__file__)

crawl = json.load(open(os.path.join(HERE, "crawl_entries.json"), encoding="utf-8"))
series = json.load(open(os.path.join(HERE, "series_entries.json"), encoding="utf-8"))

posts = [
    {"i": e["id"], "t": e["title"], "g": e["tags"], "c": e["chars"], "a": e["author"]}
    for e in crawl
]

series_out = [
    {
        "n": s["name"],
        "g": s["tagline"],
        "c": s["count"],
        "ch": [{"i": c["id"], "t": c["title"], "n": c["num"]} for c in s["chapters"]],
    }
    for s in series
]

bundle = {"posts": posts, "series": series_out}
out_path = os.path.join(HERE, "..", "data.json")
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(bundle, f, ensure_ascii=False, separators=(",", ":"))
size = os.path.getsize(out_path)
print("posts:", len(posts), "series:", len(series_out), "bytes:", size)
