import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {publicOrigin, redact, safeEvent, ObservedNativeStream, sha256, PLAN, REMAINING_PLAN, MICROPHONE_PLAN, spokenAnswer, inputTranscript, labEvidenceNarrated, originalSyntheticVideoNarrated, convertedSlideAnswerMatches, namesVisibleGraphLabels, RASTER_REPLAY_LIMITS, rasterReplayDelta, rasterReplayPreserved, playbackBoundaryObserved, playbackAfterReceipts, syntheticMicrophoneResponseObserved, sourceOwnedMarks, acknowledgedAction, missingCoverage, characterChunkPlan, characterChunkReceipt, allowedPublicRequest, freshBrowserStatus, readServerStatus, publicBrowserArgs, protocolAnswerMatches, promptAnswerEvidence} from './helpers.mjs';
import {NativeConversation} from '../../rehearsal/src/native-audio.js';
import {SpeechPlayer} from '../../rehearsal/src/speech-player.js';

const savedFullBytes = await fs.readFile(new URL('../../evidence/2026-10-18-public-acceptance/2026-10-18T07-48-13-092Z/report.json', import.meta.url));
const savedFull = JSON.parse(savedFullBytes);
function savedAnswer(id, label, lookAhead = false) {
  const visitor = savedFull.visitors[id], prompt = visitor.prompts.find(p => p.label === label);
  const checkpoint = visitor.checkpoints.find(c => c.name === label);
  const end = lookAhead ? Date.parse(prompt.at) + 65000 : Date.parse(checkpoint.at);
  const events = visitor.events.filter(event => Date.parse(event.at) >= Date.parse(prompt.at) && Date.parse(event.at) <= end);
  return {prompt, checkpoint, events, evidence: promptAnswerEvidence(label, prompt.at, events, checkpoint.visual)};
}

test('saved Hello receipt is insufficient for the first question; later content cannot repair its closed gate', () => {
  assert.equal(sha256(savedFullBytes), '27b199e9f570b98413c0ed40fb88342b64c3ad8319829bba25fab5ed11bfcd19');
  const old = savedAnswer('A', 'first typed native answer');
  assert.equal(old.evidence.receivedOutputText, 'Hello!');
  assert.equal(old.evidence.promptSpecificContentMatched, false);
  assert.equal(old.evidence.firstPromptSpecificContentReceived, null);
  assert.equal(old.evidence.firstAcknowledgementReceived.at, '2026-10-18T07:50:54.101Z');
  const later = savedAnswer('A', 'first typed native answer', true).evidence;
  assert.equal(later.promptSpecificContentMatched, true);
  assert(Date.parse(later.firstPromptSpecificContentReceived.at) > Date.parse(savedFull.visitors.A.prompts[1].at));
  assert.equal(old.evidence.promptSpecificContentMatched, false, 'lookahead never mutates or upgrades the original gate');
  assert.equal(savedFull.state, 'PUBLIC_OPENAI_PROTOCOL_PASSED');
});

test('saved video annotation prelude and prior comparison cannot satisfy marking and rewind answers', () => {
  const mark = savedAnswer('B', 'video source-ID annotation');
  assert.equal(mark.evidence.promptSpecificContentMatched, false);
  assert.match(mark.evidence.receivedOutputText, /One moment/);
  assert.equal(savedAnswer('B', 'video source-ID annotation', true).evidence.promptSpecificContentMatched, true);
  const rewind = savedAnswer('B', 'actual rewind and stale-mark cleanup');
  assert.equal(rewind.evidence.promptSpecificContentMatched, false);
  assert.match(rewind.evidence.receivedOutputText, /farther right than before/);
  const later = savedAnswer('B', 'actual rewind and stale-mark cleanup', true).evidence;
  assert.equal(later.promptSpecificContentMatched, true);
  assert(Date.parse(later.firstPromptSpecificContentReceived.at) > Date.parse(rewind.checkpoint.at));
});

test('saved content-correct answers retain their gates; only four recorded answer windows lack required content', () => {
  const insufficient = new Set(['first typed native answer', 'video source-ID annotation',
    'actual rewind and stale-mark cleanup', 'actual whiteboard dismissal']);
  let scored = 0;
  for (const [id, visitor] of Object.entries(savedFull.visitors)) for (const prompt of visitor.prompts) {
    if (!visitor.checkpoints.some(c => c.name === prompt.label)) continue;
    assert.equal(savedAnswer(id, prompt.label).evidence.promptSpecificContentMatched, !insufficient.has(prompt.label), prompt.label);
    scored++;
  }
  assert.equal(scored, 20);
});

test('every waiting fixture question rejects generic acknowledgements; greetings have their own intent', () => {
  for (const visitor of Object.values(savedFull.visitors)) for (const prompt of visitor.prompts) {
    const checkpoint = visitor.checkpoints.find(c => c.name === prompt.label);
    if (checkpoint) assert.equal(protocolAnswerMatches(prompt.label, [{direction: 'received', event: 'output_transcript', text: "Hello! Okay, I'll do that. One moment."}], checkpoint.visual), false, prompt.label);
  }
  assert.equal(protocolAnswerMatches('remaining-scenarios session start', [{direction: 'received', event: 'output_transcript', text: 'Hello!'}]), true);
  assert.throws(() => protocolAnswerMatches('unconfigured future question', []), /No prompt-specific/);
  const actual = savedAnswer('A', 'spoken multi-turn followup');
  assert.equal(actual.evidence.promptSpecificContentMatched, true);
  const untrusted = actual.events.map(event => ({...event, direction: 'sent'}));
  assert.equal(protocolAnswerMatches('spoken multi-turn followup', untrusted), false);
});

