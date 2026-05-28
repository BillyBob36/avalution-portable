"""
Upload de voix françaises sur Mistral Voxtral via voice cloning.
Les voix EN du catalogue ont un accent trop fort en français --> on clone des samples FR.
"""
import base64
import requests
import json
import os

KEY = os.environ.get('MISTRAL_TTS_KEY', 'v8bjb0SWdeIJmlW57wb8ta8HW0OpQNXY')
ENDPOINT = 'https://api.mistral.ai/v1/audio/voices'

VOICES_TO_UPLOAD = [
    {
        'file': 'voice-samples/eric-fr.wav',
        'name': 'Eric FR',
        'languages': ['fr'],
        'gender': 'male',
        'age': 40,
        'tags': ['corporate', 'french', 'cloned'],
    },
    {
        'file': 'voice-samples/pangramme-toon.mp3',
        'name': 'FR Casual',
        'languages': ['fr'],
        'gender': 'female',
        'age': 28,
        'tags': ['casual', 'french', 'cloned'],
    },
    {
        'file': 'voice-samples/pangramme-industrie.mp3',
        'name': 'FR Industrial',
        'languages': ['fr'],
        'gender': 'male',
        'age': 35,
        'tags': ['serious', 'french', 'cloned'],
    },
]


def upload_voice(spec):
    print(f"\n--> Uploading {spec['name']} from {spec['file']}")
    with open(spec['file'], 'rb') as f:
        audio_b64 = base64.b64encode(f.read()).decode('ascii')
    print(f"  audio: {len(audio_b64)} chars base64")

    body = {
        'name': spec['name'],
        'sample_audio': audio_b64,
        'sample_filename': os.path.basename(spec['file']),
        'languages': spec['languages'],
        'gender': spec['gender'],
        'age': spec['age'],
        'tags': spec['tags'],
    }

    response = requests.post(
        ENDPOINT,
        headers={
            'Authorization': f'Bearer {KEY}',
            'Content-Type': 'application/json',
        },
        json=body,
        timeout=60,
    )

    if response.ok:
        data = response.json()
        vid = data.get('id', '?')
        slug = data.get('slug', '?')
        print(f"  OK --> id={vid}")
        print(f"       slug={slug}")
        return data
    else:
        print(f"  FAILED {response.status_code}")
        print(f"  {response.text[:500]}")
        return None


if __name__ == '__main__':
    results = []
    for spec in VOICES_TO_UPLOAD:
        r = upload_voice(spec)
        if r:
            results.append({
                'name': spec['name'],
                'id': r.get('id'),
                'slug': r.get('slug'),
            })

    print('\n=== JS catalog entries to add to MISTRAL_VOICES ===')
    for r in results:
        print(f"    {{ id: \"{r['id']}\", label: \"{r['name']} · clonée FR\" }},")
