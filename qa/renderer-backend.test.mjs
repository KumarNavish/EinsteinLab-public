import assert from 'node:assert/strict';
import test from 'node:test';
import {assertRendererIdentity, rendererLaunchOptions} from './renderer-backend.mjs';

const source = {PATH: '/usr/bin', HOME: '/tmp/fixture', TMPDIR: '/tmp', DISPLAY: ':99', XAUTHORITY: '/tmp/xvfb-cookie',
  LIBGL_ALWAYS_SOFTWARE: 'true', GALLIUM_DRIVER: 'llvmpipe', OPENAI_API_KEY: 'synthetic-not-forwarded', GH_TOKEN: 'synthetic-not-forwarded'};

test('standard preserves the original launch and excludes Mesa/auth environment', () => {
  assert.deepEqual(rendererLaunchOptions(undefined, source), {channel: 'chrome', headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'], env: {PATH: '/usr/bin', HOME: '/tmp/fixture', TMPDIR: '/tmp'}});
});

test('Mesa uses real headed Chrome, ANGLE OpenGL and only its required environment', () => {
  const options = rendererLaunchOptions('mesa-llvmpipe', source);
  assert.equal(options.headless, false);
  assert.deepEqual(options.args.slice(1), ['--use-gl=angle', '--use-angle=gl', '--use-cmd-decoder=passthrough', '--ozone-platform=x11']);
  assert.equal(options.env.DISPLAY, ':99');
  assert.equal(options.env.XAUTHORITY, '/tmp/xvfb-cookie');
  assert.equal(options.env.LIBGL_ALWAYS_SOFTWARE, 'true');
  assert.equal(options.env.GALLIUM_DRIVER, 'llvmpipe');
  assert.equal(options.env.OPENAI_API_KEY, undefined);
  assert.equal(options.env.GH_TOKEN, undefined);
  assert.equal(options.args.some(arg => /disable-gpu|disable-web-security|no-sandbox|unsafe/.test(arg)), false);
});

test('unknown selection, remote display or missing driver controls fail before launch', () => {
  assert.throws(() => rendererLaunchOptions('arbitrary', source));
  for (const patch of [{DISPLAY: ''}, {DISPLAY: 'remote.example:0'}, {GALLIUM_DRIVER: 'softpipe'}, {LIBGL_ALWAYS_SOFTWARE: undefined}]) {
    assert.throws(() => rendererLaunchOptions('mesa-llvmpipe', {...source, ...patch}));
  }
});

test('Mesa accepts actual llvmpipe and rejects SwiftShader, hardware, generic and missing identities', () => {
  assert.doesNotThrow(() => assertRendererIdentity('mesa-llvmpipe', {vendor: 'Google Inc. (Mesa)', renderer: 'ANGLE (Mesa, llvmpipe (LLVM 20.1.2, 256 bits), OpenGL 4.5)'}));
  for (const renderer of ['ANGLE (Google, Vulkan SwiftShader Device)', 'ANGLE (Apple, Apple M1, Metal)', 'WebKit WebGL', '', 'llvmpipe softpipe']) {
    assert.throws(() => assertRendererIdentity('mesa-llvmpipe', {vendor: 'fixture', renderer}));
  }
  assert.throws(() => assertRendererIdentity('mesa-llvmpipe', null));
});

test('standard records automatic SwiftShader or native GPU selection without forcing either', () => {
  for (const renderer of ['ANGLE (Google, Vulkan SwiftShader Device)', 'ANGLE (Apple, Apple M1, Metal)']) {
    assert.doesNotThrow(() => assertRendererIdentity('standard', {vendor: 'fixture', renderer}));
  }
  assert.throws(() => assertRendererIdentity('standard', {}));
});
