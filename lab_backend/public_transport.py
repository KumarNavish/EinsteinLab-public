"""One logical conversation across explicitly renewed browser WebSockets.

Only a fenced, live channel can accept its next single-use ticket. Unexpected
disconnects end the conversation; this is not session recovery or a new permit.
The provider task and its original deadline remain owned by the caller.
"""
import asyncio
from collections import deque
import json
import logging
import re
import secrets

from fastapi import WebSocketDisconnect

MAX_BUFFER_BYTES = 1_048_576
RENEW_AFTER_MS = 210_000
HANDOFF_SECONDS = 15


class _PermitLogFilter(logging.Filter):
    def filter(self, record):
        def clean(value):
            return re.sub(r'([?&]permit=)[^&\s"\']+', r'\1[redacted]', value) if isinstance(value, str) else value
        record.msg = clean(record.msg)
        if isinstance(record.args, tuple):
            record.args = tuple(clean(value) for value in record.args)
        elif isinstance(record.args, dict):
            record.args = {key: clean(value) for key, value in record.args.items()}
        return True


def redact_transport_logs():
    for name in ('uvicorn.error', 'uvicorn.access'):
        logger = logging.getLogger(name)
        if not any(isinstance(item, _PermitLogFilter) for item in logger.filters):
            logger.addFilter(_PermitLogFilter())


