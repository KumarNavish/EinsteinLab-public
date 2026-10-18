"""Regression tests for the observed native tool-only completion and real voice choice.
These use an isolated mock transport; separate browser evidence exercises Google.
"""
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.testclient import TestClient
from google.genai import types
import pytest
from lab_backend.native_live import NativeBridge
from lab_backend.native_knowledge import NativeKnowledge
from lab_backend.voice_direction import selected_voice
from .test_native_live import proof, synthetic_key, MockKnowledge, MockSession


class ToolBoundarySession(MockSession):
    async def send_client_content(self, *, turns, turn_complete):
        await self.queue.put(types.LiveServerMessage(
            server_content=types.LiveServerContent(turn_complete=True),
            tool_call=types.LiveServerToolCall(function_calls=[
                types.FunctionCall(id='lookup-boundary', name='lookup_lab', args={'question': 'How does it work?'})])))


def test_tool_only_completion_does_not_finish_the_visitors_answer(tmp_path):
    proof(tmp_path)
    observed = []
    @asynccontextmanager
    async def factory(key, system, declaration, **options):
        observed.append(options['voice'])
        yield ToolBoundarySession()
    bridge = NativeBridge(tmp_path, MockKnowledge(), session_factory=factory)
    bridge.config.store_operator_key(synthetic_key(), True)
    app = FastAPI(); app.include_router(bridge.router)
    with TestClient(app) as client:
        response = client.post('/api/native/permit', json={'voice': 'Algenib'})
        assert response.status_code == 200 and response.json()['voice'] == 'Algenib'
        permit = response.json()['permit']
        with client.websocket_connect('/api/native/voice?permit=' + permit) as websocket:
            connected = websocket.receive_json()
            assert connected['event'] == 'connected' and connected['voice'] == 'Algenib'
            websocket.send_json({'type': 'text', 'text': 'Explain this project.'})
            events = []
            while not (any(packet['event'] == 'turn_complete' for packet in events)
                       and any(packet['event'] == 'evidence_activity' and packet['status'] == 'finished' for packet in events)):
                events.append(websocket.receive_json())
            assert [item['event'] for item in events if item['event'] != 'evidence_activity'] == ['evidence_pending', 'work_activity', 'sources', 'output_transcript', 'audio', 'turn_complete']
            assert [(item['tool_call_id'], item['status']) for item in events if item['event'] == 'evidence_activity'] == [('lookup-boundary', 'running'), ('lookup-boundary', 'finished')]
            completed = next(item for item in events if item['event'] == 'turn_complete')
            assert completed['audio_bytes'] == 960 and completed['text_characters'] > 0
            websocket.send_json({'type': 'stop'})
        status = client.get('/api/native/status').json()
        assert status['last_session']['turns'] == 1
        assert status['last_session']['tool_only_completions'] == 1
        assert status['last_session']['voice'] == 'Algenib'
        assert observed == ['Algenib']
        assert not status['active'] and status['active_voice'] is None


@pytest.mark.parametrize('voice', ['Gacrux', 'Algenib', 'Sadaltager'])
def test_only_verified_supported_voice_names_are_accepted(voice):
    assert selected_voice(voice) == voice


def test_invalid_voice_is_rejected_before_provider_connection(tmp_path):
    proof(tmp_path)
    @asynccontextmanager
    async def never_connect(*args, **kwargs):
        raise AssertionError('No provider call permitted in this test')
        yield None
    bridge = NativeBridge(tmp_path, MockKnowledge(), session_factory=never_connect)
    bridge.config.store_operator_key(synthetic_key(), True)
    app = FastAPI(); app.include_router(bridge.router)
    with TestClient(app) as client:
        response = client.post('/api/native/permit', json={'voice': 'UnknownExternalVoice'})
        assert response.status_code == 403
        assert not bridge.config.permits
        assert client.post('/api/native/permit', json={'voice': 'Gacrux', 'model': 'unapproved'}).status_code == 400


def test_lab_lookup_declares_blocking_evidence_and_explicit_question_aspect():
    knowledge = NativeKnowledge.__new__(NativeKnowledge)
    knowledge.project_titles = ['GenAI in VR']
    declaration = knowledge.declaration()
    assert declaration['behavior'] == 'BLOCKING'
    parsed = types.FunctionDeclaration(**declaration)
    assert parsed.name == 'lookup_lab'
    assert declaration['parameters']['properties']['aspect']['enum'] == ['overview', 'results', 'people']
