# -*- coding: utf-8 -*-
"""
카드 썸네일 + 상세 모달용 중간 이미지 생성 스크립트 (6_build_thumbnails.py)
- Series.json / HOF.json / Official.json / Novel.json / Translation.json 의 `image` 가 가리키는 원본을 읽어
  두 가지를 만듭니다.
  1. 가로 600px WebP 썸네일 -> src/assets/Image/thumb/  (카드용, 기존과 동일)
  2. 가로 1200px WebP 중간 이미지 -> src/assets/Image/mid/  (상세 모달용, 신규)
- 원본 경로 구조를 그대로 미러링하며, 확장자만 .webp 로 바뀝니다.
  예) ../assets/Image/크롤링사진/시리즈/A/1.gif
      -> src/assets/Image/thumb/크롤링사진/시리즈/A/1.webp
      -> src/assets/Image/mid/크롤링사진/시리즈/A/1.webp
- 애니메이션 GIF 는 두 트리에서 다르게 다룹니다.
  · thumb/: 첫 프레임만 정지 WebP 로 뽑습니다. 카드에서는 ~300px 로 줄어들 뿐인데
    매 프레임 디코딩이 메인 스레드를 계속 점유하기 때문입니다.
  · mid/: 아예 만들지 않습니다. 상세 모달(postDetailSeries.js)은 지금 애니메이션
    GIF 커버를 실제로 움직이는 채로 보여주는데, 정지 WebP로 바꾸면 그 연출이
    사라집니다. src/js/config/cdnConfig.js 의 revealBackgroundProgressive() 가 mid 파일이
    없으면(404) 원본으로 대체하도록 이미 되어 있어서, 여기서 그냥 안 만들면
    애니메이션 있는 이미지는 지금처럼 원본 그대로 재생됩니다
    (TRAFFIC_SECURITY_AUDIT_2.md N-T2 — 애니메이션 없는 나머지 다수는 중간
    이미지로 상세 모달 전송량이 크게 줄고, 애니메이션 있는 소수는 그대로 유지).

⚠️ 원본(src/assets/Image/크롤링사진/...)은 읽기만 하며 절대 수정/삭제하지 않습니다.
   PageData/*.json 의 `image` 필드도 건드리지 않습니다 (CLAUDE.md 최우선 규칙).
"""
import json
import os
import sys

from PIL import Image, ImageFile
ImageFile.LOAD_TRUNCATED_IMAGES = True

sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE_DIR = os.path.join(HERE, "..", "page")          # JSON 의 ../assets/... 기준 경로
IMAGE_DIR = os.path.join(HERE, "..", "assets", "Image")
THUMB_DIR = os.path.join(IMAGE_DIR, "thumb")
MID_DIR = os.path.join(IMAGE_DIR, "mid")
DATA_DIR = os.path.join(HERE, "..", "data", "PageData")

SOURCES = ["Series.json", "HOF.json", "Official.json", "Novel.json", "Translation.json"]
THUMB_WIDTH = 600
THUMB_QUALITY = 80
MID_WIDTH = 1200
MID_QUALITY = 82


def collect_image_paths():
    """PageData JSON 들에서 image 경로를 중복 없이 모읍니다 (읽기 전용)."""
    seen = []
    for name in SOURCES:
        path = os.path.join(DATA_DIR, name)
        if not os.path.exists(path):
            print(f"  (건너뜀) {name} 없음")
            continue
        with open(path, encoding="utf-8") as f:
            try:
                data = json.load(f)
            except ValueError as e:
                print(f"  (건너뜀) {name} 파싱 실패: {e}")
                continue
        found = [e["image"] for e in data if e.get("image")]
        for rel in found:
            if rel not in seen:
                seen.append(rel)
        print(f"  {name}: {len(data)}개 항목 중 이미지 {len(found)}개")
    return seen


def to_variant_path(rel, base_dir):
    """'../assets/Image/<sub>/x.gif' -> (원본 절대경로, <base_dir>/<sub>.webp)"""
    src_abs = os.path.normpath(os.path.join(PAGE_DIR, rel))
    sub = os.path.relpath(src_abs, os.path.normpath(IMAGE_DIR))
    variant_abs = os.path.join(base_dir, os.path.splitext(sub)[0] + ".webp")
    return src_abs, os.path.normpath(variant_abs)


def prepare_frame(im, target_width):
    """팔레트/투명도를 살려 RGBA 또는 RGB로 바꾸고, target_width보다 크면 축소."""
    if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
        frame = im.convert("RGBA")
    else:
        frame = im.convert("RGB")
    if frame.width > target_width:
        ratio = target_width / float(frame.width)
        frame = frame.resize(
            (target_width, max(1, int(round(frame.height * ratio)))),
            Image.LANCZOS,
        )
    return frame


