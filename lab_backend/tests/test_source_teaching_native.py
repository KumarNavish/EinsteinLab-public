"""Original-source protocol regressions, not a semantic or voice acceptance run.

The actual bridge executes against synthetic source pixels and a network-forbidden
provider. No API, browser, microphone, credentials or production service is used.
"""
import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from lab_backend.openai_live import envelope
from lab_backend.tests.test_local_documents import read_receipt
from lab_backend.tests.test_native_live import teaching_bridge, receive_until


DOCUMENT = {'id': 'a' * 64, 'name': 'protocol-fixture.pdf', 'pages': 3, 'bytes': 1800,
            'kind': 'visitor-selected-pdf', 'approved': True}
NARRATIONS = [
    'Record trace captures the observed types along the repeating loop.',
    'Compile trace turns that recorded path into a faster execution route.',
    'Side exit leaves that route when its recorded assumptions fail.',
]


def source_bridge(tmp_path, monkeypatch, *, unavailable=False, queued_second=False, explicit_metadata=False):
    # Reuse the existing synthetic funded configuration and network prohibition.
    bridge, app, _unused_sessions = teaching_bridge(tmp_path, monkeypatch)

    class Inspector:
        model = 'offline-source-inspector'
        calls = 0
        async def inspect(self, *_args):
            self.calls += 1
            assert (_args[0]['width'], _args[0]['height']) == (320, 240), 'Only actual validated bitmap dimensions may reach inspection.'
            if unavailable:
                return {'status': 'unavailable', 'model': self.model, 'seconds': 0, 'error_type': 'OfflineFixture'}
            return {'status': 'source-image-inspected', 'model': self.model, 'seconds': 0, 'regions': [
                {'label': 'Record trace', 'region': [.2, .3, .15, .12]},
                {'label': 'Compile trace', 'region': [.45, .3, .15, .12]},
                {'label': 'Side exit', 'region': [.7, .45, .15, .12]},
            ]}
        def clear(self): pass

    class Session:
        def __init__(self):
            self.queue, self.results, self.inputs, self.spoken = asyncio.Queue(), [], [], []
            self.read = None
        async def transcript(self, text):
            await self.queue.put(envelope(content={'output_transcription': SimpleNamespace(text=text)}))
        async def send_client_content(self, *, turns, turn_complete):
            text = turns['parts'][0]['text'] if isinstance(turns, dict) else turns.parts[0].text
            self.inputs.append((text, turn_complete))
            if not turn_complete:
                return
            if text == 'Read the selected page.':
                name, args, identity = 'read_selected_pdf_page', {'page': 2}, 'read-source'
            elif text == 'Explain the source step by step.':
                observation = self.read.get('visual_observation', {})
                regions = observation.get('regions', [{'id': 'uninspected-' + str(index)} for index in range(3)])
                name, identity = 'teach_source', 'teach-source'
                args = {'title': 'The original tracing figure',
                        'steps': [{'region_id': region['id'], 'narration': narration}
                                  for region, narration in zip(regions, NARRATIONS)]}
                if explicit_metadata:
                    args.update(source_id=self.read['sources'][0]['id'], page=2,
                                image_sha256=observation['image_sha256'])
            else:
                await self.transcript('Latest question accepted.')
                return
            calls = [SimpleNamespace(id=identity, name=name, args=args)]
            if name == 'teach_source' and queued_second:
                calls.append(SimpleNamespace(id='teach-source-queued', name=name, args=args))
            await self.queue.put(envelope(calls=calls))
        async def send_tool_response(self, *, function_responses):
            self.results.append(function_responses)
            if function_responses.name == 'read_selected_pdf_page':
                self.read = function_responses.response
            await self.transcript('Result: ' + function_responses.name)
        async def speak_teaching_step(self, narration):
            self.spoken.append(narration)
            await self.transcript(narration)
        async def send_realtime_input(self, **_kwargs):
            await self.transcript('Offline input barrier.')
        async def receive(self):
            yield await asyncio.wait_for(self.queue.get(), 3)

    session, inspector = Session(), Inspector()
    @asynccontextmanager
    async def factory(_key, system, declarations, **_options):
        assert 'teach_source' in {item['name'] for item in declarations}
        declaration = next(item for item in declarations if item['name'] == 'teach_source')
        assert set(declaration['parameters']['properties']) == {'title', 'steps'}
        assert 'Keep the original source visible' in system
        assert "using only that inspection's returned region IDs" in system
        yield session
    bridge.session_factory = factory
    bridge.page_inspector_factory = lambda _credential: inspector
    return bridge, app, session, inspector


def collect(ws, trace, predicate):
    result, events = receive_until(ws, predicate)
    trace.extend(events)
    return result


