// Keep the original character; reduce only the cost of drawing it on slow devices.
export const SLOW_RENDER_PROFILE = Object.freeze({pixelRatio: .7, fps: 24});

export function reduceRenderCost(renderer, scene, deviceRatio) {
  renderer.setPixelRatio(Math.min(deviceRatio, SLOW_RENDER_PROFILE.pixelRatio));
  renderer.shadowMap.enabled = false;
  // Keep direct lights and source materials; omitting IBL makes lighting darker/flatter.
  scene.environment = null;
  // Changing light shadow counts also invalidates Three's compiled shadow shader.
  scene.traverse(object => { if (object.isLight) object.castShadow = false; });
}

export class RenderQuality {
  reduced = false;
  window = [];
  slowFrames = 0;
  slowMs = 0;

  observe(frameMs, {ready, visible, xr}) {
    if (this.reduced) return false;
    if (!ready || !visible || xr || !Number.isFinite(frameMs) || frameMs <= 0) {
      this.window = [];
      this.slowFrames = 0; this.slowMs = 0;
      return false;
    }
    this.window.push(frameMs); if (this.window.length > 6) this.window.shift();
    const slow = this.window.filter(ms => ms >= 80);
    this.slowFrames = slow.length;
    this.slowMs = this.window.length === 6 && slow.length < 3 ? 0 : Math.min(1200,
      Math.max(this.slowMs + (frameMs >= 80 ? frameMs : 0), slow.reduce((sum, ms) => sum + ms, 0)));
    // Ignore an isolated load/resize stall; stay reduced until the page reloads.
    if (this.window.length < 6 || this.slowFrames < 3 || this.slowMs < 1200) return false;
    this.reduced = true;
    return true;
  }
}

export function frameRate(intervals) {
  const elapsed = intervals.reduce((sum, ms) => sum + ms, 0);
  return elapsed > 0 ? Math.round(intervals.length * 10000 / elapsed) / 10 : 0;
}
