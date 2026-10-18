import {PCMStreamCore, PureToneGuard} from './pcm-stream-core.mjs?watermark=v1';
class EinsteinPCMStream extends AudioWorkletProcessor {
  constructor() {
    super(); this.core = new PCMStreamCore(sampleRate); this.guard = new PureToneGuard();
    this.epoch = 0; this.report = 0;
    this.port.onmessage = event => {
      const message = event.data;
      if (message.kind === 'reset') {
        this.epoch = message.epoch; this.core.reset(); this.guard.reset();
      } else if (message.epoch === this.epoch) {
        try {
          if (message.kind === 'audio') {
            const samples = this.guard.push(new Float32Array(message.samples));
            if (samples.length) this.core.push(samples);
          } else if (message.kind === 'finish') {
            const samples = this.guard.push(new Float32Array(0), true);
            if (samples.length) this.core.push(samples);
            this.core.finish();
          }
        } catch {
          this.core.reset(); this.guard.reset();
          this.port.postMessage({kind: 'error', epoch: this.epoch, message: 'The audio queue was stopped at its safety limit.'});
        }
      }
    };
  }
  process(inputs, outputs) {
    const channel = outputs[0]?.[0]; if (!channel) return true;
    const status = this.core.render(channel);
    if (++this.report >= 8) {
      this.report = 0;
      this.port.postMessage({kind: 'status', epoch: this.epoch, time: currentTime, ...status,
        toneFramesSuppressed: this.guard.suppressedFrames});
    }
    return true;
  }
}
registerProcessor('einstein-pcm-stream', EinsteinPCMStream);
