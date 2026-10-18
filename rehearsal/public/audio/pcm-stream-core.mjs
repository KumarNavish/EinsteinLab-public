/** Sample-continuous, bounded PCM playback; no notification/oscillator sounds.
 * Network packets never restart an oscillator or schedule individual sources.
 * Fade only at starts, stops and underruns, not at normal packet boundaries.
 */
export class PCMStreamCore {
  constructor(outputRate, inputRate = 24000, prebufferMs = 80) {
    if (![16000, 24000, 48000].includes(inputRate) || !Number.isFinite(outputRate) || outputRate < 8000) throw new Error('Unsupported PCM rate');
    this.inputRate = inputRate; this.outputRate = outputRate;
    this.ratio = inputRate / outputRate;
    this.capacity = inputRate * 20;
    this.buffer = new Float32Array(this.capacity);
    this.threshold = Math.round(inputRate * prebufferMs / 1000);
    this.rampSamples = Math.max(1, Math.round(outputRate * .004));
    this.underruns = 0; this.overflows = 0; this.samplesPlayed = 0; this.last = 0;
    this.reset();
  }
  reset() {
    this.readIndex = 0; this.writeIndex = 0; this.count = 0; this.fraction = 0;
    this.playing = false; this.ended = false; this.gain = 0;
    this.quietSamples = 0; this.signalSamples = 0;
    this.inputSamplesConsumed = 0;
    this.fadeFrom = this.last || 0; this.fadeRemaining = this.rampSamples;
  }
  push(samples) {
    if (samples.length > this.capacity - this.count) { this.overflows++; throw new Error('Audio queue exceeds twenty seconds'); }
    this.ended = false;
    for (const sample of samples) {
      this.buffer[this.writeIndex] = Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0;
      this.writeIndex = (this.writeIndex + 1) % this.capacity; this.count++;
    }
  }
  finish() { this.ended = true; }
  render(output) {
    for (let i = 0; i < output.length; i++) {
      if (!this.playing && (this.count >= this.threshold || (this.ended && this.count > 0))) {
        this.playing = true; this.gain = 0; this.fadeRemaining = 0;
      }
      if (this.playing && this.count >= (this.ended ? 1 : 2)) {
        const first = this.buffer[this.readIndex];
        const next = this.count > 1 ? this.buffer[(this.readIndex + 1) % this.capacity] : first;
        const value = first + (next - first) * this.fraction;
        this.gain = Math.min(1, this.gain + 1 / this.rampSamples);
        this.last = value * this.gain;
        output[i] = this.last;
        this.fraction += this.ratio;
        const consume = Math.min(this.count, Math.floor(this.fraction));
        this.readIndex = (this.readIndex + consume) % this.capacity;
        this.count -= consume; this.fraction -= consume; this.inputSamplesConsumed += consume; this.samplesPlayed++;
      } else {
        if (this.playing) {
          this.playing = false; this.gain = 0;
          this.fadeFrom = this.last; this.fadeRemaining = this.rampSamples;
          if (!this.ended) this.underruns++;
        }
        if (this.fadeRemaining > 0) {
          this.last = this.fadeFrom * (--this.fadeRemaining / this.rampSamples);
        } else this.last = 0;
        output[i] = this.last;
      }
      // Telemetry only: preserve every rendered sample and its timing. One
      // PCM16 step is near digital silence, not a speech/VAD classification.
      if (Math.abs(output[i]) > 1 / 32768) { this.quietSamples = 0; this.signalSamples++; }
      else this.quietSamples++;
    }
    return {playing: this.playing || this.fadeRemaining > 0, queuedSamples: this.count,
      queuedMs: this.count / this.inputRate * 1000, underruns: this.underruns,
      overflows: this.overflows, samplesPlayed: this.samplesPlayed,
      inputSamplesConsumed: this.inputSamplesConsumed,
      quietMs: this.quietSamples / this.outputRate * 1000, signalSamples: this.signalSamples, hasSignal: this.signalSamples > 0};
  }
}

/** Narrowband safeguard, not a general speech/noise classifier.
 * Only a near-perfect stable sine above 650 Hz for at least 60 ms is muted.
 * Natural harmonic speech, breath and brief consonants remain unmodified.
 * The provider tone is never used as a source of semantic information.
 */
export class PureToneGuard {
  constructor(rate = 24000) {
    this.rate = rate; this.frameSize = Math.round(rate * .02);
    this.frame = new Float32Array(this.frameSize); this.position = 0;
    this.pending = []; this.suppressedFrames = 0; this.streak = 0; this.lastFrequency = 0;
  }
  classify(frame) {
    let energy = 0, cross = 0;
    for (let i = 1; i < frame.length - 1; i++) { energy += frame[i] ** 2; cross += frame[i] * (frame[i-1] + frame[i+1]); }
    if (energy / frame.length < .0009) return 0;
    const cosine = Math.max(-1, Math.min(1, cross / (2 * energy)));
    const frequency = Math.acos(cosine) * this.rate / (2 * Math.PI);
    if (frequency < 650 || frequency > 6000) return 0;
    let residual = 0;
    for (let i = 1; i < frame.length - 1; i++) residual += (frame[i-1] + frame[i+1] - 2 * cosine * frame[i]) ** 2;
    return residual / energy < 0.000002 ? frequency : 0;
  }
  push(samples, final = false) {
    const ready = [];
    const accept = frame => {
      const frequency = this.classify(frame);
      this.streak = frequency && Math.abs(frequency - this.lastFrequency) < 15 ? this.streak + 1 : frequency ? 1 : 0;
      this.lastFrequency = frequency;
      this.pending.push({frame, frequency, muted: false});
      if (this.streak >= 3) {
        for (const item of this.pending) {
          if (item.frequency && !item.muted) { item.frame.fill(0); item.muted = true; this.suppressedFrames++; }
        }
      }
      if (this.pending.length > 2) ready.push(this.pending.shift().frame);
    };
    for (const sample of samples) {
      this.frame[this.position++] = sample;
      if (this.position === this.frameSize) { accept(this.frame); this.frame = new Float32Array(this.frameSize); this.position = 0; }
    }
    if (final) {
      if (this.position) accept(this.frame.slice(0, this.position));
      while (this.pending.length) ready.push(this.pending.shift().frame);
      this.position = 0; this.frame = new Float32Array(this.frameSize); this.streak = 0;
    }
    const result = new Float32Array(ready.reduce((sum, frame) => sum + frame.length, 0));
    let index = 0; for (const frame of ready) { result.set(frame, index); index += frame.length; }
    return result;
  }
  reset() { this.pending = []; this.position = 0; this.streak = 0; this.lastFrequency = 0; }
}
