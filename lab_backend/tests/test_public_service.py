"""Offline boundary fixtures; these do not establish real Gemini concurrency."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
import hashlib
import json
import time
from fastapi import HTTPException
from starlette.requests import Request

from fastapi.testclient import TestClient
import pytest
from starlette.websockets import WebSocketDisconnect

from lab_backend.public_service import create_app
from lab_backend.public_sessions import COOKIE, DeploymentConfig, UsageBudget, Visitors, public_origin
from lab_backend.http_body import bounded_body


class FakeConfig:
    def __init__(self): self.permits = {}


class FakeBridge:
    """Disclosed stateful adapter fixture, never a substitute voice response."""
    def __init__(self): self.config = FakeConfig(); self.active = False; self.messages = []

    async def status(self, request):
        return {'available': True, 'active': self.active, 'messages': list(self.messages)}

    async def permit(self, request):
        token = str(id(self))
        self.config.permits[token] = time.monotonic() + 30
        return {'permit': token}

    async def voice(self, socket):
        permit = socket.query_params.get('permit')
        if self.config.permits.pop(permit, None) is None:
            await socket.close(code=1008); return
        await socket.accept(); self.active = True
        try:
            text = await socket.receive_text()
            self.messages.append(text)
            await socket.send_json({'fixture_echo': text})
            await socket.receive_text()
        except WebSocketDisconnect:
            pass
        finally:
            self.active = False
            await socket.close()


def application(tmp_path):
    return create_app(tmp_path, origin='http://testserver', private_qa=True, bridge_factory=FakeBridge)


def test_visitors_have_separate_cookies_bridge_state_and_permits(tmp_path):
    app = application(tmp_path)
    with TestClient(app) as alice, TestClient(app) as bob:
        assert alice.get('/api/native/status').status_code == 200
        assert bob.get('/api/native/status').status_code == 200
        assert alice.cookies[COOKIE] != bob.cookies[COOKIE]
        permit = alice.post('/api/native/permit', headers={'origin': 'http://testserver'}).json()['permit']
        # A different cookie cannot consume Alice's permit.
        with pytest.raises(WebSocketDisconnect):
            with bob.websocket_connect('/api/native/voice?permit='+permit, headers={'origin':'http://testserver'}): pass
        with alice.websocket_connect('/api/native/voice?permit='+permit, headers={'origin':'http://testserver'}) as socket:
            socket.send_text('private fixture A')
            assert socket.receive_json() == {'fixture_echo':'private fixture A'}
            assert bob.get('/api/native/status').json()['messages'] == []
        assert alice.get('/api/native/status').json()['messages'] == ['private fixture A']
        assert not app.state.visitors.active


def test_anonymous_cookie_does_not_accept_forged_identity_or_cross_origin(tmp_path):
    with TestClient(application(tmp_path)) as client:
        assert client.post('/api/native/permit', headers={'origin':'http://testserver'}).status_code == 401
        response = client.get('/api/native/status')
        assert 'HttpOnly' in response.headers['set-cookie']
        assert 'SameSite=strict' in response.headers['set-cookie']
        assert response.headers['cache-control'] == 'no-store'
        assert "frame-ancestors 'none'" in response.headers['content-security-policy']
        assert client.get('/api/native/status', headers={'origin':'https://evil.example'}).status_code == 403
        assert client.get('/api/health', headers={'host':'evil.example'}).status_code == 403
        assert client.post('/api/native/permit').status_code == 403
        assert client.post('/api/native/configure', headers={'origin':'http://testserver'}, json={'api_key':'fixture'}).status_code == 404
        assert client.get('/api/docs').status_code == 404
        assert client.get('/api/feedback/permit').status_code == 503


def test_production_cookie_is_secure_and_uncleared_avatar_is_blocked(tmp_path):
    app = create_app(tmp_path, origin='https://einstein.example', bridge_factory=FakeBridge)
    with TestClient(app, base_url='https://einstein.example') as client:
        response = client.get('/api/native/status')
        assert 'Secure' in response.headers['set-cookie']
        assert response.headers['strict-transport-security'] == 'max-age=31536000'
        assert client.get('/assets/einstein.glb').status_code == 503
        assert client.get('/outside/%2e%2e/assets/einstein.glb').status_code == 503
        assert client.head('/outside/%2e%2e/assets/Einstein.GLB').status_code == 503
        assert client.head('/%2fassets/einstein.glb').status_code == 503
        assert client.head('/%2foutside/%2e%2e/assets/einstein.glb').status_code == 503


def test_entry_html_and_unhashed_audio_revalidate_without_disabling_asset_caching(tmp_path):
    static = tmp_path / 'rehearsal' / 'dist'
    (static / 'assets').mkdir(parents=True)
    (static / 'index.html').write_text('<!doctype html><title>Current release</title>')
    (static / 'assets' / 'example.js').write_text('export const release = 1;')
    (static / 'audio').mkdir()
    (static / 'audio' / 'pcm-stream.worklet.mjs').write_text('export const version = 1;')
    (static / 'audio' / 'pcm-stream-core.mjs').write_text('export const position = 0;')
    with TestClient(application(tmp_path)) as client:
        for path in ('/', '/index.html', '/?release=example'):
            assert client.get(path).headers['cache-control'] == 'no-cache'
        assert 'cache-control' not in client.get('/assets/example.js').headers
        for path in ('/audio/pcm-stream.worklet.mjs?watermarkv1', '/audio/pcm-stream-core.mjs?watermarkv1'):
            response = client.get(path)
            assert response.status_code == 200
            assert response.headers['cache-control'] == 'no-cache'


def test_atomic_capacity_and_daily_reservations_survive_process_objects(tmp_path):
    path = tmp_path/'usage.sqlite3'
    pool = Visitors(FakeBridge, UsageBudget(path), capacity=2)
    def enter(number):
        try: pool.enter(str(number), str(number)); return True
        except ValueError: return False
    with ThreadPoolExecutor(max_workers=12) as executor:
        assert sum(executor.map(enter, range(12))) == 2
    assert len(pool.active) == 2
    assert pool.room_status() == {'room_capacity': 2, 'room_active_sessions': 2,
                                  'room_capacity_rejections': 10}
    # Reusing an active visitor is not evidence of a distinct full-room rejection.
    with pytest.raises(ValueError):
        pool.enter(next(iter(pool.active)), 'duplicate-network')
    assert pool.room_status()['room_capacity_rejections'] == 10
    pool.active.clear()
    # Reconstructing the budget does not reset reservations on the same disk.
    budget = UsageBudget(path, daily_sessions=2)
    with pytest.raises(ValueError): budget.reserve('third')


def test_unused_anonymous_sessions_cannot_fill_the_room_or_evict_active_visitors(tmp_path):
    pool = Visitors(FakeBridge, UsageBudget(tmp_path/'usage.sqlite3'), maximum=8)
    active, _ = pool.get(None, create=True)
    pool.enter(active, 'one')
    for _ in range(32): pool.get(None, create=True)
    assert len(pool.records) == 8
    assert pool.get(active)[0] == active
    now = [100.0]
    pool = Visitors(FakeBridge, UsageBudget(tmp_path/'usage2.sqlite3'), clock=lambda: now[0])
    for _ in range(16): pool.get(None, create=True, network='same-peer')
    with pytest.raises(ValueError): pool.get(None, create=True, network='same-peer')
    now[0] += 61
    assert pool.get(None, create=True, network='same-peer')


@pytest.mark.parametrize('url', [
    'https://einstein-mobiliar-lab.netlify.app/',
    'http://einstein-mobiliar-lab.netlify.app/',
    'https://other.netlify.app/',
    'https://einstein-mobiliar-lab.netlify.app@other.example/',
    'https://einstein-mobiliar-lab.netlify.app/?tracking=1',
])
def test_public_feedback_links_only_to_the_registered_collection(tmp_path, monkeypatch, url):
    monkeypatch.setenv('EINSTEIN_FEEDBACK_URL', url)
    with TestClient(application(tmp_path)) as client:
        link = client.get('/api/health').json()['feedback_url']
    assert link == (url if url == 'https://einstein-mobiliar-lab.netlify.app/' else None)


def test_chunked_input_stops_at_actual_byte_limit_without_reading_remainder():
    consumed = []
    async def receive():
        consumed.append(True)
        return {'type':'http.request', 'body':b'x'*1024, 'more_body':True}
    request = Request({'type':'http', 'headers':[]}, receive)
    with pytest.raises(HTTPException) as failure:
        asyncio.run(bounded_body(request, 256))
    assert failure.value.status_code == 413
    assert len(consumed) == 1


def test_slow_upload_has_a_bounded_deadline():
    async def receive():
        await asyncio.sleep(1)
        return {'type':'http.request', 'body':b'', 'more_body':False}
    request = Request({'type':'http','headers':[]}, receive)
    with pytest.raises(HTTPException) as failure:
        asyncio.run(bounded_body(request, 256, seconds=.001))
    assert failure.value.status_code == 408


def test_free_tier_environment_config_never_reads_local_secret(tmp_path, monkeypatch):
    key = 'AIza' + 'x'*35
    proof = {'verified_at': datetime.now(timezone.utc).isoformat(), 'billing_tier':'Free tier',
             'model':'gemini-3.8-live', 'billing_enabled': False, 'existing_key_suffix': 'xxxx'}
    monkeypatch.setenv('EINSTEIN_FREE_TIER_PROOF', json.dumps(proof))
    monkeypatch.setenv('GOOGLE_API_KEY', key)
    config = DeploymentConfig(tmp_path)
    assert config.credential() == key
    assert config.status()['automatic_paid_fallback'] is False
    proof['billing_enabled'] = True
    monkeypatch.setenv('EINSTEIN_FREE_TIER_PROOF', json.dumps(proof))
    assert not config.status()['available']
    with pytest.raises(ValueError): config.store_operator_key(key, True)
    assert not (tmp_path/'.work/private').exists()


def deployment_attestation(key, **changes):
    return {'verified_at': (datetime.now(timezone.utc) - timedelta(days=3)).isoformat(),
            'billing_tier': 'Free tier', 'model': 'gemini-3.8-live',
            'billing_enabled': False, 'billing_account_linked': False,
            'project_id': 'gen-lang-client-0920149692', 'existing_key_suffix': key[-4:],
            'deployment_verification': 'unlinked-project',
            'key_sha256': hashlib.sha256(key.encode()).hexdigest(), **changes}


def test_public_unlinked_project_attestation_survives_cold_starts_without_mac_renewal(tmp_path, monkeypatch):
    key = 'AIza' + 'x' * 35
    monkeypatch.setenv('GOOGLE_API_KEY', key)
    monkeypatch.setenv('EINSTEIN_FREE_TIER_PROOF', json.dumps(deployment_attestation(key)))
    status = DeploymentConfig(tmp_path).status()
    assert status['available'] and status['verification_expires'] is None
    assert status['verification_basis'] == 'unlinked-project-at-deployment'
    assert key not in json.dumps(status)
    assert not (tmp_path/'.work/private').exists()


@pytest.mark.parametrize('change', [
    {'billing_enabled': True}, {'billing_account_linked': True},
    {'billing_account_linked': None}, {'key_sha256': '0' * 64},
    {'project_id': 'not a project'}, {'deployment_verification': 'unknown'},
    {'verified_at': (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()},
])
def test_durable_deployment_rejects_invalid_billing_attestation_and_key(tmp_path, monkeypatch, change):
    key = 'AIza' + 'x' * 35
    monkeypatch.setenv('GOOGLE_API_KEY', key)
    monkeypatch.setenv('EINSTEIN_FREE_TIER_PROOF', json.dumps(deployment_attestation(key, **change)))
    assert not DeploymentConfig(tmp_path).status()['available']


def test_same_suffix_different_key_cannot_use_deployment_attestation(tmp_path, monkeypatch):
    key = 'AIza' + 'x' * 35
    monkeypatch.setenv('GOOGLE_API_KEY', 'AIza' + 'y' * 31 + 'xxxx')
    monkeypatch.setenv('EINSTEIN_FREE_TIER_PROOF', json.dumps(deployment_attestation(key)))
    assert not DeploymentConfig(tmp_path).status()['available']


def test_legacy_environment_verification_still_expires(tmp_path, monkeypatch):
    key = 'AIza' + 'x' * 35
    proof = deployment_attestation(key)
    proof.pop('deployment_verification')
    monkeypatch.setenv('GOOGLE_API_KEY', key)
    monkeypatch.setenv('EINSTEIN_FREE_TIER_PROOF', json.dumps(proof))
    assert not DeploymentConfig(tmp_path).status()['available']


@pytest.mark.parametrize('url', ['http://public.example','https://public.example/extra','https://person:password@public.example','https://public.example/?x=1'])
def test_deployment_requires_exact_secure_origin(url):
    with pytest.raises(ValueError): public_origin(url)
