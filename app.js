/**
 * Avalution Portable - système de lip-sync minimal
 * --------------------------------------------------
 * Le cerveau du lip-sync (inchangé depuis avalution2) :
 *   1. detectSilenceSegments() - scan RMS de l'audio par fenêtres de 50 ms,
 *      détecte les silences réels (>= minSilenceDuration secondes).
 *   2. buildAnimationTimeline() - alterne segments speak (bouche qui s'ouvre)
 *      et idle (bouche fermée) sur la durée totale de l'audio.
 *   3. createSegment() - pour chaque segment, calcule combien d'allers-retours
 *      d'accordéon caser dans sa durée, et avec quelle amplitude (maxFrame),
 *      pour que ça tombe pile à la fin du segment.
 *   4. animateWithTimeline() - à chaque RAF, dérive la frame à afficher
 *      depuis audioContext.currentTime (resync continu).
 *
 * Catalogue d'avatars : sélection via ?avatar=<key> dans l'URL.
 * Les avatars peuvent avoir des frame counts différents par mode (idle/speak).
 */

// ============================================================
// 3 ENGINES DE VOIX :
//   - mistral        : Azure nano (chat) + Mistral Voxtral (TTS)
//   - azure_tts      : Azure nano (chat) + Azure Speech (TTS, voix FR natives)
//   - azure_realtime : Azure GPT-Realtime 1.5 (single WS API)
// ============================================================

// Azure Speech Services - voix françaises natives (Neural) + multilingues
const AZURE_VOICES = [
    // Masculines FR natives
    { id: 'fr-FR-HenriNeural',         label: '🇫🇷 Henri (M, FR natif)' },
    { id: 'fr-FR-ClaudeNeural',        label: '🇫🇷 Claude (M, FR natif)' },
    { id: 'fr-FR-AlainNeural',         label: '🇫🇷 Alain (M, FR natif)' },
    { id: 'fr-FR-MauriceNeural',       label: '🇫🇷 Maurice (M, FR natif)' },
    { id: 'fr-FR-JeromeNeural',        label: '🇫🇷 Jérôme (M, FR natif)' },
    { id: 'fr-FR-YvesNeural',          label: '🇫🇷 Yves (M, FR natif)' },
    { id: 'fr-FR-AntoineNeural',       label: '🇫🇷 Antoine (M, FR natif)' },
    { id: 'fr-FR-RemyMultilingualNeural', label: '🇫🇷 Rémy (M, multilingue)' },
    // Féminines FR natives
    { id: 'fr-FR-DeniseNeural',        label: '🇫🇷 Denise (F, FR natif)' },
    { id: 'fr-FR-EloiseNeural',        label: '🇫🇷 Éloïse (F, FR natif)' },
    { id: 'fr-FR-BrigitteNeural',      label: '🇫🇷 Brigitte (F, FR natif)' },
    { id: 'fr-FR-JosephineNeural',     label: '🇫🇷 Joséphine (F, FR natif)' },
    { id: 'fr-FR-VivienneMultilingualNeural', label: '🇫🇷 Vivienne (F, multilingue)' },
];

// Azure GPT-Realtime voix (OpenAI realtime preset)
const REALTIME_VOICES = [
    { id: 'echo',    label: 'Echo (M, posé)' },
    { id: 'onyx',    label: 'Onyx (M, grave)' },
    { id: 'ash',     label: 'Ash (M, jeune)' },
    { id: 'verse',   label: 'Verse (M, chaud)' },
    { id: 'ballad',  label: 'Ballad (M, britannique)' },
    { id: 'cedar',   label: 'Cedar (M, naturel)' },
    { id: 'alloy',   label: 'Alloy (neutre)' },
    { id: 'fable',   label: 'Fable (M, British)' },
    { id: 'nova',    label: 'Nova (F)' },
    { id: 'shimmer', label: 'Shimmer (F)' },
    { id: 'coral',   label: 'Coral (F)' },
    { id: 'sage',    label: 'Sage (F)' },
    { id: 'marin',   label: 'Marin (F, naturel)' },
];

// Mistral Voxtral - 30 voix preset (multilingue 9 langues)
// Tri : FR natif (zéro accent) → UK (accent UK) → US (accent US fort en FR).
const MISTRAL_VOICES = [
    // Français natif — sans accent (recommandées pour parler français)
    { id: '5a271406-039d-46fe-835b-fbbb00eaf08d', label: '🇫🇷 Marie · Neutre' },
    { id: '49d024dd-981b-4462-bb17-74d381eb8fd7', label: '🇫🇷 Marie · Heureuse' },
    { id: '2f62b1af-aea3-4079-9d10-7ca665ee7243', label: '🇫🇷 Marie · Enthousiaste' },
    { id: 'e0580ce5-e63c-4cbe-88c8-a983b80c5f1f', label: '🇫🇷 Marie · Curieuse' },
    { id: '4adeb2c6-25a3-44bc-8100-5234dfc1193b', label: '🇫🇷 Marie · Triste' },
    { id: 'a7c07cdc-1c35-4d87-a938-c610a654f600', label: '🇫🇷 Marie · Énervée' },

    // Voix masculines UK (accent UK, plus doux que US en FR)
    { id: 'e3596645-b1af-469e-b857-f18ddedc7652', label: '🇬🇧 Oliver · Neutre (M)' },
    { id: '8169ab87-bc99-4669-a5ec-6855860ace24', label: '🇬🇧 Oliver · Confiant (M)' },
    { id: 'e8e5b1de-493c-4061-8414-e2170f9f4b6f', label: '🇬🇧 Oliver · Enthousiaste (M)' },
    { id: '5ad5d44e-6b4e-4a57-a8a8-4cae088034ed', label: '🇬🇧 Oliver · Enjoué (M)' },
    { id: '390c8a2b-60a6-4882-8437-c49a8bd33b63', label: '🇬🇧 Oliver · Curieux (M)' },
    { id: 'd4101b8f-12c3-450d-a812-7d700b3a3245', label: '🇬🇧 Oliver · Triste (M)' },
    { id: '862274a7-8333-48f7-b668-f19c932999e0', label: '🇬🇧 Oliver · En colère (M)' },

    // Voix féminines UK
    { id: '82c99ee6-f932-423f-a4a3-d403c8914b8d', label: '🇬🇧 Jane · Neutre (F)' },
    { id: 'cbe96cf0-85ec-4a10-accb-0b35c93b6dfd', label: '🇬🇧 Jane · Confiante (F)' },
    { id: '5de47977-6e47-4266-a938-3bc1d76b4676', label: '🇬🇧 Jane · Curieuse (F)' },
    { id: 'a3e41ea8-020b-44c0-8d8b-f6cc03524e31', label: '🇬🇧 Jane · Sarcasme (F)' },
    { id: '7d0a90a3-c211-4489-aaa0-61269299edc7', label: '🇬🇧 Jane · Perplexe (F)' },
    { id: '60844938-221d-4d1e-8233-34203f787d9f', label: '🇬🇧 Jane · Frustrée (F)' },
    { id: 'e7168caa-f7ed-4e1c-98a1-434251f4f2b0', label: '🇬🇧 Jane · Jalouse (F)' },
    { id: '230ccacf-8800-4aa0-8ac2-8d004f1d9fb7', label: '🇬🇧 Jane · Gênée (F)' },
    { id: 'c7a8eb83-5247-4540-89f3-6650d349100d', label: '🇬🇧 Jane · Triste (F)' },

    // Voix US (accent US, le plus marqué en FR)
    { id: 'c69964a6-ab8b-4f8a-9465-ec0925096ec8', label: '🇺🇸 Paul · Neutre (M)' },
    { id: '98559b22-62b5-4a64-a7cd-fc78ca41faa8', label: '🇺🇸 Paul · Confiant (M)' },
    { id: '01d985cd-5e0c-4457-bfd8-80ba31a5bc03', label: '🇺🇸 Paul · Enjoué (M)' },
    { id: '1024d823-a11e-43ee-bf3d-d440dccc0577', label: '🇺🇸 Paul · Heureux (M)' },
    { id: '5940190b-f58a-4c3e-8264-a40d63fd6883', label: '🇺🇸 Paul · Enthousiaste (M)' },
    { id: '1f017bcb-02e5-460d-989b-db065c0c6122', label: '🇺🇸 Paul · Frustré (M)' },
    { id: '530e2e20-58e2-45d8-b0a5-4594f4915944', label: '🇺🇸 Paul · Triste (M)' },
    { id: 'cb891218-482c-4392-9878-91e8d999d57a', label: '🇺🇸 Paul · En colère (M)' },
];

