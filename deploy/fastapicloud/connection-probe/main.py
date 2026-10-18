"""Keyless duration proof using the production browser-carrier adapter verbatim."""
import asyncio
import secrets
import time

from fastapi import FastAPI, Request, Response, WebSocket
from public_transport import RenewableWebSocket, redact_transport_logs

redact_transport_logs()
app = FastAPI()
records = {}
COOKIE = 'einstein_connection_probe'


@app.get('/')
def status(request: Request, response: Response):
    token = request.cookies.get(COOKIE)
    if token not in records:
        if len(records) >= 16:
            for stale in [key for key, value in records.items() if not value['active']]:
                records.pop(stale)
        if len(records) >= 16:
            response.status_code = 429
            return {'provider_requests': 0, 'state': 'capacity'}
        token = secrets.token_urlsafe(32)
        records[token] = {'active': False, 'starts': 0, 'last': None}
    response.set_cookie(COOKIE, token, httponly=True, secure=request.url.scheme == 'https', samesite='strict')
    record = records[token]
    return {'probe': 'einstein-renewable-websocket-duration', 'provider_requests': 0,
            'maximum_seconds': 600, 'active': record['active'], 'starts': record['starts'], 'last': record['last']}


def owner(socket):
    host, origin = socket.headers.get('host', ''), socket.headers.get('origin')
    scheme = 'http' if host.startswith(('127.0.0.1:', 'localhost:')) else 'https'
    if origin != scheme + '://' + host:
        return None
    return records.get(socket.cookies.get(COOKIE))


async def conversation(record, channel):
    began, sent, received = time.monotonic(), 0, 0
    outcome = 'deadline'
    try:
        await channel.accept()
        while time.monotonic() - began < 600:
            await channel.send_json({'elapsed_seconds': round(time.monotonic() - began, 3)})
            sent += 1
            try:
                message = await asyncio.wait_for(channel.receive(), 1)
                if message['type'] == 'websocket.disconnect':
                    outcome = 'disconnected'; break
                if message.get('text') == '{"type":"stop"}':
                    outcome = 'stopped'; break
                if message.get('text') != 'tick':
                    outcome = 'invalid_input'; break
                received += 1
            except TimeoutError:
                pass
    except Exception:
        outcome = 'transport_failure'
    finally:
        await channel.close()
        record['active'] = False
        record['last'] = {'elapsed_seconds': round(time.monotonic() - began, 3),
            'frames_sent': sent, 'ticks_received': received, 'outcome': outcome, **channel.status()}


@app.websocket('/ws')
async def initial(socket: WebSocket):
    record = owner(socket)
    if record is None or record['active'] or sum(value['active'] for value in records.values()) >= 2:
        await socket.close(code=1008); return
    record['active'] = True
    record['starts'] += 1
    channel = record['channel'] = RenewableWebSocket(socket)
    record['task'] = asyncio.create_task(conversation(record, channel))
    await channel.hold(socket)


@app.websocket('/api/native/renew')
async def renew(socket: WebSocket):
    record = owner(socket)
    try:
        after = int(socket.query_params.get('after', ''))
    except ValueError:
        after = -1
    if record is None or not record['active']:
        await socket.close(code=1008); return
    channel = record['channel']
    if await channel.renew(socket, socket.query_params.get('permit'), after):
        await channel.hold(socket)