def inspect_page(ws, trace):
    assert ws.receive_json()['event'] == 'connected'
    ws.send_json({'type': 'document_offer', 'document': DOCUMENT})
    assert ws.receive_json()['event'] == 'document_registered'
    ws.send_json({'type': 'document_view', 'view': {'document_id': DOCUMENT['id'], 'page': 2,
                  'region': [0, 0, 1, 1], 'view_revision': 1}})
    assert ws.receive_json()['event'] == 'document_view_registered'
    ws.send_json({'type': 'text', 'text': 'Read the selected page.'})
    action = collect(ws, trace, lambda packet: packet['event'] == 'document_action')
    ws.send_json({'type': 'document_result', 'generation': action['generation'], **read_receipt(action['action'])})
    collect(ws, trace, lambda packet: packet.get('text') == 'Result: read_selected_pdf_page')


def acknowledge_mark(ws, packet, **changes):
    action = packet['action']
    ws.send_json({'type': 'document_result', 'generation': packet['generation'],
                  'action_id': action['action_id'], 'document_id': action['document_id'],
                  'revision': action['revision'], 'ok': True, 'page': action['page'],
                  'region': action['view_region'], 'mark_count': len(action['marks']), **changes})


def finished(ws, trace):
    return collect(ws, trace, lambda packet: packet['event'] == 'evidence_activity'
                   and packet['tool_call_id'] == 'teach-source' and packet['status'] == 'finished')


def test_original_page_marks_build_cumulatively_after_real_ack_and_each_local_boundary(tmp_path, monkeypatch):
    bridge, app, session, inspector = source_bridge(tmp_path, monkeypatch)
    trace = []
    with TestClient(app) as client:
        permit = client.post('/api/native/permit').json()['permit']
        with client.websocket_connect('/api/native/voice?permit=' + permit) as ws:
            inspect_page(ws, trace)
            ws.send_json({'type': 'text', 'text': 'Explain the source step by step.'})
            first_mark = None
            for index in range(3):
                packet = collect(ws, trace, lambda event: event['event'] == 'document_action')
                action = packet['action']
                assert len(session.spoken) == index, 'The mark must be acknowledged before its narration.'
                assert action['kind'] == 'mark' and action['replace'] is True and action['page'] == 2
                assert action['document_id'] == DOCUMENT['id'] and action['view_revision'] == 1
                assert len(action['marks']) == index + 1
                assert action['teaching']['index'] == index and action['teaching']['count'] == 3
                assert action['teaching']['image_sha256'] == session.read['visual_observation']['image_sha256']
                assert action['teaching']['source_id'] == session.read['sources'][0]['id']
                if first_mark is None:
                    first_mark = action
                assert action['view_region'] == first_mark['view_region']
                assert action['marks'][0] == first_mark['marks'][0]
                acknowledge_mark(ws, packet)
                step = collect(ws, trace, lambda event: event['event'] == 'teaching_step')
                assert step['mode'] == 'source' and step['action_id'] == action['action_id']
                assert step['region_id'] == action['teaching']['region_id']
                assert step['source_id'] == session.read['sources'][0]['id']
                assert step['document_id'] == DOCUMENT['id'] and step['page'] == 2
                assert step['image_sha256'] == session.read['visual_observation']['image_sha256']
                assert step['view_region'] == action['view_region']
                assert step['narration'] == NARRATIONS[index]
                ws.send_json({'type': 'teaching_boundary', 'sequence_id': step['sequence_id'], 'index': index,
                              'heard': index != 1, **({'manual': True} if index == 1 else {})})
            finished(ws, trace)
            result = session.results[-1].response
            assert result['status'] == 'presented-progressively'
            assert result['rendered_steps'] == 3 and result['local_speech_boundaries_confirmed'] == 2
            assert result['manual_advances'] == 1 and session.spoken == NARRATIONS
            assert result['current_view']['page'] == 2 and result['current_view']['region'] == first_mark['view_region']
            assert result['source_id'] == session.read['sources'][0]['id']
            assert inspector.calls == 1, 'Teaching an inspected source must not re-inspect its pixels.'
            started = next(event for event in trace if event['event'] == 'teaching_started')
            assert started['source_id'] == session.read['sources'][0]['id']
            assert started['document_id'] == DOCUMENT['id'] and started['page'] == 2
            assert started['image_sha256'] == session.read['visual_observation']['image_sha256']
            assert started['view_region'] == first_mark['view_region']
            assert not any(event['event'] == 'presentation_action' for event in trace)
            activity = [event for event in trace if event['event'] == 'evidence_activity']
            assert {(event['tool_call_id'], event['status']) for event in activity} == {
                ('read-source', 'running'), ('read-source', 'finished'), ('teach-source', 'running'), ('teach-source', 'finished')}
            ws.send_json({'type': 'stop'})
    assert bridge.last_session['document_proposals'] == 4