test('video predicates distinguish exact intended time, completed state, and actual motion direction', () => {
  const events = text => [{direction: 'received', event: 'output_transcript', text}];
  for (const text of ["One moment, I'll rewind.", "I'll rewind to one second.", 'Give me one second.', 'Two seconds.', 'The red square now sits farther right than before.']) {
    assert.equal(protocolAnswerMatches('actual rewind and stale-mark cleanup', events(text)), false, text);
  }
  for (const text of ['One second.', 'It is paused at 1 second.', 'The time is one second.']) {
    assert.equal(protocolAnswerMatches('actual rewind and stale-mark cleanup', events(text)), true, text);
  }
  for (const text of ['The red square now sits farther left than before.', 'The blue circle now sits farther right than before.', "I'll compare the red square farther right than before.", 'The red square has not moved farther right than before.']) {
    assert.equal(protocolAnswerMatches('video source-ID annotation', events(text)), false, text);
  }
  assert.equal(protocolAnswerMatches('video source-ID annotation', events('That red square now sits farther right than before.')), true);
  assert.equal(savedAnswer('B', 'actual whiteboard dismissal').evidence.promptSpecificContentMatched, false, 'an intent to hide is not a completed-state answer');
  assert.equal(savedAnswer('B', 'actual whiteboard dismissal', true).evidence.promptSpecificContentMatched, true);
});

test('content receipt, acknowledgement and visible action have independent clocks and no audible-word timestamp', () => {
  const start = '2026-10-18T12:00:00.000Z';
  const events = [
    {at: '2026-10-18T11:59:59.000Z', direction: 'received', event: 'output_transcript', text: 'A soap bubble is round because surface tension minimizes area.'},
    {at: '2026-10-18T12:00:00.100Z', direction: 'received', event: 'output_transcript', text: 'Hello! '},
    {at: '2026-10-18T12:00:00.200Z', direction: 'received', event: 'document_action', action: {kind: 'mark', action_id: 'test-mark', revision: 2, document_id: 'fixture'}},
    {at: '2026-10-18T12:00:00.300Z', direction: 'sent', type: 'document_result', action_id: 'test-mark', revision: 2, document_id: 'another-source', ok: true},
    {at: '2026-10-18T12:00:00.400Z', direction: 'sent', type: 'document_result', action_id: 'test-mark', revision: 2, document_id: 'fixture', ok: true},
    {at: '2026-10-18T12:00:01.000Z', direction: 'received', event: 'output_transcript', text: 'A soap bubble is round because surface tension minimizes area.'},
  ];
  const evidence = promptAnswerEvidence('first typed native answer', start, events);
  assert.equal(evidence.firstAcknowledgementReceived.elapsedMs, 100);
  assert.equal(evidence.firstVisibleActionReceipt.elapsedMs, 400);
  assert.equal(evidence.firstPromptSpecificContentReceived.elapsedMs, 1000);
  assert.equal(evidence.usefulAudibleWordOnsetMs, null);
  assert.equal(evidence.audioWordAttribution, 'UNVERIFIED_UNTAGGED_CONTINUOUS_PCM');
  assert(!evidence.receivedOutputText.includes('another-source'));
  assert.throws(() => promptAnswerEvidence('first typed native answer', 'invalid', events), /valid start/);
});

