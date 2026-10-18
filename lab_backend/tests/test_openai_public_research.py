"""Offline official-wire fixtures; no real credentials, sockets or provider calls."""
import asyncio
import copy
import json

import httpx
import pytest

from lab_backend.openai_evidence import OPENAI_MODEL, MAX_RESPONSE_BYTES, EvidenceRequestError
from lab_backend.openai_public_research import OpenAIPublicResearch

URL = 'https://mobililab.ethz.ch/research/example/'
OTHER = 'https://mobililab.ethz.ch/research/another/'
TEXT = 'The public source describes a project aim, not a demonstrated outcome.'
ARGUMENTS = {'query': 'ETH Zurich Mobiliar Lab projects', 'objective': 'Prefer official project sources.'}


def citation(url=URL):
    return {'type': 'url_citation', 'url': url, 'title': 'Official project', 'start_index': 0, 'end_index': len(TEXT)}


def reply(action=None, annotations=None):
    text = (json.dumps({'pages': [{'url': action['url'], 'status': 'retrieved', 'summary': TEXT}]})
            if action and action.get('type') == 'open_page' else TEXT)
    return {'status': 'completed', 'model': OPENAI_MODEL, 'output': [
        {'type': 'reasoning', 'summary': []},
        {'type': 'web_search_call', 'id': 'ws-fixture', 'status': 'completed',
         'action': action or {'type': 'search', 'query': 'official lab projects'}},
        {'type': 'message', 'status': 'completed', 'role': 'assistant', 'content': [
            {'type': 'output_text', 'text': text, 'annotations': [citation()] if annotations is None else annotations}]}],
        'usage': {'input_tokens': 80, 'output_tokens': 40, 'total_tokens': 120}}


@pytest.fixture(autouse=True)
def block_real_http(monkeypatch):
    async def blocked(*_args, **_kwargs):
        raise AssertionError('Real HTTP is forbidden in these tests')
    monkeypatch.setattr(httpx.AsyncHTTPTransport, 'handle_async_request', blocked)


def adapter(response=None, handler=None, credential=lambda: 'offline-fixture-key'):
    requests = []
    def receive(request):
        requests.append(request)
        return handler(request) if handler else httpx.Response(200, json=response or reply())
    return OpenAIPublicResearch(credential, httpx.MockTransport(receive)), requests


def run(research, operation='search', arguments=None, approved=True):
    return asyncio.run(research.run(operation, ARGUMENTS if arguments is None else arguments, approved=approved))


def test_search_is_one_explicit_bounded_stateless_funded_request():
    research, requests = adapter()
    result = run(research)
    assert result['status'] == 'sources-found' and result['model'] == OPENAI_MODEL
    assert len(requests) == 1 and str(requests[0].url) == 'https://api.openai.com/v1/responses'
    assert requests[0].headers['authorization'] == 'Bearer offline-fixture-key'
    payload = json.loads(requests[0].content)
    assert payload['tools'] == [{'type': 'web_search', 'search_context_size': 'low'}]
    assert payload['tool_choice'] == 'required' and payload['max_tool_calls'] == 1
    assert payload['max_output_tokens'] == 1500 and payload['store'] is False
    assert payload['service_tier'] == 'default' and payload['reasoning'] == {'effort': 'low'}
    assert payload['include'] == ['web_search_call.action.sources']
    assert set(payload) == {'model', 'instructions', 'input', 'tools', 'tool_choice', 'max_tool_calls',
                            'max_output_tokens', 'store', 'service_tier', 'reasoning', 'include'}
    assert json.loads(payload['input'][0]['content'][0]['text']) == {'operation': 'search', **ARGUMENTS}
    assert 'offline-fixture-key' not in requests[0].content.decode()
    source = result['sources'][0]
    assert source['url'] == URL and source['source_kind'] == 'openai-public-search'
    assert source['source_scope'] == source['excerpt_kind'] == 'provider-grounded-summary'
    assert 'not a verbatim passage' in source['limits'] and source['excerpt'] == TEXT
    assert research.status()['content_verified_this_process'] is True
    assert research.status()['last']['usage'] == {'input_tokens': 80, 'output_tokens': 40, 'total_tokens': 120}


