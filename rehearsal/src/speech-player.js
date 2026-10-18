import {bytesFromBase64} from './session.js';
import {decodePCM16} from './native-audio.js';
import {AudioFace} from './audio-face.js';
import {createPCMCompatibilityNode, prepareAudioModule} from './pcm-fallback.js';
import {ScheduledSpeechQueue} from './scheduled-speech-queue.js';

/** Actual output audio owns the animation clock; network chunks do not own it. */
export class SpeechPlayer {
  constructor(stage, onState, stats) {
    this.stage = stage; this.onState = onState; this.stats = stats;
    this.entries = []; this.version = 0; this.receiving = false;
    this.context = null; this.lastState = 'idle'; this.muted = false;
    this.nativeDelaySeconds = .07; this.streamState = null; this.streamReceiving = false; this.streamEntry = null;
    this.nativeQueuedSampleEnd = 0; this.nativeAudibleSampleEnd = 0;
    this.continuousSignalActive = false; this.continuousQuiet = false;
    this.bufferQueue = new ScheduledSpeechQueue({
      context: () => this.context, tail: () => this.tail || 0, currentVersion: () => this.version,
      onWait: waiting => { this.stats.speechBackpressure = waiting; if (waiting) this.stats.speechBackpressureWaits = (this.stats.speechBackpressureWaits || 0) + 1; },
      schedule: ({buffer, cues, version, offset, duration, caption}) =>
        this.schedule(buffer, cues, version, false, {offset, duration, caption}),
    });
  }

  async activate() {
    if (!this.context) {
      this.context = new AudioContext({latencyHint: 'interactive'});
      this.analyser = this.context.createAnalyser(); this.analyser.fftSize = 512;
      this.samples = new Float32Array(this.analyser.fftSize);
      this.master = this.context.createGain(); this.master.gain.value = this.muted ? 0 : 1;
      this.analyser.connect(this.master); this.master.connect(this.context.destination);
      this.capture = this.context.createMediaStreamDestination(); this.master.connect(this.capture);
      this.nativeBus = this.context.createGain();
      this.makeNativeDelay();
      this.face = new AudioFace(this.context, this.stats);
      this.tick();
    }
    await this.context.resume();
  }

