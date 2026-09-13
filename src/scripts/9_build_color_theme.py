# -*- coding: utf-8 -*-
"""
브랜드 색상 CSS 변수 생성 스크립트 (9_build_color_theme.py)
- src/data/config/ColorTheme.json 을 읽어 CSS 커스텀 프로퍼티 블록을 만들고
  src/css/base/colorTheme.css 로 씁니다.
- 브랜드 색을 바꾸고 싶으면 이 스크립트나 colorTheme.css 를 직접 고치지
  말고, src/data/config/ColorTheme.json 값을 수정한 뒤 이 스크립트를 다시
  실행하세요(`python src/scripts/9_build_color_theme.py`).
- accent(#2f6fed) 자체는 src/css/base/reset.css 의 :root 에 이미 커스텀
  프로퍼티(--accent)로 정의돼 있어 여기서는 다시 만들지 않습니다 — JSON에는
  전체 팔레트를 한눈에 보기 위한 참고용으로만 남겨두고, 값이 reset.css와
  어긋나면 아래에서 경고를 띄웁니다. accentHover/mint/mintHover 는
  theme.css/auth.css/sidebar.css/bookmarks.css 등 여러 파일에 하드코딩돼
  반복되던 값이라, 이 스크립트가 --accent-hover/--mint/--mint-hover 로
  대신 내보냅니다.
- 다크모드 전용 값이 필요해지면 JSON에 "dark": { "mint": "..." } 처럼
  서브 객체를 추가하세요 — 이 스크립트가 [data-theme="dark"] { ... } 블록으로
  자동 변환합니다(지금은 다크모드에서도 같은 값을 쓰고 있어 비어 있습니다).
- `--check` 옵션을 주면(파일을 고치지 않고) ColorTheme.json으로 다시 생성했을
  때와 지금 colorTheme.css가 같은지만 확인합니다. JSON만 고치고 이 스크립트
  재실행을 깜빡한 경우를 커밋/배포 전에 잡아내는 용도입니다:
  `python src/scripts/9_build_color_theme.py --check`
"""
import json
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
json_path = os.path.join(HERE, "..", "data", "config", "ColorTheme.json")
reset_css_path = os.path.join(HERE, "..", "css", "base", "reset.css")
out_path = os.path.join(HERE, "..", "css", "base", "colorTheme.css")

# reset.css가 이미 소유한 토큰 — 중복 정의를 피하려고 여기서는 CSS로 내보내지
# 않고, JSON과 값이 일치하는지만 확인합니다.
OWNED_ELSEWHERE = {"accent": (reset_css_path, "--accent")}


def to_kebab(camel):
    return re.sub(r"([a-z0-9])([A-Z])", r"\1-\2", camel).lower()


def check_owned_elsewhere(tokens):
    for key, (path, var_name) in OWNED_ELSEWHERE.items():
        if key not in tokens or not os.path.exists(path):
            continue
        css_text = open(path, encoding="utf-8").read()
        m = re.search(re.escape(var_name) + r"\s*:\s*([^;]+);", css_text)
        json_value = str(tokens[key]).strip().lower()
        if m and m.group(1).strip().lower() != json_value:
            print("  ! 경고: ColorTheme.json의 %s(%s)가 %s의 %s(%s)와 달라요 — 둘 중 하나가 낡았을 수 있어요."
                  % (key, tokens[key], os.path.normpath(path), var_name, m.group(1).strip()))


def build_block(selector, tokens, skip_keys):
    lines = []
    for key, value in tokens.items():
        if key in skip_keys or key == "dark":
            continue
        lines.append("  --%s: %s;" % (to_kebab(key), value))
    if not lines:
        return ""
    return selector + " {\n" + "\n".join(lines) + "\n}\n"


def build_css(tokens):
    skip_keys = set(OWNED_ELSEWHERE.keys())
    parts = [
        "/* 이 파일은 src/scripts/9_build_color_theme.py 가",
        "   src/data/config/ColorTheme.json 에서 자동 생성합니다.",
        "   색을 바꾸려면 이 파일이 아니라 그 JSON을 고친 뒤 스크립트를 다시 실행하세요. */",
        "",
    ]

    root_block = build_block(":root", tokens, skip_keys)
    if root_block:
        parts.append(root_block)

    dark_tokens = tokens.get("dark") or {}
    dark_block = build_block('[data-theme="dark"]', dark_tokens, skip_keys)
    if dark_block:
        parts.append(dark_block)

    return "\n".join(parts).rstrip() + "\n"


def main():
    check_mode = "--check" in sys.argv
    tokens = json.load(open(json_path, encoding="utf-8"))
    check_owned_elsewhere(tokens)
    expected = build_css(tokens)

    if check_mode:
        current = open(out_path, encoding="utf-8").read() if os.path.exists(out_path) else None
        if current != expected:
            print("! colorTheme.css가 ColorTheme.json과 어긋나 있습니다 — 다시 생성하세요:")
            print("  python src/scripts/9_build_color_theme.py")
            sys.exit(1)
        print("colorTheme.css가 ColorTheme.json과 일치합니다 — 다시 생성할 필요 없어요.")
        return

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(expected)

    print("wrote", os.path.normpath(out_path))


if __name__ == "__main__":
    main()
