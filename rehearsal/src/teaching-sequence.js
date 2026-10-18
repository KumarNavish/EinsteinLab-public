const words = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
const filler = new Set('a an the and or but to of in on at for from with by as is are was were be been being it its this that these those i you we they our your their here there now then can could will would should do does did has have had not just'.split(' '));
const inflection = word => {
  // Match simple connects/connected/connecting changes, keeping at least four
  // stem letters. Do not infer synonyms or rewrite spelling (e.g. silent e).
  if (word.length > 6 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 5 && word.endsWith('ed')) return word.slice(0, -2);
  return word.length > 4 ? word.replace(/s$/, '') : word;
};
const anchors = value => new Set(words(value).filter(word => word.length > 2 && !filler.has(word)).map(inflection));

function matchesStep(transcript, step) {
  const spoken = words(transcript), planned = words(step.narration);
  const ending = transcript.trim().replace(/[)\]"'”’]+$/u, '').trimEnd();
  const minimum = Math.min(planned.length, Math.max(6, Math.ceil(planned.length * .6)));
  if (spoken.length < Math.max(3, minimum) ||
    !/[.!?。！？]$/u.test(ending) || /(?:\.{2,}|…)$/u.test(ending)) return false;
  const heard = anchors(transcript), focus = anchors(step.focus_label), expected = anchors(step.narration);
  const overlap = [...heard].filter(word => expected.has(word) || focus.has(word));
  // Commentary may paraphrase. Require a sentence-length focused passage,
  // not a fraction of the planner's exact vocabulary. Rendered quiet and the
  // fresh playback epoch remain separate requirements; this is no truth test.
  return heard.size >= 2 && overlap.length >= 2 &&
    [...expected].some(word => !focus.has(word) && heard.has(word)) &&
    (!focus.size || [...focus].some(word => heard.has(word)));
}

/** A local listening boundary, never a provider turn-complete assertion.
 * Only fresh transcript and rendered output for this playback epoch may
 * advance a teaching step. Missing/ambiguous speech leaves it paused.
 */
export class TeachingSequence {
  constructor({stats, player, send, onSpeech = () => {}, isUserSpeaking = () => false,
    now = () => performance.now(),
    setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimer = timer => globalThis.clearTimeout(timer)}) {
    this.stats = stats; this.player = player; this.send = send; this.onSpeech = onSpeech;
    this.isUserSpeaking = isUserSpeaking; this.now = now;
    this.setTimer = setTimer; this.clearTimer = clearTimer;
    this.retired = new Set(); this.step = null; this.timer = null; this.history = [];
  }

  get current() { return this.step?.identity || null; }
  get active() { return Boolean(this.step && !this.step.acknowledged); }
  get paused() { return this.step?.paused === true; }

