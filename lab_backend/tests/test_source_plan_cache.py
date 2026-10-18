"""Bounded source observation/plan cache; synthetic transport, no network or key."""
import asyncio
import copy
import json

import httpx
import pytest

from lab_backend.page_vision import PageInspector, checked_walkthrough, walkthrough_request
from lab_backend.tests.test_openai_evidence import IMAGE, OBSERVATION, Config, envelope


def plan():
    return {'title': 'Source connections', 'steps': [
        {'region_index': 0, 'narration': 'The source circle is the first part of this explanation.'},
        {'region_index': 1, 'narration': 'The source square connects the next part of this explanation.'}]}


def test_one_provider_call_combines_pixel_observation_and_question_specific_plan():
    observed = copy.deepcopy(OBSERVATION)
    observed['regions'].append({'label': 'Square', 'box': [.6, .3, .2, .2]})
    observed['walkthrough'] = plan()
    requests = []
    def receive(request):
        body = json.loads(request.content)
        requests.append(body)
        assert body['store'] is False and body['tools'] == []
        assert body['reasoning'] == {'effort': 'low'} and body['service_tier'] == 'default'
        assert 'walkthrough' in body['text']['format']['schema']['properties']
        return httpx.Response(200, json=envelope(observed))
    inspector = PageInspector(Config().credential, provider='openai', limit=4,
                              response_transport=httpx.MockTransport(receive))
    async def run():
        request = {'question': 'Explain the circle and square.', 'steps': 2}
        first = await inspector.inspect(IMAGE, 'SOURCE CIRCLE', [0, 0, 1, 1], walkthrough=request)
        assert first['walkthrough'] == plan() and first['status'] == 'source-image-inspected'
        first['regions'][0]['label'] = 'Caller mutation must not enter cache'
        second = await inspector.inspect(IMAGE, 'SOURCE CIRCLE', [0, 0, 1, 1], walkthrough=request)
        assert second['cache_hit'] and second['regions'][0]['label'] != first['regions'][0]['label']
        await inspector.inspect(IMAGE, 'SOURCE CIRCLE', [0, 0, 1, 1],
                                walkthrough={**request, 'question': 'Explain a different connection.'})
        await inspector.inspect(IMAGE, 'Corrected extraction', [0, 0, 1, 1], walkthrough=request)
        assert inspector.calls == 3
        inspector.clear()
        assert not inspector.cache
    asyncio.run(run())
    assert len(requests) == 3


@pytest.mark.parametrize('change', [True, -1, 2, 0.5, '1'])
def test_plan_cannot_use_uninspected_or_duplicate_region_indices(change):
    value = plan()
    value['steps'][1]['region_index'] = change
    with pytest.raises(ValueError): checked_walkthrough(value, [{}, {}], 2)


@pytest.mark.parametrize('value', [{'question': 'Explain', 'steps': True}, {'question': 'x', 'steps': 2},
    {'question': 'Explain', 'steps': 7}, {'question': 'Explain', 'steps': 3, 'private': 'extra'}])
def test_walkthrough_request_is_bounded(value):
    with pytest.raises(ValueError): walkthrough_request(value)