// Fish Audio - voix masculines françaises clonées (s2-pro, ~1s latence)
// Top 20 sélectionnées par task_count (popularité d'usage) après filtre :
//   - exclu personnalités publiques nommées explicitement
//   - exclu tags character/animated/playful (style anime/meme)
//   - garde tags professional/narration/calm/deep/conversational
const FISH_VOICES = [
    { id: '7e327849fe89489387cb3e016c714834', label: '🎙️ Narrateur HxH (M, grave)' },
    { id: '4f2a0684dd0247dda68f339738c780e6', label: '🎙️ Le narrateur (M, cinématique)' },
    { id: '6e10fb8946b34ba6bec447789ccdc3de', label: '🧘 Voix stoïque (M, calme)' },
    { id: '6d3a8a05a287483ab32da9891d7f7fc9', label: '🎙️ Unique (M, autoritaire)' },
    { id: 'd1e5c6c4b9694cde8048824ce8116279', label: '📰 Frances 2 (M, sérieux)' },
    { id: 'daa5fc69eff7437eb1dfe4e2578ca2e9', label: '🎙️ Morpheus (M, mystérieux)' },
    { id: 'dde9b1e929bd43c0a9c6dd1e502f4f82', label: '📚 SLAX (M, pédago)' },
    { id: '90c509388f5946e9805c41dcccd93fb7', label: '🧠 Le penseur (M, posé)' },
    { id: '7a077671da5949589da605a31bcde05e', label: '📺 Voix Secret Story (M, grave)' },
    { id: '081eafb4e2974f68b5b13d20b8f5995f', label: '🎙️ Le narrateur 2 (M, narration)' },
    { id: '333fdf6838534ddd8f2ad8a71f0924a8', label: '📖 Narrateur HxH 2 (M, conteur)' },
    { id: 'b6efa2e7896645c28589046c576ddb2e', label: '🎬 Voix documentaire (M, calme)' },
    { id: '005138dcb4cb481d8e1b57b9a2ab5633', label: '💬 Arnold (M, conversationnel)' },
    { id: '276bd156a53f4a0199fff081bf083fc8', label: '🎓 Bon à savoir (M, autoritaire)' },
    { id: 'f315cac8d48d4449ad73ac0f96099acd', label: '🧙 Vieux sage (M, profond)' },
    { id: 'f30a4881085d42a1b073a1ca31a67cd8', label: '🎙️ Arnold 2 (M, social media)' },
    { id: '0d494e6f958c4f96b7aafeec9cc0e460', label: '🎙️ Aaaaaw (M, narration)' },
    { id: '0e05ee9f8c1f4ceb9ea924a62d7fbad4', label: '🗣️ Gabonais (M, autoritaire)' },
    { id: 'a2dff3a6e6fa400583f90ce83454c99e', label: '🔔 Mara (M, posé)' },
    { id: '150a7a6783d84b5298c8c28f33bfe6b8', label: '🎸 Voix rock (M, cinématique)' },
];

// Map engine → catalogue + label
const VOICE_ENGINES = {
    azure_tts: {
        label: '🇫🇷 Azure Speech (Henri/Claude FR natifs)',
        voices: AZURE_VOICES,
        defaultVoice: 'fr-FR-HenriNeural',
    },
    mistral: {
        label: 'Mistral Voxtral (Marie FR / Paul / Oliver / Jane)',
        voices: MISTRAL_VOICES,
        defaultVoice: '5a271406-039d-46fe-835b-fbbb00eaf08d',  // Marie Neutre
    },
    azure_realtime: {
        label: '⚡ Azure GPT-Realtime 1.5 (chat+TTS combinés)',
        voices: REALTIME_VOICES,
        defaultVoice: 'echo',
    },
    fish_audio: {
        label: '🐟 Fish Audio s2-pro (voix FR clonées)',
        voices: FISH_VOICES,
        defaultVoice: '4f2a0684dd0247dda68f339738c780e6',  // Le narrateur
    },
};

const AVATARS = {
    eric: {
        name: 'Eric (DSI)',
        fps: 15,                                // halved 30 → 15
        engine: 'azure_realtime',               // default : single API chat+TTS combinés
        voice: 'verse',                         // verse = voix M chaude pour Realtime

        // Clips disponibles avec leurs frame counts et poids dans le pool d'idle.
        // weight = null pour les modes non-idle (speak)
        clips: {
            'idle-base':      { count: 37, isVariation: false },   // clip de base, joué 2-5 fois entre chaque variation
            'idle-col-veste': { count: 37, isVariation: true  },   // variation col veste
            'idle-veste':     { count: 37, isVariation: true  },   // variation veste seule
            'speek':          { count: 81 },                        // tronqué de 108→81 (suppression des 27 dernières frames)
            'speek-b':        { count: 81 },                        // variante speak alternative
        },
        defaultIdleClip: 'idle-base',
        speakClip: 'speek',                                         // fallback / clip initial
        speakClips: ['speek', 'speek-b'],                           // alternance stricte (jamais 2× la même d'affilée)

        // Chroma key (utilisé seulement quand mattingMethod = 'realtime')
        removeBackground: true,
        chromaKey: {
            targetLuma: 128,
            satRange: 40,
            lumaRange: 80,
            transparentAbove: 0.55,
            opaqueBelow: 0.25,
            edgeFlood: true,
        },

        // Méthodes de détourage. basePath + clip = chemin final {basePath}/{clip}/frame_NNNN.{ext}
        mattingMethods: {
            realtime: {
                label: 'Temps réel JS (tunable)',
                basePath:     'avatars/eric/raw',
                basePathFull: 'avatars/eric/raw-full',
                ext: 'webp',
                useChromaKey: true,
            },
            'isnet-general-use': {
                label: 'ISNet (équilibre)',
                basePath:     'avatars/eric/matted-isnet',
                basePathFull: 'avatars/eric/matted-isnet-full',
                ext: 'webp',
                useChromaKey: false,
            },
            'birefnet-general': {
                label: 'BiRefNet HQ (state-of-art)',
                basePath:     'avatars/eric/matted-birefnet',
                basePathFull: 'avatars/eric/matted-birefnet-full',
                ext: 'webp',
                useChromaKey: false,
            },
        },
        defaultMattingMethod: 'birefnet-general',
    },
};
const DEFAULT_AVATAR = 'eric';

