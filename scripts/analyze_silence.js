/**
 * Génère 3 audios test sur GPT-Realtime, calcule le RMS par fenêtre de 50 ms
 * (même algo que detectSilenceSegments), et affiche distribution + percentiles
 * pour identifier le bon silence threshold.
 *
 * Sortie attendue :
 *   - Pour chaque sample : durée, range RMS, percentiles, histogramme cumulatif
 *   - À la fin : recommandation de threshold basée sur :
 *       a) le P05 global (= bruit de fond / vrais silences)
 *       b) le P25 global (= traîne audible des fins de mots)
 *   - Le threshold idéal se situe entre ces deux valeurs.
 */
require('dotenv').config();
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const PHRASES = [
    // Sample 1 : phrase courte, fin sur consonne nasale (traîne longue)
    "Bonjour. Je m'appelle Eric.",
    // Sample 2 : phrase moyenne avec pause naturelle au milieu (virgule)
    "Tout va très bien, merci beaucoup de votre question.",
    // Sample 3 : phrase plus longue avec point central
    "Je suis votre assistant. Vous pouvez me poser toutes vos questions techniques.",
];

const SAMPLE_RATE = 24000;
const WINDOW_DURATION = 0.05;  // 50ms — identique à app.js
const WINDOW_SIZE = Math.floor(SAMPLE_RATE * WINDOW_DURATION);

function generateAudio(text) {
    return new Promise((resolve, reject) => {
        const wsUrl = `${process.env.AZURE_REALTIME_ENDPOINT}?api-version=${process.env.AZURE_REALTIME_API_VERSION}&deployment=${process.env.AZURE_REALTIME_DEPLOYMENT}`;
        const ws = new WebSocket(wsUrl, { headers: { 'api-key': process.env.AZURE_REALTIME_KEY } });
        const audioChunks = [];
        let configured = false;
        const timeout = setTimeout(() => {
            ws.close();
            reject(new Error('timeout'));
        }, 60000);

        ws.on('open', () => {
            ws.send(JSON.stringify({
                type: 'session.update',
                session: {
                    modalities: ['text', 'audio'],
                    voice: 'echo',
                    output_audio_format: 'pcm16',
                    turn_detection: null,
                    temperature: 1.0,
                    instructions: "Tu réponds exactement par le texte qu'on te donne, sans rien ajouter ni paraphraser. Voix neutre.",
                }
            }));
        });

        ws.on('message', (data) => {
            const ev = JSON.parse(data.toString());
            if ((ev.type === 'session.created' || ev.type === 'session.updated') && !configured) {
                configured = true;
                ws.send(JSON.stringify({
                    type: 'conversation.item.create',
                    item: {
                        type: 'message',
                        role: 'user',
                        content: [{ type: 'input_text', text: `Dis exactement : "${text}"` }]
                    }
                }));
                ws.send(JSON.stringify({ type: 'response.create' }));
            }
            if (ev.type === 'response.audio.delta') {
                audioChunks.push(Buffer.from(ev.delta, 'base64'));
            }
            if (ev.type === 'response.done') {
                clearTimeout(timeout);
                ws.close();
                resolve(Buffer.concat(audioChunks));
            }
            if (ev.type === 'error') {
                clearTimeout(timeout);
                ws.close();
                reject(new Error(ev.error?.message || 'realtime error'));
            }
        });
        ws.on('error', (e) => { clearTimeout(timeout); reject(e); });
    });
}

function analyzeRMS(pcm16Buffer) {
    const numSamples = pcm16Buffer.length / 2;
    const rms = [];
    for (let i = 0; i < numSamples; i += WINDOW_SIZE) {
        let sum = 0;
        const end = Math.min(i + WINDOW_SIZE, numSamples);
        for (let j = i; j < end; j++) {
            const sample = pcm16Buffer.readInt16LE(j * 2) / 32768;
            sum += Math.abs(sample);
        }
        rms.push({ time: i / SAMPLE_RATE, rms: sum / (end - i) });
    }
    return rms;
}

function percentile(sortedArr, p) {
    return sortedArr[Math.min(Math.floor(sortedArr.length * p), sortedArr.length - 1)];
}

