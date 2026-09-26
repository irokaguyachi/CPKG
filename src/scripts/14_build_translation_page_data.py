# -*- coding: utf-8 -*-
"""
번역 페이지 데이터 생성 스크립트 (14_build_translation_page_data.py)
- crawl_translations.py 가 만들어 둔 '번역 정리/크롤링 파일/*.md' 배치들을
  파싱해 src/data/PageData/Translation.json 을 만듭니다.
- 스키마는 Novel.json / Series.json 과 동일해서 gridPage.js 를 그대로 씁니다.
  (translationPage.js 가 GridPage.create 로 이 파일을 읽습니다.)
- 번역 탭은 공식(AI) 태그를 지원하지 않으므로 tags 는 항상 빈 배열입니다.
  유저 투표 태그만 gridPage.js 의 userTagsOnly 경로로 얹힙니다.
- 카드 한 줄 요약(charCount)은 크롤러가 붙인 말머리를 따릅니다:
  [이미지] 글은 "이미지", [글자] 글은 크롤링된 글자 수("1,234자").
- 대표 이미지는 이미 아카이브된 번역 사진
  (src/assets/Image/크롤링사진/번역 사진/<배치>/<글번호>_1.<ext>)을 글번호로
  매칭해 채웁니다. 7_build_novel_page_data.py 의 build_image_index() 와 같은
  방식이고, 프론트(cdnConfig.js)가 이 경로를 R2 CDN + 썸네일 트리로
  변환합니다.

⚠️ 크롤링 원본('번역 정리/')은 .gitignore 대상이라 다른 컴퓨터나 CI 에는
   없습니다. 배치 파일을 하나도 못 찾으면 이미 커밋된 Translation.json 을
   덮어쓰지 않고 그대로 둡니다.
⚠️ 기존 Translation.json 에 사용자가 수동으로 매핑해 둔 image 경로가 있으면
   그대로 보존합니다 (CLAUDE.md 최우선 규칙). 자동 사진 매칭은 image 가
   비어 있는 항목에만 적용합니다.
"""
import json
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
SEP = chr(92)  # 윈도우 경로 구분자
CRAWL_DIR = os.path.join(HERE, "..", "data", "번역 정리", "크롤링 파일")
OUT_DIR = os.path.join(HERE, "..", "data", "PageData")
OUT_PATH = os.path.join(OUT_DIR, "Translation.json")
PAGE_DIR = os.path.join(HERE, "..", "page")
ASSETS_DIR = os.path.join(HERE, "..", "assets")
# 이미 아카이브된 번역 사진. 7_build_novel_page_data.py 는 크롤링사진 트리
# 전체를 훑지만, 여기서는 번역 사진만 필요하므로 하위 폴더를 바로 가리킨다.
PHOTO_ROOT = os.path.join(ASSETS_DIR, "Image", "크롤링사진", "번역 사진")

POST_LINK_BASE = "https://gall.dcinside.com/mgallery/board/view/?id=chokaguyahime&no="

# 크롤링 배치에는 남아 있지만 번역 탭에는 올리지 않는 게시글.
# Translation.json 을 손으로 지우면 이 스크립트를 다시 돌릴 때 되살아나므로
# (v0.4 에서 지운 두 건이 2026-09-26 재빌드 때 다시 들어온 적이 있다),
# 번역 탭에서 빼야 하는 글은 여기에 적는다.
EXCLUDED_IDS = {
    309152: "초 카구야 밥 1화 번역 — 공식 탭 '초 카구야 밥!' 시리즈 1화로 이전(v0.4)",
    309124: "초밥 1화 임시 번역 (AI) — 공식 번역이 올라와 중복 임시본 제거(v0.4)",
}

# "### [123456] 제목" 한 줄로 항목이 시작됩니다. 제목 안에 대괄호나 괄호가
# 들어가도 맨 앞의 [숫자]만 ID 로 떼어내면 되므로 이 정규식으로 충분합니다.
ENTRY_HEAD_RE = re.compile(r"^###\s*\[(\d+)\]\s*(.*)$")
FIELD_RE = re.compile(r"^-\s*\*\*(.+?)\*\*\s*:\s*(.*)$")


def batch_sort_key(filename):
    """1.md ~ 29.md 는 숫자 순으로, 날짜 파일(2026-08-23.md)은 그 뒤로."""
    stem = os.path.splitext(filename)[0]
    if stem.isdigit():
        return (0, int(stem), "")
    return (1, 0, stem)