def test_http_client_disables_proxy_environment_and_redirects_with_25_second_timeout(monkeypatch):
    options = []
    original = httpx.AsyncClient
    def client(**kwargs):
        options.append(kwargs)
        return original(**kwargs)
    monkeypatch.setattr(httpx, 'AsyncClient', client)
    research, _ = adapter()
    assert run(research)['status'] == 'sources-found'
    assert options[0]['trust_env'] is False and options[0]['follow_redirects'] is False
    assert options[0]['timeout'].read == 25 and options[0]['timeout'].connect == 5


def test_no_approval_never_calls_credential_or_http():
    def credential():
        raise AssertionError('Approval gate must run before credential access')
    research, requests = adapter(credential=credential)
    assert run(research, approved=False)['status'] == 'approval-required'
    assert not requests and research.calls == 0


def test_credential_approval_is_rechecked_for_each_operation_and_exceptions_are_private():
    approvals = []
    def credential():
        approvals.append(True)
        if len(approvals) > 1:
            raise ValueError('PRIVATE_FIXTURE_APPROVAL_DETAILS')
        return 'offline-fixture-key'
    research, requests = adapter(credential=credential)
    async def exercise():
        assert (await research.run('search', ARGUMENTS, approved=True))['status'] == 'sources-found'
        failure = await research.run('search', ARGUMENTS, approved=True)
        assert failure['diagnostic']['provider_issue'] == 'credential_unavailable'
        assert 'PRIVATE_FIXTURE' not in json.dumps(failure)
    asyncio.run(exercise())
    assert len(approvals) == 2 and len(requests) == 1 and research.calls == 1


@pytest.mark.parametrize('key', ['', None, False, 'private\r\nheader'])
def test_invalid_credential_never_reaches_http(key):
    research, requests = adapter(credential=lambda: key)
    assert run(research)['diagnostic']['provider_issue'] == 'credential_unavailable'
    assert not requests


@pytest.mark.parametrize('url', ['http://mobililab.ethz.ch/', 'https://127.0.0.1/', 'https://localhost/',
    'https://10.0.0.1/', 'https://user:password@mobililab.ethz.ch/', 'https://docs.google.com/private',
    'https://mobililab.ethz.ch/?token=private', 'https://host.lan/', 'file:///etc/passwd'])
def test_private_or_credentialled_read_url_rejected_before_credential_and_http(url):
    research, requests = adapter(credential=lambda: pytest.fail('Credential must not be accessed'))
    with pytest.raises(ValueError):
        run(research, 'read', {'urls': [url]})
    assert not requests


def test_search_can_use_actual_tool_sources_without_annotations_but_never_message_urls_only():
    response = reply({'type': 'search', 'sources': [{'type': 'url', 'url': URL}]}, [])
    research, _ = adapter(response)
    assert run(research)['sources'][0]['url'] == URL
    response['output'][1]['action'].pop('sources')
    response['output'][2]['content'][0]['text'] = 'A claimed page is ' + URL
    research, _ = adapter(response)
    assert run(research)['diagnostic']['provider_issue'] == 'source_receipt_missing'


@pytest.mark.parametrize('change', ['no-call', 'failed', 'incomplete', 'open-instead-of-search', 'two-searches'])
def test_citations_do_not_prove_search_without_one_completed_search_action(change):
    response = reply()
    if change == 'no-call': response['output'].pop(1)
    elif change in ['failed', 'incomplete']: response['output'][1]['status'] = change
    elif change == 'open-instead-of-search': response['output'][1]['action'] = {'type': 'open_page', 'url': URL}
    else: response['output'].insert(1, copy.deepcopy(response['output'][1]))
    research, requests = adapter(response)
    assert run(research)['status'] == 'unavailable' and len(requests) == 1
    assert research.successes == 0


def test_read_requires_exact_requested_completed_open_and_matching_citation():
    response = reply({'type': 'open_page', 'url': URL})
    research, requests = adapter(response)
    result = run(research, 'read', {'urls': [URL]})
    assert result['status'] == 'sources-found' and result['complete'] is True
    assert result['sources'][0]['source_kind'] == 'openai-public-page'
    payload = json.loads(requests[0].content)
    assert payload['max_tool_calls'] == 1
    assert 'brief English summary of only that page' in payload['instructions']
    assert 'text' not in payload  # No unverified JSON-schema/web-tool API combination.
    assert json.loads(payload['input'][0]['content'][0]['text'])['urls'] == [URL]
    assert result['sources'][0]['excerpt'] == TEXT
    for action, annotations in [({'type': 'search', 'query': URL}, [citation()]),
        ({'type': 'open_page', 'url': OTHER}, [citation()]),
        ({'type': 'open_page', 'url': URL + '?changed=1'}, [citation()]),
        ({'type': 'open_page', 'url': URL}, [citation(OTHER)]),
        ({'type': 'open_page', 'url': URL}, [])]:
        research, _ = adapter(reply(action, annotations))
        assert run(research, 'read', {'urls': [URL]})['status'] == 'unavailable'


