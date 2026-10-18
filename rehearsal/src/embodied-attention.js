import * as THREE from 'three';

const clamp = THREE.MathUtils.clamp;

export function setPresentationFocus(stage, target, owner) {
  if (!target?.isVector3 || !target.toArray().every(Number.isFinite)) return false;
  stage.presentationTarget = target.clone(); stage.presentationFocusOwner = owner;
  stage.presentationFocusRevision = (stage.presentationFocusRevision || 0) + 1;
  stage.presentationFocusUntil = performance.now() + 12000;
  stage.presentationAwaitingSpeech = true; stage.presentationSpeechHeld = false;
  return true;
}

export function clearPresentationFocus(stage, owner) {
  if (owner && stage.presentationFocusOwner !== owner) return false;
  stage.presentationTarget = null; stage.presentationFocusOwner = null;
  stage.presentationFocusUntil = 0;
  stage.presentationAwaitingSpeech = false; stage.presentationSpeechHeld = false;
  return true;
}

/** Approximate screen-relative orientation, with hands in their authored rest. */
export class EmbodiedAttention {
  constructor(stage, now = () => performance.now()) {
    this.stage = stage; this.weight = 0; this.now = now;
    this.revision = null; this.goal = null;
    this.headOffset = {pitch: 0, yaw: 0}; this.torsoOffset = {pitch: 0, yaw: 0};
  }
  initialize() {
    this.head = this.stage.head || this.stage.model?.getObjectByName('CC_Base_Head');
  }
  orientation(target) {
    const camera = this.stage.camera;
    if (!this.head || !camera?.isCamera) return null;
    camera.updateWorldMatrix(true, false);
    const head = this.head.getWorldPosition(new THREE.Vector3()).applyMatrix4(camera.matrixWorldInverse);
    const mark = target.clone().applyMatrix4(camera.matrixWorldInverse);
    if (head.z >= -.01 || mark.z >= -.01) return null;
    head.applyMatrix4(camera.projectionMatrix); mark.applyMatrix4(camera.projectionMatrix);
    if (![...head.toArray(), ...mark.toArray()].every(Number.isFinite)) return null;
    // A small indication of the mark's screen position, not an anatomical look-at.
    // Head plus torso stays comfortably below 15 degrees, including idle offsets.
    return {pitch: clamp(-(mark.y - head.y) * .05, -.045, .045),
      yaw: clamp((mark.x - head.x) * .12, -.075, .075)};
  }
  update(dt, {reducedMotion = false} = {}) {
    const stage = this.stage;
    const target = stage.presentationTarget;
    const now = this.now();
    const current = target && now < (stage.presentationFocusUntil || 0);
    // Remove the waiting flags too; a later unrelated answer must not revive an
    // expired focus through SpeechPlayer's speech-held extension.
    if (target && !current) clearPresentationFocus(stage);
    const focused = Boolean(target?.isVector3 && target.toArray().every(Number.isFinite) && current);
    if (focused && this.revision !== stage.presentationFocusRevision) {
      this.revision = stage.presentationFocusRevision;
      // Sample from the restored authored pose once per explicit focus beat.
      // Breathing, speech volume and deadline renewal cannot move this goal.
      this.goal = reducedMotion ? null : this.orientation(target);
    }
    // Suppress this revision permanently when reduced motion is requested.
    // Ending that preference must not launch an old focus's movement.
    if (!focused || reducedMotion) this.goal = null;
    const elapsed = Number.isFinite(dt) ? clamp(dt, 0, 1) : 0;
    const smooth = 1 - Math.exp(-elapsed * 5);
    this.weight = reducedMotion ? 0 : THREE.MathUtils.lerp(this.weight, this.goal ? 1 : 0, smooth);
    for (const axis of ['pitch', 'yaw']) {
      this.headOffset[axis] = reducedMotion ? 0 : THREE.MathUtils.lerp(this.headOffset[axis], this.goal?.[axis] || 0, smooth);
      this.torsoOffset[axis] = this.headOffset[axis] * (axis === 'yaw' ? .35 : .2);
    }
    stage.attentionMetrics = {headOrientationEnabled: true, eyeTargetingEnabled: false, weight: this.weight,
      active: Math.abs(this.headOffset.pitch) + Math.abs(this.headOffset.yaw) > .002,
      focusActive: focused, focusRevision: this.revision, reducedMotion, pointing: null,
      headOffset: {...this.headOffset}, torsoOffset: {...this.torsoOffset}};
  }
}
