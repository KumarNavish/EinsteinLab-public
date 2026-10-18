"""Actual public/native text bridge with Responses MockTransport; no voice or API."""
import asyncio
from contextlib import asynccontextmanager
import json
import sqlite3

import httpx
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from lab_backend.openai_text import ResponsesTextSession
from lab_backend.public_service import create_app
from lab_backend.tests.test_native_live import teaching_bridge, receive_until
from lab_backend.tests.test_source_teaching_native import source_bridge, DOCUMENT, NARRATIONS, acknowledge_mark
from lab_backend.tests.test_local_documents import read_receipt
from lab_backend.tests.test_openai_text import response, function, message


def use_responses(bridge, handler):
    sessions, prompts = [], []
    @asynccontextmanager
    async def factory(key, system, declarations, **options):
        assert options == {}, 'Text may not configure voice/audio'
        prompts.append(system)
        target = ResponsesTextSession(key, system, declarations, transport=httpx.MockTransport(handler))
        sessions.append(target)
        try: yield target
        finally: await target.aclose()
    bridge.text_session_factory = factory
    return sessions, prompts


def permit(client, *, text_only=True, public=False):
    result = client.post('/api/native/permit', json={'text_only': text_only},
                         headers={'origin': 'http://testserver'} if public else {})
    assert result.status_code == 200, result.text
    assert result.json()['mode'] == ('text' if text_only else 'voice')
    return result.json()['permit']


def collect(ws, trace, predicate):
    packet, events = receive_until(ws, predicate, ready_browser=False)
    trace.extend(events)
    return packet


def typed(ws, identity, text):
    ws.send_json({'type': 'text', 'request_id': identity, 'text': text})


def test_real_public_text_route_never_starts_live_and_shares_existing_budget(tmp_path, monkeypatch):
    from lab_backend import native_live
    actual_teaching = native_live.ProgressiveTeaching
    reader_waits = []
    def teaching(**options):
        reader_waits.append(options['boundary_timeout'])
        return actual_teaching(**options)
    monkeypatch.setattr(native_live, 'ProgressiveTeaching', teaching)
    bridge, _, voice_sessions = teaching_bridge(tmp_path, monkeypatch)
    requests = []
    def handle(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json=response([message('Two plus two equals four.')]))
    sessions, prompts = use_responses(bridge, handle)
    app = create_app(tmp_path, origin='http://testserver', private_qa=True, bridge_factory=lambda: bridge)
    with TestClient(app) as client:
        assert client.get('/api/native/status').json()['text_only_available']
        token = permit(client, public=True)
        assert not bridge.config.provider_verified and not voice_sessions
        # Crossing the endpoint must fail BEFORE consuming permit or reserving spend.
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect('/api/native/voice?permit='+token, headers={'origin': 'http://testserver'}): pass
        assert token in bridge.config.permits
        assert not app.state.visitors.active and not app.state.visitors.budget.path.exists()
        with client.websocket_connect('/api/native/text?permit='+token, headers={'origin': 'http://testserver'}) as ws:
            connected = ws.receive_json()
            assert connected['mode'] == 'text' and connected['model'] == 'gpt-6.1-sol'
            assert connected['generation'] == 0 and connected['request_id'] == 0
            assert connected['voice'] is connected['accent'] is None
            assert connected['continuous_audio'] is False and connected['lipsync_kind'] == 'none'
            assert not voice_sessions and not requests and not bridge.config.provider_verified
            assert app.state.visitors.room_status()['room_active_sessions'] == 1
            typed(ws, 1, 'What is two plus two?')
            trace = []
            done = collect(ws, trace, lambda p: p['event'] == 'turn_complete')
            assert trace[0]['event'] == 'interrupted' and trace[1]['event'] == 'input_accepted'
            assert all(p['generation'] == 1 and p['request_id'] == 1 for p in trace)
            assert done['audio_bytes'] == 0 and done['text_characters'] == len('Two plus two equals four.')
            assert not any(p['event'] in {'audio', 'teaching_prepare'} for p in trace)
            assert bridge.config.provider_verified
            ws.send_json({'type': 'stop'})
            with pytest.raises(WebSocketDisconnect): ws.receive_json()
        status = client.get('/api/native/status').json()
        assert status['room_active_sessions'] == 0
        assert bridge.last_session['mode'] == 'text'
        assert bridge.last_session['provider_usage']['final_usage_confirmed']
        assert bridge.last_session['input_audio_bytes'] == bridge.last_session['output_audio_bytes'] == 0
        assert app.state.visitors.capacity == 2
        assert app.state.visitors.budget.daily_sessions == 12 and app.state.visitors.budget.per_network == 4
        # A later ordinary permit is still voice-scoped, with its original voice.
        voice_token = permit(client, text_only=False, public=True)
        assert bridge.text_permits[voice_token] is False
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect('/api/native/text?permit='+voice_token, headers={'origin': 'http://testserver'}): pass
        assert voice_token in bridge.config.permits
    assert len(requests) == 1 and not voice_sessions and len(sessions) == 1
    assert reader_waits == [600], 'Manual reading must remain available within the session cap'
    assert 'Hands remain in authored rest' in prompts[0]
    assert 'SOURCE DECISION AND CORRECTION' in prompts[0]
    assert 'Gemini 3.8 Flash' not in prompts[0]


