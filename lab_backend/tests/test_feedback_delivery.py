"""Disclosed provider fixtures; real collection requires owner-side readback."""
import asyncio
from uuid import uuid4
import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from lab_backend.feedback import feedback_router
from lab_backend.feedback_delivery import NetlifyFeedback, PrivateFeedbackRelay, configured_feedback


def test_only_configured_https_netlify_destinations_are_allowed():
    for url in ['http://a.netlify.app','https://localhost','https://a.netlify.app@localhost','https://a.netlify.app/?token=x']:
        with pytest.raises(ValueError): NetlifyFeedback(url)


def test_urlencoded_delivery_uses_exact_registered_fields():
    observed = []
    def receive(request):
        observed.append(request)
        return httpx.Response(200)
    delivery = NetlifyFeedback('https://fixture.netlify.app/', transport=httpx.MockTransport(receive))
    asyncio.run(delivery.submit({'request_id':'fixture', 'rating':4, 'message':'Research helped', 'realism':None}))
    assert len(observed) == 1
    assert observed[0].headers['content-type'] == 'application/x-www-form-urlencoded'
    assert b'form-name=einstein-feedback' in observed[0].content
    assert b'realism' not in observed[0].content


@pytest.mark.parametrize('status', [302, 303, 400, 429, 500])
def test_redirects_and_rejections_do_not_claim_delivery(status):
    delivery = NetlifyFeedback('https://fixture.netlify.app/', transport=httpx.MockTransport(
        lambda request: httpx.Response(status, headers={'location':'/'})))
    with pytest.raises(ValueError):
        asyncio.run(delivery.submit({'rating':4}))


@pytest.mark.parametrize('uncertain', [False, True])
def test_retries_never_repeat_an_external_feedback_write(tmp_path, uncertain):
    class Delivery:
        calls = 0
        async def submit(self, value):
            self.calls += 1
            if uncertain: raise TimeoutError()
    delivery = Delivery()
    router, store = feedback_router(tmp_path, delivery=delivery, require_delivery=True)
    app = FastAPI(); app.include_router(router)
    with TestClient(app) as client:
        permit = client.get('/api/feedback/permit').json()['permit']
        body = {'request_id':str(uuid4()),'permit':permit,'rating':4,'kind':'impression','message':'Fixture'}
        first = client.post('/api/feedback', json=body)
        retry = client.post('/api/feedback', json=body)
    assert delivery.calls == 1
    assert first.status_code == (503 if uncertain else 200)
    assert retry.status_code == (409 if uncertain else 200)
    assert len(store.read()) == 1


def test_private_relay_uses_server_auth_and_requires_exact_submission_receipt():
    seen = []
    def receive(request):
        seen.append(request)
        return httpx.Response(200, json={'received': True, 'id': 'fixture-id'})
    relay = PrivateFeedbackRelay('a' * 64, transport=httpx.MockTransport(receive))
    asyncio.run(relay.submit({'request_id': 'fixture-id', 'rating': 3}))
    assert len(seen) == 1
    assert str(seen[0].url) == PrivateFeedbackRelay.url
    assert seen[0].headers['authorization'] == 'Bearer ' + 'a' * 64
    assert seen[0].headers['content-type'] == 'application/json'


@pytest.mark.parametrize('status,receipt', [
    (200, {'received': True, 'id': 'some-other-id'}),
    (200, {'received': False, 'id': 'fixture-id'}),
    (200, {}), (302, {}), (403, {}), (429, {}), (503, {}),
])
def test_private_relay_never_accepts_redirects_or_ambiguous_receipts(status, receipt):
    relay = PrivateFeedbackRelay('a' * 64, transport=httpx.MockTransport(
        lambda request: httpx.Response(status, json=receipt)))
    with pytest.raises(ValueError): asyncio.run(relay.submit({'request_id': 'fixture-id'}))


def test_private_relay_configuration_requires_verified_free_allowance(monkeypatch):
    monkeypatch.delenv('EINSTEIN_FEEDBACK_FORM_URL', raising=False)
    monkeypatch.setenv('EINSTEIN_FEEDBACK_RELAY_SECRET', 'a' * 64)
    monkeypatch.delenv('EINSTEIN_FEEDBACK_FREE_ALLOWANCE_VERIFIED', raising=False)
    assert configured_feedback() is None
    monkeypatch.setenv('EINSTEIN_FEEDBACK_FREE_ALLOWANCE_VERIFIED', 'true')
    assert isinstance(configured_feedback(), PrivateFeedbackRelay)


def test_private_immutable_relay_can_confirm_a_timed_out_write_without_duplicates(tmp_path):
    objects = {}; calls = []
    def receive(request):
        import json
        value = json.loads(request.content)
        objects.setdefault(value['request_id'], value)
        calls.append(value)
        if len(calls) == 1: raise httpx.ReadTimeout('Disclosed fixture after storage')
        return httpx.Response(200, json={'received': True, 'id': value['request_id']})
    delivery = PrivateFeedbackRelay('a' * 64, transport=httpx.MockTransport(receive))
    router, store = feedback_router(tmp_path, delivery=delivery, require_delivery=True)
    app = FastAPI(); app.include_router(router)
    with TestClient(app) as client:
        permit = client.get('/api/feedback/permit').json()['permit']
        body = {'request_id':str(uuid4()), 'permit':permit, 'rating':3, 'kind':'bug', 'message':'Authored timeout fixture'}
        assert client.post('/api/feedback', json=body).status_code == 503
        result = client.post('/api/feedback', json=body)
    assert result.status_code == 200 and result.json()['collection'] == 'private-netlify-blobs'
    assert len(calls) == 2 and calls[0] == calls[1]
    assert len(objects) == 1 and len(store.read()) == 1
