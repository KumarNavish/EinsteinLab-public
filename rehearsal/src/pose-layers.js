import * as THREE from 'three';

/** Procedural offsets compose over, never back into, an animation pose.
 * Three.js PropertyMixer can skip unchanged writes; restore the exact pose we
 * captured before adding a procedural offset, even on held animation frames.
 */
export class PoseLayers {
  constructor(bones = []) {
    this.layers = bones.filter(Boolean).map(bone => ({bone, animation: bone.quaternion.clone()}));
    this.offset = new THREE.Quaternion();
    this.parent = new THREE.Quaternion();
    this.world = new THREE.Quaternion();
    this.goal = new THREE.Quaternion();
  }

  restoreAnimationPose() {
    for (const layer of this.layers) {
      layer.bone.quaternion.copy(layer.animation);
    }
  }

  captureAnimationPose() {
    for (const layer of this.layers) layer.animation.copy(layer.bone.quaternion);
  }

  /** Radians about world/actor axes, not the rig's arbitrary local bone axes. */
  applyWorldOffset(bone, pitch, yaw, roll, actorWorld = new THREE.Quaternion()) {
    const layer = this.layers.find(item => item.bone === bone);
    if (!layer) return;
    const limit = .09;
    const clamp = value => Number.isFinite(value) ? THREE.MathUtils.clamp(value, -limit, limit) : 0;
    // Always derive from the captured animation pose: repeated application is idempotent.
    bone.quaternion.copy(layer.animation);
    bone.updateWorldMatrix(true, false);
    bone.getWorldQuaternion(this.world);
    if (bone.parent) bone.parent.getWorldQuaternion(this.parent); else this.parent.identity();
    this.offset.setFromEuler(new THREE.Euler(clamp(pitch), clamp(yaw), clamp(roll), 'YXZ'));
    this.goal.copy(actorWorld).multiply(this.offset).multiply(actorWorld.clone().invert()).multiply(this.world);
    bone.quaternion.copy(this.parent.invert().multiply(this.goal)).normalize();
  }

  reset() {
    this.restoreAnimationPose();
    this.captureAnimationPose();
  }
}

/** The same nonaccumulating rule applies to blink and eyebrow morphs. */
export class ExpressionLayers {
  constructor(meshes = []) {
    this.layers = meshes.filter(mesh => mesh.morphTargetInfluences && mesh.morphTargetDictionary).map(mesh => ({
      mesh, values: Float32Array.from(mesh.morphTargetInfluences),
      indices: Object.entries(mesh.morphTargetDictionary).filter(([name]) => /^(V_|Eye_Blink|Brow_Raise_Inner|Mouth_Smile)/i.test(name)).map(([,index]) => index),
    }));
  }
  restoreAnimationPose() {
    for (const {mesh, values, indices} of this.layers) for (const index of indices) mesh.morphTargetInfluences[index] = values[index];
  }
  captureAnimationPose() {
    for (const {mesh, values, indices} of this.layers) for (const index of indices) values[index] = mesh.morphTargetInfluences[index];
  }
}
