require('dotenv').config();
const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const session = require('express-session');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// AUTH CONFIG — pattern identique à Assets Générator (Google OAuth + allowlist)
// ============================================================
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
// ALLOWED_EMAILS : liste séparée par virgule, lowercase au chargement.
const ALLOWED_EMAILS = new Set(
    (process.env.ALLOWED_EMAILS || '')
        .split(',')
        .map(e => e.trim().toLowerCase())
        .filter(Boolean)
);
// PUBLIC_URL : URL publique du déploiement, utilisée pour construire le redirect_uri OAuth.
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
// SESSION_SECRET : signe les cookies de session. En prod, le set explicitement.
const SESSION_SECRET = (process.env.SESSION_SECRET || '').trim()
    || crypto.randomBytes(48).toString('base64url');
// Auth OFF si aucune des 3 vars n'est set (dev local). En prod, les 3 doivent être set.
const AUTH_ENABLED = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && ALLOWED_EMAILS.size > 0);

if (AUTH_ENABLED) {
    console.log(`[auth] Google OAuth enabled, allowlist:`, [...ALLOWED_EMAILS]);
    if (!PUBLIC_URL) {
        console.warn('[auth] WARN: AUTH_ENABLED but PUBLIC_URL missing — redirect_uri sera relatif');
    }
} else {
    console.log('[auth] DISABLED (no GOOGLE_CLIENT_ID/SECRET/ALLOWED_EMAILS) — app ouverte');
}

// Coolify proxifie via Traefik → on doit trust le X-Forwarded-Proto pour que
// les cookies `secure` soient bien posés sur HTTPS.
if (PUBLIC_URL.startsWith('https://')) {
    app.set('trust proxy', 1);
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Session middleware AVANT l'auth gate
app.use(session({
    secret: SESSION_SECRET,
    name: 'avalution_session',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: PUBLIC_URL.startsWith('https://'),
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 14 * 24 * 60 * 60 * 1000,  // 14 jours
    },
}));

// ============================================================
// AUTH GATE — toute requête passe par ici. Public paths whitelistés.
// ============================================================
const PUBLIC_PREFIXES = ['/auth/', '/login.html', '/styles.css'];
const PUBLIC_EXACT = new Set(['/api/me', '/favicon.ico']);

function isPublicPath(p) {
    if (PUBLIC_EXACT.has(p)) return true;
    return PUBLIC_PREFIXES.some(prefix => p.startsWith(prefix));
}

app.use((req, res, next) => {
    if (!AUTH_ENABLED) return next();
    if (isPublicPath(req.path)) return next();

    const email = req.session?.user_email;
    const authorized = email && ALLOWED_EMAILS.has(email);

    // API : 401 JSON pour que le front réagisse
    if (req.path.startsWith('/api/')) {
        if (!authorized) return res.status(401).json({ error: 'auth required' });
        return next();
    }
    // Page navigation : redirige vers login
    if (!authorized) return res.redirect('/login.html');
    return next();
});

// ============================================================
// OAUTH ROUTES — Google
// ============================================================
function redirectUri() {
    return `${PUBLIC_URL}/auth/google/callback`;
}

app.get('/auth/google/login', (req, res) => {
    if (!AUTH_ENABLED) return res.status(503).send('auth not configured');
    const state = crypto.randomBytes(24).toString('base64url');
    req.session.oauth_state = state;
    const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri(),
        response_type: 'code',
        scope: 'openid email profile',
        state,
        access_type: 'online',
        prompt: 'select_account',
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

app.get('/auth/google/callback', async (req, res) => {
    if (!AUTH_ENABLED) return res.status(503).send('auth not configured');
    const { code, state, error } = req.query;
    if (error) return res.redirect(`/login.html?error=${encodeURIComponent(error)}`);
    const expected = req.session.oauth_state;
    delete req.session.oauth_state;
    if (!code || !state || state !== expected) {
        return res.redirect('/login.html?error=invalid_state');
    }
    try {
        const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                redirect_uri: redirectUri(),
                grant_type: 'authorization_code',
            }),
        });
        if (!tokenResp.ok) throw new Error(`token exchange status ${tokenResp.status}`);
        const tokenData = await tokenResp.json();
        const access_token = tokenData.access_token;
        if (!access_token) throw new Error('no access_token in response');

        const userResp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { 'Authorization': `Bearer ${access_token}` },
        });
        if (!userResp.ok) throw new Error(`userinfo status ${userResp.status}`);
        const user = await userResp.json();

        const email = (user.email || '').toLowerCase();
        const verified = Boolean(user.email_verified);
        if (!email || !verified) return res.redirect('/login.html?error=unverified');
        if (!ALLOWED_EMAILS.has(email)) {
            const q = new URLSearchParams({ error: 'unauthorized', email });
            return res.redirect(`/login.html?${q}`);
        }
        req.session.user_email = email;
        req.session.user_name = user.name || '';
        req.session.user_picture = user.picture || '';
        return res.redirect('/');
    } catch (e) {
        console.error('[auth] OAuth exchange failed:', e.message);
        return res.redirect('/login.html?error=token_exchange');
    }
});

