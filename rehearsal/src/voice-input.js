/** Energy-based local turn detection. Browser echo cancellation is requested, not presumed effective. */
export class SpeechSegmenter {
  constructor(sampleRate, onStart, onEnd, outputActive = () => false) {
    this.rate = sampleRate;
    this.onStart = onStart;
    this.onEnd = onEnd;
    this.outputActive = outputActive;
    this.noise = .001;
    this.reset();
  }

  reset() {
    this.active = false;
    this.preRoll = [];
    this.frames = [];
    this.onset = 0;
    this.silence = 0;
    this.duration = 0;
  }

  push(frame) {
    const dt = frame.length / this.rate;
    const rms = Math.sqrt(frame.reduce((sum, value) => sum + value * value, 0) / frame.length);
    const threshold = Math.max(this.outputActive() ? .024 : .012, this.noise * 3.5);
    const voiced = rms > threshold;
    if (!this.active) {
      if (!voiced && rms < .012) this.noise = .97 * this.noise + .03 * rms;
      this.preRoll.push(frame.slice());
      while (this.preRoll.reduce((n, part) => n + part.length, 0) > this.rate * .42) this.preRoll.shift();
      this.onset = voiced ? this.onset + dt : Math.max(0, this.onset - dt);
      if (this.onset >= .16) {
        this.active = true;
        this.frames = this.preRoll.splice(0);
        this.duration = this.frames.reduce((n, part) => n + part.length, 0) / this.rate;
        this.onStart();
      }
      return;
    }
    this.frames.push(frame.slice());
    this.duration += dt;
    this.silence = voiced ? 0 : this.silence + dt;
    if (this.silence >= .85 || this.duration >= 19) {
      const frames = this.frames;
      this.reset();
      const total = frames.reduce((n, part) => n + part.length, 0);
      const audio = new Float32Array(total);
      let offset = 0;
      for (const part of frames) { audio.set(part, offset); offset += part.length; }
      this.onEnd(audio, this.rate);
    }
  }
}

export function encodeWav(samples, sampleRate) {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const text = (offset, value) => [...value].forEach((letter, i) => view.setUint8(offset + i, letter.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((value, i) => view.setInt16(44 + 2 * i, Math.round(Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0)) * 32767), true));
  return new Blob([bytes], {type: 'audio/wav'});
}

export class HandsFreeInput {
  constructor({onStart, onEnd, outputActive, onState}) {
    this.onStart = onStart;
    this.onEnd = onEnd;
    this.outputActive = outputActive;
    this.onState = onState;
    this.active = false;
    this.serial = 0;
  }

  async start() {
    const serial = ++this.serial;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access needs localhost or HTTPS. Typed questions remain available.');
    const stream = await navigator.mediaDevices.getUserMedia({audio: {
      channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
    }});
    if (serial !== this.serial) { stream.getTracks().forEach(track => track.stop()); return; }
    this.stream = stream;
    this.context = new AudioContext({latencyHint: 'interactive'});
    try {
      await this.context.audioWorklet.addModule('/audio-input.worklet.js');
      this.source = this.context.createMediaStreamSource(stream);
      this.processor = new AudioWorkletNode(this.context, 'einstein-microphone');
      this.mute = this.context.createGain(); this.mute.gain.value = 0;
      this.source.connect(this.processor); this.processor.connect(this.mute); this.mute.connect(this.context.destination);
      this.segmenter = new SpeechSegmenter(this.context.sampleRate,
        () => { if (serial === this.serial) this.onStart(); },
        (samples, rate) => { if (serial === this.serial) this.onEnd(encodeWav(samples, rate)); },
        this.outputActive);
      this.processor.port.onmessage = event => {
        if (this.active && serial === this.serial) this.segmenter.push(new Float32Array(event.data));
      };
      await this.context.resume();
      this.active = true;
      this.onState(true);
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop() {
    this.serial++;
    this.active = false;
    this.processor?.disconnect();
    this.source?.disconnect();
    this.mute?.disconnect();
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    if (this.context && this.context.state !== 'closed') await this.context.close();
    this.context = null;
    this.onState(false);
  }
}
