import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const out = path.resolve('../evidence/runtime/c11/board'); await fs.mkdir(out, {recursive: true});
const report = {scope: 'Actual WebGL panel, audio-independent geometry and browser acknowledgement tests. No native model or public-web call.', checks: [], errors: []};
const browser = await chromium.launch({channel: 'chrome', headless: true});
const page = await browser.newPage({viewport: {width: 1600, height: 1000}});
page.on('pageerror', error => report.errors.push(error.message));
const check = (name, passed, detail = {}) => report.checks.push({name, passed: Boolean(passed), ...detail});
const graph = {title: 'Assistance is not the same as independent judgment', scope: 'conceptual-explanation', caption: 'A conceptual pathway; the causal effect must be tested.', sources: [],
  nodes: [{id: 'person', label: 'Person asks a question', x: .2, y: .22}, {id: 'assistant', label: 'AI suggests an answer', x: .8, y: .22}, {id: 'judgment', label: 'Person checks the evidence', x: .5, y: .8}],
  edges: [{id: 'edge-0', from: 'person', to: 'assistant', label: 'Prompt', kind: 'information'}, {id: 'edge-1', from: 'assistant', to: 'judgment', label: 'May change effort', kind: 'causal-hypothesis'}]};
try {
  await page.goto('http://127.0.0.1:8765/', {waitUntil: 'networkidle', timeout: 90000});
  await page.waitForFunction(() => window.__einstein?.stats.avatarReady && window.__einstein.board, {}, {timeout: 90000});
  check('whiteboard_hidden_initially', await page.evaluate(() => !window.__einstein.board.group.visible));
  const result = await page.evaluate(async graph => {
    const app = window.__einstein; document.body.classList.add('engaged');
    return await app.board.apply({kind: 'diagram', action_id: 'browser-only-1', revision: 1, graph});
  }, graph);
  check('real_render_acknowledged', result.status === 'displayed' && result.rendered_elements === 5);
  await page.screenshot({path: path.join(out, 'diagram-desktop.png')});
  const focused = await page.evaluate(() => window.__einstein.board.apply({kind: 'focus', action_id: 'browser-only-2', revision: 2, element_id: 'judgment', annotation: 'The person remains responsible for checking the answer.'}));
  await page.waitForTimeout(1300);
  report.attention = await page.evaluate(() => window.__einstein.stage.attentionMetrics);
  check('focus_acknowledged', focused.status === 'focused');
  check('arm_pointing_is_removed', report.attention?.pointing === null, report.attention || {});
  check('bounded_head_orientation_without_eye_targeting', report.attention?.headOrientationEnabled === true && report.attention?.eyeTargetingEnabled === false && Math.hypot(report.attention.headOffset.pitch, report.attention.headOffset.yaw) < Math.PI / 12);
  await page.screenshot({path: path.join(out, 'diagram-focused.png')});
  await page.locator('#read-diagram').click();
  check('readable_diagram_view', await page.locator('#diagram-dialog').evaluate(element => element.open));
  await page.screenshot({path: path.join(out, 'diagram-readable.png')}); await page.keyboard.press('Escape');
  await page.setViewportSize({width: 390, height: 844});
  await page.evaluate(() => window.__einstein.board.compose());
  await page.locator('#read-diagram').click();
  check('mobile_no_horizontal_overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({path: path.join(out, 'diagram-mobile.png'), fullPage: false}); await page.keyboard.press('Escape');
  const cancelled = await page.evaluate(async graph => {
    let valid = true;
    const promise = window.__einstein.board.apply({kind: 'diagram', action_id: 'browser-cancelled', revision: 3, graph: {...graph, title: 'Must not become committed'}} , () => valid);
    setTimeout(() => { valid = false; window.__einstein.board.cancelPending(); }, 100);
    try { await promise; return false; } catch { return window.__einstein.board.graph.title !== 'Must not become committed'; }
  }, graph);
  check('interrupted_render_restores_previous_visual', cancelled);
  const hidden = await page.evaluate(() => window.__einstein.board.apply({kind: 'hide', action_id: 'browser-only-4', revision: 4}));
  check('hide_clears_actual_board', hidden.status === 'hidden' && await page.evaluate(() => !window.__einstein.board.group.visible));
  check('no_runtime_errors', !report.errors.length);
} catch (error) { report.failure = error.stack; await page.screenshot({path: path.join(out, 'failure.png')}).catch(() => {}); }
await browser.close(); await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.failure || report.checks.some(item => !item.passed)) process.exitCode = 1;
