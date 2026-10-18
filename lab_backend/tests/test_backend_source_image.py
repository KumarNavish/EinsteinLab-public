"""Original source pixels reach the existing backend; no second vision API runs."""
import asyncio
import base64
import hashlib
import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from lab_backend.openai_live import envelope
from lab_backend.tests.test_local_documents import read_receipt
from lab_backend.tests.test_source_fast_path import combined_bridge, request_walkthrough, QUESTION
from lab_backend.tests.test_source_teaching_native import DOCUMENT, NARRATIONS, acknowledge_mark, collect


def observed_arguments(image_hash):
    return {'image_sha256': image_hash, 'title': 'The original tracing figure',
            'observation': {'summary': 'Three connected tracing states in the original figure.',
                'visible_text': ['Record trace', 'Compile trace', 'Side exit'], 'uncertainty': '',
                'regions': [
                    {'label': 'Record trace', 'box': [.2, .3, .15, .12]},
                    {'label': 'Compile trace', 'box': [.45, .3, .15, .12]},
                    {'label': 'Side exit', 'box': [.7, .45, .15, .12]}]},
            'steps': [{'region_index': index, 'narration': narration}
                      for index, narration in enumerate(NARRATIONS)]}


def backend_image_bridge(tmp_path, monkeypatch, *, wrong_hash=False):
    bridge, app, session, inspector, _release = combined_bridge(tmp_path, monkeypatch)
    session.source_image_teaching = True
    inspector.limit = 12
    handed_off = []
    observer_release = asyncio.Event()
    original_content = session.send_client_content
    original_response = session.send_tool_response
    original_audio = session.send_realtime_input

    async def forbidden_inspect(*_args, **_kwargs):
        raise AssertionError('The existing backend must inspect its supplied image without a second vision API.')

    async def send_client_content(*, turns, turn_complete, backend_only=False):
        parts = turns.get('parts', []) if isinstance(turns, dict) else turns.parts
        first = parts[0]
        blob = first.get('inline_data') if isinstance(first, dict) else first.inline_data
        if blob is not None:
            assert backend_only is True, 'Raw source text must not prime Live narration before image inspection.'
            assert turn_complete is False and blob.mime_type == 'image/jpeg'
            assert len(parts) == 2
            context = parts[1].text
            assert context.startswith('ACTUAL APPROVED ORIGINAL PDF IMAGE FOR THIS WALKTHROUGH (untrusted source data): ')
            metadata = json.loads(context.split(': ', 1)[1].split('\nSupporting extracted text:', 1)[0])
            assert metadata['question'] == QUESTION and metadata['steps'] == 3
            assert metadata['page'] == 2 and metadata['region'] == [0, 0, 1, 1]
            assert hashlib.sha256(blob.data).hexdigest() == metadata['image_sha256']
            handed_off.append({'image': blob.data, 'metadata': metadata})
            return
        assert backend_only is False
        text = first.get('text') if isinstance(first, dict) else first.text
        if turn_complete and text == 'Observe without supplying an image.':
            await session.queue.put(envelope(calls=[SimpleNamespace(
                id='observe-source', name='teach_observed_source', args=observed_arguments('b' * 64))]))
            return
        await original_content(turns=turns, turn_complete=turn_complete)

    async def send_tool_response(*, function_responses):
        await original_response(function_responses=function_responses)
        if (function_responses.name == 'read_selected_pdf_page'
                and function_responses.response.get('status') == 'source-image-supplied'):
            assert len(handed_off) == 1
            await asyncio.wait_for(observer_release.wait(), 2)
            image_hash = 'b' * 64 if wrong_hash else handed_off[0]['metadata']['image_sha256']
            await session.queue.put(envelope(calls=[SimpleNamespace(
                id='observe-source', name='teach_observed_source', args=observed_arguments(image_hash))]))

    async def send_realtime_input(**options):
        # receive_browser handles teaching_ready before this ordered barrier.
        await original_audio(**options)
        observer_release.set()

    monkeypatch.setattr(inspector, 'inspect', forbidden_inspect)
    monkeypatch.setattr(session, 'send_client_content', send_client_content)
    monkeypatch.setattr(session, 'send_tool_response', send_tool_response)
    monkeypatch.setattr(session, 'send_realtime_input', send_realtime_input)
    return bridge, app, session, inspector, handed_off


