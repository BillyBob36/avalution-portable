"""Fix zip Windows-flat structure + matting + WebP convert + zip download."""
import os
import shutil
import glob
import time
import zipfile
from rembg import remove, new_session
from PIL import Image

RAW_BASE = '/content/raw-full'
OUT_BASE = '/content/matted-birefnet-full'

# 1. Fix flat structure with backslashes (Windows zip)
print('Fixing flat backslash-named files...')
flat_files = [f for f in os.listdir(RAW_BASE) if '\\' in f and os.path.isfile(f'{RAW_BASE}/{f}')]
print(f'  {len(flat_files)} flat files to relocate')
for f in flat_files:
    clip, name = f.split('\\', 1)
    target_dir = f'{RAW_BASE}/{clip}'
    os.makedirs(target_dir, exist_ok=True)
    shutil.move(f'{RAW_BASE}/{f}', f'{target_dir}/{name}')

clips = sorted([d for d in os.listdir(RAW_BASE) if os.path.isdir(f'{RAW_BASE}/{d}')])
print(f'Clips: {clips}')
for c in clips:
    print(f'  {c}: {len(os.listdir(f"{RAW_BASE}/{c}"))} frames')

# 2. BiRefNet
os.makedirs(OUT_BASE, exist_ok=True)
print('\nLoading BiRefNet...')
t0 = time.time()
session = new_session('birefnet-general')
print(f'Session ready in {time.time()-t0:.1f}s')

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

# 3. PNG -> WebP q85
print('Converting PNG to WebP...')
n_webp = 0
for clip in clips:
    for png in glob.glob(f'{OUT_BASE}/{clip}/*.png'):
        webp = png.replace('.png', '.webp')
        Image.open(png).save(webp, 'WEBP', quality=85, method=6, alpha_quality=100)
        os.remove(png)
        n_webp += 1
print(f'Converted {n_webp} frames')

# 4. Zip
print('Zipping output...')
shutil.make_archive('/content/matted-birefnet-full', 'zip', OUT_BASE)
size = os.path.getsize('/content/matted-birefnet-full.zip')
print(f'Done. matted-birefnet-full.zip = {size/1024/1024:.1f} Mo')
