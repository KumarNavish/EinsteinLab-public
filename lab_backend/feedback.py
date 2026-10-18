"""Private, bounded feedback storage. No transcripts, IP addresses or provider keys.

SQLite is suitable only with a persistent deployment volume. A public release
must not confuse this local store with durable storage on an ephemeral free host.
"""
from __future__ import annotations
import hashlib
import asyncio
from contextlib import contextmanager
import json
import os
from pathlib import Path
import secrets
import sqlite3
import threading
import time
from uuid import UUID
from urllib.parse import urlsplit
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
from .http_body import bounded_body


class FeedbackStore:
    def __init__(self, path: Path, *, clock=time.time, daily_limit=500):
        self.path = path
        self.clock = clock
        self.daily_limit = daily_limit
        self.lock = threading.Lock()
        self.salt = secrets.token_bytes(32)
        self.recent = {}
        self.permits = {}

    @contextmanager
    def connect(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.parent.chmod(0o700)
        connection = sqlite3.connect(self.path, timeout=5)
        self.path.chmod(0o600)
        connection.execute('CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY, created_at REAL NOT NULL, payload TEXT NOT NULL, digest TEXT NOT NULL)')
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def permit(self, remote: str):
        now = self.clock()
        address = hashlib.sha256(self.salt + remote.encode()).hexdigest()
        with self.lock:
            self.permits = {k:v for k,v in self.permits.items() if v['expires'] > now}
            self.recent = {k:v for k,v in self.recent.items() if v > now - 3600}
            if len(self.permits) >= 512:
                raise ValueError('Feedback is busy; please try later.')
            token = secrets.token_urlsafe(24)
            self.permits[token] = {'address': address, 'expires': now + 900}
        return token

    def submit(self, body: dict, remote: str):
        if not isinstance(body, dict) or set(body) - {'request_id','permit','rating','realism','voice','kind','message','context','website'}:
            raise ValueError('Unexpected feedback fields')
        try: identity = str(UUID(body['request_id']))
        except (ValueError, KeyError, TypeError): raise ValueError('Invalid submission identifier')
        for field in ['rating','realism','voice']:
            value = body.get(field)
            if value is None and field != 'rating': continue
            if type(value) is not int or not 1 <= value <= 5:
                raise ValueError('Ratings must be between one and five')
        if body.get('kind') not in {'impression','bug','suggestion'}:
            raise ValueError('Choose a feedback category')
        for field, limit in [('message',2000),('context',1000),('website',100)]:
            if not isinstance(body.get(field,''), str) or len(body.get(field,'')) > limit:
                raise ValueError('Feedback text is too long')
        # Do not store the honeypot or collect anything outside explicit form fields.
        if body.get('website'): return {'received': True, 'id': identity}
        value = {key:body.get(key) for key in ['rating','realism','voice','kind','message','context']}
        payload = json.dumps(value, ensure_ascii=False, sort_keys=True)
        digest = hashlib.sha256(payload.encode()).hexdigest()
        address = hashlib.sha256(self.salt + remote.encode()).hexdigest()
        now = self.clock()
        with self.lock, self.connect() as connection:
            existing = connection.execute('SELECT digest FROM feedback WHERE id=?',(identity,)).fetchone()
            if existing:
                if not secrets.compare_digest(existing[0],digest): raise ValueError('Submission identifier was already used for different feedback')
                return {'received':True,'id':identity,'duplicate':True}
            permit = self.permits.get(body.get('permit',''))
            if not permit or permit['expires'] <= now or permit['address'] != address:
                raise ValueError('The feedback form expired. Reopen it and try again.')
            if self.recent.get(address,0) > now - 60:
                raise ValueError('Please wait a minute before submitting another entry.')
            count = connection.execute('SELECT COUNT(*) FROM feedback WHERE created_at>?',(now-86400,)).fetchone()[0]
            if count >= self.daily_limit: raise ValueError('The daily feedback limit was reached.')
            connection.execute('INSERT INTO feedback VALUES (?,?,?,?)',(identity,now,payload,digest))
            self.permits.pop(body['permit'],None)
            self.recent[address] = now
        return {'received':True,'id':identity}

    def read(self, limit=100):
        with self.lock, self.connect() as connection:
            rows = connection.execute('SELECT id,created_at,payload FROM feedback ORDER BY created_at DESC LIMIT ?',(min(500,max(1,limit)),)).fetchall()
        return [{'id':row[0],'created_at':row[1],**json.loads(row[2])} for row in rows]

    def delivery(self, identity, state=None):
        with self.lock, self.connect() as connection:
            connection.execute('CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, state TEXT NOT NULL)')
            if state:
                connection.execute('INSERT OR REPLACE INTO deliveries VALUES (?,?)', (identity, state))
            row = connection.execute('SELECT state FROM deliveries WHERE id=?', (identity,)).fetchone()
            return row[0] if row else None


def feedback_router(root: Path, *, delivery=None, require_delivery=False):
    path = Path(os.environ.get('EINSTEIN_FEEDBACK_PATH', str(root / '.work/private/feedback.sqlite3')))
    store = FeedbackStore(path)
    router = APIRouter(prefix='/api/feedback')
    delivery_lock = asyncio.Lock()

    def check(request):
        if require_delivery and delivery is None:
            raise HTTPException(503, 'Private feedback collection is temporarily unavailable.')
        host = request.headers.get('host','')
        origin = request.headers.get('origin')
        configured = os.getenv('EINSTEIN_PUBLIC_ORIGIN')
        valid_host = urlsplit('http://'+host).hostname in {'127.0.0.1','localhost','testserver'}
        if configured: valid_host = valid_host or host == urlsplit(configured).netloc
        if not valid_host or (origin and urlsplit(origin).netloc != host):
            raise HTTPException(403,'Same-origin request required')
        return request.client.host if request.client else 'unknown'

    @router.get('/permit')
    def permit(request: Request):
        address = check(request)
        try: token = store.permit(address)
        except ValueError as error: raise HTTPException(429,str(error))
        return JSONResponse({'permit':token,'privacy':'Only the fields you submit are stored. No microphone audio, transcript, IP address or email is stored with feedback.'},headers={'Cache-Control':'no-store'})

    @router.post('')
    async def submit(request: Request):
        address = check(request)
        raw = await bounded_body(request, 6000)
        if len(raw) > 6000: raise HTTPException(413,'Feedback is too large')
        try:
            body = json.loads(raw)
            result = store.submit(body,address)
        except (ValueError, TypeError) as error: raise HTTPException(400,str(error))
        if delivery and not body.get('website'):
            async with delivery_lock:
                state = store.delivery(result['id'])
                if state == 'uncertain' and not getattr(delivery, 'idempotent', False):
                    raise HTTPException(409, 'Delivery could not be confirmed. Keep submission ' + result['id'] + ' for the owner to check; it will not be sent twice automatically.')
                if state != 'accepted':
                    # Record the uncertainty before dispatch, including a process
                    # crash between the external write and its receipt.
                    store.delivery(result['id'], 'uncertain')
                    try:
                        await delivery.submit({key: body.get(key) for key in ['request_id','rating','realism','voice','kind','message','context']})
                    except Exception:
                        raise HTTPException(503, 'Feedback delivery could not be confirmed. Keep submission ' + result['id'] + ' for the owner to check.')
                    store.delivery(result['id'], 'accepted')
                result['collection'] = getattr(delivery, 'collection', 'private-netlify-form')
        return JSONResponse(result,headers={'Cache-Control':'no-store'})

    return router, store
