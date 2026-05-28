"""
Matting des clips eric avec rembg (BiRefNet ou ISNet).

Source : avatars/eric/raw/<clip>/frame_NNNN.webp
Dest   : avatars/eric/matted-<short>/<clip>/frame_NNNN.png
         (PNG avec alpha, à convertir en WebP après si voulu)

Usage :
    python scripts/matte_clips.py <model>           # tous les clips
    python scripts/matte_clips.py <model> <clip>    # un clip spécifique
    python scripts/matte_clips.py <model> --new     # uniquement clips sans output

Models supportés (rembg) :
    isnet-general-use   -> dossier matted-isnet
    birefnet-general    -> dossier matted-birefnet
    u2net_human_seg     -> dossier matted-u2net
"""
import os
import sys
import time
from rembg import remove, new_session
from PIL import Image

WEBP_QUALITY = 85
WEBP_METHOD = 6


def convert_dir_to_webp(path):
    """Convertit tous les PNG d'un dossier en WebP lossy q85 (alpha lossless) et delete les PNGs."""
    if not os.path.isdir(path):
        return 0
    converted = 0
    for f in sorted(os.listdir(path)):
        if f.lower().endswith('.png'):
            png_path = os.path.join(path, f)
            webp_path = os.path.join(path, f[:-4] + '.webp')
            try:
                img = Image.open(png_path)
                if img.mode in ('RGBA', 'LA', 'PA'):
                    img.save(webp_path, 'WEBP', quality=WEBP_QUALITY, method=WEBP_METHOD, alpha_quality=100)
                else:
                    img.convert('RGB').save(webp_path, 'WEBP', quality=WEBP_QUALITY, method=WEBP_METHOD)
                os.remove(png_path)
                converted += 1
            except Exception as e:
                print(f"    convert FAIL {f}: {e}")
    return converted

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

# Quality suffix : '' pour half (defi 480), '-full' pour full (960)
QUALITY_SUFFIX = ''

def raw_base():
    return os.path.join(PROJECT_ROOT, 'avatars', 'eric', f'raw{QUALITY_SUFFIX}')

ALL_CLIPS = ['idle-base', 'idle-col-veste', 'idle-veste', 'speek', 'speek-b']

MODEL_SHORT = {
    'isnet-general-use': 'isnet',
    'birefnet-general':  'birefnet',
    'u2net_human_seg':   'u2net',
}


def dst_dir_for(model_name, clip):
    short = MODEL_SHORT.get(model_name, model_name)
    return os.path.join(PROJECT_ROOT, 'avatars', 'eric', f'matted-{short}{QUALITY_SUFFIX}', clip)


def process_clip(session, clip, force=False):
    src_dir = os.path.join(raw_base(), clip)
    dst_dir = dst_dir_for(session_model_name, clip)
    os.makedirs(dst_dir, exist_ok=True)

    if not os.path.isdir(src_dir):
        print(f"  [skip] {clip}: source missing ({src_dir})")
        return 0

    sources = sorted(f for f in os.listdir(src_dir) if f.lower().endswith(('.webp', '.jpg', '.png')))
    n = len(sources)
    if n == 0:
        print(f"  [skip] {clip}: aucun fichier source")
        return 0

    t_clip = time.time()
    written = 0
    for i, fname in enumerate(sources):
        base = os.path.splitext(fname)[0]
        dst = os.path.join(dst_dir, f'{base}.png')

        if not force and os.path.exists(dst):
            continue

        with open(os.path.join(src_dir, fname), 'rb') as f:
            inp = f.read()
        out = remove(inp, session=session)
        with open(dst, 'wb') as f:
            f.write(out)
        written += 1

        if (i + 1) % 20 == 0 or i + 1 == n:
            elapsed = time.time() - t_clip
            rate = (i + 1) / elapsed if elapsed > 0 else 0
            print(f"    {clip}: {i+1}/{n}  ({rate:.1f} fps)")

    print(f"  [{clip}] {written} written in {time.time() - t_clip:.0f}s")
    # Convertit immédiatement le clip en WebP (sans attendre la fin globale)
    n_webp = convert_dir_to_webp(dst_dir)
    if n_webp > 0:
        print(f"  [{clip}] {n_webp} WebP converted")
    return written


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python matte_clips.py <model> [<clip>|--new] [--full]")
        sys.exit(1)

    session_model_name = sys.argv[1]
    args = sys.argv[2:]
    if '--full' in args:
        QUALITY_SUFFIX = '-full'
        args.remove('--full')
    arg2 = args[0] if args else None

    clips = ALL_CLIPS
    if arg2 and arg2 != '--new':
        clips = [arg2]
    print(f"[matte_clips] model={session_model_name} quality={'full' if QUALITY_SUFFIX else 'half'}")

    print(f"=== Modèle: {session_model_name} ===")
    print(f"Loading session...")
    t0 = time.time()
    session = new_session(session_model_name)
    print(f"Session ready in {time.time() - t0:.1f}s\n")

    for clip in clips:
        # Si --new, skip ceux qui ont déjà tout
        if arg2 == '--new':
            src_dir = os.path.join(RAW_BASE, clip)
            dst_dir = dst_dir_for(session_model_name, clip)
            if os.path.isdir(src_dir) and os.path.isdir(dst_dir):
                src_count = len([f for f in os.listdir(src_dir) if f.lower().endswith(('.webp', '.jpg'))])
                dst_count = len([f for f in os.listdir(dst_dir) if f.lower().endswith('.png')])
                if src_count > 0 and src_count == dst_count:
                    print(f"  [skip] {clip}: déjà complet ({dst_count} frames)")
                    continue
        process_clip(session, clip)

    print(f"\n=== Total time: {time.time() - t0:.0f}s ===")
