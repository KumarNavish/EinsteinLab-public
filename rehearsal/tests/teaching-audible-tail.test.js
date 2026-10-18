import test from 'node:test';
import assert from 'node:assert/strict';
import {PCMStreamCore, PureToneGuard} from '../public/audio/pcm-stream-core.mjs';
import {SpeechPlayer} from '../src/speech-player.js';
import {NativeConversation} from '../src/native-audio.js';

// Only hardware plumbing is substituted. Decode, guard, resampling, input
// positions, player clocks and the NativeConversation prepare gate are real.
function fixture(t) {
  t.mock.timers.enable({apis: ['setTimeout']});
  let elapsed = 0;
  t.mock.method(performance, 'now', () => elapsed);
  const oldRAF = globalThis.requestAnimationFrame, oldWS = globalThis.WebSocket;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.WebSocket = class {static OPEN = 1;};
  t.after(() => {
    if (oldRAF === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = oldRAF;
    if (oldWS === undefined) delete globalThis.WebSocket; else globalThis.WebSocket = oldWS;
  });
  t.mock.method(globalThis, 'fetch', () => assert.fail('This test must not access any endpoint.'));
  const core = new PCMStreamCore(48000), guard = new PureToneGuard(), stats = {}, packets = [];
  let native;
  const player = new SpeechPlayer({speechFrame() {}}, state => native.playbackState(state), stats);
  player.context = {currentTime: 0}; player.continuousAudio = true;
  player.samples = new Float32Array(32); player.analyser = {getFloatTimeDomainData: samples => samples.fill(0)};
  player.prepareNative = async () => {};
  player.streamNode = {port: {postMessage(message) {
    if (message.kind === 'audio') {
      const ready = guard.push(new Float32Array(message.samples)); if (ready.length) core.push(ready);
    } else if (message.kind === 'reset') { core.reset(); guard.reset(); }
    else if (message.kind === 'finish') { const ready = guard.push(new Float32Array(), true); if (ready.length) core.push(ready); core.finish(); }
  }}};
  native = new NativeConversation({player, stats, onState() {}, onEvent() {}, onError: message => assert.fail(message)});
  native.active = true; native.serial = 1; native.continuousAudio = true; native.playerVersion = player.version;
  native.socket = {readyState: 1, send: packet => packets.push(JSON.parse(packet))};
  t.after(() => { clearTimeout(native.preparationTimer); clearTimeout(native.drainTimer); });
  const feed = async samples => {
    native.handle({event: 'audio', generation: 0, sample_rate: 24000,
      data: Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength).toString('base64')}, 1);
    await native.pendingQueue; await Promise.resolve(); await Promise.resolve();
  };
  const render = (frames = 128) => {
    const status = core.render(new Float32Array(frames));
    elapsed += frames / 48; player.context.currentTime = elapsed / 1000;
    player.updateStreamState({kind: 'status', epoch: player.version, time: player.context.currentTime, ...status});
    player.tick(); native.updateTeachingPreparation(); t.mock.timers.tick(frames / 48);
    return status;
  };
  const prepare = async () => {
    native.handle({event: 'output_transcript', generation: 0, text: 'I will walk through that part.'}, 1);
    native.handle({event: 'teaching_prepare', sequence_id: 'queued-tail-proof'}, 1);
    await Promise.resolve(); await Promise.resolve();
  };
  return {core, guard, player, native, stats, packets, feed, render, prepare,
    ready: () => packets.filter(packet => packet.type === 'teaching_ready')};
}

test('a two-second silent gap cannot hide the queued closing word, while continuous trailing silence permits readiness', async t => {
  const f = fixture(t), pcm = new Int16Array(52800);
  pcm.fill(1638, 0, 2400); pcm.fill(1638, 50400, 52800);
  await f.feed(pcm);
  let status;
  do { status = f.render(); } while (status.quietMs < 1000);
  assert.equal(f.player.nativeAudibleSampleEnd, 52800);
  assert(status.inputSamplesConsumed < 50400);
  await f.prepare(); f.render();
  assert.equal(f.ready().length, 0, 'Earlier speech and1000ms real quiet do not consume the future closing word.');
  assert.equal(f.stats.teachingPreparation.audibleTailConsumed, false);
  for (let i = 0; i < 150 && !f.ready().length; i++) { await f.feed(new Int16Array(480)); status = f.render(960); }
  assert.equal(f.ready().length, 1);
  assert(status.inputSamplesConsumed >= 52800); assert(status.quietMs >= 970);
  assert(status.queuedSamples > 0, 'No need to drain the indefinitely continuing silent transport.');
  assert(f.stats.audioRenderedSignalSamples > 9000, 'The closing word actually rendered after the first signal.');
  assert.equal(f.stats.teachingPreparation.audibleTailConsumed, true);
  for (let i = 0; i < 5; i++) { await f.feed(new Int16Array(480)); f.render(960); }
  assert.equal(f.ready().length, 1);
});

test('audible samples still held by the tone guard lookahead remain part of the queued tail', async t => {
  const f = fixture(t); await f.feed(new Int16Array(2400).fill(1638));
  assert.equal(f.player.nativeQueuedSampleEnd, 2400); assert.equal(f.player.nativeAudibleSampleEnd, 2400);
  let status;
  do { status = f.render(); } while (status.quietMs < 1000);
  assert(status.inputSamplesConsumed < 2400); assert(f.guard.pending.length > 0);
  await f.prepare(); f.render(); assert.equal(f.ready().length, 0);
  for (let i = 0; i < 100 && !f.ready().length; i++) { await f.feed(new Int16Array(480)); status = f.render(960); }
  assert.equal(f.ready().length, 1); assert(status.inputSamplesConsumed >= 2400);
  assert.equal(f.player.nativeAudibleSampleEnd, 2400, 'Silent packets do not advance the audible watermark.');
});

test('input consumption positions reset per epoch independently of lifetime output sample counts', () => {
  const core = new PCMStreamCore(48000); core.push(new Float32Array(4800).fill(.05));
  let status = core.render(new Float32Array(4800));
  assert.equal(status.inputSamplesConsumed, 2400); assert.equal(status.samplesPlayed, 4800);
  core.reset(); status = core.render(new Float32Array(128));
  assert.equal(status.inputSamplesConsumed, 0); assert.equal(status.samplesPlayed, 4800);
});

test('player reset clears raw queued positions and ignores old-epoch consumption', () => {
  const player = new SpeechPlayer({speechFrame() {}}, () => {}, {});
  player.nativeQueuedSampleEnd = 52800; player.nativeAudibleSampleEnd = 52800;
  const oldEpoch = player.version; player.stop();
  assert.equal(player.nativeQueuedSampleEnd, 0); assert.equal(player.nativeAudibleSampleEnd, 0);
  player.updateStreamState({epoch: oldEpoch, inputSamplesConsumed: 52800});
  assert.equal(player.streamState, null);
});