@pytest.mark.parametrize('packet', [b'\x00\x00', {'type': 'audio_end'},
    {'type': 'text', 'text': 'Missing ID'}, {'type': 'text', 'text': 'Boolean ID', 'request_id': True}])
def test_text_mode_rejects_audio_and_unowned_questions_without_spending(tmp_path, monkeypatch, packet):
    bridge, app, voice_sessions = teaching_bridge(tmp_path, monkeypatch)
    sessions, _ = use_responses(bridge, lambda _: pytest.fail('Invalid input cannot call Responses'))
    with TestClient(app) as client:
        with client.websocket_connect('/api/native/text?permit='+permit(client)) as ws:
            assert ws.receive_json()['event'] == 'connected'
            ws.send_bytes(packet) if isinstance(packet, bytes) else ws.send_json(packet)
            assert ws.receive_json()['event'] == 'error'
    assert not voice_sessions and sessions[0].usage['backend_responses_started'] == 0


def test_new_typed_question_cancels_http_before_ack_and_cannot_relabel_the_old_reply(tmp_path, monkeypatch):
    bridge, app, _ = teaching_bridge(tmp_path, monkeypatch)
    entered, cancelled = [], []
    async def handle(request):
        body = json.loads(request.content)
        text = body['input'][-1]['content'][0]['text']
        if text == 'Old question':
            entered.append(True)
            try: await asyncio.sleep(10)
            except asyncio.CancelledError: cancelled.append(True); raise
        return httpx.Response(200, json=response([message('Latest answer')]))
    sessions, _ = use_responses(bridge, handle)
    with TestClient(app) as client:
        with client.websocket_connect('/api/native/text?permit='+permit(client)) as ws:
            ws.receive_json()
            typed(ws, 1, 'Old question')
            collect(ws, [], lambda p: p['event'] == 'evidence_activity' and p['status'] == 'running')
            typed(ws, 2, 'Latest question')
            trace = []
            collect(ws, trace, lambda p: p['event'] == 'turn_complete')
            accepted = next(i for i,p in enumerate(trace) if p['event'] == 'input_accepted')
            assert all(p['request_id'] == 2 and p['generation'] == 2 for p in trace[accepted:])
            assert [p['text'] for p in trace if p['event'] == 'output_transcript'] == ['Latest answer']
            typed(ws, 2, 'Duplicate ID')
            assert ws.receive_json()['event'] == 'error'
    assert entered == cancelled == [True]
    assert sessions[0].usage['cancelled_requests'] == 1
    assert sessions[0].usage['final_usage_confirmed'] is False


