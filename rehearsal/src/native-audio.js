import {bytesFromBase64} from './session.js';
import {RenewableSocket} from './renewable-socket.js';
import {TeachingSequence} from './teaching-sequence.js';
import {prepareAudioModule, createMicrophoneCompatibilityNode} from './pcm-fallback.js';

const TEXT_CONTROL_EVENTS = new Set(['connected','input_accepted','interrupted','teaching_cancelled',
  'error','notice','document_registered','document_revoked','document_view_registered','video_registered','video_revoked']);

export function socketCloseReceipt(event, elapsedMs) {
  return {code: Number.isInteger(event?.code) && event.code >= 1000 && event.code <= 4999 ? event.code : null,
    wasClean: typeof event?.wasClean === 'boolean' ? event.wasClean : null,
    elapsedMs: Number.isFinite(elapsedMs) && elapsedMs >= 0 ? Math.round(elapsedMs) : null};
}

/** Ignore brief focus transitions, but stop real background capture promptly. */
export function stopWhenHidden(page, stop, isImmersive = () => false) {
  let pending;
  const changed = () => {
    clearTimeout(pending);
    if (!page.hidden || isImmersive()) return;
    pending = setTimeout(() => { if (page.hidden && !isImmersive()) stop(); }, 250);
  };
  page.addEventListener('visibilitychange', changed);
  return () => { clearTimeout(pending); page.removeEventListener('visibilitychange', changed); };
}

/** Stateful box-filter resampling for the explicit external microphone path. */
export class PCM16Resampler {
  constructor(inputRate, outputRate = 16000) {
    if (!Number.isFinite(inputRate) || inputRate < outputRate || outputRate < 8000) throw new Error('Unsupported microphone rate');
    this.ratio = inputRate / outputRate;
    this.weight = 0; this.sum = 0;
  }
  push(samples) {
    const output = [];
    for (const raw of samples) {
      const value = Number.isFinite(raw) ? Math.max(-1, Math.min(1, raw)) : 0;
      let remaining = 1;
      while (remaining > 1e-8) {
        const portion = Math.min(remaining, this.ratio - this.weight);
        this.sum += portion * value; this.weight += portion; remaining -= portion;
        if (this.weight >= this.ratio - 1e-8) {
          output.push(Math.round(Math.max(-1, Math.min(1, this.sum / this.ratio)) * 32767));
          this.weight = 0; this.sum = 0;
        }
      }
    }
    const buffer = new ArrayBuffer(output.length * 2);
    const view = new DataView(buffer);
    output.forEach((sample, index) => view.setInt16(index * 2, sample, true));
    return buffer;
  }
}

export function decodePCM16(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength % 2) throw new Error('Invalid PCM audio');
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Float32Array(bytes.byteLength / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = data.getInt16(i * 2, true) / 32768;
  return samples;
}

