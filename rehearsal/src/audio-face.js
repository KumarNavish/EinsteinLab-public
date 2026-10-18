import {applyClassifierEvent, ArticulationTimeline} from './viseme-timing.js';
/** Convert locally estimated Oculus visemes to the existing CC4/Rhubarb pose space.
 * This is audio-driven classification, not provider-supplied phoneme truth.
 */
const MAP = {
  viseme_aa: 'D', viseme_E: 'C', viseme_I: 'B', viseme_O: 'E', viseme_U: 'F',
  viseme_PP: 'A', viseme_FF: 'G', viseme_TH: 'H', viseme_DD: 'B',
  viseme_kk: 'C', viseme_nn: 'H', viseme_RR: 'H', viseme_CH: 'F', viseme_SS: 'B',
  viseme_sil: 'X',
};

export function mouthWeights(values) {
  const weights = {};
  for (const [name, raw] of Object.entries(values)) {
    if (!MAP[name] || !Number.isFinite(raw)) continue;
    const value = Math.max(0, Math.min(1, raw));
    weights[MAP[name]] = Math.max(weights[MAP[name]] || 0, value);
  }
  const sum = Object.entries(weights).reduce((total, [name, value]) => total + (name === 'X' ? 0 : value), 0);
  if (sum > 1) for (const name in weights) if (name !== 'X') weights[name] /= sum;
  return weights;
}

export class AudioFace {
  constructor(context, stats) {
    this.context = context;
    this.stats = stats;
    this.values = {};
    this.node = null;
    this.loading = null;
    this.lastTime = performance.now();
    this.timeline = new ArticulationTimeline({leadSeconds: 0, attackSeconds: .025, releaseSeconds: .045});
  }

  async prepare() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const module = await import(/* @vite-ignore */ '/vendor/headaudio/headaudio.min.mjs');
      await this.context.audioWorklet.addModule('/vendor/headaudio/headworklet.min.mjs');
      const Node = module.HeadAudio || module.HeadAudioNode || module.default;
      if (typeof Node !== 'function') throw new Error('Audio-face module does not export its worklet node');
      const node = new Node(this.context, {
        processorOptions: {visemeEventsEnabled: true},
        parameterData: {vadMode: 1, vadGateActiveDb: -42, vadGateInactiveDb: -52, silMode: 0},
      });
      node.onvalue = (key, value) => { this.values[key] = value; };
      node.onviseme = event => {
        applyClassifierEvent(node, event);
        this.timeline.push(event.viseme, this.context.currentTime);
        this.stats.audioFaceZeroEvents = (this.stats.audioFaceZeroEvents || 0) + (event.viseme === 0 ? 1 : 0);
        this.stats.audioFaceEvents = (this.stats.audioFaceEvents || 0) + 1;
        this.stats.audioFaceLastEventAt = performance.now();
        this.stats.audioFaceClasses ||= [];
        if (!this.stats.audioFaceClasses.includes(event.viseme)) this.stats.audioFaceClasses.push(event.viseme);
      };
      node.onprocessorerror = () => { this.stats.audioFaceError = 'worklet-processor-error'; };
      await node.loadModel('/vendor/headaudio/model-en-mixed.bin');
      this.node = node;
      this.stats.audioFaceReady = true;
      this.stats.audioFaceMethod = 'HeadAudio MFCC/Gaussian viseme estimate mapped to CC4';
      return node;
    })().catch(error => {
      this.stats.audioFaceReady = false;
      this.stats.audioFaceError = error.message;
      return null;
    });
    return this.loading;
  }

  update(now = performance.now()) {
    const dt = Math.min(80, Math.max(0, now - this.lastTime));
    this.lastTime = now;
    this.node?.update(dt);
    return mouthWeights(this.timeline.sample(this.context.currentTime));
  }

  reset() {
    this.values = {};
    this.timeline.reset();
    if (this.node) {
      this.node.visemeActive = -1;
      this.node.visemeAlphas?.fill(0);
    }
  }
}