class AvatarController {
    constructor() {
        // Canvas unifié : rendu avatar + éclairage cinéma dans un seul élément
        // (élimine le flicker du mask-image qui se faisait évincer du cache navigateur).
        this.canvas = document.getElementById('avatarCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.userInput = document.getElementById('userInput');
        this.sendButton = document.getElementById('sendButton');

        // Settings UI
        this.settingsBtn = document.getElementById('settingsBtn');
        this.settingsPanel = document.getElementById('settingsPanel');
        this.settingsClose = document.getElementById('settingsClose');
        this.avatarSelect = document.getElementById('avatarSelect');
        this.voiceSelect = document.getElementById('voiceSelect');
        this.avatarBackground = document.getElementById('avatarBackground');
        this.bgSettingItem = document.getElementById('bgSettingItem');
        this.bgThumbnails = document.querySelectorAll('.bg-thumb');

        // Config éclairage cinéma — appliqué pixel par pixel dans renderToCanvas()
        // (initialisé par setupCinematicLighting depuis localStorage)
        this.lighting = { enabled: true, blendMode: 'multiply', leftColor: '#4a90e2', leftIntensity: 100, rightColor: '#ff9f40', rightIntensity: 100 };

        // Sélection avatar via URL : ?avatar=eric ou ?avatar=avalution2
        const params = new URLSearchParams(window.location.search);
        const avatarKey = params.get('avatar');
        this.avatarKey = AVATARS[avatarKey] ? avatarKey : DEFAULT_AVATAR;
        this.avatarConfig = AVATARS[this.avatarKey];
        console.log(`[AVATAR] ${this.avatarKey} — ${this.avatarConfig.name}`);

        // Animation constants
        this.FPS = this.avatarConfig.fps;
        this.FRAME_DURATION = 1000 / this.FPS;

        // Quality : 'half' (480×480) ou 'full' (960×960). Default = full (qualité originale).
        this.quality = localStorage.getItem('avatar_quality') || 'full';

        // Clip-based state : on a plusieurs idle clips + 1 speak clip
        this.clips = this.avatarConfig.clips;                   // map nom -> {count}
        this.speakClipName = this.avatarConfig.speakClip;
        this.currentClip = this.avatarConfig.defaultIdleClip;   // clip joué en ce moment

        // Pattern idle déterministe : 2-5× idle-base (en HALF-cycles, càd 1 sens d'animation),
        // puis 1 half-cycle d'une variation, et on revient à idle-base avec un nouveau compteur.
        // Les variations ne peuvent jamais se jouer 2× d'affilée.
        this.idleVariations = Object.entries(this.clips)
            .filter(([name, cfg]) => cfg.isVariation)
            .map(([name]) => name);
        this.idleBasePlaysRemaining = this.randomIdleBaseCount();
        this.lastVariationPlayed = null;
        // Pool des clips de speak avec alternance stricte (jamais 2× la même d'affilée)
        this.speakClipsPool = this.avatarConfig.speakClips || [this.avatarConfig.speakClip];
        this.lastSpeakClipPlayed = null;
        console.log(`[IDLE PATTERN] base ×${this.idleBasePlaysRemaining} half-cycles puis 1× variation parmi`, this.idleVariations);
        console.log(`[SPEAK POOL] alternance stricte entre`, this.speakClipsPool);

        // Setup matting method
        this.mattingMethod = this.avatarConfig.defaultMattingMethod;
        this.activeMatting = this.avatarConfig.mattingMethods[this.mattingMethod];

        // Paramètres TTS / lip-sync
        this.selectedEngine = this.avatarConfig.engine || 'mistral';
        this.selectedVoice = this.avatarConfig.voice;
        // Migration : default minSilenceDuration changé de 0.7s → 0.4s. On bump une version
        // pour forcer le reset des prefs existantes (sinon les users gardent leur 0.7 en cache).
        try {
            const MIN_SILENCE_VERSION = 2;
            const saved = parseInt(localStorage.getItem('avatar_min_silence_version') || '1', 10);
            if (saved < MIN_SILENCE_VERSION) {
                localStorage.removeItem('avatar_min_silence');
                localStorage.setItem('avatar_min_silence_version', String(MIN_SILENCE_VERSION));
            }
        } catch (_) {}
        this.minSilenceDuration = parseFloat(localStorage.getItem('avatar_min_silence') || '0.4');  // seuil silence (s)
        // Migration : default temperature changé de 1.2 → 0.6 (plage Azure 0.6-1.2).
        // Bump version pour forcer le reset des prefs existantes.
        try {
            const TEMP_VERSION = 2;
            const saved = parseInt(localStorage.getItem('avatar_temperature_version') || '1', 10);
            if (saved < TEMP_VERSION) {
                localStorage.removeItem('avatar_temperature');
                localStorage.setItem('avatar_temperature_version', String(TEMP_VERSION));
            }
        } catch (_) {}
        this.realtimeTemperature = parseFloat(localStorage.getItem('avatar_temperature') || '0.6'); // 0.6 - 1.2 (Azure realtime)

        // Mémoire conversationnelle : array de {role: 'user'|'assistant', content: '...'}
        // Envoyée à chaque /api/speak. Donne au modèle :
        //   - le contexte de la conversation (continuité)
        //   - un ancrage textuel sur sa prosodie passée (stabilise la voix realtime)
        // Cap à HISTORY_LIMIT messages (= HISTORY_LIMIT/2 échanges) pour éviter bloat tokens.
        this.HISTORY_LIMIT = 16;
        this.conversationHistory = [];
        try {
            const saved = localStorage.getItem('avatar_conversation');
            if (saved) this.conversationHistory = JSON.parse(saved);
        } catch (_) { this.conversationHistory = []; }
        this.pitchCents = 0;                    // -1200..+1200 (1 octave chaque sens, 0 = normal)

        // Frames préchargées : map clipName -> array d'Image
        this.frames = {};       // version utilisée pour l'affichage (mattée si chroma key)
        this.rawFrames = {};    // version brute, conservée pour re-matting live

        // État animation
        this.currentMode = 'idle';
        this.currentFrame = 0;
        this.playDirection = 1;
        this.isPlaying = false;
        this.animationFrameId = null;
        this.lastFrameTime = 0;
        this.isHalfAccordion = false;
        this.switchToHalfAccordionPending = false;

        // État pipeline TTS
        this.pendingAudio = null;
        this.preparedAudio = null;
        this.waitingForAudio = false;
        this.audioReady = false;

        // Wait mode : true pendant l'appel API, verrouille l'idle pattern sur idle-base
        // (pas de switch vers les variations). L'accordéon idle continue normalement.
        this.isWaitingMode = false;

        // Timeline de lecture audio
        this.audioStartTime = 0;
        this.timeline = null;
        this.audioDuration = 0;

        this.init();
    }

    async init() {
        this.setupSettingsUI();
        await this.preloadFrames();

        this.sendButton.addEventListener('click', () => this.handleSend());
        this.userInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleSend();
        });

