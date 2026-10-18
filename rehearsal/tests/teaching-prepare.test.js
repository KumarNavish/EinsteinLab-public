import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeConversation} from '../src/native-audio.js';

// Local player/socket/render clocks only. No browser, microphone or provider.
function fixture(t) {
  t.mock.timers.enable({apis: ['setTimeout']});
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const saved = globalThis.WebSocket;
  globalThis.WebSocket = class {static OPEN = 1;};
  t.after(() => { if (saved === undefined) delete globalThis.WebSocket; else globalThis.WebSocket = saved; });
  t.mock.method(globalThis, 'fetch', () => assert.fail('Preparation must never request a provider or endpoint.'));
  const packets = [], events = [], states = [];
  const stats = {audioPlaying: false, audioRenderedSignalSamples: 100, audioRenderedQuietMs: 2000};
  const player = {version: 7, entries: [], nativeDelaySeconds: .06, lastState: 'idle', nativeAudibleSampleEnd: 0,
    streamState: {epoch: 7, inputSamplesConsumed: 0}, stops: 0,
    stop() { this.stops++; this.version++; this.entries = []; this.streamState = null; this.nativeAudibleSampleEnd = 0; stats.audioPlaying = false; },
    finish() {}, async enqueuePCM() { stats.audioPlaying = true; this.lastState = 'playing'; }};
  const native = new NativeConversation({player, stats, onEvent: event => events.push(event),
    onState: state => states.push(state), onError: message => assert.fail(message)});
  native.active = true; native.serial = 1; native.continuousAudio = true; native.playerVersion = player.version;
  native.socket = {readyState: 1, send: packet => packets.push(JSON.parse(packet)), close() {}};
  t.after(() => { clearTimeout(native.preparationTimer); clearTimeout(native.drainTimer); native.teaching.clearPending(); });
  const handle = event => native.handle(event, 1);
  const transcript = text => handle({event: 'output_transcript', text, generation: 0});
  const prepare = (sequence = 'prepared-a') => handle({event: 'teaching_prepare', sequence_id: sequence});
  const render = (quiet = 960, playing = false) => {
    stats.audioRenderedQuietMs = quiet; stats.audioPlaying = playing;
    player.lastState = playing ? 'playing' : 'idle'; player.streamState = {epoch: player.version, time: now, inputSamplesConsumed: 0};
    if (playing) stats.audioRenderedSignalSamples += 100;
    native.playbackState(player.lastState);
  };
  const advance = ms => { now += ms; t.mock.timers.tick(ms); };
  const settle = async () => { await native.pendingQueue; await Promise.resolve(); await Promise.resolve(); };
  return {native, player, stats, packets, events, states, handle, transcript, prepare, render, advance, settle,
    ready: () => packets.filter(packet => packet.type === 'teaching_ready')};
}
const audio = {event: 'audio', generation: 0, sample_rate: 24000, data: 'AQACAA=='};
const step = {event: 'teaching_step', sequence_id: 'prepared-a', index: 0, count: 3,
  focus_label: 'Compiled trace', narration: 'The compiled trace keeps looping while the recorded types remain stable.'};

test('through → that → part. drains naturally before readiness; its old signal cannot ink a teaching step', async t => {
  const f = fixture(t);
  f.transcript('I will walk through'); f.handle(audio); await f.settle();
  f.prepare(); await f.settle();
  f.render(2000, false); assert.equal(f.ready().length, 0, 'An unfinished acknowledgement is not a drain boundary.');
  f.transcript(' that'); f.handle(audio); await f.settle();
  f.render(0, true); f.transcript(' part.');
  assert.equal(f.ready().length, 0); assert.equal(f.player.stops, 0);
  assert(!f.events.some(event => event.event === 'teaching_speech_onset'));
  f.render(959); f.advance(100); assert.equal(f.ready().length, 0, 'The real speaker delay remains included.');
  f.render(960);
  assert.deepEqual(f.ready(), [{type: 'teaching_ready', sequence_id: 'prepared-a', ready: true,
    rendered_quiet_ms: 960, audio_playing: false}]);
  assert.equal(f.player.stops, 0, 'Preparing must preserve the prelude instead of cutting playback.');
  assert.equal(f.native.teaching.current, null); assert.equal(f.stats.teaching, undefined);
  f.handle({event: 'teaching_started', sequence_id: 'prepared-a'}); f.handle(step);
  assert.equal(f.player.stops, 1, 'The existing reset remains at the actual admitted teaching_step.');
  assert.equal(f.stats.teaching.transcript, ''); assert.equal(f.stats.teaching.signalObserved, false);
  assert(!f.events.some(event => event.event === 'teaching_speech_onset'));
  assert(!f.packets.some(packet => packet.type === 'teaching_boundary'));
});

test('an empty prelude is allowed only after fresh current-epoch rendered telemetry', async t => {
  const f = fixture(t); f.prepare(); await f.settle();
  f.advance(100); assert.equal(f.ready().length, 0, 'Old quiet alone is not a current rendered receipt.');
  f.render(); assert.equal(f.ready().length, 1);
  for (let i = 0; i < 4; i++) { f.prepare(); f.render(); f.advance(100); }
  assert.equal(f.ready().length, 1, 'A duplicate request cannot send readiness twice.');
});