function summarize(rms, label) {
    const values = rms.map(r => r.rms);
    const sorted = [...values].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];

    console.log(`\n========================================================`);
    console.log(`=== ${label}`);
    console.log(`========================================================`);
    console.log(`  Durée: ${rms[rms.length-1].time.toFixed(2)}s   Fenêtres 50ms: ${rms.length}`);
    console.log(`  RMS range: ${min.toFixed(5)} … ${max.toFixed(5)}`);
    console.log(`\n  Percentiles (RMS / amplitude moyenne par fenêtre 50ms):`);
    [0.01, 0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.99].forEach(p => {
        const v = percentile(sorted, p);
        const label = p < 0.10 ? '← bruit de fond/silences vrais'
                   : p < 0.25 ? '← traîne audible'
                   : p < 0.75 ? '← speech actif'
                   : '← pics';
        console.log(`    P${(p*100).toFixed(0).padStart(2,' ')}: ${v.toFixed(5)}   ${label}`);
    });

    console.log(`\n  Histogramme cumulatif (% de fenêtres sous chaque threshold candidat) :`);
    [0.005, 0.010, 0.015, 0.020, 0.025, 0.030, 0.040, 0.050, 0.060, 0.080, 0.100].forEach(t => {
        const pct = (values.filter(v => v < t).length / values.length * 100).toFixed(1);
        const bar = '█'.repeat(Math.round(pct / 2));
        console.log(`    < ${t.toFixed(3)}:  ${pct.padStart(5)}%  ${bar}`);
    });

    return values;
}

(async () => {
    const outDir = path.join(__dirname, '..', 'analysis');
    fs.mkdirSync(outDir, { recursive: true });

    const allValues = [];
    for (let i = 0; i < PHRASES.length; i++) {
        const text = PHRASES[i];
        console.log(`\n--- Generating sample ${i+1}: "${text}"`);
        try {
            const pcm = await generateAudio(text);
            const pcmFile = path.join(outDir, `sample_${i+1}.pcm`);
            fs.writeFileSync(pcmFile, pcm);
            console.log(`    Saved: ${pcmFile} (${(pcm.length / 1024).toFixed(1)} KB)`);

            const rms = analyzeRMS(pcm);
            const values = summarize(rms, `Sample ${i+1}: "${text.slice(0,50)}…"`);
            allValues.push(...values);

            // Dump CSV pour visualisation externe
            const csvFile = path.join(outDir, `sample_${i+1}_rms.csv`);
            fs.writeFileSync(csvFile, 'time,rms\n' + rms.map(r => `${r.time.toFixed(3)},${r.rms.toFixed(6)}`).join('\n'));
            console.log(`    CSV: ${csvFile}`);
        } catch (e) {
            console.error(`    ERROR: ${e.message}`);
        }
    }

    // Agrégat global
    if (allValues.length > 0) {
        console.log(`\n\n========================================================`);
        console.log(`=== AGRÉGAT GLOBAL (${allValues.length} fenêtres au total)`);
        console.log(`========================================================`);
        const sorted = allValues.sort((a, b) => a - b);
        const p05 = percentile(sorted, 0.05);
        const p10 = percentile(sorted, 0.10);
        const p15 = percentile(sorted, 0.15);
        const p25 = percentile(sorted, 0.25);
        console.log(`  P05 (bruit de fond + vrais silences) : ${p05.toFixed(5)}`);
        console.log(`  P10                                  : ${p10.toFixed(5)}`);
        console.log(`  P15                                  : ${p15.toFixed(5)}`);
        console.log(`  P25 (traîne audible/zone ambiguë)    : ${p25.toFixed(5)}`);

        console.log(`\n  RECOMMANDATION :`);
        const recommended = (p05 + p15) / 2;
        console.log(`    Threshold suggéré : ~${recommended.toFixed(3)}`);
        console.log(`    (Entre P05=bruit et P15=traîne → marge contre les faux positifs sans rater de vrai silence)`);
        console.log(`    Actuellement dans app.js : 0.02`);
        if (recommended > 0.025) console.log(`    → recommandation : RELEVER le seuil à ${recommended.toFixed(3)}`);
        else console.log(`    → le seuil 0.02 actuel est probablement bon, le problème est ailleurs (post-padding ?)`);
    }
})();
