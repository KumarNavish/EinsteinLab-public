import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('..'), out = path.join(root, 'evidence/runtime/c18/published-paper-' + Date.now());
await fs.mkdir(out, {recursive: true});
const report = {scope: 'Actual published TraceMonkey paper selected locally. Real Gemini/Flash source inspection, original figure rendering and model-directed annotation. No microphone, prepared spoken answer, substitute diagram or question-specific response stub. This is not a paper unseen by the model training corpus.', checks: [], events: [], errors: [], turns: []};
const browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required']});
const context = await browser.newContext({viewport: {width: 1440, height: 1000}, recordVideo: {dir: path.join(out, 'interface'), size: {width: 1440, height: 1000}}});
const page = await context.newPage();
page.on('pageerror', error => report.errors.push(error.message));
page.on('websocket', socket => {
  if (!socket.url().includes('/api/native/voice')) return;
  socket.on('framereceived', ({payload}) => { if (typeof payload !== 'string') return; try {
    const event = JSON.parse(payload);
    if (event.event?.startsWith('document_') || ['work_activity','turn_complete','error'].includes(event.event)) report.events.push(event);
  } catch {} });
});
const check = (name, passed, details = {}) => report.checks.push({name, passed, ...details});
async function completed(count) {
  await page.waitForFunction(previous => window.__einstein.stats.nativeCompletedTurns > previous, count, {timeout: 75000});
  await page.waitForFunction(() => !window.__einstein.stats.audioPlaying && window.__einstein.player.entries.length === 0, {}, {timeout: 40000});
  return page.evaluate(() => window.__einstein.stats.lastTurn);
}
async function ask(text) {
  const count = await page.evaluate(() => window.__einstein.stats.nativeCompletedTurns || 0);
  await page.evaluate(text => window.__einstein.native.sendText(text), text);
  const answer = await completed(count); report.turns.push({question: text, response: answer}); return answer;
}
try {
  const response = await context.request.get('http://127.0.0.1:8765/api/native/status');
  const status = await response.json();
  if (!status.available || status.active) throw new Error('No idle, approved native session is available.');
  await page.goto('http://127.0.0.1:8765/', {waitUntil: 'networkidle', timeout: 90000});
  await page.waitForFunction(() => window.__einstein?.stats.avatarReady && window.__einstein.stats.nativeStatus?.available, {}, {timeout: 60000});
  await page.locator('#paper-file').setInputFiles(path.join(root, '.work/c18-documents/tracemonkey-original.pdf'));
  await page.waitForFunction(() => window.__einstein.paper.pdf?.pageNumber === 1);
  await page.locator('#paper-next').click();
  await page.waitForFunction(() => window.__einstein.paper.pdf?.pageNumber === 2);
  check('original_figure_page_rendered_before_sharing', await page.evaluate(() => window.__einstein.paper.pdf.text.includes('Figure 2') && !window.__einstein.paper.approved));
  await page.locator('#paper-discuss').click();
  const intro = await completed(0); report.turns.push({question: 'Discuss this selected PDF at page 2.', response: intro});
  check('source_pixels_inspected_by_flash', report.events.some(event => event.event === 'document_inspected' && event.page === 2 && event.model === 'gemini-3.8-flash'));
  const explanation = await ask('Please focus on the original Figure 2 on page 2. Explain how the monitor, recorder, and compiled trace work together. Distinguish when execution is interpreted from when native code runs. Use only this paper, and say if the source-image inspection was unavailable.');
  check('mechanism_references_actual_paper_entities', /monitor/i.test(explanation.answer || '') && /record/i.test(explanation.answer || '') && /trace|native/i.test(explanation.answer || ''));
  const before = await page.evaluate(() => window.__einstein.paper.pdf.canvas.toDataURL());
  const highlighted = await ask('Place one box annotation around the compiled native-code execution block in the original Figure 2, using the actual inspected figure coordinates, then tell me what causes execution to leave that block. Do not draw a substitute conceptual diagram.');
  const marks = await page.evaluate(() => window.__einstein.paper.marks.get(2) || []);
  report.marks = marks;
  check('real_source_annotation_acknowledged', report.events.some(event => event.event === 'work_activity' && event.tool === 'mark_selected_pdf' && event.status === 'page-annotated'));
  check('marked_region_is_in_original_flowchart', marks.some(mark => {
    const [x, y, width, height] = mark.region;
    return x > .5 && y < .4 && width < .45 && height < .3;
  }));
  check('original_page_unchanged_by_annotation', before === await page.evaluate(() => window.__einstein.paper.pdf.canvas.toDataURL()));
  check('exit_explanation_is_source_bounded', /guard|exit|fail|side/i.test(highlighted.answer || ''));
  await page.screenshot({path: path.join(out, 'original-figure-annotated.png')});
  const followup = await ask('Does this figure by itself demonstrate a speedup for every possible JavaScript program? Explain the limitation without inventing a benchmark number.');
  check('does_not_generalize_diagram_into_universal_evidence', /not|no|doesn.t|cannot|does not/i.test(followup.answer || ''));
  await page.evaluate(() => window.__einstein.native.stop());
  await page.locator('#paper-remove').click();
  check('selected_file_released_after_conversation', await page.evaluate(() => !window.__einstein.paper.pdf && !window.__einstein.native.active && !window.__einstein.stats.microphoneActive));
  check('no_browser_errors', report.errors.length === 0);
} catch (error) {
  report.failure = error.stack;
  await page.screenshot({path: path.join(out, 'failure.png')}).catch(() => {});
}
await page.evaluate(() => window.__einstein?.native.stop()).catch(() => {});
const video = page.video(); await context.close(); report.interfaceVideo = await video.path(); await browser.close();
await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({directory: out, checks: report.checks, turns: report.turns, events: report.events, errors: report.errors, failure: report.failure}, null, 2));
if (report.failure || report.checks.some(item => !item.passed)) process.exitCode = 1;
