import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeConversation} from '../src/native-audio.js';

function fixture(t) {
  const saved = globalThis.WebSocket; globalThis.WebSocket = class {static OPEN = 1;};
  t.after(() => { if (saved === undefined) delete globalThis.WebSocket; else globalThis.WebSocket = saved; });
  const packets = [], states = [], events = [];
  const stats = {audioRenderedSignalSamples: 0, audioRenderedQuietMs: 2000};
  const player = {version: 0, entries: [], stop() {this.version++;}};
  const native = new NativeConversation({player, stats, onState: state => states.push(state),
    onEvent: event => events.push(event), onError: message => assert.fail(message)});
  native.active = true; native.serial = 1; native.continuousAudio = true;
  native.socket = {readyState: 1, send: packet => packets.push(JSON.parse(packet))};
  native.sharedDocument = {id: 'a'.repeat(64)};
  native.teachingSequenceId = 'source-a';
  return {native, stats, player, packets, states, events};
}

test('concurrent actual tools keep local playback idle from announcing Listening', t => {
  const f = fixture(t);
  for (const id of ['read', 'plan']) f.native.handle({event: 'evidence_activity', tool_call_id: id, status: 'running', generation: 0}, 1);
  f.native.handle({event: 'evidence_activity', tool_call_id: 'read', status: 'finished', generation: 0}, 1);
  f.native.outputPending = true; f.native.drainReady = true;
  f.native.playbackState('idle');
  assert.equal(f.states.at(-1), 'thinking'); assert.equal(f.stats.nativePendingEvidence, 1);
  f.native.handle({event: 'evidence_activity', tool_call_id: 'plan', status: 'finished', generation: 7}, 1);
  assert.equal(f.native.pendingEvidence.size, 1, 'A stale generation cannot clear the current tool.');
  f.native.handle({event: 'evidence_activity', tool_call_id: 'plan', status: 'finished', generation: 0}, 1);
  f.native.outputPending = true; f.native.drainReady = true; f.native.playbackState('idle');
  assert.equal(f.states.at(-1), 'listening');
});

test('cancelled source marks cannot reach the viewer or return a successful render ACK', async t => {
  const f = fixture(t); let rendered = false;
  f.native.documentHandler = () => {rendered = true;};
  const action = {kind: 'mark', action_id: 'late', document_id: 'a'.repeat(64), revision: 1,
    view_revision: 0, teaching: {sequence_id: 'source-a', index: 0, count: 3}};
  f.native.handle({event: 'document_action', generation: 0, action}, 1);
  f.native.cancelTeaching();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(rendered, false); assert.equal(f.packets.at(-1).ok, false);
  assert.equal(f.events.at(-1).event, 'teaching_local_cancel');
});

test('removing approved paper or video stops old playback and suppresses its remaining packets', t => {
  for (const kind of ['Document', 'Video']) {
    const f = fixture(t); f.stats.audioPlaying = true;
    const epoch = f.player.version;
    f.native['revoke' + kind]();
    assert.equal(f.player.version, epoch + 1); assert.equal(f.native.suppressAudio, true);
    f.native.handle({event: 'output_transcript', text: 'Old source narration.', generation: 0}, 1);
    assert.equal(f.events.at(-1).event, 'source_revoked');
  }
});
