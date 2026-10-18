import test from 'node:test';
import assert from 'node:assert/strict';
import {createPCMCompatibilityNode} from '../src/pcm-fallback.js';
import {PCMStreamCore, PureToneGuard} from '../public/audio/pcm-stream-core.mjs';

function fixture(rate = 48000) {
  const connections = [], disconnections = [], messages = [];
  const processor = {connect: target => {connections.push(target); return target;}, disconnect: (...args) => disconnections.push(args)};
  const context = {sampleRate: rate, currentTime: 0, createScriptProcessor: (...args) => {
    assert.deepEqual(args, [1024, 1, 1]); return processor;
  }};
  const node = createPCMCompatibilityNode(context, {PCMStreamCore, PureToneGuard});
  node.port.onmessage = event => messages.push(event.data);
  const process = (time = context.currentTime) => {
    const samples = new Float32Array(1024);
    node.onaudioprocess({playbackTime: time, outputBuffer: {getChannelData(channel) {assert.equal(channel, 0); return samples;}},
      inputBuffer: {getChannelData() {assert.fail('Compatibility playback must never read a microphone/input.');}}});
    context.currentTime += samples.length / rate;
    return samples;
  };
  const audio = (samples, epoch = 0) => node.port.postMessage({kind: 'audio', epoch, samples: samples.buffer}, [samples.buffer]);
  return {node, context, audio, process, messages, connections, disconnections};
}
const voice = length => Float32Array.from({length}, (_, i) => .2 * Math.sin(2 * Math.PI * 137 * i / 24000) + .04 * Math.sin(2 * Math.PI * 411 * i / 24000));

test('real core and tone guard preserve the exact waveform through packet splits, resampling and finish', async () => {
  for (const rate of [24000, 44100, 48000]) {
    const f = fixture(rate), core = new PCMStreamCore(rate), guard = new PureToneGuard();
    const input = voice(7211);
    for (let start = 0; start < input.length; start += 337) {
      const part = input.slice(start, start + 337); f.audio(part);
      const ready = guard.push(part); if (ready.length) core.push(ready);
    }
    f.node.port.postMessage({kind: 'finish', epoch: 0});
    const tail = guard.push(new Float32Array(), true); if (tail.length) core.push(tail); core.finish();
    let status;
    for (let i = 0; i < 40; i++) {
      const expected = new Float32Array(1024); status = core.render(expected);
      const actual = f.process(); assert.deepEqual(actual, expected);
    }
    assert.equal(f.messages.length, 0, 'Port delivery is asynchronous like the primary worklet.');
    await Promise.resolve();
    const last = f.messages.at(-1);
    for (const [key, value] of Object.entries(status)) assert.equal(last[key], value, key);
    assert.equal(last.kind, 'status'); assert.equal(last.epoch, 0); assert.equal(last.renderedFrames, 40960);
    assert.equal(last.toneFramesSuppressed, guard.suppressedFrames); assert.equal(last.inputSamplesConsumed, input.length);
  }
});

test('reset epochs discard queued speech, held guard frames and stale audio/finish messages', async () => {
  const f = fixture(); f.audio(voice(4800), 0); f.process();
  f.node.port.postMessage({kind: 'reset', epoch: 7});
  f.audio(voice(2400), 0); f.node.port.postMessage({kind: 'finish', epoch: 0});
  const silence = f.process(); assert(silence.slice(200).every(value => value === 0));
  await Promise.resolve();
  assert.equal(f.messages.at(-1).epoch, 7); assert.equal(f.messages.at(-1).inputSamplesConsumed, 0);
  assert.equal(f.messages.at(-1).renderedFrames, 1024); assert.equal(f.messages.at(-1).queuedSamples, 0);
  f.audio(voice(2400), 7); f.node.port.postMessage({kind: 'finish', epoch: 7});
  assert(f.process().some(value => Math.abs(value) > .01)); await Promise.resolve();
  assert(f.messages.at(-1).inputSamplesConsumed > 0);
});

test('finite playbackTime owns telemetry, with context clock fallback and actual rendered silence', async () => {
  const f = fixture(); f.context.currentTime = 3;
  f.process(8.25); const secondTime = f.context.currentTime;
  f.process(null); const thirdTime = f.context.currentTime; f.process(NaN);
  await Promise.resolve();
  assert.equal(f.messages[0].time, 8.25);
  assert.equal(f.messages[1].time, secondTime);
  assert.equal(f.messages[2].time, thirdTime);
  assert.equal(f.messages[2].renderedFrames, 3072);
  assert.equal(f.messages[2].quietMs, 64); assert.equal(f.messages[2].signalSamples, 0);
  assert.equal(f.messages[2].hasSignal, false);
});

test('the existing narrowband guard suppresses pure tones without altering its frame counts', async () => {
  const f = fixture(24000), tone = Float32Array.from({length: 7200}, (_, i) => .3 * Math.sin(2 * Math.PI * 1000 * i / 24000));
  f.audio(tone); f.node.port.postMessage({kind: 'finish', epoch: 0});
  for (let i = 0; i < 10; i++) assert(f.process().every(value => value === 0));
  await Promise.resolve(); assert(f.messages.at(-1).toneFramesSuppressed >= 14);
  assert.equal(f.messages.at(-1).signalSamples, 0); assert.equal(f.messages.at(-1).inputSamplesConsumed, 7200);
});

test('queue overflow and invalid PCM reset safely and report the same bounded error', async () => {
  for (const samples of [new Float32Array(24000 * 21).buffer, new ArrayBuffer(3)]) {
    const f = fixture(); f.node.port.postMessage({kind: 'reset', epoch: 4});
    f.node.port.postMessage({kind: 'audio', epoch: 4, samples});
    assert.equal(f.messages.length, 0); await Promise.resolve();
    assert.deepEqual(f.messages[0], {kind: 'error', epoch: 4, message: 'The audio queue was stopped at its safety limit.'});
    f.process(); await Promise.resolve();
    assert.equal(f.messages.at(-1).queuedSamples, 0); assert.equal(f.messages.at(-1).inputSamplesConsumed, 0);
  }
});

test('nonfinite PCM samples use the same existing finite-output safeguard', async () => {
  const f = fixture(); f.audio(new Float32Array([NaN, Infinity, -Infinity]));
  f.node.port.postMessage({kind: 'finish', epoch: 0});
  assert(f.process().every(Number.isFinite)); await Promise.resolve();
  assert.equal(f.messages.at(-1).signalSamples, 0);
});

test('native connection surface and disconnect cleanup cannot leak queued frames or late events', async () => {
  const f = fixture(), bus = {};
  assert.equal(f.node.connect(bus), bus); assert.deepEqual(f.connections, [bus]);
  f.audio(voice(4800)); const captured = f.node.onaudioprocess;
  f.process(); f.node.disconnect(bus);
  assert.equal(f.node.onaudioprocess, null); assert.equal(f.node.port.onmessage, null);
  assert.deepEqual(f.disconnections, [[bus]]);
  const output = new Float32Array(1024).fill(.5);
  captured({outputBuffer: {getChannelData: () => output}});
  assert(output.every(value => value === 0));
  f.audio(voice(4800)); f.node.port.postMessage({kind: 'finish', epoch: 0});
  await Promise.resolve(); assert.equal(f.messages.length, 0, 'Pending status deliveries are retired on disconnect.');
});
