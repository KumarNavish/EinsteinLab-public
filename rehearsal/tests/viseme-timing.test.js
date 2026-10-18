import test from 'node:test';
import assert from 'node:assert/strict';
import {applyClassifierEvent, ArticulationTimeline, validViseme} from '../src/viseme-timing.js';

test('open vowel zero is an explicit active class, not a false/missing event', () => {
  const node = {visemeActive: 5};
  assert.equal(applyClassifierEvent(node, {viseme: 0}), true);
  assert.equal(node.visemeActive, 0);
  assert.equal(applyClassifierEvent(node, {viseme: 14}), true);
  assert.equal(node.visemeActive, -1);
});

test('invalid classifier data cannot change facial pose', () => {
  const node = {visemeActive: 5};
  for (const value of [-1, 15, NaN, Infinity, .5, null, '0']) {
    assert.equal(validViseme(value), false);
    assert.equal(applyClassifierEvent(node, {viseme: value}), false);
    assert.equal(node.visemeActive, 5);
  }
});

test('articulation moves on the audio clock, waits for its scheduled event, then closes', () => {
  const timeline = new ArticulationTimeline({leadSeconds: .02, attackSeconds: .025, releaseSeconds: .045});
  timeline.push(0, 1);
  let result = timeline.sample(1);
  assert.equal(result.viseme_aa, 0);
  result = timeline.sample(1.02);
  assert(result.viseme_aa > 0);
  for (let t = 1.03; t <= 1.12; t += .01) result = timeline.sample(t);
  assert(result.viseme_aa > .95);
  timeline.push(14, 1.12);
  for (let t = 1.14; t < 1.5; t += .01) result = timeline.sample(t);
  assert(result.viseme_aa < .001);
});

test('interruption clears pending and current articulation without stale reopening', () => {
  const timeline = new ArticulationTimeline({leadSeconds: 0});
  timeline.push(0, 1); timeline.sample(1); timeline.sample(1.05);
  timeline.push(4, 1.2); timeline.reset();
  assert.equal(timeline.sample(1.3).viseme_U, 0);
  assert.equal(timeline.sample(1.4).viseme_aa, 0);
});

test('streaming event history is bounded and a missing producer returns to silence', () => {
  const timeline = new ArticulationTimeline({leadSeconds: 0});
  for (let i = 0; i < 1000; i++) timeline.push(i % 14, i / 100);
  assert(timeline.events.length <= 64);
  timeline.sample(10.5);
  const out = timeline.sample(11);
  assert(out.viseme_sil > .9);
});
