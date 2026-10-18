// Actual public browser QA: zero provider permits/sessions; exactly one labelled feedback write.
// Requires built reviewed dist, installed Chrome/Playwright, explicit public PDF and synthetic video.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {publicOrigin, redact, sha256} from './helpers.mjs';

if (!process.argv.includes('--run')) {
  console.log(JSON.stringify({state: 'PREPARED_NOT_RUN', providerPermits: 0, providerSessions: 0, feedbackSubmissions: 1,
    maxSeconds: 300, gates: ['--run', 'EINSTEIN_PUBLIC_KEYLESS_APPROVED=1', 'EINSTEIN_PUBLIC_URL', 'EINSTEIN_PUBLIC_PDF', 'EINSTEIN_PUBLIC_DEPLOYMENT_ID', 'EINSTEIN_PUBLIC_RELEASE_SHA']}));
  process.exit(0);
}
if (process.env.EINSTEIN_PUBLIC_KEYLESS_APPROVED !== '1') throw Error('No browser opened: explicit keyless public QA approval is required.');
const origin = publicOrigin(process.env.EINSTEIN_PUBLIC_URL);
const root = fileURLToPath(new URL('../../', import.meta.url));
const fixtures = {pdf: process.env.EINSTEIN_PUBLIC_PDF,
  video: process.env.EINSTEIN_PUBLIC_VIDEO || path.join(root, 'qa/public-acceptance/fixtures/original-synthetic.webm')};
for (const [kind, filename] of Object.entries(fixtures)) {
  if (!filename || !(await fs.stat(filename).catch(() => null))?.isFile()) throw Error(`Set an existing authorized ${kind} fixture. No browser opened.`);
}
const deployment = {id: process.env.EINSTEIN_PUBLIC_DEPLOYMENT_ID, sourceCommit: process.env.EINSTEIN_PUBLIC_RELEASE_SHA};
if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(deployment.id || '') || !/^[a-f0-9]{40}$/.test(deployment.sourceCommit || '')) throw Error('Set owner-verified deployment UUID and source SHA. No browser opened.');
const index = await fs.readFile(path.join(root, 'rehearsal/dist/index.html'), 'utf8');
const entryPaths = [...index.matchAll(/(?:src|href)="(\/assets\/[^"?]+)"/g)].map(match => match[1]);
if (!entryPaths.some(name => name.endsWith('.js'))) throw Error('Build the reviewed frontend before this run.');
const expectedAssets = Object.fromEntries(await Promise.all(entryPaths.map(async name => {
  const bytes = await fs.readFile(path.join(root, 'rehearsal/dist', name)); return [name, {bytes: bytes.length, sha256: sha256(bytes)}];
})));
const pins = JSON.parse(await fs.readFile(path.join(root, 'deploy/release-inputs.json'), 'utf8'));
const character = pins.assets.find(value => value.name === 'einstein.glb');
expectedAssets['/assets/einstein.glb'] = {bytes: character.bytes, sha256: character.sha256};
const output = path.join(root, `evidence/${new Date().toISOString().slice(0, 10)}-public-acceptance`, 'keyless-' + new Date().toISOString().replace(/[:.]/g, '-'));
await fs.mkdir(output, {recursive: true});
const report = {state: 'RUNNING_UNVERIFIED', scope: 'Actual public browser and private feedback; no provider permission, native/model/vision acceptance or human quality verdict.',
  startedAt: new Date().toISOString(), origin, ownerVerifiedDeployment: deployment, expectedAssets,
  checks: [], requests: [], errors: [], csp: [], servedAssets: {}, websocketAttempts: 0, providerPermits: 0, feedbackPosts: 0,
  fixtures: {}, limits: ['Native speech, model conversation, source vision, research and source-ID model annotations remain unverified.']};