@pytest.mark.parametrize('cancel_kind', [None, 'document_view', 'document_revoke', 'text'])
def test_actual_source_ack_then_visible_commentary_and_manual_steps(tmp_path, monkeypatch, cancel_kind):
    bridge, app, _voice_session, inspector = source_bridge(tmp_path, monkeypatch)
    calls, results = [], []
    def handle(request):
        body = json.loads(request.content); calls.append(body)
        last = body['input'][-1]
        if last.get('type') == 'function_call_output':
            result = json.loads(last['output']); results.append(result)
            return httpx.Response(200, json=response([message('Result received.')]))
        text = last['content'][0]['text']
        if text == 'Read the selected page.':
            output = function('read-source', 'read_selected_pdf_page', {'page': 2})
        elif text == 'Explain the source step by step.':
            regions = results[0]['visual_observation']['regions']
            output = function('teach-source', 'teach_source', {'title': 'The original tracing figure',
                'steps': [{'region_id': region['id'], 'narration': narration}
                          for region, narration in zip(regions, NARRATIONS)]})
        else: output = message('Latest question accepted.')
        return httpx.Response(200, json=response([output]))
    sessions, _ = use_responses(bridge, handle)
    trace = []
    with TestClient(app) as client:
        with client.websocket_connect('/api/native/text?permit='+permit(client)) as ws:
            assert ws.receive_json()['mode'] == 'text'
            ws.send_json({'type': 'document_offer', 'document': DOCUMENT})
            collect(ws, trace, lambda p: p['event'] == 'document_registered')
            ws.send_json({'type': 'document_view', 'view': {'document_id': DOCUMENT['id'], 'page': 2,
                         'region': [0,0,1,1], 'view_revision': 1}})
            collect(ws, trace, lambda p: p['event'] == 'document_view_registered')
            typed(ws, 1, 'Read the selected page.')
            action = collect(ws, trace, lambda p: p['event'] == 'document_action')
            ws.send_json({'type': 'document_result', 'generation': action['generation'], **read_receipt(action['action'])})
            collect(ws, trace, lambda p: p['event'] == 'turn_complete')
            typed(ws, 2, 'Explain the source step by step.')
            mark = collect(ws, trace, lambda p: p['event'] == 'document_action')
            assert mark['action']['teaching']['index'] == 0
            assert not any(p['event'] == 'teaching_text' for p in trace)
            acknowledge_mark(ws, mark)
            commentary = collect(ws, trace, lambda p: p['event'] == 'teaching_text')
            assert commentary['text'] == NARRATIONS[0] and commentary['complete'] is True
            assert commentary['generation'] == mark['generation'] and commentary['request_id'] == 2
            assert commentary['index'] == 0 and commentary['sequence_id'] == mark['sequence_id']
            if cancel_kind:
                if cancel_kind == 'document_view':
                    ws.send_json({'type': cancel_kind, 'view': {'document_id': DOCUMENT['id'], 'page': 3,
                                'region': [0,0,1,1], 'view_revision': 2}})
                    terminal = 'document_view_registered'
                elif cancel_kind == 'document_revoke':
                    ws.send_json({'type': cancel_kind}); terminal = 'document_revoked'
                else:
                    typed(ws, 3, 'Latest question'); terminal = 'turn_complete'
                after = []
                collect(ws, after, lambda p: p['event'] == terminal)
                latest_generation = next(p['generation'] for p in after if p['event'] == 'interrupted')
                assert latest_generation > commentary['generation']
                ws.send_json({'type': 'teaching_boundary', 'sequence_id': commentary['sequence_id'],
                             'index': 0, 'heard': False, 'manual': True})
                typed(ws, 4, 'Barrier question')
                collect(ws, after, lambda p: p['event'] == 'turn_complete' and p['request_id'] == 4)
                assert not any(p['event'] in {'teaching_text', 'document_action'} and p['generation'] == latest_generation for p in after)
            else:
                # A fabricated heard receipt must not advance a text-only sequence.
                ws.send_json({'type': 'teaching_boundary', 'sequence_id': commentary['sequence_id'],
                             'index': 0, 'heard': True, 'manual': False})
                for index in range(3):
                    assert commentary['index'] == index
                    ws.send_json({'type': 'teaching_boundary', 'sequence_id': commentary['sequence_id'],
                                 'index': index, 'heard': False, 'manual': True})
                    if index < 2:
                        mark = collect(ws, trace, lambda p: p['event'] == 'document_action')
                        acknowledge_mark(ws, mark)
                        commentary = collect(ws, trace, lambda p: p['event'] == 'teaching_text')
                        assert commentary['text'] == NARRATIONS[index+1]
                done = collect(ws, trace, lambda p: p['event'] == 'teaching_finished')
                assert done['local_speech_boundaries_confirmed'] == 0 and done['manual_advances'] == 3
                collect(ws, trace, lambda p: p['event'] == 'turn_complete')
                assert 'displayed as text' in results[-1]['answer']
                assert bridge.last_session is None
            assert not any(p['event'] in {'audio','teaching_prepare'} for p in trace)
            ws.send_json({'type': 'stop'})
            with pytest.raises(WebSocketDisconnect): ws.receive_json()
    assert inspector.calls == 1
    assert sessions[0].usage['backend_responses_started'] <= 6


