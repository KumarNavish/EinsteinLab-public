import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeConversation} from '../src/native-audio.js';

// Local clock/player/socket fixtures; no browser, microphone or provider.
function fixture(t) {
  t.mock.timers.enable({apis: ['setTimeout']});
  const events = [], states = [], packets = [], sent = [], stats = {audioPlaying: false};
  const player = {version: 0, entries: [], finishes: 0,
    stop() { this.version++; this.entries = []; stats.audioPlaying = false; },
    finish() { this.finishes++; },
    async enqueuePCM(bytes, rate, version) {
      if (version !== this.version) return;
      packets.push([...bytes]); this.entries = [{end: Infinity}]; stats.audioPlaying = true;
    },
  };
  const native = new NativeConversation({player, stats, onEvent: event => events.push(event),
    onState: state => states.push(state), onError: message => assert.fail(message)});
  native.active = true; native.serial = 1; native.continuousAudio = true;
  native.playerVersion = player.version;
  native.socket = {readyState: 1, send: value => sent.push(value), close() {}};
  t.after(() => clearTimeout(native.drainTimer));
  return {native, player, stats, events, states, packets, sent};
}
const audio = () => ({event: 'audio', generation: 0, sample_rate: 24000, data: 'AQACAA=='});
const settle = async native => { await native.pendingQueue; await Promise.resolve(); await Promise.resolve(); };

test('continuous playback drains locally without a provider completion event', async t => {
  const h = fixture(t);
  h.native.handle(audio(), 1); await settle(h.native);
  h.native.playbackState('idle');
  assert.equal(h.events.filter(event => event.event === 'playback_idle').length, 0);
  t.mock.timers.tick(399); await settle(h.native); assert.equal(h.player.finishes, 0);
  t.mock.timers.tick(1); await settle(h.native); assert.equal(h.player.finishes, 1);
  assert.equal(h.events.filter(event => event.event === 'playback_idle').length, 0, 'queued audio must actually drain');
  assert.equal(h.stats.nativeLastPlaybackBoundaryAt, undefined);
  const beforeDrain = performance.now();
  h.stats.audioPlaying = false; h.player.entries = []; h.native.playbackState('idle');
  const drainedAt = h.stats.nativeLastPlaybackBoundaryAt;
  h.native.playbackState('idle');
  assert(drainedAt >= beforeDrain && drainedAt <= performance.now());
  assert.equal(h.stats.nativeLastPlaybackBoundaryAt, drainedAt);
  assert.deepEqual(h.events.filter(event => event.event === 'playback_idle'),
    [{event: 'playback_idle', source: 'client-local', boundary: 'playback-drained'}]);
  assert.equal(h.stats.nativePlaybackBoundaries, 1);
  assert.equal(h.stats.nativeCompletedTurns, undefined);
  assert(!h.events.some(event => event.event === 'turn_complete'));
});

test('new packets extend the local inactivity window', async t => {
  const h = fixture(t);
  h.native.handle(audio(), 1); await settle(h.native);
  t.mock.timers.tick(300); h.native.handle(audio(), 1); await settle(h.native);
  t.mock.timers.tick(100); await settle(h.native); assert.equal(h.player.finishes, 0);
  t.mock.timers.tick(300); await settle(h.native); assert.equal(h.player.finishes, 1);
});

test('continuous speech overlap drops playback and cancels application teaching without inventing provider completion', async t => {
  const h = fixture(t);
  h.native.handle(audio(), 1); await settle(h.native);
  const generation = h.native.generation;
  h.native.detectSpeech(.08, .15, 100);
  assert.equal(h.native.suppressAudio, true); assert.equal(h.native.speaking, true);
  assert.equal(h.stats.nativeLocalOverlaps, 1);
  h.native.handle(audio(), 1); await settle(h.native); assert.equal(h.packets.length, 1);
  assert.equal(h.stats.nativeSuppressedAudioPackets, 1);
  h.native.detectSpeech(.08, .1, 200);
  assert.equal(h.events.filter(event => event.event === 'input_start').length, 1);
  h.native.detectSpeech(0, .1, 651);
  assert.equal(h.native.suppressAudio, false); assert.equal(h.native.speaking, false);
  assert.equal(h.native.generation, generation); assert.deepEqual(h.sent.map(JSON.parse), [{type: 'teaching_cancel', cancellation_id: 1}]);
  assert.equal(h.player.entries.length, 0);
  h.native.handle(audio(), 1); await settle(h.native); assert.equal(h.packets.length, 2);
  assert.equal(h.events.filter(event => event.event === 'input_end').length, 1);
  assert(!h.events.some(event => event.event === 'interrupted'));
});

