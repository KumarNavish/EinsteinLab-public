// Renderer selection is confined to the manual, zero-provider benchmark.
import os from 'node:os';

export function rendererLaunchOptions(selected = 'standard', source = process.env) {
  if (!['standard', 'mesa-llvmpipe'].includes(selected)) throw Error('Unsupported benchmark renderer.');
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR'].filter(key => source[key] != null).map(key => [key, source[key]]));
  env.TMPDIR ||= os.tmpdir();
  const options = {channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'], env};
  if (selected === 'mesa-llvmpipe') {
    if (!/^:\d+(?:\.\d+)?$/.test(source.DISPLAY || '') || source.LIBGL_ALWAYS_SOFTWARE !== 'true' || source.GALLIUM_DRIVER !== 'llvmpipe') {
      throw Error('Mesa benchmark requires a local Xvfb DISPLAY and explicit llvmpipe environment.');
    }
    for (const key of ['DISPLAY', 'XAUTHORITY', 'LIBGL_ALWAYS_SOFTWARE', 'GALLIUM_DRIVER']) {
      if (source[key] != null) env[key] = source[key];
    }
    options.headless = false;
    options.args.push('--use-gl=angle', '--use-angle=gl', '--use-cmd-decoder=passthrough', '--ozone-platform=x11');
  }
  return options;
}

export function assertRendererIdentity(selected, identity) {
  if (!['standard', 'mesa-llvmpipe'].includes(selected)) throw Error('Unsupported benchmark renderer.');
  if (typeof identity?.renderer !== 'string' || !identity.renderer.trim() || typeof identity?.vendor !== 'string' || !identity.vendor.trim()) {
    throw Error('Actual WebGL identity is missing.');
  }
  // Standard preserves Chrome's automatic selection, including native local GPUs.
  // The explicit Mesa variant must never silently benchmark a fallback backend.
  if (selected === 'mesa-llvmpipe' && (!/\bllvmpipe\b/i.test(identity.renderer) || /swiftshader|softpipe/i.test(identity.renderer))) {
    throw Error('Requested Mesa llvmpipe did not initialize; retain the actual renderer as a compatibility failure.');
  }
}