  async prepareNative() {
    await this.activate();
    // Viseme classification enriches the original rig, but its network/model
    // preparation must not hold the PCM stream or a typed question hostage.
    // Keep the shared classifier alive so it can join this audio bus when ready.
    if (!this.facePromise) {
      this.stats.audioFacePhase = 'loading';
      this.facePromise = this.face.prepare().then(node => {
        if (node && !this.faceConnected && this.context.state !== 'closed') {
          this.nativeBus.connect(node); this.faceConnected = true;
        }
        this.stats.audioFacePhase = node ? 'ready' : 'unavailable';
        return node;
      }).catch(() => { this.stats.audioFacePhase = 'unavailable'; return null; });
    }
    if (!this.streamPromise) this.streamPromise = (async () => {
      this.stats.audioWorkletPreparation = 'pending';
      try {
        await prepareAudioModule(this.context, '/audio/pcm-stream.worklet.mjs?watermark=v1');
        this.streamNode = new AudioWorkletNode(this.context, 'einstein-pcm-stream', {numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1]});
        this.stats.audioWorkletPreparation = 'ready'; this.stats.nativePlaybackEngine = 'audio-worklet';
      } catch (failure) {
        this.stats.audioWorkletPreparation = failure.code === 'worklet-deadline' ? 'timed-out' : 'unavailable';
        this.streamNode = await this.compatibilityNode();
        this.stats.nativePlaybackEngine = 'compatibility-buffer';
        this.stats.nativeCompatibilityBufferMs = 1024 / this.context.sampleRate * 1000;
      }
      this.streamNode.connect(this.nativeBus);
      this.streamNode.port.onmessage = event => this.updateStreamState(event.data);
      this.streamNode.port.postMessage({kind: 'reset', epoch: this.version});
      this.stats.continuousAudioStream = true;
    })().catch(error => {
      // A later explicit user retry can prepare the essential worklet again.
      this.streamPromise = null;
      throw error;
    });
    await this.streamPromise;
    this.stats.nativeLipSyncDelayMs = this.nativeDelaySeconds * 1000;
    this.stats.nativeJitterBufferMs = 80;
    this.stats.nativeToneGuardLookaheadMs = 40;
  }

  async compatibilityNode() {
    // The same bounded queue and tone guard execute on the main audio callback
    // only when this browser cannot prepare an AudioWorklet. No microphone.
    const core = await import(/* @vite-ignore */ '/audio/pcm-stream-core.mjs?watermark=v1');
    return createPCMCompatibilityNode(this.context, core);
  }

  updateStreamState(value) {
    if (value.epoch !== this.version) return;
    if (value.kind === 'error') { this.stats.audioError = value.message; this.stop(); return; }
    this.streamState = value;
    this.stats.audioUnderruns = value.underruns;
    this.stats.audioToneFramesSuppressed = value.toneFramesSuppressed;
    this.stats.audioQueueMs = Math.round(value.queuedMs);
    if (this.continuousAudio) {
      const active = value.hasSignal === true && value.quietMs < 450;
      if (active !== this.continuousSignalActive) {
        // The worklet clock precedes the existing audible delay buffer.
        if (active) this.continuousResumeAt = value.time + this.nativeDelaySeconds;
        else this.continuousQuietAt = value.time + this.nativeDelaySeconds;
      }
      this.continuousSignalActive = active;
      this.stats.audioRenderedQuietMs = value.quietMs;
      this.stats.audioRenderedSignalSamples = (this.stats.audioRenderedSignalSamples || 0) + Math.max(0, (value.signalSamples || 0) - (this.lastRenderedSignalSamples || 0));
      this.lastRenderedSignalSamples = value.signalSamples || 0;
    }
    if (this.streamEntry && value.playing) {
      if (!Number.isFinite(this.streamEntry.start)) this.streamEntry.start = value.time + this.nativeDelaySeconds;
      this.streamEntry.end = Infinity; this.streamEntry.ended = false;
    } else if (this.streamEntry && !this.streamReceiving && value.queuedSamples === 0) {
      this.streamEntry.end = Math.min(this.streamEntry.end, value.time + this.nativeDelaySeconds);
      this.streamEntry.ended = true;
    }
  }

  makeNativeDelay() {
    const oldDelay = this.nativeDelay, oldGain = this.nativeExitGain;
    if (oldDelay) {
      try { this.nativeBus.disconnect(oldDelay); } catch {}
      if (oldGain) {
        oldGain.gain.cancelScheduledValues(this.context.currentTime);
        oldGain.gain.setValueAtTime(oldGain.gain.value, this.context.currentTime);
        oldGain.gain.linearRampToValueAtTime(0, this.context.currentTime + .004);
      }
      setTimeout(() => { oldDelay.disconnect(); oldGain?.disconnect(); }, 12);
    }
    this.nativeDelay = this.context.createDelay(.25);
    this.nativeDelay.delayTime.value = this.nativeDelaySeconds;
    this.nativeExitGain = this.context.createGain(); this.nativeExitGain.gain.value = 0;
    this.nativeExitGain.gain.linearRampToValueAtTime(1, this.context.currentTime + .004);
    this.nativeBus.connect(this.nativeDelay); this.nativeDelay.connect(this.nativeExitGain); this.nativeExitGain.connect(this.analyser);
  }

  setMuted(value) {
    this.muted = Boolean(value); this.stats.outputMuted = this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.context.currentTime, .015);
  }

  begin() {
    this.stop(); this.receiving = true;
    this.stats.firstAudioAt = null; this.stats.audioSegments = 0;
    this.stats.peakScheduledQueueMs = 0; this.stats.speechBackpressureWaits = 0;
    return this.version;
  }

  schedule(buffer, cues, version, native = false, slice = {}) {
    if (version !== this.version) return;
    const offset = slice.offset ?? 0, duration = slice.duration ?? buffer.duration;
    if (!Number.isFinite(offset) || !Number.isFinite(duration) || offset < 0 || duration <= 0 ||
        !Number.isFinite(buffer.duration) || offset + duration > buffer.duration + 1e-6) {
      throw new Error('Invalid speech playback range.');
    }
    const delay = native ? this.nativeDelaySeconds : 0;
    const audibleStart = Math.max(this.context.currentTime + .025 + delay, this.tail || 0);
    // Backpressure keeps local slices below this existing scheduling boundary.
    // Validate BEFORE allocating a node, so a rejected direct call cannot leak it.
    if (audibleStart - this.context.currentTime > 20) throw new Error('Audio playback queue exceeds its time budget');
    const source = this.context.createBufferSource(); source.buffer = buffer;
    const entry = {source, start: audibleStart, end: audibleStart + duration, cues, native,
      cueOffset: offset, caption: slice.caption ?? (this.nextCaption || '')};
    try {
      source.connect(native ? this.nativeBus : this.analyser);
      source.onended = () => { source.disconnect(); entry.ended = true; };
      source.start(audibleStart - delay, offset, duration);
    } catch (error) { source.onended = null; source.disconnect(); throw error; }
    this.nextCaption = '';
    this.entries.push(entry); this.tail = entry.end; this.stats.audioSegments++;
    this.stats.audioQueueMs = Math.round(Math.max(0, this.tail - this.context.currentTime) * 1000);
    this.stats.peakScheduledQueueMs = Math.max(this.stats.peakScheduledQueueMs || 0, this.stats.audioQueueMs);
  }

  enqueue(base64, cues = [], expectedVersion = this.version) {
    const caption = this.nextCaption || ''; this.nextCaption = '';
    if (typeof base64 !== 'string') return Promise.reject(new Error('The speech response is not encoded audio.'));
    return this.bufferQueue.enqueue({version: expectedVersion, encodedBytes: base64.length, cues, caption,
      decode: async () => {
        await this.activate();
        if (expectedVersion !== this.version) return null;
        return this.context.decodeAudioData(bytesFromBase64(base64).buffer);
      }});
  }

  async enqueuePCM(bytes, sampleRate, expectedVersion = this.version) {
    if (sampleRate !== 24000) throw new Error('Native provider output must be 24 kHz PCM');
    const samples = decodePCM16(bytes);
    if (!samples.length || samples.length > sampleRate * 8) throw new Error('Native audio packet exceeds its budget');
    await this.prepareNative();
    if (expectedVersion !== this.version) return;
    this.streamReceiving = true;
    if (!this.streamEntry || !this.entries.includes(this.streamEntry)) {
      this.streamEntry = {native: true, stream: true, start: Infinity, end: Infinity, cues: [], ended: false};
      this.entries.push(this.streamEntry);
    }
    this.stats.audioSegments++;
    // Raw input positions also cover the tone guard's lookahead: a closing
    // word is still queued even before the guard releases it to the PCM core.
    const sampleEnd = this.nativeQueuedSampleEnd + samples.length;
    let audibleEnd = this.nativeAudibleSampleEnd;
    for (let i = samples.length - 1; i >= 0; i--) {
      if (Math.abs(samples[i]) > 1 / 32768) { audibleEnd = this.nativeQueuedSampleEnd + i + 1; break; }
    }
    this.streamNode.port.postMessage({kind: 'audio', epoch: this.version, samples: samples.buffer}, [samples.buffer]);
    this.nativeQueuedSampleEnd = sampleEnd; this.nativeAudibleSampleEnd = audibleEnd;
  }

  finish() {
    this.receiving = false; this.streamReceiving = false;
    this.streamNode?.port.postMessage({kind: 'finish', epoch: this.version});
  }

  stop({preserveFocus = false} = {}) {
    this.version++;
    this.bufferQueue?.reset();
    this.stats.speechBackpressure = false;
    for (const entry of this.entries) {
      if (entry.source) { entry.source.onended = null; try { entry.source.stop(); } catch {} entry.source.disconnect(); }
    }
    this.entries = []; this.tail = 0; this.receiving = false; this.streamReceiving = false; this.streamEntry = null; this.streamState = null;
    this.continuousSignalActive = false; this.continuousQuiet = false;
    this.continuousResumeAt = null; this.continuousQuietAt = null;
    this.lastRenderedSignalSamples = 0;
    this.nativeQueuedSampleEnd = 0; this.nativeAudibleSampleEnd = 0;
    this.streamNode?.port.postMessage({kind: 'reset', epoch: this.version});
    this.stats.audioPlaying = false; this.stats.audioQueueMs = 0;
    this.face?.reset();
    // Discard the delay buffer too: stopping a source alone leaves its delayed tail audible.
    if (this.context) this.makeNativeDelay();
    if (this.stage?.presentationTarget && !preserveFocus) {
      this.stage.presentationSpeechHeld = false; this.stage.presentationAwaitingSpeech = false;
      this.stage.presentationFocusUntil = performance.now() + 350;
    }
    this.stage?.speechFrame(0, 0, [], false, null);
    if (this.lastState !== 'idle') { this.lastState = 'idle'; this.onState('idle'); }
  }

  tick() {
    if (!this.context) return;
    if (this.externalAudioActive) {
      // Remote audio/video owns the speaker state in Anam mode; never overwrite it
      // with this dormant local clock. The spatial board still renders normally.
      requestAnimationFrame(() => this.tick()); return;
    }
    const now = this.context.currentTime;
    if (!this.streamEntry) this.stats.audioQueueMs = Math.round(Math.max(0, (this.tail || 0) - now) * 1000);
    this.entries = this.entries.filter(item => !(item.ended && item.end <= now));
    this.continuousQuiet = Boolean(this.continuousAudio && this.streamEntry &&
      (this.continuousSignalActive ? now < this.continuousResumeAt : now >= (this.continuousQuietAt ?? 0)));
    const entry = this.continuousQuiet ? null : this.entries.find(item => item.start <= now && item.end > now);
    if (this.stage?.presentationTarget && entry && (this.stage.presentationAwaitingSpeech || this.stage.presentationSpeechHeld)) {
      this.stage.presentationAwaitingSpeech = false;
      this.stage.presentationSpeechHeld = true;
      this.stage.presentationFocusUntil = performance.now() + 600;
    } else if (!entry && this.stage?.presentationSpeechHeld && (this.continuousQuiet || (!this.receiving && this.entries.length === 0))) {
      this.stage.presentationSpeechHeld = false;
      this.stage.presentationFocusUntil = performance.now() + 600;
    }
    this.stats.audioPlaying = Boolean(entry);
    const weights = this.face?.update();
    if (entry) {
      if (this.stats.firstAudioAt == null) this.stats.firstAudioAt = performance.now();
      this.analyser.getFloatTimeDomainData(this.samples);
      const amplitude = Math.sqrt(this.samples.reduce((sum, value) => sum + value * value, 0) / this.samples.length);
      this.stage?.speechFrame(amplitude, now - entry.start + (entry.cueOffset || 0), entry.cues, true,
        entry.native && this.stats.audioFaceReady ? weights : null);
      if (entry.caption && this.lastCaption !== entry.caption) {
        this.lastCaption = entry.caption; this.onCaption?.(entry.caption);
      }
    } else this.stage?.speechFrame(0, 0, [], false, null);
    const state = this.continuousQuiet ? 'idle' : entry ? 'playing' : this.receiving || this.entries.length ? 'buffering' : 'idle';
    if (state !== this.lastState) { this.lastState = state; this.onState(state); }
    requestAnimationFrame(() => this.tick());
  }
}
