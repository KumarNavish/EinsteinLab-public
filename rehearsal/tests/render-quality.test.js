import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene, DirectionalLight, Mesh, BoxGeometry, MeshPhysicalMaterial, Texture} from 'three';
import {RenderQuality, SLOW_RENDER_PROFILE, reduceRenderCost, frameRate} from '../src/render-quality.js';

const active = {ready: true, visible: true, xr: false};

test('sustained slow rendering reduces drawing cost once', () => {
  const quality = new RenderQuality();
  for (let i = 0; i < 5; i++) assert.equal(quality.observe(1500, active), false);
  assert.equal(quality.observe(1500, active), true);
  assert.equal(quality.reduced, true);
  assert.equal(quality.observe(16, active), false);
  assert.equal(quality.reduced, true);
  assert.deepEqual(SLOW_RENDER_PROFILE, {pixelRatio: .7, fps: 24});
});

test('short callbacks between repeated long frames cannot erase sustained slowness', () => {
  const quality = new RenderQuality();
  for (const interval of [3500, 33, 3500, 33, 3500]) assert.equal(quality.observe(interval, active), false);
  assert.equal(quality.observe(33, active), true);
});

test('healthy frames, startup, background and XR do not trigger a downgrade', () => {
  for (const state of [active, {...active, ready: false}, {...active, visible: false}, {...active, xr: true}]) {
    const quality = new RenderQuality();
    for (let i = 0; i < 30; i++) quality.observe(state === active ? 34 : 1500, state);
    assert.equal(quality.reduced, false);
  }
  const quality = new RenderQuality();
  quality.observe(10000, active);
  for (let i = 0; i < 8; i++) assert.equal(quality.observe(16, active), false);
  assert.equal(quality.slowMs, 0);
  for (let i = 0; i < 5; i++) assert.equal(quality.observe(200, active), false);
  assert.equal(quality.observe(200, active), true);
});

test('continuous moderately slow frames retain the elapsed slow-time trigger', () => {
  const quality = new RenderQuality();
  for (let i = 0; i < 11; i++) assert.equal(quality.observe(100, active), false);
  assert.equal(quality.observe(100, active), true);
  assert.equal(quality.window.length, 6);
  assert.equal(quality.slowMs, 1200);
});

test('isolated stalls cannot accumulate across mostly healthy windows or invalid context', () => {
  const quality = new RenderQuality();
  for (let cycle = 0; cycle < 8; cycle++) {
    for (const ms of [3500, 3500, 33, 33, 33, 33, 33, 33]) assert.equal(quality.observe(ms, active), false);
  }
  assert.equal(quality.window.length, 6);
  assert.equal(quality.slowMs, 0);
  for (const context of [{...active, ready: false}, {...active, visible: false}, {...active, xr: true}]) {
    quality.observe(3500, active);
    quality.observe(3500, context);
    assert.deepEqual(quality.window, []);
    assert.equal(quality.slowMs, 0);
  }
});

test('FPS includes the full frame interval instead of the animation dt cap', () => {
  assert.equal(frameRate(Array(90).fill(1500)), .7);
  assert.equal(frameRate(Array(90).fill(100)), 10);
  assert.equal(frameRate(Array(90).fill(1000 / 30)), 30);
  assert.equal(frameRate([]), 0);
});

test('fallback removes light-shadow shader work while preserving mesh and material', () => {
  const scene = new Scene(), light = new DirectionalLight(), texture = new Texture(), material = new MeshPhysicalMaterial({map: texture});
  const mesh = new Mesh(new BoxGeometry(), material), geometry = mesh.geometry;
  scene.environment = texture;
  light.castShadow = true; mesh.castShadow = true; scene.add(light, mesh);
  const renderer = {shadowMap: {enabled: true}, setPixelRatio(value) { this.ratio = value; }};
  reduceRenderCost(renderer, scene, 1.35);
  assert.equal(renderer.ratio, .7);
  assert.equal(renderer.shadowMap.enabled, false);
  assert.equal(scene.environment, null);
  assert.equal(light.castShadow, false);
  assert.equal(mesh.castShadow, true);
  assert.equal(mesh.geometry, geometry);
  assert.equal(mesh.material, material);
  assert.equal(material.map, texture);
  assert.equal(material.version, 0);
  geometry.dispose(); material.dispose(); texture.dispose();
});

test('healthy and startup frames preserve environment lighting and source materials', () => {
  for (const context of [active, {...active, ready: false}, {...active, visible: false}, {...active, xr: true}]) {
    const scene = new Scene(), texture = new Texture(), material = new MeshPhysicalMaterial({map: texture});
    const mesh = new Mesh(new BoxGeometry(), material), geometry = mesh.geometry;
    scene.add(mesh); scene.environment = texture;
    const renderer = {shadowMap: {enabled: true}, setPixelRatio() { assert.fail('Healthy/startup drawing ratio changed'); }};
    const quality = new RenderQuality();
    for (let i = 0; i < 30; i++) if (quality.observe(context === active ? 34 : 1500, context)) reduceRenderCost(renderer, scene, 1.35);
    assert.equal(scene.environment, texture);
    assert.equal(renderer.shadowMap.enabled, true);
    assert.equal(mesh.geometry, geometry);
    assert.equal(mesh.material, material);
    assert.equal(material.map, texture);
    assert.equal(material.version, 0);
    geometry.dispose(); material.dispose(); texture.dispose();
  }
});
