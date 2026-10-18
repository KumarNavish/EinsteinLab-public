import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const out = path.resolve('../evidence/runtime/c11/sustained-face'); await fs.mkdir(out, {recursive: true});
const report = {scope: 'Several minutes of actual browser playback of previously generated, matched German-directed voice samples, repeated to stress streaming/reset stability. Not an unscripted conversation, human listening panel, or ground-truth phoneme alignment benchmark.', checks: [], errors: []};
const browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required']});
const page = await browser.newPage({viewport: {width: 1280, height: 1000}}); page.on('pageerror', e => report.errors.push(e.message));
try {
  await page.goto('http://127.0.0.1:8765/', {waitUntil: 'networkidle', timeout: 90000});
  await page.waitForFunction(() => window.__einstein?.stats.avatarReady, {}, {timeout: 90000});
  await page.evaluate(async () => {
    const app = window.__einstein; document.body.classList.add('engaged'); app.stage.view('portrait');
    await app.player.prepareNative(); window.__faceSamples = []; window.__faceCycles = [];
    window.__faceTimer = setInterval(() => {
      window.__faceSamples.push({t: app.player.context.currentTime, playing: app.stats.audioPlaying,
        jaw: app.stage.current.jaw || 0, rounded: app.stage.current.V_Tight_O || 0, dental: app.stage.current.V_Dental_Lip || 0,
        zero: app.stats.audioFaceZeroEvents || 0, fps: app.stats.frame?.fps, queue: app.stats.audioQueueMs || 0,
        underruns: app.stats.audioUnderruns || 0});
    }, 80);
    window.__faceStress = (async () => {
      for (let cycle = 0; cycle < 9; cycle++) {
        const voice = ['Algenib', 'Gacrux', 'Sadaltager'][cycle % 3];
        const data = new Uint8Array(await (await fetch('/voice-previews/german/' + voice + '.wav')).arrayBuffer());
        const view = new DataView(data.buffer); let offset = 12, start = -1, length = 0, rate = 0;
        while (offset + 8 <= data.length) {
          const id = String.fromCharCode(...data.subarray(offset, offset + 4)); const n = view.getUint32(offset + 4, true);
          if (id === 'fmt ') rate = view.getUint32(offset + 12, true);
          if (id === 'data') { start = offset + 8; length = n; }
          offset += 8 + n + (n % 2);
        }
        if (rate !== 24000 || start < 0 || start + length > data.length) throw new Error('Invalid source voice fixture');
        const version = app.player.begin(), before = app.player.context.currentTime;
        for (let index = 0; index < length; index += 960) {
          await app.player.enqueuePCM(data.slice(start + index, start + Math.min(length, index + 960)), rate, version);
          await new Promise(resolve => setTimeout(resolve, 18));
        }
        app.player.finish();
        const deadline = performance.now() + 10000;
        while ((app.stats.audioPlaying || (app.stats.audioQueueMs || 0) > 0) && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 40));
        await new Promise(resolve => setTimeout(resolve, 220));
        window.__faceCycles.push({cycle, voice, sourceSeconds: length / 48000, elapsedAudioSeconds: app.player.context.currentTime - before,
          residualJaw: app.stage.current.jaw || 0, zeroEvents: app.stats.audioFaceZeroEvents || 0, classes: [...(app.stats.audioFaceClasses || [])]});
      }
      clearInterval(window.__faceTimer); app.player.stop(); window.__faceStressDone = true;
    })().catch(error => { clearInterval(window.__faceTimer); window.__faceStressError = error.message; window.__faceStressDone = true; });
  });
  await page.waitForTimeout(16000); await page.screenshot({path: path.join(out, 'face-during-speech.png')});
  await page.waitForFunction(() => window.__faceStressDone, {}, {timeout: 250000});
  report.samples = await page.evaluate(() => window.__faceSamples); report.cycles = await page.evaluate(() => window.__faceCycles);
  report.failure = await page.evaluate(() => window.__faceStressError || null);
  const playing = report.samples.filter(s => s.playing);
  const total = report.cycles.reduce((n, c) => n + c.sourceSeconds, 0);
  const check = (name, pass, extra = {}) => report.checks.push({name, passed: Boolean(pass), ...extra});
  check('more_than_two_minutes_played', total >= 120 && report.cycles.length === 9, {sourceSeconds: total});
  check('actual_output_clock_and_motion_active', playing.length > 500 && Math.max(...playing.map(s => s.jaw)) > .12);
  check('open_vowel_zero_observed_in_real_recorded_speech', Math.max(...report.samples.map(s => s.zero)) > 0);
  check('rounded_and_dental_shapes_observed', playing.some(s => s.rounded > .1) && playing.some(s => s.dental > .1));
  check('mouth_returns_to_rest_between_clips', report.cycles.every(c => c.residualJaw < .035));
  check('weights_finite_and_bounded', report.samples.every(s => [s.jaw, s.rounded, s.dental].every(n => Number.isFinite(n) && n >= 0 && n <= 1.01)));
  check('no_runtime_errors', report.errors.length === 0 && !report.failure);
  await page.screenshot({path: path.join(out, 'face-after-speech.png')});
} catch (error) { report.failure = error.stack; }
await browser.close(); await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({checks: report.checks, cycles: report.cycles, errors: report.errors, failure: report.failure}, null, 2));
if (report.failure || report.checks.some(c => !c.passed)) process.exitCode = 1;
