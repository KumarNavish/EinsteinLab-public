// PREPARED ONLY. --plan is offline; --run requires the explicit PUBLIC READY gates.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {PLAN, REMAINING_PLAN, MICROPHONE_PLAN, spokenAnswer, labEvidenceNarrated, originalSyntheticVideoNarrated, convertedSlideAnswerMatches, namesVisibleGraphLabels, RASTER_REPLAY_LIMITS, rasterReplayDelta, rasterReplayPreserved, publicOrigin, redact, safeEvent, ObservedNativeStream, sha256, playbackBoundaryObserved, playbackAfterReceipts, syntheticMicrophoneResponseObserved, sourceOwnedMarks, missingCoverage, acknowledgedAction, CHARACTER_APP_ORIGIN, characterChunkPlan, characterChunkReceipt, allowedPublicRequest, readServerStatus, publicBrowserArgs, ANSWER_MEASUREMENT_VERSION, promptAnswerEvidence} from './helpers.mjs';

const remaining = process.argv.includes('--remaining');
const microphoneOnly = process.argv.includes('--microphone-only');
if (remaining && microphoneOnly) throw Error('Choose one protocol scope.');
const focused = remaining || microphoneOnly;
const plan = microphoneOnly ? MICROPHONE_PLAN : remaining ? REMAINING_PLAN : PLAN;
const successState = plan.passState;
if (!process.argv.includes('--run')) { console.log(JSON.stringify(plan, null, 2)); process.exit(0); }
if (process.env.EINSTEIN_PUBLIC_READY !== '1' || process.env.EINSTEIN_PUBLIC_BUDGET_APPROVED !== '1') {
  throw Error('No browser or provider was opened. Wait for PUBLIC READY and explicit approval of the recorded allocation.');
}
const origin = publicOrigin(process.env.EINSTEIN_PUBLIC_URL);
const expectedVoice = process.env.EINSTEIN_PUBLIC_VOICE_ID;
if (!/^voice_[A-Za-z0-9_-]{1,128}$/.test(expectedVoice || '')) throw Error('Pin the approved custom voice ID. No browser opened.');
const browserArgs = publicBrowserArgs(process.env.EINSTEIN_PUBLIC_BROWSER_TRANSPORT);
const repo = fileURLToPath(new URL('../../', import.meta.url));
const deployment = {id: process.env.EINSTEIN_PUBLIC_DEPLOYMENT_ID, sourceCommit: process.env.EINSTEIN_PUBLIC_RELEASE_SHA};
if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(deployment.id || '') || !/^[a-f0-9]{40}$/.test(deployment.sourceCommit || '')) {
  throw Error('Set the owner-verified final deployment ID and exact source SHA. No browser opened.');
}
try {
  execFileSync('git', ['merge-base', '--is-ancestor', deployment.sourceCommit, 'HEAD'], {cwd: repo});
  execFileSync('git', ['diff', '--exit-code', deployment.sourceCommit, '--', 'lab_backend', 'rehearsal', 'deploy', 'scripts/build_fastapi_bundle.py', 'tools/build_slides_runtime.py', 'THIRD_PARTY_NOTICES.md'], {cwd: repo, stdio: 'pipe'});
} catch { throw Error('The deployed source must be an ancestor with identical tracked runtime inputs. No browser opened.'); }
const releaseInputs = JSON.parse(await fs.readFile(path.join(repo, 'deploy/release-inputs.json'), 'utf8'));
const indexBytes = await fs.readFile(path.join(repo, 'rehearsal/dist/index.html'));
const entryPaths = [...indexBytes.toString().matchAll(/(?:src|href)="(\/assets\/[^"?]+)"/g)].map(match => match[1]);
if (!entryPaths.some(name => name.endsWith('.js'))) throw Error('Build the reviewed frontend before public acceptance. No browser opened.');
const expectedAssets = Object.fromEntries(await Promise.all(entryPaths.map(async name => {
  const bytes = await fs.readFile(path.join(repo, 'rehearsal/dist', name));
  return [name, {bytes: bytes.length, sha256: sha256(bytes)}];
})));
const character = releaseInputs.assets.find(asset => asset.name === 'einstein.glb');
expectedAssets['/assets/einstein.glb'] = {bytes: character.bytes, sha256: character.sha256};
const characterTransfer = origin === CHARACTER_APP_ORIGIN ? characterChunkPlan(JSON.parse(await fs.readFile(path.join(repo, 'rehearsal/src/character-transfer.json'), 'utf8')), character) : null;
const output = path.join(repo, `evidence/${new Date().toISOString().slice(0, 10)}-public-acceptance`, new Date().toISOString().replace(/[:.]/g, '-'));
const fixture = {
  pdf: process.env.EINSTEIN_PUBLIC_PDF,
  video: process.env.EINSTEIN_PUBLIC_VIDEO || path.join(repo, 'qa/public-acceptance/fixtures/original-synthetic.webm'),
  pptx: process.env.EINSTEIN_PUBLIC_PPTX || path.join(repo, 'qa/public-acceptance/fixtures/steering-walkthrough.pptx'),
  microphone: process.env.EINSTEIN_PUBLIC_MIC_WAV || path.join(repo, 'qa/public-acceptance/fixtures/authored-microphone.wav'),
};
if (focused) { delete fixture.pdf; delete fixture.video; }
if (microphoneOnly) delete fixture.pptx;
const figurePage = Number(process.env.EINSTEIN_PUBLIC_FIGURE_PAGE || '2');
if (!Number.isInteger(figurePage) || figurePage < 1 || figurePage > 200) throw Error('Choose a valid source figure page.');
for (const [name, filename] of Object.entries(fixture)) {
  if (!filename) throw Error(`Set EINSTEIN_PUBLIC_${name.toUpperCase()} to an authorized public/synthetic fixture. No browser opened.`);
  const stat = await fs.stat(filename).catch(() => null);
  if (!stat?.isFile() || stat.size < 32) throw Error(`Missing ${name} fixture. No browser opened.`);
  const maximum = {pdf: 20, video: 80, pptx: 8, microphone: 20}[name] * 1024 * 1024;
  if (stat.size > maximum) throw Error(`${name} fixture exceeds its approved input limit. No browser opened.`);
  const prefix = (await fs.readFile(filename)).subarray(0, 16);
  if (name === 'pdf' && !prefix.toString('ascii').startsWith('%PDF-')) throw Error('The source fixture is not an original PDF. No browser opened.');
  if (name === 'pptx' && prefix.subarray(0, 2).toString('ascii') !== 'PK') throw Error('The deck fixture is not a PPTX ZIP. No browser opened.');
  if (name === 'microphone' && (prefix.subarray(0, 4).toString('ascii') !== 'RIFF' || prefix.subarray(8, 12).toString('ascii') !== 'WAVE')) throw Error('The microphone fixture must be the authored WAV. No browser opened.');
}
const {chromium} = await import('../../rehearsal/node_modules/@playwright/test/index.mjs');
await fs.mkdir(output, {recursive: true});
const report = {state: 'RUNNING_UNVERIFIED', origin, mode: microphoneOnly ? 'microphone' : remaining ? 'remaining' : 'full', plan, requiredCoverage: [...plan.requiredCoverage], startedAt: new Date().toISOString(),
  execution: {platform: process.platform, runnerOS: process.env.RUNNER_OS || null, runnerLabel: process.env.PUBLIC_RUNNER || null, browserTransport: process.env.EINSTEIN_PUBLIC_BROWSER_TRANSPORT || 'system', baseBrowserArgs: [...browserArgs]},
  fixtures: {}, visitors: {}, checks: [], stages: [], limits: [], providerSessions: 0,
  connectionAttempts: 0, transportRenewals: 0, specialistCalls: 0, presentationConversions: 0, timing: {}, coverage: {},
  feedback: {state: 'NOT_REQUESTED_PREVIOUS_KEYLESS_OWNER_READBACK_PASSED', previousRequestId: '915ea6fc-937a-4d64-bf6a-fde9d574c431'},
  ownerVerifiedDeployment: deployment, expectedVoice, expectedAccent: 'german', expectedServedAssets: expectedAssets,
  expectedCharacterTransfer: characterTransfer ? {origin: characterTransfer.origin, pathPrefix: characterTransfer.pathPrefix, bytes: characterTransfer.bytes, sha256: characterTransfer.sha256, chunks: characterTransfer.chunks} : 'original-same-origin-GLB'};