def build_one(src_abs, thumb_abs, mid_abs):
    """원본 1장을 썸네일(+애니메이션이 아니면 중간 이미지)로 변환.
    (원본크기, 썸네일크기, 중간이미지크기 또는 None, 비고) 반환."""
    src_size = os.path.getsize(src_abs)

    with Image.open(src_abs) as im:
        animated = getattr(im, "n_frames", 1) > 1
        if animated:
            im.seek(0)  # 첫 프레임만

        os.makedirs(os.path.dirname(thumb_abs), exist_ok=True)
        prepare_frame(im, THUMB_WIDTH).save(thumb_abs, format="WEBP", quality=THUMB_QUALITY, method=6)
        thumb_size = os.path.getsize(thumb_abs)

        mid_size = None
        if animated:
            # 낡은 mid 파일이 남아있으면(예: 예전엔 정지 이미지였다가 애니메이션
            # 원본으로 교체된 경우) 지운다 — 있으면 원본 대신 그게 쓰인다.
            if os.path.exists(mid_abs):
                os.remove(mid_abs)
        else:
            os.makedirs(os.path.dirname(mid_abs), exist_ok=True)
            prepare_frame(im, MID_WIDTH).save(mid_abs, format="WEBP", quality=MID_QUALITY, method=6)
            mid_size = os.path.getsize(mid_abs)

    return src_size, thumb_size, mid_size, "애니메이션 첫 프레임 (mid는 원본 유지)" if animated else ""


def main():
    print("[1/3] PageData JSON 에서 이미지 경로 수집 중...")
    rels = collect_image_paths()
    print(f"       -> 고유 이미지 {len(rels)}개\n")

    if not rels:
        print("생성할 이미지가 없습니다.")
        return

    print("[2/3] 썸네일/중간 이미지 생성 중...")
    total_src = total_thumb = total_mid = 0
    made = skipped = failed = animated_count = 0

    for rel in rels:
        src_abs, thumb_abs = to_variant_path(rel, THUMB_DIR)
        _, mid_abs = to_variant_path(rel, MID_DIR)
        if not os.path.exists(src_abs):
            print(f"  [없음] {rel}")
            failed += 1
            continue

        src_mtime = os.path.getmtime(src_abs)
        thumb_fresh = os.path.exists(thumb_abs) and os.path.getmtime(thumb_abs) >= src_mtime
        # mid 는 애니메이션 원본이면 아예 없는 게 정상 상태라, 존재 여부만으로는
        # "아직 처리 안 함"과 "일부러 안 만듦"을 구분할 수 없다. thumb가 최신이고
        # mid 파일이 있는데 그것도 최신이면 확실히 건너뛸 수 있지만, mid가 없는
        # 경우는 애니메이션이라 안 만든 건지 아직 처리 전인지 열어봐야 알 수
        # 있으므로 그냥 다시 처리한다(애니메이션 GIF 21개 안팎이라 재인코딩
        # 비용이 크지 않다).
        mid_fresh = os.path.exists(mid_abs) and os.path.getmtime(mid_abs) >= src_mtime
        if thumb_fresh and mid_fresh:
            skipped += 1
            continue

        try:
            s, t, m, note = build_one(src_abs, thumb_abs, mid_abs)
        except Exception as e:  # 한 장 실패가 전체를 막지 않도록
            print(f"  [실패] {os.path.basename(src_abs)}: {e}")
            failed += 1
            continue

        total_src += s
        total_thumb += t
        if m is not None:
            total_mid += m
        else:
            animated_count += 1
        made += 1
        if s >= 1024 * 1024:  # 1MB 이상이던 것만 개별 출력
            mid_note = f", mid {m/1024:.0f} KB" if m is not None else ""
            tail = f"  ({note})" if note else ""
            print(f"  {os.path.basename(src_abs)}: {s/1048576:.2f} MB -> thumb {t/1024:.0f} KB{mid_note}{tail}")

    print(f"\n[3/3] 완료 — 생성 {made}개, 실패 {failed}개, 건너뜀 {skipped}개 (그중 애니메이션이라 mid 생략 {animated_count}개)")
    if made:
        print(f"       원본 합계        : {total_src/1048576:.2f} MB")
        print(f"       썸네일 합계      : {total_thumb/1048576:.2f} MB")
        print(f"       중간 이미지 합계 : {total_mid/1048576:.2f} MB (애니메이션 제외분)")
    print(f"       출력 위치        : {os.path.normpath(THUMB_DIR)}, {os.path.normpath(MID_DIR)}")


if __name__ == "__main__":
    main()