app.post('/auth/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
    if (!AUTH_ENABLED) {
        return res.json({ authenticated: true, email: 'anonymous', auth_enabled: false });
    }
    const email = req.session?.user_email;
    if (!email || !ALLOWED_EMAILS.has(email)) {
        return res.status(401).json({ authenticated: false, auth_enabled: true });
    }
    return res.json({
        authenticated: true,
        auth_enabled: true,
        email,
        name: req.session.user_name || '',
        picture: req.session.user_picture || '',
    });
});

// Static files servis APRÈS l'auth gate → les fichiers privés (index.html, app.js,
// avatars/, backgrounds/) sont automatiquement protégés sauf si dans la whitelist.
app.use(express.static(__dirname));

// ============================================================
// CONFIG
// ============================================================
const AZURE_CHAT_ENDPOINT = process.env.AZURE_CHAT_ENDPOINT;
const AZURE_CHAT_KEY = process.env.AZURE_CHAT_KEY;
const AZURE_CHAT_DEPLOYMENT = process.env.AZURE_CHAT_DEPLOYMENT || 'gpt-5.4-nano-2';
const AZURE_CHAT_API_VERSION = process.env.AZURE_CHAT_API_VERSION || '2024-12-01-preview';

const MISTRAL_TTS_ENDPOINT = process.env.MISTRAL_TTS_ENDPOINT || 'https://api.mistral.ai/v1/audio/speech';
const MISTRAL_TTS_KEY = process.env.MISTRAL_TTS_KEY;
const MISTRAL_TTS_MODEL = process.env.MISTRAL_TTS_MODEL || 'voxtral-mini-tts-2603';
const MISTRAL_TTS_DEFAULT_VOICE = process.env.MISTRAL_TTS_DEFAULT_VOICE;

const AZURE_SPEECH_ENDPOINT = process.env.AZURE_SPEECH_ENDPOINT;
const AZURE_SPEECH_KEY = process.env.AZURE_SPEECH_KEY;
const AZURE_SPEECH_DEFAULT_VOICE = process.env.AZURE_SPEECH_DEFAULT_VOICE || 'fr-FR-HenriNeural';
const AZURE_SPEECH_OUTPUT_FORMAT = process.env.AZURE_SPEECH_OUTPUT_FORMAT || 'riff-24khz-16bit-mono-pcm';

const AZURE_REALTIME_ENDPOINT = process.env.AZURE_REALTIME_ENDPOINT;
const AZURE_REALTIME_KEY = process.env.AZURE_REALTIME_KEY;
const AZURE_REALTIME_DEPLOYMENT = process.env.AZURE_REALTIME_DEPLOYMENT || 'gpt-realtime-1.5';
const AZURE_REALTIME_API_VERSION = process.env.AZURE_REALTIME_API_VERSION || '2024-10-01-preview';
const AZURE_REALTIME_DEFAULT_VOICE = process.env.AZURE_REALTIME_DEFAULT_VOICE || 'echo';

