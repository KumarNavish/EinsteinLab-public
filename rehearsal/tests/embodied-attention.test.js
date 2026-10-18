import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {EmbodiedAttention, setPresentationFocus, clearPresentationFocus} from '../src/embodied-attention.js';
import {EinsteinStage} from '../src/scene.js';
import {PoseLayers} from '../src/pose-layers.js';
import {SpatialBoard} from '../src/spatial-board.js';

// Execute the real stage update, mixer and PoseLayers offline. No renderer,
// microphone, character transfer, browser or provider is started by this fixture.
const globals = ['document', 'matchMedia'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
let reducedMotion = false;
before(() => {
  globalThis.document = {visibilityState: 'visible'};
  globalThis.matchMedia = () => ({matches: reducedMotion});
});
after(() => {
  for (const [name, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
  }
});

// Keyframe tracks use Float32 values; angleTo assumes unit quaternions.
const angle = (a, b) => a.clone().normalize().angleTo(b.clone().normalize());

function attentionFixture(actorYaw = 0) {
  const actor = new THREE.Group(), model = new THREE.Group(); actor.add(model); actor.rotation.y = actorYaw;
  const chest = new THREE.Bone(); chest.name = 'CC_Base_Spine02'; chest.position.y = 1.2; model.add(chest);
  chest.quaternion.setFromEuler(new THREE.Euler(.02, -.01, .01));
  const head = new THREE.Bone(); head.name = 'CC_Base_Head'; head.position.y = .4; chest.add(head);
  head.quaternion.setFromEuler(new THREE.Euler(-.04, .015, -.02));
  const arms = [];
  for (const [side, sign] of [['L', 1], ['R', -1]]) {
    const upper = new THREE.Bone(), forearm = new THREE.Bone(), hand = new THREE.Bone(), finger = new THREE.Bone();
    for (const [bone, name] of [[upper, 'Upperarm'], [forearm, 'Forearm'], [hand, 'Hand'], [finger, 'Index1']]) {
      bone.name = `CC_Base_${side}_${name}`; arms.push(bone);
      bone.quaternion.setFromEuler(new THREE.Euler(.07, .02, -.13 * sign));
    }
    chest.add(upper); upper.position.set(.22 * sign, .2, 0);
    upper.add(forearm); forearm.position.y = -.3;
    forearm.add(hand); hand.position.y = -.27; hand.add(finger); finger.position.y = -.08;
  }
  actor.updateMatrixWorld(true);
  const bones = [chest, head, ...arms];
  const mixer = new THREE.AnimationMixer(model);
  const held = bones.map(bone => new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, [0, 1], [...bone.quaternion.toArray(), ...bone.quaternion.toArray()]));
  const idle = mixer.clipAction(new THREE.AnimationClip('Held authored pose', 1, held)).play();
  const recorded = new THREE.QuaternionKeyframeTrack(`${arms[0].name}.quaternion`, [0, 1], [0, 0, 0, 1, 0, 0, 1, 0]);
  const performance = mixer.clipAction(new THREE.AnimationClip('Unrelated body performance', 1, [recorded]));
  performance.setEffectiveWeight(0); mixer.update(0);
  const authored = bones.map(bone => bone.quaternion.clone());
  const camera = new THREE.PerspectiveCamera(31, 1, .01, 60);
  camera.position.set(0, 1.46, 2.82).applyAxisAngle(new THREE.Vector3(0, 1, 0), actorYaw);
  camera.lookAt(new THREE.Vector3(0, 1.23, 0)); camera.updateMatrixWorld(true);
  const scene = new THREE.Scene(); scene.add(actor);
  const stage = Object.assign(Object.create(EinsteinStage.prototype), {
    actor, model, head, chest, camera, scene, mixer, idle, performance,
    poseLayers: new PoseLayers([chest, head]), ready: true, frames: [], last: 0,
    quality: {reduced: false, observe: () => false}, interacting: true,
    speech: {active: false, amplitude: 0, time: 0, cues: []}, morphs: [], current: {},
    conversationState: 'ready', nextBlinkAt: 1.8, blinkStarted: -10, randomState: 92821,
    controls: {update() {}}, onInfo() {}, performanceWeight: 0,
    renderer: {xr: {isPresenting: false}, render() {}, getPixelRatio: () => 1,
      shadowMap: {enabled: false}, info: {render: {triangles: 0, calls: 0}}},
  });
  let now = 0;
  const attention = new EmbodiedAttention(stage, () => now); attention.initialize(); stage.attention = attention;
  const frame = (options = {}, dt = 1 / 60) => {
    reducedMotion = Boolean(options.reducedMotion); now += dt * 1000; stage.update(now); actor.updateMatrixWorld(true);
  };
  const focus = (target = new THREE.Vector3(.8, 1.3, -.2), owner = 'source') => {
    actor.updateMatrixWorld(true); setPresentationFocus(stage, actor.localToWorld(target.clone()), owner);
    stage.presentationFocusUntil = now + 12000;
  };
  const assertRestHands = () => {
    for (const [index, bone] of arms.entries()) assert.deepEqual(bone.quaternion.toArray(), authored[index + 2].toArray(), bone.name);
  };
  return {stage, actor, head, chest, arms, authored, attention, frame, focus, assertRestHands, now: () => now};
}

test('explicit focus gently orients the head and torso while both hands keep authored rest', () => {
  const {stage, head, chest, authored, attention, frame, focus, assertRestHands} = attentionFixture();
  focus();
  for (let i = 0; i < 120; i++) { frame(); assertRestHands(); }
  assert(attention.headOffset.yaw > .07); assert(attention.torsoOffset.yaw > .02);
  assert(angle(head.quaternion, authored[1]) > .05); assert(angle(chest.quaternion, authored[0]) > .02);
  assert.equal(stage.speech.active, false, 'Orientation does not require or follow speech amplitude.');
  assert.equal(stage.performance.getEffectiveWeight(), 0); assert.equal(stage.performance.isRunning(), false);
  assert.equal(stage.attentionMetrics.pointing, null); assert.equal(stage.attentionMetrics.eyeTargetingEnabled, false);
});

test('the actual stage composes attention and idle once per bone over the mixer baseline', () => {
  const {stage, attention, frame, focus} = attentionFixture(); stage.conversationState = 'thinking';
  stage.camera.position.x = .8; stage.camera.lookAt(0, 1.23, 0); focus();
  const applied = [];
  const apply = stage.poseLayers.applyWorldOffset.bind(stage.poseLayers);
  stage.poseLayers.applyWorldOffset = (...args) => { applied.push(args); apply(...args); };
  frame();
  assert.equal(applied.length, 2); assert.equal(applied[0][0], stage.chest); assert.equal(applied[1][0], stage.head);
  const seconds = stage.last / 1000;
  assert(Math.abs(applied[0][1] - attention.torsoOffset.pitch - Math.sin(seconds * 1.35) * .0025) < 1e-12);
  assert(Math.abs(applied[0][2] - attention.torsoOffset.yaw) < 1e-12);
  assert(Math.abs(applied[1][1] - attention.headOffset.pitch - .015 * (1 - attention.weight) - Math.sin(seconds * 1.1) * .006) < 1e-12);
  assert(Math.abs(applied[1][2] - attention.headOffset.yaw - .8 * .055 * (1 - attention.weight) - Math.sin(seconds * .29) * .01) < 1e-12);
});

test('a focus beat holds its sampled orientation despite speech, camera changes and deadline renewal', () => {
  const a = attentionFixture(), b = attentionFixture(); a.focus(); b.focus();
  for (let i = 0; i < 240; i++) { a.frame(); b.frame(); }
  const goal = {...b.attention.goal};
  b.stage.camera.position.x = -1; b.stage.camera.lookAt(0, 1.23, 0);
  b.stage.presentationTarget.x = -10;
  for (let i = 0; i < 600; i++) {
    a.stage.presentationFocusUntil = a.now() + 12000; b.stage.presentationFocusUntil = b.now() + 12000;
    a.stage.speech = {active: true, amplitude: .01, time: 0, cues: []};
    b.stage.speech = {active: i % 3 === 0, amplitude: (i % 17) / 17, time: 0, cues: []};
    a.frame(); b.frame(); a.assertRestHands(); b.assertRestHands();
    assert(angle(a.head.quaternion, b.head.quaternion) < 1e-7);
    assert(angle(a.chest.quaternion, b.chest.quaternion) < 1e-7);
  }
  assert.deepEqual(b.attention.goal, goal);
});

test('head plus torso stays below 15 degrees and cannot accumulate over ten minutes', t => {
  const {stage, head, attention, frame, focus, assertRestHands, now} = attentionFixture();
  const rest = head.getWorldQuaternion(new THREE.Quaternion());
  focus(new THREE.Vector3(10000, 10, -.2)); frame();
  assert.deepEqual(attention.goal, {pitch: -.045, yaw: .075});
  let largest = 0;
  for (let i = 0; i < 36000; i++) {
    stage.presentationFocusUntil = now() + 12000; frame(); assertRestHands();
    largest = Math.max(largest, angle(rest, head.getWorldQuaternion(new THREE.Quaternion())));
    assert(largest < THREE.MathUtils.degToRad(15));
  }
  assert(Math.abs(attention.headOffset.pitch) <= .045); assert(Math.abs(attention.headOffset.yaw) <= .075);
  assert(head.quaternion.toArray().every(Number.isFinite));
  t.diagnostic(`Maximum combined head/torso deviation, including idle: ${THREE.MathUtils.radToDeg(largest).toFixed(3)} degrees`);
});

test('a changed focus and source closure ease toward the next pose instead of snapping', () => {
  const a = attentionFixture(), rest = attentionFixture(); a.focus();
  for (let i = 0; i < 120; i++) { a.frame(); rest.frame(); }
  a.focus(new THREE.Vector3(-.8, 1.8, -.2));
  let previous = a.head.getWorldQuaternion(new THREE.Quaternion()), largestStep = 0;
  for (let i = 0; i < 120; i++) {
    a.frame(); rest.frame(); const next = a.head.getWorldQuaternion(new THREE.Quaternion());
    largestStep = Math.max(largestStep, angle(previous, next)); previous = next; a.assertRestHands();
  }
  assert(a.attention.headOffset.yaw < -.07); assert(a.attention.headOffset.pitch < 0);
  assert(largestStep < .03, `Retargeting step: ${largestStep}`);
  clearPresentationFocus(a.stage, 'source'); a.frame(); rest.frame();
  assert(angle(a.head.getWorldQuaternion(new THREE.Quaternion()), previous) < .03);
  assert(angle(a.head.quaternion, rest.head.quaternion) > .03, 'Closing eases back instead of snapping.');
  for (let i = 0; i < 240; i++) { a.frame(); rest.frame(); }
  assert(angle(a.head.quaternion, rest.head.quaternion) < 1e-7);
  assert(angle(a.chest.quaternion, rest.chest.quaternion) < 1e-7); a.assertRestHands();
  assert.equal(a.stage.presentationAwaitingSpeech, false); assert.equal(a.stage.presentationSpeechHeld, false);
});

test('screen-relative orientation composes correctly with a rotated actor', () => {
  const a = attentionFixture(), b = attentionFixture(.7); a.focus(); b.focus();
  for (let i = 0; i < 300; i++) { a.frame(); b.frame(); }
  assert(Math.abs(a.attention.headOffset.yaw - b.attention.headOffset.yaw) < 1e-10);
  assert(Math.abs(a.attention.headOffset.pitch - b.attention.headOffset.pitch) < 1e-10);
  assert(angle(a.head.quaternion, b.head.quaternion) < 1e-7);
  assert(angle(a.chest.quaternion, b.chest.quaternion) < 1e-7); b.assertRestHands();
});

test('reduced motion consumes old revisions before or during focus and preserves the visual selection', () => {
  const {stage, head, chest, authored, attention, frame, focus, assertRestHands} = attentionFixture(); focus();
  frame({reducedMotion: true});
  assert(angle(head.quaternion, authored[1]) < 1e-7); assert(angle(chest.quaternion, authored[0]) < 1e-7);
  for (let i = 0; i < 180; i++) frame();
  assert.deepEqual(attention.headOffset, {pitch: 0, yaw: 0}); assert.equal(attention.weight, 0); assert(stage.presentationTarget);
  focus(); for (let i = 0; i < 60; i++) frame(); assert(attention.headOffset.yaw > .07);
  frame({reducedMotion: true});
  assert(angle(head.quaternion, authored[1]) < 1e-7); assert(angle(chest.quaternion, authored[0]) < 1e-7);
  for (let i = 0; i < 180; i++) frame();
  assert.deepEqual(attention.headOffset, {pitch: 0, yaw: 0}); assert.equal(attention.weight, 0); assertRestHands();
  focus(); frame(); assert(attention.headOffset.yaw > 0, 'A new explicit focus may orient after reduced motion ends.');
});

test('expired focus clears speech-held flags and returns to the ordinary idle pose', () => {
  const a = attentionFixture(), rest = attentionFixture(); a.focus();
  for (let i = 0; i < 120; i++) { a.frame(); rest.frame(); }
  a.stage.presentationSpeechHeld = true; a.stage.presentationFocusUntil = a.now() - 1;
  for (let i = 0; i < 240; i++) { a.frame(); rest.frame(); }
  assert(angle(a.head.quaternion, rest.head.quaternion) < 1e-7); a.assertRestHands();
  assert.equal(a.stage.attentionMetrics.active, false); assert.equal(a.stage.presentationTarget, null);
  assert.equal(a.stage.presentationAwaitingSpeech, false); assert.equal(a.stage.presentationSpeechHeld, false);
});

test('invalid or behind-camera targets and missing rig/camera never produce an orientation', () => {
  const {stage, attention, frame, focus} = attentionFixture();
  assert.equal(setPresentationFocus(stage, new THREE.Vector3(NaN, 0, 1), 'source'), false);
  assert.equal(stage.presentationFocusRevision, undefined);
  focus(new THREE.Vector3(.8, 1.6, 10)); frame(); assert.equal(attention.goal, null);
  const missing = {model: new THREE.Group(), camera: stage.camera};
  const absent = new EmbodiedAttention(missing, () => 0); absent.initialize();
  setPresentationFocus(missing, new THREE.Vector3(1, 1, 0), 'source'); absent.update(NaN);
  assert.deepEqual(absent.headOffset, {pitch: 0, yaw: 0}); assert.equal(absent.weight, 0);
  stage.camera = null; focus(); attention.update(1); assert.equal(attention.goal, null);
});

test('an old surface cannot clear a newer visible source and explicit revisions stay monotonic', () => {
  const stage = {}, target = new THREE.Vector3(1, 2, 3);
  setPresentationFocus(stage, target, 'paper'); setPresentationFocus(stage, target, 'board');
  assert.equal(clearPresentationFocus(stage, 'paper'), false);
  assert.equal(stage.presentationFocusOwner, 'board'); assert.notEqual(stage.presentationTarget, target);
  assert.equal(stage.presentationFocusRevision, 2);
  assert.equal(clearPresentationFocus(stage, 'board'), true); assert.equal(stage.presentationTarget, null);
  setPresentationFocus(stage, target, 'paper'); assert.equal(stage.presentationFocusRevision, 3);
});

test('a whole diagram or unselected passage never invents an orientation target', () => {
  const board = Object.create(SpatialBoard.prototype);
  board.stage = {}; board.group = new THREE.Group(); board.stats = {};
  board.graph = {nodes: [{id: 'a'}], edges: []};
  board.layout = {boxes: {a: {x: 200, y: 200, width: 300, height: 128}}};
  board.attention(); assert.equal(board.stage.presentationTarget, undefined);
  board.attention('a'); assert(board.stage.presentationTarget?.isVector3);
  board.attention('not-visible'); assert.equal(board.stage.presentationTarget, null);
  board.graph = null; board.passage = {text: 'A whole passage'};
  board.passageLayout = {focus: [800, 500], boxes: []};
  board.attention(); assert.equal(board.stage.presentationTarget, null);
  board.passageLayout.boxes = [{x: 120, y: 200, width: 180, height: 34}];
  board.attention(); assert(board.stage.presentationTarget?.isVector3);
});
