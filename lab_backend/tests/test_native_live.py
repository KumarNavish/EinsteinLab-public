"""Mock-provider protocol tests. They are not proof of a real Google voice session."""
from __future__ import annotations
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
import json
from pathlib import Path
from types import SimpleNamespace
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from google.genai import types
from lab_backend.native_config import NativeConfig, MODEL
from lab_backend.native_live import NativeBridge, local_origin
from lab_backend.native_knowledge import NativeKnowledge


def proof(root: Path, **override):
    directory = root / '.work/private'
    directory.mkdir(parents=True, exist_ok=True)
    directory.chmod(0o700)
    value = {'verified_at': datetime.now(timezone.utc).isoformat(), 'billing_tier': 'Free tier',
             'billing_enabled': False, 'model': MODEL, 'existing_key_suffix': 'test'}
    value.update(override)
    (directory / 'native-free-tier.json').write_text(json.dumps(value))
    return value


def synthetic_key():
    return 'AIza' + 'x' * 31 + 'test'


def test_native_is_disabled_without_verified_project(tmp_path):
    config = NativeConfig(tmp_path)
    assert not config.status()['available']
    with pytest.raises(ValueError):
        config.issue_permit()


@pytest.mark.parametrize('override', [{'billing_enabled': True}, {'billing_tier': 'Paid tier'},
    {'model': 'unapproved-model'}, {'verified_at': (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()}])
def test_native_fails_closed_on_billing_model_or_expiry(tmp_path, override):
    proof(tmp_path, **override)
    config = NativeConfig(tmp_path)
    assert not config.status()['available']
    with pytest.raises(ValueError):
        config.store_operator_key(synthetic_key(), True)


def test_operator_key_requires_consent_and_is_private(tmp_path):
    proof(tmp_path)
    config = NativeConfig(tmp_path)
    with pytest.raises(ValueError):
        config.store_operator_key(synthetic_key(), False)
    assert not config.key_path.exists()
    config.store_operator_key(synthetic_key(), True)
    assert config.key_path.stat().st_mode & 0o777 == 0o600
    assert config.directory.stat().st_mode & 0o777 == 0o700
    assert config.credential() == synthetic_key()
    status = config.status()
    assert status['available'] and not status['provider_session_verified']
    assert synthetic_key() not in json.dumps(status)


def test_one_use_connection_permit(tmp_path):
    proof(tmp_path)
    config = NativeConfig(tmp_path)
    config.store_operator_key(synthetic_key(), True)
    permit = config.issue_permit()
    assert config.use_permit(permit) == synthetic_key()
    with pytest.raises(ValueError):
        config.use_permit(permit)


def test_teaching_cancel_acknowledges_only_the_current_session_request(tmp_path):
    bridge, app, _ = configured_bridge(tmp_path)
    with TestClient(app) as client:
        permit = client.post('/api/native/permit').json()['permit']
        with client.websocket_connect('/api/native/voice?permit=' + permit) as websocket:
            assert websocket.receive_json()['event'] == 'connected'
            websocket.send_json({'type': 'teaching_cancel', 'cancellation_id': 7})
            receipt = websocket.receive_json()
            assert receipt['event'] == 'teaching_cancelled' and receipt['cancellation_id'] == 7
            assert receipt['elapsed_ms'] >= 0
            websocket.send_json({'type': 'stop'})


@pytest.mark.parametrize('host,origin,expected', [
    ('127.0.0.1:8765', 'http://127.0.0.1:8765', True),
    ('localhost:8765', 'http://evil.test', False),
    ('attacker.test', 'http://attacker.test', False),
    ('testserver', None, True)])
def test_local_origin(host, origin, expected):
    assert local_origin(host, origin) is expected


class MockKnowledge:
    def initial_context(self): return 'A public demonstration context.'
    def declaration(self): return {'name': 'lookup_lab'}
    def lookup(self, arguments):
        return {'answer': 'The project studies role framing.', 'sources': [{'id': 'public-source', 'url': 'https://mobililab.ethz.ch/', 'title': 'Public context', 'excerpt': 'The project studies role framing.'}]}


class MockSession:
    def __init__(self):
        self.queue = asyncio.Queue()
        self.audio_packets = []
        self.tool_replies = []
    async def send_client_content(self, *, turns, turn_complete):
        await self.queue.put(types.LiveServerMessage(tool_call=types.LiveServerToolCall(function_calls=[
            types.FunctionCall(id='lookup-1', name='lookup_lab', args={'question': 'What does the project study?'})])))
    async def send_realtime_input(self, **kwargs):
        if kwargs.get('audio'):
            self.audio_packets.append(kwargs['audio'].data)
            await self.queue.put(types.LiveServerMessage(server_content=types.LiveServerContent(interrupted=True)))
    async def send_tool_response(self, *, function_responses):
        self.tool_replies.append(function_responses)
        await self.queue.put(types.LiveServerMessage(server_content=types.LiveServerContent(
            output_transcription=types.Transcription(text='It studies role framing.'),
            model_turn=types.Content(role='model', parts=[types.Part(inline_data=types.Blob(data=bytes(960), mime_type='audio/pcm;rate=24000'))]),
            turn_complete=True)))
    async def receive(self):
        response = await self.queue.get()
        yield response


def configured_bridge(tmp_path):
    proof(tmp_path)
    sessions = []
    @asynccontextmanager
    async def factory(key, system, declaration, **options):
        assert key == synthetic_key()
        assert 'PUBLIC RESEARCH CONTEXT' in system
        names = {item['name'] for item in declaration}
        assert names == {'lookup_lab', 'calculate', 'plan_work', 'deliver_note', 'sketch_mechanism', 'focus_visual', 'hide_visual', 'inspect_visual', 'show_source_passage', 'focus_source_phrase', 'read_selected_pdf_page', 'mark_selected_pdf', 'close_selected_pdf_view', 'control_selected_video', 'inspect_selected_video_frame', 'mark_selected_video_frame'}
        session = MockSession()
        sessions.append(session)
        yield session
    bridge = NativeBridge(tmp_path, MockKnowledge(), session_factory=factory)
    bridge.config.store_operator_key(synthetic_key(), True)
    app = FastAPI()
    app.include_router(bridge.router)
    return bridge, app, sessions


def test_mock_protocol_audio_evidence_interruption_and_shutdown(tmp_path):
    bridge, app, sessions = configured_bridge(tmp_path)
    with TestClient(app) as client:
        response = client.post('/api/native/permit')
        assert response.status_code == 200
        permit = response.json()['permit']
        with client.websocket_connect('/api/native/voice?permit=' + permit) as websocket:
            event = websocket.receive_json()
            assert event['event'] == 'connected'
            websocket.send_json({'type': 'text', 'text': 'Explain the project.'})
            messages = []
            while not (any(packet['event'] == 'turn_complete' for packet in messages)
                       and any(packet['event'] == 'evidence_activity' and packet['status'] == 'finished' for packet in messages)):
                messages.append(websocket.receive_json())
            assert [m['event'] for m in messages if m['event'] != 'evidence_activity'] == ['work_activity', 'sources', 'output_transcript', 'audio', 'turn_complete']
            assert [(m['tool_call_id'], m['status']) for m in messages if m['event'] == 'evidence_activity'] == [('lookup-1', 'running'), ('lookup-1', 'finished')]
            audio = next(packet for packet in messages if packet['event'] == 'audio')
            assert audio['sample_rate'] == 24000
            assert audio['lipsync_kind'] == 'audio-reactive'
            websocket.send_bytes(bytes(320))
            assert websocket.receive_json()['event'] == 'interrupted'
            websocket.send_json({'type': 'stop'})
        status = client.get('/api/native/status').json()
        assert not status['active']
        assert status['last_session']['input_audio_bytes'] == 320
        assert status['last_session']['tool_calls'] == 1
        assert status['last_session']['outcome'] == 'closed'
        assert status['last_session']['close_trigger'] == 'stop_requested'
        assert 0 <= status['last_session']['close_trigger_elapsed_ms'] <= status['last_session']['duration_seconds'] * 1000 + 10
        assert status['last_session']['browser_disconnect_code'] is None
        assert not status['last_session']['transcripts_saved']
        assert not status['last_session']['microphone_audio_saved']
        assert len(sessions) == 1 and sessions[0].tool_replies
        assert synthetic_key() not in json.dumps(status)


@pytest.mark.parametrize('failure', ['http_status', 'claim_validation', 'invalid_json',
    'research_question', 'lookup_question', 'aspect', 'titles', 'approval', 'research_budget'])
def test_failed_research_keeps_safe_http_fixture_diagnostic_through_browser_and_status(tmp_path, monkeypatch, failure):
    import httpx
    from lab_backend.flash_research import FlashResearch, safe_research_diagnostic
    from lab_backend.openai_evidence import OPENAI_MODEL

    async def blocked(*_args, **_kwargs):
        raise AssertionError('No real HTTP transport in this fixture')
    monkeypatch.setattr(httpx.AsyncHTTPTransport, 'handle_async_request', blocked)
    bridge, app, sessions = configured_bridge(tmp_path)
    bridge.knowledge.project_titles = []
    requests = []
    def receive(request):
        requests.append(request)
        if failure == 'http_status':
            return httpx.Response(429, text='PRIVATE_FIXTURE_PROVIDER_BODY')
        text = ('PRIVATE_FIXTURE_NOT_JSON' if failure == 'invalid_json' else json.dumps({'claims': [{
            'text': 'The project studies role framing.', 'kind': 'documented',
            'evidence': [{'source_id': 'public-source', 'quote': 'PRIVATE_FIXTURE_INVENTED_SOURCE_QUOTE'}]}]}))
        return httpx.Response(200, json={'status': 'completed', 'model': OPENAI_MODEL,
            'output': [{'type': 'message', 'role': 'assistant', 'status': 'completed',
                        'content': [{'type': 'output_text', 'text': text}]}]})
    bridge.researcher = FlashResearch(tmp_path, bridge.config, bridge.knowledge, provider='openai',
                                     response_transport=httpx.MockTransport(receive))
    arguments = {'question': 'What does the project study?'}
    reasons = {
        'research_question': 'Invalid research question length',
        'lookup_question': 'Invalid question length',
        'aspect': 'Unknown evidence aspect',
        'titles': 'Select at most three actual lab projects',
        'approval': 'The OpenAI funding or spending-limit approval needs an operator check.',
        'research_budget': 'The conservative daily Flash research budget is exhausted; no paid fallback is enabled.',
    }
    if failure == 'research_question': arguments['question'] = 'x'
    if failure == 'lookup_question': arguments['question'] = 'x' * 1300
    if failure == 'aspect': arguments['aspect'] = 'PRIVATE_FIXTURE_INVALID_ASPECT'
    if failure == 'titles': arguments['project_titles'] = ['PRIVATE_FIXTURE_INVALID_TITLE']
    if failure in {'lookup_question', 'aspect'}:
        bridge.knowledge.lookup = lambda value: NativeKnowledge.lookup(bridge.knowledge, value)
    if failure in {'approval', 'research_budget'}:
        def reject(): raise ValueError(reasons[failure])
        if failure == 'approval': bridge.researcher.config = SimpleNamespace(approval=reject)
        else: bridge.researcher.budget.reserve = reject
    @asynccontextmanager
    async def factory(*_args, **_kwargs):
        session = MockSession(); sessions.append(session); yield session
    bridge.session_factory = factory
    async def request_research(self, **_kwargs):
        await self.queue.put(types.LiveServerMessage(tool_call=types.LiveServerToolCall(function_calls=[
            types.FunctionCall(id='research-1', name='consult_flash', args=arguments)])))
    monkeypatch.setattr(MockSession, 'send_client_content', request_research)
    with TestClient(app) as client:
        permit = client.post('/api/native/permit').json()['permit']
        with client.websocket_connect('/api/native/voice?permit=' + permit) as websocket:
            assert websocket.receive_json()['event'] == 'connected'
            websocket.send_json({'type': 'text', 'text': 'Check the public evidence.'})
            messages = []
            while not messages or messages[-1]['event'] != 'research_complete':
                messages.append(websocket.receive_json())
            completion = messages[-1]
            assert completion['status'] == 'unavailable' and completion.get('claims', []) == []
            diagnostic = completion['diagnostic']
            if failure in reasons:
                assert diagnostic == {'error_type': 'ValueError', 'validation_reason': reasons[failure]}
            else:
                assert diagnostic['provider_attempts'] == 1 and diagnostic['elapsed_ms'] >= 0
            if failure == 'http_status':
                assert diagnostic['provider_issue'] == 'http_status' and diagnostic['code'] == 429
            elif failure == 'claim_validation':
                assert diagnostic['error_type'] == 'ValueError'
                assert diagnostic['validation_reason'] == 'Quote does not match supplied evidence'
            elif failure == 'invalid_json':
                assert diagnostic['error_type'] == 'JSONDecodeError'
            # Wait for the actual tool response to reach the mock model before Stop.
            while messages[-1]['event'] != 'output_transcript':
                messages.append(websocket.receive_json())
            tool_result = sessions[0].tool_replies[-1].response
            if failure in reasons:
                assert tool_result['status'] == 'unavailable'
                assert tool_result['answer'] == 'The evidence request was rejected: ' + reasons[failure]
                assert tool_result['diagnostic'] == diagnostic
            websocket.send_json({'type': 'stop'})
        status = client.get('/api/native/status').json()
    assert not status['active'] and bridge.researcher.successes == 0
    last = status['research']['last_request']
    if failure in reasons:
        assert last['phase'] == 'pre_generation' and last['provider_attempts'] == 0
        assert last['validation_reason'] == reasons[failure] and last['elapsed_ms'] >= 0
        assert not bridge.researcher.budget.path.exists()
    else:
        assert safe_research_diagnostic(last) == diagnostic
        assert json.loads(bridge.researcher.budget.path.read_text())['flash_requests'] == 1
    assert status['research']['last_request']['status'] == 'unavailable'
    assert len(requests) == (0 if failure in reasons else 1) and len(sessions) == 1
    assert 'PRIVATE_FIXTURE' not in json.dumps({'events': messages, 'status': status, 'tool_result': tool_result})


def teaching_bridge(tmp_path, monkeypatch, *, invalid_source=False, queued_second=False):
    """Actual continuous NativeBridge dispatch with a network-forbidden provider."""
    import hashlib
    import socket
    from lab_backend.openai_config import OpenAIDeploymentConfig
    from lab_backend.openai_live import envelope

    key = 'sk-proj-synthetic_teaching_fixture_credential'
    now = datetime.now(timezone.utc)
    monkeypatch.setenv('OPENAI_API_KEY', key)
    monkeypatch.setenv('EINSTEIN_OPENAI_APPROVAL', json.dumps({
        'model': 'gpt-live-1', 'project_id': 'proj_SyntheticTeachingFixture',
        'external_processing_approved': True, 'hard_limit_enforced': True,
        'automatic_reload': False, 'model_access_verified': True,
        'monthly_limit_usd': 75, 'confirmed_credit_usd': 100,
        'budget_period': now.strftime('%Y-%m'),
        'verified_at': (now - timedelta(minutes=1)).isoformat(),
        'expires_at': (now + timedelta(hours=1)).isoformat(),
        'key_sha256': hashlib.sha256(key.encode()).hexdigest(),
    }))

    def forbidden(*_args, **_kwargs):
        raise AssertionError('A teaching fixture attempted an external connection')

    monkeypatch.setattr(socket, 'create_connection', forbidden)
    monkeypatch.setattr(socket.socket, 'connect', forbidden)
    sessions = []

    class Session:
        def __init__(self):
            self.queue = asyncio.Queue()
            self.spoken, self.results, self.inputs = [], [], []

        async def transcript(self, text):
            await self.queue.put(envelope(content={'output_transcription': SimpleNamespace(text=text)}))

        async def send_client_content(self, *, turns, **_options):
            text = turns['parts'][0]['text']
            self.inputs.append(text)
            if text == 'Inspect the source.':
                name, arguments = 'lookup_lab', {'question': 'What does the project study?'}
            elif text == 'Teach the inspected process.':
                name, arguments = 'teach_mechanism', {
                    'title': 'The inspected role-framing process',
                    'nodes': [
                        {'id': 'framing', 'label': 'Role framing', 'x': .2, 'y': .4},
                        {'id': 'question', 'label': 'Study question', 'x': .7, 'y': .4},
                    ],
                    'edges': [{'from': 'framing', 'to': 'question', 'kind': 'information'}],
                    'source_ids': ['invented-source' if invalid_source else 'public-source'],
                    'steps': [
                        'Role framing is the topic named in the inspected source.',
                        'The study question follows from role framing; this sketch adds no outcome claim.',
                    ],
                }
            else:
                await self.transcript('Latest typed request accepted.')
                return
            calls = [SimpleNamespace(id=name + '-fixture', name=name, args=arguments)]
            if queued_second and name == 'teach_mechanism':
                calls.append(SimpleNamespace(id=name + '-queued-fixture', name=name, args=arguments))
            await self.queue.put(envelope(calls=calls))

        async def send_tool_response(self, *, function_responses):
            self.results.append(function_responses)
            await self.transcript('Tool result received: ' + function_responses.name)

        async def speak_teaching_step(self, narration):
            self.spoken.append(narration)
            await self.transcript(narration)

        async def send_realtime_input(self, **_options):
            # A queue barrier proves the browser loop processed preceding packets.
            await self.transcript('Offline input barrier.')

        async def receive(self):
            # An unexpected missing event fails this fixture promptly, without
            # leaving a TestClient blocked behind the production 600-second cap.
            yield await asyncio.wait_for(self.queue.get(), 3)

    @asynccontextmanager
    async def factory(actual_key, _system, declarations, **_options):
        assert actual_key == key
        assert 'teach_mechanism' in {item['name'] for item in declarations}
        session = Session()
        sessions.append(session)
        yield session

    bridge = NativeBridge(tmp_path, MockKnowledge(), session_factory=factory,
                          config=OpenAIDeploymentConfig(tmp_path))
    app = FastAPI()
    app.include_router(bridge.router)
    return bridge, app, sessions


def receive_until(websocket, predicate, *, ready_browser=True):
    packets = []
    while True:
        packet = websocket.receive_json()
        packets.append(packet)
        if ready_browser and packet['event'] == 'teaching_prepare':
            # Synthetic browser fixture, not a physical playback receipt.
            websocket.send_json({'type': 'teaching_ready', 'sequence_id': packet['sequence_id'],
                                 'ready': True, 'rendered_quiet_ms': 1000, 'audio_playing': False})
        assert packet['event'] not in {'error', 'notice'}, packet
        if predicate(packet):
            return packet, packets


def confirm_teaching_view(websocket, diagram):
    action = diagram['action']
    assert action['kind'] == 'diagram'
    count = len(action['graph']['nodes']) + len(action['graph']['edges'])
    websocket.send_json({'type': 'presentation_result', 'action_id': action['action_id'],
        'generation': diagram['generation'], 'revision': action['revision'],
        'status': 'displayed', 'rendered_elements': count})
    focus, packets = receive_until(websocket, lambda packet: packet['event'] == 'presentation_action')
    assert focus['action']['kind'] == 'focus'
    assert not any(packet['event'] in {'teaching_step', 'output_transcript'} for packet in packets)
    websocket.send_json({'type': 'presentation_result', 'action_id': focus['action']['action_id'],
        'generation': focus['generation'], 'revision': focus['action']['revision'],
        'status': 'focused', 'rendered_elements': count})
    step, packets = receive_until(websocket, lambda packet: packet['event'] == 'teaching_step')
    assert not any(packet['event'] == 'output_transcript' for packet in packets)
    spoken, _ = receive_until(websocket, lambda packet: packet['event'] == 'output_transcript')
    assert spoken['text'] == step['narration']
    return step


@pytest.mark.parametrize('cancelled', [False, True])
def test_continuous_bridge_develops_only_acknowledged_and_narrated_teaching_stages(tmp_path, monkeypatch, cancelled):
    bridge, app, sessions = teaching_bridge(tmp_path, monkeypatch)
    with TestClient(app) as client:
        permit = client.post('/api/native/permit').json()['permit']
        with client.websocket_connect('/api/native/voice?permit=' + permit) as websocket:
            assert websocket.receive_json()['event'] == 'connected'
            websocket.send_json({'type': 'text', 'text': 'Inspect the source.'})
            receive_until(websocket, lambda packet: packet.get('text') == 'Tool result received: lookup_lab')
            websocket.send_json({'type': 'text', 'text': 'Teach the inspected process.'})
            started, packets = receive_until(websocket, lambda packet: packet['event'] == 'teaching_started')
            assert started['source_ids'] == ['public-source'] and started['count'] == 2
            first, _ = receive_until(websocket, lambda packet: packet['event'] == 'presentation_action')
            assert [node['id'] for node in first['action']['graph']['nodes']] == ['framing']
            assert first['action']['graph']['edges'] == []
            assert sessions[0].spoken == []
            step = confirm_teaching_view(websocket, first)
            assert step['index'] == 0 and len(sessions[0].spoken) == 1

            # Wrong sequence, wrong index and a bare silence receipt cannot move
            # on. The barrier is acknowledged by the same receive-browser loop.
            for changes in ({'sequence_id': 'stale-sequence'}, {'index': 1}, {'heard': False}):
                websocket.send_json({'type': 'teaching_boundary', 'sequence_id': step['sequence_id'],
                                     'index': 0, 'heard': True, **changes})
            websocket.send_json({'type': 'audio_end'})
            _, packets = receive_until(websocket, lambda packet: packet.get('text') == 'Offline input barrier.')
            assert not any(packet['event'] in {'presentation_action', 'teaching_step'} for packet in packets)
            assert len(sessions[0].spoken) == 1

            if cancelled:
                websocket.send_json({'type': 'text', 'text': 'Stop that explanation and discuss my new question.'})
                # Even an otherwise matched old receipt cannot undo cancellation.
                websocket.send_json({'type': 'teaching_boundary', 'sequence_id': step['sequence_id'],
                                     'index': 0, 'heard': True})
                completed = []
                while not (any(packet['event'] == 'teaching_finished' for packet in completed)
                           and any(packet.get('text') == 'Tool result received: teach_mechanism' for packet in completed)
                           and any(packet.get('text') == 'Latest typed request accepted.' for packet in completed)):
                    packet = websocket.receive_json()
                    assert packet['event'] not in {'error', 'notice', 'presentation_action', 'teaching_step'}
                    completed.append(packet)
                assert next(packet for packet in completed if packet['event'] == 'teaching_finished')['status'] == 'paused'
                assert len(sessions[0].spoken) == 1
                assert sessions[0].inputs[-1] == 'Stop that explanation and discuss my new question.'
            else:
                websocket.send_json({'type': 'teaching_boundary', 'sequence_id': step['sequence_id'],
                                     'index': 0, 'heard': True})
                second, _ = receive_until(websocket, lambda packet: packet['event'] == 'presentation_action')
                assert [node['id'] for node in second['action']['graph']['nodes']] == ['framing', 'question']
                assert len(second['action']['graph']['edges']) == 1
                assert len(sessions[0].spoken) == 1
                current = confirm_teaching_view(websocket, second)
                assert current['index'] == 1 and len(sessions[0].spoken) == 2
                websocket.send_json({'type': 'teaching_boundary', 'sequence_id': step['sequence_id'],
                                     'index': 0, 'heard': True})
                websocket.send_json({'type': 'audio_end'})
                _, packets = receive_until(websocket, lambda packet: packet.get('text') == 'Offline input barrier.')
                assert not any(packet['event'] == 'teaching_finished' for packet in packets)
                websocket.send_json({'type': 'teaching_boundary', 'sequence_id': current['sequence_id'],
                                     'index': 1, 'heard': True})
                finished, _ = receive_until(websocket, lambda packet: packet['event'] == 'teaching_finished')
                assert finished['status'] == 'presented-progressively'
                assert finished['local_speech_boundaries_confirmed'] == 2
                receive_until(websocket, lambda packet: packet.get('text') == 'Tool result received: teach_mechanism')
            websocket.send_json({'type': 'stop'})
        status = client.get('/api/native/status').json()
    assert not status['active'] and status['last_session']['outcome'] == 'closed'
    assert status['last_session']['stale_teaching_receipts'] >= 4
    result = sessions[0].results[-1].response
    assert result['status'] == ('paused' if cancelled else 'presented-progressively')
    assert result['rendered_steps'] == (1 if cancelled else 2)


def test_continuous_bridge_rejects_uncited_sources_before_starting_teaching(tmp_path, monkeypatch):
    bridge, app, sessions = teaching_bridge(tmp_path, monkeypatch, invalid_source=True)
    with TestClient(app) as client:
        permit = client.post('/api/native/permit').json()['permit']
        with client.websocket_connect('/api/native/voice?permit=' + permit) as websocket:
            assert websocket.receive_json()['event'] == 'connected'
            websocket.send_json({'type': 'text', 'text': 'Inspect the source.'})
            receive_until(websocket, lambda packet: packet.get('text') == 'Tool result received: lookup_lab')
            websocket.send_json({'type': 'text', 'text': 'Teach the inspected process.'})
            _, packets = receive_until(websocket, lambda packet: packet.get('text') == 'Tool result received: teach_mechanism')
            assert not any(packet['event'].startswith('teaching_') or packet['event'] == 'presentation_action' for packet in packets)
            assert sessions[0].spoken == []
            assert sessions[0].results[-1].response['status'] == 'unavailable'
            websocket.send_json({'type': 'stop'})
        status = client.get('/api/native/status').json()
    assert not status['active'] and status['last_session']['visual_proposals'] == 0


def test_typed_cancellation_also_retires_old_teaching_waiting_for_the_visual_lock(tmp_path, monkeypatch):
    bridge, app, sessions = teaching_bridge(tmp_path, monkeypatch, queued_second=True)
    with TestClient(app) as client:
        permit = client.post('/api/native/permit').json()['permit']
        with client.websocket_connect('/api/native/voice?permit=' + permit) as websocket:
            assert websocket.receive_json()['event'] == 'connected'
            websocket.send_json({'type': 'text', 'text': 'Inspect the source.'})
            receive_until(websocket, lambda packet: packet.get('text') == 'Tool result received: lookup_lab')
            websocket.send_json({'type': 'text', 'text': 'Teach the inspected process.'})
            receive_until(websocket, lambda packet: packet['event'] == 'teaching_started')
            first, _ = receive_until(websocket, lambda packet: packet['event'] == 'presentation_action')
            confirm_teaching_view(websocket, first)
            websocket.send_json({'type': 'text', 'text': 'Stop that explanation and discuss my new question.'})
            returned = 0
            while returned < 2:
                packet = websocket.receive_json()
                assert packet['event'] not in {'teaching_started', 'teaching_step', 'presentation_action', 'error', 'notice'}
                returned += int(packet.get('text') == 'Tool result received: teach_mechanism')
            assert len(sessions[0].spoken) == 1
            assert all(result.response['status'] in {'paused', 'superseded'}
                       for result in sessions[0].results if result.name == 'teach_mechanism')
            websocket.send_json({'type': 'stop'})
        status = client.get('/api/native/status').json()
    assert not status['active'] and status['last_session']['outcome'] == 'closed'


@pytest.mark.parametrize('code', [1000, 1001, 1006, 4001, True, '1001', 999, 5000])
def test_normal_asgi_disconnect_is_classified_without_retaining_reason(tmp_path, code):
    bridge, app, _ = configured_bridge(tmp_path)
    with TestClient(app) as client:
        permit = client.post('/api/native/permit').json()['permit']
        with client.websocket_connect('/api/native/voice?permit=' + permit) as websocket:
            assert websocket.receive_json()['event'] == 'connected'
            websocket.close(code=code, reason='private-disconnect-detail')
        status = client.get('/api/native/status').json()
        receipt = status['last_session']
        assert not status['active']
        assert receipt['outcome'] == 'client_disconnected'
        assert receipt['close_trigger'] == 'browser_disconnected'
        assert receipt['browser_disconnect_code'] == (code if type(code) is int and 1000 <= code <= 4999 else None)
        assert 0 <= receipt['close_trigger_elapsed_ms'] <= receipt['duration_seconds'] * 1000 + 10
        assert 'private-disconnect-detail' not in json.dumps(status)


def test_provider_closure_is_the_first_trigger_before_browser_cleanup(tmp_path, monkeypatch):
    async def closed(self, **kwargs):
        await self.queue.put(SimpleNamespace(server_content=None, tool_call=None,
            tool_call_cancellation=None, go_away=SimpleNamespace(reason='session_closed')))
    monkeypatch.setattr(MockSession, 'send_client_content', closed)
    bridge, app, _ = configured_bridge(tmp_path)
    with TestClient(app) as client:
        permit = client.post('/api/native/permit').json()['permit']
        with client.websocket_connect('/api/native/voice?permit=' + permit) as websocket:
            assert websocket.receive_json()['event'] == 'connected'
            websocket.send_json({'type': 'text', 'text': 'Offline closure fixture.'})
            assert websocket.receive_json()['event'] == 'notice'
        receipt = client.get('/api/native/status').json()['last_session']
        assert receipt['outcome'] == 'closed'
        assert receipt['close_trigger'] == 'provider_closed'
        assert receipt['browser_disconnect_code'] is None


def test_config_errors_never_echo_key(tmp_path):
    bridge, app, _ = configured_bridge(tmp_path)
    with TestClient(app) as client:
        response = client.post('/api/native/configure', json={'api_key': synthetic_key(), 'external_processing_approved': False})
        assert response.status_code == 400
        assert synthetic_key() not in response.text
        denied = client.post('/api/native/configure', json={'api_key': synthetic_key(), 'external_processing_approved': True}, headers={'Origin': 'https://evil.test'})
        assert denied.status_code == 403


def test_failed_page_inspection_keeps_safe_diagnostics_in_visitor_session(tmp_path, monkeypatch):
    from lab_backend.page_vision import PageInspector
    from .test_local_documents import read_receipt
    diagnostic = {'error_type': 'TimeoutError', 'phase': 'provider_request',
                  'provider_code': None, 'seconds': 25.0}

    async def unavailable(*args):
        return {'status': 'unavailable', 'model': 'offline-vision-fixture',
                'reason': 'Private SDK message must not reach status or failure events', **diagnostic}

    monkeypatch.setattr(PageInspector, 'inspect', unavailable)

    class DocumentSession(MockSession):
        async def send_client_content(self, *, turns, turn_complete):
            if turn_complete:
                await self.queue.put(types.LiveServerMessage(tool_call=types.LiveServerToolCall(
                    function_calls=[types.FunctionCall(id='read-1', name='read_selected_pdf_page', args={'page': 1})])))

    proof(tmp_path)
    @asynccontextmanager
    async def factory(*args, **kwargs):
        yield DocumentSession()
    bridge = NativeBridge(tmp_path, MockKnowledge(), session_factory=factory)
    bridge.config.store_operator_key(synthetic_key(), True)
    app = FastAPI(); app.include_router(bridge.router)
    with TestClient(app) as client:
        permit = client.post('/api/native/permit').json()['permit']
        with client.websocket_connect('/api/native/voice?permit=' + permit) as websocket:
            assert websocket.receive_json()['event'] == 'connected'
            websocket.send_json({'type': 'document_offer', 'document': {
                'id': 'a' * 64, 'name': 'synthetic.pdf', 'pages': 1, 'bytes': 1800,
                'kind': 'visitor-selected-pdf', 'approved': True}})
            assert websocket.receive_json()['event'] == 'document_registered'
            websocket.send_json({'type': 'text', 'text': 'Read the selected page.'})
            for _ in range(10):
                event = websocket.receive_json()
                if event['event'] == 'document_action':
                    websocket.send_json({'type': 'document_result', 'generation': event['generation'],
                                         **read_receipt(event['action'])})
                if event['event'] == 'document_inspection_failed':
                    assert event['diagnostic'] == diagnostic
                    assert 'Private SDK' not in json.dumps(event)
                    break
            else:
                pytest.fail('No inspection-failure event was delivered')
            websocket.send_json({'type': 'stop'})
        status = client.get('/api/native/status').json()
        assert status['last_session']['last_document_inspection_failure'] == diagnostic
        assert 'Private SDK' not in json.dumps(status)
        assert synthetic_key() not in json.dumps(status)


def test_provider_exception_does_not_leak_credential(tmp_path):
    proof(tmp_path)
    @asynccontextmanager
    async def failing(key, system, declaration, **options):
        raise RuntimeError('A provider URL might contain ' + key)
        yield None
    bridge = NativeBridge(tmp_path, MockKnowledge(), session_factory=failing)
    bridge.config.store_operator_key(synthetic_key(), True)
    app = FastAPI(); app.include_router(bridge.router)
    with TestClient(app) as client:
        permit = client.post('/api/native/permit').json()['permit']
        with client.websocket_connect('/api/native/voice?permit=' + permit) as websocket:
            event = websocket.receive_json()
            assert event['event'] == 'error'
            assert synthetic_key() not in json.dumps(event)
        assert not bridge.config.provider_verified


def test_pdf_regions_and_failed_annotation_have_bounded_safe_browser_diagnostics(tmp_path, monkeypatch):
    from lab_backend.page_vision import PageInspector
    from .test_local_documents import read_receipt
    async def inspected(self, image, text, crop):
        return {'status': 'source-image-inspected', 'model': 'offline-vision-fixture',
                'seconds': .01, 'regions': [{'label': 'Inspected component', 'region': [.61, .28, .1, .03]}]}
    monkeypatch.setattr(PageInspector, 'inspect', inspected)

    class DocumentSession(MockSession):
        async def send_client_content(self, *, turns, turn_complete):
            if not turn_complete: return
            text = turns['parts'][0]['text']
            name, arguments = ('read_selected_pdf_page', {'page': 2, 'region': [.54, .24, .38, .22]}) if text == 'Read' else (
                'mark_selected_pdf', {'page': 2, 'marks': [{'kind': 'box', 'region_id': synthetic_key()}]})
            await self.queue.put(types.LiveServerMessage(tool_call=types.LiveServerToolCall(
                function_calls=[types.FunctionCall(id='document-fixture', name=name, args=arguments)])))

    proof(tmp_path)
    @asynccontextmanager
    async def factory(*args, **kwargs): yield DocumentSession()
    bridge = NativeBridge(tmp_path, MockKnowledge(), session_factory=factory)
    bridge.config.store_operator_key(synthetic_key(), True)
    app = FastAPI(); app.include_router(bridge.router)
    with TestClient(app) as client:
        permit = client.post('/api/native/permit').json()['permit']
        with client.websocket_connect('/api/native/voice?permit=' + permit) as websocket:
            assert websocket.receive_json()['event'] == 'connected'
            websocket.send_json({'type': 'document_offer', 'document': {
                'id': 'a' * 64, 'name': 'synthetic.pdf', 'pages': 2, 'bytes': 1800,
                'kind': 'visitor-selected-pdf', 'approved': True}})
            assert websocket.receive_json()['event'] == 'document_registered'
            websocket.send_json({'type': 'text', 'text': 'Read'})
            inspected_event = None
            for _ in range(12):
                event = websocket.receive_json()
                if event['event'] == 'document_action':
                    websocket.send_json({'type': 'document_result', 'generation': event['generation'], **read_receipt(event['action'])})
                if event['event'] == 'document_inspected': inspected_event = event
                if event['event'] == 'turn_complete': break
            assert inspected_event['regions'][0]['region'] == [.61, .28, .1, .03]
            assert inspected_event['regions'][0]['id'].startswith('p2-')
            websocket.send_json({'type': 'text', 'text': 'Mark'})
            failure = None
            for _ in range(8):
                event = websocket.receive_json()
                assert event['event'] != 'document_action'
                assert synthetic_key() not in json.dumps(event)
                if event['event'] == 'document_action_failed': failure = event
                if event['event'] == 'turn_complete': break
            assert failure['diagnostic']['tool'] == 'mark_selected_pdf'
            assert failure['diagnostic']['code'] == 'region-id-not-on-page'
            assert failure['diagnostic']['marks'][0]['region_id_known'] is False
            websocket.send_json({'type': 'stop'})
        status = client.get('/api/native/status').json()
        assert status['last_session']['last_document_action_failure'] == failure['diagnostic']
        assert synthetic_key() not in json.dumps(status)


def test_sdk_configuration_and_readonly_tool_contract():
    config = types.LiveConnectConfig(response_modalities=['AUDIO'], speech_config={'voice_config': {'prebuilt_voice_config': {'voice_name': 'Gacrux'}}}, input_audio_transcription={}, output_audio_transcription={}, realtime_input_config={'automatic_activity_detection': {'silence_duration_ms': 450, 'prefix_padding_ms': 200}})
    assert config.speech_config.voice_config.prebuilt_voice_config.voice_name == 'Gacrux'
    assert config.tools is None


def test_current_auth_key_format_is_accepted_without_echo(tmp_path):
    from lab_backend.native_config import valid_provider_key
    proof(tmp_path)
    key = "AQ." + "q" * 46 + "test"
    assert valid_provider_key(key)
    config = NativeConfig(tmp_path)
    config.store_operator_key(key, True)
    assert config.credential() == key
    assert key not in json.dumps(config.status())
    assert not valid_provider_key("AQ.invalid")
    assert not valid_provider_key("AQ." + "q" * 45 + "\nInjected")


def test_optional_research_uses_the_configured_provider_without_credential_discovery(tmp_path):
    from lab_backend.openai_public_research import OpenAIPublicResearch
    from lab_backend.public_research import PublicResearch
    def unapproved():
        raise AssertionError('No credential may be read during construction or status')
    for provider, expected in [('OpenAI', OpenAIPublicResearch), ('Google Gemini', PublicResearch)]:
        config = SimpleNamespace(provider=provider, credential=unapproved)
        bridge = NativeBridge(tmp_path, MockKnowledge(), config=config)
        assert isinstance(bridge.public_research, expected)
        assert bridge.public_research.status()['content_verified_this_process'] is False


@pytest.mark.parametrize('provider', ['OpenAI', 'Google Gemini'])
@pytest.mark.parametrize('enabled', [True, False])
def test_backend_public_research_policy_matches_actual_processor_and_consent(tmp_path, provider, enabled):
    proof(tmp_path)
    config = NativeConfig(tmp_path)
    config.store_operator_key(synthetic_key(), True)
    config.provider = provider
    systems = []
    @asynccontextmanager
    async def factory(key, system, declarations, **options):
        systems.append(system)
        names = {item['name'] for item in declarations}
        assert ('search_public' in names and 'read_public' in names) is enabled
        yield MockSession()
    bridge = NativeBridge(tmp_path, MockKnowledge(), config=config, session_factory=factory)
    app = FastAPI()
    app.include_router(bridge.router)
    with TestClient(app) as client:
        permit = client.post('/api/native/permit', json={'public_web': enabled}).json()['permit']
        with client.websocket_connect('/api/native/voice?permit=' + permit) as websocket:
            assert websocket.receive_json()['event'] == 'connected'
            websocket.send_json({'type': 'stop'})
    assert len(systems) == 1
    system = systems[0]
    if provider == 'OpenAI':
        assert 'funded OpenAI Responses web search' in system
        assert 'provider-grounded summary, not a verbatim' in system
        assert 'Exa' not in system
    else:
        assert 'keyless Exa' in system
        assert 'funded OpenAI' not in system
    assert ('Public web tools are enabled for this session' in system) is enabled
    assert ('Public web research is not enabled in this session' in system) is not enabled


def test_new_question_cancels_preparation_and_late_ready_cannot_draw_or_speak(tmp_path, monkeypatch):
    bridge, app, sessions = teaching_bridge(tmp_path, monkeypatch)
    with TestClient(app) as client:
        permit = client.post('/api/native/permit').json()['permit']
        with client.websocket_connect('/api/native/voice?permit=' + permit) as ws:
            assert ws.receive_json()['event'] == 'connected'
            ws.send_json({'type': 'text', 'text': 'Inspect the source.'})
            receive_until(ws, lambda p: p.get('text') == 'Tool result received: lookup_lab')
            ws.send_json({'type': 'text', 'text': 'Teach the inspected process.'})
            prep, before = receive_until(ws, lambda p: p['event'] == 'teaching_prepare', ready_browser=False)
            assert not sessions[0].spoken
            assert not any(p['event'] in {'teaching_started', 'presentation_action', 'teaching_step'} for p in before)
            ws.send_json({'type': 'text', 'text': 'A new question instead.'})
            _, cancelled = receive_until(ws, lambda p: p.get('text') == 'Latest typed request accepted.', ready_browser=False)
            ws.send_json({'type': 'teaching_ready', 'sequence_id': prep['sequence_id'],
                          'ready': True, 'rendered_quiet_ms': 1000, 'audio_playing': False})
            ws.send_json({'type': 'text', 'text': 'Still the new question.'})
            _, later = receive_until(ws, lambda p: p.get('text') == 'Latest typed request accepted.', ready_browser=False)
            assert not sessions[0].spoken
            assert not any(p['event'] in {'teaching_started', 'presentation_action', 'teaching_step'} for p in cancelled + later)
            ws.send_json({'type': 'end'})
