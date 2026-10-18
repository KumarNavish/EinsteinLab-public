#!/usr/bin/env python3
"""Three actual voice samples through the already configured local bridge.

Public fixed text only, no microphone capture, no credential handling or billing
changes. This produces listening samples, not an automatic realism score.
"""
from __future__ import annotations
import asyncio
import base64
from datetime import datetime, timezone
import json
from pathlib import Path
import time
import wave
import httpx
import websockets

ROOT = Path(__file__).resolve().parent.parent
TEXT = 'A good question is a promising beginning. Tell me, what are you curious about?'
VOICES = ['Gacrux', 'Algenib', 'Sadaltager']


async def main():
    directory = ROOT / 'evidence/runtime/c7' / ('voices-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    directory.mkdir(parents=True)
    results = []
    async with httpx.AsyncClient(base_url='http://127.0.0.1:8765', timeout=10, trust_env=False) as client:
        for voice in VOICES:
            state = (await client.get('/api/native/status')).json()
            if not state.get('available') or state.get('active'):
                raise RuntimeError('The configured free-tier voice is unavailable or in use; existing session unchanged')
            permit = await client.post('/api/native/permit', json={'voice': voice})
            permit.raise_for_status()
            ticket = permit.json()['permit']
            try:
                async with websockets.connect('ws://127.0.0.1:8765/api/native/voice?permit=' + ticket,
                                              origin='http://127.0.0.1:8765', max_size=2_000_000) as socket:
                    ready = json.loads(await asyncio.wait_for(socket.recv(), 25))
                    if ready.get('event') != 'connected' or ready.get('voice') != voice:
                        raise RuntimeError('The requested voice did not connect')
                    begin = time.perf_counter()
                    await socket.send(json.dumps({'type': 'text', 'text': 'For a short comparison, speak only this exact sentence naturally, without commentary: ' + TEXT}))
                    audio = bytearray(); transcript = ''; first = None
                    async with asyncio.timeout(45):
                        while True:
                            event = json.loads(await socket.recv())
                            if event['event'] == 'error': raise RuntimeError('Native session error')
                            if event['event'] == 'audio':
                                if first is None: first = (time.perf_counter() - begin) * 1000
                                audio.extend(base64.b64decode(event['data'], validate=True))
                            if event['event'] == 'output_transcript': transcript += event.get('text', '')
                            if event['event'] == 'turn_complete': break
                    await socket.send(json.dumps({'type': 'stop'}))
                with wave.open(str(directory / (voice + '.wav')), 'wb') as wav:
                    wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(24000); wav.writeframes(audio)
                result = {'voice': voice, 'transcript': transcript, 'first_packet_ms': round(first, 1) if first else None,
                          'audio_seconds': round(len(audio) / 48000, 3), 'bytes': len(audio), 'voice_confirmed': ready['voice'],
                          'output_received': bool(audio)}
                results.append(result)
                print(json.dumps(result), flush=True)
            except Exception as error:
                results.append({'voice': voice, 'output_received': False, 'error_class': type(error).__name__})
                print('VOICE_FAILED', voice, type(error).__name__, flush=True)
            (directory / 'report.json').write_text(json.dumps({'scope': 'Actual native samples of the same requested text through the existing consented free-tier bridge. Not a human listening panel or a lip-sync test. No voice-over replacement or pitch processing.',
                                                              'requested_text': TEXT, 'model': state['model'], 'results': results}, indent=2))
            await asyncio.sleep(.5)
    print('VOICE_SAMPLES', directory, flush=True)
    return 0 if all(row['output_received'] for row in results) else 1


if __name__ == '__main__':
    try: raise SystemExit(asyncio.run(main()))
    except Exception as failure:
        print('Comparison stopped:', type(failure).__name__)
        raise SystemExit(1)
