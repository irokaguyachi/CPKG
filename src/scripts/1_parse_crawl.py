# -*- coding: utf-8 -*-
import re, glob, json, os, sys

sys.stdout.reconfigure(encoding="utf-8")

BASE = os.path.join(os.path.dirname(__file__), "..", "data", "문학 정리")
CRAWL_DIR = os.path.join(BASE, "크롤링 파일")
HOF_DIR = os.path.join(BASE, "명예관")
CONTEST_DIR = os.path.join(BASE, "대회")

LINK_RE = re.compile(r"\*\*게시물 링크\*\*:.*?(https://gall\.dcinside\.com/mgallery/board/view/\?id=chokaguyahime&no=\d+)")
AUTHOR_RE = re.compile(r"\*\*작성자\*\*:\s*(.+)")
TAGS_RE = re.compile(r"\*\*태그\*\*:\s*\[(.*?)\]")
CHARS_RE = re.compile(r"\*\*글자 수\*\*:\s*(.+)")
PHOTO_RE = re.compile(r"\*\*첨부 사진\*\*:\s*(.+)")

all_entries = []
tag_counter = {}
fail_blocks = []


def parse_block(pid, title, block, source):
    link_m = LINK_RE.search(block)
    author_m = AUTHOR_RE.search(block)
    tags_m = TAGS_RE.search(block)
    chars_m = CHARS_RE.search(block)
    photo_m = PHOTO_RE.search(block)
    if not link_m:
        fail_blocks.append((pid, source, "no-link"))
        return
    link = link_m.group(1)
    author = author_m.group(1).strip() if author_m else ""
    tags_str = tags_m.group(1) if tags_m else ""
    chars = chars_m.group(1).strip() if chars_m else ""
    photo = photo_m.group(1).strip() if photo_m else "없음"
    tag_list = [t.strip() for t in tags_str.split(",") if t.strip()]
    for t in tag_list:
        tag_counter[t] = tag_counter.get(t, 0) + 1
    all_entries.append({
        "id": int(pid),
        "title": title.strip(),
        "link": link,
        "author": author,
        "tags": tag_list,
        "chars": chars,
        "photo": photo,
        "source": source,
    })


# 1) crawling list files: split on "### [ID]..." headers
files = sorted(glob.glob(os.path.join(CRAWL_DIR, "*.md")), key=lambda p: int(os.path.basename(p)[:-3]))
header_re = re.compile(r"^### \[(\d+)\](?:\[시리즈\])?\s*(.*)$", re.MULTILINE)
crawl_count = 0
for fp in files:
    with open(fp, encoding="utf-8") as f:
        text = f.read()
    headers = list(header_re.finditer(text))
    for i, hm in enumerate(headers):
        pid, title = hm.group(1), hm.group(2)
        start = hm.end()
        end = headers[i + 1].start() if i + 1 < len(headers) else len(text)
        block = text[start:end]
        before = len(all_entries)
        parse_block(pid, title, block, f"crawl:{os.path.basename(fp)}")
        if len(all_entries) > before:
            crawl_count += 1
print("crawl headers total:", sum(len(header_re.findall(open(f, encoding='utf-8').read())) for f in files))
print("crawl parsed:", crawl_count)

# 2) 명예관 + 대회 individual files: header is "# [ID] title"
single_header_re = re.compile(r"^#\s*\[(\d+)\]\s*(.*)$", re.MULTILINE)


def parse_single_file(fp, tag_prefix):
    with open(fp, encoding="utf-8") as f:
        text = f.read()
    hm = single_header_re.search(text)
    if not hm:
        fail_blocks.append((os.path.basename(fp), tag_prefix, "no-header"))
        return False
    pid, title = hm.group(1), hm.group(2)
    block = text[hm.end():]
    before = len(all_entries)
    parse_block(pid, title, block, f"{tag_prefix}:{os.path.basename(fp)}")
    return len(all_entries) > before


hof_files = [f for f in glob.glob(os.path.join(HOF_DIR, "*.md"))
             if os.path.basename(f) not in ("명예관.md", "Ignore명예관.md")]
hof_ok = sum(1 for f in hof_files if parse_single_file(f, "hof"))
print("hof parsed:", hof_ok, "of", len(hof_files))

contest_files = glob.glob(os.path.join(CONTEST_DIR, "**", "*.md"), recursive=True)
contest_ok = sum(1 for f in contest_files if parse_single_file(f, "contest"))
print("contest parsed:", contest_ok, "of", len(contest_files))

print("TOTAL PARSED:", len(all_entries))
print("FAIL BLOCKS:", len(fail_blocks))
for fb in fail_blocks[:30]:
    print("  FAIL:", fb)

# dedupe by id, keep first occurrence
seen = {}
deduped = []
dup_report = []
for e in all_entries:
    if e["id"] in seen:
        dup_report.append((e["id"], seen[e["id"]], e["source"]))
        continue
    seen[e["id"]] = e["source"]
    deduped.append(e)

print("DUPLICATES (kept first):", len(dup_report))

print("TAG COUNTS:")
for t, c in sorted(tag_counter.items(), key=lambda x: -x[1]):
    print(f"  {t}: {c}")

deduped.sort(key=lambda e: -e["id"])

out_path = os.path.join(os.path.dirname(__file__), "crawl_entries.json")
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(deduped, f, ensure_ascii=False)
print("FINAL COUNT:", len(deduped))
print("Wrote", out_path)
