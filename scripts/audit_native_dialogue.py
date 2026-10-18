#!/usr/bin/env python3
"""Five public-source dialogue probes through the real, configured native service.

Runs one bounded session. Preserves answers for human review; completion flags
are transport evidence, not automatic scientific fact-checking.
"""
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
QUESTIONS = [
    "How does the lab's cognitive-load work connect to delegating choices to AI?",
    "Explain that connection without jargon.",
    "Did the lab's telematics research conclusively show fewer accidents?",
    "Who is the scientific director according to the public lab directory?",
    "What is one experiment you would propose next, rather than claim the lab has already completed?",
]


async def main():
    directory = ROOT / 'evidence/runtime/c7' / ('dialogue-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    directory.mkdir(parents=True)
    rows = []
    async with httpx.AsyncClient(base_url='http://127.0.0.1:8765', timeout=10, trust_env=False) as client:
        status = (await client.get('/api/native/status')).json()
        if not status.get('available') or status.get('active'):
            raise RuntimeError('A configured idle free-tier service is required; existing session unchanged')
        response = await client.post('/api/native/permit', json={'voice': 'Algenib'})
        response.raise_for_status()
        permit = response.json()['permit']
    try:
        async with asyncio.timeout(240):
            async with websockets.connect('ws://127.0.0.1:8765/api/native/voice?permit=' + permit,
                                          origin='http://127.0.0.1:8765', max_size=2_000_000) as socket:
                connected = json.loads(await asyncio.wait_for(socket.recv(), 25))
                if connected.get('event') != 'connected': raise RuntimeError('Provider did not connect')
                for index, question in enumerate(QUESTIONS):
                    start = time.perf_counter(); first = None; samples = bytearray(); text = ''; sources = []; events = []
                    await socket.send(json.dumps({'type': 'text', 'text': question}))
                    async with asyncio.timeout(50):
                        while True:
                            event = json.loads(await socket.recv()); kind = event['event']; events.append(kind)
                            if kind == 'error': raise RuntimeError('Native turn failed')
                            if kind == 'audio':
                                if first is None: first = (time.perf_counter() - start) * 1000
                                samples.extend(base64.b64decode(event['data'], validate=True))
                            if kind == 'output_transcript': text += event.get('text', '')
                            if kind == 'sources':
                                sources.extend({key: source.get(key) for key in ('id', 'title', 'url', 'section', 'epistemic', 'fetched_at', 'text_sha256')} for source in event['sources'])
                            if kind == 'turn_complete': break
                    with wave.open(str(directory / f'answer-{index}.wav'), 'wb') as wav:
                        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(24000); wav.writeframes(samples)
                    row = {'question': question, 'answer': text, 'sources': sources, 'first_audio_packet_ms': round(first, 1) if first is not None else None,
                           'audio_seconds': round(len(samples) / 48000, 3), 'transport_complete': bool(text.strip() and samples),
                           'tool_lookups_this_turn': sum(kind == 'sources' for kind in events), 'events': events}
                    rows.append(row)
                    (directory / 'report.json').write_text(json.dumps({'scope': 'Five designed public-source probes, one actual native session, no human microphone. Sources can legitimately be retained across follow-ups. Answers must be read for correctness; transport success is not an accuracy score.',
                                                                      'model': status['model'], 'voice': connected['voice'], 'questions': QUESTIONS, 'results': rows}, indent=2))
                    print(json.dumps({key: row[key] for key in ('question', 'answer', 'first_audio_packet_ms', 'audio_seconds', 'transport_complete')}), flush=True)
                await socket.send(json.dumps({'type': 'stop'}))
        print('NATIVE_DIALOGUE_EVIDENCE', directory, flush=True)
        return 0 if all(row['transport_complete'] for row in rows) else 1
    except Exception as failure:
        (directory / 'failure.json').write_text(json.dumps({'error_class': type(failure).__name__, 'completed_turns': len(rows)}, indent=2))
        print('Dialogue stopped:', type(failure).__name__, flush=True)
        return 1


if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))
