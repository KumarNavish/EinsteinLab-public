"""Actual local WebSocket bridge, fake provider, and explicit browser receipts."""
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.testclient import TestClient
from google.genai import types
from lab_backend.native_live import NativeBridge
from .test_native_live import proof, synthetic_key, MockKnowledge
from .test_visual_tools import graph


class VisualProvider:
    def __init__(self):
        self.queue = asyncio.Queue(); self.responses = []
    async def send_client_content(self, *, turns, turn_complete):
        text = turns['parts'][0]['text']
        if text == 'interrupt':
            await self.queue.put(types.LiveServerMessage(server_content=types.LiveServerContent(interrupted=True)))
            return
        name, args = ('focus_visual', {'element_id': 'question'}) if text == 'focus' else ('hide_visual', {}) if text == 'hide' else ('sketch_mechanism', graph())
        if text == 'bad': args['edges'][0]['to'] = 'nonexistent-node'
        await self.queue.put(types.LiveServerMessage(tool_call=types.LiveServerToolCall(function_calls=[types.FunctionCall(id='call-' + text, name=name, args=args)])))
    async def send_tool_response(self, *, function_responses):
        self.responses.append(function_responses.response)
        await self.queue.put(types.LiveServerMessage(server_content=types.LiveServerContent(
            output_transcription=types.Transcription(text='Browser result received.'),
            model_turn=types.Content(role='model', parts=[types.Part(inline_data=types.Blob(data=bytes(960), mime_type='audio/pcm;rate=24000'))]), turn_complete=True)))
    async def send_realtime_input(self, **kwargs): pass
    async def receive(self):
        yield await self.queue.get()


def make_bridge(tmp_path):
    proof(tmp_path); provider = VisualProvider()
    @asynccontextmanager
    async def factory(key, system, declaration, **options):
        assert key == synthetic_key()
        assert 'VISUAL EXPLANATIONS' in system
        yield provider
    bridge = NativeBridge(tmp_path, MockKnowledge(), session_factory=factory)
    bridge.config.store_operator_key(synthetic_key(), True)
    app = FastAPI(); app.include_router(bridge.router)
    return bridge, provider, app


def drain_until(ws, event):
    seen = []
    for _ in range(10):
        value = ws.receive_json(); seen.append(value)
        if value['event'] == event: return value, seen
    raise AssertionError('Expected event did not arrive: ' + event)


def test_browser_ack_is_required_before_provider_success(tmp_path):
    bridge, provider, app = make_bridge(tmp_path)
    with TestClient(app) as client:
        permit = client.post('/api/native/permit', json={'accent': 'german'}).json()['permit']
        with client.websocket_connect('/api/native/voice?permit=' + permit) as ws:
            assert ws.receive_json()['accent'] == 'german'
            for text, expected, count in [('draw', 'displayed', 5), ('focus', 'focused', 5), ('hide', 'hidden', 0)]:
                ws.send_json({'type': 'text', 'text': text})
                event, _ = drain_until(ws, 'presentation_action'); action = event['action']
                count_before = len(provider.responses)
                receipt = {'type': 'presentation_result', 'action_id': action['action_id'], 'revision': action['revision'], 'generation': event['generation'], 'status': expected, 'rendered_elements': count}
                ws.send_json({**receipt, 'revision': 999})
                assert len(provider.responses) == count_before
                ws.send_json(receipt)
                drain_until(ws, 'turn_complete')
                assert provider.responses[-1]['status'] == expected
                ws.send_json(receipt)  # Duplicate cannot execute or complete another visual.
            ws.send_json({'type': 'stop'})
        status = client.get('/api/native/status').json()
        assert status['last_session']['visual_acknowledged'] == 3
        assert status['last_session']['stale_visual_receipts'] == 6
        assert len(provider.responses) == 3


def test_failed_browser_operation_is_not_reported_displayed(tmp_path):
    bridge, provider, app = make_bridge(tmp_path)
    with TestClient(app) as client:
        permit = client.post('/api/native/permit').json()['permit']
        with client.websocket_connect('/api/native/voice?permit=' + permit) as ws:
            ws.receive_json(); ws.send_json({'type': 'text', 'text': 'draw'})
            event, _ = drain_until(ws, 'presentation_action'); a = event['action']
            ws.send_json({'type': 'presentation_result', 'action_id': a['action_id'], 'revision': a['revision'], 'generation': 0, 'status': 'failed', 'rendered_elements': 0})
            drain_until(ws, 'turn_complete')
            assert provider.responses[-1]['status'] == 'not-displayed'
            ws.send_json({'type': 'stop'})


def test_interruption_invalidates_unfinished_display_receipt(tmp_path):
    bridge, provider, app = make_bridge(tmp_path)
    with TestClient(app) as client:
        permit = client.post('/api/native/permit').json()['permit']
        with client.websocket_connect('/api/native/voice?permit=' + permit) as ws:
            ws.receive_json(); ws.send_json({'type': 'text', 'text': 'draw'})
            event, _ = drain_until(ws, 'presentation_action'); a = event['action']
            ws.send_json({'type': 'text', 'text': 'interrupt'})
            assert drain_until(ws, 'interrupted')[0]['generation'] == 1
            ws.send_json({'type': 'presentation_result', 'action_id': a['action_id'], 'revision': a['revision'], 'generation': 0, 'status': 'displayed', 'rendered_elements': 5})
            ws.send_json({'type': 'text', 'text': 'hide'})
            event, _ = drain_until(ws, 'presentation_action'); a = event['action']
            ws.send_json({'type': 'presentation_result', 'action_id': a['action_id'], 'revision': a['revision'], 'generation': 1, 'status': 'hidden', 'rendered_elements': 0})
            drain_until(ws, 'turn_complete')
            assert len(provider.responses) == 1 and provider.responses[0]['status'] == 'hidden'
            ws.send_json({'type': 'stop'})


def test_invalid_graph_reports_nonexecution_then_accepts_corrected_request(tmp_path):
    bridge, provider, app = make_bridge(tmp_path)
    with TestClient(app) as client:
        permit = client.post('/api/native/permit').json()['permit']
        with client.websocket_connect('/api/native/voice?permit=' + permit) as ws:
            ws.receive_json(); ws.send_json({'type': 'text', 'text': 'bad'})
            _, events = drain_until(ws, 'turn_complete')
            assert not any(event['event'] == 'presentation_action' for event in events)
            assert provider.responses[-1]['status'] == 'not-displayed'
            ws.send_json({'type': 'text', 'text': 'draw'})
            event, _ = drain_until(ws, 'presentation_action'); action = event['action']
            ws.send_json({'type': 'presentation_result', 'action_id': action['action_id'], 'revision': action['revision'], 'generation': 0, 'status': 'displayed', 'rendered_elements': 5})
            drain_until(ws, 'turn_complete')
            assert provider.responses[-1]['status'] == 'displayed'
            ws.send_json({'type': 'stop'})