for (const [kind, filename] of Object.entries(fixtures)) { const bytes = await fs.readFile(filename); report.fixtures[kind] = {name: path.basename(filename), bytes: bytes.length, sha256: sha256(bytes)}; }
report.harness = {sha256: sha256(await fs.readFile(fileURLToPath(import.meta.url)))};
const {chromium} = await import('../../rehearsal/node_modules/@playwright/test/index.mjs');
let browser, page;
const until = Date.now() + 300000;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function flush() { await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
function check(name, passed, value) { report.checks.push({at: new Date().toISOString(), name, passed: Boolean(passed), value}); if (!passed) throw Error(name); }
async function checkpoint(name) { await flush(); console.log(JSON.stringify({checkpoint: name, checks: report.checks.length, providerPermits: report.providerPermits, websocketAttempts: report.websocketAttempts, feedbackPosts: report.feedbackPosts})); }
async function read() {
  return page.evaluate(() => {
    const a = window.__einstein;
    let texturedMeshes = 0; a.stage.model?.traverse(node => { if (node.isMesh && (Array.isArray(node.material) ? node.material : [node.material]).some(material => material?.map)) texturedMeshes++; });
    return {avatarReady: a.stats.avatarReady, frame: a.stats.frame, renderCalls: a.stage.renderer.info.render.calls,
      triangles: a.stage.renderer.info.render.triangles, texturedMeshes, nativeActive: a.native.active, nativeConnecting: a.native.connecting,
      microphoneActive: Boolean(a.stats.microphoneActive), microphoneStream: Boolean(a.native.stream), document: a.stats.document, video: a.stats.video,
      overflow: document.documentElement.scrollWidth > innerWidth + 1 || document.body.scrollWidth > innerWidth + 1,
      visibility: document.visibilityState, engine: document.querySelector('#conversation-engine').value,
      error: document.querySelector('#error').hidden ? '' : document.querySelector('#error-message').textContent};
  });
}
async function paperPixels() {
  return page.evaluate(async () => {
    const viewer = window.__einstein.paper;
    const bytes = viewer.pdf.canvas.getContext('2d').getImageData(0, 0, viewer.pdf.canvas.width, viewer.pdf.canvas.height).data;
    return {id: viewer.pdf.manifest.id, page: viewer.pdf.pageNumber, pages: viewer.pdf.manifest.pages,
      textPrefix: viewer.pdf.text.slice(0, 200), width: viewer.pdf.canvas.width, height: viewer.pdf.canvas.height,
      sha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join(''), approved: viewer.approved};
  });
}
try {
  browser = await chromium.launch({channel: 'chrome', headless: true});
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, permissions: []});
  page = await context.newPage(); page.setDefaultTimeout(10000);
  const inspection = await context.newCDPSession(page);
  await inspection.send('Network.enable', {maxTotalBufferSize: 180_000_000, maxResourceBufferSize: 80_000_000});
  report.passiveNetworkInspectionBuffer = {totalBytes: 180_000_000, resourceBytes: 80_000_000};
  page.on('request', request => {
    const url = new URL(request.url()); if (!/^https?:$/.test(url.protocol)) return;
    report.requests.push({origin: url.origin, path: url.pathname, method: request.method(), bodyBytes: request.postDataBuffer()?.length || 0});
    if (request.method() === 'POST' && url.pathname === '/api/native/permit') { report.providerPermits++; void browser.close(); }
    if (request.method() === 'POST' && url.pathname === '/api/feedback') {
      report.feedbackPosts++;
      try { const body = request.postDataJSON(); report.feedbackRequestFields = Object.fromEntries(['request_id', 'rating', 'realism', 'voice', 'kind', 'message', 'context'].map(key => [key, body[key] ?? null])); } catch { report.feedbackRequestInvalid = true; }
    }
  });
  page.on('websocket', () => { report.websocketAttempts++; void browser.close(); });
  page.on('pageerror', error => report.errors.push(redact(error.message)));
  page.on('console', message => { if (message.type() === 'error') { const value = redact(message.text()); report.errors.push(value); if (/content.security|refused to|violat.*policy/i.test(value)) report.csp.push(value); } });
  page.on('response', async response => {
    const url = new URL(response.url());
    if (url.origin === origin && url.pathname === '/') report.securityHeaders = {csp: await response.headerValue('content-security-policy'), hsts: await response.headerValue('strict-transport-security'), permissionsPolicy: await response.headerValue('permissions-policy')};
    if (url.origin === origin && expectedAssets[url.pathname] && response.status() === 200) { const bytes = await response.body().catch(error => { report.assetCaptureErrors ??= []; report.assetCaptureErrors.push({path: url.pathname, error: redact(error.message)}); return null; }); if (bytes) report.servedAssets[url.pathname] = {bytes: bytes.length, sha256: sha256(bytes), measurement: 'actual-page-response'}; }
  });
  const deadline = setTimeout(() => { report.deadlineExceeded = true; void browser.close(); }, Math.max(1, until - Date.now())); deadline.unref();
  const navigationStarted = Date.now();
  await page.goto(origin, {waitUntil: 'domcontentloaded', timeout: 30000});
  await page.waitForFunction(() => window.__einstein?.stats.nativeStatus, undefined, {timeout: 30000});
  report.initialNativeStatus = await page.request.get(origin + '/api/native/status').then(response => response.json()).then(value => ({available: value.available, active: value.active, room_active_sessions: value.room_active_sessions, room_capacity: value.room_capacity}));
  report.desktop = await read();
  check('initial desktop has no horizontal overflow', !report.desktop.overflow);
  await checkpoint('actual public UI ready; character download may still be in progress');

  check('public UI uses native mode before consent probe', report.desktop.engine === 'native');
  await page.click('#microphone');
  const consent = page.locator('dialog[aria-labelledby="processing-heading"]');
  if (await consent.isVisible()) {
    await consent.getByRole('button', {name: 'Not now', exact: true}).click();
    await page.waitForFunction(() => !window.__einstein.native.connecting);
    report.processingDecision = 'actual processing dialog declined';
  } else {
    await page.waitForFunction(() => !document.querySelector('#error').hidden);
    report.processingDecision = 'unavailable route prevented entry before consent dialog';
    report.limits.push('With native availability disabled, the public UI prevents entry before processing consent. Decline-dialog interaction was unreachable and is not marked passed.');
  }
  const afterDecision = await read();
  check('entry decision caused no provider permit, websocket or active microphone', report.providerPermits === 0 && report.websocketAttempts === 0 && !afterDecision.nativeActive && !afterDecision.nativeConnecting && !afterDecision.microphoneActive && !afterDecision.microphoneStream, {decision: report.processingDecision});
  if (await page.locator('#error').isVisible()) await page.click('#error-dismiss');

  await page.setInputFiles('#paper-file', fixtures.pdf);
  await page.waitForFunction(() => window.__einstein.paper.pdf?.pageNumber === 1 && window.__einstein.paper.base.width > 100);
  const first = await paperPixels(); check('actual original public PDF rendered locally', first.id === report.fixtures.pdf.sha256 && first.pages > 1 && first.width > 100 && !first.approved, first);
  await page.fill('#paper-page', '2'); await page.press('#paper-page', 'Tab');
  await page.waitForFunction(() => window.__einstein.paper.pdf?.pageNumber === 2);
  const second = await paperPixels(); check('actual PDF page navigation shows distinct same-file source pixels', second.id === first.id && second.sha256 !== first.sha256 && !second.approved);
  await page.screenshot({path: path.join(output, 'original-paper-page-2.png')});
  await page.fill('#paper-page', '1'); await page.press('#paper-page', 'Tab'); await page.waitForFunction(() => window.__einstein.paper.pdf?.pageNumber === 1);
  const returned = await paperPixels(); check('returning to page 1 preserves exact original pixels', returned.sha256 === first.sha256 && returned.id === first.id && !returned.approved);
  report.paper = {first, second, returned}; await page.click('#paper-remove');

  await page.setInputFiles('#video-file', fixtures.video); await page.waitForFunction(() => window.__einstein.video.manifest);
  const video = page.locator('#original-video'); await video.focus(); await video.press('Space');
  await page.waitForFunction(() => !document.querySelector('#original-video').paused && document.querySelector('#original-video').currentTime > .2);
  await video.press('Space'); await page.waitForFunction(() => document.querySelector('#original-video').paused);
  // Chromium's ArrowRight does not guarantee a five-second seek for a short clip.
  // Exercise the actual native timeline with a pointer action instead.
  const videoBox = await video.boundingBox();
  await video.click({position: {x: Math.round(videoBox.width * .85), y: videoBox.height - 22}});
  await page.waitForFunction(() => document.querySelector('#original-video').currentTime > 4);
  report.videoBeforeRewind = await page.evaluate(() => ({time: document.querySelector('#original-video').currentTime, paused: document.querySelector('#original-video').paused}));
  await page.click('#video-rewind'); await page.waitForFunction(() => !window.__einstein.video.busy);
  await page.selectOption('#video-speed', '0.5'); await page.waitForFunction(() => !window.__einstein.video.busy && document.querySelector('#original-video').playbackRate === .5);
  report.video = await page.evaluate(() => ({id: window.__einstein.video.manifest.id, time: document.querySelector('#original-video').currentTime, paused: document.querySelector('#original-video').paused, rate: document.querySelector('#original-video').playbackRate, approved: window.__einstein.video.approved}));
  check('actual video UI play pause seek rewind and speed work locally', report.video.id === report.fixtures.video.sha256 && report.video.paused && report.video.time < report.videoBeforeRewind.time - 4 && report.video.rate === .5 && !report.video.approved, report.video);
  await page.screenshot({path: path.join(output, 'original-video.png')}); await page.click('#video-remove');
  check('local media sent no POSTs and required no provider', report.requests.every(value => value.method !== 'POST') && report.providerPermits === 0 && report.websocketAttempts === 0);
  await checkpoint('local original media UI');

  await page.setViewportSize({width: 390, height: 844}); await pause(400);
  report.mobileDuringMedia = await read(); check('mobile media layout has no horizontal overflow', !report.mobileDuringMedia.overflow, report.mobileDuringMedia);
  await page.setInputFiles('#video-file', fixtures.video); await page.waitForFunction(() => window.__einstein.video.manifest);
  report.mobileVideo = await page.evaluate(() => { const video = document.querySelector('#original-video').getBoundingClientRect(), overlay = document.querySelector('#video-annotations').getBoundingClientRect(); return {video: {width: video.width, height: video.height}, overlay: {width: overlay.width, height: overlay.height}, overflow: document.documentElement.scrollWidth > innerWidth + 1}; });
  check('mobile video overlay remains aligned', !report.mobileVideo.overflow && Math.abs(report.mobileVideo.video.width - report.mobileVideo.overlay.width) < 1 && Math.abs(report.mobileVideo.video.height - report.mobileVideo.overlay.height) < 1, report.mobileVideo);
  await page.screenshot({path: path.join(output, 'mobile-video.png')}); await page.click('#video-remove'); await page.setViewportSize({width: 1440, height: 1000});

  const marker = path.basename(output); report.feedback = {state: 'NOT_SUBMITTED', marker, ownerReadback: 'pending'};
  await page.click('#feedback-toggle'); await page.waitForFunction(() => document.querySelector('#feedback-dialog').open && !document.querySelector('#feedback-form').hidden && !document.querySelector('#feedback-send').disabled);
  await page.selectOption('#feedback-form select[name="rating"]', '3'); await page.selectOption('#feedback-form select[name="realism"]', ''); await page.selectOption('#feedback-form select[name="voice"]', ''); await page.selectOption('#feedback-form select[name="kind"]', 'suggestion');
  await page.fill('#feedback-message', 'ENGINEERING TEST: ' + marker + '. Keyless public browser QA only. Rating 3 is a required-field fixture, not a human satisfaction, realism or voice-naturalness judgment.');
  await page.fill('#feedback-context', 'Synthetic/public fixtures. Zero provider permits or sessions. Please verify this exact request ID and fields through authenticated owner readback. No transcript, audio or document attached.');
  report.feedback.state = 'SUBMISSION_REQUESTED';
  const responsePromise = page.waitForResponse(value => new URL(value.url()).pathname === '/api/feedback' && value.request().method() === 'POST', {timeout: 15000});
  await page.click('#feedback-send'); const response = await responsePromise; const receipt = await response.json().catch(() => ({}));
  report.feedback = {...report.feedback, response: {status: response.status(), received: receipt.received, id: receipt.id, collection: receipt.collection}, submittedFields: report.feedbackRequestFields, expectedOwnerDigest: report.feedbackRequestFields ? sha256(JSON.stringify(report.feedbackRequestFields)) : null};
  check('exactly one genuine feedback request confirmed privately', response.ok() && receipt.received === true && receipt.collection === 'private-netlify-blobs' && report.feedbackPosts === 1 && receipt.id === report.feedbackRequestFields?.request_id && report.feedbackRequestFields.realism === null && report.feedbackRequestFields.voice === null);
  await page.waitForFunction(id => document.querySelector('#feedback-result').dataset.receipt === id, receipt.id);
  await page.screenshot({path: path.join(output, 'feedback-receipt.png')}); await page.getByRole('button', {name: 'Close feedback', exact: true}).click();
  report.feedback.state = 'BROWSER_CONFIRMED_OWNER_READBACK_PENDING';
  await checkpoint('one actual private feedback receipt; owner readback pending');

  // Media and feedback do not depend on completion of the large character GET.
  // Record that transfer's actual result after the independent UI checks.
  await page.waitForFunction(() => window.__einstein.stats.avatarReady, undefined, {timeout: Math.min(120000, Math.max(1, until - Date.now() - 95000))});
  report.actualAvatarReadyObservedMs = Date.now() - navigationStarted;
  const bindUntil = Date.now() + 5000;
  while (Date.now() < bindUntil && Object.keys(report.servedAssets).length < Object.keys(expectedAssets).length) await pause(100);
  for (const name of Object.keys(expectedAssets)) if (!report.servedAssets[name]) {
    const response = await page.request.get(origin + name, {timeout: Math.min(90000, Math.max(1, until - Date.now() - 5000)), maxRedirects: 0});
    check('ordinary browser asset GET succeeded', response.status() === 200, {path: name});
    const bytes = await response.body();
    report.servedAssets[name] = {bytes: bytes.length, sha256: sha256(bytes), measurement: 'same-cookie-browser-API-GET-after-page-body-unavailable'};
    report.requests.push({origin, path: name, method: 'GET', bodyBytes: 0, measurement: 'browser APIRequestContext'});
  }
  check('actual served GLB and Vite JS/CSS byte identity', Object.entries(expectedAssets).every(([name, expected]) => report.servedAssets[name]?.sha256 === expected.sha256 && report.servedAssets[name]?.bytes === expected.bytes));
  report.desktop = await read();
  check('actual textured 3D character rendered on desktop', report.desktop.avatarReady && report.desktop.texturedMeshes > 5 && report.desktop.renderCalls > 0 && report.desktop.triangles > 1000 && report.desktop.visibility === 'visible', report.desktop);
  await page.screenshot({path: path.join(output, 'desktop.png')});
  await page.setViewportSize({width: 390, height: 844}); await pause(400);
  report.mobile = await read(); check('mobile actual renderer and layout remain usable', report.mobile.avatarReady && report.mobile.renderCalls > 0 && !report.mobile.overflow, report.mobile);
  await page.screenshot({path: path.join(output, 'mobile.png')}); await page.setViewportSize({width: 1440, height: 1000});
  report.final = await read();
  check('all actions created zero provider permits or sessions', report.providerPermits === 0 && report.websocketAttempts === 0 && !report.final.nativeActive && !report.final.microphoneActive);
  check('no CSP violations or browser errors', report.csp.length === 0 && report.errors.length === 0, {errors: report.errors, csp: report.csp});
  check('public security headers are present', Boolean(report.securityHeaders?.csp?.includes("default-src 'self'")) && Boolean(report.securityHeaders?.hsts) && Boolean(report.securityHeaders?.permissionsPolicy));
  report.state = 'KEYLESS_BROWSER_PASSED_OWNER_READBACK_PENDING'; await checkpoint('real private feedback and clean keyless completion');
} catch (error) {
  report.state = 'FAILED_OR_INCOMPLETE'; report.failure = redact(error.message);
  if (page && !page.isClosed()) { report.failureState = await read().catch(() => null); await page.screenshot({path: path.join(output, 'failure.png')}).catch(() => {}); }
} finally {
  await browser?.close(); report.completedAt = new Date().toISOString(); report.elapsedSeconds = (Date.now() - Date.parse(report.startedAt)) / 1000;
  if (report.deadlineExceeded) { report.state = 'FAILED_OR_INCOMPLETE'; report.failure = 'Five-minute keyless run deadline exceeded.'; }
  await flush(); console.log(JSON.stringify({state: report.state, output, providerPermits: report.providerPermits, websocketAttempts: report.websocketAttempts, feedbackPosts: report.feedbackPosts, request_id: report.feedbackRequestFields?.request_id, expectedOwnerDigest: report.feedback?.expectedOwnerDigest, failure: report.failure}, null, 2));
  if (report.state !== 'KEYLESS_BROWSER_PASSED_OWNER_READBACK_PENDING') process.exitCode = 1;
}