test('actual response wait rejects Hello and an old playback boundary even after useful text arrives', async () => {
  const source = await fs.readFile(new URL('./run.mjs', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('async function response('), source.indexOf('\nasync function type('));
  const start = '2026-10-18T12:00:00.000Z', helloAt = '2026-10-18T12:00:01.000Z', usefulAt = '2026-10-18T12:00:03.000Z';
  const before = {active: false, playbackBoundaries: 0, outputBytes: 0, renderedSignalSamples: 0, lastPlaybackBoundaryEpochMs: 0};
  const state = {active: true, continuousAudio: true, outputBytes: 100, renderedSignalSamples: 100, playbackBoundaries: 1,
    lastPlaybackBoundaryEpochMs: Date.parse(helloAt) + 200, lastPlaybackBoundaryReason: 'playback-drained', playerEntries: 0,
    audioPlaying: false, speaking: false, suppressAudio: false, audioFaceEvents: 1,
    lastTurn: {answer: 'Hello!', boundary: 'client-local-playback-idle', provider: 'OpenAI', model: 'gpt-live-1'}};
  const visitor = {data: {prompts: [{at: start, label: 'first typed native answer'}], events: []}};
  const decisions = []; let final;
  const response = runInNewContext(`(${body})`, {promptAnswerEvidence, playbackBoundaryObserved, playbackAfterReceipts, spokenAnswer, plan: PLAN,
    fresh: (v, index) => v.data.events.slice(index),
    async waitFor(v, predicate) {
      v.data.events.push({at: helloAt, direction: 'received', event: 'output_transcript', text: 'Hello! '});
      decisions.push(predicate(state));
      v.data.events.push({at: usefulAt, direction: 'received', event: 'output_transcript', text: 'A soap bubble is round because surface tension minimizes area.'});
      decisions.push(predicate(state));
      final = {...state, renderedSignalSamples: 200, playbackBoundaries: 2, lastPlaybackBoundaryEpochMs: Date.parse(usefulAt) + 200};
      decisions.push(predicate(final)); return final;
    }, assert: (_name, passed) => assert(passed), checkpoint: async () => final});
  await response(visitor, before, 0, 'first typed native answer');
  assert.deepEqual(decisions, [false, false, true]);
  assert.equal(visitor.data.prompts[0].answerEvidence.usefulAudibleWordOnsetMs, null);
});

test('isolated browser transport keeps default renderer flags and rejects arbitrary proxy or browser options', () => {
  assert.deepEqual(publicBrowserArgs(undefined), []);
  assert.deepEqual(publicBrowserArgs('system'), []);
  assert.deepEqual(publicBrowserArgs('direct'), ['--no-proxy-server']);
  const first = publicBrowserArgs('direct'); first.push('--synthetic-test');
  assert.deepEqual(publicBrowserArgs('direct'), ['--no-proxy-server']);
  for (const value of [null, '', 'DIRECT', 'https://proxy.example.org', '--disable-web-security']) {
    assert.throws(() => publicBrowserArgs(value), /arbitrary proxy or browser flags/);
  }
});

function statusPage(fetcher) {
  const timers = [];
  const context = {fetch: fetcher, AbortController,
    window: {__einstein: {stats: {nativeStatus: {cached: true}}}},
    setTimeout(callback, ms) { const timer = {callback, ms, cleared: false}; timers.push(timer); return timer; },
    clearTimeout(timer) { timer.cleared = true; }};
  return {timers, evaluate: fn => runInNewContext(`(${fn.toString()})()`, context)};
}

test('serialized status observer makes fresh same-cookie browser GETs and returns actual server JSON', async () => {
  const calls = [];
  const page = statusPage(async (url, options) => {
    calls.push({url, options}); return {status: 200, json: async () => ({active: false, available: false, request: calls.length})};
  });
  assert.deepEqual(await readServerStatus(page), {active: false, available: false, request: 1});
  assert.deepEqual(await readServerStatus(page), {active: false, available: false, request: 2});
  assert.equal(calls.length, 2);
  for (const {url, options} of calls) {
    assert.equal(url, '/api/native/status'); assert.equal(options.method, 'GET');
    assert.equal(options.cache, 'no-store'); assert.equal(options.credentials, 'same-origin');
    assert.equal(options.redirect, 'error'); assert.equal(options.signal.aborted, false);
  }
  assert(page.timers.every(timer => timer.ms === 5000 && timer.cleared));
});

test('serialized status observer refuses non-200, invalid JSON and network failures without retry or cached fallback', async () => {
  for (const code of [201, 204, 302, 403, 429, 503]) {
    let calls = 0;
    const page = statusPage(async () => { calls++; return {status: code, json: async () => { throw Error('Body must not be read.'); }}; });
    await assert.rejects(readServerStatus(page), new RegExp(`HTTP ${code}`)); assert.equal(calls, 1);
  }
  for (const json of [async () => { throw SyntaxError('Synthetic malformed JSON'); }, async () => null,
    async () => [], async () => 'cached']) {
    const page = statusPage(async () => ({status: 200, json}));
    await assert.rejects(readServerStatus(page), /invalid JSON/);
    assert(page.timers.every(timer => timer.cleared));
  }
  let calls = 0;
  const page = statusPage(async () => { calls++; throw TypeError('Synthetic network failure'); });
  await assert.rejects(readServerStatus(page), /network request failed/); assert.equal(calls, 1);
});

test('browser status deadline covers stalled headers or JSON body, aborts at 5000ms and rejects late success', async () => {
  for (const stallBody of [false, true]) {
    let signal, resolve, entered, bodyStarted = false;
    const stalled = new Promise(yes => { resolve = yes; });
    const bodyEntered = new Promise(yes => { entered = yes; });
    const page = statusPage(async (_url, options) => {
      signal = options.signal;
      return stallBody ? {status: 200, json: () => { bodyStarted = true; entered(); return stalled; }} : stalled;
    });
    const result = page.evaluate(freshBrowserStatus);
    const rejected = assert.rejects(result, /5000ms deadline/);
    if (stallBody) await bodyEntered;
    assert.equal(bodyStarted, stallBody);
    assert.equal(page.timers[0].ms, 5000); assert.equal(signal.aborted, false);
    page.timers[0].callback();
    await rejected; assert.equal(signal.aborted, true); assert.equal(page.timers[0].cleared, true);
    resolve(stallBody ? {active: false} : {status: 200, json: async () => ({active: false})});
    await Promise.resolve();
  }
});

test('host status deadline includes a page evaluation that never starts or never returns', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let called = 0, resolve;
  const pending = new Promise(yes => { resolve = yes; });
  const result = readServerStatus({evaluate(fn) { called++; assert.equal(fn, freshBrowserStatus); return pending; }});
  let settled = false; result.then(() => { settled = true; }, () => { settled = true; });
  const rejected = assert.rejects(result, /5000ms host deadline/);
  t.mock.timers.tick(4999); await Promise.resolve(); assert.equal(settled, false);
  t.mock.timers.tick(1); await rejected; assert.equal(called, 1);
  resolve({active: false, room_active_sessions: 0}); await Promise.resolve();
  await assert.rejects(result, /5000ms host deadline/);
});

test('PUBLIC run gate accepts one HTTPS DNS origin and refuses local, private, credential and path targets', () => {
  assert.equal(publicOrigin('https://einstein.example.org/'), 'https://einstein.example.org');
  for (const value of ['http://einstein.example.org', 'https://127.0.0.1', 'https://10.0.0.1', 'https://[::1]',
    'https://localhost', 'https://host.local', 'https://person:secret@example.org', 'https://example.org/path',
    'https://example.org?permit=token', 'https://example.org:8443']) assert.throws(() => publicOrigin(value));
});

test('artifacts strip credential-shaped strings and permit query strings; source images retain only hashes and sizes', () => {
  const key = 'AIza' + 'x'.repeat(35);
  const openAIKey = 'sk-proj-' + 'x'.repeat(35);
  const text = redact(`Failed ${key} ${openAIKey} Bearer token https://example.org/api/native/voice?permit=private`);
  assert(!text.includes(key)); assert(!text.includes('Bearer token')); assert(!text.includes('private'));
  assert(!text.includes(openAIKey));
  const event = safeEvent({type: 'document_result', ok: true, image: {mime_type: 'image/jpeg', data: Buffer.from('synthetic JPEG bytes').toString('base64')}, text: key});
  assert.equal(event.image.bytes, 20); assert.equal(event.image.sha256.length, 64); assert(!event.image.data);
  assert(!JSON.stringify(event).includes(key));
  assert.equal(PLAN.state, 'PREPARED_NOT_RUN'); assert.equal(PLAN.allocation.providerSessions, 2);
});

