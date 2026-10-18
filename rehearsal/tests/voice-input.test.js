import test from 'node:test';
import assert from 'node:assert/strict';
import {SpeechSegmenter, encodeWav} from '../src/voice-input.js';

function feed(segmenter, amplitude, seconds, rate = 16000) {
  const frame = new Float32Array(320).fill(amplitude);
  for (let i = 0; i < Math.round(seconds * rate / frame.length); i++) segmenter.push(frame);
}

test('silence and brief transients do not create a turn', () => {
  let starts = 0, ends = 0;
  const segmenter = new SpeechSegmenter(16000, () => starts++, () => ends++);
  feed(segmenter, 0, 2); feed(segmenter, .1, .06); feed(segmenter, 0, 1.2);
  assert.equal(starts, 0); assert.equal(ends, 0);
});

test('a natural pause completes one bounded utterance with pre-roll', () => {
  let starts = 0; const results = [];
  const segmenter = new SpeechSegmenter(16000, () => starts++, (samples, rate) => results.push({samples, rate}));
  feed(segmenter, 0, .5); feed(segmenter, .1, 1.5); feed(segmenter, 0, 1.1);
  assert.equal(starts, 1); assert.equal(results.length, 1); assert.equal(results[0].rate, 16000);
  assert(results[0].samples.length > 16000 * 2); assert.equal(segmenter.active, false);
});

test('continuous input cannot exceed the nineteen-second record boundary', () => {
  const lengths = [];
  const segmenter = new SpeechSegmenter(16000, () => {}, samples => lengths.push(samples.length / 16000));
  feed(segmenter, .1, 19.1);
  assert.equal(lengths.length, 1); assert(lengths[0] <= 19.03);
});

test('output-active threshold suppresses low residual echo but permits speech', () => {
  let starts = 0;
  const segmenter = new SpeechSegmenter(16000, () => starts++, () => {}, () => true);
  feed(segmenter, .015, 1); assert.equal(starts, 0);
  feed(segmenter, .08, .3); assert.equal(starts, 1);
});

test('microphone encoding is PCM16 mono and clamps nonfinite samples', async () => {
  const blob = encodeWav(new Float32Array([0, .5, -1, 2, NaN, Infinity]), 48000);
  const data = new DataView(await blob.arrayBuffer());
  assert.equal(blob.type, 'audio/wav'); assert.equal(data.getUint32(24, true), 48000);
  assert.equal(data.getUint16(22, true), 1); assert.equal(data.getUint16(34, true), 16);
  assert.equal(data.getInt16(50, true), 32767); assert.equal(data.getInt16(52, true), 0);
  assert.equal(data.getInt16(54, true), 0);
});
