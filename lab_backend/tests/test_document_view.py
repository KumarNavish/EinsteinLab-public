"""Actual websocket document-view dispatch with a network-forbidden provider."""
import asyncio
import socket
import threading
from contextlib import asynccontextmanager

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from google.genai import types

from lab_backend.native_live import NativeBridge
from lab_backend.page_vision import PageInspector
from lab_backend.tests.test_local_documents import read_receipt
from lab_backend.tests.test_native_live import MockKnowledge, MockSession, proof, synthetic_key

DOCUMENT = {'id': 'a' * 64, 'name': 'synthetic.pdf', 'pages': 3, 'bytes': 1800,
            'kind': 'visitor-selected-pdf', 'approved': True}
VIEW = {'document_id': DOCUMENT['id'], 'page': 3, 'region': [0, 0, 1, 1], 'view_revision': 1}


def fixture(tmp_path, monkeypatch, inspection=None):
    def forbidden(*args, **kwargs):
        raise AssertionError('Document selection tests must never connect to an external service')
    monkeypatch.setattr(socket, 'create_connection', forbidden)
    monkeypatch.setattr(socket.socket, 'connect', forbidden)

    async def inspected(*args, **kwargs):
        return {'status': 'source-image-inspected', 'model': 'offline-fixture', 'seconds': 0,
                'regions': [{'label': 'Actual fixture area', 'region': [.1, .1, .3, .3]}]}
    monkeypatch.setattr(PageInspector, 'inspect', inspection or inspected)

    class Session(MockSession):
        def __init__(self):
            super().__init__()
            self.inputs = []

        async def send_client_content(self, *, turns, turn_complete):
            text = turns['parts'][0]['text'] if isinstance(turns, dict) else turns.parts[0].text
            self.inputs.append((text, turn_complete))
            if not turn_complete:
                return
            calls = ([types.FunctionCall(id='old-running', name='read_selected_pdf_page', args={'page': 1}),
                      types.FunctionCall(id='old-queued', name='read_selected_pdf_page', args={'page': 2})]
                     if text == 'Read old pages.' else
                     [types.FunctionCall(id='current', name='read_selected_pdf_page', args={'page': 3})])
            await self.queue.put(types.LiveServerMessage(tool_call=types.LiveServerToolCall(function_calls=calls)))

        async def send_tool_response(self, *, function_responses):
            self.tool_replies.append(function_responses)
            await self.queue.put(types.LiveServerMessage(server_content=types.LiveServerContent(
                output_transcription=types.Transcription(text='Offline result: ' + function_responses.id))))

        async def receive(self):
            yield await asyncio.wait_for(self.queue.get(), 3)

    session = Session()
    @asynccontextmanager
    async def factory(*args, **kwargs):
        yield session
    proof(tmp_path)
    bridge = NativeBridge(tmp_path, MockKnowledge(), session_factory=factory)
    bridge.config.store_operator_key(synthetic_key(), True)
    app = FastAPI(); app.include_router(bridge.router)
    return app, session


def until(websocket, predicate):
    events = []
    for _ in range(30):
        event = websocket.receive_json(); events.append(event)
        if predicate(event):
            return events
    pytest.fail('Expected offline document event did not arrive')


