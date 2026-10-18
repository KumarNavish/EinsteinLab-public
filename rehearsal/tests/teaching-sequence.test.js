import test from 'node:test';
import assert from 'node:assert/strict';
import {TeachingSequence} from '../src/teaching-sequence.js';

const step = {sequence_id: 'teaching-a', index: 0, count: 3, focus_label: 'Surface tension',
  narration: 'Surface tension pulls the soap film inward and keeps the bubble round.'};
const spokenStep = 'The bubble stays round because surface tension draws its soap film inward.';

function fixture() {
  const stats = {audioRenderedSignalSamples: 100, audioRenderedQuietMs: 2000};
  const player = {version: 3, lastState: 'idle'};
  const sent = [], timers = new Map(); let time = 0, id = 0, speaking = false;
  const coordinator = new TeachingSequence({stats, player, send: value => sent.push(value),
    isUserSpeaking: () => speaking, now: () => time,
    setTimer: (callback, delay) => { timers.set(++id, {callback, due: time + delay}); return id; },
    clearTimer: identity => timers.delete(identity)});
  const advance = elapsed => {
    time += elapsed;
    for (const [identity, timer] of [...timers]) {
      if (timer.due <= time) { timers.delete(identity); timer.callback(); }
    }
  };
  const signal = () => {
    stats.audioRenderedSignalSamples += 100; stats.audioRenderedQuietMs = 0;
    player.lastState = 'playing'; coordinator.update({idle: false});
  };
  const quiet = (milliseconds = 900) => {
    stats.audioRenderedQuietMs = milliseconds; player.lastState = 'idle'; coordinator.update({idle: true});
  };
  return {stats, player, sent, timers, coordinator, advance, signal, quiet,
    speak: value => { speaking = value; }};
}

test('fresh focused paraphrase and actual rendered quiet emit one local boundary', () => {
  const f = fixture(); assert(f.coordinator.start(step));
  f.signal(); f.coordinator.transcript(spokenStep);
  f.quiet(450); assert.equal(f.sent.length, 0); assert.equal(f.timers.size, 1);
  f.stats.audioRenderedQuietMs = 900; f.advance(450);
  assert.deepEqual(f.sent, [{type: 'teaching_boundary', sequence_id: 'teaching-a', index: 0, heard: true}]);
  f.quiet(); f.advance(2000); assert.equal(f.sent.length, 1);
});

test('the actual public Guard-fails paraphrase advances after rendered sentence completion', () => {
  const f = fixture();
  f.coordinator.start({...step, focus_label: 'Guard fails',
    narration: 'When a Guard fails because a value’s type changes, execution leaves that compiled trace through a side exit.'});
  f.signal();
  f.coordinator.transcript('If that assumption breaks—say a value changes type—the code hits a Guard check, and you can see it takes that side exit out of the compiled trace instead of continuing on the fast path.');
  f.quiet(540); assert.equal(f.sent.length, 0); assert.equal(f.timers.size, 1);
  f.stats.audioRenderedQuietMs = 1000; f.advance(460);
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].heard, true);
});

const connectionStep = {...step, focus_label: 'Interpret Bytecodes → Monitor: loop edge',
  narration: 'Interpret Bytecodes connects to Monitor at a loop edge; this connection is printed, not inferred.'};
const connectionPassage = "Here you see Interpret Bytecodes connected to Monitor at a loop edge. That's shown directly by the figure's boxes and arrows, not a guess from me.";

test('the actual public connected paraphrase waits for rendered quiet and advances once', () => {
  const f = fixture(); f.coordinator.start(connectionStep); f.signal();
  f.coordinator.transcript(connectionPassage);
  f.quiet(450); assert.equal(f.sent.length, 0); assert.equal(f.timers.size, 1);
  f.stats.audioRenderedQuietMs = 900; f.advance(450);
  assert.deepEqual(f.sent, [{type: 'teaching_boundary', sequence_id: 'teaching-a', index: 0, heard: true}]);
  f.quiet(2000); f.advance(2000); assert.equal(f.sent.length, 1);
});

test('regular connection inflections share the planned mechanism without broad semantic matching', () => {
  for (const verb of ['connects', 'connected', 'connecting']) {
    const f = fixture(); f.coordinator.start(connectionStep); f.signal();
    f.coordinator.transcript(`Here you see Interpret Bytecodes ${verb} to Monitor at a loop edge.`);
    f.quiet(900); assert.equal(f.sent.length, 1, verb);
  }
  const f = fixture(); f.coordinator.start(connectionStep); f.signal();
  f.coordinator.transcript('Here you see Interpret Bytecodes and Monitor at a loop edge, with connectivity as the topic.');
  f.quiet(2000); assert.equal(f.sent.length, 0);
});

