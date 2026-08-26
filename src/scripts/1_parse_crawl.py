# -*- coding: utf-8 -*-
import re, glob, json, os, sys, time
import requests
from bs4 import BeautifulSoup

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
# 디시 갤러리 자체 "시리즈 연결" 기능을 쓴 글에만 붙는 필드 — 2026-08-23
# 이전까지는 이 필드를 통째로 버리고 있어서, 이 필드로만 확인 가능한 시리즈
# 소속 여부를 2_parse_series.py(수동 큐레이션 md 파일 기반)가 알 도리가
# 없었다. 여기서 캡처해 crawl_entries.json에 실어두면, 이후 시리즈 md 파일을
# 새로 만들거나 검토할 때 이 필드로 누락을 빠르게 찾을 수 있다.
SERIES_RE = re.compile(r"\*\*시리즈\*\*:\s*(.+)")

all_entries = []
tag_counter = {}
series_counter = {}
fail_blocks = []

# ---- 첨부 사진 다운로드 ----
# "첨부 사진" 필드에는 이미 저장될 경로(예: 사진/2026-08-23/295464_1.jpg)가
# 적혀 있지만, 지금까지 이 스크립트는 그 문자열만 옮겨 적었을 뿐 실제 파일을
# 받아온 적이 없었다(저장소에 사진/ 폴더 자체가 없음). crawl_translations.py가
# 쓰는 방식(모바일 페이지 파싱 + Referer 헤더)을 그대로 따라 여기서도 받는다.
# 이미 받아둔 파일(0바이트 아님)은 건너뛰므로 재실행해도 새 글만 받는다.
PHOTO_SESSION = requests.Session()
PHOTO_SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
})
IMAGE_DOWNLOAD_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, Gecko) Chrome/120.0.0.0 Safari/537.36",
}
photo_stats = {"skipped": 0, "downloaded": 0, "failed": 0, "no_images_found": 0}


def fetch_post_html(post_id, retries=3, delay=1.2):
    url = f"https://m.dcinside.com/board/chokaguyahime/{post_id}"
    for attempt in range(retries):
        try:
            resp = PHOTO_SESSION.get(url, timeout=15)
            if resp.status_code == 200 and resp.text:
                return resp.text
        except Exception:
            pass
        time.sleep(delay * (attempt + 1))
    return ""


def download_attached_photos(post_id, photo_field):
    """'첨부 사진' 필드에 이미 적힌 상대경로 그대로 실제 파일을 받는다."""
    if not photo_field or photo_field == "없음":
        return
    targets = [(p.strip(), os.path.join(BASE, p.strip()))
               for p in photo_field.split(",") if p.strip()]
    if all(os.path.exists(path) and os.path.getsize(path) > 0 for _, path in targets):
        photo_stats["skipped"] += len(targets)
        return

    html = fetch_post_html(post_id)
    soup = BeautifulSoup(html, "html.parser")
    body_el = soup.select_one("div.thum-txt") or soup.select_one("div.writing_view_box")
    img_urls = []
    if body_el:
        for img in body_el.select("img"):
            src = img.get("data-original") or img.get("src")
            if src and "gallview_loading" not in src:
                img_urls.append(src)

    if not img_urls:
        photo_stats["no_images_found"] += 1
        return

    referer = f"https://m.dcinside.com/board/chokaguyahime/{post_id}"
    # 페이지에서 찾은 이미지 순서를 파일명의 _1, _2... 순서와 그대로 맞춘다
    # (crawl_translations.py도 같은 순서 가정을 씀 — 다만 거긴 첫 장만 받음).
    for (rel_path, local_path), img_url in zip(targets, img_urls):
        if os.path.exists(local_path) and os.path.getsize(local_path) > 0:
            photo_stats["skipped"] += 1
            continue
        os.makedirs(os.path.dirname(local_path), exist_ok=True)
        try:
            resp = requests.get(img_url, headers={**IMAGE_DOWNLOAD_HEADERS, "Referer": referer}, timeout=20)
            if resp.status_code == 200 and resp.content:
                with open(local_path, "wb") as f:
                    f.write(resp.content)
                photo_stats["downloaded"] += 1
            else:
                photo_stats["failed"] += 1
        except Exception as e:
            print(f"   [!] 이미지 다운로드 실패 [{post_id}]: {img_url} ({e})")
            photo_stats["failed"] += 1
    time.sleep(1.2)


def parse_block(pid, title, block, source):
    link_m = LINK_RE.search(block)
    author_m = AUTHOR_RE.search(block)
    tags_m = TAGS_RE.search(block)
    chars_m = CHARS_RE.search(block)
    photo_m = PHOTO_RE.search(block)
    series_m = SERIES_RE.search(block)
    if not link_m:
        fail_blocks.append((pid, source, "no-link"))
        return
    link = link_m.group(1)
    author = author_m.group(1).strip() if author_m else ""
    tags_str = tags_m.group(1) if tags_m else ""
    chars = chars_m.group(1).strip() if chars_m else ""
    photo = photo_m.group(1).strip() if photo_m else "없음"
    series_name = series_m.group(1).strip() if series_m else None
    tag_list = [t.strip() for t in tags_str.split(",") if t.strip()]
    for t in tag_list:
        tag_counter[t] = tag_counter.get(t, 0) + 1
    if series_name:
        series_counter[series_name] = series_counter.get(series_name, 0) + 1
    entry = {
        "id": int(pid),
        "title": title.strip(),
        "link": link,
        "author": author,
        "tags": tag_list,
        "chars": chars,
        "photo": photo,
        "source": source,
    }
    # 필드가 없는 절대다수 글에는 아예 안 실어서 기존 스키마를 그대로 둔다 —
    # series 키가 있는 글만 "디시 공식 시리즈 연결이 확인된 글"이라는 뜻이 된다.
    if series_name:
        entry["series"] = series_name
    all_entries.append(entry)


def sort_crawl_file(p):
    base = os.path.splitext(os.path.basename(p))[0]
    if base.isdigit():
        return (0, int(base), "")
    return (1, 0, base)


# 1) crawling list files: split on "### [ID]..." headers
files = sorted(glob.glob(os.path.join(CRAWL_DIR, "*.md")), key=sort_crawl_file)
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

print("OFFICIAL SERIES-TAGGED POSTS:", sum(series_counter.values()), "/", len(series_counter), "고유 시리즈명")
print("  (src/data/문학 정리/시리즈/ 안에 아직 md 파일이 없는 시리즈명이 있는지 확인할 것)")

print("TAG COUNTS:")
for t, c in sorted(tag_counter.items(), key=lambda x: -x[1]):
    print(f"  {t}: {c}")

deduped.sort(key=lambda e: -e["id"])

print("\n=== 첨부 사진 다운로드 ===")
to_download = [e for e in deduped if e.get("photo") and e["photo"] != "없음"]
print(f"사진 첨부된 글: {len(to_download)}개")
for i, e in enumerate(to_download, 1):
    download_attached_photos(e["id"], e["photo"])
    if i % 50 == 0 or i == len(to_download):
        print(f"  진행: {i}/{len(to_download)}  {photo_stats}")
print("사진 다운로드 결과:", photo_stats)

out_path = os.path.join(os.path.dirname(__file__), "crawl_entries.json")
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(deduped, f, ensure_ascii=False)
print("FINAL COUNT:", len(deduped))
print("Wrote", out_path)
