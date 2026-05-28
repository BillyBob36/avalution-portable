# Avalution Portable

Avatar conversationnel temps réel avec lip-sync intelligent, sur fond modifiable.

## Architecture rapide

- **Frontend statique** servi par un serveur Node Express (`server.js`)
- **3 moteurs de voix au choix** dans le panel paramètres :
  - **Azure GPT-Realtime 1.5** (default) — chat + TTS combinés en une WS, voix `verse`
  - **Azure Speech Neural** — voix françaises natives (Henri, Claude…)
  - **Mistral Voxtral** — 30 voix preset (Marie FR, Paul US, Oliver UK, Jane UK)
- **3 méthodes de détourage** :
  - **ISNet** (default) — équilibre qualité/vitesse, prêt
  - **BiRefNet HQ** — state-of-the-art, en cours de pré-calcul
  - **Temps réel JS** — chroma key client avec sliders tunables
- **1 avatar : Eric** (DSI corporate, costume bleu marine ouvert, chemise bleu ciel)
- **4 clips d'animation** :
  - `idle-base` (61 frames) — pose mains jointes, joué 2× plus souvent
  - `idle-col-veste` (37 frames) — variation rajustement col
  - `idle-veste` (37 frames) — variation rajustement veste
  - `speek` (108 frames) — clip de parole pour lip-sync

## Structure des dossiers

```
Avalution Portable/
├── server.js                       Backend Express (3 engines)
├── app.js                          Frontend (lip-sync + clip switching)
├── index.html, styles.css          UI
├── .env                            Clés Azure + Mistral
│
├── assets/                         Fichiers sources (lecture seule)
│   ├── source-photo/eric-base.jpeg
│   ├── source-videos/              Vidéos d'origine
│   │   ├── eric-idle-base.mp4     (24 fps, 121 frames, 5s)
│   │   ├── eric-col-veste.mp4     (24 fps, 73 frames, 3s)
│   │   ├── eric-veste.mp4         (24 fps, 73 frames, 3s)
│   │   └── eric-parle.mp4         (30 fps, 216 frames, 7s, speek source)
│   ├── generated-portraits/        Portraits DSI générés via gpt-image-2
│   └── voice-samples/              Samples FR (pangrammes, eric-parle audio)
│
├── backgrounds/                    Fonds composite 1024×1024 cool/warm
│   └── office-{1..4}.png           Open space, datacenter, NOC, couloir
│
├── avatars/                        Frames d'animation
│   └── eric/
│       ├── raw/                    Frames brutes (fond gris #808080)
│       │   ├── idle-base/          61 frames .webp 480×480
│       │   ├── idle-col-veste/     37 frames .webp
│       │   ├── idle-veste/         37 frames .webp
│       │   └── speek/              108 frames .webp
│       ├── matted-isnet/           Détouré par ISNet (rembg)
│       │   ├── idle-base/, idle-col-veste/, idle-veste/, speek/
│       └── matted-birefnet/        Détouré par BiRefNet HQ
│           └── (même structure, partiel en cours)
│
├── scripts/                        Utilitaires Python
│   ├── extract_eric_frames.py      Extrait frames depuis idle/speek mp4 (legacy)
│   ├── extract_idle_clips.py       Extrait nouvelles vidéos idle (col-veste, veste)
│   ├── matte_clips.py              Matting rembg par clip + modèle
│   ├── convert_to_webp.py          Convert .jpg/.png → .webp lossy q85
│   ├── halve_frames.py             Halve frame count (1 sur 2)
│   └── upload_fr_voices.py         Upload voice clones Mistral (requires paid plan)
│
└── backups/                        Sauvegardes des frames originales (full quality)
```

## Système d'idle aléatoire pondéré

Pendant l'idle (entre messages), l'avatar joue un cycle d'accordéon. À chaque fin de cycle (retour à frame 0), un nouveau clip est tiré aléatoirement dans un pool pondéré :

```
Pool = [idle-base, idle-base, idle-col-veste, idle-veste]
       ↑──────────────────↑              ↑               ↑
        50% (poids 2)      25% (poids 1) 25% (poids 1)
```

Configuré dans `AVATARS.eric.clips[<name>].weight` dans `app.js`.

## Démarrage

```bash
npm install                   # une fois
node server.js                # lance sur localhost:3000
```

Ou via Claude Preview :

```bash
preview_start avalution-portable
```

## Lip-sync intelligent

Chaque réponse audio est analysée pour détecter les silences (algo RMS par fenêtres de 50ms, seuil 0.02, durée min 0.7s). La timeline alterne ensuite des segments `speak` (bouche animée) et `idle` (bouche fermée), avec un accordéon adaptatif qui ajuste l'amplitude (`maxFrame`) et le nombre de cycles pour caser pile dans la durée de chaque segment.

Code : `app.js` → `detectSilenceSegments`, `buildAnimationTimeline`, `createSegment`, `animateWithTimeline`.
