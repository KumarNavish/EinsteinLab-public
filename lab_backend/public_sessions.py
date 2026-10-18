"""Bounded anonymous visitors for the native-only public application.

Only random cookies, salted network digests and usage counters are retained.
Conversation state stays inside each visitor's NativeBridge. No provider key is
accepted from a public browser. Durable deployment attestation requires an
unlinked billing account and an exact credential fingerprint.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import threading
import time
from urllib.parse import urlsplit

from .native_config import NativeConfig, valid_provider_key

COOKIE = 'einstein_visitor'


class DeploymentConfig(NativeConfig):
    def approval(self):
        proof = self.read_proof()
        if not isinstance(proof, dict):
            raise ValueError('The deployment billing verification must be an object.')
        mode = proof.get('deployment_verification')
        if mode is None:
            return super().approval()
        if mode != 'unlinked-project':
            raise ValueError('Unknown deployment billing verification method.')
        proof = super().approval(maximum_age=None)
        if (proof.get('billing_account_linked') is not False
                or not isinstance(proof.get('project_id'), str)
                or not re.fullmatch(r'[a-z][a-z0-9-]{4,28}[a-z0-9]', proof['project_id'])
                or not isinstance(proof.get('key_sha256'), str)
                or not re.fullmatch(r'[a-f0-9]{64}', proof['key_sha256'])):
            raise ValueError('Deployment requires an unlinked Google project bound to the exact verified key.')
        return proof

    def read_proof(self):
        raw = os.environ.get('EINSTEIN_FREE_TIER_PROOF', '')
        if not raw:
            raise ValueError('The host has no current non-billable-project verification.')
        return json.loads(raw)

    def credential(self):
        proof = self.approval()
        key = os.environ.get('GOOGLE_API_KEY', '')
        if (not valid_provider_key(key) or not key.endswith(proof['existing_key_suffix'])
                or (proof.get('deployment_verification') == 'unlinked-project'
                    and not secrets.compare_digest(hashlib.sha256(key.encode()).hexdigest(), proof['key_sha256']))):
            raise ValueError('The hosting secret does not match the verified free-tier project.')
        return key

    def status(self):
        status = super().status()
        if status.get('free_tier_verified'):
            proof = self.read_proof()
            if proof.get('deployment_verification') == 'unlinked-project':
                status.update(verification_expires=None, billing_verified_at=proof['verified_at'],
                              verification_basis='unlinked-project-at-deployment')
        return status

    def store_operator_key(self, *_):
        raise ValueError('Public credential configuration is disabled. Use the host secret store.')


class UsageBudget:
    """Reserve full ten-minute sessions before connecting to the provider.

    The SQLite file survives process restarts on a persistent volume. On an
    ephemeral free host its loss resets counters: the non-billable Google
    project remains the financial boundary, never these application counters.
    """
    def __init__(self, path: Path, *, daily_sessions=12, per_network=4, clock=time.time):
        self.path, self.daily_sessions, self.per_network, self.clock = path, daily_sessions, per_network, clock
        self.lock = threading.Lock()

    def reserve(self, network):
        day = int(self.clock() // 86400)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.parent.chmod(0o700)
        with self.lock, sqlite3.connect(self.path, timeout=5) as db:
            self.path.chmod(0o600)
            db.execute('CREATE TABLE IF NOT EXISTS reservations (day INTEGER NOT NULL, network TEXT NOT NULL)')
            db.execute('BEGIN IMMEDIATE')
            db.execute('DELETE FROM reservations WHERE day < ?', (day - 1,))
            total = db.execute('SELECT count(*) FROM reservations WHERE day=?', (day,)).fetchone()[0]
            personal = db.execute('SELECT count(*) FROM reservations WHERE day=? AND network=?', (day, network)).fetchone()[0]
            if total >= self.daily_sessions or personal >= self.per_network:
                raise ValueError('Today’s conversation allowance has been reached. Please return tomorrow.')
            db.execute('INSERT INTO reservations VALUES (?,?)', (day, network))


class Visitors:
    def __init__(self, factory, budget, *, clock=time.monotonic, capacity=2, maximum=128):
        self.factory, self.budget, self.clock = factory, budget, clock
        self.capacity, self.maximum = capacity, maximum
        self.salt = secrets.token_bytes(32)
        self.lock = threading.RLock()
        self.records = {}
        self.active = set()
        self.capacity_rejections = 0
        self.starts = {}
        self.registrations = {}

    def network(self, address):
        # Digest the transport peer only; never trust a client-supplied XFF header.
        return hashlib.sha256(self.salt + address.encode()).hexdigest()

    def get(self, token, *, create=False, network=None):
        with self.lock:
            return self._get(token, create=create, network=network)

    def _get(self, token, *, create=False, network=None):
        now = self.clock()
        self.records = {key: value for key, value in self.records.items()
                        if key in self.active or value['seen'] > now - 1800}
        if token in self.records:
            record = self.records[token]
            record['seen'] = now
            return token, record['bridge']
        if not create:
            raise ValueError('Your visitor session expired. Refresh the page to reconnect.')
        if network is not None:
            self.registrations = {key: value for key, value in self.registrations.items() if value[0] > now - 60}
            began, count = self.registrations.get(network, (now, 0))
            if count >= 16 or (network not in self.registrations and len(self.registrations) >= 512):
                raise ValueError('Please wait a minute before opening another visitor session.')
            self.registrations[network] = (began, count + 1)
        if len(self.records) >= self.maximum:
            inactive = [key for key in self.records if key not in self.active]
            if not inactive:
                raise ValueError('Einstein is welcoming other visitors. Please try again shortly.')
            oldest = min(inactive, key=lambda key: self.records[key]['seen'])
            del self.records[oldest]
        token = secrets.token_urlsafe(32)
        bridge = self.factory()
        self.records[token] = {'seen': now, 'bridge': bridge}
        return token, bridge

    def enter(self, token, network):
        with self.lock:
            now = self.clock()
            self.starts = {key: value for key, value in self.starts.items() if value > now - 60}
            if token in self.active:
                raise ValueError('The conversation room is full. Please try again shortly.')
            if len(self.active) >= self.capacity:
                self.capacity_rejections = min(self.capacity_rejections + 1, 2**31 - 1)
                raise ValueError('The conversation room is full. Please try again shortly.')
            if network in self.starts and self.starts[network] > now - 30:
                raise ValueError('Please wait a moment before starting another conversation.')
            self.budget.reserve(network)
            self.active.add(token)
            self.starts[network] = now

    def leave(self, token):
        with self.lock:
            self.active.discard(token)

    def room_status(self):
        with self.lock:
            return {'room_capacity': self.capacity, 'room_active_sessions': len(self.active),
                    'room_capacity_rejections': self.capacity_rejections}


def public_origin(value, *, private_qa=False):
    parsed = urlsplit(value)
    local = parsed.hostname in {'127.0.0.1', 'localhost', 'testserver'}
    if (parsed.scheme != 'https' and not (private_qa and local and parsed.scheme == 'http')) or not parsed.netloc or parsed.path not in {'', '/'} or parsed.query or parsed.fragment or parsed.username:
        raise ValueError('Set one exact HTTPS application origin, without a path or credentials.')
    canonical = value.rstrip('/')

    def allowed(host, origin):
        return host == parsed.netloc and (origin is None or origin == canonical)
    return canonical, allowed
