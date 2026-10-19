import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeConversation, PCM16Resampler, decodePCM16, stopWhenHidden, socketCloseReceipt} from '../src/native-audio.js';

test('socket closure retains only finite diagnostics, excluding arbitrary reason text', () => {
  assert.deepEqual(socketCloseReceipt({code: 1006, wasClean: false, reason: 'private transport material'}, 300123.7),
    {code: 1006, wasClean: false, elapsedMs: 300124});
  assert.deepEqual(socketCloseReceipt({code: '1000', wasClean: 'true'}, Infinity), {code: null, wasClean: null, elapsedMs: null});
  for (const code of [NaN, 999, 5000, 1000.5]) assert.equal(socketCloseReceipt({code, wasClean: true}, 0).code, null);
});

function startupFixture(t, prepareNative) {
  const errors = []; let permits = 0;
  t.mock.method(globalThis, 'fetch', async () => { permits++; throw new Error('Unexpected permit'); });
  const conversation = new NativeConversation({
    player: {activate: async () => {}, prepareNative, stop() {}},
    onState() {}, onError: error => errors.push(error), stats: {},
  });
  return {conversation, errors, permits: () => permits};
}

test('stalled browser audio fails within its deadline before requesting a provider permit', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const h = startupFixture(t, () => new Promise(() => {}));
  const pending = h.conversation.start({microphone: false});
  const rejected = assert.rejects(pending, /Voice audio did not start/);
  await Promise.resolve(); await Promise.resolve();
  t.mock.timers.tick(20000); await rejected;
  assert.equal(h.permits(), 0); assert.equal(h.conversation.connecting, false);
  assert.equal(h.errors.length, 1);
});

test('audio preparation finishing after cancellation cannot request a provider permit', async t => {
  let prepared;
  const h = startupFixture(t, () => new Promise(resolve => { prepared = resolve; }));
  const pending = h.conversation.start({microphone: false});
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  await h.conversation.stop(); prepared(); await pending;
  assert.equal(h.permits(), 0); assert.deepEqual(h.errors, []);
});

test('a new connection retires the previous connection identity set without accepting its late messages', async t => {
  let prepared;
  const h = startupFixture(t, () => new Promise(resolve => { prepared = resolve; }));
  for (let i = 0; i < 64; i++) h.conversation.teaching.retired.add('old-' + i);
  const previousSerial = h.conversation.serial;
  const pending = h.conversation.start({microphone: false});
  assert.equal(h.conversation.teaching.retired.size, 0);
  h.conversation.handle({event: 'teaching_started', sequence_id: 'late-old'}, previousSerial);
  assert.equal(h.conversation.teachingSequenceId, null);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  await h.conversation.stop(); prepared(); await pending;
  assert.equal(h.permits(), 0);
});

for (const event of ['document_inspection_failed', 'video_inspection_failed']) {
  test(`${event} explains the limit while preserving the conversation`, () => {
    const errors = [], events = [], stats = {};
    const conversation = new NativeConversation({player: {}, stats, onState() {},
      onError: value => errors.push(value), onEvent: value => events.push(value)});
    conversation.active = true; conversation.serial = 1; conversation.generation = 2;
    const failure = {event, generation: 2, diagnostic: {phase: 'provider_request', error_type: 'TimeoutError'}};
    conversation.handle(failure, 1);
    assert.equal(errors.length, 1); assert.match(errors[0], /inspection did not complete/);
    assert(!errors[0].includes('TimeoutError'));
    assert.equal(conversation.active, true); assert.equal(stats.nativeInspectionFailure, failure);
    assert.deepEqual(events, [failure]);
    conversation.handle({...failure, generation: 1}, 1);
    assert.equal(errors.length, 1); assert.equal(events.length, 1);
  });
}

test('rejected PDF annotation explains failure without exposing diagnostic values or accepting stale events', () => {
  const errors = [], events = [], stats = {};
  const conversation = new NativeConversation({player: {}, stats, onState() {},
    onError: value => errors.push(value), onEvent: value => events.push(value)});
  conversation.active = true; conversation.serial = 1; conversation.generation = 2;
  const failure = {event: 'document_action_failed', generation: 2,
    diagnostic: {tool: 'mark_selected_pdf', code: 'region-id-not-on-page'}};
  conversation.handle(failure, 1);
  assert.equal(errors.length, 1); assert.match(errors[0], /annotation was not applied/);
  assert(!errors[0].includes('region-id-not-on-page'));
  assert.equal(stats.nativeDocumentActionFailure, failure);
  assert.equal(conversation.active, true); assert.deepEqual(events, [failure]);
  conversation.handle({...failure, generation: 1}, 1);
  assert.equal(errors.length, 1); assert.equal(events.length, 1);
});

