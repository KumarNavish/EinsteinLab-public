"""Responses protocol fixtures, not provider/model answer acceptance."""
import asyncio
import copy
import json
import socket
from types import SimpleNamespace as NS

import httpx
import pytest

from lab_backend.openai_text import ResponsesTextSession, TextSessionError, LIMITS
from lab_backend.openai_evidence import OPENAI_MODEL, MAX_REQUEST_BYTES


TOOLS = [{'name': 'calculate', 'parameters': {'type': 'OBJECT', 'properties': {
    'expression': {'type': 'STRING'}}, 'required': ['expression']}}]


@pytest.fixture(autouse=True)
def forbid_network(monkeypatch):
    def forbidden(*_args, **_kwargs):
        raise AssertionError('Text tests cannot open an external socket')
    monkeypatch.setattr(socket, 'create_connection', forbidden)
    monkeypatch.setattr(socket.socket, 'connect', forbidden)


def message(text='Four.', **changes):
    return {'type': 'message', 'id': 'msg_fixture', 'role': 'assistant',
            'status': 'completed', 'phase': 'final_answer',
            'content': [{'type': 'output_text', 'text': text, 'annotations': []}], **changes}


def function(identity='call_fixture', name='calculate', arguments=None):
    return {'type': 'function_call', 'id': 'fc_fixture', 'call_id': identity,
            'name': name, 'arguments': json.dumps(arguments or {'expression': '2+2'}),
            'status': 'completed'}


def response(output=None, **changes):
    return {'model': OPENAI_MODEL, 'status': 'completed', 'error': None,
            'incomplete_details': None, 'output': output or [message()],
            'usage': {'input_tokens': 20, 'output_tokens': 5, 'total_tokens': 25}, **changes}


def session(handler, declarations=TOOLS, system='Fixture instructions.'):
    return ResponsesTextSession('offline-fixture-key', system, declarations,
                                transport=httpx.MockTransport(handler))


async def ask(target, text='What is two plus two?'):
    await target.send_client_content(turns={'role': 'user', 'parts': [{'text': text}]}, turn_complete=True)
    await asyncio.wait_for(target.task, 1)


def drain(target):
    return [target.output.get_nowait() for _ in range(target.output.qsize())]


def test_actual_request_contract_final_text_and_stateless_replay():
    requests = []
    def handle(request):
        assert str(request.url) == 'https://api.openai.com/v1/responses'
        assert request.headers['authorization'] == 'Bearer offline-fixture-key'
        body = json.loads(request.content); requests.append(body)
        assert body['model'] == OPENAI_MODEL and body['store'] is False
        assert body['reasoning'] == {'effort': 'low'} and body['service_tier'] == 'default'
        assert body['include'] == ['reasoning.encrypted_content']
        assert body['parallel_tool_calls'] is False and body['truncation'] == 'disabled'
        assert body['max_output_tokens'] == 2048 and body['tool_choice'] == 'auto'
        assert body['tools'][0]['parameters']['type'] == 'object'
        assert body['tools'][0]['parameters']['properties']['expression']['type'] == 'string'
        assert 'TEXT ONLY' in body['instructions']
        return httpx.Response(200, json=response(model=OPENAI_MODEL+'-2026-10-01'))
    async def run():
        target = session(handle)
        await ask(target)
        packets = drain(target)
        assert [p.backend_activity for p in packets[:2]] == ['running', 'finished']
        final = packets[-1]
        assert final.server_content.output_transcription.text == 'Four.'
        assert final.server_content.turn_complete and not final.server_content.model_turn
        await ask(target, 'Explain why.')
        assert requests[1]['input'][1] == message()  # preserve assistant phase
        await target.aclose()
        assert target.usage['typed_requests'] == 2
        assert target.usage['backend_input_tokens'] == 40
        assert target.usage['backend_output_tokens'] == 10
        assert target.usage['final_usage_confirmed'] is True
        assert not target.history
    asyncio.run(run())


