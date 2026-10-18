/** Actual built frontend/public CSP, isolated loopback server, no provider.
 * Requires built dist + authorized GLB, Chrome/Playwright and Python backend.
 * EINSTEIN_TEST_PDF is an explicit existing public-source PDF; no download.
 * Run from rehearsal: EINSTEIN_TEST_PYTHON=/python EINSTEIN_TEST_PDF=/paper.pdf
 * node tests/mobile-welcome.e2e.mjs. Evidence is reviewable, not a voice verdict.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const python = process.env.EINSTEIN_TEST_PYTHON || 'python3';
const pdf = process.env.EINSTEIN_TEST_PDF;
if (!pdf || !(await fs.stat(pdf).catch(() => null))?.isFile()) throw Error('Set EINSTEIN_TEST_PDF to an existing authorized public PDF. No browser started.');
const video = path.join(root, 'qa/public-acceptance/fixtures/original-synthetic.webm');
const deck = path.join(root, 'qa/public-acceptance/fixtures/steering-walkthrough.pptx');
const phase = process.env.EINSTEIN_LAYOUT_PHASE === 'before' ? 'before' : 'after';
const output = path.join(root, `evidence/${new Date().toISOString().slice(0, 10)}-mobile-welcome`, phase);
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'einstein-mobile-welcome-'));
await fs.mkdir(output, {recursive: true});
const report = {scope: 'Actual built local app, production CSP and textured character. Disclosed unavailable bridge; no provider, credentials, microphone, feedback or conversion request.',
  flow: 'Fresh welcome → separate readable hero and character → Closer/Full presence → local paper/video and deck chooser → clean close.',
  browser: 'Browser plugin not available; explicit isolated Playwright regression authorized.', phase, checks: [], errors: [], requests: [], websockets: [], viewports: []};
const check = (name, passed, details = {}) => report.checks.push({name, passed: Boolean(passed), ...details});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
report.distIndexSHA256 = hash(await fs.readFile(path.join(root, 'rehearsal/dist/index.html')));
report.pdfSHA256 = hash(await fs.readFile(pdf));
const server = path.join(temporary, 'server.py');
await fs.writeFile(server, `import ipaddress,json,socket,sys
from pathlib import Path
from types import SimpleNamespace
import uvicorn
from fastapi import HTTPException
from lab_backend.public_service import create_app
class UnavailableBridge:
    def __init__(self): self.active=False; self.config=SimpleNamespace(permits={})
    async def status(self,request): return {'available':False,'active':False,'reason':'Offline layout fixture: no provider.'}
    async def permit(self,request): raise HTTPException(503,'No provider in layout fixture')
    async def voice(self,socket): await socket.close(code=1008)
listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen(128)
origin='http://127.0.0.1:'+str(listener.getsockname()[1])
app=create_app(Path(sys.argv[1]),origin=origin,private_qa=True,bridge_factory=UnavailableBridge)
def guard(event,args):
    if event=='socket.connect' and isinstance(args[1],tuple):
        try: allowed=ipaddress.ip_address(args[1][0]).is_loopback
        except ValueError: allowed=False
        if not allowed: raise RuntimeError('Layout fixture refuses external connections')
sys.addaudithook(guard)
print(json.dumps({'origin':origin}),flush=True)
uvicorn.Server(uvicorn.Config(app,log_level='warning',access_log=False)).run(sockets=[listener])
`);
let service, browser, stdout = '', stderr = '';
try {
  service = spawn(python, [server, root], {cwd: root, env: {PATH: process.env.PATH, PYTHONPATH: root,
    EINSTEIN_USAGE_PATH: path.join(temporary, 'usage.sqlite3'), EINSTEIN_FEEDBACK_PATH: path.join(temporary, 'feedback.sqlite3')}, stdio: ['ignore', 'pipe', 'pipe']});
  service.stdout.on('data', value => { stdout += value; }); service.stderr.on('data', value => { stderr += value; });
  const deadline = Date.now() + 15000;
  while (!stdout.includes('\n')) { if (Date.now() > deadline || service.exitCode !== null) throw Error('Isolated fixture startup failed: ' + stderr); await new Promise(resolve => setTimeout(resolve, 40)); }
  const {origin} = JSON.parse(stdout.split('\n')[0]); report.origin = origin;
  while (true) { try { if ((await fetch(origin + '/api/health')).ok) break; } catch {} if (Date.now() > deadline) throw Error('Isolated server not ready'); await new Promise(resolve => setTimeout(resolve, 40)); }
  browser = await chromium.launch({channel: 'chrome', headless: true});
  for (const viewport of [{width: 390, height: 844}, {width: 320, height: 568}, {width: 1440, height: 1000}]) {
    const context = await browser.newContext({viewport, permissions: []});
    const page = await context.newPage();
    await page.route('**/*', route => { const url = new URL(route.request().url()); return url.origin === origin || ['data:', 'blob:'].includes(url.protocol) ? route.continue() : route.abort(); });
    page.on('pageerror', value => report.errors.push(value.message));
    page.on('console', value => { if (value.type() === 'error') report.errors.push(value.text()); });
    page.on('request', value => report.requests.push({method: value.method(), path: new URL(value.url()).pathname}));
    page.on('websocket', () => { report.websockets.push('unexpected WebSocket'); });
    const response = await page.goto(origin, {waitUntil: 'domcontentloaded'});
    await page.waitForFunction(() => window.__einstein?.stats.avatarReady && window.__einstein.stats.nativeStatus, undefined, {timeout: 60000});
    await page.waitForTimeout(150);
    const geometry = () => page.evaluate(() => {
      const a = window.__einstein, stage = a.stage;
      const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}; };
      const canvas = rect('#stage canvas'); const head = stage.head.getWorldPosition(stage.camera.position.clone()).project(stage.camera);
      return {hero:rect('#invitation'),stage:rect('#stage'),canvas,dock:rect('.conversation-dock'),
        head:{x:canvas.left+(head.x+1)*canvas.width/2,y:canvas.top+(1-head.y)*canvas.height/2},
        camera:stage.camera.position.toArray(), calls:stage.renderer.info.render.calls, triangles:stage.renderer.info.render.triangles,
        overflow:document.documentElement.scrollWidth>innerWidth+1 || document.body.scrollWidth>innerWidth+1};
    });
    const initial = await geometry(); const label = `${viewport.width}x${viewport.height}`;
    report.viewports.push({viewport,initial});
    check(label+' actual page identity and meaningful welcome', (await page.title()) === 'Einstein · Mobiliar Lab' && (await page.locator('#invitation').innerText()).includes('curiosity') && page.url() === origin+'/');
    check(label+' production CSP and actual character', response.headers()['content-security-policy'].includes("default-src 'self'") && initial.calls>0 && initial.triangles>1000);
    check(label+' no horizontal overflow', !initial.overflow);
    if (viewport.width<600) check(label+' hero and character viewport do not overlap', initial.hero.bottom<=initial.canvas.top+1);
    else check(label+' desktop stage and original camera preserved', initial.canvas.top===0 && initial.canvas.width===viewport.width && initial.canvas.height===viewport.height && Math.abs(initial.camera[2]-2.82)<.01);
    check(label+' actual head visible above controls', initial.head.x>0 && initial.head.x<viewport.width && initial.head.y>initial.canvas.top && initial.head.y<initial.dock.top);
    await page.screenshot({path:path.join(output,label+'.png')});
    await page.click('#portrait'); await page.waitForTimeout(100); const closer=await geometry();
    check(label+' real Closer control updates camera without covering hero', closer.camera[2]<initial.camera[2] && (viewport.width>=600 || closer.hero.bottom<=closer.canvas.top+1));
    await page.click('#fullbody'); await page.waitForTimeout(100);
    await page.click('#keyboard-toggle'); check(label+' question entry opens', await page.locator('#question-dialog').isVisible()); await page.getByRole('button',{name:'Close question entry'}).click();
    await page.setInputFiles('#paper-file',pdf); await page.waitForFunction(() => window.__einstein.paper.pdf?.pageNumber===1);
    const paper=await page.evaluate(() => ({id:window.__einstein.paper.pdf.manifest.id,approved:window.__einstein.paper.approved,top:document.querySelector('#stage').getBoundingClientRect().top}));
    check(label+' local original PDF keeps full media stage and no sharing', paper.id===report.pdfSHA256 && !paper.approved && paper.top===0); await page.click('#paper-remove');
    await page.setInputFiles('#video-file',video); await page.waitForFunction(() => window.__einstein.video.manifest);
    const media=await page.evaluate(() => { const v=document.querySelector('#original-video').getBoundingClientRect(),o=document.querySelector('#video-annotations').getBoundingClientRect(); return {top:document.querySelector('#stage').getBoundingClientRect().top,approved:window.__einstein.video.approved,aligned:Math.abs(v.width-o.width)<1 && Math.abs(v.height-o.height)<1}; });
    check(label+' video preserves original full media stage and overlay', media.top===0 && !media.approved && media.aligned); await page.click('#video-remove');
    await page.click('#presentation-open'); await page.setInputFiles('#presentation-file',deck); check(label+' deck chooser remains usable without upload', await page.locator('#presentation-upload').isVisible() && await page.locator('#presentation-convert').isEnabled()); await page.click('#presentation-cancel');
    await page.screenshot({path:path.join(output,label+'-restored.png')});
    const restored=await geometry(); check(label+' removing media restores separate welcome', !restored.overflow && (viewport.width>=600 || restored.hero.bottom<=restored.canvas.top+1));
    await context.close();
  }
  check('no provider, conversion, feedback or other POST request', report.requests.every(value=>value.method!=='POST') && report.websockets.length===0);
  check('no browser/CSP/framework errors',report.errors.length===0);
} catch(error) { report.failure=error.message; }
finally {
  await browser?.close(); if (service && service.exitCode===null) { service.kill('SIGTERM'); await new Promise(resolve=>service.once('exit',resolve)); }
  report.state=!report.failure && report.checks.every(value=>value.passed)?'PASSED':'FAILED';
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)); await fs.rm(temporary,{recursive:true,force:true});
  console.log(JSON.stringify({state:report.state,output,checks:report.checks.length,failed:report.checks.filter(value=>!value.passed).map(value=>value.name),failure:report.failure},null,2));
  if(report.state!=='PASSED')process.exitCode=1;
}