def test_one_request_for_multiple_pages_returns_only_completed_cited_pages_and_partial_scope():
    response = reply({'type': 'open_page', 'url': URL})
    pages = [{'url': URL, 'status': 'retrieved', 'summary': TEXT},
             {'url': OTHER, 'status': 'unavailable', 'summary': 'The requested page was inaccessible.'}]
    response['output'][-1]['content'][0]['text'] = json.dumps({'pages': pages})
    research, requests = adapter(response)
    result = run(research, 'read', {'urls': [URL, OTHER]})
    assert result['status'] == 'sources-found' and result['complete'] is False
    assert [s['url'] for s in result['sources']] == [URL]
    assert 'omitted requested pages were not verified' in result['answer']
    assert len(requests) == 1 and json.loads(requests[0].content)['max_tool_calls'] == 2
    response['output'].insert(2, {'type': 'web_search_call', 'id': 'ws-other', 'status': 'completed',
                                 'action': {'type': 'open_page', 'url': OTHER}})
    response['output'][-1]['content'][0]['annotations'].append(citation(OTHER))
    pages[1] = {'url': OTHER, 'status': 'retrieved', 'summary': 'This other page describes a different project.'}
    response['output'][-1]['content'][0]['text'] = json.dumps({'pages': pages})
    research, requests = adapter(response)
    result = run(research, 'read', {'urls': [URL, OTHER]})
    assert result['complete'] and len(result['sources']) == 2 and len(requests) == 1
    assert {s['url']: s['excerpt'] for s in result['sources']} == {page['url']: page['summary'] for page in pages}


@pytest.mark.parametrize('annotation', [citation('https://localhost/'), citation('https://mobililab.ethz.ch/?key=private'),
    {**citation(), 'start_index': -1}, {**citation(), 'end_index': len(TEXT) + 1},
    {**citation(), 'start_index': True}, {**citation(), 'end_index': 0}])
def test_private_urls_or_invalid_citation_positions_never_become_evidence(annotation):
    research, _ = adapter(reply(annotations=[annotation]))
    assert run(research)['status'] == 'unavailable'


@pytest.mark.parametrize('status', [302, 400, 401, 404, 429, 503])
def test_http_failure_has_no_retry_redirect_fallback_or_upstream_disclosure(status):
    research, requests = adapter(handler=lambda _: httpx.Response(status,
        headers={'location': 'https://mcp.exa.ai/mcp'}, text='PRIVATE_FIXTURE_PROVIDER_BODY'))
    result = run(research)
    assert result['status'] == 'unavailable' and result['diagnostic']['code'] == status
    assert result['diagnostic']['provider_issue'] == 'http_status' and len(requests) == 1
    assert 'PRIVATE_FIXTURE' not in json.dumps([result, research.status()])


@pytest.mark.parametrize('change,issue', [({'model': 'other-model'}, 'response_model_mismatch'),
    ({'status': 'incomplete'}, 'response_incomplete'), ({'error': {'message': 'PRIVATE_FIXTURE'}}, 'response_incomplete'),
    ({'output': []}, 'response_output_shape')])
def test_incomplete_wrong_model_or_malformed_response_fails_closed(change, issue):
    response = reply(); response.update(change)
    research, _ = adapter(response)
    result = run(research)
    assert result['diagnostic']['provider_issue'] == issue
    assert 'PRIVATE_FIXTURE' not in json.dumps(result)


@pytest.mark.parametrize('kind,issue', [('oversize', 'response_too_large'), ('wrong-type', 'response_content_type'),
                                      ('not-json', 'response_decode'), ('timeout', 'request_timeout'),
                                      ('transport', 'request_transport')])
