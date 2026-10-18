// Offline endpoint fixture, real LocalPDF decoding/rendering, no remote service.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>', '<< /Length 58 >>\nstream\nBT /F1 12 Tf 20 120 Td (OFFLINE PUBLIC PDF FIXTURE) Tj ET\nendstream', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
let document = '%PDF-1.4\n';
const offsets = [0];
for (const [i, object] of objects.entries()) { offsets.push(Buffer.byteLength(document)); document += `${i + 1} 0 obj\n${object}\nendobj\n`; }
const xref = Buffer.byteLength(document);
document += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(value => String(value).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
const pdf = Buffer.from(document);
const html = `<!doctype html><html><body><main id="app"></main><footer class="quiet-footer"></footer><script type="module">
import '/src/style.css';import {PaperWorkspace} from '/src/paper-workspace.js';import {attachPaperRetrieval} from '/src/paper-retrieval.js';
window.app={stats:{},stage:{},native:{active:false,revokeDocument(){}}};app.paper=new PaperWorkspace(app);window.retrieval=attachPaperRetrieval(app);
</script></body></html>`;
const server = await createServer({root, configFile: false, server: {host: '127.0.0.1', port: 0}, plugins: [{name: 'paper-url-fixture', configureServer(server) { server.middlewares.use('/__paper_fixture', (request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(html); }); }}]});
let browser, page, mode = 'success', pendingRoute;
const checks = [], errors = [], requests = [];
const check = async (name, result) => { assert(await result, name); checks.push(name); };
try {
  await server.listen(); browser = await chromium.launch({channel: 'chrome', headless: true});
  page = await browser.newPage({viewport: {width: 1280, height: 900}});
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(); requests.push({method: request.method(), url: request.url()});
    if (new URL(request.url()).hostname !== '127.0.0.1') { errors.push('Unexpected external browser request'); return route.abort(); }
    if (new URL(request.url()).pathname !== '/api/paper/retrieve') return route.continue();
    assert.deepEqual(request.postDataJSON(), {url: 'https://fixture.example/paper.pdf'});
    if (mode === 'pending') { pendingRoute = route; return; }
    if (mode === 'paywall') return route.fulfill({status: 422, contentType: 'application/json', body: '{"detail":"unavailable"}'});
    return route.fulfill({status: 200, contentType: 'application/pdf', headers: {'X-Paper-Source-URL': 'https://fixture.example/original.pdf'}, body: pdf});
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__paper_fixture`);
  await page.waitForFunction(() => window.retrieval);
  await check('no retrieval happens before explicit visitor submission', requests.every(request => request.method === 'GET'));
  const submit = async () => { await page.locator('#paper-link-open').click(); await page.locator('#paper-link-url').fill('https://fixture.example/paper.pdf'); await page.locator('#paper-link-retrieve').click(); };
  await submit();
  await page.waitForFunction(() => app.stats.document.sourceKind === 'retrieved-public-pdf', {}, {timeout: 30000});
  await check('retrieved bytes render actual original PDF pixels and text', page.evaluate(() => app.paper.pdf.text.includes('OFFLINE PUBLIC PDF FIXTURE') && app.paper.base.width > 100 && app.paper.base.height > 100 && app.paper.pdf.manifest.pages === 1));
  await check('source attribution is visible and external page sharing remains unapproved', page.evaluate(() => app.paper.message.querySelector('a').href === 'https://fixture.example/original.pdf' && app.stats.document.approved === false && app.paper.panel.querySelector('.paper-kicker').textContent.includes('ORIGINAL PDF')));
  await page.evaluate(() => app.paper.close());
  mode = 'pending'; await submit();
  await page.waitForFunction(() => document.querySelector('#paper-link-status').textContent.includes('Retrieving'));
  while (!pendingRoute) await new Promise(resolve => setTimeout(resolve, 10));
  await page.getByRole('button', {name: 'Close paper link', exact: true}).click();
  await pendingRoute.fulfill({status: 200, contentType: 'application/pdf', body: pdf}).catch(() => {});
  await page.waitForTimeout(80);
  await check('cancelled retrieval cannot open a late document', page.evaluate(() => !app.paper.pdf && !document.querySelector('#paper-link-dialog').open));
  mode = 'paywall'; await submit();
  await page.waitForFunction(() => document.querySelector('#paper-link-status').textContent.includes('paywalls'));
  await check('unavailable and paywalled links are disclosed without fabricated pages', page.evaluate(() => !app.paper.pdf && !app.stats.document.selected && document.querySelector('#paper-link-status').textContent.includes('local PDF')));
  await check('browser stayed local and errors remained empty', errors.length === 0 && requests.filter(request => request.method === 'POST').length === 3);
  console.log(JSON.stringify({scope: 'Offline public-PDF response fixture, real PDFJS renderer, no Internet/provider requests.', checks: checks.length, passed: checks, errors}, null, 2));
} catch (error) {
  console.error(JSON.stringify(await page?.evaluate(() => ({status: document.querySelector('#paper-status')?.textContent, retrieval: document.querySelector('#paper-link-status')?.textContent, stats: app.stats})), null, 2), errors);
  throw error;
} finally { await browser?.close(); await server.close(); }