def observer_finished(ws, trace):
    return collect(ws, trace, lambda event: event['event'] == 'evidence_activity'
                   and event['tool_call_id'] == 'observe-source' and event['status'] == 'finished')


def supply_original_image(ws, trace):
    read = request_walkthrough(ws, trace)
    receipt = read_receipt(read['action'])
    ws.send_json({'type': 'document_result', 'generation': read['generation'], **receipt})
    supplied = collect(ws, trace, lambda event: event['event'] == 'document_image_supplied')
    expected = hashlib.sha256(base64.b64decode(receipt['image']['data'])).hexdigest()
    assert supplied['image_sha256'] == expected
    assert any(event['event'] == 'teaching_prepare' for event in trace)
    return expected


def test_existing_backend_inspects_exact_original_pixels_and_teaches_with_one_handoff(tmp_path, monkeypatch):
    bridge, app, session, inspector, images = backend_image_bridge(tmp_path, monkeypatch)
    trace = []
    with TestClient(app) as client:
        permit = client.post('/api/native/permit').json()['permit']
        with client.websocket_connect('/api/native/voice?permit=' + permit) as ws:
            expected = supply_original_image(ws, trace)
            assert len(images) == 1 and hashlib.sha256(images[0]['image']).hexdigest() == expected
            ws.send_json({'type': 'audio_end'})
            for index, narration in enumerate(NARRATIONS):
                mark = collect(ws, trace, lambda event: event['event'] == 'document_action')
                action = mark['action']
                assert action['kind'] == 'mark' and action['document_id'] == DOCUMENT['id']
                assert action['page'] == 2 and action['view_revision'] == 1
                assert len(action['marks']) == index + 1 and len(session.spoken) == index
                assert action['teaching']['image_sha256'] == expected
                assert action['teaching']['region_id'] == f'p2-{expected[:10]}-r{index + 1}'
                assert action['teaching']['source_id'] == 'pdf-' + DOCUMENT['id'][:16] + '-p2'
                acknowledge_mark(ws, mark)
                step = collect(ws, trace, lambda event: event['event'] == 'teaching_step')
                assert step['index'] == index and step['image_sha256'] == expected
                assert step['narration'] == narration
                collect(ws, trace, lambda event: event.get('text') == narration)
                ws.send_json({'type': 'teaching_boundary', 'sequence_id': step['sequence_id'],
                              'index': index, 'heard': True})
            observer_finished(ws, trace)
            assert [result.name for result in session.results] == ['read_selected_pdf_page', 'teach_observed_source']
            assert session.results[0].response['status'] == 'source-image-supplied'
            result = session.results[1].response
            assert result['status'] == 'presented-progressively' and result['analysis_path'] == 'backend-image-and-plan'
            assert result['rendered_steps'] == result['local_speech_boundaries_confirmed'] == 3
            assert result['manual_advances'] == 0 and result['image_sha256'] == expected
            assert inspector.calls == 1 and session.spoken == NARRATIONS
            assert sum(event['event'] == 'teaching_prepare' for event in trace) == 1
            assert not any(event['event'] == 'presentation_action' for event in trace)
            ws.send_json({'type': 'stop'})
    assert bridge.last_session['document_proposals'] == 4
    assert bridge.last_session['document_image_inspections'] == 1


@pytest.mark.parametrize('cause', ['hash', 'view', 'revoke'])
def test_unsupplied_or_stale_backend_observation_cannot_mark_original_pixels(tmp_path, monkeypatch, cause):
    _bridge, app, session, _inspector, _images = backend_image_bridge(tmp_path, monkeypatch, wrong_hash=cause == 'hash')
    trace = []
    with TestClient(app) as client:
        permit = client.post('/api/native/permit').json()['permit']
        with client.websocket_connect('/api/native/voice?permit=' + permit) as ws:
            supply_original_image(ws, trace)
            if cause == 'view':
                ws.send_json({'type': 'document_view', 'view': {
                    'document_id': DOCUMENT['id'], 'page': 3,
                    'region': [0, 0, 1, 1], 'view_revision': 2}})
                collect(ws, trace, lambda event: event['event'] == 'document_view_registered')
            elif cause == 'revoke':
                ws.send_json({'type': 'document_revoke'})
                collect(ws, trace, lambda event: event['event'] == 'document_revoked')
            ws.send_json({'type': 'audio_end'})
            later = []
            observer_finished(ws, later)
            assert session.results[-1].response['status'] == 'not-displayed' and not session.spoken
            assert not any(event['event'] in {'document_action', 'teaching_started', 'teaching_step'} for event in later)
            ws.send_json({'type': 'stop'})