test('continuous speech requires new rendered signal and an actual drain or rendered-quiet boundary', () => {
  const before = {playbackBoundaries: 2, outputBytes: 100, renderedSignalSamples: 100, lastPlaybackBoundaryEpochMs: 1000};
  const after = {active: true, continuousAudio: true, playbackBoundaries: 3, outputBytes: 200,
    renderedSignalSamples: 200, renderedQuietMs: 0, lastPlaybackBoundaryEpochMs: 2000, lastPlaybackBoundaryReason: 'playback-drained',
    audioPlaying: false, speaking: false, suppressAudio: false, playerEntries: 0, completedTurns: 0,
    lastTurn: {answer: 'Actual spoken answer.', boundary: 'client-local-playback-idle'}};
  assert.equal(playbackBoundaryObserved(before, after), true);
  for (const change of [{playbackBoundaries: 2, completedTurns: 99}, {outputBytes: 100}, {audioPlaying: true},
    {playerEntries: 1}, {speaking: true}, {suppressAudio: true}, {continuousAudio: false},
    {renderedSignalSamples: 100}, {lastPlaybackBoundaryEpochMs: 1000}, {lastPlaybackBoundaryReason: 'timer'},
    {lastTurn: {answer: 'old answer', boundary: 'provider-turn-complete'}}, {lastTurn: {answer: ' ', boundary: 'client-local-playback-idle'}}]) {
    assert.equal(playbackBoundaryObserved(before, {...after, ...change}), false);
  }
  const quiet = {...after, lastPlaybackBoundaryReason: 'rendered-silence', renderedQuietMs: 450, playerEntries: 1};
  assert.equal(playbackBoundaryObserved(before, quiet), true, 'ongoing queued silent PCM does not prevent rendered-quiet acceptance');
  for (const change of [{renderedQuietMs: 449}, {renderedSignalSamples: 100}, {audioPlaying: true}, {lastPlaybackBoundaryEpochMs: 1000}]) {
    assert.equal(playbackBoundaryObserved(before, {...quiet, ...change}), false);
  }
  assert.equal(playbackBoundaryObserved({...before, renderedSignalSamples: 0}, {...quiet, renderedSignalSamples: 0}), false, 'initial all-zero PCM and growing packet counts are not audible output');
  const receipt = {direction: 'sent', type: 'document_result', at: '2026-10-16T12:00:01.000Z'};
  assert.equal(playbackAfterReceipts({lastPlaybackBoundaryEpochMs: Date.parse(receipt.at) - 1000}, [receipt]), false);
  assert.equal(playbackAfterReceipts({lastPlaybackBoundaryEpochMs: Date.parse(receipt.at) + 100}, [receipt]), true);
  assert.equal(playbackAfterReceipts({lastPlaybackBoundaryEpochMs: Date.parse(receipt.at)}, [{...receipt, at: 'invalid'}]), false);
  const laterContent = {direction: 'received', event: 'output_transcript', at: '2026-10-16T12:00:02.000Z', text: 'Substantive answer after prelude.'};
  assert.equal(playbackAfterReceipts({lastPlaybackBoundaryEpochMs: Date.parse(receipt.at)}, [receipt, laterContent]), false, 'new semantic text cannot reuse the prelude playback boundary');
  assert.equal(playbackAfterReceipts({lastPlaybackBoundaryEpochMs: Date.parse(laterContent.at) + 100}, [receipt, laterContent]), true);
});

test('source annotation gate requires both shapes and inspected same-page IDs', () => {
  const diagnostic = {tool: 'mark_selected_pdf', marks: ['box', 'ellipse'].map(kind => ({kind, region_id_known: true, region_id_matches_page: true}))};
  assert.equal(sourceOwnedMarks(diagnostic, ['box', 'ellipse']), true);
  assert.equal(sourceOwnedMarks({...diagnostic, marks: diagnostic.marks.slice(0, 1)}, ['box', 'ellipse']), false);
  for (const key of ['region_id_known', 'region_id_matches_page']) {
    assert.equal(sourceOwnedMarks({...diagnostic, marks: diagnostic.marks.map(mark => ({...mark, [key]: false}))}, ['box', 'ellipse']), false);
  }
});

test('renderer gate rejects stale, failed or wrong-source acknowledgements', () => {
  const request = {direction: 'received', event: 'document_action', action: {kind: 'mark', action_id: 'actual-action', revision: 3, document_id: 'actual-source'}};
  const result = {direction: 'sent', type: 'document_result', action_id: 'actual-action', revision: 3, document_id: 'actual-source', ok: true};
  assert.equal(acknowledgedAction([request, result], 'document', 'mark'), result);
  for (const change of [{action_id: 'stale'}, {revision: 2}, {document_id: 'different-source'}, {ok: false}]) {
    assert.equal(acknowledgedAction([request, {...result, ...change}], 'document', 'mark'), null);
  }
  const diagram = {direction: 'received', event: 'presentation_action', action: {kind: 'inspect', action_id: 'image', revision: 4}};
  const image = {direction: 'sent', type: 'presentation_result', action_id: 'image', revision: 4, status: 'inspected'};
  assert.equal(acknowledgedAction([diagram, image], 'presentation', 'inspect'), image);
  assert.equal(acknowledgedAction([diagram, {...image, status: 'displayed'}], 'presentation', 'inspect'), null);
});