def test_view_metadata_invalidates_running_and_lock_queued_actions_without_model_response(tmp_path, monkeypatch):
    app, session = fixture(tmp_path, monkeypatch)
    with TestClient(app) as client:
        permit = client.post('/api/native/permit').json()['permit']
        with client.websocket_connect('/api/native/voice?permit=' + permit) as ws:
            assert ws.receive_json()['event'] == 'connected'
            ws.send_json({'type': 'document_offer', 'document': DOCUMENT})
            assert ws.receive_json()['event'] == 'document_registered'
            ws.send_json({'type': 'text', 'text': 'Read old pages.'})
            first = until(ws, lambda event: event['event'] == 'document_action')[-1]
            assert first['action']['page'] == 1 and first['action']['view_revision'] == 0
            ws.send_json({'type': 'document_view', 'view': VIEW})
            events = until(ws, lambda event: event['event'] == 'output_transcript' and event['text'].endswith('old-queued'))
            assert not any(event['event'] == 'document_action' for event in events)
            registered = next(event for event in events if event['event'] == 'document_view_registered')
            assert registered['page'] == 3 and registered['visually_inspected'] is False
            metadata, complete = next((text, complete) for text, complete in session.inputs if text.startswith('CURRENT VISITOR-SELECTED PDF VIEW'))
            assert complete is False
            assert '"page": 3' in metadata and 'Earlier inspected pages remain valid evidence about those pages only' in metadata
            assert all(reply.response['status'] == 'not-displayed' for reply in session.tool_replies)
            ws.send_json({'type': 'document_result', 'generation': first['generation'], **read_receipt(first['action'])})
            ws.send_json({'type': 'text', 'text': 'Read this page.'})
            current = until(ws, lambda event: event['event'] == 'document_action')[-1]
            assert current['action']['page'] == 3 and current['action']['view_revision'] == 1
            ws.send_json({'type': 'document_result', 'generation': current['generation'], **read_receipt(current['action'])})
            until(ws, lambda event: event['event'] == 'output_transcript' and event['text'].endswith('current'))
            assert session.tool_replies[-1].response['page'] == 3
            assert session.tool_replies[-1].response['status'] == 'page-inspected'
            ws.send_json({'type': 'stop'})


@pytest.mark.parametrize('approved,changes', [(False, {}), (True, {'document_id': 'b' * 64}),
                                             (True, {'page': 4}), (True, {'image': 'forbidden'})])
def test_invalid_or_unapproved_view_is_never_forwarded_to_provider(tmp_path, monkeypatch, approved, changes):
    app, session = fixture(tmp_path, monkeypatch)
    with TestClient(app) as client:
        permit = client.post('/api/native/permit').json()['permit']
        with client.websocket_connect('/api/native/voice?permit=' + permit) as ws:
            assert ws.receive_json()['event'] == 'connected'
            if approved:
                ws.send_json({'type': 'document_offer', 'document': DOCUMENT})
                assert ws.receive_json()['event'] == 'document_registered'
            ws.send_json({'type': 'document_view', 'view': {**VIEW, **changes}})
            assert until(ws, lambda event: event['event'] == 'error')[-1]['code'] == 'ValueError'
        assert len(session.inputs) == int(approved)
        assert not any(text.startswith('CURRENT VISITOR-SELECTED PDF VIEW') for text, _ in session.inputs)


def test_navigation_during_pixel_inspection_cannot_publish_the_old_observation_as_current(tmp_path, monkeypatch):
    started, finish = threading.Event(), threading.Event()

    async def delayed_inspection(*args, **kwargs):
        started.set()
        assert await asyncio.to_thread(finish.wait, 3)
        return {'status': 'source-image-inspected', 'model': 'offline-fixture', 'seconds': 0,
                'regions': [{'label': 'Old page area', 'region': [.1, .1, .3, .3]}]}

    app, session = fixture(tmp_path, monkeypatch, delayed_inspection)
    with TestClient(app) as client:
        permit = client.post('/api/native/permit').json()['permit']
        with client.websocket_connect('/api/native/voice?permit=' + permit) as ws:
            assert ws.receive_json()['event'] == 'connected'
            ws.send_json({'type': 'document_offer', 'document': DOCUMENT})
            assert ws.receive_json()['event'] == 'document_registered'
            ws.send_json({'type': 'text', 'text': 'Read old pages.'})
            first = until(ws, lambda event: event['event'] == 'document_action')[-1]
            ws.send_json({'type': 'document_result', 'generation': first['generation'], **read_receipt(first['action'])})
            until(ws, lambda event: event['event'] == 'document_vision_started')
            assert started.wait(2)
            ws.send_json({'type': 'document_view', 'view': VIEW})
            until(ws, lambda event: event['event'] == 'document_view_registered')
            finish.set()
            events = until(ws, lambda event: event['event'] == 'output_transcript' and event['text'].endswith('old-queued'))
            assert not any(event['event'] in {'document_action', 'document_inspected'} for event in events)
            assert all(reply.response['status'] == 'not-displayed' and 'visual_observation' not in reply.response
                       for reply in session.tool_replies)
            assert all(reply.response['current_view']['page'] == 3 for reply in session.tool_replies)
            ws.send_json({'type': 'stop'})
