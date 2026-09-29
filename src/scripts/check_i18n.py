# -*- coding: utf-8 -*-
"""
사이트 UI 번역 사전 점검 스크립트 (check_i18n.py)
- src/js/ 의 t('한국어 원문') · I18n.t('...') 호출과 src/page/*.html 의
  data-i18n / data-i18n-html / data-i18n-attr 표시에서 번역 키(한국어 원문)를
  모두 모은 뒤, src/data/i18n/English.json · Japanese.json 과 비교합니다.
  - 빠진 키: 사전에 없어서 한국어 원문이 그대로 나오는 문구
  - 빈 값: 키는 있지만 번역을 아직 안 채운 문구(역시 한국어로 나옴)
  - 안 쓰는 키: 코드에서 문구가 바뀌거나 지워져 더는 쓰이지 않는 키
  - 자리표시자 불일치: 원문의 {n} 같은 자리표시자가 번역문에 없거나 다른 경우
- 값은 보통 문자열이고, 영어처럼 단수·복수가 갈리면
  { "one": "{n} work", "other": "{n} works" } 객체로 적을 수 있습니다.
- 옵션
  --fill   빠진 키를 빈 값("")으로 두 사전에 추가합니다. 빈 값은 한국어
           원문으로 표시되므로, 추가만 해 두고 나중에 번역을 채워도 됩니다.
  --prune  안 쓰는 키를 두 사전에서 지웁니다.
- 사전을 고친 뒤에는 다른 data/*.json 과 마찬가지로
  python src/scripts/10_update_data_version.py 를 실행해야 방문자 브라우저가
  새 사전을 받아 갑니다.
"""
import argparse
import glob
import html
import json
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.normpath(os.path.join(HERE, ".."))
I18N_DIR = os.path.join(SRC, "data", "i18n")
LANG_FILES = ["English.json", "Japanese.json"]

# 관리자 전용 화면은 번역하지 않는다.
SKIP_JS = {"statsPage.js", "i18n.js"}
SKIP_HTML = {"statsPage.html"}

# 코드에 문자열로 적혀 있지 않고 데이터·서버 응답에서 들어와 t(값) 으로
# 번역되는 키들. 새 값이 생기면 여기에 추가한다.
DYNAMIC_KEYS = [
    # 공지 상태 뱃지(changelogPage.js, 공지 Markdown 의 status: 줄)
    "진행중", "예정", "종료",
    # 공지 분류(notice/index.json 의 category)
    "공지", "이벤트",
    # Worker 가 돌려주는 오류 문구(data.error)
    "끌올은 10분에 한 번만 신청할 수 있어요.",
    "신청이 몰리고 있어요. 잠시 후 다시 시도해주세요.",
    "이미 끌올되어 있어요.",
    "지금 대기열이 가득 찼어요. 잠시 후 다시 시도해주세요.",
]

JS_CALL = re.compile(r"(?<![\w$])(?:I18n\.)?t\('((?:[^'\\]|\\.)*)'")
PLACEHOLDER = re.compile(r"\{(\w+)\}")


def normalize(text):
    return re.sub(r"\s+", " ", text).strip()


def js_unescape(s):
    return re.sub(r"\\(.)", r"\1", s)


def collect_js():
    keys = {}
    for path in glob.glob(os.path.join(SRC, "js", "**", "*.js"), recursive=True):
        if os.path.basename(path) in SKIP_JS:
            continue
        rel = os.path.relpath(path, SRC).replace(os.sep, "/")
        with open(path, encoding="utf-8") as f:
            for line in f:
                stripped = line.lstrip()
                if stripped.startswith("//") or stripped.startswith("*"):
                    continue
                for m in JS_CALL.finditer(line):
                    keys.setdefault(js_unescape(m.group(1)), rel)
    return keys


TAG_OPEN = re.compile(r"<([a-zA-Z][\w-]*)\b([^<>]*)>")
ATTR = re.compile(r'([\w:-]+)(?:="([^"]*)")?')


def collect_html():
    keys = {}
    for path in glob.glob(os.path.join(SRC, "page", "*.html")):
        if os.path.basename(path) in SKIP_HTML:
            continue
        rel = os.path.relpath(path, SRC).replace(os.sep, "/")
        with open(path, encoding="utf-8") as f:
            text = f.read()
        for m in TAG_OPEN.finditer(text):
            tag, attr_text = m.group(1), m.group(2)
            attrs = {a.group(1): a.group(2) for a in ATTR.finditer(attr_text)}
            close = text.find("</%s>" % tag, m.end())
            inner = text[m.end():close] if close != -1 else ""
            if "data-i18n" in attrs:
                key = attrs["data-i18n"] or normalize(html.unescape(re.sub(r"<[^>]+>", "", inner)))
                keys.setdefault(key, rel)
            if "data-i18n-html" in attrs:
                keys.setdefault(attrs["data-i18n-html"] or normalize(inner), rel)
            if attrs.get("data-i18n-attr"):
                for name in attrs["data-i18n-attr"].split(","):
                    value = attrs.get(name.strip())
                    if value:
                        keys.setdefault(html.unescape(value), rel)
    return keys


def placeholders_ok(key, value):
    # 번역문의 자리표시자는 원문과 같아야 한다. 단수·복수 객체
    # ({"one": ..., "other": ...})는 other 가 원문과 같아야 하고, one 은
    # "1 item" 처럼 {n} 을 숫자로 풀어 쓸 수 있으므로 원문에 있는 것만 쓰면 된다.
    expected = set(PLACEHOLDER.findall(key))
    if isinstance(value, dict):
        return (set(PLACEHOLDER.findall(value.get("other", ""))) == expected and
                set(PLACEHOLDER.findall(value.get("one", ""))) <= expected)
    return set(PLACEHOLDER.findall(value)) == expected


def load(name):
    path = os.path.join(I18N_DIR, name)
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save(name, data):
    path = os.path.join(I18N_DIR, name)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fill", action="store_true", help="빠진 키를 빈 값으로 추가")
    parser.add_argument("--prune", action="store_true", help="안 쓰는 키 삭제")
    args = parser.parse_args()

    used = collect_js()
    for k, v in collect_html().items():
        used.setdefault(k, v)
    for k in DYNAMIC_KEYS:
        used.setdefault(k, "(DYNAMIC_KEYS)")

    print("코드에서 찾은 번역 키: %d개" % len(used))
    problems = 0
    for name in LANG_FILES:
        data = load(name)
        missing = [k for k in used if k not in data]
        empty = [k for k in used if k in data and not data[k]]
        unused = [k for k in data if k not in used]
        mismatch = [k for k in used if data.get(k) and not placeholders_ok(k, data[k])]

        print("\n== %s: %d개 번역됨" % (name, len(used) - len(missing) - len(empty)))
        for label, items in (("빠진 키", missing), ("빈 값", empty),
                             ("안 쓰는 키", unused), ("자리표시자 불일치", mismatch)):
            if not items:
                continue
            problems += len(items) if label != "안 쓰는 키" else 0
            print("  [%s %d개]" % (label, len(items)))
            for k in items:
                print("    - %s  (%s)" % (k, used.get(k, "")))

        changed = False
        if args.fill and missing:
            for k in missing:
                data[k] = ""
            changed = True
        if args.prune and unused:
            for k in unused:
                del data[k]
            changed = True
        if changed:
            save(name, data)
            print("  → %s 저장함" % name)

    if problems:
        print("\n번역이 필요한 항목이 %d개 있습니다(해당 문구는 한국어로 표시됩니다)." % problems)
    else:
        print("\n모든 키가 번역돼 있습니다.")


if __name__ == "__main__":
    main()
