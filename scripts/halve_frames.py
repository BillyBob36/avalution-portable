"""
Halve la cadence d'images : supprime une frame sur 2 (les indices impairs)
et renumérote les frames restantes pour qu'elles restent contiguës 0..N-1.

Avant : frame_0000.jpg, frame_0001.jpg, frame_0002.jpg, ... frame_0149.jpg
Après : frame_0000.jpg (← ex-0), frame_0001.jpg (← ex-2), ... frame_0074.jpg (← ex-148)

Traite récursivement tous les dossiers contenant des frames numérotées.
"""
import os
import re

# Racines à traiter (chemins relatifs)
ROOTS = [
    'frames',
    'frames-eric',
    'frames-eric-matted',
]

FRAME_RE = re.compile(r'^frame_(\d+)\.(jpg|png|webp)$', re.IGNORECASE)


def is_frame_dir(path):
    """Un dossier est un dossier de frames si > 5 fichiers matchent le pattern."""
    try:
        files = os.listdir(path)
    except (PermissionError, FileNotFoundError):
        return False
    count = sum(1 for f in files if FRAME_RE.match(f))
    return count > 5


def halve_dir(path):
    files = sorted(f for f in os.listdir(path) if FRAME_RE.match(f))
    n = len(files)
    if n == 0:
        return 0, 0

    # Garder les indices pairs, supprimer les impairs
    keep = files[::2]      # 0, 2, 4, ...
    remove = files[1::2]   # 1, 3, 5, ...

    # 1) Supprimer les impairs
    for f in remove:
        os.remove(os.path.join(path, f))

    # 2) Renommer les survivants en deux passes pour éviter conflits
    # Pass 1 : -> _tmp_NNNN.ext
    for new_idx, old_name in enumerate(keep):
        m = FRAME_RE.match(old_name)
        ext = m.group(2)
        os.rename(
            os.path.join(path, old_name),
            os.path.join(path, f'_tmp_{new_idx:04d}.{ext}')
        )
    # Pass 2 : _tmp_NNNN.ext -> frame_NNNN.ext
    for new_idx, old_name in enumerate(keep):
        m = FRAME_RE.match(old_name)
        ext = m.group(2)
        os.rename(
            os.path.join(path, f'_tmp_{new_idx:04d}.{ext}'),
            os.path.join(path, f'frame_{new_idx:04d}.{ext}')
        )

    return n, len(keep)


def walk_and_halve(root):
    print(f"\n=== {root}/ ===")
    total_kept = 0
    total_before = 0
    total_dirs = 0

    for dirpath, dirs, files in os.walk(root):
        if is_frame_dir(dirpath):
            before, after = halve_dir(dirpath)
            total_before += before
            total_kept += after
            total_dirs += 1
            rel = os.path.relpath(dirpath, root)
            print(f"  {rel:60} {before:4} -> {after:4}")

    print(f"  TOTAL : {total_dirs} dossiers, {total_before} -> {total_kept} frames")


if __name__ == '__main__':
    for root in ROOTS:
        if os.path.isdir(root):
            walk_and_halve(root)
        else:
            print(f"SKIP : {root} (n'existe pas)")
    print("\nDone.")
