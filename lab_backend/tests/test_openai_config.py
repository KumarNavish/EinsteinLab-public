"""No-network checks for paid public access, secret binding and budget expiry."""
from datetime import datetime, timedelta, timezone
import hashlib
import json

import pytest

from lab_backend.openai_config import OpenAIDeploymentConfig

KEY = 'sk-proj-' + 'synthetic_test_credential_' * 3


def configured(monkeypatch, root, **changes):
    now = datetime.now(timezone.utc)
    proof = {
        'model': 'gpt-live-1', 'project_id': 'proj_SyntheticEinsteinOnly',
        'external_processing_approved': True, 'hard_limit_enforced': True,
        'automatic_reload': False, 'model_access_verified': True,
        'monthly_limit_usd': 75, 'confirmed_credit_usd': 100,
        'budget_period': now.strftime('%Y-%m'),
        'verified_at': (now - timedelta(minutes=1)).isoformat(),
        'expires_at': (now + timedelta(hours=1)).isoformat(),
        'key_sha256': hashlib.sha256(KEY.encode()).hexdigest(),
    } | changes
    monkeypatch.setenv('OPENAI_API_KEY', KEY)
    monkeypatch.setenv('EINSTEIN_OPENAI_APPROVAL', json.dumps(proof))
    return OpenAIDeploymentConfig(root)


def test_only_the_approved_key_can_use_a_single_consumption_permit(tmp_path, monkeypatch):
    config = configured(monkeypatch, tmp_path)
    token = config.issue_permit()
    assert config.use_permit(token) == KEY
    with pytest.raises(ValueError):
        config.use_permit(token)
    status = config.status()
    assert status['available'] and status['funding_verified']
    assert status['free_tier_verified'] is False
    assert status['provider'] == 'OpenAI' and status['model'] == 'gpt-live-1'
    assert KEY not in json.dumps(status) and 'key_sha256' not in status
    monkeypatch.setenv('OPENAI_API_KEY', KEY + 'different')
    assert not config.status()['available']
    with pytest.raises(ValueError):
        config.issue_permit()


@pytest.mark.parametrize('changes', [
    {'budget_period': '2000-01'}, {'automatic_reload': True},
    {'external_processing_approved': False}, {'hard_limit_enforced': False},
    {'model_access_verified': False}, {'monthly_limit_usd': 76},
    {'monthly_limit_usd': True}, {'confirmed_credit_usd': 0},
    {'expires_at': '2000-01-01T00:00:00+00:00'},
    {'expires_at': '2099-01-01T00:00:00'},
    {'verified_at': '2099-01-01T00:00:00+00:00'},
    {'project_id': '../other-project'}, {'model': 'gpt-live-1.1'},
])
def test_spending_or_funding_mismatch_fails_closed(tmp_path, monkeypatch, changes):
    config = configured(monkeypatch, tmp_path, **changes)
    assert not config.status()['available']
    with pytest.raises(ValueError):
        config.issue_permit()


def test_missing_approval_never_uses_google_or_local_credentials(tmp_path, monkeypatch):
    monkeypatch.delenv('EINSTEIN_OPENAI_APPROVAL', raising=False)
    monkeypatch.setenv('OPENAI_API_KEY', KEY)
    monkeypatch.setenv('GOOGLE_API_KEY', 'synthetic-unused-google-credential')
    config = OpenAIDeploymentConfig(tmp_path)
    assert not config.status()['available']
    assert not list(tmp_path.iterdir())
    with pytest.raises(ValueError):
        config.store_operator_key(KEY, True)


def test_designed_voice_is_operator_pinned_without_mutating_stock_defaults(tmp_path, monkeypatch):
    monkeypatch.setenv('EINSTEIN_OPENAI_VOICE_ID', 'voice_SyntheticDesigned')
    custom = OpenAIDeploymentConfig(tmp_path)
    assert custom.default_voice == 'voice_SyntheticDesigned'
    assert set(custom.voices) == {'voice_SyntheticDesigned', 'flitz', 'cedar', 'marin'}
    assert custom.voices[custom.default_voice]['label'] == 'Elder German · designed'
    monkeypatch.delenv('EINSTEIN_OPENAI_VOICE_ID')
    stock = OpenAIDeploymentConfig(tmp_path)
    assert stock.default_voice == 'flitz'
    assert set(stock.voices) == {'flitz', 'cedar', 'marin'}


@pytest.mark.parametrize('value', ['', 'flitz', 'voice_', 'voice_unsafe/id',
                                  ' voice_Synthetic', 'voice_Synthetic\n', 'voice_' + 'a' * 129])
def test_invalid_operator_voice_pin_fails_closed_without_echo(tmp_path, monkeypatch, value):
    monkeypatch.setenv('EINSTEIN_OPENAI_VOICE_ID', value)
    with pytest.raises(ValueError, match='^The configured OpenAI voice ID needs an operator check\\.$'):
        OpenAIDeploymentConfig(tmp_path)