test('complete protocol cannot pass with any missing or false coverage gate', () => {
  const coverage = Object.fromEntries(PLAN.requiredCoverage.map(key => [key, true]));
  assert.deepEqual(missingCoverage(coverage), []);
  for (const key of PLAN.requiredCoverage) assert.deepEqual(missingCoverage({...coverage, [key]: false}), [key]);
  assert.equal(Object.values(PLAN.expectedSpecialistCalls).reduce((sum, value) => sum + value, 0), 8);
  assert.equal(PLAN.expectedProviders.voice, 'gpt-live-1'); assert.equal(PLAN.expectedProviders.sourceVision, 'gpt-6.1-sol');
});

test('remaining scope requires all six own gates and cannot pass the full twelve-gate protocol', () => {
  assert.equal(PLAN.requiredCoverage.length, 12);
  assert.equal(PLAN.allocation.providerSessions, 2); assert.equal(PLAN.allocation.connectionAttempts, 3);
  assert.equal(REMAINING_PLAN.requiredCoverage.length, 6);
  const coverage = Object.fromEntries(REMAINING_PLAN.requiredCoverage.map(key => [key, true]));
  assert.deepEqual(missingCoverage(coverage, REMAINING_PLAN.requiredCoverage), []);
  assert.deepEqual(missingCoverage(coverage), ['consent-decline', 'spoken-multiturn', 'source-box-and-ellipse', 'video', 'isolation', 'capacity']);
  for (const key of REMAINING_PLAN.requiredCoverage) assert.deepEqual(missingCoverage({...coverage, [key]: false}, REMAINING_PLAN.requiredCoverage), [key]);
  assert.deepEqual(REMAINING_PLAN.allocation, {providerSessions: 1, connectionAttempts: 1, transportRenewals: 2, expectedCapacityDeniedAttempts: 0,
    specialistCalls: 5, presentationConversions: 1, wholeRunSeconds: 900, sessionSeconds: 570});
  assert.equal(Object.values(REMAINING_PLAN.expectedSpecialistCalls).reduce((sum, value) => sum + value, 0), 4);
  assert.equal(REMAINING_PLAN.passState, 'PUBLIC_REMAINING_SCENARIOS_PASSED');
  assert.equal(PLAN.passState, 'PUBLIC_OPENAI_PROTOCOL_PASSED');
  assert.equal(REMAINING_PLAN.gates.some(gate => gate.startsWith('EINSTEIN_PUBLIC_PDF=')), false);
  assert.equal(PLAN.gates.some(gate => gate.startsWith('EINSTEIN_PUBLIC_PDF=')), true);
});

test('microphone scope requires three own gates with one session and no specialists or conversions', () => {
  assert.equal(MICROPHONE_PLAN.state, 'PREPARED_NOT_RUN');
  assert.equal(MICROPHONE_PLAN.passState, 'PUBLIC_MICROPHONE_SCENARIOS_PASSED');
  assert.notEqual(MICROPHONE_PLAN.passState, PLAN.passState);
  assert.notEqual(MICROPHONE_PLAN.passState, REMAINING_PLAN.passState);
  assert.deepEqual(MICROPHONE_PLAN.allocation, {providerSessions: 1, connectionAttempts: 1, transportRenewals: 2,
    expectedCapacityDeniedAttempts: 0, specialistCalls: 0, presentationConversions: 0, wholeRunSeconds: 360, sessionSeconds: 180});
  assert.deepEqual(MICROPHONE_PLAN.expectedSpecialistCalls, {});
  assert.deepEqual(MICROPHONE_PLAN.requiredCoverage, ['synthetic-mic-local-overlap', 'responsive-security', 'cleanup']);
  const coverage = Object.fromEntries(MICROPHONE_PLAN.requiredCoverage.map(key => [key, true]));
  assert.deepEqual(missingCoverage(coverage, MICROPHONE_PLAN.requiredCoverage), []);
  for (const key of MICROPHONE_PLAN.requiredCoverage) {
    assert.deepEqual(missingCoverage({...coverage, [key]: false}, MICROPHONE_PLAN.requiredCoverage), [key]);
  }
  assert.deepEqual(missingCoverage(coverage), ['consent-decline', 'spoken-multiturn', 'source-box-and-ellipse', 'video',
    'two-slide-deck', 'conceptual-create-revise-focus-inspect-dismiss', 'official-lab-evidence', 'isolation', 'capacity']);
  assert.deepEqual(missingCoverage(coverage, REMAINING_PLAN.requiredCoverage),
    ['two-slide-deck', 'conceptual-create-revise-focus-inspect-dismiss', 'official-lab-evidence']);
  assert.equal(MICROPHONE_PLAN.gates.includes('--microphone-only'), true);
  assert.equal(MICROPHONE_PLAN.gates.some(gate => gate.startsWith('EINSTEIN_PUBLIC_PDF=')), false);
  assert.deepEqual(MICROPHONE_PLAN.gates.filter(gate => gate !== '--microphone-only'), REMAINING_PLAN.gates);
});

test('source-answer waits reject an acknowledgement and require actual numeric content plus scope', () => {
  const event = text => ({direction: 'received', event: 'output_transcript', text});
  const prelude = [event("I'll use the region reported on the inspected slide. ")];
  assert.equal(convertedSlideAnswerMatches(spokenAnswer(prelude), 1), false);
  const answer = spokenAnswer([...prelude, event('Input leads to Outcome; A is two and B is five. '),
    event('These are synthetic test values in a LibreOffice conversion.'),
    {direction: 'sent', event: 'output_transcript', text: 'untrusted sent text'},
    {direction: 'received', event: 'document_inspected', text: 'source metadata is not a spoken answer'}]);
  assert.equal(convertedSlideAnswerMatches(answer, 1), true);
  assert(!answer.includes('untrusted sent') && !answer.includes('source metadata'));
  for (const invalid of ['Input leads to Outcome; A=2, B=9. Synthetic LibreOffice conversion.',
    'Input leads to Outcome; A=2, B=5.', 'A=2 and B=5; synthetic LibreOffice conversion.']) assert.equal(convertedSlideAnswerMatches(invalid, 1), false);
  const slide2 = 'Dose leads to Response: Control is three and Treatment seven arbitrary units; synthetic test values.';
  assert.equal(convertedSlideAnswerMatches(slide2, 2), true);
  for (const invalid of [slide2.replace('seven', 'eight'), slide2.replace('arbitrary units', ''), slide2.replace('synthetic test values', 'observations')]) assert.equal(convertedSlideAnswerMatches(invalid, 2), false);
  assert.equal(convertedSlideAnswerMatches(slide2, 3), false);
});

