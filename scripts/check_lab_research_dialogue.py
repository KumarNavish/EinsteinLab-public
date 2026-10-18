"""Actual native voice + official-lab page reads + Flash evidence checks.

The test sends public text, not microphone audio. It does not enable Search,
billing, a paid endpoint or a fallback credential. It records failures as failures.
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
    'Use consult_flash to compare the Mobiliar Lab projects VR for Relaxation and EMG for Relaxation. What has the first reported, and what is only expected in the second? Cite the official evidence.',
    'Use lookup_lab to check the official Telematics for Road Safety page now. Does it report a statistically significant reduction in accident probability? Do not confuse that with changes in driving behavior.',
    'Use lookup_lab to check the current official directory. Who is listed as scientific director of the Mobiliar Lab for Analytics?',
]

async def main():
    origin = 'http://127.0.0.1:8765'
    async with httpx.AsyncClient(base_url=origin, timeout=8, trust_env=False) as client:
        for _ in range(45):
            try:
                status = (await client.get('/api/native/status')).json()
                if status.get('available'): break
            except Exception: pass
            await asyncio.sleep(1)
        else: raise RuntimeError('Local service unavailable')
        if status.get('active'): raise RuntimeError('An existing participant is active')
        permit = await client.post('/api/native/permit', json={'voice': 'Algenib'})
        permit.raise_for_status(); token = permit.json()['permit']
    out = ROOT / 'evidence/runtime/c8' / ('lab-dialogue-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    out.mkdir(parents=True)
    report = {'scope': 'Three actual provider turns, public text only, fresh official-lab pages and the explicitly selected available Flash model. Not general internet search or an accuracy benchmark.', 'turns': []}
    try:
        async with websockets.connect(origin.replace('http:', 'ws:') + '/api/native/voice?permit=' + token, origin=origin, max_size=3_000_000) as socket:
            connected = json.loads(await asyncio.wait_for(socket.recv(), 25))
            if connected.get('event') != 'connected': raise RuntimeError('Voice did not connect')
            for question in QUESTIONS:
                start = time.perf_counter(); text = ''; audio_bytes = 0; first_audio = None; events = []
                await socket.send(json.dumps({'type': 'text', 'text': question}))
                async with asyncio.timeout(90):
                    while True:
                        event = json.loads(await socket.recv())
                        event['observed_ms'] = round((time.perf_counter() - start) * 1000, 1)
                        if event.get('event') == 'audio':
                            import base64
                            audio_bytes += len(base64.b64decode(event.pop('data')))
                            if first_audio is None: first_audio = event['observed_ms']
                        if event.get('event') == 'output_transcript': text += event.get('text', '')
                        events.append(event)
                        if event.get('event') == 'error': raise RuntimeError('Provider error')
                        if event.get('event') == 'turn_complete': break
                row = {'question': question, 'answer': text, 'first_audio_packet_ms': first_audio,
                       'duration_ms': round((time.perf_counter()-start)*1000, 1), 'audio_seconds': audio_bytes/48000,
                       'events': events}
                report['turns'].append(row)
                (out/'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
                print(json.dumps({key: row[key] for key in ('question','answer','first_audio_packet_ms','duration_ms')}, ensure_ascii=False), flush=True)
            await socket.send(json.dumps({'type':'stop'}))
    except Exception as error:
        report['failure'] = type(error).__name__
    async with httpx.AsyncClient(base_url=origin, timeout=5, trust_env=False) as client:
        report['status_after'] = (await client.get('/api/native/status')).json()
    report['flash_checks'] = [event for row in report['turns'] for event in row['events'] if event['event']=='research_complete']
    report['live_page_count'] = len({source['url'] for row in report['turns'] for event in row['events'] if event['event']=='sources' for source in event.get('sources',[]) if source.get('source_kind')=='live-official-lab'})
    report['complete'] = len(report['turns'])==3 and all(row['audio_seconds']>0 for row in report['turns'])
    (out/'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print('LAB_RESEARCH_EVIDENCE',json.dumps({'directory':str(out),'complete':report['complete'],'live_pages':report['live_page_count'],'flash_states':[event.get('status') for event in report['flash_checks']],'failure':report.get('failure')}),flush=True)
    if not report['complete'] or not report['live_page_count']: raise SystemExit(1)

if __name__=='__main__': asyncio.run(main())