def test_public_text_requires_cookie_origin_and_correct_mode_before_enter(tmp_path, monkeypatch):
    bridge, _, _ = teaching_bridge(tmp_path, monkeypatch)
    use_responses(bridge, lambda _: pytest.fail('No approved question was submitted'))
    app = create_app(tmp_path, origin='http://testserver', private_qa=True, bridge_factory=lambda: bridge)
    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect('/api/native/text?permit=missing', headers={'origin': 'http://testserver'}): pass
        client.get('/api/native/status')
        token = permit(client, public=True)
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect('/api/native/text?permit='+token, headers={'origin': 'https://evil.example'}): pass
        assert token in bridge.config.permits
        assert not app.state.visitors.active and not app.state.visitors.budget.path.exists()


def test_public_text_renewal_preserves_one_adapter_request_sequence_and_reservation(tmp_path, monkeypatch):
    bridge, _, voice_sessions = teaching_bridge(tmp_path, monkeypatch)
    sessions, _ = use_responses(bridge, lambda _: httpx.Response(200, json=response()))
    app = create_app(tmp_path, origin='http://testserver', private_qa=True, bridge_factory=lambda: bridge)
    headers = {'origin': 'http://testserver'}
    with TestClient(app) as client:
        client.get('/api/native/status')
        token = permit(client, public=True)
        with client.websocket_connect('/api/native/text?carrier=renew-v1&permit='+token, headers=headers) as first:
            hello = first.receive_json()
            assert hello['event'] == 'transport_ready'
            connected = first.receive_json()
            assert connected['mode'] == 'text' and connected['transport_seq'] == 1
            typed(first, 1, 'First question')
            done = collect(first, [], lambda p: p['event'] == 'turn_complete')
            first.send_json({'type': 'transport_fence', 'after': done['transport_seq']})
            assert first.receive_json()['event'] == 'transport_fenced'
            address = '/api/native/renew?permit='+hello['ticket']+'&after='+str(done['transport_seq'])
            with client.websocket_connect(address, headers=headers) as second:
                assert second.receive_json()['event'] == 'transport_ready'
                second.send_json({'type': 'transport_ack'})
                with pytest.raises(WebSocketDisconnect): first.receive_json()
                assert client.get('/api/native/status').json()['room_active_sessions'] == 1
                typed(second, 2, 'Second question')
                done = collect(second, [], lambda p: p['event'] == 'turn_complete')
                assert done['generation'] == done['request_id'] == 2
                second.send_json({'type': 'stop'})
                with pytest.raises(WebSocketDisconnect): second.receive_json()
        async def completed():
            await asyncio.wait_for(asyncio.shield(bridge.public_channel_task), 1)
        client.portal.call(completed)
        status = client.get('/api/native/status').json()
        assert status['room_active_sessions'] == 0
        assert status['last_session']['transport']['renewals'] == 1
        assert status['last_session']['mode'] == 'text'
        assert len(sessions) == 1 and not voice_sessions
        assert sessions[0].usage['typed_requests'] == 2
        with sqlite3.connect(app.state.visitors.budget.path) as db:
            assert db.execute('select count(*) from reservations').fetchone()[0] == 1
