/** A source mark is faint until its exact step has rendered speech or complete visible commentary.
 * This clock animates the overlay only; it never changes the source canvas or
 * claims that the provider has finished speaking.
 */
export class SourceInk {
  constructor({paint, publish, now = () => performance.now(),
    frame = callback => requestAnimationFrame(callback), cancelFrame = id => cancelAnimationFrame(id),
    reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true}) {
    Object.assign(this, {paint, publish, now, frame, cancelFrame, reducedMotion});
    this.steps = []; this.pending = null; this.frameId = null;
  }

  begin(teaching, viewRegion, valid = () => true) {
    this.cancel();
    if (this.steps[0]?.sequenceId !== teaching.sequence_id) this.steps = [];
    const step = {sequenceId: teaching.sequence_id, index: teaching.index, count: teaching.count,
      sourceId: teaching.source_id, regionId: teaching.region_id, imageSha256: teaching.image_sha256,
      viewRegion: [...viewRegion], renderedAt: null, inkStartedAt: null, inkCompletedAt: null,
      phase: 'ghost', progress: 0};
    this.steps[teaching.index] = step;
    this.pending = {step, valid}; this.report();
  }

  rendered() {
    if (this.pending?.valid()) { this.pending.step.renderedAt = this.now(); this.report(); }
  }

  onset(identity, audibleAt = this.now(), onsetKind = 'rendered-speech') {
    const pending = this.pending;
    if (!pending || !pending.valid() || pending.step.phase !== 'ghost' || pending.step.renderedAt == null ||
      pending.step.sequenceId !== identity.sequence_id || pending.step.index !== identity.index) return false;
    const tick = () => {
      this.frameId = null;
      if (this.pending !== pending || !pending.valid()) { this.cancel(); return; }
      const now = this.now(), step = pending.step;
      if (now >= audibleAt) {
        step.inkStartedAt ??= now; step.phase = 'inking';
        step.progress = this.reducedMotion() ? 1 : Math.min(1, (now - step.inkStartedAt) / 700);
        if (step.progress >= 1) { step.phase = 'inked'; step.inkCompletedAt = now; }
        this.report(); this.paint();
      }
      if (pending.step.progress < 1) this.frameId = this.frame(tick);
    };
    // Latch before the first frame, so repeated telemetry cannot restart it.
    pending.step.onsetKind = onsetKind;
    pending.step.phase = 'onset-scheduled';
    tick(); return true;
  }

  cancel() {
    if (this.frameId != null) this.cancelFrame(this.frameId);
    this.frameId = null;
    if (this.pending && this.pending.step.phase !== 'inked') this.pending.step.phase = 'paused';
    this.pending = null; this.report();
  }

  clear() { this.cancel(); this.steps = []; this.report(); }
  report() { this.publish(this.steps.filter(Boolean).map(step => ({...step, viewRegion: [...step.viewRegion]}))); }
}
