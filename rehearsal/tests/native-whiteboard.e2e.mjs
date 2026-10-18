import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('..');
const out = path.join(root, 'evidence/runtime/c11', 'native-board-' + Date.now()); await fs.mkdir(out, {recursive: true});
const report = {scope: 'Actual Gemini native voice, actual official lab lookup, model-proposed graph, WebGL render acknowledgements and targeted arm gestures; head targeting is withdrawn. Typed requests; no human microphone or Quest claim.', checks: [], errors: [], turns: []};
const browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required']});
const context = await browser.newContext({viewport: {width: 1600, height: 1000}, recordVideo: {dir: path.join(out, 'ui'), size: {width: 1280, height: 800}}});
const page = await context.newPage(); page.on('pageerror', e => report.errors.push(e.message));
const check = (name, passed, extra = {}) => report.checks.push({name, passed: Boolean(passed), ...extra});
let captured = false;
async function ask(question, duringScreenshot = null) {
  await page.getByRole('button', {name: 'Type a question', exact: true}).click();
  await page.locator('#question').fill(question); await page.getByRole('button', {name: 'Send question', exact: true}).click();
  await page.waitForFunction(() => window.__einstein.stats.audioPlaying, {}, {timeout: 90000});
  if (duringScreenshot) { await page.waitForTimeout(650); await page.screenshot({path: path.join(out, duringScreenshot)}); }
  await page.waitForFunction(q => window.__einstein.stats.lastTurn?.question === q, question, {timeout: 90000});
  await page.waitForFunction(() => !window.__einstein.stats.audioPlaying && (window.__einstein.stats.audioQueueMs || 0) < 80, {}, {timeout: 40000});
  report.turns.push(await page.evaluate(() => ({...window.__einstein.stats.lastTurn, visual: window.__einstein.stats.visual, audioUnderruns: window.__einstein.stats.audioUnderruns})));
}
try {
  for (let n = 0; n < 100; n++) {
    try { const response = await context.request.get('http://127.0.0.1:8765/api/native/status'); const status = await response.json(); if (status.available && status.visual_tools?.includes('sketch_mechanism')) { report.before = status; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!report.before || report.before.active) throw new Error('Updated idle native service was not ready; no existing conversation was interrupted.');
  await page.goto('http://127.0.0.1:8765/', {waitUntil: 'networkidle', timeout: 90000});
  await page.waitForFunction(() => window.__einstein.stats.avatarReady && window.__einstein.stats.nativeStatus, {}, {timeout: 60000});
  await page.getByRole('button', {name: 'Conversation settings', exact: true}).click();
  await page.locator('#conversation-engine').selectOption('native');
  await page.locator('#native-accent').selectOption('german'); await page.keyboard.press('Escape');
  // Start through the actual visible control, not a recorder attached to a dormant clock.
  await page.locator('#introduction').click();
  await page.waitForFunction(() => window.__einstein.stats.audioPlaying, {}, {timeout: 35000});
  check('actual_native_intro_is_audible_before_recording', true);
  await page.evaluate(async () => {
    const {stage, player} = window.__einstein; await player.prepareNative();
    // Verify that the output clock is advancing before starting a recorder.
    const timeBefore = player.context.currentTime; await new Promise(r => setTimeout(r, 150));
    if (player.context.currentTime <= timeBefore) throw new Error('Audio output clock did not advance before capture');
    const video = stage.renderer.domElement.captureStream(30);
    const stream = new MediaStream([...video.getVideoTracks(), ...player.capture.stream.getAudioTracks()]);
    const recorder = new MediaRecorder(stream, {mimeType: 'video/webm;codecs=vp8,opus', videoBitsPerSecond: 1300000, audioBitsPerSecond: 96000});
    const chunks = []; recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    window.__boardRecording = {recorder, chunks, video}; recorder.start(250);
    window.__boardSamples = []; window.__boardTimer = setInterval(() => {
      const app = window.__einstein;
      if (window.__boardSamples.length < 2500) window.__boardSamples.push({time: performance.now(), playing: app.stats.audioPlaying, jaw: app.stage.current.jaw || 0,
        focus: app.stats.visual?.focused, attentionWeight: app.stage.attentionMetrics?.weight, headOffset: app.stage.attentionMetrics?.headOffset, pointingRemoved: app.stage.attentionMetrics?.pointing === null,
        fps: app.stats.frame?.fps, zeroEvents: app.stats.audioFaceZeroEvents || 0});
    }, 80);
  }); captured = true;
  await page.waitForFunction(() => window.__einstein.stats.nativeCompletedTurns >= 1 && !window.__einstein.stats.audioPlaying, {}, {timeout: 35000});
  report.introduction = await page.evaluate(() => window.__einstein.stats.lastTurn);
  await ask('Please look up the Mobiliar Lab project on LLMs and cognitive load, then sketch a simple conceptual mechanism with three or four boxes. Label uncertain causal links as hypotheses and cite the actual project page. Explain it briefly.');
  check('real_diagram_created', report.turns[0].visual?.visible && report.turns[0].visual?.graph?.nodes.length >= 3);
  check('diagram_links_actual_inspected_source', report.turns[0].visual?.graph?.sources.some(s => s.url.includes('llms-and-cognitive-load')));
  check('diagram_not_claimed_as_original_figure', report.turns[0].visual?.graph?.scope === 'conceptual-explanation');
  const boxes = Object.values(report.turns[0].visual?.displayLayout?.boxes || {});
  check('actual_model_diagram_has_nonoverlapping_nodes', boxes.length >= 3 && boxes.every((a, i) => boxes.slice(i + 1).every(b => !(a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y))));
  check('german_direction_reached_provider', await page.evaluate(() => window.__einstein.stats.nativeAccent === 'german'));
  await page.screenshot({path: path.join(out, 'native-diagram.png')});
  await ask('Highlight the box that represents the human in this diagram and explain why that part matters.', 'native-highlight-during-speech.png');
  check('followup_focus_is_existing_element', Boolean(report.turns[1].visual?.focused));
  await page.waitForTimeout(50);
  report.attention = await page.evaluate(() => window.__einstein.stage.attentionMetrics);
  const focusSamples = await page.evaluate(() => window.__boardSamples.filter(s => s.focus === window.__einstein.stats.visual.focused && s.attentionWeight > .85));
  report.focusMeasurements = {samples: focusSamples.length, pointingRemoved: focusSamples.filter(s => s.pointingRemoved).length};
  check('source_focus_keeps_arm_pointing_disabled', focusSamples.length > 5 && focusSamples.every(s => s.pointingRemoved));
  check('head_orientation_is_bounded_without_eye_targeting', report.attention?.headOrientationEnabled === true && report.attention?.eyeTargetingEnabled === false && focusSamples.every(s => s.headOffset && Math.hypot(s.headOffset.pitch, s.headOffset.yaw) < Math.PI / 12));
  await page.screenshot({path: path.join(out, 'native-highlight.png')});
  await ask('Simplify your diagram to exactly two boxes: the person and the AI assistant. Preserve the conceptual caveat, not a claim of measured benefit.');
  check('conversational_edit_replaces_graph', report.turns[2].visual?.graph?.nodes.length === 2);
  await page.screenshot({path: path.join(out, 'native-simplified.png')});
  await ask('Put the whiteboard away, please.');
  check('conversational_dismissal_executed', !report.turns[3].visual?.visible);
  check('distinct_visual_revisions_acknowledged', report.turns.map(t => t.visual?.revision).every((value, i, array) => i === 0 || value > array[i - 1]));
  const conversationId = await page.evaluate(() => window.__einstein.stats.nativeConversationId);
  await page.evaluate(() => window.__einstein.native.stop());
  for (let n = 0; n < 50; n++) {
    report.after = await (await context.request.get('http://127.0.0.1:8765/api/native/status')).json();
    if (!report.after.active && report.after.last_session?.conversation_id === conversationId) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  check('completion_receipt_belongs_to_this_conversation', report.after.last_session?.conversation_id === conversationId);
  check('server_received_visual_acknowledgements', report.after.last_session?.visual_acknowledged >= 4);
  check('native_session_released', !report.after.active);
  check('no_runtime_error', !report.errors.length);
  report.samples = await page.evaluate(() => window.__boardSamples);
  check('actual_browser_playback_observed', report.samples.filter(s => s.playing).length > 20);
} catch (error) {
  report.failure = error.stack; report.stateAtFailure = await page.evaluate(() => window.__einstein?.stats).catch(() => null);
  await page.screenshot({path: path.join(out, 'failure.png')}).catch(() => {});
  await page.evaluate(() => window.__einstein?.native.stop()).catch(() => {});
}
if (captured) {
  try {
    const text = await page.evaluate(async () => {
      clearInterval(window.__boardTimer); const capture = window.__boardRecording;
      await new Promise(resolve => { capture.recorder.onstop = resolve; capture.recorder.stop(); });
      const bytes = new Uint8Array(await new Blob(capture.chunks, {type: 'video/webm'}).arrayBuffer());
      if (bytes.length < 1024) throw new Error('MediaRecorder returned no usable audio/video data');
      let value = ''; for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192));
      capture.video.getTracks().forEach(track => track.stop()); return btoa(value);
    });
    await fs.writeFile(path.join(out, 'actual-diagram-and-voice.webm'), Buffer.from(text, 'base64'));
    report.recordingScope = 'Real canvas plus actual outgoing Google audio recorded together after the introduction audio clock began. The opening may begin mid-sentence; all later turns and waits are retained. No redub or generated image.';
  } catch (error) { report.recordingFailure = error.message; }
}
const video = page.video(); await context.close(); report.interfaceVideo = await video.path(); await browser.close();
await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({directory: out, checks: report.checks, turns: report.turns.map(t => ({question: t.question, answer: t.answer, firstPacketMs: t.firstPacketMs, visual: t.visual})), error: report.failure, after: report.after?.last_session}, null, 2));
if (report.failure || report.recordingFailure || report.checks.some(c => !c.passed)) process.exitCode = 1;
