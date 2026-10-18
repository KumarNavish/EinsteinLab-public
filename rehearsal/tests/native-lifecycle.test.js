import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeConversation} from '../src/native-audio.js';

// Entirely local lifecycle fixtures: no credential, network, microphone or provider.
function fixture() {
  const states = [], errors = [], packets = [];
  const stats = {audioPlaying: false, microphoneActive: false};
  const player = {
    version: 0, entries: [],
    async activate() {},
    begin() { this.stop(); return this.version; },
    finish() {},
    stop() { this.version++; this.entries = []; stats.audioPlaying = false; },
    async enqueuePCM(bytes, rate, version) { if (version === this.version) packets.push({bytes: bytes.length, rate}); },
  };
  const conversation = new NativeConversation({player, stats, onEvent() {}, onState: value => states.push(value), onError: value => errors.push(value)});
  return {conversation, player, stats, states, errors, packets};
}

function fakeTransport(t, {renewable = false, delayedClose = false} = {}) {
  const sockets = [];
  const saved = {fetch: globalThis.fetch, WebSocket: globalThis.WebSocket, location: globalThis.location};
  globalThis.location = {href: 'http://localhost:8765/', protocol: 'http:'};
  globalThis.fetch = async () => ({ok: true, async json() { return {permit: 'synthetic-permit-not-an-api-key',
    ...(renewable ? {transport: 'renewable-websocket'} : {})}; }});
  globalThis.WebSocket = class {
    static OPEN = 1;
    constructor() {
      this.readyState = 1;
      sockets.push(this);
      queueMicrotask(() => {
        if (renewable) this.onmessage?.({data: JSON.stringify({event: 'transport_ready', ticket: 'a'.repeat(43), renew_after_ms: 210000})});
        this.onmessage?.({data: JSON.stringify({event: 'connected', model: 'fixture', privacy: 'No external service',
          ...(renewable ? {transport_seq: 1} : {})})});
      });
    }
    send() {}
    close() { this.readyState = delayedClose ? 2 : 3; if (!delayedClose) queueMicrotask(() => this.onclose?.()); }
  };
  t.after(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
    }
  });
  return sockets;
}

test('carrier protocol failure stops capture and playback before raw close arrives', async t => {
  const sockets = fakeTransport(t, {renewable: true, delayedClose: true});
  const {conversation, player, stats, errors} = fixture();
  stats.nativeTransportRenewals = 7;
  await conversation.start({microphone: false});
  assert.equal(stats.nativeTransportRenewals, 0);
  let stopped = 0;
  conversation.stream = {getTracks: () => [{stop() { stopped++; }}]};
  stats.microphoneActive = true; stats.audioPlaying = true;
  const serial = conversation.serial, version = player.version;
  sockets[0].onmessage({data: JSON.stringify({event: 'audio', transport_seq: 3})});
  assert.equal(conversation.active, false);
  assert.equal(conversation.connecting, false);
  assert.equal(conversation.serial, serial + 1);
  assert.equal(conversation.stream, null);
  assert.equal(stopped, 1);
  assert.equal(stats.microphoneActive, false);
  assert.equal(stats.audioPlaying, false);
  assert.ok(player.version > version);
  assert.equal(stats.nativeSocketClose.code, null, 'No raw close event has arrived.');
  assert.equal(errors.length, 1);
  assert.equal(sockets.length, 1, 'No automatic new conversation was created.');
});

const audio = generation => ({event: 'audio', data: 'AAAAAA==', sample_rate: 24000, generation});

test('a new connection accepts generation zero after an interrupted prior session', async t => {
  fakeTransport(t);
  const {conversation, packets} = fixture();
  await conversation.start({microphone: false});
  conversation.handle({event: 'interrupted', generation: 2}, conversation.serial);
  await conversation.stop();
  await conversation.start({microphone: false});
  conversation.handle(audio(0), conversation.serial);
  await conversation.pendingQueue;
  assert.equal(packets.length, 1, 'previous interruption counter must not mute the next session');
  await conversation.stop();
});

test('events from a closed connection cannot mutate the current playback', async () => {
  const {conversation, player, states, stats} = fixture();
  conversation.serial = 9; conversation.active = true;
  const version = player.version;
  conversation.handle({event: 'interrupted', generation: 8}, 7);
  await conversation.pendingQueue;
  assert.equal(player.version, version);
  assert.equal(states.length, 0);
  assert.equal(stats.nativeInterruptions, undefined);
});

test('a pending audio decode cannot relabel an interrupted session as speaking', async () => {
  const {conversation, player, states} = fixture();
  conversation.serial = 1; conversation.active = true; conversation.playerVersion = player.version;
  let resolve;
  player.enqueuePCM = () => new Promise(done => { resolve = done; });
  conversation.handle(audio(0), 1);
  await Promise.resolve();
  conversation.handle({event: 'interrupted', generation: 1}, 1);
  resolve();
  await conversation.pendingQueue;
  assert.equal(states.at(-1), 'listening');
});

test('teardown stops audio before awaiting a slow input-context close', async () => {
  const {conversation, player, stats, states} = fixture();
  conversation.serial = 3; conversation.active = true;
  stats.audioPlaying = true;
  let finishClose;
  const context = {state: 'running', close: () => new Promise(done => { finishClose = done; })};
  conversation.inputContext = context;
  const version = player.version;
  const teardown = conversation.cleanup(3);
  assert.equal(stats.audioPlaying, false);
  assert(player.version > version);
  assert.equal(conversation.inputContext, null);
  // A new connection may begin while the previous OS input context closes.
  const newContext = {state: 'running'};
  conversation.serial++; conversation.active = true; conversation.inputContext = newContext;
  const newVersion = player.version;
  finishClose(); await teardown;
  assert.equal(conversation.inputContext, newContext);
  assert.equal(conversation.active, true);
  assert.equal(player.version, newVersion);
  assert.equal(states.filter(value => value === 'closed').length, 1);
});

test('provider turn completion does not claim listening while buffered audio remains', async () => {
  const {conversation, player, states, stats} = fixture();
  conversation.serial = 4; conversation.active = true; conversation.playerVersion = player.version;
  player.entries = [{end: 20}]; stats.audioPlaying = true;
  conversation.handle({event: 'turn_complete', generation: 0}, 4);
  await conversation.pendingQueue;
  await Promise.resolve();
  assert(!states.includes('listening'));
  assert.equal(stats.nativeCompletedTurns, 1);
});