def parse_entry(block_lines):
    """항목 하나(### 헤더 + 이어지는 - 필드들)를 dict 로 변환."""
    head = ENTRY_HEAD_RE.match(block_lines[0])
    if not head:
        return None
    post_id = int(head.group(1))
    title = head.group(2).strip()

    fields = {}
    for line in block_lines[1:]:
        m = FIELD_RE.match(line.strip())
        if m:
            fields[m.group(1).strip()] = m.group(2).strip()

    tag = fields.get("태그", "")
    is_image = "이미지" in tag

    char_count = "이미지" if is_image else None
    if not is_image:
        digits = re.sub(r"[^\d]", "", fields.get("글자 수", ""))
        if digits:
            char_count = "{:,}자".format(int(digits))

    link = fields.get("게시물 링크") or (POST_LINK_BASE + str(post_id))
    author = fields.get("작성자") or ""

    return {
        "id": post_id,
        "name": title,
        "charCount": char_count,
        "author": author,
        "link": link,
    }


def parse_batch_file(path):
    lines = open(path, encoding="utf-8").read().splitlines()
    entries = []
    current = None
    for line in lines:
        if ENTRY_HEAD_RE.match(line):
            if current:
                entries.append(current)
            current = [line]
        elif current is not None:
            current.append(line)
    if current:
        entries.append(current)
    return [e for e in (parse_entry(b) for b in entries) if e]


def build_image_index():
    """'크롤링사진/번역 사진/<배치>/<글번호>_n.<ext>' 를 글번호 -> 상대경로로 색인.

    같은 글에 사진이 여러 장이면(3060_1.jpg + 3060_1.png 처럼) 파일명 순으로
    첫 장을 대표로 씁니다 — 7_build_novel_page_data.py 와 같은 규칙.
    """
    index = {}
    if not os.path.isdir(PHOTO_ROOT):
        return index
    for root, _, files in os.walk(PHOTO_ROOT):
        for fn in sorted(files):
            m = re.match(r"^(\d+)_", fn)
            if not m:
                continue
            pid = int(m.group(1))
            if pid in index:
                continue
            rel = os.path.relpath(os.path.join(root, fn), ASSETS_DIR)
            index[pid] = "../assets/" + rel.replace(SEP, "/")
    return index


def load_existing_images():
    """이미 커밋된 Translation.json 의 수동 image 매핑을 보존."""
    if not os.path.exists(OUT_PATH):
        return {}
    try:
        data = json.load(open(OUT_PATH, encoding="utf-8"))
    except (ValueError, TypeError):
        return {}
    kept = {}
    for entry in data or []:
        pid = (entry.get("posts") or [{}])[0].get("id")
        img = entry.get("image")
        if pid is not None and img:
            img_abs = os.path.normpath(os.path.join(PAGE_DIR, img))
            if os.path.exists(img_abs):
                kept[pid] = img
    return kept


def main():
    if not os.path.isdir(CRAWL_DIR):
        print("[skip] 크롤링 폴더가 없습니다:", os.path.normpath(CRAWL_DIR))
        print("       Translation.json 을 그대로 둡니다.")
        return

    md_files = sorted(
        (f for f in os.listdir(CRAWL_DIR) if f.endswith(".md")),
        key=batch_sort_key,
    )
    if not md_files:
        print("[skip] 배치 .md 파일이 없습니다. Translation.json 을 그대로 둡니다.")
        return

    existing_image = load_existing_images()
    photo_index = build_image_index()

    by_id = {}
    dup = 0
    excluded = 0
    for fn in md_files:
        for entry in parse_batch_file(os.path.join(CRAWL_DIR, fn)):
            if entry["id"] in EXCLUDED_IDS:
                excluded += 1
                continue
            if entry["id"] in by_id:
                dup += 1
                continue
            by_id[entry["id"]] = entry

    # 최신순(ID 역순) — 크롤러 정렬과 문학 페이지 관례를 따릅니다.
    ordered = sorted(by_id.values(), key=lambda e: e["id"], reverse=True)

    out = []
    for e in ordered:
        out.append({
            "name": e["name"],
            # 수동 매핑이 있으면 무조건 우선(CLAUDE.md), 없으면 아카이브 사진 매칭
            "image": existing_image.get(e["id"]) or photo_index.get(e["id"]),
            "tags": [],
            "charCount": e["charCount"],
            "author": e["author"],
            "posts": [{
                "id": e["id"],
                "title": e["name"],
                "episode": 1,
                "link": e["link"],
            }],
        })

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    image_kind = sum(1 for e in out if e["charCount"] == "이미지")
    with_photo = sum(1 for e in out if e["image"])
    kept = sum(1 for e in out if e["posts"][0]["id"] in existing_image)
    print("wrote", os.path.normpath(OUT_PATH))
    print("  배치 파일 %d개에서 항목 %d건 (ID 중복 %d건, EXCLUDED_IDS %d건 제외)"
          % (len(md_files), len(out), dup, excluded))
    print("  [이미지] %d건 / [글자] %d건" % (image_kind, len(out) - image_kind))
    print("  대표 이미지 매칭 %d건 (%.1f%%), 그중 기존 수동 매핑 %d건"
          % (with_photo, with_photo / len(out) * 100 if out else 0, kept))


if __name__ == "__main__":
    main()