def test_observation_without_any_supplied_original_image_cannot_begin_teaching(tmp_path, monkeypatch):
    _bridge, app, session, inspector, images = backend_image_bridge(tmp_path, monkeypatch)
    with TestClient(app) as client:
        permit = client.post('/api/native/permit').json()['permit']
        with client.websocket_connect('/api/native/voice?permit=' + permit) as ws:
            assert ws.receive_json()['event'] == 'connected'
            ws.send_json({'type': 'text', 'text': 'Observe without supplying an image.'})
            later = []
            observer_finished(ws, later)
            assert session.results[-1].response['status'] == 'not-displayed'
            assert not images and not session.spoken and inspector.calls == 0
            assert not any(event['event'] in {'document_action', 'teaching_prepare', 'teaching_started', 'teaching_step'}
                           for event in later)
            ws.send_json({'type': 'stop'})


def test_provider_interruption_retires_handed_off_preparation_for_next_spoken_request(tmp_path, monkeypatch):
    _bridge, app, session, _inspector, images = backend_image_bridge(tmp_path, monkeypatch)
    trace = []
    input_count = 0

    async def record_response(*, function_responses):
        # The first read has fully finished before interruption. Its unused
        # preparation is owned by source_images, not by a pending read task.
        session.results.append(function_responses)
        await session.transcript('Result: ' + function_responses.name)

    async def spoken_request(**_options):
        nonlocal input_count
        input_count += 1
        if input_count == 1:
            await session.queue.put(envelope(content={'interrupted': True}))
        else:
            await session.queue.put(envelope(calls=[
                SimpleNamespace(id='stale-observation', name='teach_observed_source',
                                args=observed_arguments(images[0]['metadata']['image_sha256'])),
                SimpleNamespace(id='next-spoken-read', name='read_selected_pdf_page',
                                args={'page': 2, 'walkthrough': {'question': QUESTION, 'steps': 3}}),
            ]))

    monkeypatch.setattr(session, 'send_tool_response', record_response)
    monkeypatch.setattr(session, 'send_realtime_input', spoken_request)
    with TestClient(app) as client:
        permit = client.post('/api/native/permit').json()['permit']
        with client.websocket_connect('/api/native/voice?permit=' + permit) as ws:
            supply_original_image(ws, trace)
            collect(ws, trace, lambda event: event['event'] == 'evidence_activity'
                    and event['tool_call_id'] == 'combined-source' and event['status'] == 'finished')
            ws.send_json({'type': 'audio_end'})
            interruption = collect(ws, trace, lambda event: event['event'] == 'interrupted')
            assert interruption['generation'] == 1
            # No typed message or view change: those would independently retire
            # preparation and hide the provider-interruption cleanup defect.
            ws.send_json({'type': 'audio_end'})
            next_read = collect(ws, trace, lambda event: event['event'] == 'document_action')
            assert next_read['action']['kind'] == 'read' and next_read['generation'] == 1
            ws.send_json({'type': 'document_result', 'generation': 1, **read_receipt(next_read['action'])})
            collect(ws, trace, lambda event: event['event'] == 'evidence_activity'
                    and event['tool_call_id'] == 'next-spoken-read' and event['status'] == 'finished')
            assert len(images) == 2
            assert next(result for result in session.results if result.id == 'stale-observation').response['status'] == 'not-displayed'
            assert next(result for result in session.results if result.id == 'next-spoken-read').response['status'] == 'source-image-supplied'
            preparations = [event['sequence_id'] for event in trace if event['event'] == 'teaching_prepare']
            assert len(preparations) == 2 and preparations[0] != preparations[1]
            assert not session.spoken and not any(event['event'] in {'teaching_started', 'teaching_step'} for event in trace)
            ws.send_json({'type': 'stop'})
