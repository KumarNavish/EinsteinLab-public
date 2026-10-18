"""Offline carrier fixtures: no credential lookup or provider connection."""
import asyncio
import json
import logging
import unittest
from fastapi import WebSocketDisconnect

from lab_backend.public_transport import MAX_BUFFER_BYTES, RenewableWebSocket, redact_transport_logs


class Socket:
    def __init__(self):
        self.headers, self.query_params = {}, {'permit': 'offline-only'}
        self.input, self.output = asyncio.Queue(), asyncio.Queue()
        self.accepted = False

    async def accept(self): self.accepted = True
    async def receive(self): return await self.input.get()
    async def send_json(self, value): self.output.put_nowait(value)
    async def send_text(self, text): self.output.put_nowait(json.loads(text))
    async def close(self, code=1000): self.output.put_nowait({'closed': code})
    async def client(self, value):
        await self.input.put({'type': 'websocket.receive', 'text': json.dumps(value)})
    async def next(self): return await asyncio.wait_for(self.output.get(), 1)


class CarrierContract(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.first = Socket()
        self.channel = RenewableWebSocket(self.first, handoff_seconds=.03)
        await self.channel.accept()
        self.hello = await self.first.next()

    async def asyncTearDown(self): await self.channel.close()

    async def fence(self, after=0):
        await self.first.client({'type': 'transport_fence', 'after': after})
        self.assertEqual(await self.first.next(), {'event': 'transport_fenced'})

    async def test_handoff_replays_ordered_events_and_preserves_one_input_stream(self):
        await self.channel.send_json({'event': 'audio', 'data': 'first'})
        self.assertEqual((await self.first.next())['transport_seq'], 1)
        await self.first.client({'type': 'text', 'text': 'before fence'})
        await self.fence(1)
        await self.channel.send_json({'event': 'document_action', 'action': {'id': 'source-owned'}})
        self.assertEqual((await self.first.next())['transport_seq'], 2)
        second = Socket()
        self.assertTrue(await self.channel.renew(second, self.hello['ticket'], 1))
        replay = await second.next()
        self.assertEqual(replay['transport_seq'], 2)
        self.assertEqual(replay['action']['id'], 'source-owned')
        next_hello = await second.next()
        self.assertNotEqual(next_hello['ticket'], self.hello['ticket'])
        await second.client({'type': 'transport_ack'})
        self.assertEqual(await self.first.next(), {'closed': 1000})
        await second.client({'type': 'text', 'text': 'after fence'})
        messages = [await asyncio.wait_for(self.channel.receive(), 1) for _ in range(2)]
        self.assertEqual([json.loads(x['text'])['text'] for x in messages], ['before fence', 'after fence'])
        self.assertEqual(self.channel.renewals, 1)
        self.assertFalse(self.channel.closed)
        self.assertFalse(await self.channel.renew(Socket(), self.hello['ticket'], 1))
        self.assertNotIn('ticket', self.channel.status())

    async def test_cancelling_old_request_after_replacement_does_not_end_channel(self):
        hold = asyncio.create_task(self.channel.hold(self.first))
        await self.fence()
        second = Socket()
        self.assertTrue(await self.channel.renew(second, self.hello['ticket'], 0))
        await second.next()
        hold.cancel()
        await asyncio.gather(hold, return_exceptions=True)
        self.assertFalse(self.channel.closed)
        await second.client({'type': 'transport_ack'})
        await self.first.next()
        await self.channel.send_json({'event': 'still-the-same-conversation'})
        self.assertEqual((await second.next())['transport_seq'], 1)

    async def test_unexpected_disconnect_ends_channel_without_resumption(self):
        await self.first.input.put({'type': 'websocket.disconnect', 'code': 1006})
        message = await asyncio.wait_for(self.channel.receive(), 1)
        self.assertEqual(message, {'type': 'websocket.disconnect', 'code': 1006})
        self.assertTrue(self.channel.closed)
        self.assertIsNone(self.channel.ticket)
        self.assertFalse(await self.channel.renew(Socket(), self.hello['ticket'], 0))

    async def test_unfinished_handoff_expires_without_a_provider_retry(self):
        await self.fence()
        self.assertEqual((await asyncio.wait_for(self.channel.receive(), 1))['type'], 'websocket.disconnect')
        self.assertTrue(self.channel.closed)

    async def test_unknown_non_ascii_ticket_and_unfenced_renewal_are_rejected(self):
        for token in (self.hello['ticket'], 'x' * 43, 'é' * 43, None):
            self.assertFalse(await self.channel.renew(Socket(), token, 0))
            self.assertFalse(self.channel.closed)

    async def test_stop_preempts_buffered_input_during_handoff(self):
        await self.first.client({'type': 'text', 'text': 'pending'})
        await self.fence()
        await self.first.client({'type': 'stop'})
        for _ in range(10):
            if self.channel.stop_requested: break
            await asyncio.sleep(0)
        message = await asyncio.wait_for(self.channel.receive(), 1)
        self.assertEqual(json.loads(message['text']), {'type': 'stop'})
        self.assertTrue(self.channel.stop_requested)
        self.assertIsNone(self.channel.ticket)
        self.assertFalse(await self.channel.renew(Socket(), self.hello['ticket'], 0))

    async def test_terminal_close_discards_private_input_and_wakes_receiver(self):
        await self.first.client({'type': 'text', 'text': 'private-only-in-memory'})
        for _ in range(10):
            if self.channel.input_bytes: break
            await asyncio.sleep(0)
        self.assertGreater(self.channel.input_bytes, 0)
        await self.channel.close()
        self.assertEqual(self.channel.input_bytes, 0)
        self.assertEqual(await self.channel.receive(), {'type': 'websocket.disconnect', 'code': 1000})
        self.assertEqual(self.channel.replay_bytes, 0)

    async def test_simultaneous_reader_disconnect_and_provider_close_complete(self):
        await self.first.client({'type': 'text', 'text': 'discard-private-input'})
        await self.first.input.put({'type': 'websocket.disconnect', 'code': 1006})
        await asyncio.wait_for(asyncio.gather(self.channel.close(), self.channel.close()), 1)
        self.assertTrue(self.channel.closed)
        self.assertEqual(self.channel.input_bytes, 0)
        self.assertEqual(self.channel.replay_bytes, 0)
        self.assertTrue(all(task.done() for task in self.channel.readers.values()))
        message = await self.channel.receive()
        self.assertEqual(message['type'], 'websocket.disconnect')
        self.assertNotIn('text', message)

    async def test_stop_during_new_socket_accept_does_not_attach_it(self):
        await self.fence()
        second = Socket()
        accepting, release = asyncio.Event(), asyncio.Event()
        async def slow_accept():
            accepting.set()
            await release.wait()
            second.accepted = True
        second.accept = slow_accept
        renewal = asyncio.create_task(self.channel.renew(second, self.hello['ticket'], 0))
        await accepting.wait()
        await self.first.client({'type': 'stop'})
        for _ in range(10):
            if self.channel.stop_requested: break
            await asyncio.sleep(0)
        release.set()
        self.assertFalse(await renewal)
        self.assertIs(self.channel.socket, self.first)
        self.assertIsNone(self.channel.ticket)
        self.assertEqual(self.channel.renewals, 0)
        self.assertEqual(json.loads((await self.channel.receive())['text']), {'type': 'stop'})

    async def test_required_replay_overflow_fails_closed_at_one_mebibyte(self):
        await self.fence()
        await self.channel.send_json({'event': 'audio', 'data': 'a' * (MAX_BUFFER_BYTES - 100)})
        await self.first.next()
        with self.assertRaises(WebSocketDisconnect):
            await self.channel.send_json({'event': 'audio', 'data': 'b' * 200})
        self.assertTrue(self.channel.closed)
        self.assertLessEqual(self.channel.peak_buffer_bytes, MAX_BUFFER_BYTES)
        self.assertEqual(await self.first.next(), {'closed': 1009})

    async def test_close_accepts_native_code_and_never_reaccepts_closed_channel(self):
        await self.channel.close(code=1008)
        self.assertEqual(await self.first.next(), {'closed': 1008})
        await self.channel.close(code=1000)
        self.assertEqual(self.channel.disconnect_code, 1008)
        with self.assertRaises(WebSocketDisconnect):
            await self.channel.accept()


def test_uvicorn_logs_redact_permit_in_format_strings_and_arguments():
    redact_transport_logs(); redact_transport_logs()
    for name in ('uvicorn.error', 'uvicorn.access'):
        logger = logging.getLogger(name)
        records = [
            logging.LogRecord(name, logging.INFO, '', 1, 'WebSocket /renew?permit=synthetic-value&after=2', (), None),
            logging.LogRecord(name, logging.INFO, '', 1, 'WebSocket %s %s', ('/voice?permit=synthetic-value', 'accepted'), None),
            logging.LogRecord(name, logging.INFO, '', 1, '%(path)s', ({'path': '/renew?permit=synthetic-value'},), None),
        ]
        for record in records:
            assert logger.filter(record)
            assert 'synthetic-value' not in record.getMessage()
            assert '[redacted]' in record.getMessage()


def test_public_routes_keep_one_room_reservation_and_one_bridge_across_renewals(tmp_path):
    from fastapi.testclient import TestClient
    from .test_native_live import configured_bridge
    from lab_backend.public_service import create_app
    from lab_backend.public_sessions import COOKIE
    import pytest
    from starlette.websockets import WebSocketDisconnect
    import sqlite3

    bridges, sessions = [], []
    def factory():
        bridge, _, created = configured_bridge(tmp_path / str(len(bridges)))
        bridges.append(bridge); sessions.append(created)
        return bridge
    app = create_app(tmp_path, origin='http://testserver', private_qa=True, bridge_factory=factory)
    headers = {'origin': 'http://testserver'}
    with TestClient(app) as alice, TestClient(app) as bob:
        alice.get('/api/native/status'); bob.get('/api/native/status')
        permit = alice.post('/api/native/permit', headers=headers).json()
        assert permit['transport'] == 'renewable-websocket'
        with alice.websocket_connect('/api/native/voice?carrier=renew-v1&permit=' + permit['permit'], headers=headers) as first:
            hello = first.receive_json()
            assert hello['event'] == 'transport_ready'
            connected = first.receive_json()
            assert connected['event'] == 'connected' and connected['transport_seq'] == 1
            first.send_json({'type': 'transport_fence', 'after': 1})
            assert first.receive_json()['event'] == 'transport_fenced'
            address = '/api/native/renew?permit=' + hello['ticket'] + '&after=1'
            for client, origin in ((bob, headers), (alice, {'origin': 'https://other.example'})):
                with pytest.raises(WebSocketDisconnect):
                    with client.websocket_connect(address, headers=origin): pass
            with alice.websocket_connect(address, headers=headers) as second:
                renewed = second.receive_json()
                assert renewed['event'] == 'transport_ready'
                second.send_json({'type': 'transport_ack'})
                with pytest.raises(WebSocketDisconnect): first.receive_json()
                assert alice.get('/api/native/status').json()['room_active_sessions'] == 1
                with pytest.raises(WebSocketDisconnect):
                    with alice.websocket_connect(address, headers=headers): pass
                second.send_json({'type': 'text', 'text': 'Same offline provider.'})
                received = [second.receive_json() for _ in range(5)]
                assert [x['transport_seq'] for x in received] == [2, 3, 4, 5, 6]
                second.send_json({'type': 'stop'})
        status = alice.get('/api/native/status').json()
        assert status['room_active_sessions'] == 0 and not status['active']
        assert status['last_session']['close_trigger'] == 'stop_requested'
        assert status['last_session']['transport']['renewals'] == 1
        assert len(sessions[0]) == 1
        assert bob.cookies[COOKIE] != alice.cookies[COOKIE]
        with sqlite3.connect(tmp_path / '.work/private/public-usage.sqlite3') as db:
            assert db.execute('select count(*) from reservations').fetchone()[0] == 1
        assert hello['ticket'] not in json.dumps(status)
        assert renewed['ticket'] not in json.dumps(status)


def test_initial_accept_or_hello_failure_cleans_flags_without_background_exception(tmp_path, monkeypatch):
    from fastapi import WebSocket
    from fastapi.testclient import TestClient
    from .test_native_live import configured_bridge
    from lab_backend.public_service import create_app
    import pytest

    for phase in ('accept', 'hello'):
        with monkeypatch.context() as patch:
            bridge, _, sessions = configured_bridge(tmp_path / phase)
            original_accept, original_send = WebSocket.accept, WebSocket.send_json
            async def accept(socket, *args, **kwargs):
                if phase == 'accept':
                    assert bridge.active is True
                    raise RuntimeError('private-handshake-detail')
                return await original_accept(socket, *args, **kwargs)
            async def hello(socket, value, *args, **kwargs):
                if value.get('event') == 'transport_ready':
                    assert bridge.active is True
                    raise RuntimeError('private-handshake-detail')
                return await original_send(socket, value, *args, **kwargs)
            patch.setattr(WebSocket, 'accept', accept)
            patch.setattr(WebSocket, 'send_json', hello)
            app = create_app(tmp_path / phase, origin='http://testserver', private_qa=True, bridge_factory=lambda: bridge)
            headers = {'origin': 'http://testserver'}
            with TestClient(app) as client:
                client.get('/api/native/status')
                permit = client.post('/api/native/permit', headers=headers).json()['permit']
                with pytest.raises(WebSocketDisconnect):
                    with client.websocket_connect('/api/native/voice?carrier=renew-v1&permit=' + permit, headers=headers) as socket:
                        socket.receive_json()
                async def completed():
                    await asyncio.wait_for(asyncio.shield(bridge.public_channel_task), 1)
                client.portal.call(completed)
                status = client.get('/api/native/status').json()
                assert status['active'] is False and status['room_active_sessions'] == 0
                assert bridge.active_voice is None and bridge.active_accent is None
                assert status['last_session']['outcome'] == 'browser_transport_failure'
                assert status['last_session']['error_code'] == 'browser_transport_failure'
                assert status['last_session']['transport']['closed'] is True
                assert 'private-handshake-detail' not in json.dumps(status)
                assert bridge.public_channel_task.exception() is None
                assert sessions == []
