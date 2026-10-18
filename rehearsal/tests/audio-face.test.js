import test from 'node:test';
import assert from 'node:assert/strict';
import {mouthWeights} from '../src/audio-face.js';

test('audio-driven vowels and consonants map to distinct existing mouth poses', () => {
  assert.deepEqual(mouthWeights({viseme_aa: .6, viseme_PP: .4}), {D: .6, A: .4});
  assert.deepEqual(mouthWeights({viseme_U: .5, viseme_FF: .4, viseme_TH: .1}), {F: .5, G: .4, H: .1});
});

test('audio-classifier values are finite, bounded, and normalized for safe morph blending', () => {
  const weights = mouthWeights({viseme_aa: 2, viseme_U: 2, viseme_FF: NaN, other: 8, viseme_O: -1});
  assert.equal(weights.D, .5); assert.equal(weights.F, .5); assert.equal(weights.E, 0);
  assert(!('G' in weights) && !('other' in weights));
});

test('multiple consonants sharing a pose cannot amplify it twice', () => {
  const weights = mouthWeights({viseme_SS: .6, viseme_I: .4, viseme_DD: .5});
  assert.deepEqual(weights, {B: .6});
});

test('silence does not force the jaw open', () => {
  assert.deepEqual(mouthWeights({viseme_sil: .9}), {X: .9});
  assert.deepEqual(mouthWeights({}), {});
});
