import test from 'node:test';
import assert from 'node:assert/strict';
import {PCMStreamCore} from '../public/audio/pcm-stream-core.mjs';
import {SpeechPlayer} from '../src/speech-player.js';
import {NativeConversation, decodePCM16} from '../src/native-audio.js';

test('rendered quiet is measured independently of continuous zero-valued transport samples', () => {
  const core = new PCMStreamCore(24000);
  let status;
  for (let i = 0; i < 10; i++) {
    core.push(new Float32Array(2400));
    const output = new Float32Array(2400); status = core.render(output);
    assert(output.every(value => value === 0));
  }
  assert.equal(status.hasSignal, false);
  assert.equal(status.signalSamples, 0);
  assert(status.quietMs >= 990);
  core.push(new Float32Array(2400).fill(.01));
  core.render(new Float32Array(2400));
  for (let i = 0; i < 6; i++) {
    core.push(new Float32Array(2400)); status = core.render(new Float32Array(2400));
  }
  assert.equal(status.hasSignal, true); assert(status.quietMs >= 590);
  assert(status.signalSamples > 0);
  assert.equal(status.playing, true, 'transport playback can remain active while its waveform is quiet');
});

test('continuous silent packets keep initial listening quiet and later create one rendered-silence boundary', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const oldRAF = globalThis.requestAnimationFrame; globalThis.requestAnimationFrame = () => 1;
  t.after(() => { if (oldRAF) globalThis.requestAnimationFrame = oldRAF; else delete globalThis.requestAnimationFrame; });
  const core = new PCMStreamCore(24000), stats = {}, events = [], states = [], frames = [];
  let native, latest = new Float32Array(240), finishes = 0;
  const player = new SpeechPlayer({speechFrame: (...args) => frames.push(args)}, state => {
    native.playbackState(state); states.push(state);
  }, stats);
  player.context = {currentTime: 0}; player.continuousAudio = true;
  player.samples = new Float32Array(32);
  player.analyser = {getFloatTimeDomainData: samples => samples.set(latest.subarray(0, samples.length))};
  // Substitute only hardware plumbing. Real PCM core rendering, stream-state
  // accounting, SpeechPlayer.tick and conversation boundaries run unchanged.
  player.enqueuePCM = async (bytes, rate, version) => {
    assert.equal(rate, 24000); assert.equal(version, player.version);
    core.push(decodePCM16(bytes)); player.streamReceiving = true;
    if (!player.streamEntry) {
      player.streamEntry = {native: true, stream: true, start: Infinity, end: Infinity, ended: false, cues: []};
      player.entries.push(player.streamEntry);
    }
  };
  const finish = player.finish.bind(player);
  player.finish = () => { finishes++; core.finish(); finish(); };
  native = new NativeConversation({player, stats, onEvent: value => events.push(value),
    onState: value => states.push(value), onError: value => assert.fail(value)});
  native.serial = 1; native.active = true; native.continuousAudio = true; native.playerVersion = player.version;
  t.after(() => clearTimeout(native.drainTimer));
  let renderedSamples = 0;
  const feed = async (packets, amplitude = 0) => {
    const input = new Int16Array(2400).fill(amplitude);
    for (let packet = 0; packet < packets; packet++) {
      native.handle({event: 'audio', generation: 0, sample_rate: 24000,
        data: Buffer.from(input.buffer).toString('base64')}, 1);
      await native.pendingQueue;
      for (let block = 0; block < 10; block++) {
        latest = new Float32Array(240);
        const status = core.render(latest);
        const time = player.context.currentTime; player.context.currentTime += .01;
        player.updateStreamState({epoch: player.version, time, ...status});
        player.tick(); renderedSamples += latest.length;
        t.mock.timers.tick(10); await Promise.resolve();
      }
    }
  };
  await feed(10);
  assert.equal(stats.audioPlaying, false); assert(frames.every(frame => frame[3] === false));
  assert.equal(stats.audioRenderedSignalSamples, 0);
  assert.equal(stats.nativePlaybackBoundaries, undefined); assert(!states.includes('speaking'));
  await feed(2, 1000);
  assert.equal(stats.audioPlaying, true);
  await feed(2); // A natural 200ms quiet pause keeps the same local segment.
  assert.equal(stats.nativePlaybackBoundaries, undefined);
  await feed(2, 1000);
  await feed(8);
  assert.equal(stats.audioPlaying, false); assert.equal(frames.at(-1)[3], false);
  assert.equal(stats.nativePlaybackBoundaries, 1); assert.equal(finishes, 0);
  assert.equal(stats.nativeLastPlaybackBoundaryReason, 'rendered-silence');
  assert(stats.audioRenderedQuietMs >= 450); assert(stats.audioRenderedSignalSamples > 0);
  const signalCount = stats.audioRenderedSignalSamples;
  assert.equal(events.filter(event => event.event === 'playback_idle')[0].boundary, 'rendered-silence');
  const boundaryAt = stats.nativeLastPlaybackBoundaryAt;
  await feed(10);
  assert.equal(stats.nativePlaybackBoundaries, 1); assert.equal(stats.nativeLastPlaybackBoundaryAt, boundaryAt);
  assert.equal(stats.audioRenderedSignalSamples, signalCount);
  await feed(2, 1000); assert.equal(stats.audioPlaying, true);
  await feed(8); assert.equal(stats.audioPlaying, false);
  assert.equal(stats.nativePlaybackBoundaries, 2, 'later speech can resume and settle on the same continuous stream');
  assert.equal(core.samplesPlayed, renderedSamples - 1, 'the continuous PCM timeline is neither dropped nor shortened');
  assert.equal(stats.audioRenderedSignalSamples, core.signalSamples);
  assert(!events.some(event => ['turn_complete', 'interrupted'].includes(event.event)));
});

test('rendered-quiet telemetry does not alter the original Google playback mode', t => {
  const oldRAF = globalThis.requestAnimationFrame; globalThis.requestAnimationFrame = () => 1;
  t.after(() => { if (oldRAF) globalThis.requestAnimationFrame = oldRAF; else delete globalThis.requestAnimationFrame; });
  const stats = {}, states = [];
  const player = new SpeechPlayer({speechFrame() {}}, state => states.push(state), stats);
  player.context = {currentTime: 1}; player.samples = new Float32Array(16);
  player.analyser = {getFloatTimeDomainData: samples => samples.fill(0)};
  player.streamEntry = {start: 0, end: Infinity, ended: false, native: true, cues: []};
  player.entries.push(player.streamEntry);
  player.updateStreamState({epoch: 0, time: 1, playing: true, quietMs: 1000, hasSignal: false, queuedMs: 0});
  player.tick();
  assert.equal(stats.audioPlaying, true); assert.equal(player.continuousQuiet, false);
  assert.deepEqual(states, ['playing']);
});
