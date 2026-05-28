"""Script Python à exécuter sur Colab pour BiRefNet HQ sur frames Eric full quality."""
import os
import glob
import time
import zipfile
from rembg import remove, new_session
from PIL import Image

# 1. Setup
RAW_BASE = '/content/raw-full'
OUT_BASE = '/content/matted-birefnet-full'
os.makedirs(OUT_BASE, exist_ok=True)

clips = sorted([d for d in os.listdir(RAW_BASE) if os.path.isdir(f'{RAW_BASE}/{d}')])
print(f'Clips found: {clips}')

# 2. Charge BiRefNet sur GPU
print('Loading BiRefNet (model ~880MB on first run)...')
t0 = time.time()
session = new_session('birefnet-general')
print(f'Session ready in {time.time()-t0:.1f}s')

# 3. Matting
t_total = time.time()
for clip in clips:
    src_dir = f'{RAW_BASE}/{clip}'
    dst_dir = f'{OUT_BASE}/{clip}'
    os.makedirs(dst_dir, exist_ok=True)
    files_list = sorted(glob.glob(f'{src_dir}/*.webp'))
    t = time.time()
    for src in files_list:
        with open(src, 'rb') as f:
            data = f.read()
        out = remove(data, session=session)
        dst = os.path.join(dst_dir, os.path.basename(src).replace('.webp', '.png'))
        with open(dst, 'wb') as f:
            f.write(out)
    e = time.time() - t
    print(f'  {clip}: {len(files_list)} frames in {e:.0f}s ({len(files_list)/e:.2f} fps)')

print(f'\nTotal matting: {time.time()-t_total:.0f}s')

# 4. Convert PNG -> WebP lossy q85
print('Converting PNG to WebP...')
total_webp = 0
for clip in clips:
    for png in glob.glob(f'{OUT_BASE}/{clip}/*.png'):
        webp = png.replace('.png', '.webp')
        Image.open(png).save(webp, 'WEBP', quality=85, method=6, alpha_quality=100)
        os.remove(png)
        total_webp += 1
print(f'Converted {total_webp} frames to WebP')

# 5. Zip
print('Zipping...')
import shutil
shutil.make_archive('/content/matted-birefnet-full', 'zip', OUT_BASE)
size = os.path.getsize('/content/matted-birefnet-full.zip')
print(f'Done. Archive size: {size/1024/1024:.1f} Mo')