test('connection labels, short fragments, unfinished sentences and mid-step pauses remain insufficient', () => {
  for (const transcript of [
    'Here you see Interpret Bytecodes and Monitor at a loop edge on this figure.',
    'Interpret Bytecodes connected.',
    connectionPassage.slice(0, -1),
    'Here you see Interpret Bytecodes connected',
    'Here you see Interpret Bytecodes connected to Monitor at a loop edge...',
  ]) {
    const f = fixture(); f.coordinator.start(connectionStep); f.signal(); f.coordinator.transcript(transcript);
    f.quiet(2000); f.advance(5000); assert.equal(f.sent.length, 0, transcript); assert.equal(f.timers.size, 0);
  }
});

test('a long unfinished passage or trailing ellipsis cannot become a sentence boundary', () => {
  for (const ending of ['', '...', '…']) {
    const f = fixture(); f.coordinator.start(step); f.signal();
    f.coordinator.transcript('Surface tension pulls the soap film inward' + ending); f.quiet(2000);
    assert.equal(f.sent.length, 0);
    f.signal(); f.coordinator.transcript(' and keeps the bubble round.'); f.quiet();
    assert.equal(f.sent.length, 1);
  }
});

test('a focus-only prelude and quoted or bracketed ellipses cannot advance', () => {
  const f = fixture();
  f.coordinator.start({...step, focus_label: 'Guard fails',
    narration: 'When a Guard fails because a value’s type changes, execution leaves that compiled trace through a side exit.'});
  f.signal(); f.coordinator.transcript("Now let's look at the Guard and how it fails here in this diagram.");
  f.quiet(2000); assert.equal(f.sent.length, 0);
  for (const fragment of ['"Surface tension pulls the soap film inward and keeps..."',
    '[Surface tension pulls the soap film inward and keeps...]',
    '“Surface tension pulls the soap film inward and keeps…”']) {
    const g = fixture(); g.coordinator.start(step); g.signal(); g.coordinator.transcript(fragment);
    g.quiet(2000); assert.equal(g.sent.length, 0);
  }
});

test('browser host timers retain their receiver during scheduling and cancellation', () => {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  let scheduled = 0, cleared = 0;
  try {
    globalThis.setTimeout = function () { assert.equal(this, globalThis); return ++scheduled; };
    globalThis.clearTimeout = function () { assert.equal(this, globalThis); cleared++; };
    const stats = {audioRenderedSignalSamples: 0, audioRenderedQuietMs: 0};
    const player = {version: 1, lastState: 'playing'};
    const coordinator = new TeachingSequence({stats, player, send: () => {}});
    coordinator.start(step); stats.audioRenderedSignalSamples = 100;
    coordinator.transcript(spokenStep); stats.audioRenderedQuietMs = 300;
    coordinator.update({idle: true});
    assert.equal(scheduled, 1); coordinator.cancel(); assert.equal(cleared, 1);
  } finally {
    globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear;
  }
});

test('old quiet, transcripts alone, or packet arrival cannot claim heard speech', () => {
  const f = fixture(); f.coordinator.start(step);
  f.coordinator.transcript(spokenStep);
  f.quiet(); f.advance(10000); assert.equal(f.sent.length, 0);
  f.stats.audioRenderedSignalSamples += 100;
  f.quiet(); f.advance(10000); assert.equal(f.sent.length, 0);
  f.signal(); f.quiet(); assert.equal(f.sent.length, 1);
});

test('rendered output without useful fresh current-focus transcript remains paused', () => {
  const f = fixture(); f.coordinator.start(step); f.signal(); f.quiet();
  f.coordinator.transcript('All right, I am ready.'); f.quiet();
  f.coordinator.transcript(' The blue rectangle moves to the right.'); f.quiet();
  assert.equal(f.sent.length, 0);
});

test('a quiet timer rechecks live playback and never advances during visitor speech', () => {
  const f = fixture(); f.coordinator.start(step); f.signal();
  f.coordinator.transcript(spokenStep); f.quiet(450);
  f.speak(true); f.stats.audioRenderedQuietMs = 900; f.advance(450);
  assert.equal(f.sent.length, 0); assert.equal(f.timers.size, 0);
  f.speak(false); f.quiet(); assert.equal(f.sent.length, 1);
});