test('microphone recognition joins only actual received input deltas', () => {
  const chunk = text => ({direction: 'received', event: 'input_transcript', text});
  const events = [chunk('a soap bub'), chunk('ble is ro'), chunk('und'),
    {direction: 'sent', event: 'input_transcript', text: 'ignored'},
    {direction: 'received', event: 'output_transcript', text: 'ignored'}];
  assert.equal(inputTranscript(events), 'a soap bubble is round');
  assert.equal(/bubble|round/i.test(inputTranscript(events)), true);
});

test('synthetic microphone completion requires one utterance and rendered signal after input ends', () => {
  const before = {playbackBoundaries: 2, outputBytes: 100, renderedSignalSamples: 100,
    lastPlaybackBoundaryEpochMs: 1000, playerVersion: 3, nativeUtterances: 0};
  const after = {active: true, continuousAudio: true, playbackBoundaries: 3, outputBytes: 200,
    renderedSignalSamples: 200, renderedEpochSignalSamples: 50, renderedQuietMs: 450,
    lastPlaybackBoundaryEpochMs: 2100, lastPlaybackBoundaryReason: 'rendered-silence',
    audioPlaying: false, speaking: false, suppressAudio: false, playerEntries: 1, playerVersion: 5, nativeUtterances: 1,
    lastTurn: {answer: 'Surface tension makes the bubble round.', boundary: 'client-local-playback-idle'}};
  const events = [
    {direction: 'received', event: 'input_transcript', text: 'Why is a soap bub', at: new Date(1200).toISOString()},
    {direction: 'received', event: 'input_transcript', text: 'ble round?', at: new Date(1300).toISOString()},
    {direction: 'received', event: 'output_transcript', text: after.lastTurn.answer, at: new Date(2000).toISOString()},
  ];
  assert.equal(syntheticMicrophoneResponseObserved(before, after, events), true);
  assert.equal(playbackBoundaryObserved(before, {...after, renderedEpochSignalSamples: 0}), true,
    'the old cumulative gate accepts earlier binary-search speech plus silent resumed output');
  for (const change of [{renderedEpochSignalSamples: 0}, {playerVersion: 4}, {playerVersion: 6},
    {nativeUtterances: 0}, {nativeUtterances: 2}, {lastPlaybackBoundaryEpochMs: 1800},
    {lastTurn: {...after.lastTurn, answer: 'Binary search halves the search space.'}}]) {
    assert.equal(syntheticMicrophoneResponseObserved(before, {...after, ...change}, events), false);
  }
  assert.equal(syntheticMicrophoneResponseObserved(before, after, events.slice(0, 2)), false, 'a stale answer cannot substitute for fresh output text');
  assert.equal(syntheticMicrophoneResponseObserved(before, after, events.slice(2)), false, 'output text cannot substitute for captured input');
  assert.equal(syntheticMicrophoneResponseObserved(before, after, events.map(event => ({...event, direction: 'sent'}))), false);
});

test('real local speech lifecycle resets the playback epoch twice while retaining cumulative signal', () => {
  const stats = {audioPlaying: true, audioRenderedSignalSamples: 100};
  const player = new SpeechPlayer(null, () => {}, stats); player.continuousAudio = true;
  player.lastRenderedSignalSamples = 100;
  const native = new NativeConversation({player, stats, onEvent() {}, onState() {}, onError() {}});
  native.active = true; native.continuousAudio = true;
  const version = player.version;
  player.updateStreamState({epoch: version, signalSamples: 150, hasSignal: true, quietMs: 0, queuedMs: 0});
  native.detectSpeech(.08, .15, 100);
  assert.equal(player.version, version + 1);
  assert.equal(native.speaking, true);
  native.detectSpeech(0, .1, 551);
  assert.equal(player.version, version + 2);
  assert.equal(stats.nativeUtterances, 1);
  assert.equal(native.speaking, false); assert.equal(native.suppressAudio, false);
  assert.equal(player.lastRenderedSignalSamples, 0);
  assert.equal(stats.audioRenderedSignalSamples, 150);
});

test('lab narration requires new evidence and expectation content after actual research receipt', () => {
  const spoken = text => ({direction: 'received', event: 'output_transcript', text});
  const receipt = {direction: 'received', event: 'research_complete', status: 'source-bound'};
  const answer = 'The official source reports a documented study of driving feedback. Its stated aim is to improve driver awareness; the expected safety benefit is not a demonstrated outcome in that source.';
  assert.equal(labEvidenceNarrated([receipt, spoken(answer)]), true);
  const bounded = 'The official VR for Relaxation page reports reduced perceived stress after one session, a documented result, while lasting effects beyond the tested durations remain unestablished.';
  assert.equal(labEvidenceNarrated([receipt, spoken(bounded)]), true);
  assert.equal(labEvidenceNarrated([receipt, spoken(bounded.replace("remain unestablished", "were established"))]), false);
  assert.equal(labEvidenceNarrated([spoken(answer), receipt]), false);
  assert.equal(labEvidenceNarrated([receipt, spoken('I will check those findings.')]), false);
  assert.equal(labEvidenceNarrated([{...receipt, status: 'unavailable'}, spoken(answer)]), false);
  assert.equal(labEvidenceNarrated([receipt, {...spoken(answer), direction: 'sent'}]), false);
  assert.equal(labEvidenceNarrated([receipt, spoken('The official source reports measured results. '.repeat(4))]), false);
});

