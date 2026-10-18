"""A public website fact must not allocate a provider session or perform HTTP."""
import pytest
from fastapi.testclient import TestClient
from lab_backend.public_service import create_app


class Facts:
    def __init__(self): self.questions = []

    def quick_answer(self, question):
        self.questions.append(question)
        if question != 'Who is the scientific director?': return None
        return {'answer': 'The scientific director is Fixture Person.', 'sources': [{
            'id': 'fixture-source', 'url': 'https://mobililab.ethz.ch/people/',
            'excerpt': 'Scientific director: Fixture Person.',
            'fetched_at': '2000-01-01T00:00:00Z'}],
            'freshness': 'cached-official-pages', 'mode': 'source-fact'}


def application(tmp_path, facts):
    def forbidden_provider_bridge():
        raise AssertionError('A cached fact must not create a provider bridge.')
    return create_app(tmp_path, origin='http://testserver', private_qa=True,
                      bridge_factory=forbidden_provider_bridge, lab_knowledge=facts)


def test_public_fact_is_complete_dated_and_has_no_visitor_or_provider_allocation(tmp_path):
    facts = Facts()
    with TestClient(application(tmp_path, facts)) as client:
        response = client.post('/api/lab/answer', headers={'origin': 'http://testserver'},
                               json={'question': 'Who is the scientific director?'})
        assert response.status_code == 200
        value = response.json()
        assert value['answer'] == 'The scientific director is Fixture Person.'
        assert value['sources'][0]['fetched_at'] == '2000-01-01T00:00:00Z'
        assert value['status'] == 'source-fact' and value['lookup_ms'] >= 0
        assert response.headers['cache-control'] == 'no-store'
        assert 'set-cookie' not in response.headers and not client.cookies
        assert client.post('/api/lab/answer', headers={'origin': 'http://testserver'},
                           json={'question': 'Compare two projects and check today.'}).json() == {'status': 'model-required'}
        assert len(facts.questions) == 2


@pytest.mark.parametrize('body', [None, [], {}, {'question': 123}, {'question': ''},
    {'question': ' '}, {'question': 'a' * 701}, {'question': 'valid', 'refresh': True}])
def test_bad_or_unbounded_question_cannot_reach_the_cache(tmp_path, body):
    facts = Facts()
    with TestClient(application(tmp_path, facts)) as client:
        assert client.post('/api/lab/answer', headers={'origin': 'http://testserver'}, json=body).status_code == 422
        assert not facts.questions


def test_fact_route_preserves_origin_and_actual_body_size_limits(tmp_path):
    facts = Facts()
    with TestClient(application(tmp_path, facts)) as client:
        assert client.post('/api/lab/answer', json={'question': 'hello'}).status_code == 403
        assert client.post('/api/lab/answer', headers={'origin': 'https://other.example'}, json={'question': 'hello'}).status_code == 403
        assert client.post('/api/lab/answer', headers={'origin': 'http://testserver'}, content=b'x' * 2600).status_code == 413
        assert not facts.questions
