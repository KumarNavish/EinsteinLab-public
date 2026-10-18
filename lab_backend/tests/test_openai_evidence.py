"""Offline HTTP fixtures only: no keys, sockets, provider or billing request."""
import asyncio
import base64
import hashlib
import json
import httpx
import pytest
from lab_backend.openai_evidence import OPENAI_MODEL, EvidenceRequestError, responses_json, MAX_RESPONSE_BYTES
from lab_backend.page_vision import PageInspector, MODEL, SCHEMA
from lab_backend.flash_research import FlashResearch, FLASH_MODEL, safe_research_diagnostic

IMAGE = {'data': base64.b64encode(b'disclosed synthetic JPEG transport fixture').decode(), 'mime_type': 'image/jpeg'}
OBSERVATION = {'summary': 'A labelled circle.', 'visible_text': ['SOURCE CIRCLE'],
               'regions': [{'label': 'SOURCE CIRCLE', 'box': [.2, .3, .4, .2]}], 'uncertainty': ''}
SOURCE = {'id': 'lab-1', 'title': 'Project', 'url': 'https://mobililab.ethz.ch/research/example',
          'excerpt': 'We expect that personalized scenes will improve relaxation. The project is ongoing.'}
CLAIM = {'claims': [{'text': 'The project expects improved relaxation.', 'kind': 'anticipated',
                    'evidence': [{'source_id': 'lab-1', 'quote': 'We expect that personalized scenes will improve relaxation.'}]}]}


class Config:
    def approval(self): return {'approved': True}
    def credential(self): return 'offline-fixture-key'


class Knowledge:
    project_titles = ['Project']
    def lookup(self, _): return {'sources': [SOURCE]}


def envelope(value, **changes):
    return {'status': 'completed', 'model': OPENAI_MODEL,
            'output': [{'type': 'reasoning', 'summary': []}, {'type': 'message', 'role': 'assistant', 'status': 'completed',
                        'content': [{'type': 'output_text', 'text': json.dumps(value)}]}],
            'usage': {'input_tokens': 80, 'output_tokens': 30, 'total_tokens': 110,
                      'input_tokens_details': {'cached_tokens': 0}, 'output_tokens_details': {'reasoning_tokens': 10}}, **changes}


@pytest.fixture(autouse=True)
def forbid_real_http(monkeypatch):
    async def blocked(*_args, **_kwargs): raise AssertionError('No real HTTP transport in these fixtures')
    monkeypatch.setattr(httpx.AsyncHTTPTransport, 'handle_async_request', blocked)


def test_default_google_route_and_explicit_model_attributes_are_preserved(tmp_path):
    assert PageInspector(lambda: '').model == MODEL
    assert FlashResearch(tmp_path, Config(), Knowledge()).model == FLASH_MODEL
    assert PageInspector(lambda: '', provider='openai').model == OPENAI_MODEL
    for constructor in [lambda: PageInspector(lambda: '', provider='other'),
                        lambda: FlashResearch(tmp_path, Config(), Knowledge(), provider='other')]:
        with pytest.raises(ValueError): constructor()
    for model in ['', False, [], 'gpt-6.1-sol\nprivate', 'https://other-provider.invalid/model']:
        with pytest.raises(ValueError): PageInspector(lambda: '', provider='openai', model=model)
        with pytest.raises(ValueError): FlashResearch(tmp_path, Config(), Knowledge(), provider='openai', model=model)


def test_actual_source_bytes_strict_schema_coordinates_cache_and_budget_stay_bound():
    requests = []
    def receive(request):
        assert str(request.url) == 'https://api.openai.com/v1/responses'
        assert request.headers['authorization'] == 'Bearer offline-fixture-key'
        body = json.loads(request.content); requests.append(body)
        assert body['model'] == OPENAI_MODEL and body['store'] is False
        assert body['tools'] == [] and body['tool_choice'] == 'none' and body['service_tier'] == 'default'
        assert body['reasoning'] == {'effort': 'low'} and body['max_output_tokens'] == 2400
        fmt = body['text']['format']; assert fmt['strict'] is True
        assert fmt['schema']['additionalProperties'] is False
        assert fmt['schema']['properties']['regions']['items']['additionalProperties'] is False
        image = body['input'][0]['content'][1]
        assert image['image_url'] == 'data:image/jpeg;base64,' + IMAGE['data']
        assert image['detail'] == 'high' and 'untrusted data' in body['instructions']
        return httpx.Response(200, json=envelope(OBSERVATION, model=OPENAI_MODEL+'-2026-10-01'))
    inspector = PageInspector(Config().credential, provider='openai', limit=1, response_transport=httpx.MockTransport(receive))
    async def run():
        first = await inspector.inspect(IMAGE, 'SOURCE CIRCLE', [.1, .2, .5, .4])
        assert first['status'] == 'source-image-inspected' and first['regions'][0]['region'] == [.2, .32, .2, .08]
        assert first['image_sha256'] == hashlib.sha256(base64.b64decode(IMAGE['data'])).hexdigest()
        assert first['model'] == OPENAI_MODEL+'-2026-10-01' and first['provider'] == 'openai'
        assert 'Flash' not in first['scope'] and first['usage']['output_tokens_details']['reasoning_tokens'] == 10
        assert (await inspector.inspect(IMAGE, 'SOURCE CIRCLE', [.1, .2, .5, .4]))['cache_hit']
        assert (await inspector.inspect(IMAGE, '', [0, 0, 1, 1]))['status'] == 'unavailable'
        inspector.clear(); assert not inspector.cache
    asyncio.run(run()); assert len(requests) == 1 and inspector.calls == 1
    assert 'additionalProperties' not in SCHEMA  # OpenAI strict conversion did not mutate Google schema.


