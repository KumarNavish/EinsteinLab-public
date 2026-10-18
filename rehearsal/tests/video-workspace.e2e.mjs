// Isolated local browser fixture: actual decoding, no app backend or provider.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';

const rehearsal = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'einstein-video-test-'));
const fixture = path.join(temporary, 'controlled-source.webm');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=10:duration=6', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '35', '-an', '-y', fixture]);
const portraitFixture = path.join(temporary, 'controlled-portrait.webm');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=180x320:rate=5:duration=2', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '35', '-an', '-y', portraitFixture]);
const html = `<!doctype html><html><head><title>Local video fixture</title></head><body><main id="app"></main><footer class="quiet-footer"></footer><script type="module">
import {VideoWorkspace} from '/src/video-workspace.js';
window.packets = [];
const native = {active:true,serial:1,offerVideo(video){packets.push({type:'video_offer',video});},revokeVideo(){packets.push({type:'video_revoke'});},sendText(text){packets.push({type:'text',text});}};
window.app={stats:{nativeStatus:{available:true}},native}; window.workspace=new VideoWorkspace(app);
window.revision=0;window.action=(kind,extras={})=>({kind,action_id:crypto.randomUUID(),video_id:workspace.manifest.id,revision:++revision,...extras});
</script></body></html>`;
const server = await createServer({root: rehearsal, configFile: false, server: {host: '127.0.0.1', port: 0}, plugins: [{name: 'offline-video-fixture', configureServer(server) { server.middlewares.use('/__video_fixture', (request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(html); }); }}]});
let browser;
const checks = [], errors = [], requests = [];
async function check(name, condition) { assert(await condition, name); checks.push(name); }
try {
  await server.listen();
  const url = `http://127.0.0.1:${server.httpServer.address().port}/__video_fixture`;
  browser = await chromium.launch({channel: 'chrome', headless: true});
  const page = await browser.newPage({viewport: {width: 1280, height: 900}});
  await page.route('**/*', route => {
    const target = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(target.hostname) && target.protocol !== 'blob:') { errors.push('Non-local request: ' + target.origin); return route.abort(); }
    return route.continue();
  });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push({method: request.method(), url: request.url()}));
  await page.goto(url); await page.waitForFunction(() => window.workspace);
  await page.locator('#video-file').setInputFiles(fixture);
  await page.waitForFunction(() => window.workspace.manifest);
  await check('actual local video decoded without approval or upload', page.evaluate(() => workspace.video.videoWidth === 320 && workspace.video.videoHeight === 240 && app.stats.video.selected && !app.stats.video.approved && !packets.length));
  await check('unsupported streaming is disclosed', page.locator('#video-caption').textContent().then(text => text.includes('not supported')));
  await page.locator('#video-discuss').click();
  await check('explicit consent applies only to this native session', page.evaluate(() => workspace.approved && workspace.sharedSession === app.native.serial && packets[0].type === 'video_offer' && packets[0].video.approved === true));
  const inspected = await page.evaluate(async () => {
    const result = await workspace.apply(action('inspect', {seconds: 1}), () => true);
    const raw = Uint8Array.from(atob(result.image.data), value => value.charCodeAt(0));
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', raw))].map(value => value.toString(16).padStart(2, '0')).join('');
    return {time: result.time, paused: result.paused, hash, bytes: raw.length};
  });
  await check('bounded source frame comes from requested paused playhead', inspected.paused && Math.abs(inspected.time - 1) < .01 && inspected.bytes > 1000 && inspected.bytes < 262500);
  await page.evaluate(async ({hash}) => { await workspace.apply(action('mark', {time: 1, frame_hash: hash, region: [.05, .05, .3, .25], label: 'Offline renderer fixture'}), () => true); }, inspected);
  await check('annotation rendered separately from the original source', page.evaluate(async ({hash}) => {
    const frame = await workspace.snapshot();
    const pixels = workspace.overlay.getContext('2d').getImageData(0, 0, workspace.overlay.width, workspace.overlay.height).data;
    return frame.hash === hash && pixels.some((value, i) => i % 4 === 3 && value > 0) && workspace.annotation.label === 'Offline renderer fixture';
  }, inspected));
  await page.evaluate(async () => { await workspace.apply(action('play'), () => true); });
  await check('playback uses actual original video and clears stale overlay', page.evaluate(() => !workspace.video.paused && !workspace.annotation && app.stats.video.markCount === 0));
  await page.evaluate(async () => {
    await workspace.apply(action('pause'), () => true);
    await workspace.apply(action('seek', {seconds: 4}), () => true);
    await workspace.apply(action('rewind', {seconds: 2}), () => true);
    await workspace.apply(action('rate', {rate: .5}), () => true);
  });
  await check('seek rewind pause and speed acknowledge actual state', page.evaluate(() => Math.abs(workspace.video.currentTime - 2) < .01 && workspace.video.paused && workspace.video.playbackRate === .5));
  await page.evaluate(async () => { await workspace.apply(action('hide'), () => true); });
  await check('hide preserves selected source and pauses playback', page.evaluate(() => workspace.panel.hidden && workspace.manifest && workspace.video.paused));
  await page.evaluate(async () => { await workspace.apply(action('pause'), () => true); });
  await check('stale revision and cross-session actions are rejected', page.evaluate(async () => {
    let rejected = 0;
    try { await workspace.apply(action('pause', {revision: workspace.appliedRevision}), () => true); } catch { rejected++; }
    app.native.serial++;
    try { await workspace.apply(action('pause'), () => true); } catch { rejected++; }
    workspace.revoke();
    return rejected === 2 && !workspace.approved && !workspace.lastRead && !workspace.annotation;
  }));
  await page.locator('#video-discuss').click();
  await check('reapproval resets operation revision for the new conversation', page.evaluate(async () => {
    const result = await workspace.apply(action('pause', {revision: 1}), () => true);
    revision = 1;
    return result.ok && workspace.appliedRevision === 1;
  }));
  await check('cancelled seek cannot acknowledge success', page.evaluate(async () => {
    const original = workspace.waitEvent.bind(workspace);
    let release;
    workspace.waitEvent = (name, timeout) => name === 'seeked' ? new Promise(resolve => { release = resolve; }) : original(name, timeout);
    const pending = workspace.apply(action('seek', {seconds: 5}), () => true).then(() => false, () => true);
    while (!release) await Promise.resolve();
    const identity = workspace.activeAction;
    app.native.videoCancelHandler(identity); release();
    const rejected = await pending;
    workspace.waitEvent = original;
    return rejected && !workspace.activeAction && !workspace.busy && !workspace.annotation;
  }));
  await page.setViewportSize({width: 390, height: 844});
  await page.evaluate(() => workspace.layout());
  await check('mobile frame and overlay remain aligned without overflow', page.evaluate(() => {
    const source = workspace.video.getBoundingClientRect(), overlay = workspace.overlay.getBoundingClientRect();
    return document.documentElement.scrollWidth <= innerWidth && Math.abs(source.width - overlay.width) < 1 && Math.abs(source.height - overlay.height) < 1 && Math.abs(source.width / source.height - workspace.video.videoWidth / workspace.video.videoHeight) < .01;
  }));
  await page.locator('#video-file').setInputFiles(portraitFixture);
  await page.waitForFunction(() => workspace.manifest?.width === 180);
  await check('actual portrait source keeps overlay aligned inside the scrolling panel', page.evaluate(() => {
    const source = workspace.video.getBoundingClientRect(), overlay = workspace.overlay.getBoundingClientRect();
    return Math.abs(source.width / source.height - 9 / 16) < .01 && Math.abs(source.height - overlay.height) < 1 && getComputedStyle(workspace.panel).overflowY === 'auto';
  }));
  await check('page navigation drops source consent and pending handles', page.evaluate(() => {
    window.dispatchEvent(new Event('pagehide'));
    return workspace.url === null && workspace.file === null && workspace.manifest === null && !workspace.approved && workspace.waiters.size === 0 && !workspace.activeAction && !workspace.video.hasAttribute('src') && workspace.panel.hidden;
  }));
  await page.locator('#video-file').setInputFiles({name: 'malformed.webm', mimeType: 'video/webm', buffer: Buffer.alloc(64, 65)});
  await page.waitForFunction(() => document.querySelector('#video-status').dataset.state === 'error');
  await check('malformed media stays unapproved and releases source', page.evaluate(() => !workspace.manifest && !workspace.url && !workspace.approved && workspace.discussButton.disabled));
  await check('URL input cannot trigger streaming or filesystem access', page.evaluate(async () => { await workspace.open('https://example.com/video.webm'); return !workspace.manifest && workspace.discussButton.disabled; }));
  await page.goto(url + '?navigation=1'); await page.waitForFunction(() => window.workspace);
  await page.goBack(); await page.waitForFunction(() => window.workspace);
  await check('real navigation and history return retain no private media', page.evaluate(() => !workspace.manifest && !workspace.file && !workspace.url && !workspace.approved));
  await check('no external request or backend mutation occurred', errors.length === 0 && requests.every(request => request.method === 'GET'));
  console.log(JSON.stringify({scope: 'Offline browser renderer fixture, synthetic media, no credentials/providers. Model tool selection and remote vision are not exercised.', checks: checks.length, passed: checks, errors}, null, 2));
} finally {
  await browser?.close(); await server.close(); await fs.rm(temporary, {recursive: true, force: true});
}