test('resumed output resets idle and must become quiet again', () => {
  const f = fixture(); f.coordinator.start(step); f.signal();
  f.coordinator.transcript(spokenStep); f.quiet(450);
  f.signal(); f.advance(1000); assert.equal(f.sent.length, 0);
  f.quiet(); assert.equal(f.sent.length, 1);
});

test('playback reset invalidates stale-epoch output and a delayed timer', () => {
  const f = fixture(); f.coordinator.start(step); f.signal();
  f.coordinator.transcript(spokenStep); f.quiet(450);
  f.player.version++; f.stats.audioRenderedQuietMs = 1000; f.advance(600);
  assert.equal(f.sent.length, 0); assert(f.coordinator.paused);
  assert.equal(f.coordinator.transcript(spokenStep), false);
});

test('cancellation is idempotent and rejects late steps and transcripts', () => {
  const f = fixture(); f.coordinator.start(step); f.signal();
  f.coordinator.transcript(spokenStep); f.quiet(450);
  const lateCallback = [...f.timers.values()][0].callback;
  assert(f.coordinator.cancel()); assert.equal(f.coordinator.cancel(), false);
  f.stats.audioRenderedQuietMs = 1000; f.advance(1000);
  assert.deepEqual(f.sent, [{type: 'teaching_cancel', sequence_id: 'teaching-a'}]);
  assert.equal(f.coordinator.start(step), false);
  assert(f.coordinator.start({...step, sequence_id: 'teaching-b'}));
  lateCallback(); assert.equal(f.sent.length, 1);
  assert.equal(f.coordinator.start({...step, index: 1}), false);
  assert.equal(f.coordinator.transcript(spokenStep, {sequence_id: 'teaching-a', index: 0}), false);
});

test('strict indices and immutable count require the preceding acknowledged step', () => {
  const f = fixture();
  assert.equal(f.coordinator.start({...step, index: 1}), false);
  assert.equal(f.coordinator.start({...step, count: 7}), false);
  assert(f.coordinator.start(step)); assert(Object.isFrozen(f.coordinator.current));
  assert.equal(f.coordinator.start({...step, index: 1}), false);
  assert(f.coordinator.continueManually());
  assert.equal(f.coordinator.start({...step, index: 2}), false);
  assert.equal(f.coordinator.start({...step, index: 1, count: 4}), false);
  assert(f.coordinator.start({...step, index: 1}));
  f.signal(); f.quiet(); assert.equal(f.sent.length, 1);
  assert.equal(f.coordinator.transcript(spokenStep, {index: 0}), false);
});

test('playback reset happens only for an admitted step and its fresh epoch is captured', () => {
  const f = fixture(); let resets = 0;
  const reset = () => { resets++; f.player.version++; };
  assert(!f.coordinator.start({...step, index: 1}, reset)); assert.equal(resets, 0);
  assert(f.coordinator.start(step, reset)); assert.equal(resets, 1);
  assert.equal(f.stats.teaching.playerVersion, 4);
  assert(!f.coordinator.start(step, reset)); assert.equal(resets, 1);
  f.coordinator.cancel('a-sequence-announced-before-any-speech');
  assert(!f.coordinator.start({...step, sequence_id: 'a-sequence-announced-before-any-speech'}, reset));
  assert.equal(resets, 1);
});

test('explicit manual continuation makes no heard claim and timeout never advances', () => {
  const f = fixture(); f.coordinator.start(step); f.advance(60001); f.coordinator.update();
  assert(f.coordinator.paused); assert.equal(f.sent.length, 0);
  assert(f.coordinator.continueManually()); assert.equal(f.coordinator.continueManually(), false);
  assert.deepEqual(f.sent, [{type: 'teaching_boundary', sequence_id: 'teaching-a', index: 0, heard: false, manual: true}]);
});

test('the existing speaker delay is included before claiming rendered quiet', () => {
  const f = fixture(); f.player.nativeDelaySeconds = .07; f.coordinator.start(step); f.signal();
  f.coordinator.transcript(spokenStep); f.quiet(900);
  assert.equal(f.sent.length, 0);
  f.stats.audioRenderedQuietMs = 970; f.advance(70); assert.equal(f.sent.length, 1);
});

