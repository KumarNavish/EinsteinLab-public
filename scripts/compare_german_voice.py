"""Four matched native voice samples; no microphone, billing or new provider.

Run explicitly while the application has no active visitor. Only the already
configured, approved free-tier credential is used. Do not print provider URLs or
credentials. Samples are synthetic performance tests, not historical recordings.
"""
from __future__ import annotations
import asyncio
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
import time
import wave
import httpx
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from lab_backend.native_config import NativeConfig
from lab_backend.native_live import google_session

TEXT = "Perhaps the most interesting question is not whether a machine can think. It is whether the machine helps us think more clearly. Let us look at the evidence together, and remain a little suspicious of an answer that seems too perfect."
BASE = "You are a clearly disclosed synthetic older scientist. Speak the requested English text exactly, with natural conversational cadence, no introductions or closing remarks. Never claim this is an authentic historical recording."
GERMAN = "Your native language is German. Speak fluent, intelligible English with a subtle but recognizable German-influenced accent: gently German-shaped vowels and consonants, lightly German-influenced rhythm and thoughtful phrasing. You are an elderly male scientist, warm, dryly curious, slightly textured, not booming. Do not exaggerate, parody, stutter, fake illness, replace written words with stereotypes, or speak German. Keep the actual dialogue unchanged."

async def main():
    status = httpx.get('http://127.0.0.1:8765/api/native/status', timeout=5).json()
    if status.get('active'):
        raise SystemExit('A visitor is active; no comparison was started.')
    config = NativeConfig(ROOT)
    key = config.credential()
    output = ROOT / 'evidence/runtime/c10' / ('voices-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    output.mkdir(parents=True)
    rows = []
    declaration = {'name': 'no_external_action', 'description': 'This performance test has no external actions.', 'parameters': {'type': 'OBJECT', 'properties': {}}}
    for voice, accent in [('Algenib', False), ('Algenib', True), ('Gacrux', True), ('Sadaltager', True)]:
        system = BASE + ('\n' + GERMAN if accent else '\nUse your ordinary fluent English voice.')
        name = voice + ('-german' if accent else '-baseline')
        row = {'voice': voice, 'direction': 'subtle-German-influenced-English' if accent else 'baseline-English', 'text': TEXT}
        audio = bytearray(); transcript = ''; first = None; started = time.perf_counter()
        try:
            async with asyncio.timeout(55):
                async with google_session(key, system, declaration, voice=voice) as session:
                    from google.genai import types
                    await session.send_client_content(turns={'role': 'user', 'parts': [{'text': 'Read exactly this dialogue, and nothing else: ' + TEXT}]}, turn_complete=True)
                    async for response in session.receive():
                        content = response.server_content
                        if not content: continue
                        if content.output_transcription and content.output_transcription.text:
                            transcript += content.output_transcription.text
                        if content.model_turn:
                            for part in content.model_turn.parts or []:
                                data = part.inline_data
                                if data and data.data and (data.mime_type or '').startswith('audio/pcm'):
                                    if first is None: first = round((time.perf_counter()-started)*1000, 1)
                                    audio.extend(data.data)
                        if content.turn_complete: break
            if not audio: raise ValueError('No output audio')
            path = output / (name + '.wav')
            with wave.open(str(path), 'wb') as wav:
                wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(24000); wav.writeframes(audio)
            row.update(status='audio-received', first_packet_ms=first, audio_seconds=round(len(audio)/48000,3),
                       transcript=transcript, wav_sha256=hashlib.sha256(path.read_bytes()).hexdigest(), file=path.name)
        except Exception as error:
            row.update(status='failed', exception_type=type(error).__name__)
        rows.append(row)
        (output/'report.json').write_text(json.dumps({'scope':'Matched requested dialogue and existing voices, four separate free-tier native sessions. First-packet timing includes connection. Accent, perceived age and quality need listening evaluation; no accent or human-realism score is fabricated.', 'results':rows}, indent=2))
        print(json.dumps(row), flush=True)
    print('VOICE_EVIDENCE_DIRECTORY', output, flush=True)

if __name__ == '__main__': asyncio.run(main())
