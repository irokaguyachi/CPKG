# -*- coding: utf-8 -*-
"""
사이트 설정 동기화 스크립트 (sync_site_config.py)
- src/data/SiteConfig.json 의 appName/shortAppName 을
  src/manifest.webmanifest 의 name/short_name 에 반영합니다.
- manifest.webmanifest 는 브라우저가 <link rel="manifest">로 직접 fetch하는
  정적 파일이라, 페이지의 다른 JS(src/js/siteConfig.js)로는 런타임에 못
  바꿉니다 — SiteConfig.json 을 고친 뒤 이 스크립트를 실행해서 반영하세요.
- 문의 메일(contactEmail)이나 apple-mobile-web-app-title 같은, 페이지 DOM에
  그대로 찍히는 값들은 siteConfig.js가 런타임에 알아서 반영하므로 이
  스크립트가 다루지 않습니다.
"""
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(HERE, "..", "data", "SiteConfig.json")
MANIFEST_PATH = os.path.join(HERE, "..", "manifest.webmanifest")


def main():
    config = json.load(open(CONFIG_PATH, encoding="utf-8"))
    manifest = json.load(open(MANIFEST_PATH, encoding="utf-8"))

    changed = False
    if config.get("appName") and manifest.get("name") != config["appName"]:
        manifest["name"] = config["appName"]
        changed = True
    if config.get("shortAppName") and manifest.get("short_name") != config["shortAppName"]:
        manifest["short_name"] = config["shortAppName"]
        changed = True

    if not changed:
        print("manifest.webmanifest 이미 최신입니다 — 변경 없음.")
        return

    with open(MANIFEST_PATH, "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("manifest.webmanifest 갱신: name=%r, short_name=%r" % (manifest["name"], manifest["short_name"]))


if __name__ == "__main__":
    main()
