/** Compatibility transport for browsers whose AudioWorklet preparation stalls.
 * The existing PCM core/guard own all samples; this adds no input or DSP path.
 */
export function createPCMCompatibilityNode(context, {PCMStreamCore, PureToneGuard}) {
  const node = context.createScriptProcessor(1024, 1, 1);
  const core = new PCMStreamCore(context.sampleRate), guard = new PureToneGuard();
  let epoch = 0, renderedFrames = 0, closed = false;
  const emit = data => queueMicrotask(() => { if (!closed) node.port.onmessage?.({data}); });
  node.port = {onmessage: null, postMessage(message) {
    if (closed || !message) return;
    if (message.kind === 'reset') {
      epoch = message.epoch; renderedFrames = 0; core.reset(); guard.reset();
    } else if (message.epoch === epoch) {
      try {
        if (message.kind === 'audio') {
          const samples = guard.push(new Float32Array(message.samples));
          if (samples.length) core.push(samples);
        } else if (message.kind === 'finish') {
          const samples = guard.push(new Float32Array(0), true);
          if (samples.length) core.push(samples);
          core.finish();
        }
      } catch {
        core.reset(); guard.reset();
        emit({kind: 'error', epoch, message: 'The audio queue was stopped at its safety limit.'});
      }
    }
  }};
  node.onaudioprocess = event => {
    const output = event.outputBuffer.getChannelData(0);
    if (closed) { output.fill(0); return; }
    const status = core.render(output); renderedFrames += output.length;
    emit({kind: 'status', epoch,
      time: Number.isFinite(event.playbackTime) ? event.playbackTime : context.currentTime,
      ...status, renderedFrames, toneFramesSuppressed: guard.suppressedFrames});
  };
  const disconnect = node.disconnect.bind(node);
  node.disconnect = (...args) => {
    closed = true; node.onaudioprocess = null; node.port.onmessage = null;
    core.reset(); guard.reset();
    return disconnect(...args);
  };
  return node;
}


/** A late module registration is harmless: callers create a node only after
 * this bounded preparation resolves and their session identity is still live.
 */
export async function prepareAudioModule(context, url) {
  let deadline;
  try {
    await Promise.race([
      context.audioWorklet.addModule(url),
      new Promise((_, reject) => { deadline = setTimeout(() => reject(Object.assign(new Error('Audio worklet preparation timed out'), {code: 'worklet-deadline'})), 1500); }),
    ]);
  } finally { clearTimeout(deadline); }
}

/** Capture callback only. Permission, stream ownership, resampling, transport
 * backpressure and speech detection remain in NativeConversation.
 */
export function createMicrophoneCompatibilityNode(context) {
  const node = context.createScriptProcessor(1024, 1, 1);
  let closed = false;
  node.port = {onmessage: null};
  node.onaudioprocess = event => {
    event.outputBuffer.getChannelData(0).fill(0);
    if (closed) return;
    const data = event.inputBuffer.getChannelData(0).slice().buffer;
    queueMicrotask(() => { if (!closed) node.port.onmessage?.({data}); });
  };
  const disconnect = node.disconnect.bind(node);
  node.disconnect = (...args) => {closed = true; node.onaudioprocess = null; node.port.onmessage = null; return disconnect(...args);};
  return node;
}