class RenewableWebSocket:
    def __init__(self, socket, *, renew_after_ms=RENEW_AFTER_MS, handoff_seconds=HANDOFF_SECONDS):
        self.socket = socket
        self.headers, self.query_params = socket.headers, socket.query_params
        self.renew_after_ms, self.handoff_seconds = renew_after_ms, handoff_seconds
        self.closed = False
        self.ticket = secrets.token_urlsafe(32)
        self.sequence = self.renewals = self.peak_buffer_bytes = 0
        self.replay, self.replay_bytes, self.input_bytes = deque(), 0, 0
        self.input = asyncio.Queue(maxsize=128)
        self.lock = asyncio.Lock()
        self.readers, self.detached = {}, {socket: asyncio.Event()}
        self.fence_after = self.old_socket = self.awaiting_ack = None
        self.grace = None
        self.stop_requested = False
        self.disconnect_code = None
        self.cleanup = None

    def status(self):
        return {'kind': 'renewable-websocket', 'renewals': self.renewals,
                'peak_buffer_bytes': self.peak_buffer_bytes, 'closed': self.closed}

    async def accept(self):
        if self.closed or self.cleanup is not None or self.stop_requested:
            raise WebSocketDisconnect(self.disconnect_code or 1001)
        await self.socket.accept()
        if self.closed or self.cleanup is not None or self.stop_requested:
            raise WebSocketDisconnect(self.disconnect_code or 1001)
        await self._hello(self.socket)
        if self.closed or self.cleanup is not None or self.stop_requested:
            raise WebSocketDisconnect(self.disconnect_code or 1001)
        self.readers[self.socket] = asyncio.create_task(self._read(self.socket))

    async def _hello(self, socket):
        await socket.send_json({'event': 'transport_ready', 'ticket': self.ticket,
                                'renew_after_ms': self.renew_after_ms})

    def _room(self, count):
        while self.replay and self.replay_bytes + self.input_bytes + count > MAX_BUFFER_BYTES:
            if self.fence_after is not None and self.replay[0][0] > self.fence_after:
                break
            self.replay_bytes -= self.replay.popleft()[2]
        fits = self.replay_bytes + self.input_bytes + count <= MAX_BUFFER_BYTES
        if fits:
            self.peak_buffer_bytes = max(self.peak_buffer_bytes, self.replay_bytes + self.input_bytes + count)
        return fits

    async def send_json(self, value):
        async with self.lock:
            if self.stop_requested:
                return
            if self.closed:
                raise WebSocketDisconnect(self.disconnect_code or 1001)
            sequence = self.sequence + 1
            wire = json.dumps({**value, 'transport_seq': sequence}, separators=(',', ':'), allow_nan=False)
            size = len(wire.encode('utf-8'))
            if not self._room(size):
                await self._disconnect(1009)
                raise WebSocketDisconnect(1009)
            self.sequence = sequence
            self.replay.append((sequence, wire, size))
            self.replay_bytes += size
            try:
                await self.socket.send_text(wire)
            except Exception:
                if not self.stop_requested:
                    raise

    async def receive(self):
        message, size = await self.input.get()
        self.input_bytes -= size
        return message

    async def hold(self, socket):
        """A request owns only its carrier, never the background conversation."""
        try:
            await self.detached[socket].wait()
        except asyncio.CancelledError:
            await self._lost(socket, 1006)
            raise

    async def renew(self, socket, ticket, after):
        async with self.lock:
            if (self.closed or self.stop_requested or self.fence_after is None or self.awaiting_ack is not None
                    or self.renewals >= 3 or not isinstance(ticket, str) or len(ticket) != 43 or not ticket.isascii()
                    or not secrets.compare_digest(ticket, self.ticket or '')
                    or type(after) is not int or not self.fence_after <= after <= self.sequence
                    or (self.replay and after < self.replay[0][0] - 1)):
                await socket.close(code=1008)
                return False
            await socket.accept()
            if self.closed or self.stop_requested:
                await socket.close(code=1008)
                return False
            self.old_socket, self.socket, self.awaiting_ack = self.socket, socket, socket
            self.detached[socket] = asyncio.Event()
            self.ticket = secrets.token_urlsafe(32)
            try:
                for sequence, wire, _ in tuple(self.replay):
                    if self.closed or self.stop_requested:
                        await socket.close(code=1008)
                        return False
                    if sequence > after:
                        await socket.send_text(wire)
                await self._hello(socket)
                if self.closed or self.stop_requested:
                    await socket.close(code=1008)
                    return False
            except Exception:
                await self._disconnect(1006)
                return False
            self.readers[socket] = asyncio.create_task(self._read(socket))
            return True

    async def _read(self, socket):
        try:
            while not self.closed:
                message = await socket.receive()
                if message['type'] == 'websocket.disconnect':
                    await self._lost(socket, message.get('code', 1006))
                    return
                text, data = message.get('text'), message.get('bytes')
                size = len(text.encode('utf-8')) if isinstance(text, str) else len(data or b'')
                if size > (420_000 if text is not None else 16_384):
                    await self._disconnect(1009)
                    return
                value = None
                if text is not None:
                    try:
                        value = json.loads(text)
                    except (ValueError, TypeError):
                        pass  # The unchanged bridge validates application JSON.
                kind = value.get('type') if isinstance(value, dict) else None
                if kind == 'stop':
                    self.stop_requested = True
                    self.ticket = None
                    if self.grace:
                        self.grace.cancel()
                    while not self.input.empty():
                        self.input.get_nowait()
                    self.input_bytes = 0
                    self.replay.clear()
                    self.replay_bytes = 0
                    self.input.put_nowait((message, size))
                    self.input_bytes = size
                    return
                if kind == 'transport_fence' and socket is self.socket and self.fence_after is None:
                    after = value.get('after')
                    if (type(after) is not int or not 0 <= after <= self.sequence
                            or (self.replay and after < self.replay[0][0] - 1)):
                        await self._disconnect(1008)
                        return
                    self.fence_after = after
                    self.grace = asyncio.create_task(self._expire_handoff())
                    await socket.send_json({'event': 'transport_fenced'})
                    continue
                if kind == 'transport_ack' and socket is self.awaiting_ack:
                    old = self.old_socket
                    self.awaiting_ack = self.old_socket = self.fence_after = None
                    self.renewals += 1
                    self.grace.cancel()
                    self.detached[old].set()
                    self.readers[old].cancel()
                    await self._close_socket(old, 1000)
                    continue
                if socket is not self.socket or self.fence_after is not None or self.awaiting_ack is not None:
                    await self._disconnect(1008)
                    return
                if not self._enqueue(message, size):
                    await self._disconnect(1009)
                    return
        except asyncio.CancelledError:
            raise
        except WebSocketDisconnect as error:
            await self._lost(socket, error.code)
        except Exception:
            await self._lost(socket, 1006)

    def _enqueue(self, message, size):
        if self.input.full() or not self._room(size):
            return False
        self.input_bytes += size
        self.input.put_nowait((message, size))
        return True

    async def _expire_handoff(self):
        await asyncio.sleep(self.handoff_seconds)
        await self._disconnect(1008)

    async def _lost(self, socket, code):
        self.detached[socket].set()
        if socket is self.socket and not self.stop_requested:
            await self._disconnect(code)

    async def _disconnect(self, code):
        if self.closed:
            return
        self.closed = True
        self.ticket = None
        if self.disconnect_code is None:
            self.disconnect_code = code if type(code) is int and 1000 <= code <= 4999 else 1006
        while not self.input.empty():
            self.input.get_nowait()
        self.input_bytes = 0
        self.input.put_nowait(({'type': 'websocket.disconnect',
            'code': self.disconnect_code}, 0))
        await self.close()

    @staticmethod
    async def _close_socket(socket, code):
        try:
            async with asyncio.timeout(1):
                await socket.close(code=code if code != 1006 else 1001)
        except Exception:
            pass

    async def close(self, code=1000):
        if self.disconnect_code is None:
            self.disconnect_code = code if type(code) is int and 1000 <= code <= 4999 else 1000
        if self.cleanup is None:
            self.cleanup = asyncio.create_task(self._cleanup())
        await asyncio.shield(self.cleanup)

    async def _cleanup(self):
        self.closed = True
        self.ticket = None
        while not self.input.empty():
            self.input.get_nowait()
        self.input_bytes = 0
        self.input.put_nowait(({'type': 'websocket.disconnect', 'code': self.disconnect_code or 1000}, 0))
        current = asyncio.current_task()
        if self.grace and self.grace is not current:
            self.grace.cancel()
        for task in self.readers.values():
            if task is not current:
                task.cancel()
        for socket, detached in self.detached.items():
            detached.set()
            await self._close_socket(socket, self.disconnect_code or 1000)
        await asyncio.gather(*(task for task in self.readers.values() if task is not current), return_exceptions=True)
        self.replay.clear()
        self.replay_bytes = 0