def test_openai_image_validation_failure_cannot_create_a_region():
    invalid = {**OBSERVATION, 'regions': [{'label': 'guessed', 'box': [0, 0, 2, 1]}]}
    inspector = PageInspector(Config().credential, provider='openai', response_transport=httpx.MockTransport(lambda _: httpx.Response(200, json=envelope(invalid))))
    result = asyncio.run(inspector.inspect(IMAGE, '', [0, 0, 1, 1]))
    assert result['status'] == 'unavailable' and result['phase'] == 'coordinate_validation'
    assert not inspector.cache and 'regions' not in result


@pytest.mark.parametrize('status', [302, 400, 401, 429, 503])
def test_openai_errors_never_retry_redirect_fallback_or_expose_upstream_body(tmp_path, status):
    requests = []
    def receive(request):
        requests.append(str(request.url))
        return httpx.Response(status, headers={'location': 'https://generativelanguage.googleapis.com/'}, text='SENSITIVE_FIXTURE_UPSTREAM_BODY')
    research = FlashResearch(tmp_path, Config(), Knowledge(), provider='openai', response_transport=httpx.MockTransport(receive))
    result = asyncio.run(research.answer({'question': 'What does Project expect?'}))
    assert result['status'] == 'unavailable' and result['model'] == OPENAI_MODEL
    assert result['diagnostic']['code'] == status and result['diagnostic']['provider_issue'] == 'http_status'
    assert len(requests) == 1 and all(url.startswith('https://api.openai.com/') for url in requests)
    assert 'SENSITIVE_FIXTURE' not in json.dumps(result)
    assert json.loads(research.budget.path.read_text())['flash_requests'] == 1


def test_openai_synthesis_keeps_source_ids_exact_quotes_and_actual_model_metadata(tmp_path):
    requests = []
    def receive(request):
        body = json.loads(request.content); requests.append(body)
        assert body['max_output_tokens'] == 1800 and body['text']['format']['name'] == 'evidence_claims'
        supplied = json.loads(body['input'][0]['content'][0]['text'])
        assert supplied['DOCUMENTS'][0]['id'] == SOURCE['id'] and supplied['DOCUMENTS'][0]['excerpt'] == SOURCE['excerpt']
        return httpx.Response(200, json=envelope(CLAIM))
    research = FlashResearch(tmp_path, Config(), Knowledge(), provider='openai', response_transport=httpx.MockTransport(receive))
    async def run():
        first = await research.answer({'question': 'What does Project expect?'})
        assert first['status'] == 'source-bound' and first['sources'] == [SOURCE]
        assert first['model'] == OPENAI_MODEL and first['provider'] == 'openai' and first['provider_attempts'] == 1
        assert first['spoken_answer'] == first['answer'] and first['claims'] == CLAIM['claims']
        assert (await research.answer({'question': 'What does Project expect?'}))['cached']
    asyncio.run(run()); assert len(requests) == 1
    assert research.status()['search_provider'] == 'none-supplied-public-evidence-only'
    assert research.declaration()['name'] == 'consult_flash' and OPENAI_MODEL in research.declaration()['description']


@pytest.mark.parametrize('change', [
    {'evidence': [{'source_id': 'lab-1', 'quote': 'This is an invented source quote.'}]},
    {'text': 'Personalized scenes improve relaxation.', 'kind': 'documented'},
    {'text': 'The project expects a 48% improvement in relaxation.'},
])
def test_openai_cannot_bypass_original_evidence_validators(tmp_path, change):
    value = {'claims': [{**CLAIM['claims'][0], **change}]}
    research = FlashResearch(tmp_path, Config(), Knowledge(), provider='openai', response_transport=httpx.MockTransport(lambda _: httpx.Response(200, json=envelope(value))))
    result = asyncio.run(research.answer({'question': 'What does Project expect?'}))
    assert result['status'] == 'unavailable' and research.successes == 0


