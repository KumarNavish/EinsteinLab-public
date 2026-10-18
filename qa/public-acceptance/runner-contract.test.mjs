import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {acceptanceScenario, acceptanceRunner, FULL_PDF_FIXTURE, verifyFullPdf, verifyExportMedia} from './runner-contract.mjs';

test('manual runner mapping permits only the two standard images on their actual platforms', () => {
  assert.deepEqual(acceptanceRunner('ubuntu-24.04', 'linux', 'Linux'), {label: 'ubuntu-24.04', platform: 'linux', runnerOS: 'Linux'});
  const windows = acceptanceRunner('windows-2025', 'win32', 'Windows');
  assert.deepEqual(windows, {label: 'windows-2025', platform: 'win32', runnerOS: 'Windows'});
  assert.throws(() => { windows.label = 'windows-2025-gpu'; });
  for (const name of ['ubuntu-latest', 'windows-2025-gpu', 'ubuntu-24.04-8core', 'self-hosted', '__proto__', '', undefined]) {
    assert.throws(() => acceptanceRunner(name, 'linux', 'Linux'), /approved standard public runner/);
  }
  for (const [name, platform, os] of [['windows-2025', 'linux', 'Linux'], ['windows-2025', 'win32', 'Linux'],
    ['ubuntu-24.04', 'darwin', 'macOS'], ['ubuntu-24.04', 'linux', undefined]]) {
    assert.throws(() => acceptanceRunner(name, platform, os), /fixed platform/);
  }
});

test('each manual scenario selects its exact command and distinct acceptance state', () => {
  const expected = {
    full: [['qa/public-acceptance/run.mjs', '--run'], 'PUBLIC_OPENAI_PROTOCOL_PASSED'],
    remaining: [['qa/public-acceptance/run.mjs', '--remaining', '--run'], 'PUBLIC_REMAINING_SCENARIOS_PASSED'],
    'research-recovery': [['qa/public-acceptance/research-recovery.mjs', '--run'], 'PUBLIC_RESEARCH_REFRESH_RECOVERY_PASSED'],
  };
  for (const [name, [args, passState]] of Object.entries(expected)) {
    const value = acceptanceScenario(name);
    assert.deepEqual(value.args, args); assert.equal(value.passState, passState);
    assert.throws(() => value.args.push('--remaining'));
    assert.throws(() => value.media.push('private.pcm'));
  }
  for (const invalid of ['FULL', 'full --remaining', '', undefined, '__proto__', 'constructor']) {
    assert.throws(() => acceptanceScenario(invalid), /Invalid immutable public scenario/);
  }
});

test('full export selects both actual browser recordings before the bounded screenshot set', () => {
  assert.deepEqual(acceptanceScenario('full').media.slice(0, 2), ['A-actual-browser-output.webm', 'B-actual-browser-output.webm']);
  assert(acceptanceScenario('full').media.includes('A-original-source-box-and-ellipse.png'));
  assert(acceptanceScenario('full').media.includes('B-video-source-annotation.png'));
  assert(acceptanceScenario('full').media.includes('A-converted-slide-2.png'));
  assert(acceptanceScenario('full').media.includes('B-synthetic-microphone-response.png'));
  assert.deepEqual(acceptanceScenario('full').media.slice(-3), ['A-failure.png', 'B-failure.png', 'C-failure.png']);
  assert.deepEqual(acceptanceScenario('research-recovery').media, []);
});

test('export verifies each recording against its own visitor, including size and content', () => {
  const a = Buffer.from('synthetic output A'), b = Buffer.from('synthetic output B');
  const receipt = bytes => ({bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')});
  const report = {visitors: {A: {renderedRecording: receipt(a)}, B: {renderedRecording: receipt(b)}, R: {renderedRecording: receipt(a)}}};
  assert.doesNotThrow(() => verifyExportMedia('full', 'A-actual-browser-output.webm', a, report));
  assert.doesNotThrow(() => verifyExportMedia('full', 'B-actual-browser-output.webm', b, report));
  assert.doesNotThrow(() => verifyExportMedia('remaining', 'R-actual-browser-output.webm', a, report));
  assert.throws(() => verifyExportMedia('full', 'B-actual-browser-output.webm', a, report), /visitor report/);
  assert.throws(() => verifyExportMedia('full', 'A-actual-browser-output.webm', a.subarray(1), report), /visitor report/);
  assert.throws(() => verifyExportMedia('full', 'A-actual-browser-output.webm', a, {visitors: {}}), /visitor report/);
  assert.throws(() => verifyExportMedia('full', 'A-actual-browser-output.webm', a, {visitors: {A: {renderedRecording: {...receipt(a), bytes: a.length + 1}}}}), /visitor report/);
  for (const name of ['R-actual-browser-output.webm', '../report.json', 'B-synthetic-input-mono16000-s16le.pcm', 'private.json']) {
    assert.throws(() => verifyExportMedia('full', name, a, report), /allowlist/);
  }
});

test('packaged full fixture is the exact approved original PDF; altered PDF-shaped input is rejected', async () => {
  const bytes = await fs.readFile(new URL('../../' + FULL_PDF_FIXTURE.path, import.meta.url));
  assert.doesNotThrow(() => verifyFullPdf(bytes));
  const changed = Buffer.from(bytes); changed[changed.length - 1] ^= 1;
  assert.throws(() => verifyFullPdf(changed), /approved original PDF/);
  assert.throws(() => verifyFullPdf(bytes.subarray(1)), /approved original PDF/);
});