test('a new typed question clears queued playback and reports the current question immediately', async t => {
  const h = fixture(t);
  h.native.handle(audio(), 1); await settle(h.native);
  const previous = h.player.version;
  h.native.sendText('How many pages are in this PDF?');
  assert(h.player.version > previous);
  assert.equal(h.player.entries.length, 0);
  assert.equal(h.native.outputPending, false);
  assert.deepEqual(h.sent.map(JSON.parse), [{type: 'teaching_cancel', cancellation_id: 1}, {type: 'text', text: 'How many pages are in this PDF?'}]);
  assert.deepEqual(h.events.at(-1), {event: 'input_start', source: 'typed', text: 'How many pages are in this PDF?'});
  assert.equal(h.states.at(-1), 'thinking');
  assert.equal(h.native.generation, 0);
});

test('paused local output discards both remaining audio and captions', async t => {
  const h = fixture(t); h.native.suppressAudio = true;
  h.native.handle({event: 'output_transcript', text: 'A superseded explanation.', generation: 0}, 1);
  h.native.handle(audio(), 1); await settle(h.native);
  assert.deepEqual(h.events, []); assert.equal(h.packets.length, 0);
});

test('late first steps and diagram actions cannot reopen a cancelled explanation', async t => {
  const h = fixture(t); let rendered = 0;
  h.native.presentationHandler = async () => { rendered++; return {status: 'displayed'}; };
  h.native.handle({event: 'teaching_started', sequence_id: 'retired-sequence'}, 1);
  h.native.cancelTeaching(); h.native.suppressAudio = true;
  const version = h.player.version;
  h.native.handle({event: 'teaching_step', sequence_id: 'retired-sequence', index: 0, count: 2,
    focus_label: 'Input', narration: 'Input is the starting point.'}, 1);
  h.native.handle({event: 'presentation_action', generation: 0, sequence_id: 'retired-sequence',
    action: {action_id: 'late-action', revision: 1, kind: 'diagram'}}, 1);
  await settle(h.native);
  assert.equal(h.player.version, version); assert.equal(h.native.suppressAudio, true);
  assert.equal(rendered, 0); assert(!h.events.some(e => e.event === 'teaching_step'));
  assert.deepEqual(JSON.parse(h.sent.at(-1)), {type: 'presentation_result', action_id: 'late-action',
    generation: 0, revision: 1, status: 'failed', rendered_elements: 0});
});

test('cancellation before an announced ID rejects old starts until the ordered matching server acknowledgement', async t => {
  const h = fixture(t); let rendered = 0;
  h.native.presentationHandler = async () => { rendered++; return {revision: 2, status: 'displayed', rendered_elements: 1}; };
  h.native.cancelTeaching();
  h.native.handle({event: 'teaching_started', sequence_id: 'late-old-sequence'}, 1);
  h.native.handle({event: 'presentation_action', generation: 0, sequence_id: 'late-old-sequence',
    action: {action_id: 'old', revision: 1, kind: 'diagram'}}, 1);
  await settle(h.native);
  assert.equal(rendered, 0); assert.equal(h.native.teachingSequenceId, undefined);
  assert(h.native.teaching.retired.has('late-old-sequence'));
  h.native.handle({event: 'teaching_cancelled', cancellation_id: 99}, 1);
  assert.equal(h.native.teachingCancelPending, 1);
  h.native.handle({event: 'teaching_cancelled', cancellation_id: 1}, 1);
  assert.equal(h.native.teachingCancelPending, null);
  h.native.handle({event: 'teaching_started', sequence_id: 'new-sequence'}, 1);
  h.native.handle({event: 'presentation_action', generation: 0, sequence_id: 'new-sequence',
    action: {action_id: 'new', revision: 2, kind: 'diagram'}}, 1);
  await settle(h.native);
  assert.equal(rendered, 1);
  assert(h.events.some(event => event.event === 'teaching_started' && event.sequence_id === 'new-sequence'));
});

test('a pending old decode cannot restore output after local overlap', async t => {
  const h = fixture(t); let finishDecode;
  h.player.enqueuePCM = () => new Promise(resolve => { finishDecode = resolve; });
  h.native.handle(audio(), 1); await Promise.resolve();
  h.native.detectSpeech(.08, .15, 100);
  finishDecode(); await settle(h.native);
  assert.equal(h.states.at(-1), 'listening');
});

test('continuous mode ignores unsupported provider boundary events and teardown removes local timers', async t => {
  const h = fixture(t);
  h.native.handle({event: 'turn_complete', generation: 0}, 1);
  h.native.handle({event: 'interrupted', generation: 1}, 1);
  assert.deepEqual(h.events, []); assert.equal(h.native.generation, 0);
  h.native.handle(audio(), 1); await settle(h.native);
  await h.native.cleanup(1);
  t.mock.timers.tick(1000); await settle(h.native);
  assert.equal(h.native.active, false); assert.equal(h.player.entries.length, 0);
  assert.equal(h.player.finishes, 0); assert.equal(h.stats.microphoneActive, false);
});