test('a new sequence cannot replace an unfinished last step', () => {
  const f = fixture(); f.coordinator.start({...step, count: 2});
  f.coordinator.continueManually(); f.coordinator.start({...step, count: 2, index: 1});
  assert.equal(f.coordinator.start({...step, sequence_id: 'teaching-b'}), false);
  f.coordinator.continueManually();
  assert(f.coordinator.start({...step, sequence_id: 'teaching-b'}));
  assert.equal(f.coordinator.start(step), false);
});

test('muted output remains a manual decision even if the unmuted counters later rise', () => {
  const f = fixture(); f.coordinator.start(step); f.signal();
  f.coordinator.transcript(spokenStep);
  f.player.muted = true; f.quiet(); assert(f.coordinator.paused);
  f.player.muted = false; f.signal(); f.quiet(); assert.equal(f.sent.length, 0);
  f.coordinator.continueManually(); assert.equal(f.sent[0].heard, false);
});

test('an uncertain boundary send is not retried by later idle events', () => {
  const f = fixture(); let attempts = 0;
  f.coordinator.send = () => { attempts++; throw Error('Carrier closed'); };
  f.coordinator.start(step); f.signal();
  f.coordinator.transcript(spokenStep); f.quiet(); f.quiet();
  assert.equal(attempts, 1); assert(f.coordinator.paused);
  assert.equal(f.coordinator.continueManually(), false);
});

test('bounded teaching snapshots preserve actual step evidence across progression and cancel', () => {
  const f = fixture(); f.coordinator.start(step);
  assert.equal(f.stats.teaching.phase, 'waiting-speech');
  assert.equal(f.stats.teaching.baselineSignalSamples, 100);
  f.signal(); f.coordinator.transcript(spokenStep); f.quiet();
  assert.equal(f.stats.teaching.heard, true);
  assert.equal(f.stats.teaching.playerVersion, 3);
  assert.equal(f.stats.teaching.steps[0].signalObserved, true);
  assert(f.coordinator.start({...step, index: 1}));
  assert.equal(f.stats.teaching.steps.length, 2);
  assert.equal(f.stats.teaching.steps[0].heard, true);
  assert.equal(f.stats.teaching.steps[1].transcript, '');
  f.coordinator.cancel();
  assert.equal(f.stats.teaching.cancelled, true);
  assert.equal(f.stats.teaching.active, false);
  assert.equal(f.stats.teaching.steps[1].heard, null);
});

test('a familiar mid-step fragment and a reflective pause never advance the explanation', () => {
  const f = fixture(); f.coordinator.start(step); f.signal();
  f.coordinator.transcript('Surface tension pulls'); f.quiet(1000); f.advance(5000);
  assert.equal(f.sent.length, 0); assert.equal(f.coordinator.active, true);
  assert.equal(f.timers.size, 0);
  f.signal(); f.coordinator.transcript(' the soap film inward and keeps the bubble round.'); f.quiet();
  assert.deepEqual(f.sent, [{type: 'teaching_boundary', sequence_id: 'teaching-a', index: 0, heard: true}]);
});

test('naming the focus and its material cannot substitute for the planned mechanism', () => {
  const f = fixture(); f.coordinator.start(step); f.signal();
  f.coordinator.transcript('Surface tension and soap film.'); f.quiet(1500);
  assert.equal(f.sent.length, 0);
  assert(f.coordinator.continueManually());
  assert.deepEqual(f.sent, [{type: 'teaching_boundary', sequence_id: 'teaching-a', index: 0, heard: false, manual: true}]);
});

test('only a matching server completion after all boundaries survives Stop as completed', () => {
  const f=fixture(), completion={sequence_id:step.sequence_id,status:'presented-progressively'};
  f.coordinator.start(step);assert.equal(f.coordinator.finish(completion),false);
  for(let index=0;index<3;index++){
    if(index)assert(f.coordinator.start({...step,index}));
    assert(f.coordinator.continueManually());
  }
  assert.equal(f.coordinator.finish({...completion,sequence_id:'old'}),false);
  assert.equal(f.coordinator.finish({...completion,status:'paused'}),false);
  assert(f.coordinator.finish(completion));assert.equal(f.stats.teaching.phase,'completed');
  f.coordinator.cancel();
  assert.equal(f.stats.teaching.phase,'completed');assert.equal(f.stats.teaching.cancelled,false);
  assert.equal(f.stats.teaching.heard,false);assert.equal(f.stats.teaching.manual,true);
  assert.equal(f.coordinator.start(step),false);
});