@pytest.mark.parametrize('phase', ['render', 'speech'])
@pytest.mark.parametrize('cause', ['typed', 'view'])
def test_source_cancellation_releases_pending_render_or_speech_without_later_marks(tmp_path, monkeypatch, phase, cause):
    _bridge, app, session, _inspector = source_bridge(tmp_path, monkeypatch)
    trace = []
    with TestClient(app) as client:
        permit = client.post('/api/native/permit').json()['permit']
        with client.websocket_connect('/api/native/voice?permit=' + permit) as ws:
            inspect_page(ws, trace)
            ws.send_json({'type': 'text', 'text': 'Explain the source step by step.'})
            mark = collect(ws, trace, lambda event: event['event'] == 'document_action')
            if phase == 'speech':
                acknowledge_mark(ws, mark)
                collect(ws, trace, lambda event: event['event'] == 'teaching_step')
            if cause == 'typed':
                ws.send_json({'type': 'text', 'text': 'How many pages does the selected document have?'})
            else:
                ws.send_json({'type': 'document_view', 'view': {'document_id': DOCUMENT['id'], 'page': 3,
                              'region': [0, 0, 1, 1], 'view_revision': 2}})
            later = []
            finished(ws, later)
            assert not any(event['event'] == 'document_action' for event in later)
            assert session.spoken == (NARRATIONS[:1] if phase == 'speech' else [])
            ended = next(event for event in later if event['event'] == 'teaching_finished')
            assert ended['status'] == 'paused' and ended['local_speech_boundaries_confirmed'] == 0
            assert session.results[-1].response['status'] in {'paused', 'not-displayed'}
            if cause == 'view':
                assert session.results[-1].response['current_view']['page'] == 3
            ws.send_json({'type': 'stop'})


def test_a_wrong_source_crop_cannot_start_commentary(tmp_path, monkeypatch):
    _bridge, app, session, _inspector = source_bridge(tmp_path, monkeypatch)
    trace = []
    with TestClient(app) as client:
        permit = client.post('/api/native/permit').json()['permit']
        with client.websocket_connect('/api/native/voice?permit=' + permit) as ws:
            inspect_page(ws, trace)
            ws.send_json({'type': 'text', 'text': 'Explain the source step by step.'})
            mark = collect(ws, trace, lambda event: event['event'] == 'document_action')
            acknowledge_mark(ws, mark, region=[0, 0, 1, 1])
            later = []; finished(ws, later)
            assert not session.spoken and not any(event['event'] == 'teaching_step' for event in later)
            assert session.results[-1].response['rendered_steps'] == 0
            ws.send_json({'type': 'stop'})


def test_failed_pixel_inspection_cannot_become_a_source_walkthrough(tmp_path, monkeypatch):
    _bridge, app, session, inspector = source_bridge(tmp_path, monkeypatch, unavailable=True)
    trace = []
    with TestClient(app) as client:
        permit = client.post('/api/native/permit').json()['permit']
        with client.websocket_connect('/api/native/voice?permit=' + permit) as ws:
            inspect_page(ws, trace)
            ws.send_json({'type': 'text', 'text': 'Explain the source step by step.'})
            later = []; finished(ws, later)
            assert session.results[-1].response['status'] == 'not-displayed'
            assert not session.spoken and inspector.calls == 1
            assert not any(event['event'] in {'document_action', 'teaching_started', 'teaching_step'} for event in later)
            ws.send_json({'type': 'stop'})


def test_model_supplied_source_metadata_cannot_start_a_source_walkthrough(tmp_path, monkeypatch):
    _bridge, app, session, inspector = source_bridge(tmp_path, monkeypatch, explicit_metadata=True)
    trace = []
    with TestClient(app) as client:
        permit = client.post('/api/native/permit').json()['permit']
        with client.websocket_connect('/api/native/voice?permit=' + permit) as ws:
            inspect_page(ws, trace)
            ws.send_json({'type': 'text', 'text': 'Explain the source step by step.'})
            later = []; finished(ws, later)
            assert session.results[-1].response['status'] == 'not-displayed'
            assert not session.spoken and inspector.calls == 1
            assert not any(event['event'] in {'document_action', 'teaching_started', 'teaching_step'} for event in later)
            ws.send_json({'type': 'stop'})


def test_parallel_queued_source_request_is_retired_and_each_real_tool_id_finishes(tmp_path, monkeypatch):
    _bridge, app, session, _inspector = source_bridge(tmp_path, monkeypatch, queued_second=True)
    trace = []
    with TestClient(app) as client:
        permit = client.post('/api/native/permit').json()['permit']
        with client.websocket_connect('/api/native/voice?permit=' + permit) as ws:
            inspect_page(ws, trace)
            ws.send_json({'type': 'text', 'text': 'Explain the source step by step.'})
            collect(ws, trace, lambda event: event['event'] == 'document_action')
            ws.send_json({'type': 'text', 'text': 'Pause that explanation.'})
            later = []
            collect(ws, later, lambda event: event['event'] == 'evidence_activity'
                    and event['tool_call_id'] == 'teach-source-queued' and event['status'] == 'finished')
            assert not session.spoken and not any(event['event'] == 'document_action' for event in later)
            assert [result.response['status'] for result in session.results if result.name == 'teach_source'] == ['paused', 'paused']
            activity = [event for event in trace + later if event['event'] == 'evidence_activity'
                        and event['tool_call_id'].startswith('teach-source')]
            assert {(event['tool_call_id'], event['status']) for event in activity} == {
                ('teach-source', 'running'), ('teach-source', 'finished'),
                ('teach-source-queued', 'running'), ('teach-source-queued', 'finished')}
            assert all(event['generation'] == 0 for event in activity)
            ws.send_json({'type': 'stop'})
