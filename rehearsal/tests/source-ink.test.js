import test from 'node:test';
import assert from 'node:assert/strict';
import {SourceInk} from '../src/source-ink.js';
import {TeachingSequence} from '../src/teaching-sequence.js';

const identity = {sequence_id: 'source-a', index: 0, count: 3, source_id: 'pdf-a-p2',
  region_id: 'actual-region', image_sha256: 'a'.repeat(64)};
function fixture(reduced = false) {
  let now = 100, valid = true, paint = 0, id = 0;
  const frames = new Map(), evidence = [];
  const ink = new SourceInk({now: () => now, reducedMotion: () => reduced,
    paint: () => paint++, publish: value => evidence.push(value),
    frame: callback => { frames.set(++id, callback); return id; }, cancelFrame: id => frames.delete(id)});
  const tick = ms => { now += ms; const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); };
  ink.begin(identity, [.1, .2, .6, .5], () => valid);
  return {ink, tick, frames, evidence, invalidate: () => { valid = false; }, now: () => now, paint: () => paint};
}

test('a source mark cannot ink before a render ACK and fresh matching speech', () => {
  const f = fixture();
  assert.equal(f.ink.onset(identity), false);
  f.ink.rendered();
  assert.equal(f.ink.onset({...identity, sequence_id: 'old'}), false);
  assert.equal(f.ink.onset({...identity, index: 1}), false);
  f.tick(1000); assert.equal(f.paint(), 0); assert.equal(f.ink.steps[0].phase, 'ghost');
  assert.equal(f.ink.onset(identity, f.now() + 70), true);
  assert.equal(f.ink.onset(identity), false);
  f.tick(60); assert.equal(f.paint(), 0);
  f.tick(15); assert.equal(f.ink.steps[0].inkStartedAt, f.now());
  f.tick(350); assert.equal(f.ink.steps[0].progress, .5);
  f.tick(350); assert.equal(f.ink.steps[0].phase, 'inked'); assert.equal(f.frames.size, 0);
});

test('new input or stale viewer cancels the animation without completing a mark', () => {
  for (const interrupt of [f => f.ink.cancel(), f => f.invalidate()]) {
    const f = fixture(); f.ink.rendered(); f.ink.onset(identity); f.tick(200);
    interrupt(f); f.tick(1000);
    assert.equal(f.ink.steps[0].phase, 'paused'); assert.equal(f.ink.steps[0].inkCompletedAt, null);
    assert.equal(f.frames.size, 0);
  }
});

test('reduced motion inks once at speech onset and retains earlier stage evidence', () => {
  const f = fixture(true); f.ink.rendered(); f.ink.onset(identity);
  assert.equal(f.ink.steps[0].phase, 'inked'); assert.equal(f.frames.size, 0);
  f.ink.begin({...identity, index: 1}, [.1, .2, .6, .5]); f.ink.rendered();
  assert.equal(f.ink.steps[0].phase, 'inked'); assert.equal(f.ink.steps[1].phase, 'ghost');
  f.ink.clear(); assert.deepEqual(f.ink.steps, []);
});

test('real teaching coordinator emits one onset per fresh playback epoch, before its heard boundary', () => {
  const stats = {audioRenderedSignalSamples: 0, audioRenderedQuietMs: 2000};
  const player = {version: 1, nativeDelaySeconds: .07}; const onsets = [], sent = [];
  const sequence = new TeachingSequence({stats, player, now: () => 1000,
    send: value => sent.push(value), onSpeech: (...args) => onsets.push(args)});
  const step = {...identity, focus_label: 'Guard', narration: 'The Guard checks the type and sends this execution to a side exit.'};
  sequence.start(step); sequence.transcript(step.narration); sequence.update({idle: true});
  assert.equal(onsets.length, 0);
  stats.audioRenderedSignalSamples = 100; stats.audioRenderedQuietMs = 0;
  sequence.update({idle: false}); sequence.update({idle: false});
  assert.equal(onsets.length, 1); assert.equal(onsets[0][1], 1070); assert.equal(sent.length, 0);
  stats.audioRenderedQuietMs = 1000; sequence.update({idle: true});
  assert.equal(sent[0].heard, true);
});
