"""
Pré-détourage des frames Eric avec plusieurs modèles rembg pour comparaison.

Output : frames-eric-matted/<model>/{idle,speek}/demi/frame_NNNN.png
         (PNG RGBA avec alpha propre, prêts à servir tels quels)

Modèles testés :
  - birefnet-general    : state-of-the-art 2024, le + précis (le + lent)
  - isnet-general-use   : bon compromis qualité/vitesse
  - u2net_human_seg     : optimisé silhouette humaine, rapide
"""
import os
import sys
import time
from rembg import remove, new_session

INPUT_BASE = 'frames-eric'
OUTPUT_BASE = 'frames-eric-matted'
QUALITY = 'demi'

MODELS = [
    'u2net_human_seg',       # commence par le + rapide
    'isnet-general-use',
    'birefnet-general',      # finit par le + précis (modèle ~880 Mo)
]

MODES = ['idle', 'speek']


def process_model(model_name):
    print(f"\n=== Modèle : {model_name} ===")
    t0 = time.time()
    try:
        session = new_session(model_name)
    except Exception as e:
        print(f"  ERREUR chargement modèle : {e}")
        return

    print(f"  Session ready in {time.time() - t0:.1f}s")

    for mode in MODES:
        input_dir = os.path.join(INPUT_BASE, mode, QUALITY)
        output_dir = os.path.join(OUTPUT_BASE, model_name, mode, QUALITY)
        os.makedirs(output_dir, exist_ok=True)

        if not os.path.isdir(input_dir):
            print(f"  Skip {mode}: input dir missing")
            continue

        # Accepte .jpg ou .webp en entrée (post-conversion WebP)
        files = sorted(f for f in os.listdir(input_dir)
                       if f.lower().endswith(('.jpg', '.webp')))
        n = len(files)
        t_mode = time.time()

        for i, fname in enumerate(files):
            inp = os.path.join(input_dir, fname)
            # Output toujours en .png (avec alpha, sera converti en webp après)
            base = os.path.splitext(fname)[0]
            out = os.path.join(output_dir, base + '.png')

            with open(inp, 'rb') as f:
                input_bytes = f.read()
            output_bytes = remove(input_bytes, session=session)
            with open(out, 'wb') as f:
                f.write(output_bytes)

            if (i + 1) % 30 == 0 or i + 1 == n:
                elapsed = time.time() - t_mode
                rate = (i + 1) / elapsed if elapsed > 0 else 0
                eta = (n - i - 1) / rate if rate > 0 else 0
                print(f"  {mode}: {i+1}/{n}  ({rate:.1f} fps, ETA {eta:.0f}s)")

    print(f"=== {model_name} terminé en {time.time() - t0:.0f}s ===")


if __name__ == '__main__':
    models = sys.argv[1:] if len(sys.argv) > 1 else MODELS
    t_start = time.time()
    for m in models:
        process_model(m)
    print(f"\nTOUT TERMINÉ en {time.time() - t_start:.0f}s")