for (const text of ['through', 'that...', 'part…']) {
  test(`elapsed time and incomplete transcript ${JSON.stringify(text)} never substitute for the drain checks`, async t => {
    const f = fixture(t); f.transcript(text); f.prepare(); await f.settle();
    f.render(0, true);
    f.render(5000); f.advance(2000); assert.equal(f.ready().length, 0);
  });
}
test('user speech prevents a drain receipt until actual quiet returns', async t => {
  const f = fixture(t); f.transcript('All right.'); f.native.speaking = true;
  f.prepare(); await f.settle(); f.render(5000); assert.equal(f.ready().length, 0);
  f.native.speaking = false; f.render(0, true); f.render(); assert.equal(f.ready().length, 1);
});

test('a latest prepare received during the same utterance survives its explicit input_end playback reset', async t => {
  const f = fixture(t), originalStop = f.player.stop.bind(f.player);
  f.player.stop = () => { originalStop(); f.native.playbackState('idle'); };
  f.native.speaking = true; f.native.lastSpeechAt = 0; f.native.suppressAudio = true;
  f.prepare(); await f.settle(); f.render(2000);
  assert.equal(f.ready().length, 0); const epoch = f.player.version;
  f.advance(451); f.native.detectSpeech(0, .1, 451); await f.settle();
  assert.equal(f.player.version, epoch + 1);
  assert.equal(f.native.teachingPreparation.sequenceId, 'prepared-a');
  assert.equal(f.native.teachingPreparation.epoch, f.player.version);
  assert.equal(f.ready().length, 0, 'The input-end reset does not itself establish quiet.');
  f.render(); assert.equal(f.ready().length, 1);
  assert(!f.native.teaching.retired.has('prepared-a'));
});

test('unknown quiet, active playback and wrong-epoch rendered samples fail closed', async t => {
  const f = fixture(t); f.prepare(); await f.settle();
  for (const quiet of [undefined, null, NaN, Infinity, -1, 899, 959, 600001]) {
    f.player.streamState = {epoch: f.player.version}; f.stats.audioRenderedQuietMs = quiet;
    f.native.updateTeachingPreparation(); assert.equal(f.ready().length, 0);
  }
  f.render(2000, true); assert.equal(f.ready().length, 0);
  f.player.streamState = {epoch: f.player.version - 1}; f.stats.audioPlaying = false; f.player.lastState = 'idle';
  f.native.updateTeachingPreparation(); assert.equal(f.ready().length, 0);
  f.render(0, true); f.render(); assert.equal(f.ready().length, 1);
});

test('complete transcript before delayed prelude audio cannot borrow old signal or old rendered quiet', async t => {
  const f = fixture(t); f.transcript('All right.'); f.prepare(); await f.settle();
  f.render(2000); f.advance(1500);
  assert.equal(f.ready().length, 0); assert.equal(f.stats.teachingPreparation.preludeSignalObserved, false);
  f.render(0, true); assert.equal(f.ready().length, 0);
  f.render(); assert.equal(f.ready().length, 1);
});

test('a prelude that already rendered and drained before prepare remains eligible without another utterance', async t => {
  const f = fixture(t); f.transcript('All right.'); f.render(0, true); f.render();
  f.prepare(); await f.settle(); f.render();
  assert.equal(f.ready().length, 1); assert.equal(f.stats.teachingPreparation.preludeSignalObserved, true);
});

test('missing, invalid or not-yet-consumed audible input positions cannot reuse real quiet', async t => {
  const f = fixture(t); f.prepare(); await f.settle();
  for (const [end, consumed] of [[undefined, 10], [0, undefined], [-1, 10], [NaN, 10], [1, Infinity], [4, 3], [1, 1.5]]) {
    f.player.nativeAudibleSampleEnd = end;
    f.player.streamState = {epoch: f.player.version, inputSamplesConsumed: consumed};
    f.native.updateTeachingPreparation(); assert.equal(f.ready().length, 0);
  }
  f.player.nativeAudibleSampleEnd = 0; f.render(); assert.equal(f.ready().length, 1);
});

test('queued/deferred decode needs a later actual render receipt, even with old quiet and a complete transcript', async t => {
  const f = fixture(t); let finish;
  f.player.enqueuePCM = () => new Promise(resolve => { finish = resolve; });
  f.handle(audio); await Promise.resolve(); f.transcript('All right.'); f.prepare();
  f.render(5000); await Promise.resolve(); assert.equal(f.ready().length, 0);
  finish(); await f.settle(); f.native.updateTeachingPreparation();
  assert.equal(f.ready().length, 0, 'Enqueue completion alone cannot reuse the preceding quiet sample.');
  f.render(0, true); f.render(); assert.equal(f.ready().length, 1);
});

