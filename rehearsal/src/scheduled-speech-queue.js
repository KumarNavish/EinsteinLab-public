/** Backpressure for decoded speech: fast/cached producers wait for playback.
 * Native PCM keeps its existing AudioWorklet path. This queue schedules exact
 * sample ranges from an unchanged decoded buffer, retaining the original cues.
 */
export const SPEECH_QUEUE_LIMITS = Object.freeze({
  aheadSeconds: 20, sliceSeconds: 4, clipSeconds: 180,
  decodedBytes: 32 * 1024 * 1024, encodedBytes: 16 * 1024 * 1024,
  pendingClips: 8, stallMilliseconds: 2500, waitMilliseconds: 30000,
});

export class PlaybackBlockedError extends Error {
  constructor(message = 'Audio output paused or stopped responding. End this turn, check the selected audio output, and try again.') {
    super(message); this.name = 'PlaybackBlockedError'; this.code = 'AUDIO_OUTPUT_BLOCKED';
  }
}

function pause(milliseconds, signal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', finish, {once: true});
    if (signal.aborted) finish();
  });
}

export class ScheduledSpeechQueue {
  constructor({context, tail, currentVersion, schedule, onWait = () => {},
    now = () => performance.now(), sleep = pause}) {
    this.context = context; this.tail = tail; this.currentVersion = currentVersion;
    this.schedule = schedule; this.onWait = onWait; this.now = now; this.sleep = sleep;
    this.reset();
  }

  reset() {
    this.epoch?.abort.abort();
    this.epoch = {abort: new AbortController(), chain: Promise.resolve(), count: 0, bytes: 0, failure: null};
  }

  enqueue({decode, version, encodedBytes = 0, cues = [], caption = ''}) {
    if (version !== this.currentVersion()) return Promise.resolve(false);
    const epoch = this.epoch;
    if (!Number.isSafeInteger(encodedBytes) || encodedBytes < 0 ||
        encodedBytes > SPEECH_QUEUE_LIMITS.encodedBytes ||
        epoch.bytes + encodedBytes > SPEECH_QUEUE_LIMITS.encodedBytes ||
        epoch.count >= SPEECH_QUEUE_LIMITS.pendingClips) {
      return Promise.reject(new Error('Too much speech arrived at once. Stop this turn and retry.'));
    }
    if (epoch.failure) return Promise.reject(epoch.failure);
    epoch.count++; epoch.bytes += encodedBytes;
    const valid = () => !epoch.abort.signal.aborted && version === this.currentVersion();
    const job = epoch.chain.then(async () => {
      if (!valid()) return false;
      if (epoch.failure) throw epoch.failure;
      const buffer = await decode();
      if (!valid()) return false;
      const {length, sampleRate, numberOfChannels, duration} = buffer || {};
      if (!Number.isSafeInteger(length) || length < 1 ||
          !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000 ||
          !Number.isSafeInteger(numberOfChannels) || numberOfChannels < 1 || numberOfChannels > 2 ||
          !Number.isFinite(duration) || duration <= 0 || duration > SPEECH_QUEUE_LIMITS.clipSeconds ||
          length * numberOfChannels * 4 > SPEECH_QUEUE_LIMITS.decodedBytes ||
          Math.abs(length / sampleRate - duration) > 1 / sampleRate) {
        throw new Error('The speech clip has invalid dimensions or exceeds its memory budget.');
      }
      const framesPerSlice = Math.floor(sampleRate * SPEECH_QUEUE_LIMITS.sliceSeconds);
      for (let firstFrame = 0; firstFrame < length; firstFrame += framesPerSlice) {
        const frameCount = Math.min(framesPerSlice, length - firstFrame);
        const offset = firstFrame / sampleRate, seconds = frameCount / sampleRate;
        if (!await this.waitForRoom(seconds, valid, epoch.abort.signal)) return false;
        if (!valid()) return false;
        this.schedule({buffer, offset, duration: seconds, cues, caption, version});
      }
      return true;
    }).catch(error => {
      if (!valid()) return false;
      epoch.failure = error;
      throw error;
    }).finally(() => { epoch.count--; epoch.bytes -= encodedBytes; });
    // Keep serialization, but do not turn a rejected job into an unhandled chain.
    epoch.chain = job.catch(() => {});
    return job;
  }

  async waitForRoom(duration, valid, signal) {
    const began = this.now();
    let previousAudioTime = this.context()?.currentTime;
    let lastProgress = began, waiting = false;
    try {
      while (valid()) {
        const context = this.context();
        const time = context?.currentTime;
        const tail = this.tail();
        if (!Number.isFinite(time) || !Number.isFinite(tail) || context?.state === 'closed') throw new PlaybackBlockedError();
        const end = Math.max(time + .025, tail) + duration;
        if (context.state === 'running' && end - time <= SPEECH_QUEUE_LIMITS.aheadSeconds + 1e-7) return true;
        if (!waiting) { waiting = true; this.onWait(true); }
        if (time > previousAudioTime + .001) { previousAudioTime = time; lastProgress = this.now(); }
        if (this.now() - lastProgress >= SPEECH_QUEUE_LIMITS.stallMilliseconds ||
            this.now() - began >= SPEECH_QUEUE_LIMITS.waitMilliseconds) throw new PlaybackBlockedError();
        await this.sleep(40, signal);
      }
      return false;
    } finally { if (waiting) this.onWait(false); }
  }
}
