import test from 'node:test';
import assert from 'node:assert/strict';
import {SpeechPlayer} from '../src/speech-player.js';

function fixture(t, facePrepare, addModule = async () => {}) {
  const connections = [], modules = [], stats = {};
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'AudioWorkletNode');
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'AudioWorkletNode', previous); else delete globalThis.AudioWorkletNode; });
  Object.defineProperty(globalThis, 'AudioWorkletNode', {configurable: true, value: class {
    constructor(context, name) { this.name = name; this.port = {postMessage() {}}; }
    connect(node) { connections.push(['stream', node]); }
  }});
  const player = new SpeechPlayer({}, () => {}, stats);
  player.activate = async () => {};
  player.context = {state: 'running', audioWorklet: {addModule: async url => { modules.push(url); await addModule(); }}};
  player.nativeBus = {connect: node => connections.push(['face', node])};
  player.face = {prepare: facePrepare};
  player.compatibilityNode = async () => { throw new Error('worklet unavailable'); };
  return {player, stats, connections, modules};
}

test('a stalled optional viseme model cannot delay the essential voice stream', async t => {
  // Match the browser's observed running context / unfinished classifier state.
  const h = fixture(t, () => new Promise(() => {}));
  await h.player.prepareNative();
  assert.equal(h.player.streamNode.name, 'einstein-pcm-stream');
  assert.deepEqual(h.modules, ['/audio/pcm-stream.worklet.mjs?watermark=v1']);
  assert.equal(h.stats.continuousAudioStream, true);
  assert.equal(h.stats.audioFacePhase, 'loading');
  assert.equal(h.player.faceConnected, undefined);
});

test('the real classifier attaches once when its delayed preparation finishes', async t => {
  let finish, calls = 0;
  const h = fixture(t, () => { calls++; return new Promise(resolve => { finish = resolve; }); });
  await h.player.prepareNative(); await h.player.prepareNative();
  const face = {}; finish(face); await h.player.facePromise;
  assert.equal(calls, 1); assert.equal(h.modules.length, 1);
  assert.deepEqual(h.connections.filter(([kind]) => kind === 'face'), [['face', face]]);
  assert.equal(h.stats.audioFacePhase, 'ready');
});

test('failed essential preparation is reported and only an explicit retry reloads it', async t => {
  let attempts = 0;
  const h = fixture(t, async () => null, async () => { if (++attempts === 1) throw Error('worklet unavailable'); });
  await assert.rejects(h.player.prepareNative(), /worklet unavailable/);
  assert.equal(attempts, 1); assert.equal(h.player.streamPromise, null);
  await h.player.prepareNative();
  assert.equal(attempts, 2); assert.equal(h.stats.continuousAudioStream, true);
  assert.equal(h.stats.audioFacePhase, 'unavailable');
});

test('an unavailable primary worklet selects the compatibility node without waiting for the face model', async t => {
  const h = fixture(t, () => new Promise(() => {}), async () => {throw Error('unsupported');});
  const node = {port:{postMessage(){}}, connect: value => h.connections.push(['compatibility',value])};
  h.player.context.sampleRate=48000;h.player.compatibilityNode=async()=>node;
  await h.player.prepareNative();
  assert.equal(h.player.streamNode,node);assert.equal(h.stats.nativePlaybackEngine,'compatibility-buffer');
  assert.equal(h.stats.audioWorkletPreparation,'unavailable');assert.equal(h.stats.audioFacePhase,'loading');
  assert.equal(h.stats.nativeCompatibilityBufferMs,1024/48000*1000);
});

test('a pending primary worklet has a bounded deadline and cannot later replace the selected node', async t => {
  t.mock.timers.enable({apis:['setTimeout']});let release;
  const h=fixture(t,async()=>null,()=>new Promise(resolve=>{release=resolve;}));
  const node={port:{postMessage(){}},connect(){}};h.player.compatibilityNode=async()=>node;
  const pending=h.player.prepareNative();await Promise.resolve();await Promise.resolve();await Promise.resolve();
  t.mock.timers.tick(1500);await pending;
  assert.equal(h.stats.audioWorkletPreparation,'timed-out');assert.equal(h.player.streamNode,node);
  release();await Promise.resolve();await Promise.resolve();assert.equal(h.player.streamNode,node);
});
