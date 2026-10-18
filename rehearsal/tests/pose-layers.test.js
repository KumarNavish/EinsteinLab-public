import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {PoseLayers} from '../src/pose-layers.js';

function fixture() {
  const root = new THREE.Group();
  const chest = new THREE.Bone(); const head = new THREE.Bone();
  root.add(chest); chest.add(head);
  chest.quaternion.setFromEuler(new THREE.Euler(.04, .01, -.02));
  head.quaternion.setFromEuler(new THREE.Euler(-.10, 0, 0));
  root.updateMatrixWorld(true);
  return {root, chest, head, layers: new PoseLayers([chest, head])};
}

test('held animation cannot accumulate head rotation over ten minutes', () => {
  const {head, layers} = fixture(); const original = head.quaternion.clone();
  for (let i = 0; i < 36000; i++) {
    layers.restoreAnimationPose();
    // A held PropertyMixer may legitimately perform no write here.
    layers.captureAnimationPose();
    layers.applyWorldOffset(head, .012, .025, .004);
    assert(head.quaternion.angleTo(original) < .04);
  }
  layers.reset(); assert(head.quaternion.angleTo(original) < 1e-7);
});

test('procedural layer is idempotent, not a repeated local-axis rotation', () => {
  const {head, layers} = fixture();
  layers.captureAnimationPose(); layers.applyWorldOffset(head, .01, -.03, 0);
  const once = head.quaternion.clone();
  for (let i = 0; i < 50; i++) layers.applyWorldOffset(head, .01, -.03, 0);
  assert(head.quaternion.angleTo(once) < 1e-7);
});

test('updated authored animation is preserved after procedural motion is removed', () => {
  const {head, layers} = fixture();
  layers.captureAnimationPose(); layers.applyWorldOffset(head, .02, .02, .01);
  layers.restoreAnimationPose();
  const next = new THREE.Quaternion().setFromEuler(new THREE.Euler(-.08, .1, .03));
  head.quaternion.copy(next); layers.captureAnimationPose();
  layers.applyWorldOffset(head, -.02, .02, 0); layers.restoreAnimationPose();
  assert(head.quaternion.angleTo(next) < 1e-7);
});

test('nonfinite and excessive offsets remain finite and bounded', () => {
  const {head, layers} = fixture(); const original = head.quaternion.clone();
  layers.captureAnimationPose(); layers.applyWorldOffset(head, NaN, 40, -Infinity);
  assert(head.quaternion.toArray().every(Number.isFinite));
  assert(head.quaternion.angleTo(original) <= .091);
});

test('world-oriented yaw remains correct under a rotated rig parent', () => {
  const {root, head, layers} = fixture();
  root.rotation.y = Math.PI / 2; root.updateMatrixWorld(true);
  const reference = head.getWorldQuaternion(new THREE.Quaternion());
  layers.captureAnimationPose(); layers.applyWorldOffset(head, 0, .04, 0);
  const expected = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), .04).multiply(reference);
  assert(head.getWorldQuaternion(new THREE.Quaternion()).angleTo(expected) < 1e-7);
});

// A PropertyMixer holding a zero blink value can skip subsequent zero writes.
// max(previousMorph, proceduralBlink) otherwise leaves the eyelid shut forever.
test('held morph animation reopens eyes and relaxes brows after a transient expression', async () => {
  const {ExpressionLayers} = await import('../src/pose-layers.js');
  const mesh = {morphTargetDictionary:{Eye_Blink_L:0,Brow_Raise_Inner_L:1},morphTargetInfluences:[0,.01]};
  const layers = new ExpressionLayers([mesh]);
  for (let i=0;i<600;i++) {
    layers.restoreAnimationPose();layers.captureAnimationPose();
    mesh.morphTargetInfluences[0]=Math.max(mesh.morphTargetInfluences[0],i===10?1:0);
    mesh.morphTargetInfluences[1]=Math.max(mesh.morphTargetInfluences[1],i<20?.08:0);
  }
  assert.equal(mesh.morphTargetInfluences[0],0);
  assert(Math.abs(mesh.morphTargetInfluences[1]-.01)<1e-7);
});

test('authored facial values are preserved beneath procedural expressions', async () => {
  const {ExpressionLayers} = await import('../src/pose-layers.js');
  const mesh={morphTargetDictionary:{Eye_Blink_R:0},morphTargetInfluences:[.2]};
  const layers=new ExpressionLayers([mesh]);
  layers.restoreAnimationPose();mesh.morphTargetInfluences[0]=.35;layers.captureAnimationPose();
  mesh.morphTargetInfluences[0]=1;layers.restoreAnimationPose();
  assert(Math.abs(mesh.morphTargetInfluences[0]-.35)<1e-6);
});


test('an externally applied IK pose never becomes the next held animation baseline', () => {
  const {head: arm, layers} = fixture();
  const authored = arm.quaternion.clone();
  for (let frame = 0; frame < 500; frame++) {
    layers.restoreAnimationPose(); layers.captureAnimationPose();
    // A separate IK controller writes directly, rather than calling applyWorldOffset.
    arm.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1.2));
  }
  layers.restoreAnimationPose();
  assert(arm.quaternion.angleTo(authored) < 1e-7);
});

test('multiple externally animated bones independently recover their authored values', () => {
  const {head, chest, layers} = fixture();
  const initial = [head.quaternion.clone(), chest.quaternion.clone()];
  layers.captureAnimationPose();
  head.quaternion.setFromEuler(new THREE.Euler(.5, .6, .2));
  chest.quaternion.setFromEuler(new THREE.Euler(-.4, .3, .1));
  layers.restoreAnimationPose();
  assert(head.quaternion.angleTo(initial[0]) < 1e-7);
  assert(chest.quaternion.angleTo(initial[1]) < 1e-7);
});