def test_bounded_transport_failures_do_not_retry_or_leak(kind, issue):
    def receive(request):
        if kind == 'timeout': raise TimeoutError('PRIVATE_FIXTURE')
        if kind == 'transport': raise httpx.ConnectError('PRIVATE_FIXTURE', request=request)
        if kind == 'oversize': return httpx.Response(200, headers={'content-type': 'application/json'}, content=b'x' * (MAX_RESPONSE_BYTES + 1))
        if kind == 'wrong-type': return httpx.Response(200, text='PRIVATE_FIXTURE')
        return httpx.Response(200, headers={'content-type': 'application/json'}, content=b'PRIVATE_FIXTURE')
    research, requests = adapter(handler=receive)
    result = run(research)
    assert result['diagnostic']['provider_issue'] == issue and len(requests) == 1
    assert 'PRIVATE_FIXTURE' not in json.dumps([result, research.status()])


def test_thirty_request_limit_is_atomic_and_does_not_fetch_credentials_after_exhaustion():
    credentials = []
    research, requests = adapter(credential=lambda: credentials.append(True) or 'offline-fixture-key')
    async def exercise():
        result = await asyncio.gather(*(research.run('search', ARGUMENTS, approved=True) for _ in range(32)))
        assert sum(r['status'] == 'sources-found' for r in result) == 30
        assert sum(r['status'] == 'budget-limit' for r in result) == 2
    asyncio.run(exercise())
    assert len(requests) == len(credentials) == research.calls == 30


@pytest.mark.parametrize('operation,arguments', [('other', {}), ('search', {'query': ''}),
    ('search', {'query': 'Search for sk-proj-private'}), ('read', {'urls': []}),
    ('read', {'urls': [URL] * 4}), ('read', {'urls': URL}), ('search', None)])
def test_invalid_operations_inputs_or_secrets_are_rejected_before_http(operation, arguments):
    research, requests = adapter(credential=lambda: pytest.fail('No credential for invalid input'))
    with pytest.raises(ValueError):
        asyncio.run(research.run(operation, arguments, approved=True))
    assert not requests


def test_cancellation_remains_cancellation_and_never_retries():
    async def receive(_): raise asyncio.CancelledError()
    research = OpenAIPublicResearch(lambda: 'offline-fixture-key', httpx.MockTransport(receive))
    with pytest.raises(asyncio.CancelledError): run(research)
    assert research.calls == 1 and research.successes == 0


def test_unclassified_local_error_label_never_exposes_exception_data():
    def receive(_): raise EvidenceRequestError('PRIVATE_FIXTURE_ISSUE')
    research, _ = adapter(handler=receive)
    result = run(research)
    assert result['diagnostic']['provider_issue'] == 'response_decode'
    assert 'PRIVATE_FIXTURE' not in json.dumps([result, research.status()])


def test_wall_timeout_cancels_stalled_transport_without_retry(monkeypatch):
    timeout = asyncio.timeout
    monkeypatch.setattr(asyncio, 'timeout', lambda _: timeout(.001))
    async def receive(_):
        await asyncio.sleep(60)
        pytest.fail('Stalled transport must be cancelled')
    research = OpenAIPublicResearch(lambda: 'offline-fixture-key', httpx.MockTransport(receive))
    assert run(research)['diagnostic']['provider_issue'] == 'request_timeout'
    assert research.calls == 1


def test_completed_open_with_citation_and_explicit_failed_access_never_counts_as_read():
    response = reply({'type': 'open_page', 'url': URL})
    response['output'][-1]['content'][0]['text'] = 'I could not access the requested page, so no page content was retrieved.'
    research, requests = adapter(response)
    result = run(research, 'read', {'urls': [URL]})
    assert result['status'] == 'unavailable' and result['sources'] == []
    assert research.successes == 0 and not research.status()['content_verified_this_process']
    assert 'complete' not in result and len(requests) == 1


def test_explicit_unavailable_json_page_is_excluded_even_with_completed_open_and_citation():
    response = reply({'type': 'open_page', 'url': URL})
    response['output'][-1]['content'][0]['text'] = json.dumps({'pages': [
        {'url': URL, 'status': 'unavailable', 'summary': 'I could not retrieve the page content.'}]})
    research, requests = adapter(response)
    result = run(research, 'read', {'urls': [URL]})
    assert result['status'] == 'unavailable' and not result['sources'] and len(requests) == 1
    assert not research.status()['content_verified_this_process']


