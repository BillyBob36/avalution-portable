"""
Convertit toutes les frames JPG/PNG en WebP lossy q85.
- JPG (RGB)   -> WebP RGB lossy q85
- PNG RGBA    -> WebP RGBA lossy q85 (alpha lossless préservé via Pillow)

Re-runnable : skip les fichiers déjà convertis.
Ne touche pas aux dossiers backups (*-backup-orig).
"""
import os
import sys
from PIL import Image

QUALITY = 85
METHOD = 6  # Pillow webp method 0-6, 6 = slowest mais meilleur ratio

# Targets par défaut (peut être surchargé par args CLI)
DEFAULT_TARGETS = [
    'frames',
    'frames-eric',
    'frames-eric-matted',
]

SKIP_PATTERNS = ['backup-orig', '__pycache__']


def should_skip_dir(path):
    return any(pat in path for pat in SKIP_PATTERNS)


def convert_one(src, dst):
    img = Image.open(src)
    if src.lower().endswith('.png') and img.mode in ('RGBA', 'LA', 'PA'):
        # Préserve alpha avec WebP lossy (alpha en mode lossless dans le fichier)
        img.save(dst, 'WEBP', quality=QUALITY, method=METHOD, alpha_quality=100)
    else:
        # JPG ou PNG sans alpha -> WebP RGB lossy
        if img.mode != 'RGB':
            img = img.convert('RGB')
        img.save(dst, 'WEBP', quality=QUALITY, method=METHOD)


def convert_dir(path):
    files = sorted(os.listdir(path))
    src_files = [f for f in files if f.lower().endswith(('.jpg', '.jpeg', '.png'))]
    if not src_files:
        return 0, 0

    converted = 0
    skipped = 0
    for f in src_files:
        src = os.path.join(path, f)
        base = os.path.splitext(f)[0]
        dst = os.path.join(path, base + '.webp')

        if os.path.exists(dst):
            skipped += 1
            continue

        try:
            convert_one(src, dst)
            os.remove(src)
            converted += 1
        except Exception as e:
            print(f"  FAIL {f}: {e}")

    return converted, skipped


def walk_convert(root):
    print(f"\n=== {root} ===")
    total_conv, total_skip = 0, 0
    for dirpath, dirs, files in os.walk(root):
        # Filtre les sous-dossiers
        dirs[:] = [d for d in dirs if not should_skip_dir(os.path.join(dirpath, d))]
        if should_skip_dir(dirpath):
            continue
        c, s = convert_dir(dirpath)
        if c > 0 or s > 0:
            rel = os.path.relpath(dirpath, root)
            print(f"  {rel:60} conv={c:4} skip={s:4}")
        total_conv += c
        total_skip += s
    print(f"  TOTAL : {total_conv} converted, {total_skip} skipped (already webp)")


if __name__ == '__main__':
    targets = sys.argv[1:] if len(sys.argv) > 1 else DEFAULT_TARGETS
    for t in targets:
        if os.path.isdir(t) and not should_skip_dir(t):
            walk_convert(t)
        else:
            print(f"SKIP {t}")
    print("\nDone.")
