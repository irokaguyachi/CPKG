# -*- coding: utf-8 -*-
"""
카드 썸네일 생성 스크립트 (6_build_thumbnails.py)
- Series.json / HOF.json / Official.json 의 `image` 가 가리키는 원본을 읽어
  가로 600px / WebP quality 80 썸네일을 src/assets/Image/thumb/ 아래에 생성합니다.
- 원본 경로 구조를 그대로 미러링하며, 확장자만 .webp 로 바뀝니다.
  예) ../assets/Image/크롤링사진/시리즈/A/1.gif
      -> src/assets/Image/thumb/크롤링사진/시리즈/A/1.webp
- 애니메이션 GIF 는 첫 프레임만 정지 WebP 로 뽑습니다. 카드에서는 ~300px 로
  줄어들 뿐인데 매 프레임 디코딩이 메인 스레드를 계속 점유하기 때문입니다.

⚠️ 원본(src/assets/Image/크롤링사진/...)은 읽기만 하며 절대 수정/삭제하지 않습니다.
   PageData/*.json 의 `image` 필드도 건드리지 않습니다 (CLAUDE.md 최우선 규칙).
"""
import json
import os
import sys

from PIL import Image

sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE_DIR = os.path.join(HERE, "..", "page")          # JSON 의 ../assets/... 기준 경로
IMAGE_DIR = os.path.join(HERE, "..", "assets", "Image")
THUMB_DIR = os.path.join(IMAGE_DIR, "thumb")
DATA_DIR = os.path.join(HERE, "..", "data", "PageData")

SOURCES = ["Series.json", "HOF.json", "Official.json"]
THUMB_WIDTH = 600
WEBP_QUALITY = 80


def collect_image_paths():
    """PageData JSON 들에서 image 경로를 중복 없이 모읍니다 (읽기 전용)."""
    seen = []
    for name in SOURCES:
        path = os.path.join(DATA_DIR, name)
        if not os.path.exists(path):
            print(f"  (건너뜀) {name} 없음")
            continue
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        found = [e["image"] for e in data if e.get("image")]
        for rel in found:
            if rel not in seen:
                seen.append(rel)
        print(f"  {name}: {len(data)}개 항목 중 이미지 {len(found)}개")
    return seen


def to_thumb_path(rel):
    """'../assets/Image/<sub>/x.gif' -> (원본 절대경로, 썸네일 절대경로)"""
    src_abs = os.path.normpath(os.path.join(PAGE_DIR, rel))
    sub = os.path.relpath(src_abs, os.path.normpath(IMAGE_DIR))
    thumb_abs = os.path.join(THUMB_DIR, os.path.splitext(sub)[0] + ".webp")
    return src_abs, os.path.normpath(thumb_abs)


def build_one(src_abs, thumb_abs):
    """원본 1장을 썸네일로 변환. (원본크기, 썸네일크기, 비고) 반환."""
    src_size = os.path.getsize(src_abs)

    with Image.open(src_abs) as im:
        animated = getattr(im, "n_frames", 1) > 1
        if animated:
            im.seek(0)  # 첫 프레임만

        # 팔레트/투명도 처리 — 알파가 있으면 살리고 없으면 RGB 로
        if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
            frame = im.convert("RGBA")
        else:
            frame = im.convert("RGB")

        if frame.width > THUMB_WIDTH:
            ratio = THUMB_WIDTH / float(frame.width)
            frame = frame.resize(
                (THUMB_WIDTH, max(1, int(round(frame.height * ratio)))),
                Image.LANCZOS,
            )

        os.makedirs(os.path.dirname(thumb_abs), exist_ok=True)
        frame.save(thumb_abs, format="WEBP", quality=WEBP_QUALITY, method=6)

    return src_size, os.path.getsize(thumb_abs), "애니메이션 첫 프레임" if animated else ""


def main():
    print("[1/3] PageData JSON 에서 이미지 경로 수집 중...")
    rels = collect_image_paths()
    print(f"       -> 고유 이미지 {len(rels)}개\n")

    if not rels:
        print("생성할 썸네일이 없습니다.")
        return

    print("[2/3] 썸네일 생성 중...")
    total_src = total_thumb = 0
    made = skipped = failed = 0

    for rel in rels:
        src_abs, thumb_abs = to_thumb_path(rel)
        if not os.path.exists(src_abs):
            print(f"  [없음] {rel}")
            failed += 1
            continue
        try:
            s, t, note = build_one(src_abs, thumb_abs)
        except Exception as e:  # 한 장 실패가 전체를 막지 않도록
            print(f"  [실패] {os.path.basename(src_abs)}: {e}")
            failed += 1
            continue

        total_src += s
        total_thumb += t
        made += 1
        if s >= 1024 * 1024:  # 1MB 이상이던 것만 개별 출력
            pct = (1 - t / s) * 100
            tail = f"  ({note})" if note else ""
            print(f"  {os.path.basename(src_abs)}: {s/1048576:.2f} MB -> {t/1024:.0f} KB  (-{pct:.1f}%){tail}")

    print(f"\n[3/3] 완료 — 생성 {made}개, 실패 {failed}개, 건너뜀 {skipped}개")
    if made:
        print(f"       원본 합계   : {total_src/1048576:.2f} MB")
        print(f"       썸네일 합계 : {total_thumb/1048576:.2f} MB")
        print(f"       절감        : {(1 - total_thumb/total_src)*100:.1f}%")
    print(f"       출력 위치   : {os.path.normpath(THUMB_DIR)}")


if __name__ == "__main__":
    main()