test('a premature start, stage or mark cannot bypass preparation, including the ready→started gap', async t => {
  const f = fixture(t); let renders = 0;
  f.native.sharedDocument = {id: 'a'.repeat(64), pages: 3};
  f.native.documentHandler = () => { renders++; return {ok: true}; };
  const mark = {event: 'document_action', generation: 0, action: {kind: 'mark', action_id: 'premature',
    document_id: 'a'.repeat(64), view_revision: 0, revision: 1, teaching: {sequence_id: 'prepared-a'}}};
  f.prepare(); await f.settle();
  f.handle({event: 'teaching_started', sequence_id: 'prepared-a'}); f.handle(step); f.handle(mark);
  await f.settle(); assert.equal(renders, 0); assert.equal(f.player.stops, 0);
  assert.equal(f.native.teaching.current, null); assert.equal(f.packets.at(-1).ok, false);
  f.render(); f.handle(mark); await f.settle();
  assert.equal(renders, 0, 'Readiness alone does not replace the matching teaching_started.');
  f.handle({event: 'teaching_started', sequence_id: 'prepared-a'}); f.handle(mark); await f.settle();
  assert.equal(renders, 1);
});

test('a preparation timeout stays paused, retires its ID, and never declares heard speech', async t => {
  const f = fixture(t); f.transcript('unfinished'); f.prepare(); await f.settle();
  f.advance(8000);
  assert.equal(f.stats.teachingPreparation.phase, 'timeout'); assert.equal(f.native.teachingPreparation, null);
  f.transcript(' sentence.'); f.render(); f.prepare(); await f.settle();
  assert.equal(f.ready().length, 0); assert(f.native.teaching.retired.has('prepared-a'));
  assert(!f.packets.some(packet => packet.type === 'teaching_boundary'));
});

for (const phase of ['waiting', 'ready']) test(`typed interruption retires the same prepared ID while ${phase}, including ready→started`, async t => {
  const f = fixture(t); f.prepare(); await f.settle();
  if (phase === 'ready') f.render();
  const before = f.ready().length;
  f.native.sendText('A different question.');
  const cancel = f.packets.find(packet => packet.type === 'teaching_cancel');
  assert.equal(cancel.sequence_id, 'prepared-a');
  assert.equal(f.native.teachingPreparation, null); assert.equal(f.native.outputTranscriptTail, '');
  f.handle({event: 'teaching_cancelled', cancellation_id: cancel.cancellation_id});
  f.prepare(); f.handle({event: 'teaching_started', sequence_id: 'prepared-a'}); f.handle(step);
  f.render(); f.advance(9000);
  assert.equal(f.ready().length, before); assert.equal(f.native.teaching.current, null);
  assert(!f.events.some(event => event.event === 'teaching_step'));
});

for (const operation of ['cancelTeaching', 'revokeDocument', 'revokeVideo', 'offerDocument', 'offerVideo', 'stop']) {
  test(`${operation} cancels a pending preparation without a late readiness receipt`, async t => {
    const f = fixture(t); f.prepare(); await f.settle();
    const value = {id: 'a'.repeat(64), pages: 3, approved: true};
    await f.native[operation](value);
    f.render(); f.advance(9000); f.prepare();
    assert.equal(f.ready().length, 0); assert(f.native.teaching.retired.has('prepared-a'));
  });
}

test('new view/user speech cancel preparation; serial/epoch changes and overlapping IDs cannot revive it', async t => {
  const f = fixture(t); f.native.sharedDocument = {id: 'a'.repeat(64), pages: 3};
  f.prepare(); await f.settle(); f.prepare('unexpected-overlap');
  assert.equal(f.native.teachingPreparation.sequenceId, 'prepared-a');
  assert.equal(f.native.selectDocumentView({document_id: 'a'.repeat(64), page: 2}), true);
  f.render(); f.advance(1000); assert.equal(f.ready().length, 0);
  f.handle({event: 'teaching_cancelled', cancellation_id: f.native.teachingCancelPending});
  f.prepare('prepared-b'); await f.settle();
  f.native.detectSpeech(.08, .15, 100);
  assert.equal(f.native.teachingPreparation, null); assert(f.native.teaching.retired.has('prepared-b'));
  f.handle({event: 'teaching_cancelled', cancellation_id: f.native.teachingCancelPending});
  f.native.speaking = false; f.prepare('prepared-c'); await f.settle();
  f.player.version++; f.native.updateTeachingPreparation();
  assert.equal(f.native.teachingPreparation, null); assert(f.native.teaching.retired.has('prepared-c'));
  f.native.handle({event: 'teaching_prepare', sequence_id: 'stale-serial'}, 0);
  assert.equal(f.native.teachingPreparation, null);
});

test('a prepare received during cancellation stays retired after the matching acknowledgement', async t => {
  const f = fixture(t); f.native.cancelTeaching(); f.prepare('late-before-ack');
  assert(f.native.teaching.retired.has('late-before-ack'));
  f.handle({event: 'teaching_cancelled', cancellation_id: f.native.teachingCancelPending});
  f.prepare('late-before-ack'); assert.equal(f.native.teachingPreparation, null);
  f.prepare('fresh-after-ack'); await f.settle(); f.render();
  assert.equal(f.ready()[0].sequence_id, 'fresh-after-ack');
});
