"""Combined source-read/teaching regressions with no provider or network access."""
import asyncio
import base64
import hashlib
import threading
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from lab_backend.openai_live import envelope
from lab_backend.tests.test_local_documents import read_receipt
from lab_backend.tests.test_source_teaching_native import (
    DOCUMENT, NARRATIONS, acknowledge_mark, collect, source_bridge,
)


QUESTION = 'Walk through this source figure in three short steps, marking each part.'
WALKTHROUGH = {'question': QUESTION, 'steps': 3}


def combined_bridge(tmp_path, monkeypatch, *, delayed=False):
    bridge, app, session, inspector = source_bridge(tmp_path, monkeypatch)
    send_content, inspect = session.send_client_content, inspector.inspect
    release = threading.Event()

    async def send_client_content(*, turns, turn_complete):
        text = turns['parts'][0]['text'] if isinstance(turns, dict) else turns.parts[0].text
        if turn_complete and text == QUESTION:
            session.inputs.append((text, turn_complete))
            await session.queue.put(envelope(calls=[SimpleNamespace(
                id='combined-source', name='read_selected_pdf_page',
                args={'page': 2, 'walkthrough': dict(WALKTHROUGH)})]))
        else:
            await send_content(turns=turns, turn_complete=turn_complete)

    async def inspect_and_plan(*args, walkthrough=None):
        assert walkthrough == WALKTHROUGH
        observation = await inspect(*args)
        if delayed:
            assert await asyncio.to_thread(release.wait, 2), 'The test must release the blocked inspection.'
        return {**observation, 'walkthrough': {
            'title': 'The original tracing figure',
            'steps': [{'region_index': index, 'narration': narration}
                      for index, narration in enumerate(NARRATIONS)],
        }}

    monkeypatch.setattr(session, 'send_client_content', send_client_content)
    monkeypatch.setattr(inspector, 'inspect', inspect_and_plan)
    return bridge, app, session, inspector, release


def request_walkthrough(ws, trace):
    assert ws.receive_json()['event'] == 'connected'
    ws.send_json({'type': 'document_offer', 'document': DOCUMENT})
    assert ws.receive_json()['event'] == 'document_registered'
    ws.send_json({'type': 'document_view', 'view': {
        'document_id': DOCUMENT['id'], 'page': 2,
        'region': [0, 0, 1, 1], 'view_revision': 1}})
    assert ws.receive_json()['event'] == 'document_view_registered'
    ws.send_json({'type': 'text', 'text': QUESTION})
    action = collect(ws, trace, lambda event: event['event'] == 'document_action')
    assert action['action']['kind'] == 'read'
    return action


def combined_finished(ws, trace):
    return collect(ws, trace, lambda event: event['event'] == 'evidence_activity'
                   and event['tool_call_id'] == 'combined-source' and event['status'] == 'finished')


def test_one_source_read_inspects_and_teaches_without_a_second_planning_tool(tmp_path, monkeypatch):
    bridge, app, session, inspector, _release = combined_bridge(tmp_path, monkeypatch)
    trace = []
    with TestClient(app) as client:
        permit = client.post('/api/native/permit').json()['permit']
        with client.websocket_connect('/api/native/voice?permit=' + permit) as ws:
            read = request_walkthrough(ws, trace)
            assert inspector.calls == 0 and not session.spoken
            receipt = read_receipt(read['action'])
            exact_image_hash = hashlib.sha256(base64.b64decode(receipt['image']['data'])).hexdigest()
            ws.send_json({'type': 'document_result', 'generation': read['generation'], **receipt})
            first_crop = None
            for index, narration in enumerate(NARRATIONS):
                mark = collect(ws, trace, lambda event: event['event'] == 'document_action')
                action = mark['action']
                assert action['kind'] == 'mark' and action['page'] == 2
                assert action['document_id'] == DOCUMENT['id'] and action['view_revision'] == 1
                assert action['replace'] is True and len(action['marks']) == index + 1
                assert action['teaching']['image_sha256'] == exact_image_hash
                assert action['teaching']['source_id'] == 'pdf-' + DOCUMENT['id'][:16] + '-p2'
                assert len(session.spoken) == index, 'Unacknowledged marks cannot start narration.'
                first_crop = action['view_region'] if first_crop is None else first_crop
                assert action['view_region'] == first_crop
                acknowledge_mark(ws, mark)
                step = collect(ws, trace, lambda event: event['event'] == 'teaching_step')
                assert step['index'] == index and step['count'] == 3
                assert step['narration'] == narration and step['image_sha256'] == exact_image_hash
                assert step['action_id'] == action['action_id']
                assert step['region_id'] == action['teaching']['region_id']
                collect(ws, trace, lambda event: event.get('text') == narration)
                ws.send_json({'type': 'teaching_boundary', 'sequence_id': step['sequence_id'],
                              'index': index, 'heard': True})
            combined_finished(ws, trace)
            assert inspector.calls == 1 and session.spoken == NARRATIONS
            assert [result.name for result in session.results] == ['read_selected_pdf_page']
            result = session.results[0].response
            assert result['analysis_path'] == 'combined-source-inspection-and-teaching'
            assert result['status'] == 'presented-progressively'
            assert result['rendered_steps'] == result['local_speech_boundaries_confirmed'] == 3
            assert result['manual_advances'] == 0 and result['image_sha256'] == exact_image_hash
            assert result['visual_observation']['image_sha256'] == exact_image_hash
            assert {event['tool_call_id'] for event in trace if event['event'] == 'evidence_activity'} == {'combined-source'}
            assert not any(event['event'] == 'presentation_action' for event in trace)
            ws.send_json({'type': 'stop'})
    assert bridge.last_session['document_proposals'] == 4
    assert bridge.last_session['document_image_inspections'] == 1