// ============================================================
// SYSTEM PROMPTS — adaptés aux contraintes de chaque TTS
// ============================================================
const BASE_TTS_RULES = `RÈGLES IMPÉRATIVES — TON TEXTE SERA LU PAR UN MOTEUR DE SYNTHÈSE VOCALE :

1. AUCUN emoji ni pictogramme (😊 🎉 ❤️ ✨ → INTERDITS — ils sont lus comme "smiley souriant" ou produisent des artefacts audio).

2. AUCUN markdown :
   - pas de **gras**, *italique*, _souligné_, \`code\`
   - pas de #titres, >citations, --- séparateurs
   - pas de listes à puces (- ou *)

3. AUCUN caractère décoratif au milieu d'une phrase : pas de [ ] { } | ~ ^ °.
   Ponctuation française standard SEULEMENT : point, virgule, point-virgule, deux-points, point d'interrogation, point d'exclamation.

4. Abréviations à épeler en toutes lettres :
   - "etc." -> "et cetera"
   - "M./Mme/Dr/Pr" -> "Monsieur/Madame/Docteur/Professeur"
   - "1er, 2ème, 3ème" -> "premier, deuxième, troisième"
   - Acronymes courants (DSI, RH, IA, API, URL, CEO) : OK tels quels (prononcés en lettres).

5. AUCUN URL, email ou chemin de fichier verbalisé. Si tu dois en mentionner, dis "à cette adresse" ou "via ce lien".

6. Nombres :
   - Petits (< 100) : préfère les lettres ("vingt-cinq pour cent")
   - Grands / années / années : OK en chiffres ("1 500", "2026")

7. LONGUEUR CIBLE : environ 300 à 400 caractères (2 à 4 phrases courtes). C'est une CIBLE, pas un plafond rigide — tu peux dépasser de 100-200 caractères pour terminer ta dernière phrase proprement. NE COUPE JAMAIS une phrase au milieu : finis toujours par un point, un point d'interrogation ou un point d'exclamation. Mieux vaut une réponse un peu plus longue mais complète qu'une coupure abrupte.

8. Style oral conversationnel, chaleureux. Évite le ton rapport écrit, les phrases trop longues.`;

const SYSTEM_PROMPT_BASE = `Tu es Eric, un assistant virtuel masculin, sympathique, naturel et serviable, qui parle exclusivement en FRANÇAIS de France. Quand tu parles de toi, tu accordes au masculin ("content", "ravi", "désolé"…) — jamais au féminin. Tu es un homme.

${BASE_TTS_RULES}`;

// Suffixes spécifiques au moteur TTS utilisé
const ENGINE_SUFFIX = {
    mistral: `\n\n9. Limite TECHNIQUE Mistral Voxtral : 300 mots maximum. Reste bien en deçà.`,
    azure_tts: `\n\n9. Le moteur Azure Speech gère automatiquement les pauses (virgules, points). Ponctue normalement.`,
    azure_realtime: `

9. Tu vas TOI-MÊME prononcer ta réponse vocalement. Tu dois suivre RIGOUREUSEMENT les règles de voix ci-dessous, à CHAQUE interaction, sans exception.

═══════════════════════════════════════════════════════════
RÈGLES DE VOIX — IMMUABLES, IDENTIQUES À CHAQUE RÉPONSE
═══════════════════════════════════════════════════════════

Tu es Eric, et Eric a TOUJOURS exactement la même voix. Les caractéristiques de ta voix ne varient JAMAIS d'une réponse à l'autre. Imagine que tu es un acteur professionnel qui doit livrer la même performance vocale, prise après prise.

TIMBRE : voix masculine adulte, médium-grave, chaude et posée. Jamais aiguë, jamais théâtrale.

DÉBIT : modéré et régulier. Environ 150 mots par minute. Jamais précipité, jamais traînant. Pas de variations de vitesse entre les phrases.

TON : neutre professionnel, légèrement bienveillant. Pas enthousiaste. Pas triste. Pas surpris. Pas inquiet. Un homme calme et serviable qui fait son travail.

INTONATION : conversationnelle naturelle, peu marquée. Évite les montées dramatiques en fin de phrase. Évite les emphases marquées sur certains mots.

VOLUME : constant. Jamais de chuchotement. Jamais d'élévation. Aucun effet de proximité ou d'éloignement.

ACCENT : français de France standard (Île-de-France neutre). Jamais d'accent régional, jamais d'accent étranger, jamais d'imitation.

INTERDICTIONS ABSOLUES :
- Aucun rire, sourire audible, soupir, ou son non-verbal
- Aucune hésitation type "euh", "hmm", "ben"
- Aucune imitation, aucun changement de personnage
- Aucun effet de style (voix off, narrateur dramatique, etc.)
- Aucune variation émotionnelle marquée même si le contenu est joyeux/triste
- Aucun chant, aucune mélodie, aucun rythme particulier

ANCRAGE : Tu es exactement le MÊME locuteur que la fois précédente, et que la fois d'avant. Si tu sens l'impulsion de varier ton style vocal — résiste. Maintiens une livraison strictement identique.
═══════════════════════════════════════════════════════════`,
};