report.notExercisedCoverage = PLAN.requiredCoverage.filter(key => !plan.requiredCoverage.includes(key));
report.harness = {};
report.answerMeasurement = {version: ANSWER_MEASUREMENT_VERSION,
  receivedContent: 'First accumulated received transcript that meets this fixture-specific prompt predicate; not semantic certification or audible word onset.',
  renderedSignal: 'First polled fresh rendered signal, independent of received text. It can be an acknowledgement or unattributable earlier output.',
  visibleAction: 'First matching successful browser renderer ACK; receipt time follows rendering, not its exact visual onset.',
  audioWordAttribution: 'Unknown: continuous output PCM has no response IDs or word timing. Co-observation of text and rendered signal does not establish audible alignment.'};
for (const name of ['run.mjs', 'helpers.mjs']) report.harness[name] = sha256(await fs.readFile(new URL(name, import.meta.url)));
for (const [name, filename] of Object.entries(fixture)) {
  const data = await fs.readFile(filename); report.fixtures[name] = {name: path.basename(filename), bytes: data.length, sha256: sha256(data)};
}
report.fixtures.microphone.authoredText = 'For this public test, please explain in one short sentence why a soap bubble is round. Then wait.';
report.fixtures.microphone.origin = 'Locally authored synthetic system speech; 1.5-second leading silence and 120-second trailing silence. No human recording.';
const until = Date.now() + plan.allocation.wholeRunSeconds * 1000;
const activeUntil = until - 45000; // Reserve time for confirmed provider close, local cleanup and receipts.
const visitors = [];
let fatal = null;
let firstSlideRaster = null;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function flush() { await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
function assert(name, passed, evidence = {}) {
  report.checks.push({at: new Date().toISOString(), name, passed: Boolean(passed), ...evidence});
  if (!passed) throw Error(name);
}
function cover(key, passed, evidence = {}) { assert(key, passed, evidence); report.coverage[key] = true; }
async function closeAtLimit(reason) {
  fatal = reason;
  await Promise.allSettled(visitors.filter(v => !v.closed).map(async visitor => {
    const state = await read(visitor).catch(() => null);
    if (state?.active || state?.connecting) { await dismissDialogs(visitor); await visitor.page.click('#interrupt', {timeout: 5000}); }
  }));
}
const cleanupWatchdog = setTimeout(() => { void closeAtLimit('Whole-run active deadline reached; close and save receipts.'); }, Math.max(1, activeUntil - Date.now())); cleanupWatchdog.unref();
const hardWatchdog = setTimeout(() => { fatal = 'Whole-run hard deadline reached.'; for (const v of visitors) void v.browser.close(); }, Math.max(1, until - Date.now())); hardWatchdog.unref();
function budget() {
  if (fatal) throw Error(fatal);
  if (Date.now() > activeUntil) throw Error('Public workflow deadline reached; remaining time is reserved for cleanup.');
  if (report.providerSessions > plan.allocation.providerSessions || report.connectionAttempts > plan.allocation.connectionAttempts || report.transportRenewals > plan.allocation.transportRenewals || report.specialistCalls > plan.allocation.specialistCalls || report.presentationConversions > plan.allocation.presentationConversions) throw Error('Public allocation exceeded.');
  for (const visitor of visitors) if (visitor.connectedAt && !visitor.stopped && Date.now() - visitor.connectedAt > (plan.allocation.sessionSeconds - 20) * 1000) throw Error('Native visitor active deadline reached; reserve 20s for final usage.');
}
async function waitFor(visitor, predicate, label, seconds = 50, allowInactive = false) {
  const deadline = Math.min(activeUntil, Date.now() + seconds * 1000);
  while (Date.now() < deadline) {
    budget(); const value = await read(visitor);
    if (await predicate(value)) return value;
    if (!allowInactive && !value.active && !value.connecting) throw Error(`Visitor ${visitor.id} closed during ${label}`);
    await pause(200);
  }
  throw Error(`Bounded wait expired: ${visitor.id} ${label}`);
}
async function read(visitor) {
  return visitor.page.evaluate(() => {
    const a = window.__einstein;
    return {active: a.native.active, connecting: a.native.connecting, visibility: document.visibilityState,
      completedTurns: a.stats.nativeCompletedTurns || 0, outputBytes: a.stats.nativeOutputBytes || 0,
      continuousAudio: a.native.continuousAudio === true, provider: a.stats.nativeProvider,
      playbackBoundaries: a.stats.nativePlaybackBoundaries || 0,
      lastPlaybackBoundaryEpochMs: Number.isFinite(a.stats.nativeLastPlaybackBoundaryAt) ? performance.timeOrigin + a.stats.nativeLastPlaybackBoundaryAt : null,
      lastPlaybackBoundaryReason: a.stats.nativeLastPlaybackBoundaryReason,
      renderedSignalSamples: a.stats.audioRenderedSignalSamples || 0,
      renderedEpochSignalSamples: a.player.lastRenderedSignalSamples || 0,
      renderedQuietMs: a.stats.audioRenderedQuietMs || 0,
      localOverlaps: a.stats.nativeLocalOverlaps || 0, localSpeechGates: a.stats.nativeLocalSpeechGates || 0,
      suppressedAudioPackets: a.stats.nativeSuppressedAudioPackets || 0,
      speaking: a.native.speaking, suppressAudio: a.native.suppressAudio,
      playerEntries: a.player.entries.length, playerVersion: a.player.version, generation: a.native.generation,
      inputBytes: a.stats.nativeInputBytes || 0, audioPlaying: a.stats.audioPlaying,
      microphoneActive: a.stats.microphoneActive, microphoneStream: Boolean(a.native.stream),
      nativeUtterances: a.stats.nativeUtterances || 0,
      avatarReady: a.stats.avatarReady, model: a.stats.nativeModel, voice: a.stats.nativeVoice,
      conversationId: a.stats.nativeConversationId, audioFaceEvents: a.stats.audioFaceEvents,
      socketClose: a.stats.nativeSocketClose,
      audioFaceClasses: a.stats.audioFaceClasses, lastTurn: a.stats.lastTurn,
      document: a.stats.document, video: a.stats.video, visual: a.stats.visual,
      presentationActions: a.stats.presentationActions || [], visualImageInspections: a.stats.visualImageInspections || 0,
      inspectionFailure: a.stats.nativeInspectionFailure, actionFailure: a.stats.nativeDocumentActionFailure,
      audio: {firstPacketMs: a.stats.nativeFirstPacketMs, underruns: a.stats.audioUnderruns,
        queueMs: a.stats.audioQueueMs, toneFramesSuppressed: a.stats.audioToneFramesSuppressed,
        continuousStream: a.stats.continuousAudioStream, configuredLipSyncDelayMs: a.stats.nativeLipSyncDelayMs},
      permission: navigator.permissions?.query ? null : 'unavailable',
      error: document.querySelector('#error').hidden ? '' : document.querySelector('#error-message').textContent,
      caption: a.captions.fullText,
      overflow: {document: document.documentElement.scrollWidth > innerWidth + 1,
        body: document.body.scrollWidth > innerWidth + 1},
      render: (() => { let texturedMeshes = 0; a.stage.model?.traverse(node => { if (node.isMesh && (Array.isArray(node.material) ? node.material : [node.material]).some(m => m?.map)) texturedMeshes++; });
        return {calls: a.stage.renderer.info.render.calls, triangles: a.stage.renderer.info.render.triangles, texturedMeshes,
          sampledFrame: a.stats.frame}; })(),
    };
  });
}
async function checkpoint(visitor, name) {
  const state = await read(visitor); visitor.data.checkpoints.push({at: new Date().toISOString(), name, ...state});
  await flush(); console.log(JSON.stringify({visitor: visitor.id, checkpoint: name, turns: state.completedTurns,
    active: state.active, localPlaybackBoundaries: state.playbackBoundaries, specialistCalls: report.specialistCalls, error: state.error})); return state;
}
async function screenshot(visitor, name) { await visitor.page.screenshot({path: path.join(output, `${visitor.id}-${name}.png`)}); }

async function newVisitor(id, {microphone = false, capacityProbe = false} = {}) {
  const args = [...browserArgs];
  if (microphone) args.push('--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${path.resolve(fixture.microphone)}`);
  const browser = await chromium.launch({channel: 'chrome', headless: true, args});
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
  if (microphone) await context.grantPermissions(['microphone'], {origin});
  const page = await context.newPage();
  const inspection = await context.newCDPSession(page);
  await inspection.send('Network.enable', {maxTotalBufferSize: 180_000_000, maxResourceBufferSize: 80_000_000});
  const data = {capacityProbe, browserVersion: browser.version(), browserChannel: 'chrome', headless: true,
    syntheticMicrophoneDevice: microphone, checkpoints: [], events: [], prompts: [],
    requests: [], errors: [], sources: [], outputAudioBytes: 0, inputAudioBytes: 0, outputPackets: 0, inputPackets: 0,
    websocketAttempts: 0, providerConnectionAttempts: 0, transportRenewals: 0, nativePostCount: 0, cspViolations: [], websocketSentBytes: 0, websocketReceivedBytes: 0,
    servedAssets: {}, httpSizes: {finishedRequests: 0, requestHeaders: 0, requestBody: 0, responseHeaders: 0, responseBody: 0}, feedbackPosts: 0};
  const visitor = {id, browser, context, page, data, nativeStream: new ObservedNativeStream(), outputPCM: [], inputPCM: [], characterParts: new Map(), assetCaptures: [], credentialChecks: [], stopped: false};
  visitors.push(visitor); report.visitors[id] = data;
  page.on('request', request => {
    const u = new URL(request.url()); if (u.protocol === 'data:' || u.protocol === 'blob:') return;
    const body = request.postDataBuffer();
    const entry = {at: new Date().toISOString(), origin: u.origin, path: u.pathname, method: request.method(), hasQuery: Boolean(u.search),
      requestBytes: body?.length || 0, body_sha256: body ? sha256(body) : null};
    data.requests.push(entry);
    if (u.origin !== origin) {
      visitor.credentialChecks.push(request.allHeaders().then(headers => {
        entry.credentialHeadersPresent = 'cookie' in headers || 'authorization' in headers;
        if (!allowedPublicRequest(entry, origin, characterTransfer)) return closeAtLimit('Unexpected external request or credentialed CDN transfer.');
      }).catch(() => closeAtLimit('Could not verify CDN request credential omission.')));
    }
    if (u.pathname === '/api/native/permit' && request.method() === 'POST') { data.nativePostCount++; data.lastPermitRequestAt = Date.now(); }
    if (u.pathname === '/api/presentation/convert' && request.method() === 'POST') report.presentationConversions++;
    if (u.pathname === '/api/feedback' && request.method() === 'POST') {
      data.feedbackPosts++;
      void closeAtLimit('An unapproved additional feedback request occurred.');
    }
  });
  page.on('requestfinished', async request => {
    if (!/^https?:/.test(request.url())) return;
    const sizes = await request.sizes().catch(() => null); if (!sizes) return;
    data.httpSizes.finishedRequests++;
    for (const [field, key] of [['requestHeaders', 'requestHeadersSize'], ['requestBody', 'requestBodySize'], ['responseHeaders', 'responseHeadersSize'], ['responseBody', 'responseBodySize']]) data.httpSizes[field] += Math.max(0, sizes[key] || 0);
  });
  page.on('response', response => {
    visitor.assetCaptures.push((async () => {
    const u = new URL(response.url());
    if (response.status() >= 400 && u.origin === origin) data.events.push({at: new Date().toISOString(), event: 'http_error', path: u.pathname, status: response.status()});
    if (u.pathname === '/' && response.status() === 200) data.securityHeaders = {
      csp: await response.headerValue('content-security-policy'), hsts: await response.headerValue('strict-transport-security'),
      permissionsPolicy: await response.headerValue('permissions-policy'), contentType: await response.headerValue('content-type')};
    if (u.origin === origin && expectedAssets[u.pathname] && response.status() === 200) {
      const bytes = await response.body().catch(error => { data.assetCaptureErrors ??= []; data.assetCaptureErrors.push({path: u.pathname, error: redact(error.message)}); return null; });
      if (bytes) data.servedAssets[u.pathname] = {bytes: bytes.length, sha256: sha256(bytes)};
    }
    const chunk = characterTransfer?.urls.get(response.url());
    if (chunk) {
      if (response.status() !== 200) throw Error('Pinned CDN chunk response failed.');
      const bytes = await response.body();
      if (bytes.length !== chunk.bytes || sha256(bytes) !== chunk.sha256) throw Error('Actual CDN response chunk size/hash mismatch.');
      visitor.characterParts.set(chunk.name, bytes);
    }
    })().catch(error => { data.assetCaptureErrors ??= []; data.assetCaptureErrors.push({error: redact(error.message)}); }));
  });
  page.on('console', message => { if (message.type() === 'error') { const text = redact(message.text()); data.errors.push({kind: 'console', text}); if (/content.security|refused to|violat.*policy/i.test(text)) data.cspViolations.push(text); } });
  page.on('pageerror', error => data.errors.push({kind: 'page', text: redact(error.message)}));
  page.on('websocket', socket => {
    const address = new URL(socket.url()), renewal = address.pathname === '/api/native/renew';
    if (address.origin !== origin.replace('https:', 'wss:') || ![ '/api/native/voice', '/api/native/renew'].includes(address.pathname)) { void closeAtLimit('Unexpected WebSocket target.'); return; }
    data.websocketAttempts++;
    if (renewal) {
      data.transportRenewals++; report.transportRenewals++;
      if (data.transportRenewals > 2 || capacityProbe) void closeAtLimit('Unexpected or excessive transport renewal.');
    } else { data.providerConnectionAttempts++; report.connectionAttempts++; }
    data.events.push({event: 'websocket_opening', at: new Date().toISOString(), path: address.pathname, renewal});
    const application = value => {
      if (value.event === 'audio') { const bytes = Buffer.from(value.data, 'base64'); visitor.outputPCM.push(bytes); data.outputAudioBytes += bytes.length; data.outputPackets++;
        data.firstAudioAt ??= new Date().toISOString(); data.lastAudioAt = new Date().toISOString(); return; }
      data.events.push({at: new Date().toISOString(), direction: 'received', ...safeEvent(value)});
      if (value.event === 'connected') { report.providerSessions++; visitor.connectedAt = Date.now();
        data.permitToProviderConnectedMs = data.lastPermitRequestAt ? visitor.connectedAt - data.lastPermitRequestAt : null;
        if (capacityProbe) void closeAtLimit('The capacity probe unexpectedly connected to a provider.');
        if (value.provider !== plan.expectedProviders.provider || value.model !== plan.expectedProviders.voice || value.continuous_audio !== true || value.voice !== expectedVoice || value.accent !== 'german') void closeAtLimit('Connected provider/model/voice/accent/continuous contract does not match this prepared protocol.'); }
      if (['document_vision_started', 'video_vision_started', 'research_started', 'visual_inspected'].includes(value.event)) {
        report.specialistCalls++;
        if (report.specialistCalls > plan.allocation.specialistCalls) void closeAtLimit('Specialist/vision protocol goal exceeded; stop without retry.');
      }
      if (value.event === 'sources') data.sources.push(...safeEvent(value).sources);
      if (['error', 'document_inspection_failed', 'video_inspection_failed', 'document_action_failed', 'document_cancel', 'video_cancel', 'presentation_cancel'].includes(value.event)) {
        if (!capacityProbe) void closeAtLimit(`${id} provider or source action failed: ${JSON.stringify(safeEvent(value))}`);
      }
      if (microphoneOnly && value.event === 'work_activity') void closeAtLimit('Microphone-only protocol requested an unapproved tool.');
      if (value.event === 'input_transcript' && String(value.text || '').trim() && visitor.data.inputAudioBytes === 0) void closeAtLimit(`${id} provider transcribed speech before any approved microphone PCM`);
      if (value.event === 'research_complete' && value.status !== 'source-bound') void closeAtLimit(`${id} specialist evidence did not complete`);
      if (['document_inspected', 'video_inspected', 'research_complete'].includes(value.event) && !String(value.model || '').startsWith(plan.expectedProviders.sourceVision)) void closeAtLimit('A source/evidence response reported an unexpected model.');
    };
    socket.on('framereceived', ({payload}) => {
      data.websocketReceivedBytes += Buffer.byteLength(payload);
      let value; try { value = JSON.parse(String(payload)); } catch { return; }
      try {
        visitor.nativeStream.receive(value).forEach(application);
        data.transportObservation = {lastSequence: visitor.nativeStream.lastSequence, duplicates: visitor.nativeStream.duplicates,
          controls: visitor.nativeStream.controls, pendingPackets: visitor.nativeStream.pending.size};
      } catch { void closeAtLimit('Invalid or excessive observed transport sequence.'); }
    });
    socket.on('framesent', ({payload}) => {
      data.websocketSentBytes += Buffer.byteLength(payload);
      if (typeof payload !== 'string') { const bytes = Buffer.from(payload); visitor.inputPCM.push(bytes); data.inputAudioBytes += bytes.length; data.inputPackets++; return; }
      let value; try { value = JSON.parse(payload); } catch { return; }
      data.events.push({at: new Date().toISOString(), direction: 'sent', wireBytes: Buffer.byteLength(payload), ...safeEvent(value)});
      if ((['document_result', 'video_result'].includes(value.type) && value.ok === false) || (value.type === 'presentation_result' && value.status === 'failed')) void closeAtLimit(`${id} renderer rejected an actual source action.`);
    });
    socket.on('socketerror', message => data.events.push({event: 'websocket_error', message: redact(message)}));
    socket.on('close', () => data.events.push({event: 'websocket_closed', at: new Date().toISOString()}));
  });
  const navigationStarted = Date.now();
  await page.goto(origin, {waitUntil: 'domcontentloaded', timeout: 30000});
  await page.waitForFunction(() => window.__einstein?.stats.avatarReady && window.__einstein.stats.nativeStatus, undefined, {timeout: 210000});
  data.actualAvatarReadyMs = Date.now() - navigationStarted;
  const status = await room(visitor);
  data.initialStatus = {available: status.available, active: status.active, last_session: status.last_session,
    public_deployment: status.public_deployment, room_capacity: status.room_capacity,
    room_active_sessions: status.room_active_sessions, room_capacity_rejections: status.room_capacity_rejections,
    model: status.model, provider: status.provider, default_voice: status.default_voice, continuous_audio: status.continuous_audio, research: status.research};
  const cookie = (await context.cookies(origin)).find(c => c.name === 'einstein_visitor');
  data.cookie = cookie ? {sha256: sha256(cookie.value), httpOnly: cookie.httpOnly, secure: cookie.secure, sameSite: cookie.sameSite} : null;
  assert(`${id} genuine public deployment and ready textured renderer`, status.public_deployment === true && status.available === true && (await read(visitor)).avatarReady);
  assert(`${id} expected OpenAI continuous voice and evidence configuration`, status.provider === plan.expectedProviders.provider && status.model === plan.expectedProviders.voice && status.continuous_audio === true && status.default_voice === expectedVoice && status.research?.model === plan.expectedProviders.evidence);
  assert(`${id} actual character texture and public capacity match allocation`, (await read(visitor)).render.texturedMeshes > 0 && status.room_capacity === 2);
  assert(`${id} secure isolated visitor cookie`, data.cookie?.httpOnly && data.cookie.secure && data.cookie.sameSite === 'Strict');
  const bindingsUntil = Date.now() + 5000;
  await Promise.all(visitor.assetCaptures); await Promise.all(visitor.credentialChecks);
  if (characterTransfer) {
    data.characterTransfer = characterChunkReceipt(characterTransfer, visitor.characterParts);
    data.servedAssets['/assets/einstein.glb'] = {bytes: data.characterTransfer.bytes, sha256: data.characterTransfer.sha256, measurement: data.characterTransfer.measurement};
    visitor.characterParts.clear();
    assert(`${id} character transfer used only independently verified pinned CDN chunks`, !data.requests.some(request => request.origin === origin && request.path === '/assets/einstein.glb') && !data.assetCaptureErrors?.length);
  }
  while (Date.now() < bindingsUntil && Object.keys(data.servedAssets).length < Object.keys(expectedAssets).length) await pause(100);
  for (const name of Object.keys(expectedAssets)) if (!data.servedAssets[name]) {
    const response = await page.request.get(origin + name, {timeout: 90000, maxRedirects: 0});
    assert(`${id} ordinary browser asset GET succeeded`, response.status() === 200, {path: name});
    const bytes = await response.body(); data.servedAssets[name] = {bytes: bytes.length, sha256: sha256(bytes), measurement: 'same-cookie-browser-API-GET-after-page-body-unavailable'};
  }
  assert(`${id} actual served character and entry assets match reviewed release bytes`, Object.entries(expectedAssets).every(([name, expected]) =>
    data.servedAssets[name]?.sha256 === expected.sha256 && data.servedAssets[name]?.bytes === expected.bytes));
  if (microphone) {
    const devices = await page.evaluate(async () => (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput').map(d => ({syntheticLabel: /fake|file/i.test(d.label)})));
    data.microphoneDevicePreflight = {audioInputs: devices.length, allSynthetic: devices.length > 0 && devices.every(d => d.syntheticLabel)};
    assert(`${id} Chrome exposes only synthetic microphone devices before capture`, data.microphoneDevicePreflight.allSynthetic);
  }
  return visitor;
}

function fresh(visitor, start) { return visitor.data.events.slice(start); }
const ack = (visitor, start, channel, kind) => acknowledgedAction(fresh(visitor, start), channel, kind);
async function response(visitor, before, start, label, condition = () => true) {
  const prompt = visitor.data.prompts.at(-1), began = Date.parse(prompt.at);
  const state = await waitFor(visitor, s => {
    if (s.renderedSignalSamples > before.renderedSignalSamples && s.audioPlaying && prompt.firstRenderedAudioObservedMs === undefined) prompt.firstRenderedAudioObservedMs = Date.now() - began;
    const previousCoObservation = prompt.answerEvidence?.contentAndFreshSignalObservedMs;
    prompt.answerEvidence = promptAnswerEvidence(label, prompt.at, fresh(visitor, start), s.visual);
    prompt.answerEvidence.firstRenderedSignalObservedMs = prompt.firstRenderedAudioObservedMs ?? null;
    prompt.answerEvidence.contentAndFreshSignalObservedMs = previousCoObservation ??
      (prompt.answerEvidence.promptSpecificContentMatched && s.renderedSignalSamples > before.renderedSignalSamples ? Date.now() - began : null);
    return prompt.answerEvidence.promptSpecificContentMatched && playbackBoundaryObserved(before, s) && playbackAfterReceipts(s, fresh(visitor, start)) && condition(s, start);
  }, label, 65, before.active === false);
  assert(`${visitor.id} ${label} prompt-specific received text, rendered signal, local boundary and facial cues`, state.audioFaceEvents > 0 && state.lastTurn?.provider === plan.expectedProviders.provider && state.lastTurn?.model === plan.expectedProviders.voice);
  prompt.observedSpokenAnswer = spokenAnswer(fresh(visitor, start));
  prompt.receivedOutputText = prompt.observedSpokenAnswer;
  return checkpoint(visitor, label);
}
async function type(visitor, text, label, {accept = true, wait = true, condition = () => true} = {}) {
  budget(); const before = await read(visitor); const began = Date.now();
  const start = visitor.data.events.length;
  visitor.data.prompts.push({at: new Date().toISOString(), label, input: 'typed', text});
  if (!await visitor.page.locator('#question-dialog').isVisible()) await visitor.page.click('#keyboard-toggle');
  if (!before.active && !before.connecting) await visitor.page.selectOption('#reply-mode', 'voice');
  await visitor.page.fill('#question', text); await visitor.page.click('#send');
  if (await visitor.page.locator('#paper-allow-sharing').isVisible()) await visitor.page.click('#paper-allow-sharing');
  const dialog = visitor.page.locator('dialog[aria-labelledby="processing-heading"]');
  if (await dialog.isVisible().catch(() => false)) await dialog.getByRole('button', {name: accept ? 'Agree and begin' : 'Not now', exact: true}).click();
  if (!accept || !wait) return before;
  const state = await response(visitor, before, start, label, condition);
  visitor.data.prompts.at(-1).elapsedMs = Date.now() - began;
  visitor.data.prompts.at(-1).clientFirstPacketMs = state.audio.firstPacketMs;
  return state;
}
async function share(visitor, selector, label, condition) {
  budget(); const before = await read(visitor); visitor.data.prompts.push({at: new Date().toISOString(), label, input: 'actual sharing UI', selector});
  if (report.specialistCalls >= plan.allocation.specialistCalls) throw Error('Specialist protocol goal reached; no further source sharing.');
  const start = visitor.data.events.length;
  await visitor.page.click(selector);
  if (selector === '#paper-discuss' && await visitor.page.locator('#paper-allow-sharing').isVisible()) await visitor.page.click('#paper-allow-sharing');
  if (selector === '#paper-discuss') {
    visitor.data.prompts.at(-1).label = 'source approval only: ' + label;
    return type(visitor, 'Read the selected page and briefly explain what it shows. Use the actual source image and text.', label, {condition});
  }
  return response(visitor, before, start, label, condition);
}
async function paperReady(visitor, page = 1) {
  await visitor.page.waitForFunction(number => { const p = window.__einstein.paper; return p.pdf?.canvas?.width > 0 && p.pdf.pageNumber === number && !p.share.disabled; }, page, {timeout: 30000});
}
async function sourcePixels(visitor, kind = 'pdf') {
  return visitor.page.evaluate(async kind => {
    const a = window.__einstein, encode = async c => { const bytes = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(v => v.toString(16).padStart(2, '0')).join('');
      let pixels = 0; for (let i = 3; i < bytes.length; i += 4) if (bytes[i]) pixels++;
      return {width: c.width, height: c.height, sha256: digest, alphaPixels: pixels}; };
    if (kind === 'pdf') return {document: a.stats.document, marks: a.paper.marks.get(a.paper.pdf.pageNumber) || [], original: await encode(a.paper.pdf.canvas), displayed: await encode(a.paper.base), overlay: await encode(a.paper.overlay)};
    const video = a.video.video, c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight; c.getContext('2d').drawImage(video, 0, 0);
    return {video: a.stats.video, source: await encode(c), overlay: await encode(a.video.overlay)};
  }, kind);
}
async function sourceRasterHandle(visitor) {
  return visitor.page.evaluateHandle(() => {
    const canvas = window.__einstein.paper.pdf.canvas;
    return {width: canvas.width, height: canvas.height,
      rgba: new Uint8ClampedArray(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data)};
  });
}
async function outputRecording(visitor) {
  await visitor.page.evaluate(() => {
    const stream = window.__einstein.player.capture?.stream; if (!stream) return;
    const recorder = new MediaRecorder(stream, {mimeType: 'audio/webm;codecs=opus'});
    const evidence = {recorder, parts: []}; window.__publicAcceptanceRecording = evidence;
    recorder.ondataavailable = e => { if (e.data.size) evidence.parts.push(e.data); }; recorder.start(1000);
  });
}
async function dismissDialogs(visitor) {
  for (let count = 0; count < 4 && await visitor.page.locator('dialog[open]').count(); count++) await visitor.page.keyboard.press('Escape');
}
async function stop(visitor, label) {
  if (visitor.stopped) return;
  const before = await read(visitor).catch(() => null);
  if (before?.active || before?.connecting) { await dismissDialogs(visitor); await visitor.page.click('#interrupt'); }
  await visitor.page.waitForFunction(() => !window.__einstein.native.active && !window.__einstein.native.connecting && !window.__einstein.stats.microphoneActive, undefined, {timeout: 12000});
  visitor.stopped = true; await checkpoint(visitor, label);
  const end = Math.min(until, Date.now() + 20000);
  while (Date.now() < end) {
    const status = await room(visitor);
    visitor.data.finalStatus = {active: status.active, available: status.available, last_session: status.last_session,
      research: status.research ? {model: status.research.model, provider: status.research.provider, last_request: status.research.last_request} : null,
      room_capacity: status.room_capacity, room_active_sessions: status.room_active_sessions, room_capacity_rejections: status.room_capacity_rejections};
    if (!status.active && (status.last_session?.provider_usage?.final_usage_confirmed === true || !visitor.connectedAt)) break;
    await pause(250);
  }
  assert(`${visitor.id} settled server cleanup`, visitor.data.finalStatus.active === false);
}

async function labEvidence(a) {
  await type(a, 'Use lookup_lab to select one actual Mobiliar Lab project, then consult_flash once to check its reported evidence against the supplied official project sources. Briefly distinguish a documented result from an expected outcome and cite the exact official page. Disclose dated snapshots. Two short sentences; do not use web search or optional external research.', 'official lab source-bound synthesis', {condition: (_, start) => fresh(a, start).some(e => e.event === 'work_activity' && e.tool === 'lookup_lab') && fresh(a, start).some(e => e.event === 'research_complete' && e.status === 'source-bound' && String(e.model).startsWith(plan.expectedProviders.evidence)) && labEvidenceNarrated(fresh(a, start))});
  cover('official-lab-evidence', a.data.sources.some(source => /^https:\/\/(?:mobililab|mobiliarlab)\.ethz\.ch\//.test(source.url || '')) && (await read(a)).lastTurn.sources?.some(url => /^https:\/\/(?:mobililab|mobiliarlab)\.ethz\.ch\//.test(url)));
}

const inspected = (visitor, start, event, page) => fresh(visitor, start).some(e => e.event === event && (page === undefined || e.page === page));
const marked = (visitor, start, page, kinds = ['box']) => fresh(visitor, start).some(e => e.event === 'document_tool_requested' && e.diagnostic?.page === page && sourceOwnedMarks(e.diagnostic, kinds)) && Boolean(ack(visitor, start, 'document', 'mark'));
const unchanged = (before, after) => before.original.sha256 === after.original.sha256 && before.displayed.sha256 === after.displayed.sha256 &&
  [before, after].every(value => value.original.sha256 === value.displayed.sha256 && value.original.width === value.displayed.width &&
    value.original.height === value.displayed.height && value.original.width === before.original.width && value.original.height === before.original.height &&
    value.document.id === before.document.id && value.document.page === before.document.page);
async function room(visitor) { return readServerStatus(visitor.page); }

try {
  // Download and verify each scoped visitor before the first paid session begins.
  // Keep cold downloads sequential on the operator's shared connection. The
  // separately isolated paid voice sessions below still run concurrently.
  const a = await newVisitor(microphoneOnly ? 'M' : remaining ? 'R' : 'A', {microphone: focused});
  const b = focused ? a : await newVisitor('B', {microphone: true});
  const c = focused ? null : await newVisitor('C', {capacityProbe: true});
  const sessionVisitors = [...new Set([a, b])];
  report.characterPreparation = focused ? 'One fresh microphone-capable browser process; all original asset/source checks retained. No isolation or capacity claim.' :
    'Three independent cold browser processes, sequential downloads; no simultaneous cold-load performance claim.';
  await checkpoint(a, 'fresh public desktop'); await screenshot(a, 'desktop');
  if (focused) {
    await type(a, 'Greet me in one short sentence for this public test, then wait. Do not use tools.', microphoneOnly ? 'microphone-scenarios session start' : 'remaining-scenarios session start');
    await outputRecording(a);
    // Fail on the previously blocked research step before spending on image checks.
    if (!microphoneOnly) await labEvidence(a);
  } else {
  await type(c, 'Say hello in one sentence.', 'declined processing decision', {accept: false});
  await c.page.waitForFunction(() => !window.__einstein.native.connecting, undefined, {timeout: 10000});
  const declined = await checkpoint(c, 'declined consent');
  cover('consent-decline', c.data.nativePostCount === 0 && c.data.websocketAttempts === 0 && !declined.microphoneActive && !declined.microphoneStream);

  await type(a, 'For this public test remember the harmless code cobalt-orbit-47. Explain why a soap bubble is round in one short sentence. Then wait.', 'first typed native answer');
  await outputRecording(a);
  await type(a, 'Compare surface tension and trapped air pressure in one short sentence. Then wait.', 'spoken multi-turn followup');
  cover('spoken-multiturn', (await read(a)).playbackBoundaries >= 2 && a.data.outputAudioBytes > 0 && (await read(a)).audioFaceEvents > 0);
  await a.page.setInputFiles('#paper-file', fixture.pdf); await paperReady(a);
  assert('selected original PDF stays local before Discuss', (await read(a)).document.approved === false);
  await a.page.fill('#paper-page', String(figurePage)); await a.page.press('#paper-page', 'Tab'); await paperReady(a, figurePage);
  await share(a, '#paper-discuss', 'actual original figure inspection', (_, start) => inspected(a, start, 'document_inspected', figurePage) && ack(a, start, 'document', 'read'));
  const beforePaper = await sourcePixels(a); a.data.sourceBeforeAnnotation = beforePaper;
  await type(a, 'In ONE mark_selected_pdf call on the inspected current page, use actual returned region_id values to add TWO marks: one box and one ellipse around meaningful source figure components. Both may use the same region if only one meaningful region was returned. Use original source labels. Do not re-read or use conceptual tools. Identify the marked source components in one short sentence, then wait.', 'original source-ID box and ellipse', {condition: (_, start) => marked(a, start, figurePage, ['box', 'ellipse'])});
  const afterPaper = await sourcePixels(a); a.data.sourceAfterAnnotation = afterPaper;
  cover('source-box-and-ellipse', unchanged(beforePaper, afterPaper) && afterPaper.overlay.alphaPixels > 0 && ['box', 'ellipse'].every(kind => afterPaper.marks.some(mark => mark.kind === kind)));
  await screenshot(a, 'original-source-box-and-ellipse'); await a.page.click('#paper-remove');
  assert('original paper removal clears source ownership and annotations', !(await read(a)).document.selected);

  // The public admission cooldown is exercised through time, never bypassed.
  await pause(Math.max(0, 31000 - (Date.now() - a.connectedAt)));
  assert('fresh visitor B has no visitor A document or conversation', !b.data.initialStatus.active && !b.data.initialStatus.last_session && !(await read(b)).document.selected && !(await read(b)).conversationId);
  await type(b, 'In one short sentence say whether you know what the preceding unrelated visitor uploaded or their private conversation code. Do not guess or use tools.', 'independent visitor context');
  cover('isolation', a.data.cookie.sha256 !== b.data.cookie.sha256 && !JSON.stringify(b.data.events).includes('cobalt-orbit-47') && (await read(a)).conversationId !== (await read(b)).conversationId);
  await outputRecording(b);
  assert('both actual sessions remain visible without guard bypass', (await read(a)).active && (await read(b)).active && (await read(a)).visibility === 'visible' && (await read(b)).visibility === 'visible');
  const [beforeCapacity, beforeCapacityB] = await Promise.all([room(a), room(b)]);
  report.capacity = {before: {at: new Date().toISOString(), room_capacity: beforeCapacity.room_capacity, room_active_sessions: beforeCapacity.room_active_sessions, room_capacity_rejections: beforeCapacity.room_capacity_rejections}};
  assert('server confirms two distinct active visitors before capacity probe', beforeCapacity.active && beforeCapacityB.active && beforeCapacity.room_active_sessions === 2 && beforeCapacityB.room_active_sessions === 2 && Number.isInteger(beforeCapacity.room_capacity_rejections) && beforeCapacity.room_capacity_rejections < 2147483647);
  await type(c, 'Say hello in one sentence.', 'capacity-bound third visitor', {wait: false});
  await c.page.waitForFunction(() => !window.__einstein.native.connecting && !window.__einstein.native.active && !document.querySelector('#error').hidden, undefined, {timeout: 35000});
  const rejected = await checkpoint(c, 'expected room-capacity rejection');
  const [afterCapacity, afterCapacityB] = await Promise.all([room(a), room(b)]);
  report.capacity.after = {at: new Date().toISOString(), room_capacity: afterCapacity.room_capacity, room_active_sessions: afterCapacity.room_active_sessions, room_capacity_rejections: afterCapacity.room_capacity_rejections};
  cover('capacity', c.data.websocketAttempts === 1 && !c.connectedAt && Boolean(rejected.error) && afterCapacity.active && afterCapacityB.active && afterCapacity.room_active_sessions === 2 && afterCapacityB.room_active_sessions === 2 && afterCapacity.room_capacity_rejections === beforeCapacity.room_capacity_rejections + 1);
  await screenshot(c, 'capacity-message'); await stop(c, 'capacity-denied cleanup'); await c.browser.close(); c.closed = true;

  // B carries video and conceptual work; A carries paper, deck and evidence.
  await b.page.setInputFiles('#video-file', fixture.video);
  await b.page.waitForFunction(() => window.__einstein.video.manifest && !document.querySelector('#video-discuss').disabled, undefined, {timeout: 20000});
  assert('video remains private until actual Discuss', (await read(b)).video.approved === false);
  const videoStart = b.data.events.length;
  await share(b, '#video-discuss', 'actual synthetic video frame zero', (_, start) => inspected(b, start, 'video_inspected') && ack(b, start, 'video', 'inspect'));
  assert('first video narration follows inspected source pixels without phantom objects', originalSyntheticVideoNarrated(fresh(b, videoStart)));
  await type(b, 'Use the selected original video controls to play, then pause, then set playback speed to 0.5. Do not inspect another frame. State only the acknowledged paused state and speed.', 'video actual play pause and speed', {condition: (s, start) => ack(b, start, 'video', 'play') && ack(b, start, 'video', 'pause') && ack(b, start, 'video', 'rate') && s.video.paused && s.video.rate === .5});
  await type(b, 'Seek the selected original video to exactly 2 seconds, keep it paused, inspect that exact frame once, then wait. Do not annotate yet.', 'second original video frame', {condition: (_, start) => inspected(b, start, 'video_inspected') && ack(b, start, 'video', 'inspect')});
  const videoBefore = await sourcePixels(b, 'video'); b.data.videoBeforeAnnotation = videoBefore;
  await type(b, 'Use the actual returned region_id for the visible red square on the current inspected frame to annotate it. In one sentence compare its position with the first inspected frame. Do not infer sound or causality and do not inspect another frame.', 'video source-ID annotation', {condition: (_, start) => ack(b, start, 'video', 'mark')});
  const videoAfter = await sourcePixels(b, 'video'); b.data.videoAfterAnnotation = videoAfter;
  const frames = b.data.events.filter(e => e.event === 'video_inspected');
  const videoMark = b.data.events.findLast(e => e.event === 'video_action' && e.action?.kind === 'mark')?.action;
  const markedFrame = frames.findLast(e => e.video_id === videoMark?.video_id && e.image_sha256 === videoMark?.frame_hash && Math.abs(e.time - videoMark.time) < .15);
  assert('video annotation resolves an actual returned red-square region on the same frame', markedFrame?.regions.some(region => /red/i.test(region.label) && /square|rectangle/i.test(region.label) && JSON.stringify(region.region) === JSON.stringify(videoMark.region)));
  assert('two different actual source video times and image hashes inspected', new Set(frames.map(e => Number(e.time).toFixed(2))).size >= 2 && new Set(frames.map(e => e.image_sha256)).size >= 2);
  assert('actual video mark preserves source pixels', videoBefore.source.sha256 === videoAfter.source.sha256 && videoAfter.overlay.alphaPixels > 0 && videoAfter.video.markCount > 0 && Math.abs(videoAfter.video.time - 2) < .15);
  await screenshot(b, 'video-source-annotation');
  await type(b, 'Rewind the selected video by exactly one second and keep it paused. Do not inspect or annotate. State only the acknowledged time.', 'actual rewind and stale-mark cleanup', {condition: (s, start) => ack(b, start, 'video', 'rewind') && s.video.paused && Math.abs(s.video.time - 1) < .15 && s.video.markCount === 0});
  cover('video', (await read(b)).video.paused && Math.abs((await read(b)).video.time - 1) < .15);
  await b.page.click('#video-remove'); assert('video removal clears source ownership', !(await read(b)).video.selected);
  }

  if (!microphoneOnly) {
  await a.page.click('#material-toggle'); await a.page.click('#presentation-open'); await a.page.setInputFiles('#presentation-file', fixture.pptx); await a.page.click('#presentation-convert');
  await a.page.waitForFunction(() => window.__einstein.stats.document.sourceKind === 'converted-pptx' || (!document.querySelector('#presentation-file').disabled && document.querySelector('#presentation-status').textContent), undefined, {timeout: 65000});
  assert('one real PPTX conversion opens disclosed two-page rendering', report.presentationConversions === 1 && (await read(a)).document.sourceKind === 'converted-pptx' && (await read(a)).document.pages === 2); await paperReady(a);
  await share(a, '#paper-discuss', 'actual converted slide one inspection', (_, start) => inspected(a, start, 'document_inspected', 1) && ack(a, start, 'document', 'read'));
  const slideBefore = await sourcePixels(a); a.data.slideBeforeAnnotation = slideBefore;
  firstSlideRaster = await sourceRasterHandle(a);
  await type(a, 'Using the already inspected converted slide, mark Input with its actual returned region_id. State its actual A and B bar values and the Input-to-Outcome connection in one sentence. Retain its synthetic-test and LibreOffice-conversion limits. Do not re-inspect.', 'converted first slide source explanation', {condition: (_, start) => marked(a, start, 1) && convertedSlideAnswerMatches(spokenAnswer(fresh(a, start)), 1)});
  const slideAfter = await sourcePixels(a); a.data.slideAfterAnnotation = slideAfter;
  const answer1 = a.data.prompts.at(-1).observedSpokenAnswer;
  assert('first slide answer matches source numbers, mechanism and scope', convertedSlideAnswerMatches(answer1, 1));
  assert('first converted slide mark preserves original pixels', unchanged(slideBefore, slideAfter) && slideAfter.overlay.alphaPixels > 0);
  await screenshot(a, 'converted-slide-1');
  const deckId = slideAfter.document.id;
  await type(a, 'Use read_selected_pdf_page to display and inspect actual page 2 of this converted deck once. State its diagram connection, actual Control and Treatment chart values and their units in one sentence. Retain synthetic scope. Do not annotate yet.', 'actual next-slide explanation', {condition: (_, start) => inspected(a, start, 'document_inspected', 2) && ack(a, start, 'document', 'read') && convertedSlideAnswerMatches(spokenAnswer(fresh(a, start)), 2)});
  await paperReady(a, 2); const slide2Before = await sourcePixels(a); a.data.slide2BeforeAnnotation = slide2Before;
  const answer2 = a.data.prompts.at(-1).observedSpokenAnswer;
  assert('second slide has distinct source pixels and expected source-grounded content', slide2Before.document.id === deckId && slide2Before.original.sha256 !== slideBefore.original.sha256 && convertedSlideAnswerMatches(answer2, 2));
  await type(a, 'Mark the Dose node on current page 2 with its actual returned region_id. Do not read or inspect again. State only the acknowledged page and node.', 'second-slide source-ID mark', {condition: (_, start) => marked(a, start, 2)});
  const slide2After = await sourcePixels(a); a.data.slide2AfterAnnotation = slide2After;
  assert('second slide annotation preserves its source pixels', unchanged(slide2Before, slide2After) && slide2After.overlay.alphaPixels > 0); await screenshot(a, 'converted-slide-2');
  await type(a, 'Return to page 1 by mark_selected_pdf using page 1 and its previously returned Input region_id, replacing its existing mark. This displays the already-inspected page. Do not use a page-2 region or re-inspect. State only the acknowledged page and Input node.', 'actual previous-slide source navigation', {condition: (_, start) => marked(a, start, 1)});
  await paperReady(a, 1); const returnedSlide1 = await sourcePixels(a); a.data.slide1AfterReturn = returnedSlide1;
  const returnedRaster = await sourceRasterHandle(a);
  try {
    a.data.slide1RasterReplay = {limits: RASTER_REPLAY_LIMITS,
      ...await a.page.evaluate(rasterReplayDelta, {reference: firstSlideRaster, current: returnedRaster})};
  } finally {
    await returnedRaster.dispose(); await firstSlideRaster.dispose(); firstSlideRaster = null;
  }
  a.data.convertedSlideNavigation = {pages: [slideAfter.document.page, slide2After.document.page, returnedSlide1.document.page], documentId: deckId};
  cover('two-slide-deck', returnedSlide1.document.id === deckId && JSON.stringify(a.data.convertedSlideNavigation.pages) === '[1,2,1]' && rasterReplayPreserved(slideBefore, returnedSlide1, a.data.slide1RasterReplay) && returnedSlide1.overlay.alphaPixels > 0);
  await screenshot(a, 'converted-slide-1-return'); await a.page.click('#paper-remove');

  await type(b, 'Use sketch_mechanism to show three short-labelled conceptual nodes: air pressure, surface tension, round bubble. Label the graph conceptual and assert no experimental result. Explain the competing forces in one sentence, then wait.', 'conceptual whiteboard creation', {condition: (s, start) => ack(b, start, 'presentation', 'diagram') && s.visual.visible && s.visual.graph?.nodes?.length >= 3});
  const firstGraph = (await read(b)).visual;
  await type(b, 'Revise that conceptual whiteboard by adding thin soap film connected to surface tension. Then use focus_visual to focus surface tension. Keep it conceptual. Give one short sentence, without image inspection.', 'conceptual revision and focus', {condition: (s, start) => ack(b, start, 'presentation', 'diagram') && ack(b, start, 'presentation', 'focus') && s.visual.revision > firstGraph.revision && s.visual.graph?.nodes?.length > firstGraph.graph.nodes.length && Boolean(s.visual.focused)});
  await screenshot(b, 'revised-focused-whiteboard');
  const whiteboardBefore = await read(b);
  await type(b, 'Call inspect_visual once to look at the actual currently rendered conceptual whiteboard pixels. Name two visible labels in one sentence. Do not substitute graph metadata or draw a new diagram.', 'actual whiteboard pixel inspection', {condition: (s, start) => {
    const receipt = ack(b, start, 'presentation', 'inspect');
    return receipt?.image?.bytes > 0 && fresh(b, start).some(e => e.event === 'visual_inspected' && e.transport === 'ordered-backend-image' && e.image_sha256 === receipt.image.sha256) && s.visualImageInspections > whiteboardBefore.visualImageInspections && namesVisibleGraphLabels(spokenAnswer(fresh(b, start)), s.visual);
  }});
  assert('whiteboard image answer names two actual visible graph labels', namesVisibleGraphLabels(b.data.prompts.at(-1).observedSpokenAnswer, (await read(b)).visual));
  await type(b, 'Use hide_visual to dismiss this conceptual whiteboard. Do not replace it or call other tools. Confirm only after acknowledgement.', 'actual whiteboard dismissal', {condition: (s, start) => ack(b, start, 'presentation', 'hide') && !s.visual.visible});
  cover('conceptual-create-revise-focus-inspect-dismiss', !(await read(b)).visual.visible);

  if (!focused) await labEvidence(a);
  }
  for (const viewport of [{width: 390, height: 844}, {width: 320, height: 568}]) {
    await a.page.setViewportSize(viewport); await pause(400);
    assert(`active mobile ${viewport.width}px has no horizontal overflow`, !(await read(a)).overflow.document && !(await read(a)).overflow.body);
    await screenshot(a, `active-mobile-${viewport.width}`);
  }
  await a.page.setViewportSize({width: 1440, height: 1000});
  cover('responsive-security', visitors.every(v => v.data.requests.every(request => allowedPublicRequest(request, origin, characterTransfer)) && v.data.cspViolations.length === 0 && v.data.errors.every(e => e.kind === 'console' && v.data.capacityProbe && /WebSocket.*(?:api\/native\/voice|failed|closed)/i.test(e.text))) && a.data.securityHeaders?.csp && a.data.securityHeaders?.hsts);

  const bBefore = await read(b);
  await type(b, 'Explain how binary search finds an item in a sorted list in six full sentences. Do not use tools.', 'unrelated spoken response to overlap', {wait: false});
  await waitFor(b, s => s.outputBytes > bBefore.outputBytes && s.audioPlaying, 'actual speech before synthetic input', 25);
  const inputStart = b.data.events.length, micBefore = await read(b), receivedBefore = b.data.outputAudioBytes;
  await b.page.click('#microphone');
  await waitFor(b, s => s.microphoneActive && s.microphoneStream, 'actual synthetic getUserMedia capture', 15);
  const suppressed = await waitFor(b, s => s.localOverlaps > micBefore.localOverlaps && s.localSpeechGates > micBefore.localSpeechGates && s.speaking && s.suppressAudio && s.suppressedAudioPackets > micBefore.suppressedAudioPackets && b.data.outputAudioBytes > receivedBefore, 'actual local overlap suppression while backend continues', 20);
  b.data.overlapEvidence = {before: micBefore, during: suppressed, rawOutputBytesBefore: receivedBefore, rawOutputBytesDuring: b.data.outputAudioBytes};
  const mic = await waitFor(b, s => syntheticMicrophoneResponseObserved(micBefore, s, fresh(b, inputStart)) && b.data.inputAudioBytes > 0, 'synthetic microphone transcript and new spoken topic', 65);
  b.data.microphoneEvidence = {inputBytes: b.data.inputAudioBytes, inputPackets: b.data.inputPackets, renderedEpochSignalSamples: mic.renderedEpochSignalSamples, playerVersion: mic.playerVersion, nativeUtterances: mic.nativeUtterances, newEvents: fresh(b, inputStart).filter(e => ['input_transcript', 'output_transcript'].includes(e.event)), source: 'Authored synthetic WAV through actual getUserMedia; no human/acoustic verdict'};
  cover('synthetic-mic-local-overlap', mic.inputBytes > 0 && b.data.inputPackets > 0 && mic.generation === micBefore.generation && b.data.providerConnectionAttempts === 1 && !fresh(b, inputStart).some(e => e.direction === 'sent' && e.type === 'interrupt'));
  await checkpoint(b, 'synthetic local overlap and topic change'); await screenshot(b, 'synthetic-microphone-response');
  await Promise.all(sessionVisitors.map(visitor => stop(visitor, 'actual Interrupt stops microphone and voice')));
  assert('All observed renewal replay queues drained', sessionVisitors.every(v => v.nativeStream.pending.size === 0));
  assert(focused ? 'one real focused session without retries' : 'two real sessions and one capacity-denied attempt, without retries', report.providerSessions === plan.allocation.providerSessions && report.connectionAttempts === plan.allocation.connectionAttempts && report.specialistCalls <= plan.allocation.specialistCalls && report.presentationConversions === plan.allocation.presentationConversions);
  if (focused) assert('one actual server conversation receipt', a.data.finalStatus.last_session?.conversation_id);
  else assert('independent server conversation receipts', a.data.finalStatus.last_session?.conversation_id && b.data.finalStatus.last_session?.conversation_id && a.data.finalStatus.last_session.conversation_id !== b.data.finalStatus.last_session.conversation_id);
  const finalRoom = await room(a); report.roomCleanup = {at: new Date().toISOString(), room_active_sessions: finalRoom.room_active_sessions, room_capacity: finalRoom.room_capacity, room_capacity_rejections: finalRoom.room_capacity_rejections};
  const clean = await Promise.all(sessionVisitors.map(read));
  cover('cleanup', finalRoom.room_active_sessions === 0 && clean.every(s => !s.active && !s.connecting && !s.microphoneActive && !s.microphoneStream && !s.audioPlaying && s.playerEntries === 0 && !s.document.selected && !s.video.selected && !s.visual.visible) && sessionVisitors.every(v => v.data.finalStatus.last_session?.conversation_id === v.nativeStream.connection?.conversation_id && v.data.finalStatus.last_session?.provider === plan.expectedProviders.provider && v.data.finalStatus.last_session?.model === plan.expectedProviders.voice && v.data.finalStatus.last_session?.voice === expectedVoice && v.data.finalStatus.last_session?.accent === 'german' && v.data.finalStatus.last_session?.provider_usage?.provider_voice_confirmed === true && v.data.finalStatus.last_session?.provider_usage?.final_usage_confirmed === true));
  assert('late capture and cleanup added no security errors or extra permits', visitors.every(v => v.data.nativePostCount === 1 && v.data.requests.every(request => allowedPublicRequest(request, origin, characterTransfer)) && v.data.cspViolations.length === 0 && v.data.errors.every(e => e.kind === 'console' && v.data.capacityProbe && /WebSocket.*(?:api\/native\/voice|failed|closed)/i.test(e.text))));
  assert('all required protocol gates completed and no additional feedback was sent', missingCoverage(report.coverage, plan.requiredCoverage).length === 0 && visitors.every(v => v.data.feedbackPosts === 0), {missing: missingCoverage(report.coverage, plan.requiredCoverage)});
  report.state = successState;
} catch (error) {
  report.state = 'FAILED_OR_INCOMPLETE'; report.failure = redact(error.message);
  await closeAtLimit(report.failure);
  for (const visitor of visitors.filter(v => !v.closed)) {
    await checkpoint(visitor, 'stopped after failure').catch(() => {}); await screenshot(visitor, 'failure').catch(() => {});
  }
} finally {
  await firstSlideRaster?.dispose().catch(() => {}); firstSlideRaster = null;
  await Promise.allSettled(visitors.filter(v => !v.closed && !v.stopped).map(visitor => stop(visitor, 'final bounded cleanup').catch(e => report.limits.push(redact(`${visitor.id} cleanup: ${e.message}`)))));
  for (const visitor of visitors) {
    if (!visitor.closed) {
      try {
        const recording = await visitor.page.evaluate(async () => {
          const evidence = window.__publicAcceptanceRecording; if (!evidence) return null;
          if (evidence.recorder.state !== 'inactive') await new Promise(resolve => { evidence.recorder.addEventListener('stop', resolve, {once: true}); evidence.recorder.stop(); });
          const bytes = new Uint8Array(await new Blob(evidence.parts, {type: 'audio/webm'}).arrayBuffer()); let encoded = '';
          for (let i = 0; i < bytes.length; i += 8192) encoded += String.fromCharCode(...bytes.subarray(i, i + 8192));
          return btoa(encoded);
        });
        if (recording) {
          const bytes = Buffer.from(recording, 'base64');
          await fs.writeFile(path.join(output, `${visitor.id}-actual-browser-output.webm`), bytes);
          visitor.data.renderedRecording = {bytes: bytes.length, sha256: sha256(bytes), source: 'Actual browser output bus, not microphone or raw provider packet substitution'};
        }
      } catch (e) { report.limits.push(redact(`${visitor.id} output recording unavailable: ${e.message}`)); }
      if (visitors.every(value => value.closed || value.stopped)) {
        const end = Date.now() + 6000;
        do {
          const status = await room(visitor).catch(() => null);
          report.roomCleanup = status ? {at: new Date().toISOString(), room_active_sessions: status.room_active_sessions,
            room_capacity_rejections: status.room_capacity_rejections, room_capacity: status.room_capacity} : null;
          if (report.roomCleanup?.room_active_sessions === 0) break;
          await pause(250);
        } while (Date.now() < end);
      }
      await visitor.browser.close().catch(e => report.limits.push(redact(`${visitor.id} browser close: ${e.message}`))); visitor.closed = true;
    }
    if (visitor.outputPCM.length) await fs.writeFile(path.join(output, `${visitor.id}-provider-output-mono24000-s16le.pcm`), Buffer.concat(visitor.outputPCM));
    if (visitor.inputPCM.length) await fs.writeFile(path.join(output, `${visitor.id}-synthetic-input-mono16000-s16le.pcm`), Buffer.concat(visitor.inputPCM));
  }
  clearTimeout(cleanupWatchdog); clearTimeout(hardWatchdog);
  report.completedAt = new Date().toISOString(); report.elapsedSeconds = (Date.now() - Date.parse(report.startedAt)) / 1000;
  report.missingCoverage = missingCoverage(report.coverage, plan.requiredCoverage);
  if (report.state === successState && (fatal || report.elapsedSeconds > plan.allocation.wholeRunSeconds || report.missingCoverage.length || visitors.some(v => v.data.feedbackPosts !== 0) || report.roomCleanup?.room_active_sessions !== 0 || visitors.filter(v => !v.data.capacityProbe).some(v => !v.data.renderedRecording?.bytes || v.data.finalStatus?.active !== false || v.data.finalStatus.last_session?.provider_usage?.final_usage_confirmed !== true))) {
    report.state = 'FAILED_OR_INCOMPLETE'; report.failure = 'Actual browser output recording or settled independent visitor and global room cleanup was not confirmed.';
  }
  report.interpretationLimits = ['Synthetic prerecorded microphone fixture, not human or acoustic acceptance.',
    'HeadAudio cue and pixel receipts establish execution, not a human naturalness judgement.',
    'Capacity denial requires the genuine aggregate full-room branch counter to increase once while both independent visitors remain active; concurrent unrelated attempts can make this receipt ambiguous and fail the check.',
    'Foundation-model unfamiliarity with the selected PDF is not knowable; the check requires actual visitor-selected source pixels and region IDs.'];
  if (remaining) report.interpretationLimits.push('Focused one-visitor run only. It does not exercise or claim consent-decline, multi-turn baseline, original PDF, video, isolation or capacity; reviewed earlier receipts and an explicit owner aggregate are required for those claims.');
  report.interpretationLimits.push('Byte counts are observed browser HTTP/WebSocket traffic and decoded PCM/image payloads; hidden server-to-provider request bytes and billable token cost are not independently measured.');
  report.interpretationLimits.push('Specialist starts are an observed conservative protocol goal, not an atomic provider or financial guard. A concurrently dispatched backend batch can exceed the count before browser cancellation. The owner reviews actual provider usage and cost against the authorized project spending controls.');
  report.interpretationLimits.push('GPT-Live has no provider voice turn-complete/interruption event. Boundaries here are actual client-local queue drains or 450ms rendered silence after audible samples, including the player speaker delay. Rendered silence may occur while silent PCM remains queued; it is not a queue drain or provider completion. Speech overlap suppresses local playback while the backend continues; it does not prove provider cancellation.');
  report.interpretationLimits.push('Deployment/source IDs are owner-verified provenance labels; served frontend/GLB bytes are independently hashed. Private backend byte identity requires the owner deployment/CI receipt. No additional feedback is submitted; the prior keyless owner receipt is separate.');
  await flush(); console.log(JSON.stringify({state: report.state, origin, output, providerSessions: report.providerSessions,
    specialistCalls: report.specialistCalls, connectionAttempts: report.connectionAttempts, failure: report.failure}, null, 2));
  if (report.state !== successState) process.exitCode = 1;
}