/** No provider key is present here. A short-lived permit opens the relay. */
export class NativeConversation {
  constructor({player, onEvent, onState, onError, stats}) {
    this.player = player; this.onEvent = onEvent; this.onState = onState;
    this.onError = onError; this.stats = stats;
    this.active = false; this.connecting = false; this.serial = 0;
    this.generation = 0; this.suppressAudio = false; this.speechOnset = 0; this.speaking = false;
    this.lastSpeechAt = null; this.firstAudioPending = true; this.pendingQueue = Promise.resolve();
    this.continuousAudio = false; this.outputPending = false; this.drainReady = false;
    this.sharedDocument = null; this.documentViewRevision = 0;
    this.pendingEvidence = new Set();
    this.outputTranscriptTail = ''; this.teachingPreparation = null; this.preparationTimer = null;
    this.outputSignalBaseline = stats.audioRenderedSignalSamples || 0;
    this.teaching = new TeachingSequence({stats, player,
      isUserSpeaking: () => this.speaking,
      onSpeech: (identity, audibleAt) => this.onEvent({event: 'teaching_speech_onset', ...identity, audible_at: audibleAt}),
      send: packet => {
        if (packet.type === 'teaching_cancel' && this.teachingCancelPending) packet = {...packet, cancellation_id: this.teachingCancelPending};
        if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(packet));
      }});
  }

  startupPhase(phase) {
    const startup = this.stats.nativeStartup;
    if (!startup) return;
    startup.phase = phase;
    startup.elapsedMs = Math.round(performance.now() - startup.startedAt);
    startup.phases.push({phase, elapsedMs: startup.elapsedMs});
    this.onState(phase);
  }

  async start({microphone = true, opening = false, voice = 'Algenib', publicWeb = false, accent = 'german', textOnly = false} = {}) {
    if (this.active || this.connecting) return;
    this.connecting = true; this.textOnly = textOnly === true;
    if (this.textOnly) microphone = false;
    this.stats.nativeMode = this.textOnly ? 'text' : 'voice';
    this.stats.nativeStartup = {mode: this.stats.nativeMode, startedAt: performance.now(), phase: 'consent', phases: []};
    // The relay starts numbering at zero for every new connection. Never
    // carry an interruption epoch or playback queue across sessions.
    this.generation = 0; this.suppressAudio = false;
    this.sharedDocument = null; this.documentViewRevision = 0;
    this.pendingEvidence.clear();
    this.clearTeachingPreparation('cancelled'); this.outputTranscriptTail = '';
    this.outputSignalBaseline = this.stats.audioRenderedSignalSamples || 0;
    this.teachingSequenceId = null;
    this.teachingCancelPending = null;
    clearTimeout(this.drainTimer); this.continuousAudio = false; this.outputPending = false; this.drainReady = false;
    this.player.continuousAudio = false;
    this.speechOnset = 0; this.speaking = false; this.lastSpeechAt = null;
    this.firstAudioPending = true; this.pendingQueue = Promise.resolve();
    this.stats.nativeLastSpeechEndAt = null; this.stats.nativeTextSentAt = null;
    this.stats.nativeFirstPacketMs = null;
    this.textRequestId = 0; this.awaitingTextRequest = null;
    this.stats.nativeTransportRenewals = 0;
    const serial = ++this.serial;
    // Retired IDs belong to the previous connection; its serial cannot deliver
    // late messages into this one. Keep the bounded set scoped accordingly.
    this.teaching.retired.clear();
    this.onState('connecting');
    try {
      this.startupPhase('consent');
      await this.beforeStart?.();
      if (serial !== this.serial) return;
      if (!this.textOnly) {
      this.startupPhase('audio-preparation');
      let audioTimeout;
      try {
        await Promise.race([
          (async () => { await this.player.activate(); await this.player.prepareNative?.(); })(),
          new Promise((_, reject) => {
            audioTimeout = setTimeout(() => reject(new Error('Voice audio did not start. You can ask in writing, or try voice again.')), 20000);
          }),
        ]);
      } finally { clearTimeout(audioTimeout); }
      }
      if (serial !== this.serial) return;
      this.startupPhase('session-permit');
      const controller = new AbortController();
      const permitTimer = setTimeout(() => controller.abort(), 10000);
      let response, permit;
      try {
        response = await fetch('/api/native/permit', {method: 'POST', headers: {'Content-Type': 'application/json'},
          signal: controller.signal, body: JSON.stringify({voice, public_web: Boolean(publicWeb), accent,
            ...(this.textOnly ? {text_only: true} : {})})});
        permit = await response.json();
      } catch {
        throw new Error('The conversation service did not respond. Your question is still here; try again when ready.');
      } finally { clearTimeout(permitTimer); }

      if (!response.ok) throw new Error(permit.detail || 'Voice conversation is unavailable or external-processing approval is required.');
      if (serial !== this.serial) return;
      this.startupPhase('provider-connection');
      const address = new URL(this.textOnly ? '/api/native/text' : '/api/native/voice', location.href);
      address.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      address.searchParams.set('permit', permit.permit);
      const socket = permit.transport === 'renewable-websocket' ? new RenewableSocket(address) : new WebSocket(address);
      socket.onrenew = count => { this.stats.nativeTransportRenewals = count; };
      this.socket = socket;
      this.playerVersion = this.player.begin();
      this.player.finish();
      this.firstAudioPending = true;
      this.stats.nativeConnectStartedAt = performance.now();
      const began = performance.now(), closed = {code: null, wasClean: null, elapsedMs: null};
      this.stats.nativeSocketClose = closed;
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('The conversation did not connect in time. Your question is still here; try again when ready.')), 20000);
        socket.onerror = () => {
          clearTimeout(timeout);
          const error = new Error('The conversation connection was lost. Start again when ready; shared material needs your permission again.');
          if (serial === this.serial && this.active) {
            void this.stop(); // Stop local capture/playback before a delayed carrier close.
            this.onError(error.message);
          }
          reject(error);
        };
        socket.onclose = event => {
          // This object belongs to this socket; a late close cannot overwrite a
          // subsequent conversation's receipt. Never retain free-form reasons.
          Object.assign(closed, socketCloseReceipt(event, performance.now() - began));
          clearTimeout(timeout);
          if (!this.active) reject(new Error('The conversation closed before becoming ready. Your question is still here.'));
          else if (serial === this.serial && event?.code !== 1000) this.onError('The conversation connection was lost. Start again when ready; shared material needs your permission again.');
          this.cleanup(serial);
        };
        socket.onmessage = event => {
          if (serial !== this.serial) return;
          let message;
          try { message = JSON.parse(event.data); } catch { return; }
          if (message.event === 'connected') {
            clearTimeout(timeout); this.active = true; this.connecting = false;
            this.stats.nativeProviderVerified = !this.textOnly;
            this.stats.nativeConversationId = message.conversation_id;
            this.stats.nativeModel = message.model;
            this.stats.nativeProvider = message.provider;
            this.continuousAudio = message.continuous_audio === true;
            this.player.continuousAudio = this.continuousAudio;
            this.stats.nativeContinuousAudio = this.continuousAudio;
            this.stats.nativeVoice = message.voice;
            this.stats.nativeAccent = message.accent;
            this.stats.publicWebEnabled = message.public_web_enabled === true;
            this.stats.nativePrivacy = message.privacy;
            this.stats.nativeMode = message.mode === 'text' ? 'text' : 'voice';
            this.startupPhase('ready');
            this.onState('connected'); resolve();
          }
          if (message.event === 'error') {
            clearTimeout(timeout);
            this.onError(message.message || 'Native voice failed.');
            if (!this.active) reject(new Error(message.message || 'Native voice failed.'));
          }
          this.handle(message, serial);
        };
      });
      if (serial !== this.serial) return;
      if (microphone) { this.startupPhase('microphone-permission'); await this.startMicrophone(serial); this.startupPhase('ready'); }
      if (opening) this.sendText('Please introduce yourself as a digital interpretation of Einstein, welcome me to the Mobiliar Lab, and invite a question. Keep it brief.');
    } catch (error) {
      if (serial === this.serial) {
        if (this.stats.nativeStartup) this.stats.nativeStartup.failedPhase = this.stats.nativeStartup.phase;
        await this.stop();
        this.onError(error.message);
      }
      throw error;
    }
  }

  async startMicrophone(serial) {
    if (this.textOnly) throw new Error('This is a written conversation. End it before beginning a voice conversation.');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access requires localhost or HTTPS.');
    if (serial !== this.serial || !this.active || this.microphoneStarting) return;
    this.microphoneStarting = true; this.onState('microphone-permission');
    try {
    const stream = await navigator.mediaDevices.getUserMedia({audio: {channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true}});
    if (serial !== this.serial) { stream.getTracks().forEach(track => track.stop()); return; }
    this.stream = stream;
    this.inputContext = new AudioContext({latencyHint: 'interactive'});
    let primary = false;
    try { await prepareAudioModule(this.inputContext, '/audio-input.worklet.js'); primary = true; }
    catch (failure) { this.stats.microphoneWorkletPreparation = failure.code === 'worklet-deadline' ? 'timed-out' : 'unavailable'; }
    if (serial !== this.serial || !this.active) return;
    this.resampler = new PCM16Resampler(this.inputContext.sampleRate);
    this.inputSource = this.inputContext.createMediaStreamSource(stream);
    this.worklet = primary ? new AudioWorkletNode(this.inputContext, 'einstein-microphone') : createMicrophoneCompatibilityNode(this.inputContext);
    this.stats.nativeMicrophoneEngine = primary ? 'audio-worklet' : 'compatibility-buffer';
    if (primary) this.stats.microphoneWorkletPreparation = 'ready';
    this.silentGain = this.inputContext.createGain(); this.silentGain.gain.value = 0;
    this.inputSource.connect(this.worklet); this.worklet.connect(this.silentGain); this.silentGain.connect(this.inputContext.destination);
    this.worklet.port.onmessage = event => {
      if (serial !== this.serial || !this.active || this.socket?.readyState !== WebSocket.OPEN) return;
      const samples = new Float32Array(event.data);
      const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
      const dt = samples.length / this.inputContext.sampleRate;
      this.detectSpeech(rms, dt, performance.now());
      const packet = this.resampler.push(samples);
      if (this.socket.bufferedAmount > 128000) {
        this.onError('The voice connection is falling behind. It was stopped rather than buffering your microphone indefinitely.');
        this.stop(); return;
      }
      if (packet.byteLength) { this.socket.send(packet); this.stats.nativeInputBytes = (this.stats.nativeInputBytes || 0) + packet.byteLength; }
    };
    await this.inputContext.resume();
    if (serial !== this.serial || !this.active) return;
    this.stats.microphoneActive = true; this.microphoneStarting = false; this.onState('listening');
    } catch (failure) {
      if (serial === this.serial && this.stream) await this.stop();
      throw failure;
    } finally { if (serial === this.serial) { this.microphoneStarting = false; if (this.active && !this.stats.microphoneActive) this.onState('connected'); } }
  }

  detectSpeech(rms, dt, now) {
    const threshold = this.stats.audioPlaying ? .028 : .012;
    if (rms > threshold) {
      this.speechOnset += dt; this.lastSpeechAt = now;
      if (this.speechOnset > .14 && !this.speaking) {
        this.cancelTeaching();
        this.outputTranscriptTail = '';
        this.outputSignalBaseline = this.stats.audioRenderedSignalSamples || 0;
        this.speaking = true; this.firstAudioPending = true;
        this.onEvent({event: 'input_start', source: 'client-local'});
        this.stats.nativeUtterances = (this.stats.nativeUtterances || 0) + 1;
        if (this.continuousAudio || this.stats.audioPlaying) {
          const overlap = Boolean(this.stats.audioPlaying || (!this.continuousAudio && this.outputPending));
          this.suppressAudio = true; this.outputPending = false; this.drainReady = false;
          clearTimeout(this.drainTimer);
          if (this.continuousAudio) this.pendingQueue = Promise.resolve();
          this.player.stop(); this.playerVersion = this.player.version;
          if (this.continuousAudio) {
            this.stats.nativeLocalSpeechGates = (this.stats.nativeLocalSpeechGates || 0) + 1;
            if (overlap) this.stats.nativeLocalOverlaps = (this.stats.nativeLocalOverlaps || 0) + 1;
            this.onEvent({event: 'playback_suppressed', source: 'client-local', backend_continues: true, overlap});
          }
        }
        this.onState('listening');
      }
    } else {
      this.speechOnset = Math.max(0, this.speechOnset - dt);
      if (this.speaking && this.lastSpeechAt != null && now - this.lastSpeechAt > 450) {
        this.speaking = false; this.stats.nativeLastSpeechEndAt = this.lastSpeechAt;
        if (this.continuousAudio) {
          // Resume only current stream packets. Old local output never resumes;
          // the full-duplex provider and pending backend tools keep running.
          const preparation = this.teachingPreparation;
          const rebase = preparation?.waitForSpeechEnd && preparation.epoch === this.player.version;
          if (rebase) preparation.speechEndRebase = true;
          this.player.stop(); this.playerVersion = this.player.version;
          if (rebase && this.teachingPreparation === preparation) {
            preparation.epoch = this.player.version; preparation.waitForSpeechEnd = false;
            preparation.queue = null; preparation.queueDrained = false; preparation.renderAfterQueue = null;
            preparation.speechEndRebase = false;
            this.outputSignalBaseline = this.stats.audioRenderedSignalSamples || 0;
          }
          this.suppressAudio = false;
          this.onEvent({event: 'input_end', source: 'client-local'});
          this.updateTeachingPreparation();
        }
        this.onState('thinking');
      }
    }
  }

  playbackState(state) {
    this.updateTeachingPreparation();
    this.teaching.update({idle: state === 'idle'});
    if (!this.active || !this.continuousAudio || state !== 'idle' || !this.outputPending || (!this.drainReady && !this.player.continuousQuiet) || this.speaking) return;
    this.outputPending = false; this.drainReady = false;
    this.stats.nativePlaybackBoundaries = (this.stats.nativePlaybackBoundaries || 0) + 1;
    this.stats.nativeLastPlaybackBoundaryAt = performance.now();
    this.stats.nativeLastPlaybackBoundaryReason = this.player.continuousQuiet ? 'rendered-silence' : 'playback-drained';
    this.onEvent({event: 'playback_idle', source: 'client-local', boundary: this.stats.nativeLastPlaybackBoundaryReason});
    this.onState(this.pendingEvidence.size || this.teaching.active ? 'thinking' : 'listening');
  }

  resetPlayback(options) {
    clearTimeout(this.drainTimer); this.outputPending = false; this.drainReady = false;
    this.pendingQueue = Promise.resolve(); this.drainSequence = (this.drainSequence || 0) + 1;
    this.player.stop(options); this.playerVersion = this.player.version;
  }

  prepareTeaching(sequenceId) {
    if (!this.active || !this.continuousAudio || this.teachingCancelPending || this.teaching.active
        || typeof sequenceId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(sequenceId)
        || this.teaching.retired.has(sequenceId) || this.teaching.retired.size >= 64 || this.teachingPreparation) return false;
    this.teachingSequenceId = sequenceId;
    this.teachingPreparation = {sequenceId, serial: this.serial, epoch: this.player.version,
      began: performance.now(), ready: false, waitForSpeechEnd: this.speaking};
    this.updateTeachingPreparation();
    return true;
  }

  clearTeachingPreparation(phase, retire = true) {
    clearTimeout(this.preparationTimer); this.preparationTimer = null;
    const pending = this.teachingPreparation;
    if (!pending) return;
    if (retire) this.teaching.retired.add(pending.sequenceId);
    this.stats.teachingPreparation = {...this.stats.teachingPreparation, sequenceId: pending.sequenceId, phase};
    this.teachingPreparation = null;
  }

  updateTeachingPreparation() {
    const pending = this.teachingPreparation;
    if (!pending) return false;
    if (pending.speechEndRebase) return false;
    if (!this.active || pending.serial !== this.serial || pending.epoch !== this.player.version
        || this.teachingCancelPending || this.teaching.retired.has(pending.sequenceId)) {
      this.clearTeachingPreparation('cancelled'); return false;
    }
    if (pending.ready) return false;
    const elapsed = performance.now() - pending.began;
    if (elapsed >= 8000) { this.clearTeachingPreparation('timeout'); return false; }
    if (pending.queue !== this.pendingQueue) {
      const queue = pending.queue = this.pendingQueue;
      pending.queueDrained = false;
      queue.then(() => {
        if (this.teachingPreparation !== pending || this.pendingQueue !== queue) return;
        pending.queueDrained = true;
        // Wait for fresh worklet telemetry after enqueue, not old quiet from
        // before the packet reached the actual rendered playback queue.
        pending.renderAfterQueue = this.player.streamState;
        this.updateTeachingPreparation();
      }).catch(() => {});
    }
    const tail = this.outputTranscriptTail.trim().replace(/[)\]"'”’]+$/u, '').trimEnd();
    const complete = !tail || /[.!?。！？]$/u.test(tail) && !/(?:\.{2,}|…)$/u.test(tail);
    // Text can arrive before its delayed waveform. A spoken prelude must have
    // actually rendered in this intent, even if it finished before prepare.
    const signalObserved = (this.stats.audioRenderedSignalSamples || 0) > this.outputSignalBaseline;
    const quiet = this.stats.audioRenderedQuietMs;
    const delay = Number.isFinite(this.player.nativeDelaySeconds) ? Math.max(0, this.player.nativeDelaySeconds * 1000) : 0;
    const rendered = this.player.streamState;
    const audibleEnd = this.player.nativeAudibleSampleEnd, consumed = rendered?.inputSamplesConsumed;
    // Quiet between words is not completion. Match the actual consumed INPUT
    // position to the final audible raw sample already queued in this epoch;
    // silent transport packets may continue without postponing this boundary.
    const audibleTailConsumed = Number.isSafeInteger(audibleEnd) && audibleEnd >= 0
      && Number.isSafeInteger(consumed) && consumed >= audibleEnd;
    const drained = pending.queueDrained && rendered && rendered !== pending.renderAfterQueue
      && rendered.epoch === pending.epoch && this.player.lastState === 'idle'
      && audibleTailConsumed && this.stats.audioPlaying === false && !this.speaking && !this.suppressAudio;
    this.stats.teachingPreparation = {sequenceId: pending.sequenceId, phase: 'waiting-drain',
      playerVersion: pending.epoch, transcriptComplete: complete, queueDrained: pending.queueDrained,
      preludeSignalObserved: signalObserved,
      audibleSampleEnd: Number.isSafeInteger(audibleEnd) ? audibleEnd : null,
      inputSamplesConsumed: Number.isSafeInteger(consumed) ? consumed : null, audibleTailConsumed,
      renderedQuietMs: Number.isFinite(quiet) ? quiet : null, audioPlaying: this.stats.audioPlaying, elapsedMs: elapsed};
    if (drained && complete && (!tail || signalObserved) && Number.isFinite(quiet) && quiet >= 900 + delay && quiet <= 600000
        && this.socket?.readyState === WebSocket.OPEN) {
      pending.ready = true;
      clearTimeout(this.preparationTimer); this.preparationTimer = null;
      this.stats.teachingPreparation.phase = 'ready';
      try { this.socket.send(JSON.stringify({type: 'teaching_ready', sequence_id: pending.sequenceId,
        ready: true, rendered_quiet_ms: quiet, audio_playing: false})); }
      catch { this.clearTeachingPreparation('send-failed'); return false; }
      return true;
    }
    if (this.preparationTimer == null) this.preparationTimer = setTimeout(() => {
      this.preparationTimer = null;
      if (this.teachingPreparation === pending) this.updateTeachingPreparation();
    }, Math.min(100, 8000 - elapsed));
    return false;
  }

  handle(message, serial) {
    if (serial !== this.serial || !this.active) return;
    if (message.event === 'input_accepted') {
      if (!this.textOnly || message.request_id !== this.textRequestId || !Number.isInteger(message.generation)) return;
      this.awaitingTextRequest = null; this.generation = message.generation;
    }
    if (this.textOnly && message.event === 'audio') return;
    if (this.textOnly && !TEXT_CONTROL_EVENTS.has(message.event) &&
        (this.awaitingTextRequest != null || message.generation !== this.generation || message.request_id !== this.textRequestId)) return;
    if (this.textOnly && ['teaching_started','teaching_step','teaching_finished'].includes(message.event) &&
        (this.awaitingTextRequest != null || message.generation !== this.generation || message.request_id !== this.textRequestId)) return;
    if (this.textOnly && message.event === 'interrupted' && (!Number.isInteger(message.generation) || message.generation < this.generation)) return;
    if (message.event === 'evidence_activity') {
      if (message.generation !== this.generation || typeof message.tool_call_id !== 'string') return;
      if (message.status === 'running') this.pendingEvidence.add(message.tool_call_id);
      else if (message.status === 'finished') this.pendingEvidence.delete(message.tool_call_id);
      this.stats.nativePendingEvidence = this.pendingEvidence.size;
      if (!this.speaking && !this.stats.audioPlaying && this.pendingEvidence.size) this.onState('thinking');
    }
    if (message.event === 'teaching_cancelled') {
      if (message.cancellation_id === this.teachingCancelPending) this.teachingCancelPending = null;
      return;
    }
    if (this.teachingCancelPending && ['teaching_prepare', 'teaching_started', 'teaching_step'].includes(message.event)) {
      this.teaching.retired.add(message.sequence_id); return;
    }
    if (message.event === 'teaching_prepare') {
      if (this.prepareTeaching(message.sequence_id)) this.onEvent(message);
      return;
    }
    if (message.event === 'teaching_started') {
      if (this.teaching.retired.has(message.sequence_id)) return;
      if (this.teachingPreparation) {
        if (this.teachingPreparation.epoch !== this.player.version) { this.clearTeachingPreparation('cancelled'); return; }
        if (this.teachingPreparation.sequenceId !== message.sequence_id || !this.teachingPreparation.ready) return;
        this.clearTeachingPreparation('started', false);
      }
      this.teachingSequenceId = message.sequence_id;
    }
    if (message.event === 'teaching_finished') {
      if (message.sequence_id !== this.teachingSequenceId) return;
      this.clearTeachingPreparation('finished');
      this.teaching.finish(message);
    }
    if (message.event === 'teaching_step') {
      if (this.teachingPreparation) return;
      if (!this.teaching.start(message, () => {
        this.resetPlayback({preserveFocus: true}); this.suppressAudio = false;
      }, {manualOnly: this.textOnly === true})) return;
      this.onEvent(message);
      return;
    }
    if (this.textOnly && ['output_transcript','turn_complete','teaching_text'].includes(message.event) &&
        (this.awaitingTextRequest != null || message.generation !== this.generation || message.request_id !== this.textRequestId)) return;
    if (message.event === 'teaching_text') {
      const step = this.teaching.current;
      if (!this.textOnly || message.complete !== true || !step || message.sequence_id !== step.sequence_id ||
          message.index !== step.index || message.count !== step.count || typeof message.text !== 'string' || !message.text.trim()) return;
    }
    if (this.suppressAudio && message.event === 'output_transcript') return;
    if (message.event === 'output_transcript') {
      if (typeof message.text === 'string') this.outputTranscriptTail = (this.outputTranscriptTail + message.text).slice(-2000);
      this.teaching.transcript(message.text);
    }
    this.teaching.update();
    if (this.continuousAudio && ['turn_complete', 'interrupted'].includes(message.event)) return;
    if (message.event === 'document_action_failed') {
      if (message.generation !== this.generation) return;
      this.stats.nativeDocumentActionFailure = message;
      this.onError(message.diagnostic?.tool === 'mark_selected_pdf'
        ? 'The annotation was not applied. I need a valid region from this inspected page before adding a mark.'
        : 'The requested PDF action was not applied. The original document remains available.');
    }
    if (['document_inspection_failed', 'video_inspection_failed'].includes(message.event)) {
      if (message.generation !== this.generation) return;
      this.stats.nativeInspectionFailure = message;
      this.onError(message.event === 'document_inspection_failed'
        ? 'The page is open, but image inspection did not complete. I can read its text; figure details and annotations remain unavailable.'
        : 'The video frame is open, but image inspection did not complete. Its visual details and annotations remain unavailable.');
    }
    if (message.event === 'video_cancel') this.videoCancelHandler?.(message.action_id);
    if (message.event === 'video_action') {
      const action = message.action;
      const current = () => serial === this.serial && this.active && message.generation === this.generation;
      const respond = result => {
        if (!current() || this.socket?.readyState !== WebSocket.OPEN) return;
        this.socket.send(JSON.stringify({type: 'video_result', generation: message.generation, ...result}));
      };
      Promise.resolve().then(() => {
        if (!current() || !this.videoHandler) throw new Error('The video workspace is unavailable.');
        return this.videoHandler(action, current);
      }).then(respond).catch(() => respond({action_id: action.action_id, video_id: action.video_id, revision: action.revision, ok: false}));
    } else if (message.event === 'document_action') {
      const action = message.action;
      const attached = () => serial === this.serial && this.active && message.generation === this.generation;
      const current = () => attached() && action.document_id === this.sharedDocument?.id && action.view_revision === this.documentViewRevision &&
        (!action.teaching || (!this.teachingPreparation && !this.teachingCancelPending && action.teaching.sequence_id === this.teachingSequenceId && !this.teaching.retired.has(action.teaching.sequence_id)));
      const respond = result => {
        if (!attached() || this.socket?.readyState !== WebSocket.OPEN) return;
        if (!current()) result = {action_id: action.action_id, document_id: action.document_id, revision: action.revision, ok: false};
        this.socket.send(JSON.stringify({type: 'document_result', generation: message.generation, ...result}));
      };
      Promise.resolve().then(() => {
        if (!current() || !this.documentHandler) throw new Error('The local PDF viewer is unavailable.');
        return this.documentHandler(action, current);
      }).then(respond).catch(() => respond({action_id: action.action_id, document_id: action.document_id, revision: action.revision, ok: false}));
    } else if (message.event === 'presentation_action') {
      const attached = () => serial === this.serial && this.active && message.generation === this.generation;
      const current = () => attached() &&
        (!message.sequence_id || (!this.teachingPreparation && !this.teachingCancelPending && message.sequence_id === this.teachingSequenceId && !this.teaching.retired.has(message.sequence_id)));
      const action = message.action;
      const respond = result => {
        if (!attached() || this.socket?.readyState !== WebSocket.OPEN) return;
        this.socket.send(JSON.stringify({type: 'presentation_result', action_id: action.action_id,
          generation: message.generation, ...(current() ? result : {revision: action.revision, status: 'failed', rendered_elements: 0})}));
      };
      if (!current()) { respond({}); return; }
      Promise.resolve().then(() => {
        if (!this.presentationHandler) throw new Error('Visual renderer is unavailable');
        return this.presentationHandler(action, current);
      }).then(respond).catch(() => respond({revision: action.revision, status: 'failed', rendered_elements: 0}));
    } else if (message.event === 'interrupted') {
      this.generation = message.generation;
      this.player.stop(); this.playerVersion = this.player.version;
      this.suppressAudio = false; this.firstAudioPending = true;
      this.stats.nativeInterruptions = (this.stats.nativeInterruptions || 0) + 1;
      this.onState('listening');
    } else if (message.event === 'evidence_pending') {
      this.onState('thinking');
    } else if (message.event === 'audio') {
      if (message.generation < this.generation) return;
      if (this.suppressAudio) {
        if (this.continuousAudio) this.stats.nativeSuppressedAudioPackets = (this.stats.nativeSuppressedAudioPackets || 0) + 1;
        return;
      }
      if (this.continuousAudio) {
        this.stats.nativeUnattributedAudioPackets = (this.stats.nativeUnattributedAudioPackets || 0) + 1;
        this.stats.nativeAudioAttribution = 'unverified-continuous-provider-stream';
      }
      const bytes = bytesFromBase64(message.data);
      this.stats.nativeOutputBytes = (this.stats.nativeOutputBytes || 0) + bytes.length;
      this.stats.nativeLipsyncKind = 'audio-reactive';
      if (this.firstAudioPending) {
        this.firstAudioPending = false;
        const reference = this.stats.nativeLastSpeechEndAt ?? this.stats.nativeTextSentAt;
        this.stats.nativeFirstPacketMs = reference == null ? null : performance.now() - reference;
      }
      const version = this.playerVersion;
      if (this.continuousAudio) {
        const sequence = this.drainSequence = (this.drainSequence || 0) + 1;
        clearTimeout(this.drainTimer); this.drainReady = false; this.outputPending = true;
        // This is a local packet-inactivity heuristic, never provider completion.
        this.drainTimer = setTimeout(() => {
          this.pendingQueue.then(() => {
            if (serial !== this.serial || version !== this.player.version || sequence !== this.drainSequence || this.speaking) return;
            this.drainReady = true; this.player.finish();
            if (!this.stats.audioPlaying && !this.player.entries.length) this.playbackState('idle');
          });
        }, 400);
      }
      this.pendingQueue = this.pendingQueue.then(async () => {
        if (serial !== this.serial || version !== this.player.version) return;
        await this.player.enqueuePCM(bytes, message.sample_rate, version);
        if (serial !== this.serial || version !== this.player.version) return;
        if (!this.continuousAudio) this.onState('speaking');
      }).catch(error => { if (serial === this.serial && version === this.player.version) this.onError(error.message); });
    } else if (message.event === 'turn_complete' && !this.continuousAudio) {
      this.firstAudioPending = true; this.suppressAudio = false;
      this.stats.nativeCompletedTurns = (this.stats.nativeCompletedTurns || 0) + 1;
      if (this.textOnly) this.stats.nativeProviderVerified = true;
      const version = this.playerVersion;
      this.pendingQueue = this.pendingQueue.then(() => {
        if (serial !== this.serial || version !== this.player.version) return;
        this.player.finish();
        // Generation can finish long before the scheduled waveform ends.
        if (!this.stats.audioPlaying && !this.player.entries.length) this.onState('listening');
      });
    }
    this.onEvent(message);
    this.updateTeachingPreparation();
  }

  offerDocument(document) {
    if (!this.active || this.socket?.readyState !== WebSocket.OPEN) throw new Error('Connect the native conversation before sharing a document.');
    this.cancelTeaching();
    this.sharedDocument = document?.approved === true && /^[a-f0-9]{64}$/.test(document.id)
      && Number.isInteger(document.pages) && document.pages >= 1 && document.pages <= 200
      ? {id: document.id, pages: document.pages} : null;
    this.documentViewRevision = 0;
    this.socket.send(JSON.stringify({type: 'document_offer', document}));
  }

  selectDocumentView(view = {}) {
    if (!view || typeof view !== 'object' || Array.isArray(view)
        || Object.keys(view).some(key => !['document_id', 'page', 'region'].includes(key))) return false;
    const {document_id, page, region = [0, 0, 1, 1]} = view;
    if (!this.active || this.socket?.readyState !== WebSocket.OPEN || !this.sharedDocument
        || document_id !== this.sharedDocument.id || !Number.isInteger(page) || page < 1 || page > this.sharedDocument.pages
        || !Array.isArray(region) || region.length !== 4 || region.some(value => !Number.isFinite(value))
        || region[0] < 0 || region[1] < 0 || region[2] < .025 || region[3] < .025
        || region[0] + region[2] > 1.000001 || region[1] + region[3] > 1.000001 || this.documentViewRevision >= 10000) return false;
    this.cancelTeaching(); this.resetPlayback(); this.suppressAudio = true;
    this.onEvent({event: 'document_view_selected', page, region: [...region]});
    this.onState('listening');
    this.socket.send(JSON.stringify({type: 'document_view', view: {document_id, page, region: [...region],
      view_revision: ++this.documentViewRevision}}));
    return true;
  }

  offerVideo(video) {
    if (!this.active || this.socket?.readyState !== WebSocket.OPEN) throw new Error('Connect the conversation before sharing a video.');
    this.cancelTeaching();
    this.socket.send(JSON.stringify({type: 'video_offer', video}));
  }

  revokeVideo() {
    this.cancelTeaching();
    this.resetPlayback(); this.suppressAudio = true;
    this.onEvent({event: 'source_revoked', kind: 'video'});
    if (this.active && this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({type: 'video_revoke'}));
  }

  revokeDocument() {
    this.cancelTeaching();
    this.resetPlayback(); this.suppressAudio = true;
    this.onEvent({event: 'source_revoked', kind: 'paper'});
    this.sharedDocument = null; this.documentViewRevision = 0;
    if (this.active && this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({type: 'document_revoke'}));
  }

  cancelTeaching() {
    this.clearTeachingPreparation('cancelled');
    this.onEvent({event: 'teaching_local_cancel'});
    if (this.active && this.socket?.readyState === WebSocket.OPEN) {
      this.teachingCancellationId = (this.teachingCancellationId || 0) + 1;
      this.teachingCancelPending = this.teachingCancellationId;
    }
    if (!this.teaching.cancel(this.teachingSequenceId) && this.active && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({type: 'teaching_cancel', cancellation_id: this.teachingCancelPending}));
    }
  }

  sendText(text, {displayText = text} = {}) {
    if (!this.active || this.socket?.readyState !== WebSocket.OPEN) throw new Error('Native voice is not connected.');
    this.cancelTeaching();
    this.outputTranscriptTail = '';
    this.outputSignalBaseline = this.stats.audioRenderedSignalSamples || 0;
    this.resetPlayback();
    this.onEvent({event: 'input_start', source: 'typed', text: displayText});
    this.firstAudioPending = true; this.suppressAudio = this.continuousAudio && this.speaking;
    this.stats.nativeTextSentAt = performance.now(); this.stats.nativeLastSpeechEndAt = null;
    this.stats.nativeTurnOwnership = {mode: this.textOnly ? 'request-id-and-generation' : this.continuousAudio ? 'continuous-untagged' : 'provider-generation',
      providerResponseId: null, audibleUsefulWordOnsetMs: null,
      audioAttribution: this.continuousAudio ? 'unverified' : this.textOnly ? 'no-audio' : 'generation-only'};
    if (this.textOnly) this.awaitingTextRequest = this.textRequestId = (this.textRequestId || 0) + 1;
    this.socket.send(JSON.stringify({type: 'text', text, ...(this.textOnly ? {request_id: this.textRequestId} : {})}));
    this.onState('thinking');
  }

  async cleanup(serial) {
    if (serial !== this.serial) return;
    this.clearTeachingPreparation('cancelled'); this.outputTranscriptTail = '';
    this.teaching.cancel();
    this.pendingEvidence.clear(); this.stats.nativePendingEvidence = 0;
    // Detach ownership synchronously, before waiting for OS audio teardown.
    // A delayed close callback must never stop the following conversation.
    this.serial++;
    const inputContext = this.inputContext;
    const stream = this.stream;
    const socket = this.socket;
    this.inputContext = null; this.stream = null; this.socket = null;
    this.active = false; this.connecting = false;
    this.worklet?.disconnect(); this.inputSource?.disconnect(); this.silentGain?.disconnect();
    this.worklet = null; this.inputSource = null; this.silentGain = null;
    stream?.getTracks().forEach(track => track.stop());
    this.player.stop();
    clearTimeout(this.drainTimer); this.outputPending = false; this.drainReady = false; this.continuousAudio = false;
    this.player.continuousAudio = false;
    this.pendingQueue = Promise.resolve();
    this.suppressAudio = false; this.speaking = false; this.speechOnset = 0;
    this.stats.microphoneActive = false; this.microphoneStarting = false; this.onState('closed');
    try { socket?.close(); } catch {}
    const externalCleanup = this.player.endSession?.();
    if (inputContext && inputContext.state !== 'closed') await inputContext.close().catch(() => {});
    if (externalCleanup) await externalCleanup;

  }

  async stop() {
    const serial = this.serial;
    try {
      if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({type: 'stop'}));
    } catch { /* The transport can close between state inspection and send. */ }
    await this.cleanup(serial);
  }

}