@pytest.mark.parametrize(('chosen_voice', 'pinned_voice'), [
    (None, None), ('cedar', None), ('marin', None),
    (None, 'voice_SyntheticDesigned'),
    ('voice_SyntheticDesigned', 'voice_SyntheticDesigned'),
    ('cedar', 'voice_SyntheticDesigned'),
])
def test_public_openai_wiring_uses_actual_voice_and_preserves_continuous_events(
        tmp_path, monkeypatch, chosen_voice, pinned_voice):
    """An in-process fixture, with every outbound provider constructor blocked."""
    import asyncio
    from contextlib import asynccontextmanager
    from types import SimpleNamespace
    from fastapi.testclient import TestClient
    import google.genai
    import lab_backend.openai_live as live
    from lab_backend.public_service import create_app

    if pinned_voice is None:
        monkeypatch.delenv('EINSTEIN_OPENAI_VOICE_ID', raising=False)
    else:
        monkeypatch.setenv('EINSTEIN_OPENAI_VOICE_ID', pinned_voice)
    expected_voice = chosen_voice or pinned_voice or 'flitz'
    configured(monkeypatch, tmp_path)
    monkeypatch.setenv('EINSTEIN_PROVIDER', 'openai')
    monkeypatch.setenv('EINSTEIN_USAGE_PATH', str(tmp_path / 'usage.sqlite3'))
    sessions = []

    def forbidden(*args, **kwargs):
        raise AssertionError('An offline test attempted an external provider connection')

    monkeypatch.setattr(google.genai, 'Client', forbidden)
    monkeypatch.setattr(live, 'connect', forbidden)

    class Session:
        def __init__(self):
            self.queue = asyncio.Queue()
            self.usage = {'voice_seconds': 0, 'final_usage_confirmed': False}

        async def send_client_content(self, **kwargs):
            await self.queue.put(live.envelope(content={
                'output_transcription': SimpleNamespace(text='Disclosed offline protocol fixture.'),
                'model_turn': SimpleNamespace(parts=[SimpleNamespace(inline_data=SimpleNamespace(
                    data=bytes(960), mime_type='audio/pcm;rate=24000'))]),
            }))

        async def receive(self):
            yield await self.queue.get()

    @asynccontextmanager
    async def factory(key, system, declarations, *, voice, voice_instructions):
        assert key == KEY and voice == expected_voice
        actual = live.configuration(system, declarations, voice, voice_instructions=voice_instructions)
        assert actual['model'] == 'gpt-live-1'
        assert actual['audio']['output']['voice'] == (
            {'id': expected_voice} if expected_voice == pinned_voice else expected_voice)
        from lab_backend.voice_direction import DESIGNED_VOICE_PROMPT
        assert (DESIGNED_VOICE_PROMPT in actual['instructions']) == (expected_voice == pinned_voice)
        assert 'clearly audible, natural German accent' in actual['instructions']
        assert 'male scientist in his late seventies' in actual['instructions']
        assert actual['delegation']['responses']['model'] == 'gpt-6.1-sol'
        assert 'Gemini 3.8 Flash' not in system
        session = Session()
        sessions.append(session)
        try:
            yield session
        finally:
            session.usage.update(voice_seconds=1.0, final_usage_confirmed=True)

    monkeypatch.setattr(live, 'openai_session', factory)
    # The real snapshot is a separately pinned release input, absent from a
    # clean checkout. Keep this wiring fixture independent of operator data.
    data = tmp_path / 'lab_backend/data'
    data.mkdir(parents=True)
    (data / 'lab.json').write_text(json.dumps({'pages': [{
        'url': 'https://mobililab.ethz.ch/?research-proj-posts=synthetic',
        'title': 'Synthetic wiring fixture', 'text': 'Offline fixture only.',
    }]}))
    (data.parent / 'project_briefs.json').write_text(json.dumps({
        'disclosure': 'Offline fixture only.', 'projects': {},
    }))
    app = create_app(tmp_path, origin='http://testserver', private_qa=True)
    with TestClient(app) as client:
        status = client.get('/api/native/status').json()
        assert status['provider'] == 'OpenAI' and status['continuous_audio'] is True
        assert set(status['voices']) == {'flitz', 'cedar', 'marin'} | ({pinned_voice} if pinned_voice else set())
        assert status['default_voice'] == (pinned_voice or 'flitz')
        assert status['research']['model'] == 'gpt-6.1-sol'
        assert KEY not in json.dumps(status)
        headers = {'origin': 'http://testserver'}
        assert client.post('/api/native/permit', headers=headers, json={'voice': 'Algenib'}).status_code == 403
        assert client.post('/api/native/permit', headers=headers, json={'voice': 'voice_ClientSupplied'}).status_code == 403
        options = {} if chosen_voice is None else {'voice': chosen_voice}
        permit = client.post('/api/native/permit', headers=headers, json=options).json()
        assert permit['model'] == 'gpt-live-1'
        assert permit['voice'] == expected_voice
        with client.websocket_connect('/api/native/voice?permit=' + permit['permit'], headers=headers) as socket:
            connected = socket.receive_json()
            assert connected['provider'] == 'OpenAI' and connected['continuous_audio'] is True
            assert connected['voice'] == expected_voice
            socket.send_json({'type': 'text', 'text': 'Synthetic wiring check.'})
            # Cached source context may be emitted before the same continuous
            # provider events; source delivery must not manufacture a turn end.
            first = socket.receive_json()
            if first['event'] == 'sources':
                assert socket.receive_json()['event'] == 'lab_cache_hit'
                first = socket.receive_json()
            assert first['event'] == 'output_transcript'
            assert socket.receive_json()['event'] == 'audio'
            socket.send_json({'type': 'stop'})
        status = client.get('/api/native/status').json()
        assert not status['active'] and status['room_active_sessions'] == 0
        assert status['last_session']['provider_usage']['final_usage_confirmed'] is True
        assert status['last_session']['turns'] == 0  # Live never supplied a completion event.
    assert len(sessions) == 1