test('synthetic video narration follows inspected pixels and rejects phantom objects or early descriptions', () => {
  const spoken = text => ({direction: 'received', event: 'output_transcript', text});
  const inspected = {direction: 'received', event: 'video_inspected'};
  const answer = spoken('The original frame shows a red square on the left and a blue circle on the right.');
  assert.equal(originalSyntheticVideoNarrated([spoken('One moment while I inspect the frame.'), inspected, answer]), true);
  for (const events of [[answer], [answer, inspected], [spoken('A cat walks across a couch.'), inspected, answer],
    [inspected, spoken('The red square is on a sofa, next to a blue circle.')],
    [spoken('The red square is visible.'), inspected, answer], [inspected, spoken('A red circle and a blue square.')],
    [inspected, {...answer, direction: 'sent'}]]) assert.equal(originalSyntheticVideoNarrated(events), false);
});

test('image-answer wait requires two distinct complete labels from the actual visible graph', () => {
  const visual = {visible: true, graph: {nodes: [{label: 'Air pressure'}, {label: 'Surface tension'}, {label: 'Round bubble'}]}};
  assert.equal(namesVisibleGraphLabels('I will inspect the diagram.', visual), false);
  assert.equal(namesVisibleGraphLabels('Air pressure and Surface tension are visible.', visual), true);
  assert.equal(namesVisibleGraphLabels('Air pressure and unrelated value.', visual), false);
  assert.equal(namesVisibleGraphLabels('Air pressure and Surface tension.', {...visual, visible: false}), false);
  assert.equal(namesVisibleGraphLabels('Air pressure, Air pressure.', {visible: true, graph: {nodes: [{label: 'Air pressure'}, {label: 'Air pressure'}]}}), false);
  assert.equal(namesVisibleGraphLabels('Air pressure and Surface tensions.', visual), false);
});

test('raster replay allows only the calibrated tiny near-neutral band and preserves identity, geometry and source display', async () => {
  const {width, height} = RASTER_REPLAY_LIMITS;
  const source = new Uint8ClampedArray(width * height * 4).fill(255);
  const reference = {width, height, rgba: source};
  const snapshot = hash => ({document: {id: 'selected-pdf', page: 1, pages: 2, sourceKind: 'converted-pptx'},
    original: {width, height, sha256: hash}, displayed: {width, height, sha256: hash}});
  const compare = async rgba => {
    const delta = await rasterReplayDelta({reference, current: {width, height, rgba}});
    const before = snapshot(delta.referenceSha256), after = snapshot(delta.currentSha256);
    return {delta, before, after, passed: rasterReplayPreserved(before, after, delta)};
  };
  const allowed = source.slice();
  for (let i = 0; i < 66; i++) allowed.fill(245, i * 4, i * 4 + 3);
  const good = await compare(allowed);
  assert.equal(good.passed, true); assert.equal(good.delta.changedPixels, 66); assert.equal(good.delta.maxChannelDelta, 10);
  for (const change of [{document: {...good.after.document, id: 'another-pdf'}},
    {document: {...good.after.document, page: 2}}, {original: {...good.after.original, width: width - 1}},
    {displayed: {...good.after.displayed, sha256: 'a'.repeat(64)}}]) assert.equal(rasterReplayPreserved(good.before, {...good.after, ...change}, good.delta), false);
  const colored = source.slice(); colored[0] = 245;
  assert.equal((await compare(colored)).passed, false, 'chromatic changes exceed the observed signed RGB spread');
  const larger = allowed.slice(); larger.fill(254, 66 * 4, 66 * 4 + 3);
  assert.equal((await compare(larger)).passed, false, '67 changed pixels exceed the fixed observed band');
  const stronger = source.slice(); stronger.fill(244, 0, 3);
  assert.equal((await compare(stronger)).passed, false, 'a channel delta of 11 is rejected');
  const alpha = source.slice(); alpha[3] = 254;
  assert.equal((await compare(alpha)).passed, false, 'alpha changes are rejected');
  const differentGeometry = await rasterReplayDelta({reference, current: {width: width - 1, height, rgba: allowed}});
  assert.equal(differentGeometry.valid, false); assert.equal(rasterReplayPreserved(good.before, good.after, differentGeometry), false);
});

test('Playwright call logs cannot retain visitor cookies or authorization headers', () => {
  const value = redact('\u001b[2m - cookie: einstein_visitor=anonymous-cookie-fixture\u001b[22m\n - Authorization: Bearer authorization-fixture\nurl https://example.org/a?permit=permit-fixture');
  assert(!value.includes('anonymous-cookie-fixture')); assert(!value.includes('authorization-fixture')); assert(!value.includes('permit-fixture')); assert(!value.includes('\u001b'));
});

test('repository synthetic media and two-slide deck match their recorded source bytes', async () => {
  const manifest = JSON.parse(await fs.readFile(new URL('fixtures/manifest.json', import.meta.url)));
  for (const fixture of [manifest.video, manifest.microphone]) {
    assert(!fixture.file.includes('/'));
    const bytes = await fs.readFile(new URL('fixtures/' + fixture.file, import.meta.url));
    assert.equal(bytes.length, fixture.bytes); assert.equal(sha256(bytes), fixture.sha256);
  }
  const deck = JSON.parse(await fs.readFile(new URL('fixtures/steering-walkthrough.json', import.meta.url)));
  const bytes = await fs.readFile(new URL('fixtures/steering-walkthrough.pptx', import.meta.url));
  assert.equal(bytes.length, deck.bytes); assert.equal(sha256(bytes), deck.sha256);
  assert.equal(deck.validated_slides, 2); assert.deepEqual(deck.expected_navigation, [1, 2, 1]);
});

