/** Built frontend + real public_service/CSP. FakeBridge stops at permit;
 * original GLB/PDF/video and optional sandboxed PPTX conversion stay real.
 * Requirements: built dist/private GLB, ignored lab_backend/data/lab.json public
 * snapshot, ffmpeg, Chrome + installed Playwright, Python backend dependencies.
 * Optional: sandboxed LibreOffice converter. Set EINSTEIN_TEST_PYTHON as needed
 * and EINSTEIN_TEST_PDF to existing original 14-page TraceMonkey PDF bytes.
 * From rehearsal: EINSTEIN_TEST_PDF=/existing/tracemonkey.pdf node tests/public-browser.e2e.mjs
 * No source download, credentials, provider call or public deployment occurs. */
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const python = process.env.EINSTEIN_TEST_PYTHON || 'python3';
const originalPDF = process.env.EINSTEIN_TEST_PDF ? path.resolve(process.env.EINSTEIN_TEST_PDF) : path.join(root, '.work/fixtures/tracemonkey-original.pdf');
for (const [file, instruction] of [
  [originalPDF, 'Set EINSTEIN_TEST_PDF to an existing original 14-page TraceMonkey PDF, or place it at .work/fixtures/tracemonkey-original.pdf. The harness never downloads papers.'],
  [path.join(root, 'rehearsal/dist/index.html'), 'Build the frontend before running this regression.'],
  [path.join(root, 'rehearsal/dist/assets/einstein.glb'), 'Provide the authorized private character GLB in the built frontend assets.'],
  [path.join(root, 'lab_backend/data/lab.json'), 'Provide the existing ignored public lab snapshot at lab_backend/data/lab.json.'],
]) {
  try { await fs.access(file); } catch { throw new Error(instruction); }
}
const output = path.join(root, 'evidence/runtime/public-browser');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'einstein-public-browser-'));
await fs.mkdir(output, {recursive: true});
const fixture = path.join(temporary, 'server.py');
const video = path.join(temporary, 'controlled-original.webm');
const slides = path.join(temporary, 'controlled-original.pptx');
const report = {scope: 'Built frontend served by actual public_service.create_app(private_qa=True), production CSP, optimized textured GLB, original local paper/video. FakeBridge advertises availability but refuses the permit; no provider session, inference, vision, voice, microphone capture or public deployment is tested.', checks: [], errors: [], csp: [], warnings: [], expectedFixtureRefusals: [], requests: [], websockets: [], limits: []};
const check = (name, passed, details = {}) => { report.checks.push({name, passed: Boolean(passed), ...details}); assert(passed, name); };
const fingerprint = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex');
report.paper = {path: originalPDF, sha256: await fingerprint(originalPDF), selection: 'Existing TraceMonkey published-paper PDF fixture; actual local bytes, no source download in this run.'};
report.dist = {index_sha256: await fingerprint(path.join(root, 'rehearsal/dist/index.html')), avatar_bytes: (await fs.stat(path.join(root, 'rehearsal/dist/assets/einstein.glb'))).size};
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=10:duration=6', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '35', '-an', '-y', video]);
await fs.writeFile(fixture, `import hashlib,ipaddress,json,os,socket,sys,time
from pathlib import Path
from types import SimpleNamespace
import uvicorn
from fastapi import HTTPException
from lab_backend.public_service import create_app
from lab_backend.knowledge import Knowledge
from lab_backend.tests.test_presentation import fixture_deck
root=Path(sys.argv[1]); work=Path(sys.argv[2])
snapshot=root/'lab_backend/data/lab.json'
index=Knowledge.load(snapshot)
(work/'controlled-original.pptx').write_bytes(fixture_deck())
metrics={'permits':0,'provider_connections':0,'voice_calls':0,'blocked_external_connections':0,'posts':[], 'snapshot_pages':len(index.snapshot.get('pages',[])), 'snapshot_sha256':hashlib.sha256(snapshot.read_bytes()).hexdigest()}
class FakeBridge:
    def __init__(self): self.config=SimpleNamespace(permits={});self.active=False
    async def status(self,request): return {'available':True,'active':False,'model':'OFFLINE FIXTURE - no provider','provider_session_verified':False,'public_research':{'content_verified_this_process':False},'research':None,'reason':'Disclosed browser regression fixture; no provider credentials loaded.'}
    async def permit(self,request):
        metrics['permits']+=1
        raise HTTPException(503,'Offline browser fixture stopped at the permit. No provider connected.')
    async def voice(self,websocket):
        metrics['voice_calls']+=1
        await websocket.close(code=1008)
listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen(128)
origin='http://127.0.0.1:'+str(listener.getsockname()[1])
app=create_app(root,origin=origin,private_qa=True,bridge_factory=FakeBridge)
@app.middleware('http')
async def recorded(request,call_next):
    if request.method=='POST':metrics['posts'].append(request.url.path)
    return await call_next(request)
@app.get('/__fixture/status')
def status(): return metrics
app.router.routes.insert(0,app.router.routes.pop())
def guard(event,args):
    if event=='socket.connect' and isinstance(args[1],tuple):
        try:allowed=ipaddress.ip_address(args[1][0]).is_loopback
        except ValueError:allowed=False
        if not allowed:
            metrics['blocked_external_connections']+=1
            raise RuntimeError('Offline fixture forbids external connections')
sys.addaudithook(guard)
print(json.dumps({'origin':origin}),flush=True)
uvicorn.Server(uvicorn.Config(app,log_level='warning',access_log=False)).run(sockets=[listener])
`);
let service, browser, page;
let serverOutput = '', serverError = '';
try {
  service = spawn(python, [fixture, root, temporary], {cwd: root, env: {PATH: process.env.PATH, PYTHONPATH: root, EINSTEIN_USAGE_PATH: path.join(temporary, 'usage.sqlite3'), EINSTEIN_FEEDBACK_PATH: path.join(temporary, 'feedback.sqlite3')}, stdio: ['ignore', 'pipe', 'pipe']});
  service.stdout.on('data', chunk => { serverOutput += chunk; }); service.stderr.on('data', chunk => { serverError += chunk; });
  const deadline = Date.now() + 15000;
  while (!serverOutput.includes('\n')) { if (Date.now() > deadline || service.exitCode !== null) throw new Error('Public fixture failed to start: ' + serverError); await new Promise(resolve => setTimeout(resolve, 30)); }
  const {origin} = JSON.parse(serverOutput.split('\n')[0]); report.origin = origin;
  while (true) { try { if ((await fetch(origin + '/api/health')).ok) break; } catch {} if (Date.now() > deadline) throw new Error('Public fixture did not become ready'); await new Promise(resolve => setTimeout(resolve, 40)); }
  browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required']});
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
  await context.addInitScript(() => {
    window.__offline = {microphoneCalls: 0, websocketCalls: 0, csp: []};
    const WebSocketType = window.WebSocket;
    window.WebSocket = new Proxy(WebSocketType, {construct(target, args) { window.__offline.websocketCalls++; return Reflect.construct(target, args); }});
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { window.__offline.microphoneCalls++; throw new Error('Offline fixture forbids microphone capture'); };
    document.addEventListener('securitypolicyviolation', event => window.__offline.csp.push({directive: event.violatedDirective, blocked: event.blockedURI}));
  });
  page = await context.newPage();
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin && !['blob:', 'data:'].includes(url.protocol)) { report.errors.push('Unexpected non-local browser request: ' + url.origin); return route.abort(); }
    return route.continue();
  });
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => {
    const entry = {text: message.text(), url: message.location().url};
    if (message.type() === 'error' && /\/api\/(native\/permit|presentation\/convert)$/.test(entry.url) && entry.text.includes('503')) report.expectedFixtureRefusals.push(entry);
    else if (message.type() === 'error') report.errors.push(entry);
    else if (message.type() === 'warning') report.warnings.push(entry);
  });
  page.on('request', request => report.requests.push({method: request.method(), url: request.url().split('?')[0]}));
  page.on('websocket', socket => report.websockets.push(socket.url()));
  const initial = await page.goto(origin + '/', {waitUntil: 'networkidle', timeout: 90000});
  report.cspHeader = initial.headers()['content-security-policy'];
  check('production_csp_is_served', report.cspHeader.includes("script-src 'self' 'wasm-unsafe-eval'") && report.cspHeader.includes("object-src 'none'"));
  await page.waitForFunction(() => window.__einstein?.stats.avatarReady && window.__einstein.stats.nativeStatus?.public_deployment, {}, {timeout: 90000});
  report.character = await page.evaluate(() => {
    const stage = window.__einstein.stage; let meshes = 0, textured = 0; const maps = [];
    stage.model.traverse(object => { if (!object.isMesh) return; meshes++; for (const material of Array.isArray(object.material) ? object.material : [object.material]) { if (material.map?.image?.width > 1 && material.map.image.height > 1) { textured++; maps.push({material: material.name, width: material.map.image.width, height: material.map.image.height}); } } });
    return {ready: stage.ready, meshes, textured, maps, drawCalls: stage.renderer.info.render.calls, triangles: stage.renderer.info.render.triangles};
  });
  check('actual_optimized_textured_character_rendered', report.character.ready && report.character.textured > 5 && report.character.drawCalls > 0 && report.character.triangles > 1000, report.character);
  check('desktop_has_no_horizontal_overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({path: path.join(output, 'desktop.png')});
  await page.locator('#microphone').click();
  await page.getByRole('button', {name: 'Not now', exact: true}).click();
  await page.waitForFunction(() => !window.__einstein.native.connecting);
  report.afterDecline = await (await fetch(origin + '/__fixture/status')).json();
  const declined = await page.evaluate(() => ({...window.__offline, active: window.__einstein.stats.microphoneActive}));
  check('declining_processing_starts_no_post_websocket_or_microphone', report.afterDecline.posts.length === 0 && report.afterDecline.permits === 0 && declined.websocketCalls === 0 && declined.microphoneCalls === 0 && !declined.active);
  await page.locator('#microphone').click();
  const permit = page.waitForResponse(response => response.url() === origin + '/api/native/permit');
  await page.getByRole('button', {name: 'Agree and begin', exact: true}).click();
  check('approval_reaches_only_disclosed_stub_permit', (await permit).status() === 503);
  await page.waitForFunction(() => !window.__einstein.native.connecting);
  report.afterApproval = await (await fetch(origin + '/__fixture/status')).json();
  const approved = await page.evaluate(() => window.__offline);
  check('stub_never_connects_provider_or_microphone', report.afterApproval.permits === 1 && report.afterApproval.posts.length === 1 && report.afterApproval.provider_connections === 0 && report.afterApproval.voice_calls === 0 && approved.websocketCalls === 0 && approved.microphoneCalls === 0 && report.websockets.length === 0);
  await page.locator('#paper-file').setInputFiles(originalPDF);
  await page.waitForFunction(() => window.__einstein.paper.pdf?.pageNumber === 1 && window.__einstein.paper.base.width > 100, {}, {timeout: 30000});
  check('pdfjs_renders_actual_original_published_paper', await page.evaluate(() => window.__einstein.paper.pdf.manifest.pages === 14 && window.__einstein.paper.pdf.text.includes('Trace-based')));
  await page.locator('#paper-next').click();
  await page.waitForFunction(() => window.__einstein.paper.pdf?.pageNumber === 2);
  report.paper.page = 2;
  report.paper.pixels = await page.evaluate(async () => {
    const viewer = window.__einstein.paper;
    const fingerprint = async canvas => { const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; return [...new Uint8Array(await crypto.subtle.digest('SHA-256', pixels))].map(value => value.toString(16).padStart(2, '0')).join(''); };
    const before = await fingerprint(viewer.pdf.canvas);
    viewer.marks.set(2, [{kind: 'box', region: [.12, .20, .34, .25], label: 'Offline renderer regression overlay'}]); viewer.paint();
    const after = await fingerprint(viewer.pdf.canvas), pixels = viewer.overlay.getContext('2d').getImageData(0, 0, viewer.overlay.width, viewer.overlay.height).data;
    return {before, after, overlayPixels: pixels.filter((value, index) => index % 4 === 3 && value > 0).length};
  });
  check('original_pdf_pixels_are_unchanged_by_real_overlay', report.paper.pixels.before === report.paper.pixels.after && report.paper.pixels.overlayPixels > 500);
  await page.screenshot({path: path.join(output, 'original-paper-overlay.png')});
  await page.locator('#paper-remove').click();
  await page.locator('#video-file').setInputFiles(video);
  await page.waitForFunction(() => window.__einstein.video.manifest);
  report.video = await page.evaluate(async () => { const viewer = window.__einstein.video; await viewer.command({kind: 'play'}); const playing = !viewer.video.paused; await viewer.command({kind: 'seek', seconds: 4}); await viewer.command({kind: 'rewind', seconds: 2}); await viewer.command({kind: 'rate', rate: .5}); const frame = await viewer.snapshot(); return {playing, time: viewer.video.currentTime, paused: viewer.video.paused, rate: viewer.video.playbackRate, imageBytes: frame.data.length, selected: viewer.app.stats.video.selected, approved: viewer.approved}; });
  check('real_local_video_play_seek_rewind_rate_and_snapshot_work', report.video.playing && report.video.paused && Math.abs(report.video.time - 2) < .01 && report.video.rate === .5 && report.video.imageBytes > 1000 && !report.video.approved);
  await page.locator('#video-remove').click();
  await page.locator('#presentation-open').click();
  check('pptx_upload_and_rendering_limits_are_disclosed', (await page.locator('#presentation-upload').textContent()).includes('uploads this deck') && (await page.locator('#presentation-upload').textContent()).includes('fonts'));
  await page.locator('#presentation-file').setInputFiles(slides);
  const converted = page.waitForResponse(response => response.url() === origin + '/api/presentation/convert', {timeout: 60000});
  await page.locator('#presentation-convert').click();
  report.presentation = {status: (await converted).status()};
  if (report.presentation.status === 200) {
    await page.waitForFunction(() => window.__einstein.stats.document.sourceKind === 'converted-pptx', {}, {timeout: 30000});
    report.presentation.provenance = await page.evaluate(() => { const viewer = window.__einstein.paper; return {kicker: viewer.panel.querySelector('.paper-kicker').textContent, format: viewer.pdf.manifest.source_format, scope: viewer.pdf.manifest.scope, pages: viewer.pdf.manifest.pages, text: viewer.pdf.text.slice(0, 300), privacy: viewer.privacy.textContent}; });
    check('pptx_ui_preserves_conversion_provenance', report.presentation.provenance.kicker.includes('CONVERTED PDF') && report.presentation.provenance.format === 'converted-pptx' && report.presentation.provenance.scope.includes('fonts') && report.presentation.provenance.privacy.includes('temporary server conversion'));
    await page.locator('#paper-remove').click();
  } else {
    await page.waitForFunction(() => document.querySelector('#presentation-status').textContent.includes('unavailable'));
    check('unavailable_converter_is_disclosed_without_fabricated_slides', await page.evaluate(() => !window.__einstein.paper.pdf && document.querySelector('#presentation-status').textContent.includes('Export')));
    report.limits.push('Sandboxed PPTX conversion unavailable on this host; successful converted-slide provenance not established by this run.');
    await page.locator('#presentation-cancel').click();
  }
  await page.setViewportSize({width: 390, height: 844}); await page.waitForTimeout(150);
  check('mobile_has_no_horizontal_overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({path: path.join(output, 'mobile.png')});
  await page.locator('#video-file').setInputFiles(video); await page.waitForFunction(() => window.__einstein.video.manifest);
  check('mobile_video_overlay_stays_aligned', await page.evaluate(() => { const viewer = window.__einstein.video, source = viewer.video.getBoundingClientRect(), overlay = viewer.overlay.getBoundingClientRect(); return document.documentElement.scrollWidth <= innerWidth + 1 && Math.abs(source.width - overlay.width) < 1 && Math.abs(source.height - overlay.height) < 1; }));
  check('new_fixture_notice_is_visible_before_mobile_close_regression', await page.locator('#error').isVisible());
  await page.locator('#video-remove').click({timeout: 5000});
  check('notice_does_not_intercept_actual_mobile_workspace_close', await page.evaluate(() => !window.__einstein.video.manifest));
  await page.locator('#error-dismiss').click();
  check('real_dismiss_button_hides_notice_without_another_permit', !await page.locator('#error').isVisible() && (await (await fetch(origin + '/__fixture/status')).json()).permits === 1);
  report.csp = await page.evaluate(() => window.__offline.csp);
  check('no_csp_violations_or_unexpected_browser_errors', report.csp.length === 0 && report.errors.length === 0, {csp: report.csp, errors: report.errors});
  check('built_frontend_remained_stable', report.dist.index_sha256 === await fingerprint(path.join(root, 'rehearsal/dist/index.html')));
  report.finalMetrics = await (await fetch(origin + '/__fixture/status')).json();
  check('server_attempted_no_external_connection', report.finalMetrics.blocked_external_connections === 0);
} catch (error) {
  report.failure = error.stack;
  if (page) { report.state = await page.evaluate(() => ({stats: window.__einstein?.stats, error: document.querySelector('#error')?.textContent, paper: document.querySelector('#paper-status')?.textContent, presentation: document.querySelector('#presentation-status')?.textContent, offline: window.__offline})).catch(() => null); report.csp = report.state?.offline?.csp || []; await page.screenshot({path: path.join(output, 'failure.png')}).catch(() => {}); }
} finally {
  await browser?.close();
  if (service && service.exitCode === null) { service.kill('SIGTERM'); await new Promise(resolve => { const timer = setTimeout(() => { service.kill('SIGKILL'); resolve(); }, 5000); service.once('exit', () => { clearTimeout(timer); resolve(); }); }); }
  report.serverErrors = serverError;
  report.completedAt = new Date().toISOString();
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await fs.rm(temporary, {recursive: true, force: true});
}
console.log(JSON.stringify({evidence: path.join(output, 'report.json'), passed: report.checks.filter(value => value.passed).length, checks: report.checks, errors: report.errors, csp: report.csp, limits: report.limits, failure: report.failure}, null, 2));
if (report.failure || report.checks.some(value => !value.passed)) process.exitCode = 1;
