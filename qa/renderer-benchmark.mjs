// Manual, zero-inference comparison of real original-character rendering and UI.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn, execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {sha256} from './public-acceptance/helpers.mjs';
import {assertRendererIdentity, rendererLaunchOptions} from './renderer-backend.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const baselineSHA = 'ab1327dc377216358d0ccfabab2593d28c8283cd';
const gates = {cdpP95Ms: 1000, navigationMs: 8000, keyboardMs: 8000,
  deliveredMedianMs: 100, deliveredP95Ms: 250, slowBaselineImprovement: .75};
const rendererBackend = process.env.EINSTEIN_RENDER_BACKEND || 'standard';
if (!process.argv.includes('--run')) {
  console.log(JSON.stringify({state: 'PREPARED_NOT_RUN', providerSessions: 0, maxSeconds: 190,
    baseline: baselineSHA, flow: 'Original character → actual keyboard controls → selected authored PDF pages 1→2→1',
    rendererBackend, gates}));
  process.exit(0);
}
if (!process.env.EINSTEIN_RENDER_BASELINE) throw Error('Provide a separate built baseline root.');
const roots = {baseline: path.resolve(process.env.EINSTEIN_RENDER_BASELINE), candidate: repo};
if (roots.baseline === path.resolve(repo)) throw Error('Provide a separate built baseline root.');
const candidateSHA = process.env.EINSTEIN_RENDER_CANDIDATE_SHA;
if (!/^[a-f0-9]{40}$/.test(candidateSHA || '')) throw Error('Provide the exact candidate source SHA.');
const output = path.resolve(process.env.EINSTEIN_RENDER_OUTPUT || path.join(repo, '.work/renderer-benchmark'));
const fixture = path.join(repo, 'evidence/2026-10-17-openai/public-two-slide-fffc256b.pdf');
const fixtureSHA = '48d4fb9ccc9d4d32fe4d201561a1a052fa438bc610878f17e4d9f07014a71e36';
if (sha256(await fs.readFile(fixture)) !== fixtureSHA) throw Error('Authored PDF fixture differs from its pin.');
const pins = JSON.parse(await fs.readFile(path.join(repo, 'deploy/release-inputs.json')));
const asset = pins.assets.find(value => value.name === 'einstein.glb');
const lock = sha256(await fs.readFile(path.join(repo, 'rehearsal/package-lock.json')));
for (const root of Object.values(roots)) {
  if (sha256(await fs.readFile(path.join(root, 'rehearsal/package-lock.json'))) !== lock) throw Error('The comparison requires identical locked frontend dependencies.');
  const glb = await fs.readFile(path.join(root, 'rehearsal/dist/assets/einstein.glb'));
  if (glb.length !== asset.bytes || sha256(glb) !== asset.sha256) throw Error('The comparison requires the exact original character in both builds.');
}
await fs.mkdir(output, {recursive: true});
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'einstein-renderer-'));
const server = path.join(temporary, 'server.py');
await fs.writeFile(server, `import ipaddress,json,socket,sys
from pathlib import Path
from types import SimpleNamespace
import uvicorn
from fastapi import HTTPException
from fastapi.responses import JSONResponse
from lab_backend.public_service import create_app
class UnavailableBridge:
    def __init__(self): self.active=False; self.config=SimpleNamespace(permits={})
    async def status(self,request): return {'available':False,'active':False,'reason':'Isolated renderer benchmark; no provider.'}
    async def permit(self,request): raise HTTPException(503,'No provider in renderer benchmark')
    async def voice(self,socket): await socket.close(code=1008)
listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen(128)
origin='http://127.0.0.1:'+str(listener.getsockname()[1])
app=create_app(Path(sys.argv[1]),origin=origin,private_qa=True,bridge_factory=UnavailableBridge)
@app.middleware('http')
async def read_only(request,call_next):
    if request.method not in {'GET','HEAD'}: return JSONResponse({'detail':'Read-only renderer benchmark'},status_code=405)
    return await call_next(request)
def guard(event,args):
    if event=='socket.connect' and isinstance(args[1],tuple):
        try: allowed=ipaddress.ip_address(args[1][0]).is_loopback
        except ValueError: allowed=False
        if not allowed: raise RuntimeError('Renderer benchmark refuses external sockets')
sys.addaudithook(guard)
print(json.dumps({'origin':origin}),flush=True)
uvicorn.Server(uvicorn.Config(app,log_level='warning',access_log=False)).run(sockets=[listener])
`);
const {chromium} = await import('../rehearsal/node_modules/@playwright/test/index.mjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function summary(values = []) {
  if (!values.length) return {count: 0};
  const sorted = [...values].sort((a, b) => a - b);
  return {count: values.length, median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1)};
}
const report = {state: 'RUNNING', scope: 'Local real public-service/CSP, unavailable provider bridge, original GLB and authored two-page PDF. No speech, model, provider or public-deployment acceptance.',
  rendererBackend,
  startedAt: new Date().toISOString(), fixtureSHA, character: {bytes: asset.bytes, sha256: asset.sha256}, packageLockSHA: lock,
  candidateSourceWorktreeDirty: Boolean(execFileSync('git', ['status', '--porcelain', '--', 'rehearsal/src'], {cwd: repo, encoding: 'utf8'}).trim()),
  host: {platform: process.platform, arch: process.arch, cpus: os.availableParallelism(), node: process.version},
  gates, versions: {}};
