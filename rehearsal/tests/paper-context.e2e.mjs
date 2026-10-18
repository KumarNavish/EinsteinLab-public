import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';

// Local Vite fixture only: no app server, microphone, provider or real session.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const origin = 'http://127.0.0.1:5193';
const pdf = process.env.EINSTEIN_CONTEXT_PDF || path.resolve(root, '../EinsteinLab/.work/c18-documents/tracemonkey-original.pdf');
const out = process.env.EINSTEIN_CONTEXT_PROOF_OUT || `/tmp/einstein-context-${Date.now()}`;
await fs.mkdir(out, {recursive: false});
const report = {scope: 'Original local PDF and actual PaperWorkspace in isolated Chrome. Transport is a recorder; no inference/backend/session execution.', checks: [], requests: [], blocked: [], blockedDevelopmentWebSockets: 0, errors: [], sourceHashes: {}};
for (const file of ['rehearsal/src/paper-workspace.js', 'rehearsal/src/paper-workspace.css']) {
  report.sourceHashes[file] = createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex');
}
const check = (name, condition, detail = {}) => {report.checks.push({name, passed: !!condition, ...detail}); assert(condition, name);};
const fixture = `<!doctype html><html lang="en"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/style.css"><div id="app"><main id="experience"><div id="stage"></div><div id="material-actions"></div></main></div><script type="module">
import {PaperWorkspace} from '/src/paper-workspace.js';
const packets=[];window.contextPackets=packets;window.globalEscapes=0;window.addEventListener('keydown',event=>{if(event.key==='Escape')window.globalEscapes++;});
const native={active:false,serial:1,documentViewRevision:0,sharedDocument:null,
offerDocument(document){packets.push({type:'document_offer',document});this.sharedDocument={id:document.id,pages:document.pages};this.documentViewRevision=0;},
selectDocumentView(view){packets.push({type:'document_view',view:{...view,view_revision:++this.documentViewRevision}});return true;},
cancelTeaching(){packets.push({type:'local_cancel'});},resetPlayback(){},
revokeDocument(){packets.push({type:'document_revoke'});this.sharedDocument=null;},
start(){throw new Error('No real conversation may start in this fixture.');},sendText(){throw new Error('No inference request may be sent in this fixture.');}};
const app={native,stats:{nativeStatus:{available:true,provider:'OpenAI'},document:{}},stage:{}};
const paper=new PaperWorkspace(app);paper.pointAt=()=>{};window.contextFixture={paper,app};
</script></html>`;
const browser = await chromium.launch({channel: 'chrome', headless: true});
const context = await browser.newContext({viewport: {width: 1280, height: 900}}), page = await context.newPage();
await context.routeWebSocket('**/*', socket => {
  const url = new URL(socket.url());
  if (url.origin === origin.replace('http:', 'ws:') && url.pathname === '/') report.blockedDevelopmentWebSockets++;
  else report.blocked.push({kind: 'websocket', origin: url.origin, path: url.pathname});
  socket.close();
});
await context.route('**/*', route => {
  const request = route.request(), url = new URL(request.url());
  if (url.origin !== origin || url.pathname.startsWith('/api/')) {report.blocked.push({kind: 'network', origin: url.origin, path: url.pathname}); return route.abort();}
  report.requests.push({method: request.method(), path: url.pathname});
  if (url.pathname === '/context-fixture') return route.fulfill({contentType: 'text/html', body: fixture});
  return route.continue();
});
page.on('pageerror', error => report.errors.push(error.message));
const contextState = () => page.evaluate(() => window.contextFixture.paper.queryContext());
const baseHash = () => page.evaluate(async () => {
  const canvas = window.contextFixture.paper.base, pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', pixels))].map(value => value.toString(16).padStart(2, '0')).join('');
});
try {
  await page.goto(origin + '/context-fixture');
  await page.waitForFunction(() => window.contextFixture?.paper);
  await page.setInputFiles('#paper-file', pdf);
  await page.waitForFunction(() => window.contextFixture.paper.queryContext()?.page === 1);
  await page.fill('#paper-page', '2'); await page.press('#paper-page', 'Enter');
  await page.waitForFunction(() => window.contextFixture.paper.queryContext()?.page === 2);
  check('Opening and turning to the exact original p2 stays local', (await contextState()).approved === false && await page.evaluate(() => window.contextPackets.length === 0));
  const pixelsBefore = await baseHash();
  await page.click('#paper-context'); await page.click('#paper-keep-local');
  check('Declining source consent sends nothing', !(await contextState()).approved && await page.evaluate(() => window.contextPackets.length === 0));
  await page.click('#paper-context'); await page.press('#paper-allow-sharing', 'Escape');
  check('Escape declines inline consent without the global conversation shortcut', await page.evaluate(() => !window.contextFixture.paper.pendingConsent && window.globalEscapes === 0 && window.contextPackets.length === 0));
  await page.click('#paper-context'); await page.click('#paper-allow-sharing');
  check('Approval records permission without a conversation or source send', (await contextState()).approved && await page.evaluate(() => !window.contextFixture.app.native.active && window.contextPackets.length === 0));
  check('Consent UI preserves original backing pixels', await baseHash() === pixelsBefore);
  await page.screenshot({path: out + '/01-permission-desktop.png'});
  await page.evaluate(() => {const f = window.contextFixture; f.app.native.active = true; f.paper.shareCurrentView(); f.paper.shareCurrentView();});
  check('First share sends only one manifest and one selected-page view', await page.evaluate(() => window.contextPackets.length === 2 && window.contextPackets[0].type === 'document_offer' && window.contextPackets[1].view.page === 2));
  await page.click('#paper-select-area');
  const bounds = await page.locator('.paper-surface').boundingBox();
  await page.mouse.move(bounds.x + bounds.width * .55, bounds.y + bounds.height * .22);
  await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width * .95, bounds.y + bounds.height * .57);
  check('Area preview does not overwrite original pixels or send content', await baseHash() === pixelsBefore && await page.evaluate(() => window.contextPackets.length === 2));
  await page.mouse.up();
  await page.waitForFunction(() => !window.contextFixture.paper.rendering && window.contextFixture.paper.region[2] < .5);
  const selected = await contextState();
  check('Drag selection uses exact original-page coordinates and existing revision sync', selected.region.every((value, index) => Math.abs(value - [.55, .22, .4, .35][index]) < .002) && await page.evaluate(() => window.contextPackets.at(-1).type === 'document_view' && window.contextPackets.at(-1).view.view_revision === 2), {selected});
  await page.click('#paper-next');
  await page.waitForFunction(() => window.contextFixture.paper.queryContext()?.page === 3);
  check('Approved navigation keeps the chip and metadata on the visible page without re-offering', await page.evaluate(() => window.contextPackets.filter(packet => packet.type === 'document_offer').length === 1 && window.contextPackets.at(-1).view.page === 3));
  await page.setViewportSize({width: 320, height: 844});
  await page.click('#paper-select-area'); await page.press('.paper-surface', 'ArrowRight'); await page.press('.paper-surface', 'Escape');
  check('Keyboard selection cancellation remains local on mobile', await page.evaluate(() => window.contextFixture.paper.selection === null && window.globalEscapes === 0));
  const mobile = await page.evaluate(() => {
    const chip = document.querySelector('#paper-context').getBoundingClientRect(), revoke = document.querySelector('#paper-stop-sharing').getBoundingClientRect();
    return {width: innerWidth, chip: {left: chip.left, right: chip.right, height: chip.height}, revoke: {left: revoke.left, right: revoke.right, height: revoke.height}, text: document.querySelector('#paper-context').textContent};
  });
  check('320px context and revoke controls stay readable and within bounds', mobile.chip.left >= 0 && mobile.chip.right <= 320 && mobile.chip.height >= 44 && mobile.revoke.right <= 320 && mobile.revoke.height >= 44, {mobile});
  await page.screenshot({path: out + '/02-shared-mobile.png'});
  await page.click('#paper-stop-sharing');
  check('Explicit revocation keeps the document local and blocks capture', !(await contextState()).approved && await page.evaluate(async () => {try {await window.contextFixture.paper.approvedPageInput(); return false;} catch {return true;}}));
  await page.click('#paper-context');
  const consentBounds = await page.locator('#paper-allow-sharing').boundingBox();
  check('320px inline consent remains visible and touch-sized', consentBounds.x >= 0 && consentBounds.x + consentBounds.width <= 320 && consentBounds.y >= 0 && consentBounds.y + consentBounds.height <= 844 && consentBounds.height >= 44, {consentBounds});
  await page.screenshot({path: out + '/03-consent-mobile.png'});
  await page.click('#paper-allow-sharing');
  await page.click('#paper-remove');
  check('Removing the original clears per-document approval and context', await contextState() === null && await page.evaluate(() => window.contextFixture.paper.consentDocumentId === null));
  check('No endpoint, provider, blocked external action or browser error occurred', !report.blocked.length && !report.errors.length && report.requests.every(request => request.method === 'GET'));
  report.state = 'PASSED';
} catch (error) {report.state = 'FAILED'; report.failure = error.stack; process.exitCode = 1;}
finally {await context.close(); await browser.close(); await fs.writeFile(out + '/report.json', JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({state: report.state, output: out, checks: report.checks, failure: report.failure}));}
