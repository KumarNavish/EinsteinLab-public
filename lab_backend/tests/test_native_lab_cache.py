"""Real text bridge/Responses request with dated public evidence and no network."""
import json

import httpx
from fastapi.testclient import TestClient

from lab_backend.tests.test_native_live import MockKnowledge, teaching_bridge, receive_until
from lab_backend.tests.test_native_text import use_responses
from lab_backend.tests.test_openai_text import response, message


QUESTION = 'What does the lab study?'
SOURCE = {
    'id': 'cached-lab-fixture', 'title': 'Official lab description',
    'url': 'https://mobililab.ethz.ch/', 'section': 'Description', 'epistemic': 'documented',
    'fetched_at': '2026-10-18T08:00:00+00:00', 'text_sha256': 'a' * 64,
    'excerpt': 'The lab studies human interaction with digital technology.',
    'source_kind': 'cached-official-lab', 'source_scope': 'dated-official-page-cache',
}


def test_typed_lab_question_carries_dated_cache_in_its_first_responses_request(tmp_path, monkeypatch):
    bridge, app, voice_sessions = teaching_bridge(tmp_path, monkeypatch)
    lookups, requests = [], []

    class CachedKnowledge(MockKnowledge):
        def initial_context(self):
            raise AssertionError('The factual cache must replace routing-only startup context.')

        def factual_context(self):
            return json.dumps({'source_scope': 'Dated official-page cache, not a fresh read.', 'sources': [SOURCE]})

        def factual_sources(self):
            return [dict(SOURCE)]

        def lookup_current(self, arguments):
            assert arguments == {'question': QUESTION, 'refresh': False}
            lookups.append(arguments)
            return {'freshness': 'cached-official-pages', 'network_pages_read': 0,
                    'snapshot_at': SOURCE['fetched_at'], 'sources': [dict(SOURCE)]}

        def lookup(self, _arguments):
            raise AssertionError('A second backend evidence tool must not be needed for this fixture.')

    bridge.knowledge = CachedKnowledge()

    def answer(request):
        payload = json.loads(request.content)
        requests.append(payload)
        parts = payload['input'][-1]['content']
        assert parts[-1] == {'type': 'input_text', 'text': QUESTION}
        evidence = parts[0]['text']
        assert evidence.startswith('CACHED OFFICIAL LAB EVIDENCE FOR THIS QUESTION')
        assert SOURCE['excerpt'] in evidence
        assert SOURCE['fetched_at'] in evidence and SOURCE['text_sha256'] in evidence
        assert SOURCE['url'] in evidence and SOURCE['id'] in evidence
        return httpx.Response(200, json=response([message(SOURCE['excerpt'])]))

    sessions, prompts = use_responses(bridge, answer)
    with TestClient(app) as client:
        permit = client.post('/api/native/permit', json={'text_only': True}).json()['permit']
        with client.websocket_connect('/api/native/text?permit=' + permit) as ws:
            assert ws.receive_json()['event'] == 'connected'
            ws.send_json({'type': 'text', 'request_id': 1, 'text': QUESTION})
            _done, events = receive_until(ws, lambda event: event['event'] == 'turn_complete')
            sources = next(event['sources'] for event in events if event['event'] == 'sources')
            assert sources == [SOURCE]
            hit = next(event for event in events if event['event'] == 'lab_cache_hit')
            assert hit['source_count'] == 1 and hit['freshness'] == 'cached-official-pages'
            assert hit['lookup_ms'] >= 0
            assert hit['request_id'] == 1 and hit['generation'] == 1
            assert not any(event.get('tool_call_id') == 'lookup_lab' for event in events)
            assert next(event['text'] for event in events if event['event'] == 'output_transcript') == SOURCE['excerpt']
            ws.send_json({'type': 'stop'})
    assert len(requests) == len(sessions) == len(lookups) == 1 and not voice_sessions
    assert SOURCE['excerpt'] in prompts[0] and SOURCE['fetched_at'] in prompts[0]
    assert bridge.last_session['tool_calls'] == 0
    assert sessions[0].usage['backend_responses_started'] == 1