def test_partial_json_read_does_not_admit_unavailable_page_despite_its_open_and_citation():
    response = reply({'type': 'open_page', 'url': URL})
    response['output'].insert(2, {'type': 'web_search_call', 'id': 'ws-other', 'status': 'completed',
                                 'action': {'type': 'open_page', 'url': OTHER}})
    response['output'][-1]['content'][0].update(text=json.dumps({'pages': [
        {'url': URL, 'status': 'retrieved', 'summary': TEXT},
        {'url': OTHER, 'status': 'unavailable', 'summary': 'The page returned HTTP403 Forbidden.'}]}),
        annotations=[citation(), citation(OTHER)])
    research, _ = adapter(response)
    result = run(research, 'read', {'urls': [URL, OTHER]})
    assert result['status'] == 'sources-found' and result['complete'] is False
    assert [s['url'] for s in result['sources']] == [URL]
    assert result['sources'][0]['excerpt'] == TEXT


def test_json_retrieved_claim_alone_does_not_replace_completed_tool_receipt():
    response = reply({'type': 'open_page', 'url': URL})
    response['output'].pop(1)
    research, _ = adapter(response)
    result = run(research, 'read', {'urls': [URL]})
    assert result['status'] == 'unavailable' and not research.status()['content_verified_this_process']


@pytest.mark.parametrize('summary', [
    'I could not access the requested page, so no page content was retrieved.',
    'I cannot retrieve the page content.', 'We could not open the requested source.',
    'We have not retrieved the page content.', 'I have not accessed the requested URL.',
    'I couldn\u2019t access the requested page.', 'The page was not retrieved.',
    'The requested page is unavailable.', 'The page content is inaccessible.',
    'No actual page content was retrieved.', 'The server returned403 Forbidden.',
    'The HTTP status403 blocked access.', 'Access was denied for this page.',
    'We have no direct access to the requested page.',
    '\u3053\u306e\u30da\u30fc\u30b8\u306f\u53d6\u5f97\u3067\u304d\u307e\u305b\u3093\u3002', 'Die Seite konnte nicht abgerufen werden.',
])
def test_retrieved_label_cannot_override_explicit_english_access_denial(summary):
    response = reply({'type': 'open_page', 'url': URL})
    response['output'][-1]['content'][0]['text'] = json.dumps({'pages': [
        {'url': URL, 'status': 'retrieved', 'summary': summary}]})
    research, _ = adapter(response)
    result = run(research, 'read', {'urls': [URL]})
    assert result['status'] == 'unavailable' and not result['sources']
    assert not research.status()['content_verified_this_process']


@pytest.mark.parametrize('pages', [[], [{}],
    [{'url': URL, 'status': 'retrieved', 'summary': ''}],
    [{'url': URL, 'status': 'retrieved', 'summary': None}],
    [{'url': URL, 'status': 'complete', 'summary': TEXT}],
    [{'url': OTHER, 'status': 'retrieved', 'summary': TEXT}],
    [{'url': URL, 'status': 'retrieved', 'summary': TEXT, 'extra': 'field'}],
    [{'url': URL, 'status': 'retrieved', 'summary': TEXT}, {'url': URL, 'status': 'retrieved', 'summary': TEXT}],
])
def test_malformed_empty_duplicate_or_foreign_read_records_fail_closed(pages):
    response = reply({'type': 'open_page', 'url': URL})
    response['output'][-1]['content'][0]['text'] = json.dumps({'pages': pages})
    research, _ = adapter(response)
    assert run(research, 'read', {'urls': [URL]})['status'] == 'unavailable'


def test_duplicate_json_outcome_keys_are_rejected_instead_of_last_value_winning():
    response = reply({'type': 'open_page', 'url': URL})
    response['output'][-1]['content'][0]['text'] = (
        '{"pages":[{"url":' + json.dumps(URL) + ',"status":"unavailable","status":"retrieved","summary":' + json.dumps(TEXT) + '}]}')
    research, _ = adapter(response)
    assert run(research, 'read', {'urls': [URL]})['status'] == 'unavailable'


def test_duplicate_page_url_cannot_replace_another_requested_page_outcome():
    response = reply({'type': 'open_page', 'url': URL})
    response['output'][-1]['content'][0]['text'] = json.dumps({'pages': [
        {'url': URL, 'status': 'retrieved', 'summary': TEXT},
        {'url': URL, 'status': 'unavailable', 'summary': ''}]})
    research, _ = adapter(response)
    assert run(research, 'read', {'urls': [URL, OTHER]})['status'] == 'unavailable'
