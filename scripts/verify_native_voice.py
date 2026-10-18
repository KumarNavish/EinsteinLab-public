#!/usr/bin/env python3
"""Explicit optional native-voice check using public text, never a real microphone.

Requires the operator-entered free-tier key and consent already configured in the
running localhost app. This command does not retrieve keys, enable billing, use a
paid fallback, or pretend a mock-provider test is a live provider result.
"""
from __future__ import annotations
import argparse
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
    'Briefly explain what the GenAI in VR project actually does. Use the public evidence tool.',
    'Are improved relaxation outcomes already established on that project page, or are they expected?',
]


async def main(args):
    origin = f'http://127.0.0.1:{args.port}'
    async with httpx.AsyncClient(base_url=origin, timeout=15, trust_env=False) as client:
        status_response = await client.get('/api/native/status')
        status_response.raise_for_status()
        status = status_response.json()
        if not status.get('available'):
            print(json.dumps({'status': 'not_tested', 'reason': 'The native route is not configured with a currently approved free-tier key and external-processing consent.'}))
            return 3
        if status.get('active'):
            print(json.dumps({'status': 'not_tested', 'reason': 'An existing native conversation is active; it was not interrupted.'}))
            return 3
        permit_response = await client.post('/api/native/permit')
        permit_response.raise_for_status()
        permit = permit_response.json()['permit']
    output = ROOT / 'evidence/runtime/native'
    output.mkdir(parents=True, exist_ok=True)
    run_name = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    run = output / run_name
    run.mkdir()
    rows = []
    conversation_sources = []
    address = f'ws://127.0.0.1:{args.port}/api/native/voice?permit={permit}'
    try:
        async with websockets.connect(address, origin=origin, max_size=2_000_000) as socket:
            first = json.loads(await asyncio.wait_for(socket.recv(), timeout=25))
            if first.get('event') != 'connected':
                raise RuntimeError('Provider connection was not established')
            for number, question in enumerate(QUESTIONS):
                started = time.perf_counter()
                await socket.send(json.dumps({'type': 'text', 'text': question}))
                audio = bytearray(); transcript = ''; sources = []; first_ms = None; events = []
                async with asyncio.timeout(75):
                    while True:
                        event = json.loads(await socket.recv())
                        kind = event.get('event')
                        events.append(kind)
                        if kind == 'error':
                            raise RuntimeError(event.get('code', 'Native provider error'))
                        if kind == 'audio':
                            if first_ms is None:
                                first_ms = round((time.perf_counter() - started) * 1000, 1)
                            audio.extend(base64.b64decode(event['data'], validate=True))
                        elif kind == 'output_transcript':
                            transcript += event.get('text', '')
                        elif kind == 'sources':
                            sources.extend({key: source.get(key) for key in ('id', 'title', 'url', 'section', 'epistemic', 'fetched_at', 'text_sha256')} for source in event['sources'])
                        elif kind == 'turn_complete':
                            break
                with wave.open(str(run / f'answer-{number}.wav'), 'wb') as wav:
                    wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(24000); wav.writeframes(audio)
                if sources: conversation_sources = sources
                row = {'question': question, 'answer_transcript': transcript, 'sources': sources,
                       'source_context_available': bool(conversation_sources),
                       'source_scope': 'this-turn-lookup' if sources else 'prior-turn-context',
                       'first_audio_packet_ms': first_ms, 'complete_ms': round((time.perf_counter() - started) * 1000, 1),
                       'audio_seconds': round(len(audio) / 48000, 3), 'events': events,
                       'actual_audio_received': bool(audio), 'source_tool_used': bool(sources)}
                rows.append(row)
                print(json.dumps({key: row[key] for key in ('question', 'first_audio_packet_ms', 'audio_seconds', 'source_tool_used')}), flush=True)
            await socket.send(json.dumps({'type': 'stop'}))
        report = {'status': 'provider_test_completed', 'scope': 'Actual approved free-tier native audio requested from public text. No microphone or physical lip-sync test. Source use and playable audio do not prove answer accuracy; read the actual transcript.',
                  'provider': 'Google Gemini', 'model': status['model'], 'results': rows,
                  'billing_changes_performed': False, 'key_included_in_evidence': False}
        (run / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
        print('EVIDENCE', str(run))
        return 0 if all(row['actual_audio_received'] and row['source_context_available'] for row in rows) and rows[0]['source_tool_used'] else 1
    except Exception as error:
        # Never emit provider exception strings or URLs containing connection permits.
        (run / 'failure.json').write_text(json.dumps({'status': 'failed', 'exception_type': type(error).__name__, 'completed_turns': rows}, indent=2))
        print('Native verification failed:', type(error).__name__)
        return 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--approved-public-text-test', action='store_true', required=True,
                        help='Explicitly run two provider turns using only the listed public questions.')
    arguments = parser.parse_args()
    if not 1024 <= arguments.port <= 65535:
        raise SystemExit('Invalid localhost port')
    raise SystemExit(asyncio.run(main(arguments)))