        this.showFrame(0);
        this.startAccordionLoop();
    }

    // ============================================================
    // SETTINGS UI
    // ============================================================
    setupSettingsUI() {
        // Populate engine dropdown
        this.engineSelect = document.getElementById('engineSelect');
        if (this.engineSelect) {
            this.engineSelect.innerHTML = '';
            for (const [key, cfg] of Object.entries(VOICE_ENGINES)) {
                const opt = document.createElement('option');
                opt.value = key;
                opt.textContent = cfg.label;
                this.engineSelect.appendChild(opt);
            }
            this.engineSelect.value = this.selectedEngine;
            this.engineSelect.addEventListener('change', (e) => {
                this.selectedEngine = e.target.value;
                // Reset à la voix par défaut de cet engine
                this.selectedVoice = VOICE_ENGINES[this.selectedEngine].defaultVoice;
                this.populateVoiceDropdown();
                console.log(`[ENGINE] switched to ${this.selectedEngine}, voice=${this.selectedVoice}`);
            });
        }

        // Voice dropdown initial (selon l'engine actif)
        this.populateVoiceDropdown();

        // Pré-remplir les selects avec les valeurs courantes
        this.avatarSelect.value = this.avatarKey;

        // Masque le sélecteur de fond + sliders chroma key si pas d'avatar matté
        const chromaItem = document.getElementById('chromaKeyItem');
        const mattingItem = document.getElementById('mattingMethodItem');
        if (!this.avatarConfig.removeBackground) {
            this.bgSettingItem.style.display = 'none';
            if (chromaItem) chromaItem.style.display = 'none';
            if (mattingItem) mattingItem.style.display = 'none';
        } else {
            this.setupChromaKeySliders();
            this.setupMattingMethodSelect();
            this.setupQualitySelect();
            // Hide chroma sliders si méthode active n'est pas realtime
            if (chromaItem && !this.activeMatting.useChromaKey) {
                chromaItem.style.display = 'none';
            }
        }

        // Éclairage cinéma : actif pour tous les avatars
        this.setupCinematicLighting();

        // Comportement accordéon : un seul <details> ouvert à la fois.
        // Quand l'utilisateur en ouvre un, on referme tous les autres.
        document.querySelectorAll('.settings-section').forEach(section => {
            section.addEventListener('toggle', () => {
                if (section.open) {
                    document.querySelectorAll('.settings-section').forEach(other => {
                        if (other !== section && other.open) other.open = false;
                    });
                }
            });
        });

        // Ouverture / fermeture du panneau
        this.settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.settingsPanel.classList.toggle('open');
        });
        this.settingsClose.addEventListener('click', () => {
            this.settingsPanel.classList.remove('open');
        });
        document.addEventListener('click', (e) => {
            if (!this.settingsPanel.contains(e.target) && !this.settingsBtn.contains(e.target)) {
                this.settingsPanel.classList.remove('open');
            }
        });

        // Changement d'avatar -> reload avec ?avatar=
        this.avatarSelect.addEventListener('change', (e) => {
            const url = new URL(window.location.href);
            url.searchParams.set('avatar', e.target.value);
            window.location.href = url.toString();
        });

        // Changement de voix
        this.voiceSelect.addEventListener('change', (e) => {
            this.selectedVoice = e.target.value;
            console.log(`[VOICE] ${this.selectedVoice} (engine=${this.selectedEngine})`);
        });

        // Pitch slider (grave <-> aigu)
        const pitchSlider = document.getElementById('pitchSlider');
        const pitchValue = document.getElementById('pitchValue');
        if (pitchSlider && pitchValue) {
            const fmt = (c) => c > 0 ? `+${c}` : `${c}`;
            pitchValue.textContent = fmt(this.pitchCents);
            pitchSlider.value = this.pitchCents;
            pitchSlider.addEventListener('input', (e) => {
                this.pitchCents = parseInt(e.target.value, 10);
                pitchValue.textContent = fmt(this.pitchCents);
                // Si une voix est en train de jouer, applique en live
                if (this.currentSource) {
                    try { this.currentSource.detune.value = this.pitchCents; } catch (_) {}
                }
            });
        }

        // Slider : seuil de pause détectée. Utilisé par detectSilenceSegments() qui découpe
        // la piste audio en segments speak/idle. Plus le seuil est bas, plus l'avatar revient
        // souvent à la frame 0 (bouche fermée) pendant les petits silences. Plus haut → l'avatar
        // continue à parler sur les courtes pauses, ferme la bouche uniquement sur les vrais blancs.
        // Effet visible sur la PROCHAINE réponse (pas sur l'audio en cours de lecture).
        const silenceSlider = document.getElementById('silenceSlider');
        const silenceValue = document.getElementById('silenceValue');
        if (silenceSlider && silenceValue) {
            silenceSlider.value = this.minSilenceDuration;
            silenceValue.textContent = this.minSilenceDuration.toFixed(2);
            silenceSlider.addEventListener('input', (e) => {
                const v = parseFloat(e.target.value);
                this.minSilenceDuration = v;
                silenceValue.textContent = v.toFixed(2);
                localStorage.setItem('avatar_min_silence', v.toString());
            });
        }

        // Slider : temperature GPT-Realtime (range Azure 0.6 - 1.2). Sans effet sur les autres
        // engines (mistral / azure_tts). Envoyée à chaque /api/speak dans le body.
        const tempSlider = document.getElementById('tempSlider');
        const tempValue = document.getElementById('tempValue');
        if (tempSlider && tempValue) {
            tempSlider.value = this.realtimeTemperature;
            tempValue.textContent = this.realtimeTemperature.toFixed(2);
            tempSlider.addEventListener('input', (e) => {
                const v = parseFloat(e.target.value);
                this.realtimeTemperature = v;
                tempValue.textContent = v.toFixed(2);
                localStorage.setItem('avatar_temperature', v.toString());
            });
        }

        // Mémoire conversationnelle : compteur d'échanges + bouton "Effacer"
        const memTurnCount = document.getElementById('memTurnCount');
        const clearMemoryBtn = document.getElementById('clearMemoryBtn');
        this.updateMemTurnCount = () => {
            if (!memTurnCount) return;
            // 1 échange = 1 user + 1 assistant
            const exchanges = Math.floor(this.conversationHistory.length / 2);
            memTurnCount.textContent = exchanges;
        };
        this.updateMemTurnCount();
        if (clearMemoryBtn) {
            clearMemoryBtn.addEventListener('click', () => {
                this.conversationHistory = [];
                localStorage.removeItem('avatar_conversation');
                this.updateMemTurnCount();
                console.log('[MEMORY] conversation cleared');
            });
        }

        // Changement de fond — applique le fond persisté (ou office-1 par défaut)
        const savedBg = localStorage.getItem('avatar_background') || 'backgrounds/office-1.png';
        this.bgThumbnails.forEach(thumb => {
            const bg = thumb.dataset.bg;
            // Met à jour la classe active selon le fond persisté
            thumb.classList.toggle('active', bg === savedBg);
            // Applique le fond initial sur le thumb qui match
            if (bg === savedBg) {
                if (bg === 'none') {
                    this.avatarBackground.style.backgroundImage = 'none';
                } else {
                    this.avatarBackground.style.backgroundImage = `url('${bg}')`;
                }
            }
            thumb.addEventListener('click', () => {
                this.bgThumbnails.forEach(t => t.classList.remove('active'));
                thumb.classList.add('active');
                const clickedBg = thumb.dataset.bg;
                if (clickedBg === 'none') {
                    this.avatarBackground.style.backgroundImage = 'none';
                } else {
                    this.avatarBackground.style.backgroundImage = `url('${clickedBg}')`;
                }
                localStorage.setItem('avatar_background', clickedBg);
            });
        });
    }

    // Sliders chroma key avec instant feedback + debounce
    setupChromaKeySliders() {
        const cfg = this.avatarConfig.chromaKey;
        const statusEl = document.getElementById('chromaStatus');
        let debounceTimer = null;

        const setStatus = (txt) => {
            if (!statusEl) return;
            statusEl.textContent = txt;
            statusEl.classList.toggle('active', !!txt);
        };

        const bindSlider = (id, valueId, paramName, decimals) => {
            const slider = document.getElementById(id);
            const valueLabel = document.getElementById(valueId);
            if (!slider) return;

            // Initial sync (au cas où les defaults ont changé dans la config)
            slider.value = cfg[paramName];
            valueLabel.textContent = decimals > 0
                ? cfg[paramName].toFixed(decimals)
                : cfg[paramName];

            slider.addEventListener('input', (e) => {
                const v = parseFloat(e.target.value);
                cfg[paramName] = v;
                valueLabel.textContent = decimals > 0 ? v.toFixed(decimals) : v;

                // Feedback instantané sur la frame visible
                this.rematteCurrentFrame();

                // Debounce 400 ms après le dernier mouvement → re-matte tout
                setStatus('recalcul…');
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(async () => {
                    await this.rematteAllFrames();
                    setStatus('');
                }, 400);
            });
        };

        bindSlider('satRange',         'satRangeValue',         'satRange',         0);
        bindSlider('lumaRange',        'lumaRangeValue',        'lumaRange',        0);
        bindSlider('transparentAbove', 'transparentAboveValue', 'transparentAbove', 2);
        bindSlider('opaqueBelow',      'opaqueBelowValue',      'opaqueBelow',      2);

        // Toggle "contour extérieur seul" (flood fill depuis les bords)
        const edgeFloodToggle = document.getElementById('edgeFlood');
        if (edgeFloodToggle) {
            edgeFloodToggle.checked = cfg.edgeFlood !== false;
            edgeFloodToggle.addEventListener('change', async (e) => {
                cfg.edgeFlood = e.target.checked;
                this.rematteCurrentFrame();
                setStatus('recalcul…');
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(async () => {
                    await this.rematteAllFrames();
                    setStatus('');
                }, 50);
            });
        }
    }

    // Remplit le voice dropdown depuis le catalogue de l'engine actif
    populateVoiceDropdown() {
        const engineCfg = VOICE_ENGINES[this.selectedEngine];
        if (!engineCfg) return;
        this.voiceSelect.innerHTML = '';
        for (const v of engineCfg.voices) {
            const opt = document.createElement('option');
            opt.value = v.id;
            opt.textContent = v.label;
            this.voiceSelect.appendChild(opt);
        }
        // Si la voix courante n'est pas dans ce catalogue, prendre la default
        if (!engineCfg.voices.find(v => v.id === this.selectedVoice)) {
            this.selectedVoice = engineCfg.defaultVoice;
        }
        this.voiceSelect.value = this.selectedVoice;
    }

    // Éclairage cinéma : gradient gauche froid → droite chaud, composité dans le canvas
    // (renderToCanvas). Zéro flicker car le gradient est dessiné pixel-par-pixel à
    // chaque frame, jamais évincé d'un cache navigateur.
    // 4 contrôles : toggle, blend-mode, couleur+intensité gauche, couleur+intensité droite.
    // Persisté via localStorage.
    setupCinematicLighting() {
        const toggle    = document.getElementById('lightingToggle');
        const blendSel  = document.getElementById('lightingBlendMode');
        const leftCol   = document.getElementById('leftColor');
        const leftInt   = document.getElementById('leftIntensity');
        const leftIntVal= document.getElementById('leftIntensityValue');
        const rightCol  = document.getElementById('rightColor');
        const rightInt  = document.getElementById('rightIntensity');
        const rightIntVal= document.getElementById('rightIntensityValue');

        // Charge les valeurs persistées. Versioning : si on bump LIGHTING_VERSION,
        // on jette les anciennes prefs pour forcer l'application des nouveaux defaults.
        const LIGHTING_VERSION = 2;
        let cfg = {};
        try {
            const savedVer = parseInt(localStorage.getItem('avatar_lighting_version') || '1', 10);
            if (savedVer < LIGHTING_VERSION) {
                localStorage.removeItem('avatar_lighting');
                localStorage.setItem('avatar_lighting_version', LIGHTING_VERSION.toString());
            } else {
                cfg = JSON.parse(localStorage.getItem('avatar_lighting') || '{}');
            }
        } catch (_) {}
        toggle.checked      = cfg.enabled !== false;
        blendSel.value      = cfg.blendMode    || 'overlay';      // Overlay (contrasté) par défaut
        leftCol.value       = cfg.leftColor    || '#4dd5e8';      // cyan vif
        leftInt.value       = cfg.leftIntensity ?? 62;            // 62%
        rightCol.value      = cfg.rightColor   || '#f5a02e';      // orange chaud
        rightInt.value      = cfg.rightIntensity ?? 100;          // 100%

        const apply = () => {
            const en = toggle.checked;
            const blend = blendSel.value;
            const lC = leftCol.value;
            const lI = parseInt(leftInt.value, 10);
            const rC = rightCol.value;
            const rI = parseInt(rightInt.value, 10);
            leftIntVal.textContent  = lI + '%';
            rightIntVal.textContent = rI + '%';

            this.lighting = {
                enabled: en,
                blendMode: blend,
                leftColor: lC,
                leftIntensity: lI,
                rightColor: rC,
                rightIntensity: rI,
            };

            // Re-render la frame courante avec les nouveaux réglages
            this.showFrame(this.currentFrame);

            localStorage.setItem('avatar_lighting', JSON.stringify(this.lighting));
        };

        [toggle, blendSel, leftCol, leftInt, rightCol, rightInt].forEach(el => {
            el.addEventListener('input', apply);
            el.addEventListener('change', apply);
        });
        apply();
    }

    // Helper : "#rrggbb" + alpha (0..1) → "rgba(r, g, b, a)"
    hexToRgba(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    // Dropdown pour switcher la qualité (half/full)
    setupQualitySelect() {
        const select = document.getElementById('qualitySelect');
        if (!select) return;
        select.value = this.quality;
        select.addEventListener('change', async (e) => {
            await this.switchQuality(e.target.value);
        });
    }

    async switchQuality(newQuality) {
        if (newQuality === this.quality) return;
        if (newQuality !== 'half' && newQuality !== 'full') return;
        console.log(`[QUALITY] switch to ${newQuality}`);
        this.quality = newQuality;
        localStorage.setItem('avatar_quality', newQuality);

        const statusEl = document.getElementById('qualityStatus');
        if (statusEl) { statusEl.textContent = 'chargement…'; statusEl.classList.add('active'); }

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        this.isPlaying = false;

        try {
            await this.preloadFrames();
            this.currentFrame = 0;
            this.showFrame(0);
            this.startAccordionLoop();
        } catch (e) {
            console.error('Quality switch failed:', e);
        }
        if (statusEl) { statusEl.textContent = ''; statusEl.classList.remove('active'); }
    }

    // Dropdown pour choisir la méthode de détourage (realtime vs pre-matted)
    setupMattingMethodSelect() {
        if (!this.avatarConfig.mattingMethods) return;
        const select = document.getElementById('mattingMethodSelect');
        if (!select) return;

        // Populate options
        select.innerHTML = '';
        for (const [key, methodCfg] of Object.entries(this.avatarConfig.mattingMethods)) {
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = methodCfg.label;
            select.appendChild(opt);
        }
        select.value = this.mattingMethod;

        select.addEventListener('change', async (e) => {
            await this.switchMattingMethod(e.target.value);
        });
    }

    // ============================================================
    // CHROMA KEY SATURATION-AWARE
    // ------------------------------------------------------------
    // Pour chaque pixel, on calcule deux scores :
    //   - satComponent : 1 si saturation = 0, baisse linéairement à 0 à satRange
    //   - lumaComponent : 1 si luma = targetLuma, baisse à 0 à lumaRange d'écart
    // greyness = satComponent * lumaComponent (entre 0 et 1)
    //   - greyness >= transparentAbove → alpha 0 (pixel = fond)
    //   - greyness <= opaqueBelow      → alpha 255 (pixel = sujet)
    //   - entre les deux               → feathering linéaire
    //
    // Pourquoi c'est plus robuste que la distance RGB euclidienne :
    //   - La peau en ombre (R>G>B même atténué) garde saturation > 0 → pas trouée
    //   - Le gris d'antialiasing JPEG (sat=0, luma proche 128) est bien attrapé
    //   - Les vêtements colorés (saturation forte) restent opaques même si leur
    //     luma s'approche de 128
    // ============================================================
    chromaKeyGrey(img) {
        const cfg = this.avatarConfig.chromaKey;
        const targetLuma = cfg.targetLuma;
        const satRange = cfg.satRange;
        const lumaRange = cfg.lumaRange;
        const transparentAbove = cfg.transparentAbove;
        const opaqueBelow = cfg.opaqueBelow;
        const featherSpan = transparentAbove - opaqueBelow;
        const useEdgeFlood = cfg.edgeFlood !== false;

        const canvas = document.createElement('canvas');
        const w = canvas.width = img.naturalWidth || img.width;
        const h = canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, w, h);
        const data = imageData.data;
        const total = w * h;

        // Phase 1 : score greyness par pixel
        const greyness = new Float32Array(total);
        for (let i = 0; i < total; i++) {
            const pi = i * 4;
            const r = data[pi];
            const g = data[pi + 1];
            const b = data[pi + 2];
            const max = r > g ? (r > b ? r : b) : (g > b ? g : b);
            const min = r < g ? (r < b ? r : b) : (g < b ? g : b);
            const sat = max - min;
            const avg = (r + g + b) / 3;
            const lumaDiff = avg > targetLuma ? avg - targetLuma : targetLuma - avg;
            const satComp = sat >= satRange ? 0 : 1 - sat / satRange;
            const lumaComp = lumaDiff >= lumaRange ? 0 : 1 - lumaDiff / lumaRange;
            greyness[i] = satComp * lumaComp;
        }

        // Phase 2 : si edgeFlood, BFS depuis les bords sur les pixels "candidat grey"
        // (greyness > opaqueBelow). Les pixels non atteints seront forcés opaques.
        let reached = null;
        if (useEdgeFlood) {
            reached = new Uint8Array(total);
            const stack = [];
            // Seeds : tous les pixels candidats sur les 4 bords
            for (let x = 0; x < w; x++) {
                const top = x;
                const bot = (h - 1) * w + x;
                if (greyness[top] > opaqueBelow) { reached[top] = 1; stack.push(top); }
                if (greyness[bot] > opaqueBelow) { reached[bot] = 1; stack.push(bot); }
            }
            for (let y = 1; y < h - 1; y++) {
                const l = y * w;
                const r = y * w + w - 1;
                if (greyness[l] > opaqueBelow) { reached[l] = 1; stack.push(l); }
                if (greyness[r] > opaqueBelow) { reached[r] = 1; stack.push(r); }
            }
            // BFS 4-connectivité
            while (stack.length > 0) {
                const idx = stack.pop();
                const x = idx % w;
                const y = (idx - x) / w;
                if (x > 0)     { const n = idx - 1; if (!reached[n] && greyness[n] > opaqueBelow) { reached[n] = 1; stack.push(n); } }
                if (x < w - 1) { const n = idx + 1; if (!reached[n] && greyness[n] > opaqueBelow) { reached[n] = 1; stack.push(n); } }
                if (y > 0)     { const n = idx - w; if (!reached[n] && greyness[n] > opaqueBelow) { reached[n] = 1; stack.push(n); } }
                if (y < h - 1) { const n = idx + w; if (!reached[n] && greyness[n] > opaqueBelow) { reached[n] = 1; stack.push(n); } }
            }
        }

        // Phase 3 : applique l'alpha. Si edgeFlood et pixel non atteint → forcer opaque.
        for (let i = 0; i < total; i++) {
            const pi = i * 4;
            if (useEdgeFlood && !reached[i]) {
                data[pi + 3] = 255;       // intérieur isolé du fond → opaque
                continue;
            }
            const gv = greyness[i];
            if (gv >= transparentAbove) {
                data[pi + 3] = 0;
            } else if (gv <= opaqueBelow) {
                data[pi + 3] = 255;
            } else {
                const t = (gv - opaqueBelow) / featherSpan;
                data[pi + 3] = Math.floor(255 * (1 - t));
            }
        }
        ctx.putImageData(imageData, 0, 0);
        return canvas;
    }

    // ============================================================
    // PRÉCHARGE DES FRAMES
    // ============================================================
    async preloadFrames() {
        const loadRaw = (src) => new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = src;
        });

        const basePath = this.quality === 'full'
            ? (this.activeMatting.basePathFull || this.activeMatting.basePath)
            : this.activeMatting.basePath;
        const ext = this.activeMatting.ext;

        // Charge tous les clips en parallèle (idle-base + idle-col-veste + idle-veste + speek)
        const perClipPromises = {};
        for (const [clipName, cfg] of Object.entries(this.clips)) {
            const promises = [];
            for (let i = 0; i < cfg.count; i++) {
                const frameNum = i.toString().padStart(4, '0');
                promises.push(loadRaw(`${basePath}/${clipName}/frame_${frameNum}.${ext}`));
            }
            perClipPromises[clipName] = Promise.all(promises);
        }

        const rawByClip = {};
        for (const [clipName, p] of Object.entries(perClipPromises)) {
            rawByClip[clipName] = await p;
        }
        this.rawFrames = rawByClip;

        if (this.activeMatting.useChromaKey) {
            await this.rematteAllFrames();
        } else {
            this.frames = rawByClip;
        }

        const counts = Object.entries(this.frames).map(([k, v]) => `${k}=${v.length}`).join(' ');
        console.log(`[FRAMES] ${basePath}/ method=${this.mattingMethod} - ${counts}`);
        // Note : plus de warmMaskCache nécessaire. Le canvas dessine directement les Image
        // déjà décodées, pas de CSS mask-image susceptible d'être évincé du cache.
    }

    // Bascule entre méthodes de détourage (realtime vs pre-matted)
    async switchMattingMethod(newMethod) {
        if (!this.avatarConfig.mattingMethods) return;
        if (!this.avatarConfig.mattingMethods[newMethod]) return;
        if (newMethod === this.mattingMethod) return;

        console.log(`[MATTING] switch to ${newMethod}`);
        this.mattingMethod = newMethod;
        this.activeMatting = this.avatarConfig.mattingMethods[newMethod];

        // Show / hide chroma key sliders selon la méthode
        const chromaItem = document.getElementById('chromaKeyItem');
        if (chromaItem) {
            chromaItem.style.display = this.activeMatting.useChromaKey ? '' : 'none';
        }

        // Animation status pendant le reload
        const statusEl = document.getElementById('mattingMethodStatus');
        if (statusEl) {
            statusEl.textContent = 'chargement…';
            statusEl.classList.add('active');
        }

        // Stoppe l'animation courante le temps du reload
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        this.isPlaying = false;

        try {
            await this.preloadFrames();
            this.currentFrame = 0;
            this.showFrame(0);
            this.startAccordionLoop();
        } catch (e) {
            console.error('Matting switch failed:', e);
        }

        if (statusEl) {
            statusEl.textContent = '';
            statusEl.classList.remove('active');
        }
    }

    // Crée un Image mattée à partir d'un Image brut (async pour le decode du PNG dataURL)
    matteImage(rawImg) {
        return new Promise((resolve) => {
            if (!rawImg) return resolve(null);
            try {
                const canvas = this.chromaKeyGrey(rawImg);
                const matted = new Image();
                matted.onload = () => resolve(matted);
                matted.onerror = () => resolve(rawImg);
                matted.src = canvas.toDataURL('image/png');
            } catch (e) {
                console.warn('Matte failed:', e);
                resolve(rawImg);
            }
        });
    }

    // Re-matte UNIQUEMENT la frame courante du clip courant (feedback slider instant)
    async rematteCurrentFrame() {
        if (!this.activeMatting.useChromaKey) return;
        const rawArr = this.rawFrames[this.currentClip];
        if (!rawArr) return;
        const raw = rawArr[this.currentFrame];
        if (!raw) return;
        const matted = await this.matteImage(raw);
        if (!this.frames[this.currentClip]) this.frames[this.currentClip] = new Array(rawArr.length);
        this.frames[this.currentClip][this.currentFrame] = matted;
        this.showFrame(this.currentFrame);
    }

    // Re-matte TOUS les clips avec les params actuels. Annulable.
    async rematteAllFrames() {
        const gen = (this.rematteGeneration = (this.rematteGeneration || 0) + 1);
        const t0 = performance.now();

        const newFrames = {};
        for (const [clipName, rawArr] of Object.entries(this.rawFrames)) {
            const out = new Array(rawArr.length);
            for (let i = 0; i < rawArr.length; i++) {
                if (this.rematteGeneration !== gen) return;
                const raw = rawArr[i];
                out[i] = raw ? await this.matteImage(raw) : null;
                if (i % 25 === 24) await new Promise(r => setTimeout(r, 0));
            }
            newFrames[clipName] = out;
        }
        if (this.rematteGeneration !== gen) return;
        this.frames = newFrames;
        console.log(`[MATTING] re-done in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    }

    getFrames() {
        return this.frames[this.currentClip] || [];
    }

    getCurrentClipCount() {
        return this.clips[this.currentClip]?.count || 1;
    }

    randomIdleBaseCount() {
        // 2, 3, 4 ou 5
        return 2 + Math.floor(Math.random() * 4);
    }

    // Alternance stricte du clip de speak : retourne toujours l'opposé du dernier joué.
    pickNextSpeakClip() {
        const pool = this.speakClipsPool;
        if (pool.length === 0) return this.avatarConfig.speakClip;
        if (pool.length === 1) {
            this.lastSpeakClipPlayed = pool[0];
            return pool[0];
        }
        if (!this.lastSpeakClipPlayed) {
            this.lastSpeakClipPlayed = pool[0];
            return pool[0];
        }
        const next = pool.find(c => c !== this.lastSpeakClipPlayed) || pool[0];
        this.lastSpeakClipPlayed = next;
        return next;
    }

    pickNextIdleClip() {
        // Pendant le wait, on reste verrouillé sur idle-base (pas de variations).
        // Le pattern aléatoire reprend dès que l'audio se termine et qu'on revient en idle libre.
        if (this.isWaitingMode) {
            return this.avatarConfig.defaultIdleClip;
        }

        // Appelé à la fin de chaque half-cycle (= chaque inversion de direction).
        // Pattern : N half-cycles d'idle-base (N random 2-5), puis 1 half-cycle de variation, repeat.
        const baseClip = this.avatarConfig.defaultIdleClip;

        if (this.currentClip === baseClip) {
            // On vient de terminer un half-cycle d'idle-base
            this.idleBasePlaysRemaining--;
            if (this.idleBasePlaysRemaining > 0) {
                return baseClip;       // continue idle-base
            }
            // Plus d'idle-base à jouer dans ce bloc → variation
            this.idleBasePlaysRemaining = this.randomIdleBaseCount();
            const variations = this.idleVariations;
            if (variations.length === 0) return baseClip;
            if (variations.length === 1) {
                this.lastVariationPlayed = variations[0];
                return variations[0];
            }
            const pool = variations.filter(v => v !== this.lastVariationPlayed);
            const picked = pool[Math.floor(Math.random() * pool.length)] || variations[0];
            this.lastVariationPlayed = picked;
            return picked;
        }
        // Sinon on vient de terminer 1 half-cycle de variation → retour à idle-base
        return baseClip;
    }

    showFrame(frameIndex) {
        const frames = this.getFrames();
        const frame = frames[frameIndex];
        if (frame) {
            this.renderToCanvas(frame);
        }
        this.currentFrame = frameIndex;
    }

    // ============================================================
    // RENDU CANVAS UNIFIÉ
    // ------------------------------------------------------------
    // 1. clear
    // 2. drawImage(avatar)                            -> canvas = avatar avec alpha
    // 3. compositeOp = blendMode + drawImage(gradient) -> avatar blend gradient
    // 4. compositeOp = 'destination-in' + drawImage(avatar) -> masque par silhouette
    //
    // Résultat : avatar éclairé, transparent en dehors de sa silhouette.
    // Zéro mask-image CSS → zéro flicker.
    // ============================================================
    renderToCanvas(frame) {
        const w = frame.naturalWidth || frame.width;
        const h = frame.naturalHeight || frame.height;
        if (!w || !h) return;

        // Synchronise la résolution du canvas sur celle de la source (480 ou 960)
        if (this.canvas.width !== w || this.canvas.height !== h) {
            this.canvas.width = w;
            this.canvas.height = h;
        }
        const ctx = this.ctx;

        // 1. Reset
        ctx.globalCompositeOperation = 'source-over';
        ctx.clearRect(0, 0, w, h);

        // 2. Dessine l'avatar (déjà détouré, alpha présent)
        ctx.drawImage(frame, 0, 0, w, h);

        // 3. Éclairage cinéma : blend gradient + remasque par la silhouette
        const L = this.lighting;
        if (L && L.enabled) {
            ctx.globalCompositeOperation = L.blendMode;     // multiply, screen, overlay, etc.
            const grad = ctx.createLinearGradient(0, 0, w, 0);
            // 4 stops : on évite de passer par du BLANC au milieu (l'interpolation entre
            // leftColor et rgba(255,255,255,0) injecte de la blancheur dans la teinte).
            // À la place, on fait fondre chaque couleur vers SA PROPRE version alpha=0 :
            //   leftColor(I) → leftColor(0) à mi-largeur, puis rightColor(0) → rightColor(I).
            // L'interpolation ne fait varier que l'alpha, jamais la teinte. Résultat plus saturé,
            // moins délavé.
            grad.addColorStop(0,    this.hexToRgba(L.leftColor,  L.leftIntensity  / 100));
            grad.addColorStop(0.5,  this.hexToRgba(L.leftColor,  0));
            grad.addColorStop(0.5,  this.hexToRgba(L.rightColor, 0));
            grad.addColorStop(1,    this.hexToRgba(L.rightColor, L.rightIntensity / 100));
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, w, h);

            // 4. Re-masque par la silhouette : garde uniquement les pixels où l'avatar avait de l'alpha
            // (sinon le blend mode peint aussi le fond transparent)
            ctx.globalCompositeOperation = 'destination-in';
            ctx.drawImage(frame, 0, 0, w, h);

            // Reset pour le prochain appel
            ctx.globalCompositeOperation = 'source-over';
        }
    }

    // ============================================================
    // BOUCLE ACCORDÉON IDLE (état de repos)
    // ============================================================
    startAccordionLoop() {
        if (this.isPlaying) return;
        this.isPlaying = true;
        this.lastFrameTime = performance.now();
        this.playDirection = 1;
        this.currentFrame = 0;
        this.showFrame(0);
        this.animate();
    }

    animate() {
        const now = performance.now();
        const elapsed = now - this.lastFrameTime;

        if (elapsed >= this.FRAME_DURATION) {
            this.lastFrameTime = now - (elapsed % this.FRAME_DURATION);
            let nextFrame = this.currentFrame + this.playDirection;
            // Borne sur le frameCount du clip courant (peut changer entre cycles si idle random switch)
            const clipCount = this.getCurrentClipCount();
            const maxFrame = this.isHalfAccordion
                ? Math.floor(clipCount / 2) - 1
                : clipCount - 1;

            let reversed = false;
            if (this.playDirection === 1 && nextFrame > maxFrame) {
                nextFrame = maxFrame;
                this.playDirection = -1;
                reversed = true;
            } else if (this.playDirection === -1 && nextFrame < 0) {
                nextFrame = 0;
                this.playDirection = 1;
                reversed = true;
                if (this.switchToHalfAccordionPending) {
                    this.isHalfAccordion = true;
                    this.switchToHalfAccordionPending = false;
                }
            }
            // Fin d'un half-cycle (à frame 0 OU à lastFrame) → opportunité de switch clip.
            // Comme tous les idle clips ont le même count (37), currentFrame reste valide sur le nouveau clip.
            if (reversed && this.currentMode === 'idle') {
                const newClip = this.pickNextIdleClip();
                if (newClip !== this.currentClip) {
                    this.currentClip = newClip;
                    console.log(`[IDLE] → ${newClip} @ frame ${nextFrame} (base remaining: ${this.idleBasePlaysRemaining})`);
                }
            }
            this.showFrame(nextFrame);
        }
        this.animationFrameId = requestAnimationFrame(() => this.animate());
    }

    // ============================================================
    // goToNearestCommonFrame — déplace la tête vers la frame commune la plus proche
    // (0 ou lastFrame du clip courant). Lecture frame par frame, jamais de saut.
    // Sert pour idle→speak (audio prêt) ET pour wait→play.
    // ============================================================
    goToNearestCommonFrame(callback) {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        const clipCount = this.getCurrentClipCount();
        const lastFrame = clipCount - 1;
        // Cible : la frame commune la plus proche (peut inverser la direction)
        const target = this.currentFrame <= lastFrame / 2 ? 0 : lastFrame;

        if (this.currentFrame === target) {
            if (callback) callback();
            return;
        }
        this.playDirection = target > this.currentFrame ? 1 : -1;
        this.isPlaying = true;
        this.lastFrameTime = performance.now();

        const step = () => {
            const now = performance.now();
            const elapsed = now - this.lastFrameTime;
            if (elapsed >= this.FRAME_DURATION) {
                this.lastFrameTime = now - (elapsed % this.FRAME_DURATION);
                const nextFrame = this.currentFrame + this.playDirection;
                const reached = (this.playDirection === 1 && nextFrame >= target)
                             || (this.playDirection === -1 && nextFrame <= target);
                if (reached) {
                    this.showFrame(target);
                    this.isPlaying = false;
                    if (callback) callback();
                    return;
                }
                this.showFrame(nextFrame);
            }
            this.animationFrameId = requestAnimationFrame(step);
        };
        step();
    }

    // Appelé une seule fois quand l'audio devient prêt (depuis prepareAudio).
    // Stoppe l'accordéon idle libre, transitionne vers la frame commune la plus proche,
    // puis enchaîne directement sur le speak. Comme avant, pas de saut de frame.
    tryStartAudio() {
        if (!this.waitingForAudio || !this.audioReady) return;
        this.waitingForAudio = false;
        this.isWaitingMode = false;          // déverrouille pickNextIdleClip (sera réactivé au prochain send)
        this.goToNearestCommonFrame(() => {
            this.playPendingAudio();
        });
    }

    // ============================================================
    // ENVOI TEXTE -> API TTS
    // ============================================================
    async handleSend() {
        // Gate global : on n'enchaîne JAMAIS deux cycles speak. Le bouton UI est déjà bloqué
        // (disabled empêche les clics), mais la touche Entrée sur l'input bypasse ce blocage
        // → on regate ici pour fermer la porte côté JS. Tant qu'un cycle n'est pas terminé
        // (source.onended), tout nouveau Send est ignoré silencieusement.
        if (this.sendButton.disabled) return;

        const message = this.userInput.value.trim();
        if (!message) return;

        this.userInput.value = '';
        this.sendButton.disabled = true;
        this.waitingForAudio = true;
        this.audioReady = false;
        this.preparedAudio = null;

        // Wait mode : on ARMÉ juste le flag. Surtout, on NE TOUCHE PAS à currentClip ici.
        // L'animation en cours (idle-base, idle-veste, idle-col-veste, peu importe) continue
        // jusqu'au prochain reversal naturel (frame 0 OU lastFrame). À ce moment-là,
        // pickNextIdleClip détecte isWaitingMode et retourne idle-base → transition propre,
        // jamais de saut visuel mid-animation.
        // Règle absolue : on ne passe d'une animation à l'autre QUE par une frame commune.
        this.isWaitingMode = true;
        // Le clip de speak n'est PAS pré-choisi ici : l'alternance est gérée dynamiquement
        // à chaque cycle d'accordéon dans animateWithTimeline.

        try {
            const response = await fetch('/api/speak', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: message,
                    voice: this.selectedVoice,
                    engine: this.selectedEngine,
                    temperature: this.realtimeTemperature,   // ignoré pour mistral / azure_tts
                    // Cap les N derniers messages — le serveur reclampe aussi (défense en profondeur)
                    history: this.conversationHistory.slice(-this.HISTORY_LIMIT),
                })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({ error: response.statusText }));
                throw new Error(errData.error || `Erreur API: ${response.status}`);
            }

            const data = await response.json();
            // Met à jour l'historique : ajoute le tour user + le tour assistant (le message texte
            // est dans data.message — pour realtime c'est le transcript, pour les autres c'est
            // la réponse chat). Persiste sur localStorage pour conserver entre rechargements.
            this.conversationHistory.push({ role: 'user', content: message });
            if (data.message) {
                this.conversationHistory.push({ role: 'assistant', content: data.message });
            }
            // Cap pour éviter d'accumuler indéfiniment en localStorage
            const hardCap = this.HISTORY_LIMIT * 4;
            if (this.conversationHistory.length > hardCap) {
                this.conversationHistory = this.conversationHistory.slice(-hardCap);
            }
            try {
                localStorage.setItem('avatar_conversation', JSON.stringify(this.conversationHistory));
            } catch (_) { /* quota exceeded — ignore */ }
            if (this.updateMemTurnCount) this.updateMemTurnCount();

            // Mistral renvoie un WAV complet en base64 → pas besoin de reconstruire le header
            const audioBlob = this.base64WavToBlob(data.audio);
            this.pendingAudio = audioBlob;
            this.prepareAudio(audioBlob);

        } catch (error) {
            console.error('Erreur:', error);
            this.resetAfterError();
            alert('Erreur : ' + error.message);
        }
    }

    resetAfterError() {
        this.sendButton.disabled = false;
        this.waitingForAudio = false;
        this.audioReady = false;
        this.isHalfAccordion = false;
        this.isWaitingMode = false;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        this.currentMode = 'idle';
        this.currentFrame = 0;
        this.showFrame(0);
        this.startAccordionLoop();
    }

    // ============================================================
    // Base64 -> Blob WAV (Mistral renvoie déjà du WAV complet)
    // ============================================================
    base64WavToBlob(base64) {
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        return new Blob([bytes], { type: 'audio/wav' });
    }

    // Legacy : conversion PCM16 base64 -> WAV (gardée pour rétrocompat si on revient à l'API Realtime)
    pcm16ToWav(base64Pcm) {
        const pcmData = Uint8Array.from(atob(base64Pcm), c => c.charCodeAt(0));
        const sampleRate = 24000;
        const numChannels = 1;
        const bitsPerSample = 16;

        const wavHeader = new ArrayBuffer(44);
        const view = new DataView(wavHeader);
        const writeString = (offset, str) => {
            for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
        };
        writeString(0, 'RIFF');
        view.setUint32(4, 36 + pcmData.length, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * numChannels * bitsPerSample / 8, true);
        view.setUint16(32, numChannels * bitsPerSample / 8, true);
        view.setUint16(34, bitsPerSample, true);
        writeString(36, 'data');
        view.setUint32(40, pcmData.length, true);

        const wavBuffer = new Uint8Array(44 + pcmData.length);
        wavBuffer.set(new Uint8Array(wavHeader), 0);
        wavBuffer.set(pcmData, 44);
        return new Blob([wavBuffer], { type: 'audio/wav' });
    }

    // ============================================================
    // PRÉPARATION AUDIO + CONSTRUCTION DE LA TIMELINE LIP-SYNC
    // ============================================================
    async prepareAudio(audioBlob) {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const arrayBuffer = await audioBlob.arrayBuffer();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

            const silenceSegments = this.detectSilenceSegments(audioBuffer);
            const timeline = this.buildAnimationTimeline(audioBuffer.duration, silenceSegments);

            this.preparedAudio = { context: audioContext, buffer: audioBuffer, timeline };
            console.log('Timeline pré-calculée:', timeline);

            this.audioReady = true;
            this.tryStartAudio();
        } catch (error) {
            console.error('Erreur préparation audio:', error);
            this.pendingAudio = null;
            this.preparedAudio = null;
            this.resetAfterError();
        }
    }

    /**
     * Scan RMS par fenêtres de 50 ms.
     * Retourne les intervalles [{start, end}] où l'amplitude moyenne reste
     * sous le seuil ET qui durent >= minSilenceDuration.
     */
    detectSilenceSegments(audioBuffer) {
        const channelData = audioBuffer.getChannelData(0);
        const sampleRate = audioBuffer.sampleRate;
        const segments = [];

        const windowSize = Math.floor(sampleRate * 0.05);   // 50 ms
        // 0.005 = au-dessus du bruit de fond GPT-Realtime (max ~0.0005 observé)
        // mais sous la traîne audible des mots (qui descend à 0.005-0.020).
        // Mesuré empiriquement sur 3 samples — voir scripts/analyze_silence.js.
        const silenceThreshold = 0.005;
        const minSilenceDuration = this.minSilenceDuration;

        let silenceStart = null;
        let lastSoundTime = 0;

        for (let i = 0; i < channelData.length; i += windowSize) {
            let sum = 0;
            const end = Math.min(i + windowSize, channelData.length);
            for (let j = i; j < end; j++) sum += Math.abs(channelData[j]);
            const average = sum / (end - i);
            const currentTime = i / sampleRate;

            if (average < silenceThreshold) {
                if (silenceStart === null) silenceStart = currentTime;
            } else {
                lastSoundTime = currentTime + (windowSize / sampleRate);
                if (silenceStart !== null) {
                    const silenceDuration = currentTime - silenceStart;
                    if (silenceDuration >= minSilenceDuration) {
                        segments.push({ start: silenceStart, end: currentTime });
                    }
                    silenceStart = null;
                }
            }
        }

        // Silence final
        if (silenceStart !== null) {
            const audioDuration = channelData.length / sampleRate;
            const silenceDuration = audioDuration - silenceStart;
            if (silenceDuration >= minSilenceDuration) {
                segments.push({ start: silenceStart, end: audioDuration });
            }
        }

        // POST-PADDING — Piste 1 d'amélioration synchro
        // On décale le DÉBUT de chaque silence vers le futur de 150 ms.
        // Effet : le segment speak précédent s'étend de 150 ms dans la zone "trail audible".
        // Cas couvert : la traîne acoustique des voyelles/consonnes finales (sous le threshold
        // RMS mais encore perçue à l'oreille). Sans ça, l'avatar fermerait la bouche pendant
        // les dernières millisecondes de son qui finissent de jouer.
        // Le clamp `end - 0.05` garantit qu'on ne crée pas un silence de durée nulle ou négative.
        const SILENCE_START_POST_PAD = 0.15;   // 150 ms
        for (const seg of segments) {
            seg.start = Math.min(seg.start + SILENCE_START_POST_PAD, seg.end - 0.05);
        }

        this.lastSoundTime = lastSoundTime;
        return segments;
    }

    /**
     * Construit la timeline : alterne speak (sonore) et idle (silence)
     * sur la durée totale, en s'arrêtant au dernier vrai son.
     */
    buildAnimationTimeline(audioDuration, silenceSegments) {
        const timeline = [];
        let currentTime = 0;
        const effectiveEndTime = this.lastSoundTime || audioDuration;

        for (const silence of silenceSegments) {
            if (silence.start > currentTime) {
                timeline.push(this.createSegment('speak', currentTime, silence.start));
            }
            timeline.push(this.createSegment('idle', silence.start, silence.end));
            currentTime = silence.end;
        }
        if (currentTime < effectiveEndTime) {
            timeline.push(this.createSegment('speak', currentTime, effectiveEndTime));
        }
        return timeline;
    }

    /**
     * Cœur du système adaptatif : calcule combien de cycles d'accordéon
     * caser dans la durée du segment, et avec quelle amplitude (maxFrame),
     * pour que ça tombe pile.
     */
    createSegment(mode, startTime, endTime) {
        const duration = endTime - startTime;
        const totalFramesAvailable = duration * this.FPS;
        // Frame count : pour speak on prend le clip speek, pour idle le clip idle-base (référence accordéon)
        const frameCount = mode === 'idle'
            ? this.clips[this.avatarConfig.defaultIdleClip].count
            : this.clips[this.speakClipName].count;
        const fullAccordionFrames = frameCount * 2;                  // aller-retour complet pour ce mode
        const fullCycles = Math.floor(totalFramesAvailable / fullAccordionFrames);

        let totalCycles;
        if (fullCycles === 0) {
            totalCycles = 1;                                          // segment court : 1 cycle compressé
        } else {
            const remainingFrames = totalFramesAvailable - (fullCycles * fullAccordionFrames);
            totalCycles = (remainingFrames >= this.FPS) ? fullCycles + 1 : fullCycles;
            if (totalCycles === 0) totalCycles = 1;
        }

        const framesPerCycle = totalFramesAvailable / totalCycles;
        let maxFrame = framesPerCycle / 2;                            // apex = mi-cycle
        maxFrame = Math.min(maxFrame, frameCount - 1);
        maxFrame = Math.max(maxFrame, 1);

        return { mode, startTime, endTime, duration, maxFrame, totalCycles, framesPerCycle };
    }

    // ============================================================
    // LECTURE AUDIO + ANIMATION SYNCHRONISÉE
    // ============================================================
    playPendingAudio() {
        if (!this.preparedAudio) {
            this.animationFrameId = requestAnimationFrame(() => this.animate());
            return;
        }

        this.pendingAudio = null;
        this.waitingForAudio = false;
        this.audioReady = false;
        this.isHalfAccordion = false;
        this.isWaitingMode = false;

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        const { context: audioContext, buffer: audioBuffer, timeline } = this.preparedAudio;
        this.preparedAudio = null;
        this.timeline = timeline;
        this.audioDuration = audioBuffer.duration;

        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.detune.value = this.pitchCents;     // pitch shift (avec léger effet sur tempo)
        source.connect(audioContext.destination);
        this.currentSource = source;                // pour ajustement live du pitch pendant lecture

        this.audioStartTime = audioContext.currentTime;
        this.isPlaying = true;

        if (this.timeline.length > 0) {
            this.currentMode = this.timeline[0].mode;
        }
        // Bind clip selon mode initial. En speak, on choisit le clip via pickNextSpeakClip
        // (alterne par rapport au dernier joué, même au-delà d'une session audio).
        if (this.currentMode === 'speak') {
            this.currentClip = this.pickNextSpeakClip();
        } else {
            this.currentClip = this.avatarConfig.defaultIdleClip;
        }
        this.lastSpeakCycleNumber = 0;   // pour détecter les retours à frame 0 dans l'accordéon
        this.currentFrame = 0;
        this.playDirection = 1;
        this.showFrame(0);
        this.lastFrameTime = performance.now();

        source.start(0);
        this.animateWithTimeline(audioContext);

        source.onended = () => {
            audioContext.close();
            if (this.animationFrameId) {
                cancelAnimationFrame(this.animationFrameId);
                this.animationFrameId = null;
            }
            this.currentFrame = 0;
            this.playDirection = 1;
            this.currentMode = 'idle';
            this.currentClip = this.avatarConfig.defaultIdleClip;   // retour idle-base
            this.showFrame(0);
            this.isPlaying = false;
            this.currentSource = null;
            this.startAccordionLoop();
            this.sendButton.disabled = false;
        };
    }

    /**
     * Boucle d'animation pilotée par l'horloge AudioContext.
     * À chaque RAF, on dérive la frame à afficher depuis audioElapsed.
     * Pas de compteur interne -> resync continu, immune aux frame drops.
     */
    animateWithTimeline(audioContext) {
        const wallClockElapsed = audioContext.currentTime - this.audioStartTime;
        // Si pitch != 0, l'audio joue à effectiveRate (couplage pitch/speed via detune).
        // On compense pour que le lookup timeline reste synchrone avec l'audio entendu.
        const effectiveRate = this.pitchCents === 0 ? 1 : Math.pow(2, this.pitchCents / 1200);
        // VISUAL LOOKAHEAD — Piste 2 d'amélioration synchro
        // L'avatar montre la frame correspondant à audio_time + 50 ms.
        // Reproduit la préparation motrice naturelle (la bouche s'ouvre légèrement AVANT le son
        // chez les vrais locuteurs). 50 ms = valeur "sweet spot" mesurée dans les études
        // d'articulation. Imperceptible techniquement, mais le cerveau apprécie.
        const VISUAL_LOOKAHEAD = 0.05;
        const audioPosition = wallClockElapsed * effectiveRate + VISUAL_LOOKAHEAD;
        if (audioPosition >= this.audioDuration) return;

        const currentSegment = this.getCurrentSegment(audioPosition);
        if (!currentSegment) return;

        if (currentSegment.mode !== this.currentMode) {
            this.currentMode = currentSegment.mode;
            if (this.currentMode === 'speak') {
                // Entrée dans un segment speak → choisit un clip (opposé du dernier joué)
                this.currentClip = this.pickNextSpeakClip();
            } else {
                this.currentClip = this.avatarConfig.defaultIdleClip;
            }
            this.lastSpeakCycleNumber = 0;
        }

        const timeInSegment = audioPosition - currentSegment.startTime;
        const framesInSegment = timeInSegment * this.FPS;

        // Détection de retour à frame 0 dans l'accordéon speak → switch sur l'autre clip.
        // Chaque cycle complet = 1 aller-retour 0→maxFrame→0. À chaque nouveau cycle, on alterne.
        if (this.currentMode === 'speak') {
            const cycleNumber = Math.floor(framesInSegment / currentSegment.framesPerCycle);
            if (cycleNumber > this.lastSpeakCycleNumber) {
                this.lastSpeakCycleNumber = cycleNumber;
                this.currentClip = this.pickNextSpeakClip();
                console.log(`[SPEAK CYCLE ${cycleNumber}] → ${this.currentClip}`);
            }
        }

        const positionInAccordion = framesInSegment % currentSegment.framesPerCycle;
        const halfCycle = currentSegment.framesPerCycle / 2;

        let frameToShow;
        if (positionInAccordion < halfCycle) {
            // Phase aller : 0 -> maxFrame
            frameToShow = Math.floor((positionInAccordion / halfCycle) * currentSegment.maxFrame);
        } else {
            // Phase retour : maxFrame -> 0
            const returnPosition = positionInAccordion - halfCycle;
            frameToShow = Math.floor(currentSegment.maxFrame - (returnPosition / halfCycle) * currentSegment.maxFrame);
        }
        frameToShow = Math.max(0, Math.min(frameToShow, Math.floor(currentSegment.maxFrame)));

        if (frameToShow !== this.currentFrame) {
            this.currentFrame = frameToShow;
            this.showFrame(frameToShow);
        }

        this.animationFrameId = requestAnimationFrame(() => this.animateWithTimeline(audioContext));
    }

    getCurrentSegment(audioElapsed) {
        for (const segment of this.timeline) {
            if (audioElapsed >= segment.startTime && audioElapsed < segment.endTime) {
                return segment;
            }
        }
        return null;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new AvatarController();   // exposé pour debug console
});
