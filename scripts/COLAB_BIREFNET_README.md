# BiRefNet HQ sur GPU Colab (free T4)

Détourage des frames Eric en full 960×960 sur GPU gratuit → **~50× plus rapide** que ton CPU local.
- CPU local : ~90 min pour les 273 frames full
- GPU Colab T4 : ~2-3 min

## Procédure

### 1. Zip le dossier raw-full local

```powershell
cd "C:\Users\lamid\CascadeProjects\Avalution Portable"
powershell Compress-Archive -Path avatars\eric\raw-full -DestinationPath raw-full.zip
```

Tu obtiens `raw-full.zip` (~8 Mo) à la racine du projet.

### 2. Ouvre Colab

1. https://colab.research.google.com/
2. **Fichier → Nouveau notebook**
3. **Exécution → Modifier le type d'exécution → GPU T4** (free tier)

### 3. Copie-colle les 7 cellules

Ouvre [`scripts/colab_birefnet_full.py`](colab_birefnet_full.py) — chaque section délimitée par `# CELLULE N` correspond à **une cellule Colab**.

Pour chaque section :
- Crée une nouvelle cellule dans Colab (`+ Code`)
- Copie le contenu **entre les triple-quotes `"""`** (sans les triple-quotes)
- Lance la cellule (Shift+Enter)

Ordre des cellules :
1. **Install** (~30 s, install rembg + onnxruntime-gpu)
2. **Upload** (sélectionne `raw-full.zip` depuis ton PC)
3. **Unzip + vérif** (devrait afficher : 5 clips de 37 ou 81 frames)
4. **Vérif GPU** (assertion CUDAExecutionProvider)
5. **Matting** (~2-3 min, c'est le gros morceau)
6. **PNG → WebP** (compresse les sorties, ~10 s)
7. **Download** (récupère `matted-birefnet-full.zip` sur ton PC)

### 4. Décompresse côté local

```powershell
cd "C:\Users\lamid\CascadeProjects\Avalution Portable"
powershell Expand-Archive -Path "$env:USERPROFILE\Downloads\matted-birefnet-full.zip" -DestinationPath "avatars\eric\matted-birefnet-full" -Force
```

La structure finale doit être :
```
avatars/eric/matted-birefnet-full/
├── idle-base/       37 .webp
├── idle-col-veste/  37 .webp
├── idle-veste/      37 .webp
├── speek/           81 .webp
└── speek-b/         81 .webp
```

### 5. Recharge l'app

Ouvre les paramètres → "Qualité" → Full (960×960).
Tu peux maintenant choisir BiRefNet HQ en pleine résolution.

## Notes

- Le GPU T4 free a une limite de session ~12h, largement suffisant pour ce job
- Le modèle BiRefNet (~880 Mo) est téléchargé à la première exécution dans Colab, puis caché tant que la session reste active
- Si tu veux refaire plusieurs fois (test des params), garde la session ouverte → le modèle est déjà en RAM GPU