def test_tool_result_replays_encrypted_reasoning_call_id_and_ordered_image():
    requests = []
    reasoning = {'type': 'reasoning', 'id': 'rs_fixture', 'summary': [],
                 'encrypted_content': 'opaque-offline-fixture'}
    outputs = [reasoning, function()]
    def handle(request):
        body = json.loads(request.content); requests.append(body)
        return httpx.Response(200, json=response(outputs if len(requests) == 1 else None))
    async def run():
        target = session(handle)
        await ask(target)
        packets = drain(target)
        assert not any(p.server_content and p.server_content.turn_complete for p in packets)
        assert packets[-1].tool_call.function_calls[0].args == {'expression': '2+2'}
        await target.send_client_content(turns=NS(role='user', parts=[NS(inline_data=NS(
            data=b'offline-render-fixture', mime_type='image/jpeg'))]), turn_complete=False)
        await target.send_tool_response(function_responses=NS(id='call_fixture', name='calculate', response={'value': 4}))
        await asyncio.wait_for(target.task, 1)
        assert requests[1]['input'][1:3] == outputs
        image = requests[1]['input'][3]['content'][0]
        assert image['type'] == 'input_image' and image['image_url'].startswith('data:image/jpeg;base64,')
        assert requests[1]['input'][4] == {'type': 'function_call_output', 'call_id': 'call_fixture', 'output': '{"value": 4}'}
        assert target.usage['typed_requests'] == 1 and target.usage['function_calls'] == 1
        await target.aclose()
    asyncio.run(run())


@pytest.mark.parametrize('mutation', [
    {'status': 'incomplete', 'incomplete_details': {'reason': 'max_output_tokens'}},
    {'model': 'another-model'}, {'usage': {'input_tokens': True, 'output_tokens': 1, 'total_tokens': 2}},
    {'output': [function(name='unknown_tool')]}, {'output': [function(), function('call_second')]},
    {'output': [{**function(), 'arguments': '[]'}]}, {'output': [{**function(), 'arguments': '{"x":NaN}'}]},
    {'output': [message(content=[{'type': 'refusal', 'refusal': 'no'}])]},
    {'output': [message(status='in_progress')]}, {'output': [message('')]},
])
def test_invalid_provider_shapes_fail_closed_without_exposing_body(mutation):
    async def run():
        target = session(lambda _: httpx.Response(200, json=response(**mutation)))
        await ask(target)
        errors = [p for p in drain(target) if isinstance(p, Exception)]
        assert len(errors) == 1 and isinstance(errors[0], TextSessionError)
        assert str(errors[0]) in TextSessionError.CODES
        assert target.failed and not target.calls
        await target.aclose()
        if mutation.get('status') == 'incomplete':
            assert target.usage['backend_input_tokens'] == 20
            assert target.usage['final_usage_confirmed'] is False
    asyncio.run(run())


@pytest.mark.parametrize('status', [302, 400, 401, 429, 503])
def test_http_errors_do_not_retry_redirect_or_expose_errors(status):
    requests = []
    def handle(request):
        requests.append(request)
        return httpx.Response(status, text='SENSITIVE_UPSTREAM_BODY', headers={'location': 'https://other.invalid'})
    async def run():
        target = session(handle)
        await ask(target)
        errors = [p for p in drain(target) if isinstance(p, Exception)]
        assert [str(error) for error in errors] == ['text_request_failed']
        await target.aclose()
        assert not target.usage['final_usage_confirmed']
    asyncio.run(run())
    assert len(requests) == 1


