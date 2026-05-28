"""
Extrait TOUS les clips Eric à la résolution full (960×960) + halve + WebP q85.
Tronque speek et speek-b à 81 frames (suppression des 27 dernières).

Output : avatars/eric/raw-full/<clip>/frame_NNNN.webp
"""
import os
import cv2
from PIL import Image

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SRC_DIR = os.path.join(PROJECT_ROOT, 'assets', 'source-videos')
DST_BASE = os.path.join(PROJECT_ROOT, 'avatars', 'eric', 'raw-full')

CLIPS = [
    {'src': 'eric-idle-base.mp4', 'dst': 'idle-base',      'truncate': None},
    {'src': 'eric-col-veste.mp4', 'dst': 'idle-col-veste', 'truncate': None},
    {'src': 'eric-veste.mp4',     'dst': 'idle-veste',     'truncate': None},
    {'src': 'eric-parle.mp4',     'dst': 'speek',          'truncate': 81},
    {'src': 'eric-parle-b.mp4',   'dst': 'speek-b',        'truncate': 81},
]


def extract(src_path, dst_dir, truncate=None):
    cap = cv2.VideoCapture(src_path)
    if not cap.isOpened():
        print(f"  FAIL ouverture {src_path}")
        return 0

    os.makedirs(dst_dir, exist_ok=True)
    src_idx, written = 0, 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if src_idx % 2 == 0:                            # halve : 1 frame sur 2
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            Image.fromarray(rgb).save(
                os.path.join(dst_dir, f'frame_{written:04d}.webp'),
                'WEBP', quality=85, method=6
            )
            written += 1
            if truncate is not None and written >= truncate:
                break
        src_idx += 1
    cap.release()
    return written


if __name__ == '__main__':
    for clip in CLIPS:
        src = os.path.join(SRC_DIR, clip['src'])
        dst = os.path.join(DST_BASE, clip['dst'])
        n = extract(src, dst, clip['truncate'])
        print(f"  {clip['dst']:20} : {n} frames (full 960×960, WebP q85)")
    print("\nDone.")
