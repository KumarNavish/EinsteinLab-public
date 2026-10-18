import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('..');
const out = path.join(root, 'evidence/runtime/c7', 'native-presence-' + Date.now());
await fs.mkdir(out, {recursive: true});
const fixture = path.join(root, 'evidence/runtime/c2/handsfree-question-fixture.wav');
await fs.access(fixture);
const report = {scope: 'Actual Gemini native audio via the configured free-tier localhost bridge, original 3D performance and local audio-driven face classifier. The browser microphone uses a disclosed synthetic file, not a human or room-echo test.', checks: [], errors: [], httpErrors: []};
const browser = await chromium.launch({channel: 'chrome', headless: true, args: [
  '--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${fixture}`]});
const context = await browser.newContext({viewport: {width: 1440, height: 1000}, permissions: ['microphone'],
  recordVideo: {dir: path.join(out, 'interface'), size: {width: 1440, height: 1000}}});
const page = await context.newPage();
page.on('pageerror', error => report.errors.push(error.message));
page.on('response', response => { if (response.status() >= 400) report.httpErrors.push({url: response.url().split('?')[0], status: response.status()}); });
const check = (name, passed, details = {}) => report.checks.push({name, passed: Boolean(passed), ...details});
let capture = false;
try {
  const status = await context.request.get('http://127.0.0.1:8765/api/native/status');
  report.before = await status.json();
  if (!report.before.available || report.before.active) throw new Error('Configured provider unavailable or an existing conversation is active; it was not interrupted');
  await page.goto('http://127.0.0.1:8765/', {waitUntil: 'networkidle', timeout: 60000});
  await page.waitForFunction(() => window.__einstein?.stats.avatarReady && window.__einstein.stats.nativeStatus, {}, {timeout: 60000});
  check('correct_page', (await page.title()) === 'Einstein · Mobiliar Lab');
  check('configured_native_selected', await page.locator('#conversation-engine').inputValue() === 'native');
  await page.getByRole('button', {name: 'Conversation settings', exact: true}).click();
  check('local_voice_selector_hidden', !(await page.locator('#voice-mode').isVisible()));
  check('actual_native_voice_selector_visible', await page.locator('#native-voice').isVisible());
  await page.locator('#native-voice').selectOption('Algenib');
  await page.screenshot({path: path.join(out, 'native-settings.png')});
  await page.keyboard.press('Escape');
  await page.evaluate(async () => {
    const app = window.__einstein;
    await app.player.prepareNative();
    const video = app.stage.renderer.domElement.captureStream(30);
    const stream = new MediaStream([...video.getVideoTracks(), ...app.player.capture.stream.getAudioTracks()]);
    const mimeType = ['video/webm;codecs=vp8,opus', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, {mimeType, videoBitsPerSecond: 1600000, audioBitsPerSecond: 96000});
    const parts = [];
    recorder.ondataavailable = event => { if (event.data.size) parts.push(event.data); };
    window.__nativeCapture = {recorder, parts, video};
    window.__motionSamples = [];
    window.__motionTimer = setInterval(() => {
      if (app.stats.audioPlaying && window.__motionSamples.length < 1200) window.__motionSamples.push({t: performance.now(), jaw: app.stage.current.jaw,
        round: app.stage.current.V_Tight_O, dental: app.stage.current.V_Dental_Lip, wide: app.stage.current.V_Wide,
        gesture: app.stage.performanceWeight, fps: app.stats.frame?.fps, method: app.stats.frame?.mouthMethod});
    }, 60);
    recorder.start(250);
  });
  capture = true;
  await page.locator('#introduction').click();
  await page.waitForFunction(() => window.__einstein.stats.audioPlaying, {}, {timeout: 30000});
  check('requested_voice_reaches_provider', await page.evaluate(() => window.__einstein.stats.nativeVoice === 'Algenib'));
  check('live_face_classifier_loaded', await page.evaluate(() => window.__einstein.stats.audioFaceReady));
  await page.waitForTimeout(700);
  await page.locator('#microphone').click();
  await page.waitForFunction(() => window.__einstein.stats.microphoneActive, {}, {timeout: 10000});
  await page.waitForFunction(() => window.__einstein.stats.nativeUtterances >= 1, {}, {timeout: 15000});
  await page.waitForFunction(() => window.__einstein.stats.nativeInterruptions >= 1, {}, {timeout: 15000});
  check('real_provider_interruption_observed', true);
  await page.waitForFunction(() => window.__einstein.stats.lastTurn?.mode === 'native-audio' && /delegat/i.test(window.__einstein.stats.lastTurn?.question || ''), {}, {timeout: 45000});
  report.spokenTurn = await page.evaluate(() => window.__einstein.stats.lastTurn);
  check('spoken_answer_is_native', report.spokenTurn.mode === 'native-audio');
  check('spoken_answer_has_relevant_evidence', report.spokenTurn.sources.some(url => url.includes('delegating-to-agentic-ai')));
  check('spoken_answer_not_empty', report.spokenTurn.answer.trim().split(/\s+/).length >= 10);
  await page.waitForFunction(() => !window.__einstein.stats.audioPlaying && window.__einstein.player.entries.length === 0, {}, {timeout: 20000});
  const question = 'What is the risk if people delegate too readily?';
  await page.getByRole('button', {name: 'Type a question', exact: true}).click();
  await page.locator('#question').fill(question);
  await page.getByRole('button', {name: 'Send question', exact: true}).click();
  await page.waitForFunction(() => window.__einstein.stats.audioPlaying, {}, {timeout: 20000});
  await page.waitForTimeout(1300);
  await page.screenshot({path: path.join(out, 'native-speaking.png')});
  await page.waitForFunction(q => window.__einstein.stats.lastTurn?.question === q, question, {timeout: 30000});
  report.followup = await page.evaluate(() => window.__einstein.stats.lastTurn);
  check('followup_retains_project_context', report.followup.sources.some(url => url.includes('delegating-to-agentic-ai')));
  check('followup_addresses_delegation_risk', /worse|inferior|poor|less suitable|bad|trade.off|quality|price/i.test(report.followup.answer));
  await page.waitForFunction(() => !window.__einstein.stats.audioPlaying && window.__einstein.player.entries.length === 0, {}, {timeout: 20000});
  await page.locator('#microphone').click();
  await page.waitForFunction(() => !window.__einstein.stats.microphoneActive && !window.__einstein.native.active, {}, {timeout: 10000});
  check('ending_releases_native_session_and_microphone', true);
  report.face = await page.evaluate(() => ({ready: window.__einstein.stats.audioFaceReady, error: window.__einstein.stats.audioFaceError,
    events: window.__einstein.stats.audioFaceEvents, classes: window.__einstein.stats.audioFaceClasses,
    delayMs: window.__einstein.stats.nativeLipSyncDelayMs}));
  report.motionSamples = await page.evaluate(() => window.__motionSamples);
  check('audio_classifier_produces_distinct_shapes', report.face.events > 25 && report.face.classes.length >= 4);
  check('jaw_and_rounding_move_with_voice', report.motionSamples.some(s => s.jaw > .1) && report.motionSamples.some(s => s.round > .05));
  check('standing_performance_stays_quiet_during_speech', report.motionSamples.length > 0 && report.motionSamples.every(s => Math.abs(s.gesture) < .001));
  await page.locator('#source-toggle').click();
  await page.screenshot({path: path.join(out, 'native-evidence.png')});
  await page.keyboard.press('Escape');
  await page.setViewportSize({width: 390, height: 844}); await page.waitForTimeout(400);
  await page.screenshot({path: path.join(out, 'native-mobile.png'), fullPage: false});
  check('mobile_has_no_horizontal_overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  check('no_console_or_http_errors', report.errors.length === 0 && report.httpErrors.length === 0);
  report.after = await (await context.request.get('http://127.0.0.1:8765/api/native/status')).json();
} catch (error) {
  report.failure = error.stack;
  report.stateAtFailure = await page.evaluate(() => window.__einstein?.stats).catch(() => null);
  await page.screenshot({path: path.join(out, 'failure.png')}).catch(() => {});
  await page.evaluate(() => window.__einstein?.native.stop()).catch(() => {});
}
if (capture) {
  try {
    const data = await page.evaluate(async () => {
      clearInterval(window.__motionTimer);
      const capture = window.__nativeCapture;
      await new Promise(resolve => { capture.recorder.onstop = resolve; capture.recorder.stop(); });
      const bytes = new Uint8Array(await new Blob(capture.parts, {type: 'video/webm'}).arrayBuffer());
      let encoded = ''; for (let i = 0; i < bytes.length; i += 8192) encoded += String.fromCharCode(...bytes.subarray(i, i + 8192));
      capture.video.getTracks().forEach(track => track.stop()); return btoa(encoded);
    });
    await fs.writeFile(path.join(out, 'actual-native-presence.webm'), Buffer.from(data, 'base64'));
    report.recording = 'actual-native-presence.webm';
    report.recordingScope = 'Actual avatar canvas and outgoing Google native audio recorded together. Incoming synthetic microphone fixture is not on the output track. No voice replacement or pause removal.';
  } catch (error) { report.captureFailure = error.message; }
}
const video = page.video(); await context.close(); report.interfaceVideo = await video.path(); await browser.close();
await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({directory: out, checks: report.checks, spokenTurn: report.spokenTurn, followup: report.followup,
                           face: report.face, errors: report.errors, failure: report.failure}, null, 2));
if (report.failure || report.checks.some(check => !check.passed)) process.exitCode = 1;
