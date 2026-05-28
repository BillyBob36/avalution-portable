"""
Extrait les nouvelles vidéos idle (col-veste, veste) en :
  - demi quality (480x480, scale 0.5)
  - 1 frame sur 2 (halve)
  - WebP lossy q85
  -> avatars/eric/raw/<nom-clip>/frame_NNNN.webp

Re-runnable : skip si l'output existe déjà.
"""
import cv2
import os
import sys
from PIL import Image
import numpy as np

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SOURCE_DIR = os.path.join(PROJECT_ROOT, 'assets', 'source-videos')
OUTPUT_BASE = os.path.join(PROJECT_ROOT, 'avatars', 'eric', 'raw')

CLIPS = [
    {'src': 'eric-col-veste.mp4', 'dst': 'idle-col-veste'},
    {'src': 'eric-veste.mp4',     'dst': 'idle-veste'},
]

SCALE = 0.5              # demi
WEBP_QUALITY = 85
WEBP_METHOD = 6


def extract(src_path, dst_dir):
    os.makedirs(dst_dir, exist_ok=True)

    cap = cv2.VideoCapture(src_path)
    if not cap.isOpened():
        print(f"  ERREUR : impossible d'ouvrir {src_path}")
        return 0

    fps = cap.get(cv2.CAP_PROP_FPS)
    fc = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    new_w, new_h = int(w * SCALE), int(h * SCALE)

    print(f"  {os.path.basename(src_path)} : {fps:.0f}fps, {fc}f, {w}x{h} -> demi {new_w}x{new_h}, halve")

    written = 0
    src_idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if src_idx % 2 == 0:                # garde 1 frame sur 2
            resized = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_AREA)
            # BGR -> RGB pour PIL
            rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
            img = Image.fromarray(rgb)
            dst_file = os.path.join(dst_dir, f'frame_{written:04d}.webp')
            img.save(dst_file, 'WEBP', quality=WEBP_QUALITY, method=WEBP_METHOD)
            written += 1

        src_idx += 1

    cap.release()
    return written


if __name__ == '__main__':
    for clip in CLIPS:
        src = os.path.join(SOURCE_DIR, clip['src'])
        dst = os.path.join(OUTPUT_BASE, clip['dst'])
        print(f"\n--- {clip['dst']} ---")
        if os.path.isdir(dst) and len(os.listdir(dst)) > 0:
            n = len([f for f in os.listdir(dst) if f.endswith('.webp')])
            print(f"  Skip (already {n} frames)")
            continue
        n = extract(src, dst)
        print(f"  {n} frames extraites en WebP demi")
    print("\nDone.")