test('CDN request allowance contains only the pinned manifest GETs without credentials or query strings', async () => {
  const manifest = JSON.parse(await fs.readFile(new URL('../../rehearsal/src/character-transfer.json', import.meta.url)));
  const inputs = JSON.parse(await fs.readFile(new URL('../../deploy/release-inputs.json', import.meta.url)));
  const pin = inputs.assets.find(asset => asset.name === 'einstein.glb');
  const plan = characterChunkPlan(manifest, pin);
  assert.equal(plan.urls.size, 14);
  const app = 'https://einstein-mobiliar-lab.fastapicloud.dev', url = new URL(plan.urls.keys().next().value);
  const request = {origin: url.origin, path: url.pathname, method: 'GET', hasQuery: false, credentialHeadersPresent: false};
  assert.equal(allowedPublicRequest(request, app, plan), true);
  for (const change of [{origin: 'https://other.example.org'}, {path: url.pathname + '/unlisted'}, {method: 'POST'}, {hasQuery: true}, {credentialHeadersPresent: true}, {credentialHeadersPresent: undefined}]) {
    assert.equal(allowedPublicRequest({...request, ...change}, app, plan), false);
  }
  assert.equal(allowedPublicRequest({...request, origin: app, method: 'POST'}, app, plan), true);
  for (const change of [{origin: 'https://other.example.org'}, {pathPrefix: '/character/../escape/'}, {bytes: 1}, {sha256: 'a'.repeat(64)}, {chunks: []},
    {chunks: [{...manifest.chunks[0], name: '../escape.bin'}, ...manifest.chunks.slice(1)]}]) {
    assert.throws(() => characterChunkPlan({...manifest, ...change}, pin));
  }
});

test('CDN byte receipt independently reassembles actual response bodies and rejects missing or altered bytes', () => {
  // Small offline byte fixture; the public manifest has a separate fixed-asset gate.
  const values = [Buffer.from('original left'), Buffer.from('original right')];
  const combined = Buffer.concat(values);
  const chunks = values.map((bytes, index) => ({name: String(index), bytes: bytes.length, sha256: sha256(bytes)}));
  const plan = {bytes: combined.length, sha256: sha256(combined), chunks};
  const parts = new Map(values.map((bytes, index) => [String(index), bytes]));
  assert.equal(characterChunkReceipt(plan, parts).sha256, sha256(combined));
  assert.throws(() => characterChunkReceipt(plan, new Map([['0', values[0]]])));
  assert.throws(() => characterChunkReceipt(plan, new Map([['0', Buffer.from('changed left!')], ['1', values[1]]])));
  assert.throws(() => characterChunkReceipt({...plan, sha256: 'a'.repeat(64)}, parts));
  assert.throws(() => characterChunkReceipt({...plan, bytes: combined.length + 1}, parts));
});


test('renewed native carriers strip private controls and count ordered application events once', () => {
  const stream = new ObservedNativeStream(), secret = 'private-renewal-ticket';
  assert.deepEqual(stream.receive({event: 'transport_ready', ticket: secret}), []);
  const first = {event: 'connected', transport_seq: 1, conversation_id: 'A', provider: 'OpenAI', model: 'gpt-live-1'}, second = {event: 'audio', transport_seq: 2, data: 'AA=='}, third = {event: 'document_action', transport_seq: 3};
  assert.deepEqual(stream.receive(first), [first]);
  assert.deepEqual(stream.receive(third), []);
  assert.deepEqual(stream.receive({event: 'transport_fenced'}), []);
  assert.deepEqual(stream.receive({event: 'transport_ready', ticket: secret}), []);
  assert.deepEqual(stream.receive(second), [second, third]);
  assert.deepEqual(stream.receive(second), []);
  assert.equal(stream.duplicates, 1); assert.equal(stream.lastSequence, 3);
  assert.equal(stream.pending.size, 0); assert.equal(stream.pendingBytes, 0);
  assert(!JSON.stringify(stream).includes(secret));
  for (const transport_seq of [0, -1, NaN, Infinity, '4']) assert.throws(() => stream.receive({event: 'audio', transport_seq}));
  assert.throws(() => stream.receive({event: 'audio'}));
  assert.throws(() => stream.receive({event: 'transport_unknown', ticket: secret}));
  assert.throws(() => stream.receive({event: 'audio', transport_seq: 5, data: 'x'.repeat(1024 * 1024)}));
  assert.throws(() => stream.receive({...first, conversation_id: 'B'}));
  assert.throws(() => stream.receive({...first, provider: 'other'}));
  assert.throws(() => stream.receive({...first, model: 'other'}));
  assert.deepEqual(stream.receive(first), []);
  assert.throws(() => stream.receive({event: 'connected', transport_seq: 1}));
  assert.deepEqual(new ObservedNativeStream().receive({event: 'notice'}), [{event: 'notice'}]);
});


test('all live protocol scopes reject missing or stock voice pins before browser or provider setup', () => {
  for (const scope of [[], ['--remaining'], ['--microphone-only']]) {
    for (const voice of ['', 'flitz']) {
      const child = spawnSync(process.execPath, [fileURLToPath(new URL('./run.mjs', import.meta.url)), '--run', ...scope], {
        encoding: 'utf8', timeout: 5000, env: {
          EINSTEIN_PUBLIC_READY: '1', EINSTEIN_PUBLIC_BUDGET_APPROVED: '1',
          EINSTEIN_PUBLIC_URL: 'https://einstein-mobiliar-lab.fastapicloud.dev',
          EINSTEIN_PUBLIC_VOICE_ID: voice,
        },
      });
      assert.equal(child.status, 1);
      assert.match(child.stderr, /Pin the approved custom voice ID\. No browser opened\./);
    }
  }
});