def test_research_diagnostics_allow_only_finite_labels_and_bounded_numeric_metadata():
    diagnostic = safe_research_diagnostic({'error_type': 'PRIVATE_FIXTURE_CLASS',
        'provider_issue': 'PRIVATE_FIXTURE_PROVIDER_BODY', 'validation_reason': 'PRIVATE_FIXTURE_MESSAGE',
        'code': True, 'provider_attempts': 3, 'elapsed_ms': float('nan'), 'body': 'PRIVATE_FIXTURE_BODY',
        'model': 'PRIVATE_FIXTURE_MODEL'})
    assert diagnostic == {'error_type': 'OtherError', 'provider_issue': 'unknown', 'validation_reason': 'unclassified'}
    assert 'PRIVATE_FIXTURE' not in json.dumps(diagnostic)
    for elapsed in (float('inf'), -1, 10**400, True):
        assert safe_research_diagnostic({'elapsed_ms': elapsed}) == {}
    assert safe_research_diagnostic(None) is None
    safe = {'error_type': 'ValueError', 'validation_reason': 'Quote does not match supplied evidence',
            'provider_issue': 'request_timeout', 'code': 429, 'provider_attempts': 1, 'elapsed_ms': 21.5}
    assert safe_research_diagnostic(safe) == safe


@pytest.mark.parametrize(('response', 'issue'), [
    (envelope(OBSERVATION, status='incomplete'), 'response_incomplete'),
    (envelope(OBSERVATION, model='gpt-6-astra'), 'response_model_mismatch'),
    (envelope(OBSERVATION, output=[{'type': 'web_search_call'}]), 'response_output_shape'),
    (envelope(OBSERVATION, output=[{'type': 'message', 'role': 'assistant', 'status': 'completed', 'content': [{'type': 'refusal', 'refusal': 'PRIVATE_FIXTURE'}]}]), 'response_refused'),
])
def test_incomplete_refused_unexpected_tool_and_wrong_model_outputs_fail_closed(response, issue):
    inspector = PageInspector(Config().credential, provider='openai', response_transport=httpx.MockTransport(lambda _: httpx.Response(200, json=response)))
    result = asyncio.run(inspector.inspect(IMAGE, '', [0, 0, 1, 1]))
    assert result['status'] == 'unavailable' and result['provider_issue'] == issue
    assert 'PRIVATE_FIXTURE' not in json.dumps(result) and not inspector.cache


def test_response_body_and_request_bytes_are_bounded_before_acceptance():
    async def run():
        with pytest.raises(EvidenceRequestError) as failure:
            await responses_json(Config().credential, model=OPENAI_MODEL, instructions='fixture', content=[], schema=SCHEMA,
                name='fixture', max_output_tokens=100, timeout_seconds=1,
                transport=httpx.MockTransport(lambda _: httpx.Response(200, headers={'content-type': 'application/json'}, content=b' '*(MAX_RESPONSE_BYTES+1))))
        assert failure.value.issue == 'response_too_large'
        def credential(): raise AssertionError('Oversized request must stop before credential access')
        with pytest.raises(EvidenceRequestError) as failure:
            await responses_json(credential, model=OPENAI_MODEL, instructions='x'*513_000, content=[], schema=SCHEMA,
                name='fixture', max_output_tokens=100, timeout_seconds=1)
        assert failure.value.issue == 'request_too_large'
    asyncio.run(run())


def test_total_timeout_cancellation_and_stream_cleanup_do_not_retry():
    class Slow(httpx.AsyncByteStream):
        closed = False
        async def __aiter__(self):
            await asyncio.sleep(10); yield b'{}'
        async def aclose(self): self.closed = True
    async def run():
        stream = Slow()
        with pytest.raises(EvidenceRequestError) as failure:
            await responses_json(Config().credential, model=OPENAI_MODEL, instructions='fixture', content=[], schema=SCHEMA,
                name='fixture', max_output_tokens=100, timeout_seconds=.01,
                transport=httpx.MockTransport(lambda _: httpx.Response(200, headers={'content-type': 'application/json'}, stream=stream)))
        assert failure.value.issue == 'request_timeout' and stream.closed
        stream = Slow()
        inspector = PageInspector(Config().credential, provider='openai', response_transport=httpx.MockTransport(lambda _: httpx.Response(200, headers={'content-type': 'application/json'}, stream=stream)))
        task = asyncio.create_task(inspector.inspect(IMAGE, '', [0, 0, 1, 1]))
        await asyncio.sleep(.01); task.cancel()
        with pytest.raises(asyncio.CancelledError): await task
        assert stream.closed and not inspector.cache and inspector.calls == 1
    asyncio.run(run())