const started = Date.now();
try {
  for (const [label, root] of Object.entries(roots)) {
    const result = report.versions[label] = {sourceCommit: label === 'baseline' ? baselineSHA : candidateSHA,
      sceneSHA: sha256(await fs.readFile(path.join(root, 'rehearsal/src/scene.js'))),
      distIndexSHA: sha256(await fs.readFile(path.join(root, 'rehearsal/dist/index.html'))),
      errors: [], forbiddenRequests: [], websocketAttempts: 0, navigation: [], cdpMs: []};
    let service, browser, page, stdout = '';
    const captureMeasurement = async phase => {
      const measurement = await page.evaluate(() => {
        const a = window.__einstein;
        if (!a?.stage) return {visibility: document.visibilityState, appReady: false};
        const r = a.stage.renderer, c = r.domElement;
        let meshes = 0, texturedMeshes = 0, morphTargets = 0;
        a.stage.model?.traverse(n => { if (n.isMesh) { meshes++; morphTargets += n.morphTargetInfluences?.length || 0; if ((Array.isArray(n.material) ? n.material : [n.material]).some(m => m.map)) texturedMeshes++; } });
        return {...window.__rendererBenchmark, buffer: {width: c.width, height: c.height}, css: {width: c.clientWidth, height: c.clientHeight},
          ratio: r.getPixelRatio(), shadows: r.shadowMap.enabled, environmentLighting: Boolean(a.stage.scene.environment), profile: a.stats.frame, calls: r.info.render.calls, triangles: r.info.render.triangles,
          visibility: document.visibilityState, ready: a.stage.ready, xr: r.xr.isPresenting,
          quality: a.stage.quality ? {reduced: a.stage.quality.reduced, window: a.stage.quality.window || null, slowFrames: a.stage.quality.slowFrames, slowMs: a.stage.quality.slowMs} : null,
          meshes, texturedMeshes, morphTargets, nativeActive: a.native.active, microphoneActive: Boolean(a.stats.microphoneActive)};
      });
      result.measurement = measurement; result.measurementPhase = phase;
    };
    const deadline = Date.now() + 90000;
    const measured = async () => {
      service = spawn(process.env.EINSTEIN_TEST_PYTHON || 'python3', [server, root], {cwd: root,
        env: {PATH: process.env.PATH, PYTHONPATH: root, EINSTEIN_USAGE_PATH: path.join(temporary, label + '-usage.sqlite3'), EINSTEIN_FEEDBACK_PATH: path.join(temporary, label + '-feedback.sqlite3')}, stdio: ['ignore', 'pipe', 'ignore']});
      service.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-4096); });
      const readyUntil = Date.now() + 15000;
      while (!stdout.includes('\n')) { if (Date.now() > readyUntil || service.exitCode !== null) throw Error('Isolated service failed to become ready.'); await pause(30); }
      const {origin} = JSON.parse(stdout.split('\n')[0]);
      const launch = rendererLaunchOptions(rendererBackend);
      result.launch = {headless: launch.headless, args: launch.args, display: launch.env.DISPLAY || null,
        mesa: launch.env.GALLIUM_DRIVER || null, software: launch.env.LIBGL_ALWAYS_SOFTWARE || null, xAuthorityForwarded: Boolean(launch.env.XAUTHORITY)};
      browser = await chromium.launch(launch);
      result.browser = browser.version();
      const context = await browser.newContext({viewport: {width: 1440, height: 1000}, permissions: []});
      await context.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if ((url.origin !== origin && !['blob:', 'data:'].includes(url.protocol)) || !['GET', 'HEAD'].includes(request.method())) {
          result.forbiddenRequests.push({method: request.method(), path: url.pathname}); return route.abort();
        }
        return route.continue();
      });
      page = await context.newPage(); page.setDefaultTimeout(15000);
      page.on('pageerror', error => result.errors.push(error.message));
      page.on('websocket', () => { result.websocketAttempts++; void browser.close(); });
      const response = await page.goto(origin, {waitUntil: 'domcontentloaded'});
      if (!response.headers()['content-security-policy']?.includes("default-src 'self'")) throw Error('Actual public-service CSP missing.');
      await page.waitForFunction(() => window.__einstein?.stats.avatarReady && window.__einstein.stats.nativeStatus, undefined, {timeout: 60000});
      result.webgl = await page.evaluate(() => {
        const stage = window.__einstein.stage, gl = stage.renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
        const m = window.__rendererBenchmark = {raf: [], submissions: [], deliveredIntervals: [], qualitySamples: [], gl: {vendor: gl.getParameter(debug ? debug.UNMASKED_VENDOR_WEBGL : gl.VENDOR), renderer: gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER)}};
        let last, lastDelivered, lastStageFrame;
        const tick = time => { if (last != null) { m.raf.push(time - last); if (m.raf.length > 300) m.raf.shift(); } last = time; requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
        const render = stage.renderer.render.bind(stage.renderer);
        stage.renderer.render = (...args) => {
          const began = performance.now();
          try { return render(...args); }
          finally {
            const delivered = performance.now();
            m.submissions.push(delivered - began); if (m.submissions.length > 300) m.submissions.shift();
            if (lastDelivered != null) { m.deliveredIntervals.push(delivered - lastDelivered); if (m.deliveredIntervals.length > 300) m.deliveredIntervals.shift(); }
            lastDelivered = delivered;
            m.qualitySamples.push({frameMs: lastStageFrame == null ? null : stage.renderedAt - lastStageFrame,
              visibility: document.visibilityState, ready: stage.ready, xr: stage.renderer.xr.isPresenting,
              reduced: stage.quality?.reduced ?? null, slowFrames: stage.quality?.slowFrames ?? null, slowMs: stage.quality?.slowMs ?? null,
              window: stage.quality?.window ? [...stage.quality.window] : null});
            lastStageFrame = stage.renderedAt;
            if (m.qualitySamples.length > 12) m.qualitySamples.shift();
          }
        };
        return m.gl;
      });
      assertRendererIdentity(rendererBackend, result.webgl);
      result.backendMatched = true;
      await pause(12000);
      await captureMeasurement('pre-controls');
      const {buffer, css, ratio, shadows, environmentLighting, profile, quality, visibility, ready, xr} = result.measurement;
      result.initialRender = {buffer, css, ratio, shadows, environmentLighting, profile, quality, visibility, ready, xr};
      const cdp = await context.newCDPSession(page);
      for (let i = 0; i < 8; i++) { const began = performance.now(); await cdp.send('Runtime.evaluate', {expression: 'performance.now()', returnByValue: true}); result.cdpMs.push(performance.now() - began); }
      const keyboardStarted = performance.now();
      await page.click('#keyboard-toggle'); await page.fill('#question', 'Renderer benchmark only; this question is never submitted.');
      await page.getByRole('button', {name: 'Close question entry', exact: true}).click();
      result.keyboardMs = performance.now() - keyboardStarted;
      for (const number of [1, 2, 1]) {
        const began = performance.now();
        if (!result.navigation.length) await page.setInputFiles('#paper-file', fixture);
        else await page.click(number === 2 ? '#paper-next' : '#paper-previous');
        await page.waitForFunction(number => { const a = window.__einstein; return a.paper.pdf?.pageNumber === number && !a.paper.share.disabled && document.querySelector('#paper-status').textContent.startsWith('Original page ready.'); }, number);
        const navigationMs = performance.now() - began;
        const snapshot = await page.evaluate(() => {
          const p = window.__einstein.paper, began = performance.now(), value = p.pdf.snapshot();
          return {snapshotMs: performance.now() - began, id: p.pdf.manifest.id, pages: p.pdf.manifest.pages, page: p.pdf.pageNumber,
            source: {width: p.pdf.canvas.width, height: p.pdf.canvas.height}, jpeg: {width: value.image.width, height: value.image.height, base64Bytes: value.image.data.length}, approved: p.approved};
        });
        result.navigation.push({navigationMs, ...snapshot});
        if (snapshot.id !== fixtureSHA || snapshot.pages !== 2 || snapshot.page !== number || snapshot.approved || snapshot.source.width !== 1500 || snapshot.source.height !== 844) throw Error('Actual local PDF identity, page, dimensions or unshared state changed.');
      }
      await captureMeasurement('completed-controls');
      await page.screenshot({path: path.join(output, label + '.png')});
      result.completed = true;
    };
    let timeout;
    try { await Promise.race([measured(), new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Version exceeded ninety-second limit.')), 90000); })]); }
    catch (error) {
      result.failure = error.message;
      const remaining = Math.min(3000, deadline - Date.now() - 500);
      if (page && !page.isClosed() && remaining > 0) {
        let captureTimeout;
        try { await Promise.race([captureMeasurement('failure'), new Promise((_, reject) => { captureTimeout = setTimeout(() => reject(Error('Partial capture deadline.')), remaining); })]); }
        catch { result.measurementCaptureFailure = 'bounded final capture unavailable; retain last successful sample'; }
        finally { clearTimeout(captureTimeout); }
      }
    }
    finally {
      clearTimeout(timeout); await browser?.close().catch(() => {});
      if (service && service.exitCode === null) { service.kill('SIGTERM'); await Promise.race([new Promise(resolve => service.once('exit', resolve)), pause(2000)]); if (service.exitCode === null) service.kill('SIGKILL'); }
    }
    result.cdp = summary(result.cdpMs);
    if (result.measurement) {
      result.raf = summary(result.measurement.raf); result.submissions = summary(result.measurement.submissions);
      result.delivered = summary(result.measurement.deliveredIntervals);
    }
  }
  const b = report.versions.baseline, c = report.versions.candidate;
  report.checks = {
    requestedBackendInitialized: Object.values(report.versions).every(r => r.backendMatched === true),
    zeroProviderAndExternalWrites: Object.values(report.versions).every(r => !r.forbiddenRequests.length && !r.websocketAttempts),
    candidateActualOriginalScene: c.measurement?.texturedMeshes === 24 && c.measurement?.morphTargets > 0 && !c.measurement?.nativeActive && !c.measurement?.microphoneActive,
    candidateCompletedWithoutErrors: c.completed === true && !c.errors.length,
    candidateCdp: c.cdp.p95 <= report.gates.cdpP95Ms,
    candidateNavigation: c.navigation.length === 3 && c.navigation.every(n => n.navigationMs <= report.gates.navigationMs),
    candidateKeyboard: c.keyboardMs <= report.gates.keyboardMs,
    candidateDeliveredCadence: c.delivered?.median <= report.gates.deliveredMedianMs && c.delivered?.p95 <= report.gates.deliveredP95Ms,
    slowBaselineCdpImproved: b.cdp.p95 <= 500 || c.cdp.p95 <= b.cdp.p95 * report.gates.slowBaselineImprovement,
    slowBaselineCadenceImproved: b.delivered?.median <= report.gates.deliveredMedianMs || c.delivered?.median <= b.delivered?.median * report.gates.slowBaselineImprovement,
  };
  report.state = Object.values(report.checks).every(Boolean) ? 'RENDERER_BENCHMARK_PASSED' : 'FAILED_OR_INCOMPLETE';
} finally {
  report.completedAt = new Date().toISOString(); report.elapsedSeconds = (Date.now() - started) / 1000;
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await fs.rm(temporary, {recursive: true, force: true});
}
console.log(JSON.stringify({state: report.state, output, checks: report.checks, elapsedSeconds: report.elapsedSeconds}));
if (report.state !== 'RENDERER_BENCHMARK_PASSED') process.exitCode = 1;