  start(value, resetPlayback = () => {}, {manualOnly = false} = {}) {
    if (!value || typeof value.sequence_id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value.sequence_id) ||
      !Number.isInteger(value.count) || value.count < 2 || value.count > 6 ||
      !Number.isInteger(value.index) || value.index < 0 || value.index >= value.count ||
      typeof value.focus_label !== 'string' || !value.focus_label.trim() || value.focus_label.length > 90 ||
      typeof value.narration !== 'string' || !value.narration.trim() || value.narration.length > 900 ||
      this.retired.has(value.sequence_id)) return false;
    const previous = this.step;
    if (previous?.identity.sequence_id === value.sequence_id) {
      if (!previous.acknowledged || value.count !== previous.identity.count || value.index !== previous.identity.index + 1) return false;
    } else {
      if (value.index !== 0 || (previous && (!previous.acknowledged || previous.identity.index !== previous.identity.count - 1))) return false;
      if (this.retired.size >= 64) return false;
      if (previous) this.retired.add(previous.identity.sequence_id);
      this.history = [];
    }
    this.clearPending();
    resetPlayback();
    const identity = Object.freeze({sequence_id: value.sequence_id, index: value.index,
      count: value.count, focus_label: value.focus_label, narration: value.narration});
    this.step = {identity, epoch: this.player.version, baseline: this.stats.audioRenderedSignalSamples || 0,
      manualOnly, transcript: '', sawLiveSignal: false, idle: false, acknowledged: false, paused: false, began: this.now()};
    this.publish(this.step, manualOnly ? 'waiting-reader' : 'waiting-speech');
    return true;
  }

  transcript(delta, identity = {}) {
    const step = this.step;
    if (!step || step.acknowledged || typeof delta !== 'string' || this.player.version !== step.epoch ||
      (identity.sequence_id != null && identity.sequence_id !== step.identity.sequence_id) ||
      (identity.index != null && identity.index !== step.identity.index)) return false;
    step.transcript = (step.transcript + delta).slice(0, 6000);
    this.update();
    return true;
  }

  update({idle} = {}) {
    const step = this.step;
    if (!step || step.acknowledged || step.paused || step.manualOnly) return false;
    if (this.player.version !== step.epoch || this.player.muted === true || this.now() - step.began > 60000) {
      step.paused = true; this.clearPending(); this.publish(step, 'paused'); return false;
    }
    const wasIdle = step.idle;
    if (typeof idle === 'boolean') step.idle = idle;
    else if (this.player.lastState === 'playing' || this.player.lastState === 'buffering') step.idle = false;
    if (step.idle && !wasIdle) step.idleAt = this.now();
    if (!step.idle) step.idleAt = null;
    const fresh = (this.stats.audioRenderedSignalSamples || 0) > step.baseline;
    const quiet = this.stats.audioRenderedQuietMs;
    // Seeing old quiet plus a counter alone cannot establish this epoch's
    // spoken passage. Observe the fresh signal while it is actually playing.
    if (fresh && Number.isFinite(quiet) && quiet >= 0 && quiet < 450) {
      if (!step.sawLiveSignal && !this.isUserSpeaking()) {
        step.sawLiveSignal = true; step.signalAt = this.now();
        const delay = Math.max(0, this.player.nativeDelaySeconds || 0) * 1000;
        this.onSpeech(step.identity, step.signalAt + delay);
      }
    }
    this.publish(step, step.idle ? 'waiting-quiet' : step.sawLiveSignal ? 'speaking' : 'waiting-speech');
    if (!fresh || !step.sawLiveSignal || !step.idle || this.isUserSpeaking() ||
      !matchesStep(step.transcript, step.identity) || !Number.isFinite(quiet)) {
      this.clearPending(); return false;
    }
    const delay = Number.isFinite(this.player.nativeDelaySeconds) ? Math.max(0, this.player.nativeDelaySeconds * 1000) : 0;
    const remaining = 900 + delay - quiet;
    if (remaining > 0) {
      if (this.timer == null) this.timer = this.setTimer(() => {
        this.timer = null;
        if (this.step === step) this.update();
      }, Math.max(50, remaining));
      return false;
    }
    return this.boundary(true);
  }

  continueManually() { return this.boundary(false); }

  boundary(heard) {
    const step = this.step;
    if (!step || step.acknowledged) return false;
    step.acknowledged = true; step.heard = heard; step.boundaryAt = this.now(); this.clearPending();
    this.publish(step, heard ? 'acknowledged' : 'manual');
    try {
      this.send({type: 'teaching_boundary', sequence_id: step.identity.sequence_id,
        index: step.identity.index, heard, ...(heard ? {} : {manual: true})});
      return true;
    } catch { step.paused = true; this.publish(step, 'send-failed'); return false; }
  }

  publish(step, phase) {
    const snapshot = Object.freeze({sequenceId: step.identity.sequence_id, index: step.identity.index,
      count: step.identity.count, focusLabel: step.identity.focus_label, narration: step.identity.narration,
      playerVersion: step.epoch, baselineSignalSamples: step.baseline,
      renderedSignalSamples: this.stats.audioRenderedSignalSamples || 0,
      transcript: step.transcript, signalObserved: step.sawLiveSignal, idle: step.idle,
      paused: step.paused, phase, startedAt: step.began, signalObservedAt: step.signalAt ?? null,
      idleObservedAt: step.idleAt ?? null, boundaryAt: step.boundaryAt ?? null,
      heard: step.heard ?? null, manualOnly: step.manualOnly, manual: step.heard === false, cancelled: phase === 'cancelled',
      cancelledAt: phase === 'cancelled' ? this.now() : null});
    this.history[step.identity.index] = snapshot;
    this.stats.teaching = {...snapshot, active: this.active, steps: this.history.slice()};
  }

  clearPending() {
    if (this.timer != null) this.clearTimer(this.timer);
    this.timer = null;
  }

  finish(value) {
    const step = this.step;
    if (!step || value.sequence_id !== step.identity.sequence_id || value.status !== 'presented-progressively' ||
        !step.acknowledged || step.identity.index !== step.identity.count - 1) return false;
    step.completed = true; this.clearPending(); this.publish(step, 'completed');
    return true;
  }

  cancel(sequenceId = null) {
    const step = this.step;
    if (!step && !sequenceId) return false;
    this.clearPending(); this.step = null;
    if (step) { this.retired.add(step.identity.sequence_id); this.publish(step, step.completed ? 'completed' : 'cancelled'); }
    if (sequenceId) this.retired.add(sequenceId);
    try { this.send({type: 'teaching_cancel', sequence_id: sequenceId || step.identity.sequence_id}); } catch {}
    return true;
  }
}
