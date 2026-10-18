"""Three real public research turns through the running app; no microphone input.

This is a development integration check, not a general factual-accuracy benchmark.
Sources and actual transcripts are retained; no credentials or microphone audio.
"""
from __future__ import annotations
import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path
import time
import httpx
import websockets

ROOT = Path(__file__).resolve().parent.parent
QUESTIONS = [
    'Search Google now: according to Google\'s official documentation, what is its most intelligent Flash model? Cite the current official source; do not answer from memory.',
    'Consult Flash to compare the Mobiliar Lab projects VR for Relaxation and EMG for Relaxation. Which has published results in the lab descriptions, and which reports expected results? Preserve that distinction.',
    'Use the lab evidence: does Telematics for Road Safety show a statistically significant reduction in accident probability? Do not confuse driving behavior with accidents.',
]

async def main():
    origin = 'http://127.0.0.1:8765'
    async with httpx.AsyncClient(base_url=origin, timeout=5, trust_env=False) as client:
        for _ in range(60):
            try:
                status = (await client.get('/api/native/status')).json()
                if status.get('available'): break
            except Exception: pass
            await asyncio.sleep(1)
        else: raise RuntimeError('App not ready')
        if status.get('active'): raise RuntimeError('Another participant is active')
        permit_response = await client.post('/api/native/permit', json={'voice': 'Algenib'})
        permit_response.raise_for_status(); permit = permit_response.json()['permit']
    directory = ROOT / 'evidence/runtime/c8' / ('live-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    directory.mkdir(parents=True)
    report = {'scope': 'Actual free-tier Google voice with Search and an explicit Flash consultation; text prompts, no human microphone. Source presence is not an accuracy certificate.', 'turns': []}
    try:
        async with websockets.connect(origin.replace('http:', 'ws:') + '/api/native/voice?permit=' + permit, origin=origin, max_size=3_000_000) as socket:
            connected = json.loads(await asyncio.wait_for(socket.recv(), 30))
            if connected.get('event') != 'connected': raise RuntimeError('Provider did not connect')
            for question in QUESTIONS:
                start = time.perf_counter(); transcript = ''; audio_bytes = 0; first = None; events = []
                await socket.send(json.dumps({'type': 'text', 'text': question}))
                async with asyncio.timeout(80):
                    while True:
                        value = json.loads(await socket.recv())
                        value['observed_ms'] = round((time.perf_counter() - start) * 1000, 1)
                        if value.get('event') == 'audio':
                            if first is None: first = value['observed_ms']
                            import base64
                            audio_bytes += len(base64.b64decode(value.pop('data')))
                        if value.get('event') == 'output_transcript': transcript += value.get('text', '')
                        events.append(value)
                        if value.get('event') == 'error': raise RuntimeError('Provider reported an error')
                        if value.get('event') == 'turn_complete': break
                row = {'question': question, 'answer': transcript, 'audio_seconds': round(audio_bytes / 48000, 2),
                       'first_packet_ms': first, 'complete_ms': round((time.perf_counter() - start) * 1000, 1), 'events': events}
                report['turns'].append(row)
                (directory / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
                print(json.dumps({key: row[key] for key in ('question', 'answer', 'first_packet_ms', 'complete_ms')}), flush=True)
            await socket.send(json.dumps({'type': 'stop'}))
    except Exception as error:
        report['failure'] = type(error).__name__
    async with httpx.AsyncClient(base_url=origin, timeout=5, trust_env=False) as client:
        report['final_status'] = (await client.get('/api/native/status')).json()
    report['web_grounding_seen'] = any(event['event'] == 'web_grounding' and event.get('sources') for row in report['turns'] for event in row['events'])
    report['flash_result_states'] = [event.get('status') for row in report['turns'] for event in row['events'] if event['event'] == 'research_complete']
    (directory / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps({'directory': str(directory), 'web_grounding_seen': report['web_grounding_seen'], 'flash_results': report['flash_result_states'], 'failure': report.get('failure')}), flush=True)
    if report.get('failure') or not report['web_grounding_seen']: raise SystemExit(1)

if __name__ == '__main__': asyncio.run(main())
