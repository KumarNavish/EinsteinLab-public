import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('..');
const out = path.join(root, 'evidence/runtime/c2');
const fixture = path.join(out, 'handsfree-question-fixture.wav');
await fs.access(fixture);
const report = {scope: 'Real browser microphone API -> AudioWorklet -> VAD -> local Whisper -> generated answer -> local speech and animated avatar. The microphone is a synthetic fixture in an isolated browser, not a human or acoustic room test.',
  checks: [], errors: [], warnings: [], httpErrors: []};
const browser = await chromium.launch({channel: 'chrome', headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${fixture}`]});
const context = await browser.newContext({viewport: {width: 1440, height: 1000}, permissions: ['microphone'],
  recordVideo: {dir: path.join(out, 'voice-videos'), size: {width: 1440, height: 1000}}});
const page = await context.newPage();
page.on('pageerror', error => report.errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); if (message.type() === 'warning') report.warnings.push(message.text()); });
page.on('response', response => { if (response.status() >= 400) report.httpErrors.push({url: response.url(), status: response.status()}); });
const check = (name, passed, evidence = {}) => report.checks.push({name, passed, ...evidence});
let captureStarted = false;
try {
  for (let i = 0; i < 100; i++) {
    try { const response = await context.request.get('http://127.0.0.1:8765/api/health'); if (response.ok()) { report.health = await response.json(); break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  if (!report.health) throw new Error('The local application did not become ready');
  await page.goto('http://127.0.0.1:8765/', {waitUntil: 'networkidle', timeout: 90000});
  await page.waitForFunction(() => window.__einstein?.stats.avatarReady, {}, {timeout: 90000});
  await page.locator('#evidence-only').uncheck();
  await page.locator('#voice-mode').selectOption('expressive');
  await page.evaluate(async () => {
    const app = window.__einstein;
    await app.player.activate();
    const video = app.stage.renderer.domElement.captureStream(30);
    const stream = new MediaStream([...video.getVideoTracks(), ...app.player.capture.stream.getAudioTracks()]);
    const mimeType = ['video/webm;codecs=vp8,opus', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, {mimeType, videoBitsPerSecond: 1800000, audioBitsPerSecond: 96000});
    const chunks = [];
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    window.__actualAvatarCapture = {recorder, chunks, video};
    recorder.start(250);
  });
  captureStarted = true;
  await page.locator('#introduction').click();
  await page.waitForFunction(() => window.__einstein.stats.audioPlaying, {}, {timeout: 45000});
  report.opening = await page.evaluate(() => ({...window.__einstein.stats.lastTurn,
    clientFirstAudioMs: window.__einstein.stats.firstAudioAt - window.__einstein.stats.requestStartedAt}));
  check('prepared_opening_is_disclosed', report.opening.mode === 'prepared-introduction');
  const openingMeasurement = await page.locator('#measurement').innerText();
  await page.waitForTimeout(1500);
  await page.locator('#microphone').click();
  await page.waitForFunction(() => window.__einstein.stats.microphoneActive, {}, {timeout: 10000});
  await page.waitForFunction(() => window.__einstein.stats.detectedUtterances > 0, {}, {timeout: 15000});
  report.onset = await page.evaluate(() => window.__einstein.stats);
  check('automatic_barge_in_detected', report.onset.interruptions >= 1 && !report.onset.audioPlaying);
  await page.screenshot({path: path.join(out, 'automatic-interruption.png'), fullPage: false});
  await page.waitForFunction(() => window.__einstein.stats.lastTranscript?.length > 5, {}, {timeout: 30000});
  report.transcript = await page.evaluate(() => window.__einstein.stats.lastTranscript);
  check('spoken_question_transcribed', /delegat/i.test(report.transcript) && /decision/i.test(report.transcript));
  await page.waitForFunction(() => window.__einstein.stats.lastTurn?.mode !== 'prepared-introduction' && window.__einstein.stats.lastTurn?.question?.length > 5, {}, {timeout: 90000});
  await page.waitForFunction(() => window.__einstein.stats.audioPlaying, {}, {timeout: 60000});
  await page.waitForTimeout(1400);
  report.answer = await page.evaluate(() => ({...window.__einstein.stats.lastTurn,
    clientFirstAudioMs: window.__einstein.stats.firstAudioAt - window.__einstein.stats.requestStartedAt,
    cueCount: window.__einstein.stats.mouthCueCount, frame: window.__einstein.stats.frame}));
  check('spoken_question_uses_relevant_lab_source', report.answer.sources.some(url => url.includes('delegating-to-agentic-ai')));
  check('answer_is_generated_not_prepared', report.answer.mode === 'local-synthesis');
  check('phoneme_cues_reach_real_playback', report.answer.cueCount > 20);
  report.currentTimingDisplay = await page.locator('#measurement').innerText();
  check('timing_display_belongs_to_current_turn', report.currentTimingDisplay !== openingMeasurement);
  report.sourceLabel = await page.locator('#source-toggle').innerText();
  check('source_label_distinguishes_passages_and_pages', /passages? from \d+ pages?/.test(report.sourceLabel));
  await page.locator('#source-toggle').click();
  await page.screenshot({path: path.join(out, 'spoken-answer-evidence.png'), fullPage: false});
  await page.waitForFunction(() => !window.__einstein.stats.audioPlaying && window.__einstein.player.entries.length === 0 && window.__einstein.stats.lastTurn?.timings, {}, {timeout: 60000});
  report.completed = await page.evaluate(() => window.__einstein.stats);
  await page.locator('#microphone').click();
  await page.waitForFunction(() => !window.__einstein.stats.microphoneActive);
  check('ending_conversation_releases_microphone', true);
  check('one_complete_spoken_turn', report.completed.detectedUtterances === 1);
  check('clean_console', report.errors.length === 0 && report.httpErrors.length === 0);
} catch (error) {
  report.failure = error.stack;
  report.stateAtFailure = await page.evaluate(() => window.__einstein?.stats).catch(() => null);
  await page.screenshot({path: path.join(out, 'voice-test-failure.png'), fullPage: false}).catch(() => {});
}
if (captureStarted) {
  try {
    const encoded = await page.evaluate(async () => {
      const capture = window.__actualAvatarCapture;
      await new Promise(resolve => { capture.recorder.onstop = resolve; capture.recorder.stop(); });
      const bytes = new Uint8Array(await new Blob(capture.chunks, {type: 'video/webm'}).arrayBuffer());
      let text = '';
      for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
      capture.video.getTracks().forEach(track => track.stop());
      return btoa(text);
    });
    const filename = path.join(out, 'avatar-with-live-voice.webm');
    await fs.writeFile(filename, Buffer.from(encoded, 'base64'));
    report.synchronizedAvatarRecording = filename;
    report.recordingDisclosure = 'Direct browser canvas video plus actual outgoing Web Audio, recorded together. Incoming synthetic question audio is not in this recording. No mockup, voice replacement, or pause removal.';
  } catch (error) { report.captureFailure = error.message; }
}
const video = page.video();
await context.close();
report.fullInterfaceVideo = await video.path();
await browser.close();
await fs.writeFile(path.join(out, 'voice-e2e.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.failure || report.checks.some(item => !item.passed)) process.exitCode = 1;