def test_question_changed_before_page_ack_skips_the_inspection_entirely(tmp_path, monkeypatch):
    _bridge, app, session, inspector, _release = combined_bridge(tmp_path, monkeypatch)
    trace = []
    with TestClient(app) as client:
        permit = client.post('/api/native/permit').json()['permit']
        with client.websocket_connect('/api/native/voice?permit=' + permit) as ws:
            read = request_walkthrough(ws, trace)
            ws.send_json({'type': 'text', 'text': 'Pause that and answer my new question.'})
            collect(ws, trace, lambda event: event.get('text') == 'Latest question accepted.')
            ws.send_json({'type': 'document_result', 'generation': read['generation'], **read_receipt(read['action'])})
            later = []
            combined_finished(ws, later)
            assert inspector.calls == 0 and not session.spoken
            # The drain handshake may overlap inspection. No actual view or
            # teaching step may follow a superseding question or revocation.
            assert not any(event['event'] in {'document_action', 'teaching_started', 'teaching_step'}
                           for event in later)
            assert len(session.results) == 1
            assert 'question changed' in session.results[0].response['answer'].lower()
            ws.send_json({'type': 'stop'})


@pytest.mark.parametrize('cause', ['typed', 'view', 'revoke'])
def test_superseded_combined_inspection_cannot_start_a_walkthrough(tmp_path, monkeypatch, cause):
    _bridge, app, session, inspector, release = combined_bridge(tmp_path, monkeypatch, delayed=True)
    trace = []
    with TestClient(app) as client:
        permit = client.post('/api/native/permit').json()['permit']
        with client.websocket_connect('/api/native/voice?permit=' + permit) as ws:
            read = request_walkthrough(ws, trace)
            ws.send_json({'type': 'document_result', 'generation': read['generation'], **read_receipt(read['action'])})
            collect(ws, trace, lambda event: event['event'] == 'document_vision_started')
            if cause == 'typed':
                ws.send_json({'type': 'text', 'text': 'Pause that and answer my new question.'})
                collect(ws, trace, lambda event: event.get('text') == 'Latest question accepted.')
            elif cause == 'view':
                ws.send_json({'type': 'document_view', 'view': {
                    'document_id': DOCUMENT['id'], 'page': 3,
                    'region': [0, 0, 1, 1], 'view_revision': 2}})
                collect(ws, trace, lambda event: event['event'] == 'document_view_registered')
            else:
                ws.send_json({'type': 'document_revoke'})
                collect(ws, trace, lambda event: event['event'] == 'document_revoked')
            release.set()
            later = []
            combined_finished(ws, later)
            assert inspector.calls == 1 and not session.spoken
            # Playback prewarming is allowed during inspection; supersession
            # must prevent all actual marks and teaching from starting.
            assert not any(event['event'] in {'document_action', 'teaching_started', 'teaching_step'}
                           for event in trace + later if event is not read)
            assert [result.name for result in session.results] == ['read_selected_pdf_page']
            assert session.results[0].response['status'] in {'paused', 'not-displayed'}
            ws.send_json({'type': 'stop'})
