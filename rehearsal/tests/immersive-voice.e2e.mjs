import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('..');
const out = path.join(root, 'evidence/runtime/c4/voice');
await fs.mkdir(out, {recursive: true});
const fixture = path.join(root, 'evidence/runtime/c2/handsfree-question-fixture.wav');
await fs.access(fixture);
const report = {scope: 'Actual local service, rendered character and synthesized output. Input is a disclosed synthetic browser microphone fixture, not a human or room echo test. Native Google voice is not used.', checks: [], errors: [], requests: []};
const browser = await chromium.launch({channel: 'chrome', headless: true, args: [
  '--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${fixture}`]});
const context = await browser.newContext({viewport: {width: 1440, height: 1000}, permissions: ['microphone'],
  recordVideo: {dir: path.join(out, 'interface'), size: {width: 1440, height: 1000}}});
const page = await context.newPage();
page.on('pageerror', error => report.errors.push(error.message));
page.on('request', request => { if (request.method() === 'POST') report.requests.push(request.url().split('?')[0]); });
const check = (name, passed, details = {}) => report.checks.push({name, passed, ...details});
let captured = false;
try {
  await page.goto('http://127.0.0.1:8765/', {waitUntil: 'networkidle', timeout: 60000});
  await page.waitForFunction(() => window.__einstein?.stats.avatarReady, {}, {timeout: 60000});
  check('local_mode_is_default', await page.locator('#conversation-engine').inputValue() === 'local');
  await page.evaluate(async () => {
    const {player, stage} = window.__einstein;
    await player.activate();
    const canvasStream = stage.renderer.domElement.captureStream(30);
    const stream = new MediaStream([...canvasStream.getVideoTracks(), ...player.capture.stream.getAudioTracks()]);
    const mimeType = ['video/webm;codecs=vp8,opus', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, {mimeType, videoBitsPerSecond: 1400000, audioBitsPerSecond: 96000});
    const chunks = [];
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    window.__recordedPresence = {recorder, chunks, canvasStream};
    recorder.start(250);
  });
  captured = true;
  await page.locator('#introduction').click();
  await page.waitForFunction(() => window.__einstein.stats.audioPlaying, {}, {timeout: 30000});
  report.opening = await page.evaluate(() => window.__einstein.stats.lastTurn);
  check('opening_is_labelled_prepared', report.opening.mode === 'prepared-introduction');
  await page.waitForTimeout(900);
  await page.locator('#microphone').click();
  await page.waitForFunction(() => window.__einstein.stats.detectedUtterances > 0, {}, {timeout: 15000});
  report.interruption = await page.evaluate(() => ({interruptions: window.__einstein.stats.interruptions, playing: window.__einstein.stats.audioPlaying, state: window.__einstein.stats.state}));
  check('spoken_interruption_stops_output', report.interruption.interruptions >= 1 && !report.interruption.playing);
  await page.waitForFunction(() => window.__einstein.stats.lastTurn && window.__einstein.stats.lastTurn.mode !== 'prepared-introduction', {}, {timeout: 60000});
  await page.waitForFunction(() => window.__einstein.stats.audioPlaying, {}, {timeout: 40000});
  await page.waitForTimeout(700);
  report.firstVoice = await page.evaluate(() => ({answer: window.__einstein.stats.lastTurn, firstAudioMs: window.__einstein.stats.firstAudioAt - window.__einstein.stats.requestStartedAt, cues: window.__einstein.stats.mouthCueCount, frame: window.__einstein.stats.frame}));
  check('source_is_agentic_project', report.firstVoice.answer.sources.some(url => url.includes('delegating-to-agentic-ai')));
  check('actual_output_has_mouth_cues', report.firstVoice.cues > 10);
  check('reviewed_and_generated_modes_are_explicit', ['reviewed-research-note', 'local-synthesis', 'source-fact', 'evidence-extract'].includes(report.firstVoice.answer.mode));
  await page.screenshot({path: path.join(out, 'spoken-answer.png')});
  await page.waitForFunction(() => window.__einstein.stats.lastTurn?.timings && !window.__einstein.stats.audioPlaying && window.__einstein.player.entries.length === 0, {}, {timeout: 60000});
  report.completed = await page.evaluate(() => window.__einstein.stats);
  await page.locator('#microphone').click();
  await page.waitForFunction(() => !window.__einstein.stats.microphoneActive);
  check('microphone_released', true);
  await page.locator('#source-toggle').click();
  check('source_notes_open_contextually', await page.locator('#evidence-dialog').evaluate(element => element.open));
  await page.screenshot({path: path.join(out, 'research-notes.png')});
  await page.keyboard.press('Escape');
  check('no_native_session_or_configuration_request', !report.requests.some(url => url.includes('/api/native/')));
  check('no_runtime_errors', report.errors.length === 0);
} catch (error) {
  report.failure = error.stack;
  report.stateAtFailure = await page.evaluate(() => window.__einstein?.stats).catch(() => null);
  await page.screenshot({path: path.join(out, 'failure.png')}).catch(() => {});
}
if (captured) {
  try {
    const encoded = await page.evaluate(async () => {
      const capture = window.__recordedPresence;
      await new Promise(resolve => { capture.recorder.onstop = resolve; capture.recorder.stop(); });
      const bytes = new Uint8Array(await new Blob(capture.chunks, {type: 'video/webm'}).arrayBuffer());
      let value = '';
      for (let start = 0; start < bytes.length; start += 8192) value += String.fromCharCode(...bytes.subarray(start, start + 8192));
      capture.canvasStream.getTracks().forEach(track => track.stop());
      return btoa(value);
    });
    await fs.writeFile(path.join(out, 'actual-presence-and-voice.webm'), Buffer.from(encoded, 'base64'));
    report.recording = 'actual-presence-and-voice.webm';
    report.recordingScope = 'Actual canvas and outgoing local Web Audio captured together. Incoming synthetic microphone fixture is not on the output track. Waiting time is preserved.';
  } catch (error) { report.captureFailure = error.message; }
}
const video = page.video();
await context.close(); report.interfaceVideo = await video.path(); await browser.close();
await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.failure || report.checks.some(item => !item.passed)) process.exitCode = 1;