def test_deadline_response_context_image_and_turn_bounds(monkeypatch):
    async def slow(_):
        await asyncio.sleep(1)
    async def run():
        monkeypatch.setitem(LIMITS, 'request_seconds', .001)
        target = session(slow)
        await ask(target)
        assert str(drain(target)[-1]) == 'text_request_timeout'
        await target.aclose()
        target = session(lambda _: httpx.Response(200, headers={'content-type': 'application/json'}, content=b'x'*128001))
        await ask(target)
        assert str(drain(target)[-1]) == 'text_invalid_response'
        await target.aclose()
        target = session(lambda _: pytest.fail('Oversize context cannot make a request'), system='x'*MAX_REQUEST_BYTES)
        await ask(target)
        assert str(drain(target)[-1]) == 'text_context_limit'
        assert target.usage['backend_responses_started'] == 0
        await target.aclose()
        target = session(lambda _: httpx.Response(200, json=response()))
        with pytest.raises(ValueError):
            await target.send_client_content(turns={'role': 'user', 'parts': [{'inline_data': {
                'mime_type': 'image/jpeg', 'data': b'x'*320001}}]}, turn_complete=True)
        for _ in range(8):
            await ask(target); drain(target)
        with pytest.raises(TextSessionError, match='text_budget_limit'):
            await ask(target)
        assert target.usage['backend_responses_started'] == 8
        await target.aclose()
    asyncio.run(run())


def test_twelfth_tool_continuation_exhaustion_reaches_receiver_without_an_extra_http_call():
    requests = []
    def handle(request):
        requests.append(request)
        return httpx.Response(200, json=response([function('call_'+str(len(requests)))]))
    async def run():
        target = session(handle)
        await ask(target)
        for index in range(1, 13):
            drain(target)
            await target.send_tool_response(function_responses={'id': 'call_'+str(index), 'name': 'calculate', 'response': {'value': 4}})
            if index < 12: await asyncio.wait_for(target.task, 1)
        assert target.failed
        with pytest.raises(TextSessionError, match='text_budget_limit'):
            await anext(target.receive())
        assert len(requests) == 12 and target.usage['backend_responses_started'] == 12
        await target.aclose()
    asyncio.run(run())


def test_cancellation_discards_partial_history_old_results_and_queue():
    requests, cancelled = [], []
    entered = asyncio.Event()
    async def handle(request):
        requests.append(json.loads(request.content))
        if len(requests) == 1:
            entered.set()
            try: await asyncio.sleep(10)
            except asyncio.CancelledError:
                cancelled.append(True); raise
        return httpx.Response(200, json=response([function()] if len(requests) == 2 else None))
    async def run():
        target = session(handle)
        await target.send_client_content(turns={'role': 'user', 'parts': [{'text': 'Old question'}]}, turn_complete=True)
        await asyncio.wait_for(entered.wait(), 1)
        await ask(target, 'Pending tool question')
        epoch = target.epoch
        assert cancelled == [True] and all(p.text_epoch == epoch for p in drain(target))
        await ask(target, 'Latest question')
        assert len(requests[-1]['input']) == 1
        assert requests[-1]['input'][0]['content'][0]['text'] == 'Latest question'
        await target.send_tool_response(function_responses={'id': 'call_fixture', 'name': 'calculate', 'response': {'value': 9}})
        assert len(requests) == 3 and not target.calls
        await target.aclose()
        assert target.usage['cancelled_requests'] == 1
        assert target.usage['final_usage_confirmed'] is False
    asyncio.run(run())


def test_research_schema_uses_existing_strict_contract_without_mutation():
    declaration = {'name': 'consult_flash', 'parameters': {'type': 'OBJECT', 'properties': {
        'question': {'type': 'STRING'}, 'project_titles': {'type': 'ARRAY', 'items': {'type': 'STRING'}}}}}
    original = copy.deepcopy(declaration)
    target = session(lambda _: None, declarations=[declaration])
    tool = target.tools[0]
    assert tool['strict'] and tool['parameters']['additionalProperties'] is False
    assert tool['parameters']['properties']['question']['maxLength'] == 1200
    assert tool['parameters']['properties']['project_titles']['maxItems'] == 3
    assert declaration == original
