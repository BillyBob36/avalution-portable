"""
================================================================
BiRefNet HQ sur GPU Colab (free T4) — version full 960×960
================================================================

USAGE :
  1. Va sur https://colab.research.google.com/
  2. Nouveau notebook → "Modifier" → "Paramètres du notebook" → GPU = T4
  3. Zip ton dossier local 'avatars/eric/raw-full' (commande locale ci-dessous)
  4. Copie-colle chaque section ↓ dans une cellule Colab
  5. Lance les cellules dans l'ordre
  6. Télécharge le zip de sortie, décompresse dans 'avatars/eric/matted-birefnet-full'

Sur ton PC, avant Colab :
  cd "C:\\Users\\lamid\\CascadeProjects\\Avalution Portable"
  powershell Compress-Archive avatars/eric/raw-full raw-full.zip

Estimation GPU T4 : ~2-3 min pour les 273 frames (vs ~90 min sur ton CPU).
================================================================
"""

# ============================================================
# CELLULE 1 — Install (~30 s)
# ============================================================
"""
!pip uninstall -y onnxruntime onnxruntime-gpu 2>&1 | tail -1
!pip install -q rembg onnxruntime-gpu pillow
"""

# ============================================================
# CELLULE 2 — Upload du zip raw-full.zip
# ============================================================
"""
from google.colab import files
print("Upload raw-full.zip (depuis ton PC)")
uploaded = files.upload()
zip_name = list(uploaded.keys())[0]
print(f'Got: {zip_name}')
"""

# ============================================================
# CELLULE 3 — Unzip + vérification
# ============================================================
"""
import zipfile, os
SRC_ROOT = '/content/raw-full'
os.makedirs(SRC_ROOT, exist_ok=True)
with zipfile.ZipFile(zip_name) as z:
    z.extractall('/content/_extract')
# Le zip peut contenir un dossier racine — auto-détection
candidate = '/content/_extract'
inner = os.listdir(candidate)
if len(inner) == 1 and os.path.isdir(f'{candidate}/{inner[0]}'):
    candidate = f'{candidate}/{inner[0]}'
SRC_ROOT = candidate
clips = sorted([d for d in os.listdir(SRC_ROOT) if os.path.isdir(f'{SRC_ROOT}/{d}')])
print(f'Source root: {SRC_ROOT}')
for c in clips:
    n = len([f for f in os.listdir(f'{SRC_ROOT}/{c}') if f.endswith('.webp')])
    print(f'  {c}: {n} frames')
"""

# ============================================================
# CELLULE 4 — Vérif GPU
# ============================================================
"""
import onnxruntime as ort
print('Providers:', ort.get_available_providers())
assert 'CUDAExecutionProvider' in ort.get_available_providers(), 'GPU pas dispo !'
print('GPU OK')
"""

# ============================================================
# CELLULE 5 — Matting BiRefNet (cœur du process)
# ============================================================
"""
import os, glob, time
from rembg import remove, new_session

print('Loading BiRefNet (will download model ~880MB on first run)...')
t0 = time.time()
session = new_session('birefnet-general')
print(f'Session ready in {time.time()-t0:.1f}s')

OUT_BASE = '/content/matted-birefnet-full'
os.makedirs(OUT_BASE, exist_ok=True)
total_t = time.time()
for clip in clips:
    src_dir = f'{SRC_ROOT}/{clip}'
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
    elapsed = time.time() - t
    print(f'  {clip}: {len(files_list)} frames in {elapsed:.0f}s ({len(files_list)/elapsed:.2f} fps)')
print(f'\\nTotal: {time.time()-total_t:.0f}s')
"""

# ============================================================
# CELLULE 6 — Convert PNG -> WebP (compact)
# ============================================================
"""
from PIL import Image
import glob
for clip in clips:
    for png in glob.glob(f'{OUT_BASE}/{clip}/*.png'):
        Image.open(png).save(png.replace('.png', '.webp'), 'WEBP', quality=85, method=6, alpha_quality=100)
        os.remove(png)
total = sum(len(glob.glob(f'{OUT_BASE}/{c}/*.webp')) for c in clips)
print(f'WebP converted : {total} files')
"""

# ============================================================
# CELLULE 7 — Zip + download
# ============================================================
"""
import shutil
shutil.make_archive('matted-birefnet-full', 'zip', OUT_BASE)
from google.colab import files
files.download('matted-birefnet-full.zip')
"""
