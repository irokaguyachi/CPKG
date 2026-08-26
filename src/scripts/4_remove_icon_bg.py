# -*- coding: utf-8 -*-
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile

from PIL import Image
from rembg import new_session, remove

sys.stdout.reconfigure(encoding="utf-8")

BASE = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ICON_DIR = os.path.join(BASE, "src", "offline_src", "LoadingLogo")
JSON_PATH = os.path.join(BASE, "src", "data", "LoadingIcons.json")
TMP_DIR = os.path.join(tempfile.gettempdir(), "cpkg_loadingicon_frames")

SUFFIX = "_nobg"

session = new_session("u2net")


def get_durations(path):
    im = Image.open(path)
    durs = []
    loop = im.info.get("loop", 0)
    i = 0
    try:
        while True:
            im.seek(i)
            durs.append(im.info.get("duration", 80))
            i += 1
    except EOFError:
        pass
    return durs, loop


def process(gif_path):
    name = os.path.splitext(os.path.basename(gif_path))[0]
    out_path = os.path.join(ICON_DIR, name + SUFFIX + ".webp")

    frame_dir = os.path.join(TMP_DIR, name)
    if os.path.exists(frame_dir):
        shutil.rmtree(frame_dir)
    os.makedirs(frame_dir)

    subprocess.run(
        ["ffmpeg", "-y", "-i", gif_path, "-vsync", "0", os.path.join(frame_dir, "f_%04d.png")],
        check=True,
        capture_output=True,
    )

    durations, loop = get_durations(gif_path)
    frame_files = sorted(glob.glob(os.path.join(frame_dir, "*.png")))

    if len(frame_files) != len(durations):
        print(f"  WARNING: frame count mismatch ({len(frame_files)} extracted vs {len(durations)} durations)")
        durations = (durations * ((len(frame_files) // max(len(durations), 1)) + 1))[: len(frame_files)]

    processed = []
    for fp in frame_files:
        with open(fp, "rb") as f:
            data = f.read()
        out_bytes = remove(data, session=session)
        with open(fp, "wb") as f:
            f.write(out_bytes)
        processed.append(Image.open(fp).convert("RGBA"))

    first, rest = processed[0], processed[1:]
    first.save(
        out_path,
        format="WEBP",
        save_all=True,
        append_images=rest,
        duration=durations,
        loop=loop,
        lossless=True,
        method=6,
    )

    shutil.rmtree(frame_dir)
    print(f"  -> {os.path.basename(out_path)} ({len(processed)} frames)")
    return os.path.basename(out_path)


def main():
    os.makedirs(TMP_DIR, exist_ok=True)
    gif_files = sorted(glob.glob(os.path.join(ICON_DIR, "*.gif")))

    with open(JSON_PATH, "r", encoding="utf-8") as f:
        current_list = json.load(f)

    name_to_new = {}
    for gif_path in gif_files:
        base = os.path.basename(gif_path)
        print(f"Processing {base} ...")
        new_name = process(gif_path)
        name_to_new[base] = new_name

    new_list = [name_to_new.get(n, n) for n in current_list]
    with open(JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(new_list, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print("Updated", JSON_PATH)
    print(json.dumps(new_list, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
