/** Preserve viseme zero and align categorical articulation with the audio clock.
 * Input labels are acoustic estimates, not ground-truth phonemes.
 */
export const VISEME_NAMES = ['viseme_aa', 'viseme_E', 'viseme_I', 'viseme_O', 'viseme_U',
  'viseme_PP', 'viseme_SS', 'viseme_TH', 'viseme_DD', 'viseme_FF', 'viseme_kk',
  'viseme_nn', 'viseme_RR', 'viseme_CH', 'viseme_sil'];

export function validViseme(value) {
  return Number.isInteger(value) && value >= 0 && value < VISEME_NAMES.length;
}

export function applyClassifierEvent(node, event) {
  if (!validViseme(event?.viseme)) return false;
  // The upstream handler uses `if (viseme)`, which drops the open /aa/ class 0.
  // Correct the integration without modifying the licensed vendor distribution.
  node.visemeActive = event.viseme === 14 ? -1 : event.viseme;
  return true;
}

export class ArticulationTimeline {
  constructor({leadSeconds = .07, attackSeconds = .035, releaseSeconds = .055} = {}) {
    this.leadSeconds = leadSeconds;
    this.attackSeconds = attackSeconds;
    this.releaseSeconds = releaseSeconds;
    this.reset();
  }
  reset() {
    this.events = [];
    this.current = new Float64Array(15);
    this.lastTime = null;
    this.active = 14;
    this.lastEventAt = -Infinity;
  }
  push(viseme, audioTime) {
    if (!validViseme(viseme) || !Number.isFinite(audioTime)) return false;
    this.events.push({viseme, time: audioTime + this.leadSeconds});
    if (this.events.length > 64) this.events.splice(0, this.events.length - 64);
    return true;
  }
  sample(audioTime) {
    if (!Number.isFinite(audioTime)) return {};
    const dt = Math.min(.1, Math.max(0, this.lastTime == null ? 1 / 60 : audioTime - this.lastTime));
    this.lastTime = audioTime;
    while (this.events.length && this.events[0].time <= audioTime) {
      const event = this.events.shift();
      this.active = event.viseme;
      this.lastEventAt = event.time;
    }
    // Missing/stopped classifier input must not hold a mouth open indefinitely.
    if (audioTime - this.lastEventAt > .18) this.active = 14;
    const result = {};
    for (let i = 0; i < 15; i++) {
      const target = i === this.active ? 1 : 0;
      const tau = target ? this.attackSeconds : this.releaseSeconds;
      this.current[i] += (target - this.current[i]) * (1 - Math.exp(-dt / tau));
      result[VISEME_NAMES[i]] = this.current[i];
    }
    return result;
  }
}