test('brief focus changes preserve startup; sustained background stops once', t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const page = new EventTarget(); let stopped = 0;
  const dispose = stopWhenHidden(page, () => stopped++);
  const visibility = hidden => { page.hidden = hidden; page.dispatchEvent(new Event('visibilitychange')); };
  visibility(true); t.mock.timers.tick(100); visibility(false); t.mock.timers.tick(500);
  assert.equal(stopped, 0);
  visibility(true); t.mock.timers.tick(249); assert.equal(stopped, 0);
  t.mock.timers.tick(1); assert.equal(stopped, 1);
  t.mock.timers.tick(1000); assert.equal(stopped, 1);
  visibility(false); visibility(true); dispose(); t.mock.timers.tick(500);
  assert.equal(stopped, 1);
});

test('immersive presentation remains exempt from background shutdown', t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const page = new EventTarget(); page.hidden = true; let stopped = 0, immersive = false;
  const dispose = stopWhenHidden(page, () => stopped++, () => immersive);
  page.dispatchEvent(new Event('visibilitychange')); immersive = true;
  t.mock.timers.tick(300); assert.equal(stopped, 0);
  page.dispatchEvent(new Event('visibilitychange')); t.mock.timers.tick(300);
  assert.equal(stopped, 0); dispose();
});

for (const rate of [16000, 44100, 48000]) {
  test(`PCM streaming preserves duration and amplitude from ${rate} Hz`, () => {
    const converter = new PCM16Resampler(rate);
    const source = new Float32Array(rate).fill(.25);
    const parts = [];
    for (let start = 0; start < source.length; start += 4096) parts.push(new Uint8Array(converter.push(source.subarray(start, start + 4096))));
    const size = parts.reduce((sum, value) => sum + value.length, 0);
    assert(Math.abs(size / 2 - 16000) <= 1);
    const samples = decodePCM16(parts.find(part => part.length > 0));
    assert(samples.every(value => Math.abs(value - .25) < .0001));
  });
}

test('resampling has no cross-block discontinuity in its accumulated sample count', () => {
  const input = new Float32Array(44100).map((_, index) => Math.sin(index * .03) * .2);
  const once = new Uint8Array(new PCM16Resampler(44100).push(input));
  const streaming = new PCM16Resampler(44100);
  const parts = [];
  for (let index = 0; index < input.length; index += 777) parts.push(new Uint8Array(streaming.push(input.subarray(index, index + 777))));
  const joined = new Uint8Array(parts.reduce((n, value) => n + value.length, 0));
  let offset = 0;
  for (const part of parts) { joined.set(part, offset); offset += part.length; }
  assert.deepEqual(joined, once);
});

test('invalid PCM cannot be decoded or uploaded as undefined samples', () => {
  assert.throws(() => decodePCM16(new Uint8Array(3)));
  assert.throws(() => new PCM16Resampler(8000));
  const bytes = new PCM16Resampler(16000).push(new Float32Array([NaN, Infinity, -Infinity, 2, -2]));
  const result = decodePCM16(new Uint8Array(bytes));
  assert.deepEqual([...result.slice(0, 3)], [0, 0, 0]);
  assert(result[3] > .99 && result[4] < -.99);
});


test('typed submission flushes queued playback and records its epoch before sending the question', () => {
  const order = [], stats = {};
  const player = {version: 4, queue: ['old samples'], stop() { this.queue.length = 0; this.version++; order.push('flush'); }};
  const conversation = new NativeConversation({player, stats, onState() {}, onError() {},
    onEvent: event => order.push(event.event)});
  conversation.active = true; conversation.continuousAudio = true;
  conversation.socket = {readyState: WebSocket.OPEN, send: raw => { if (JSON.parse(raw).type === 'text') order.push('submit'); }};
  conversation.sendText('Private typed question');
  assert.deepEqual(player.queue, []);
  assert(order.indexOf('flush') < order.indexOf('typed_playback_flush'));
  assert(order.indexOf('typed_playback_flush') < order.indexOf('input_start'));
  assert(order.indexOf('input_start') < order.indexOf('submit'));
  assert.equal(stats.nativeTypedPlaybackFlush.previousPlaybackVersion, 4);
  assert.equal(stats.nativeTypedPlaybackFlush.playbackVersion, 5);
  assert(!JSON.stringify(stats.nativeTypedPlaybackFlush).includes('Private'));
  assert.equal(stats.nativeTurnOwnership.audioAttribution, 'unverified');
});
