import test from 'node:test';
import assert from 'node:assert/strict';
import {RenewableSocket} from '../src/renewable-socket.js';

class Socket {
  static instances = [];
  constructor(url) { this.url = url; this.readyState = 1; this.bufferedAmount = 0; this.sent = []; Socket.instances.push(this); }
  send(data) { this.sent.push(data); }
  receive(value) { this.onmessage?.({data: JSON.stringify(value)}); }
  close() { this.readyState = 3; this.onclose?.({code: 1000, wasClean: true}); }
}
const hello = ticket => ({event: 'transport_ready', ticket, renew_after_ms: 210000});

test('planned renewal preserves order, sends one ack, flushes input and hides tickets', () => {
  Socket.instances = [];
  const channel = new RenewableSocket('wss://einstein.example/api/native/voice?permit=initial', {Socket});
  const delivered = []; channel.onmessage = event => delivered.push(JSON.parse(event.data));
  const old = Socket.instances[0]; old.receive(hello('a'.repeat(43)));
  old.receive({event: 'connected', transport_seq: 1});
  channel.renew();
  const pcm = new Uint8Array([1, 2, 3, 4]); channel.send(pcm);
  assert.deepEqual(JSON.parse(old.sent[0]), {type: 'transport_fence', after: 1});
  old.receive({event: 'transport_fenced'});
  const next = Socket.instances[1];
  assert.equal(new URL(next.url).pathname, '/api/native/renew');
  assert.equal(new URL(next.url).searchParams.get('permit'), 'a'.repeat(43));
  old.receive({event: 'document_action', transport_seq: 2});
  next.receive({event: 'document_action', transport_seq: 2}); // Replay, delivered once.
  next.receive(hello('b'.repeat(43)));
  assert.deepEqual(JSON.parse(next.sent[0]), {type: 'transport_ack'});
  assert.equal(next.sent[1], pcm);
  old.close();
  next.receive({event: 'audio', transport_seq: 3});
  assert.deepEqual(delivered.map(x => x.event), ['connected', 'document_action', 'audio']);
  assert.equal(channel.renewals, 1); assert.equal(channel.readyState, 1);
  assert.ok(!JSON.stringify(delivered).includes('ticket'));
  channel.close();
  assert.equal(channel.readyState, 3);
});

test('an unexpected close ends the channel without opening a replacement', () => {
  Socket.instances = [];
  const channel = new RenewableSocket('wss://einstein.example/api/native/voice', {Socket});
  let ended = 0; channel.onclose = () => ended++;
  Socket.instances[0].receive(hello('a'.repeat(43)));
  Socket.instances[0].close();
  assert.equal(channel.readyState, 3); assert.equal(ended, 1);
  assert.equal(Socket.instances.length, 1); assert.equal(channel.ticket, null);
});

test('sequence gaps fail closed and never create a new provider connection', () => {
  Socket.instances = [];
  const channel = new RenewableSocket('wss://einstein.example/api/native/voice', {Socket});
  let errors = 0; channel.onerror = () => errors++;
  Socket.instances[0].receive(hello('a'.repeat(43)));
  Socket.instances[0].receive({event: 'audio', transport_seq: 2});
  assert.equal(channel.readyState, 3); assert.equal(errors, 1);
  assert.equal(Socket.instances.length, 1);
});

test('explicit stop bypasses the handoff input queue', () => {
  Socket.instances = [];
  const channel = new RenewableSocket('wss://einstein.example/api/native/voice', {Socket});
  const old = Socket.instances[0]; old.receive(hello('a'.repeat(43))); channel.renew();
  channel.send(JSON.stringify({type: 'stop'}));
  assert.equal(JSON.parse(old.sent.at(-1)).type, 'stop');
  assert.equal(channel.pending.length, 0);
  channel.close();
});