function getSystemPrompt(engine) {
    return SYSTEM_PROMPT_BASE + (ENGINE_SUFFIX[engine] || '');
}

// Sanitisation défensive : retire emojis/markdown si le modèle a dérapé,
// avant d'envoyer à Mistral/Azure TTS qui les lisent littéralement.
function sanitizeForTTS(text) {
    if (!text) return '';
    return text
        // Emojis (plages Unicode principales)
        .replace(/[\u{1F600}-\u{1F64F}]/gu, '')   // emoticons
        .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')   // symbols & pictographs
        .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')   // transport & map
        .replace(/[\u{1F900}-\u{1F9FF}]/gu, '')   // supplemental symbols
        .replace(/[\u{1FA70}-\u{1FAFF}]/gu, '')   // symbols & pictographs ext-A
        .replace(/[\u{2600}-\u{26FF}]/gu, '')     // misc symbols
        .replace(/[\u{2700}-\u{27BF}]/gu, '')     // dingbats
        .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '')   // flags
        // Markdown markers
        .replace(/\*\*([^*]+)\*\*/g, '$1')         // **gras**
        .replace(/\*([^*]+)\*/g, '$1')             // *italique*
        .replace(/_([^_]+)_/g, '$1')               // _italique_
        .replace(/`([^`]+)`/g, '$1')               // `code`
        .replace(/^#+\s+/gm, '')                   // # titres
        .replace(/^>\s*/gm, '')                    // > citations
        .replace(/^[-*]\s+/gm, '')                 // - listes / * listes
        // Caractères décoratifs orphelins
        .replace(/[\[\]{}|~^°]/g, '')
        // Espaces multiples
        .replace(/\s+/g, ' ')
        .trim();
}

// ============================================================
// /api/speak — dispatch selon engine
// Body: { text, voice, engine: 'mistral' | 'azure_tts' | 'azure_realtime' }
// ============================================================
app.post('/api/speak', async (req, res) => {
    const { text, voice, engine = 'mistral', temperature, history } = req.body;
    if (!text || !text.trim()) {
        return res.status(400).json({ error: 'No text provided' });
    }

    // Sanitisation de l'historique : on accepte uniquement role/content, on limite à 32 messages
    // (16 échanges) pour cap les tokens même si le client envoie plus.
    const safeHistory = Array.isArray(history)
        ? history
            .filter(t => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string')
            .slice(-32)
        : [];

    try {
        let result;
        const t0 = Date.now();
        const systemPrompt = getSystemPrompt(engine);

        if (engine === 'azure_realtime') {
            result = await speakViaRealtime(text, voice || AZURE_REALTIME_DEFAULT_VOICE, systemPrompt, temperature, safeHistory);
        } else if (engine === 'azure_tts') {
            const chatResponse = await callAzureChat(text, systemPrompt, safeHistory);
            const clean = sanitizeForTTS(chatResponse);
            const audio = await callAzureSpeech(clean, voice || AZURE_SPEECH_DEFAULT_VOICE);
            result = { message: chatResponse, audio, format: 'wav' };
        } else {
            // default: mistral
            const chatResponse = await callAzureChat(text, systemPrompt, safeHistory);
            const clean = sanitizeForTTS(chatResponse);
            const audio = await callMistralTTS(clean, voice || MISTRAL_TTS_DEFAULT_VOICE);
            result = { message: chatResponse, audio, format: 'wav' };
        }

        const total = Date.now() - t0;
        console.log(`[speak] engine=${engine} history=${safeHistory.length} total=${total}ms msg="${(result.message || '').slice(0, 60)}…"`);
        res.json({ ...result, engine, timings: { total } });

    } catch (error) {
        console.error(`[speak] engine=${engine} error:`, error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

// ============================================================
// CHAT : Azure OpenAI Chat Completions (gpt-nano)
// ============================================================
async function callAzureChat(userMessage, systemPrompt, history) {
    if (!AZURE_CHAT_ENDPOINT || !AZURE_CHAT_KEY) {
        throw new Error('Azure chat not configured (check .env)');
    }
    const url = `${AZURE_CHAT_ENDPOINT}/openai/deployments/${AZURE_CHAT_DEPLOYMENT}/chat/completions?api-version=${AZURE_CHAT_API_VERSION}`;
    // Construit messages = [system, ...history, current user]. L'historique fournit le contexte
    // conversationnel ; sans lui, chaque tour repart à zéro.
    const messages = [
        { role: 'system', content: systemPrompt || SYSTEM_PROMPT_BASE },
        ...(Array.isArray(history) ? history : []),
        { role: 'user', content: userMessage },
    ];
    const body = {
        messages,
        // Headroom suffisant pour que le modèle termine sa phrase naturellement.
        // La longueur réelle est pilotée par le prompt (~300-400 chars), pas par ce cap.
        // 800 tokens ≈ 600 mots français = jamais atteint si le prompt est respecté.
        max_completion_tokens: 800,
        temperature: 0.5,        // plus stable, moins créatif (Azure chat default = 1.0)
    };
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': AZURE_CHAT_KEY },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        const txt = await response.text();
        throw new Error(`Azure chat ${response.status}: ${txt.slice(0, 200)}`);
    }
    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
}

// ============================================================
// TTS Engine 1 : Mistral Voxtral
// ============================================================
async function callMistralTTS(text, voiceId) {
    if (!MISTRAL_TTS_KEY) throw new Error('Mistral TTS not configured');
    const body = {
        model: MISTRAL_TTS_MODEL,
        input: text,
        voice_id: voiceId,
        response_format: 'wav',
    };
    const response = await fetch(MISTRAL_TTS_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${MISTRAL_TTS_KEY}`,
        },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        const txt = await response.text();
        throw new Error(`Mistral TTS ${response.status}: ${txt.slice(0, 200)}`);
    }
    const data = await response.json();
    return data.audio_data;  // déjà base64 WAV
}

