#!/usr/bin/env python3
"""Exercise the real public app with only locked deployment dependencies.

Requires the public lab snapshot. Run without credentials; no provider call or
external connection is allowed. This checks runtime packaging, not live voice.
"""
import ipaddress
import json
import os
from pathlib import Path
import sys

root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root))
if os.environ.get('GOOGLE_API_KEY') or os.environ.get('EINSTEIN_FREE_TIER_PROOF'):
    raise SystemExit('Run this offline check with provider environment variables empty.')


def guard(event, arguments):
    if event == 'socket.connect' and isinstance(arguments[1], tuple):
        try:
            allowed = ipaddress.ip_address(arguments[1][0]).is_loopback
        except ValueError:
            allowed = False
        if not allowed:
            raise RuntimeError('This runtime check refuses external connections.')


sys.addaudithook(guard)
from fastapi.testclient import TestClient
from lab_backend.public_service import create_app

origin = 'https://runtime.example.test'
app = create_app(root, origin=origin)
with TestClient(app, base_url=origin) as client:
    health = client.get('/api/health')
    assert health.status_code == 200 and health.json()['local_mode_available'] is False
    response = client.get('/api/native/status')
    assert response.status_code == 200
    status = response.json()
    assert status['available'] is False and status['provider_session_verified'] is False
    assert 'Secure' in response.headers['set-cookie'] and 'HttpOnly' in response.headers['set-cookie']
    # StaticFiles answers 405 for POST after the absent API route falls through.
    assert client.post('/api/native/configure', headers={'origin': origin}).status_code in {404, 405}
    assert client.get('/api/health', headers={'origin': 'https://other.example.test'}).status_code == 403
    assert client.get('/assets/einstein.glb').status_code == 503
print(json.dumps({'passed': True, 'scope': 'Actual public runtime and readiness with no key, provider or external connection.'}))