// ============================================================
// TTS Engine 2 : Azure Speech Services (Neural Voice via SSML)
// ============================================================
async function callAzureSpeech(text, voiceName) {
    if (!AZURE_SPEECH_KEY || !AZURE_SPEECH_ENDPOINT) {
        throw new Error('Azure Speech not configured');
    }
    const safeText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const ssml = `<speak version='1.0' xml:lang='fr-FR'><voice xml:lang='fr-FR' name='${voiceName}'>${safeText}</voice></speak>`;
    const response = await fetch(AZURE_SPEECH_ENDPOINT, {
        method: 'POST',
        headers: {
            'Ocp-Apim-Subscription-Key': AZURE_SPEECH_KEY,
            'Content-Type': 'application/ssml+xml',
            'X-Microsoft-OutputFormat': AZURE_SPEECH_OUTPUT_FORMAT,
            'User-Agent': 'avalution-portable',
        },
        body: ssml,
    });
    if (!response.ok) {
        const txt = await response.text();
        throw new Error(`Azure Speech ${response.status}: ${txt.slice(0, 200)}`);
    }
    const buf = Buffer.from(await response.arrayBuffer());
    return buf.toString('base64');  // base64 WAV (riff-24khz-16bit-mono-pcm)
}

// ============================================================
// TTS Engine 3 : Azure GPT-Realtime (WS, chat + TTS combinés)
// ============================================================
async function speakViaRealtime(text, voice, systemPrompt, temperature, history) {
    if (!AZURE_REALTIME_KEY || !AZURE_REALTIME_ENDPOINT) {
        throw new Error('Azure Realtime not configured');
    }
    // Clamp dans la plage autorisée par Azure (0.6 - 1.2). Default = 0.6 (min = max stable).
    const safeTemp = Number.isFinite(temperature)
        ? Math.max(0.6, Math.min(1.2, temperature))
        : 0.6;
    const safeHistory = Array.isArray(history) ? history : [];
    return new Promise((resolve, reject) => {
        const wsUrl = `${AZURE_REALTIME_ENDPOINT}?api-version=${AZURE_REALTIME_API_VERSION}&deployment=${AZURE_REALTIME_DEPLOYMENT}`;
        const ws = new WebSocket(wsUrl, { headers: { 'api-key': AZURE_REALTIME_KEY } });

        const audioChunks = [];
        let textResponse = '';
        let sessionConfigured = false;
        // Timeout 120s : assez pour générer ~800 tokens audio même à rythme lent
        // (~25 t/s en burst), tout en évitant qu'une session "morte" reste ouverte.
        const timeout = setTimeout(() => {
            ws.close();
            reject(new Error('Realtime timeout (120s)'));
        }, 120000);

        ws.on('open', () => {
            ws.send(JSON.stringify({
                type: 'session.update',
                session: {
                    modalities: ['text', 'audio'],
                    instructions: systemPrompt || SYSTEM_PROMPT_BASE,
                    voice,
                    output_audio_format: 'pcm16',
                    turn_detection: null,
                    // Temperature paramétrable via slider front (range Azure : 0.6 - 1.2).
                    temperature: safeTemp,
                    // Headroom : la cible (~300-400 chars) est dans le prompt. Ce cap est juste
                    // un filet de sécurité pour ne pas générer un monologue de 5 minutes en cas
                    // de dérive — pas un plafond serré qui couperait au milieu d'une phrase.
                    max_response_output_tokens: 800,
                    // Pas d'outils → pas de fonction-calling qui pourrait introduire des
                    // changements de mode/personnalité dans la génération.
                    tools: [],
                    tool_choice: 'none',
                }
            }));
        });

        ws.on('message', (data) => {
            try {
                const event = JSON.parse(data.toString());
                if (event.type === 'session.created' || event.type === 'session.updated') {
                    if (!sessionConfigured) {
                        sessionConfigured = true;

                        // 1. Réinjecte l'historique conversationnel dans l'ordre.
                        //    Format Azure Realtime : user → input_text, assistant → text.
                        //    Cela donne au modèle :
                        //      a) la mémoire du contexte (continuité conversationnelle)
                        //      b) un ancrage textuel sur sa propre prosodie passée (stabilité voix)
                        for (const turn of safeHistory) {
                            const isUser = turn.role === 'user';
                            ws.send(JSON.stringify({
                                type: 'conversation.item.create',
                                item: {
                                    type: 'message',
                                    role: isUser ? 'user' : 'assistant',
                                    content: [{
                                        type: isUser ? 'input_text' : 'text',
                                        text: turn.content,
                                    }],
                                }
                            }));
                        }

                        // 2. Puis le nouveau message utilisateur
                        ws.send(JSON.stringify({
                            type: 'conversation.item.create',
                            item: {
                                type: 'message',
                                role: 'user',
                                content: [{ type: 'input_text', text }]
                            }
                        }));
                        ws.send(JSON.stringify({ type: 'response.create' }));
                    }
                }
                if (event.type === 'response.audio.delta') {
                    audioChunks.push(Buffer.from(event.delta, 'base64'));
                }
                if (event.type === 'response.audio_transcript.delta') {
                    textResponse += event.delta;
                }
                if (event.type === 'response.done') {
                    clearTimeout(timeout);
                    ws.close();
                    const pcm = Buffer.concat(audioChunks);
                    // On wrap le PCM16 dans un header WAV pour que le front puisse le décoder uniformément
                    const wav = pcm16ToWav(pcm, 24000);
                    resolve({
                        message: textResponse,
                        audio: wav.toString('base64'),
                        format: 'wav',
                    });
                }
                if (event.type === 'error') {
                    clearTimeout(timeout);
                    ws.close();
                    reject(new Error(`Realtime API: ${event.error?.message || 'unknown'}`));
                }
            } catch (e) {
                console.error('[realtime] parse error:', e);
            }
        });

        ws.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
        ws.on('close', () => clearTimeout(timeout));
    });
}

// Helper : enveloppe PCM16 mono dans un container WAV
function pcm16ToWav(pcmBuffer, sampleRate = 24000) {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const dataSize = pcmBuffer.length;

    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);            // PCM
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);

    return Buffer.concat([header, pcmBuffer]);
}

// ============================================================
// /api/voices — passthrough Mistral pour lister les voix dispo
// ============================================================
app.get('/api/voices', async (req, res) => {
    try {
        const response = await fetch('https://api.mistral.ai/v1/audio/voices?limit=200', {
            headers: { 'Authorization': `Bearer ${MISTRAL_TTS_KEY}` }
        });
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Avalution Portable démarré sur http://localhost:${PORT}`);
    console.log(`Chat brain     : ${AZURE_CHAT_DEPLOYMENT}`);
    console.log(`Engine mistral : ${MISTRAL_TTS_MODEL}`);
    console.log(`Engine azure_tts: Azure Speech ${AZURE_SPEECH_DEFAULT_VOICE}`);
    console.log(`Engine realtime: ${AZURE_REALTIME_DEPLOYMENT}`);
});
