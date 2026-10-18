// Manual public research/recovery protocol. --plan is offline; --run is owner-gated.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {publicOrigin, redact, safeEvent, ObservedNativeStream, sha256, spokenAnswer, playbackBoundaryObserved, playbackAfterReceipts, characterChunkPlan, characterChunkReceipt, allowedPublicRequest} from './helpers.mjs';
const PLAN = {state: 'PREPARED_NOT_RUN', scope: 'Manual external visitor: actual optional public research, voice refresh cleanup and successful manual reconnect.',
  limits: {providerSessions: 2, connectionAttempts: 2, transportRenewals: 4, publicToolCalls: 2, sessionSeconds: 180, wholeRunSeconds: 360},
  microphone: 'No microphone permissions, capture, synthetic input or media controls.', feedback: 'No submission.',
  gates: ['--run', 'EINSTEIN_AUXILIARY_APPROVED=1', 'EINSTEIN_PUBLIC_READY=1', 'EINSTEIN_PUBLIC_BUDGET_APPROVED=1', 'EINSTEIN_RESEARCH_PREREQUISITES=OWNER_VERIFIED_RELEASE_FUNDING_AND_EMPTY_ROOM', 'EINSTEIN_PUBLIC_URL', 'EINSTEIN_PUBLIC_DEPLOYMENT_ID', 'EINSTEIN_PUBLIC_RELEASE_SHA'],
  interpretation: 'Owner reviews earlier receipts and the exact live deployment before dispatch. Actual served frontend and character bytes are independently checked. Refresh exercises pagehide/WebSocket cleanup, not physical network loss. No quota exhaustion, human microphone, acoustic or naturalness claim.'};
if (!process.argv.includes('--run')) { console.log(JSON.stringify(PLAN, null, 2)); process.exit(0); }
if (['EINSTEIN_AUXILIARY_APPROVED', 'EINSTEIN_PUBLIC_READY', 'EINSTEIN_PUBLIC_BUDGET_APPROVED'].some(k => process.env[k] !== '1')) throw Error('Auxiliary public-run gates are not satisfied. No browser opened.');
if (process.env.EINSTEIN_RESEARCH_PREREQUISITES !== 'OWNER_VERIFIED_RELEASE_FUNDING_AND_EMPTY_ROOM') throw Error('Owner must verify the exact deployment, prior receipts, current funding/allowances, empty room and no concurrent deployment. No browser opened.');
const repo = fileURLToPath(new URL('../../', import.meta.url)), origin = publicOrigin(process.env.EINSTEIN_PUBLIC_URL);
const deployment = {id: process.env.EINSTEIN_PUBLIC_DEPLOYMENT_ID, sourceCommit: process.env.EINSTEIN_PUBLIC_RELEASE_SHA};
if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(deployment.id || '') || !/^[a-f0-9]{40}$/.test(deployment.sourceCommit || '')) throw Error('Exact owner-verified deployment/source labels are required.');
const runtimePaths = ['lab_backend', 'rehearsal', 'deploy', 'scripts/build_fastapi_bundle.py', 'tools/build_slides_runtime.py', 'THIRD_PARTY_NOTICES.md'];
let harnessCommit;
try { harnessCommit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repo, encoding: 'utf8'}).trim(); execFileSync('git', ['merge-base', '--is-ancestor', deployment.sourceCommit, harnessCommit], {cwd: repo}); execFileSync('git', ['diff', '--exit-code', deployment.sourceCommit, '--', ...runtimePaths], {cwd: repo, stdio: 'pipe'}); }
catch { throw Error('The exact deployed commit must be an ancestor with identical tracked runtime inputs. QA-only changes are allowed; no browser opened.'); }
const inputs = JSON.parse(await fs.readFile(path.join(repo, 'deploy/release-inputs.json'))), pin = inputs.assets.find(a => a.name === 'einstein.glb');
const chunks = characterChunkPlan(JSON.parse(await fs.readFile(path.join(repo, 'rehearsal/src/character-transfer.json'))), pin);
if (origin !== 'https://einstein-mobiliar-lab.fastapicloud.dev') throw Error('This auxiliary protocol is scoped to the existing approved host.');
const index = await fs.readFile(path.join(repo, 'rehearsal/dist/index.html'), 'utf8');
const expected = Object.fromEntries(await Promise.all([...index.matchAll(/(?:src|href)="(\/assets\/[^"?]+)"/g)].map(async ([, p]) => [p, sha256(await fs.readFile(path.join(repo, 'rehearsal/dist', p)))])));
if (!Object.keys(expected).some(p => p.endsWith('.js'))) throw Error('Build the reviewed frontend before the run.');
const {chromium} = await import('../../rehearsal/node_modules/@playwright/test/index.mjs');
const output = path.join(repo, `evidence/${new Date().toISOString().slice(0, 10)}-public-acceptance`, 'research-recovery-' + new Date().toISOString().replace(/[:.]/g, '-'));
await fs.mkdir(output, {recursive: true});
const report = {state: 'RUNNING_UNVERIFIED', startedAt: new Date().toISOString(), origin, ownerVerifiedDeployment: deployment, plan: PLAN,
  prerequisites: process.env.EINSTEIN_RESEARCH_PREREQUISITES, sourceProvenance: {harnessCommit, runtimePaths, runtimeInputsIdenticalToDeployedCommit: true}, harnessSha256: sha256(await fs.readFile(fileURLToPath(import.meta.url))), checks: [], events: [], requests: [], prompts: [], sessions: [], assets: {}, errors: [], limits: []};
let browser, context, page, fatal, nativeStream, permits = 0, attempts = 0, renewals = 0, activeAt = null, publicCalls = 0, inputBytes = 0;
const streams = [];
const until = Date.now() + 360000, parts = new Map(), captures = [], credentials = [], pause = ms => new Promise(r => setTimeout(r, ms));
const flush = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
function check(name, pass) { report.checks.push({at: new Date().toISOString(), name, passed: Boolean(pass)}); if (!pass) throw Error(name); }
function guard() { if (fatal) throw Error(fatal); if (Date.now() > until - 25000 || activeAt && Date.now() - activeAt > 155000) throw Error('Active deadline reached; cleanup time reserved.'); }
const state = () => page.evaluate(() => { const a = window.__einstein; return {active: a.native.active, connecting: a.native.connecting, avatarReady: a.stats.avatarReady,
  continuousAudio: a.native.continuousAudio, provider: a.stats.nativeProvider, model: a.stats.nativeModel, conversationId: a.stats.nativeConversationId, publicWeb: a.stats.publicWebEnabled, socketClose: a.stats.nativeSocketClose,
  outputBytes: a.stats.nativeOutputBytes || 0, renderedSignalSamples: a.stats.audioRenderedSignalSamples || 0, renderedQuietMs: a.stats.audioRenderedQuietMs || 0,
  playbackBoundaries: a.stats.nativePlaybackBoundaries || 0, lastPlaybackBoundaryEpochMs: Number.isFinite(a.stats.nativeLastPlaybackBoundaryAt) ? performance.timeOrigin + a.stats.nativeLastPlaybackBoundaryAt : null,
  lastPlaybackBoundaryReason: a.stats.nativeLastPlaybackBoundaryReason, playerEntries: a.player.entries.length, audioPlaying: a.stats.audioPlaying,
  speaking: a.native.speaking, suppressAudio: a.native.suppressAudio, microphoneActive: a.stats.microphoneActive, stream: Boolean(a.native.stream), lastTurn: a.stats.lastTurn, error: document.querySelector('#error').hidden ? '' : document.querySelector('#error-message').textContent,
  texturedMeshes: (() => { let n = 0; a.stage.model?.traverse(x => { if (x.isMesh && (Array.isArray(x.material) ? x.material : [x.material]).some(m => m?.map)) n++; }); return n; })()}; });
async function poll(test, label, seconds = 65) { const end = Math.min(until - 25000, Date.now() + seconds * 1000); while (Date.now() < end) { guard(); const s = await state(); if (s.microphoneActive || s.stream || inputBytes) throw Error('Unexpected microphone input.'); if (await test(s)) return s; await pause(200); } throw Error('Bounded wait expired: ' + label); }
async function status() { const r = await page.request.get(origin + '/api/native/status', {timeout: 5000}); if (r.status() !== 200) throw Error('Native status read failed.'); return r.json(); }
async function settled(id) {
  const end = Math.min(until - 5000, Date.now() + 22000); let s;
  while (Date.now() < end) { s = await status(); if (!s.active && s.last_session?.conversation_id === id && s.last_session?.provider_usage?.final_usage_confirmed === true && s.room_active_sessions === 0) break; await pause(250); }
  const last = s?.last_session; report.sessions.find(x => x.conversationId === id).final = {active: s?.active, room_active_sessions: s?.room_active_sessions, last_session: last,
    research: s?.research ? {model: s.research.model, provider: s.research.provider, last_request: s.research.last_request} : null,
    publicResearch: s?.public_research ? {provider: s.public_research.provider, model: s.public_research.model, calls: s.public_research.calls, last: s.public_research.last, contentVerified: s.public_research.content_verified_this_process} : null};
  check('Own session released room and returned confirmed final provider usage', !s.active && s.room_active_sessions === 0 && last?.conversation_id === id && ['closed', 'client_disconnected'].includes(last.outcome) && last.provider_usage?.final_usage_confirmed === true);
  activeAt = null; return last;
}
async function stop() { if (!page || page.isClosed()) return; for (let i = 0; i < 4 && await page.locator('dialog[open]').count(); i++) await page.keyboard.press('Escape'); const s = await state().catch(() => null); if (s?.active || s?.connecting) await page.click('#interrupt', {timeout: 5000}); }
async function type(text, label, {wait = true, condition = () => true} = {}) {
  guard(); if (text.length > 700) throw Error('Prompt exceeds the real UI input bound.'); const before = await state(), start = report.events.length; report.prompts.push({at: new Date().toISOString(), label, text, eventStart: start});
  await page.click('#keyboard-toggle'); if (!before.active && !before.connecting) await page.selectOption('#reply-mode', 'voice'); await page.fill('#question', text); await page.click('#send');
  const consent = page.locator('dialog[aria-labelledby="processing-heading"]'); if (await consent.isVisible()) await consent.getByRole('button', {name: 'Agree and begin', exact: true}).click();
  if (!wait) return before;
  return poll(s => { const events = report.events.slice(start), receipt = events.findLast(e => e.event === 'sources');
    const narration = receipt ? spokenAnswer(events.filter(e => Date.parse(e.at) >= Date.parse(receipt.at))) : '';
    return playbackBoundaryObserved(before, s) && playbackAfterReceipts(s, events) && condition(events) && (!receipt || narration.trim().split(/\s+/).length >= 8 && /[.!?](?:["')\]]?\s|$)/.test(narration) && s.lastPlaybackBoundaryEpochMs >= Date.parse(receipt.at) - 100);
  }, label);
}
const official = u => { try { const x = new URL(u); return x.protocol === 'https:' && /^(?:mobililab|mobiliarlab)\.ethz\.ch$/.test(x.hostname) && !x.username && !x.password && !x.hash && [...x.searchParams].every(([key, value]) => ['research-proj-posts', 'page_id', 'p'].includes(key) && /^[A-Za-z0-9_-]{1,200}$/.test(value)); } catch { return false; } };
const complete = (events, tool) => events.some(e => e.event === 'work_activity' && e.tool === tool && e.status === 'sources-found' && e.source_count > 0);
const watchdog = setInterval(() => { if (Date.now() >= until || activeAt && Date.now() - activeAt >= 180000) { fatal = 'Hard whole-run/session deadline.'; void browser?.close(); } else if (activeAt && Date.now() - activeAt >= 160000) { fatal = 'Session cleanup deadline.'; void stop().catch(() => {}); } }, 1000);
try {
  browser = await chromium.launch({channel: 'chrome', headless: true, args: []});
  context = await browser.newContext({viewport: {width: 1440, height: 1000}, permissions: []}); page = await context.newPage();
  const cdp = await context.newCDPSession(page); await cdp.send('Network.enable', {maxTotalBufferSize: 180000000, maxResourceBufferSize: 80000000});
  page.on('request', r => { const u = new URL(r.url()); if (!/^https?:$/.test(u.protocol)) return; const e = {origin: u.origin, path: u.pathname, method: r.method(), hasQuery: Boolean(u.search)}; report.requests.push(e);
    if (u.origin !== origin) credentials.push(r.allHeaders().then(h => { e.credentialHeadersPresent = 'cookie' in h || 'authorization' in h; if (!allowedPublicRequest(e, origin, chunks)) fatal = 'Unexpected external request or credentialed CDN request.'; }).catch(() => { fatal = 'CDN credential check failed.'; }));
    if (r.method() === 'POST' && u.pathname === '/api/native/permit' && ++permits > 2) fatal = 'More than two permit attempts.';
    if (r.method() === 'POST' && ['/api/feedback', '/api/presentation/convert', '/api/native/configure'].includes(u.pathname)) fatal = 'Unexpected write or conversion.';
  });
  page.on('response', r => captures.push((async () => { const u = new URL(r.url()), chunk = chunks.urls.get(r.url());
    if (u.origin === origin && r.status() >= 400) fatal = `Public HTTP rejection ${r.status()} on ${u.pathname}`;
    if (u.origin === origin && expected[u.pathname] && r.status() === 200) report.assets[u.pathname] = sha256(await r.body());
    if (chunk) { if (r.status() !== 200) throw Error('CDN response failed.'); const b = await r.body(); if (b.length !== chunk.bytes || sha256(b) !== chunk.sha256) throw Error('CDN chunk mismatch.'); parts.set(chunk.name, b); }
  })().catch(e => { fatal = redact(e.message); })));
  page.on('pageerror', e => { fatal = redact(e.message); report.errors.push(fatal); });
  page.on('console', m => { if (m.type() === 'error') { report.errors.push(redact(m.text())); fatal = 'Browser console error.'; } });
  page.on('websocket', socket => {
    const u = new URL(socket.url());
    if (u.origin !== origin.replace('https:', 'wss:')) { fatal = 'Unexpected WebSocket origin.'; return; }
    if (u.pathname === '/api/native/voice') { if (++attempts > 2) fatal = 'Unexpected provider connection attempt.'; nativeStream = new ObservedNativeStream(); streams.push(nativeStream); }
    else if (u.pathname === '/api/native/renew') { if (++renewals > PLAN.limits.transportRenewals || !nativeStream || (nativeStream.renewalAttempts = (nativeStream.renewalAttempts || 0) + 1) > 2) fatal = 'Unexpected transport renewal.'; }
    else { fatal = 'Unexpected WebSocket path.'; return; }
    const observed = nativeStream;
    const application = v => { if (v.event === 'audio') return;
      const e = {at: new Date().toISOString(), direction: 'received', ...safeEvent(v)}; report.events.push(e);
      if (v.event === 'connected') { activeAt = Date.now(); report.sessions.push({conversationId: v.conversation_id, connectedAt: new Date().toISOString(), provider: v.provider, model: v.model, publicWebEnabled: v.public_web_enabled}); if (report.sessions.length > 2 || v.provider !== 'OpenAI' || v.model !== 'gpt-live-1' || !v.continuous_audio) { fatal = 'Unexpected provider session.'; void stop().catch(() => {}); } }
      if (v.event === 'input_transcript' && String(v.text || '').trim()) fatal = 'Provider transcribed speech without approved microphone PCM.';
      if (v.event === 'work_activity' && !['search_public', 'read_public', 'lookup_lab'].includes(v.tool)) fatal = 'Unexpected reasoning tool.';
      if (v.event === 'work_activity' && v.status === 'running' && ['search_public', 'read_public'].includes(v.tool) && ++publicCalls > 2) fatal = 'Public tool allocation exceeded.';
      if (v.event === 'work_activity' && ['search_public', 'read_public'].includes(v.tool) && !['running', 'sources-found'].includes(v.status)) fatal = 'Public research failed or found no readable sources.';
      if (v.event === 'error' || ['research_started', 'document_vision_started', 'video_vision_started', 'visual_inspected', 'document_action', 'video_action', 'presentation_action'].includes(v.event)) fatal = 'Provider error or unapproved additional tool.';
    };
    socket.on('framereceived', ({payload}) => { let v; try { v = JSON.parse(String(payload)); } catch { return; }
      try { observed.receive(v).forEach(application); } catch { fatal = 'Invalid or changed native transport conversation.'; void stop().catch(() => {}); }
    });
    socket.on('framesent', ({payload}) => { if (typeof payload !== 'string') { inputBytes += payload.length; fatal = 'Unexpected microphone bytes.'; } });
    socket.on('close', () => report.events.push({at: new Date().toISOString(), event: 'websocket_closed'}));
    socket.on('socketerror', m => { fatal = 'WebSocket transport error.'; report.errors.push(redact(m)); });
  });
  await page.goto(origin, {waitUntil: 'domcontentloaded', timeout: 30000});
  await page.waitForFunction(() => window.__einstein?.stats.avatarReady && window.__einstein.stats.nativeStatus, undefined, {timeout: 120000});
  await Promise.all(captures); await Promise.all(credentials); guard(); report.character = characterChunkReceipt(chunks, parts); parts.clear();
  check('Actual served original character and reviewed entry assets match', Object.entries(expected).every(([p, h]) => report.assets[p] === h) && (await state()).texturedMeshes > 0);
  const initial = await status(); check('Fresh own visitor and empty room, funded expected provider', !initial.active && initial.last_session === null && initial.room_active_sessions === 0 && initial.provider === 'OpenAI' && initial.model === 'gpt-live-1' && initial.available && initial.funding_verified);
  check('Optional research uses the funded OpenAI route without provider fallback', initial.public_research?.provider === 'OpenAI Responses web search' && initial.public_research.model === 'gpt-6.1-sol');
  const cookie = (await context.cookies(origin)).find(c => c.name === 'einstein_visitor'); report.visitor = cookie ? {sha256: sha256(cookie.value), httpOnly: cookie.httpOnly, secure: cookie.secure, sameSite: cookie.sameSite} : null;
  check('Secure fresh visitor cookie', report.visitor?.httpOnly && report.visitor.secure && report.visitor.sameSite === 'Strict');
  await page.click('#settings-toggle'); await page.locator('#public-web').check(); check('Public research consent uses actual Settings control', await page.locator('#public-web').isChecked()); await page.getByRole('button', {name: 'Close settings', exact: true}).click();
  await type('For this public test, call search_public exactly once to find official ETH Zurich Mobiliar Lab project pages. Use public queries only. After the results, name one returned official project and its exact URL in one short sentence, then wait. Do not read pages, inspect images or call consult_flash.', 'Actual public search', {condition: e => complete(e, 'search_public') && e.some(x => x.event === 'sources' && x.sources?.some(s => s.source_kind === 'openai-public-search' && official(s.url)))});
  check('Real connection received enabled optional research', (await state()).publicWeb && report.sessions[0].publicWebEnabled === true);
  const selected = report.events.flatMap(e => e.event === 'sources' ? e.sources || [] : []).find(s => s.source_kind === 'openai-public-search' && official(s.url)); report.selectedOfficialSource = selected;
  await type(`Call read_public exactly once with the actual returned official URL ${selected.url}. Cite that page and describe one source-reported project aim, with uncertainty, in one short sentence. Do not search again, inspect images or call consult_flash.`, 'Actual returned official page read', {condition: e => complete(e, 'read_public') && e.some(x => x.event === 'sources' && x.sources?.some(s => s.source_kind === 'openai-public-page' && s.url === selected.url && s.excerptBytes > 0))});
  check('Actual public search and read receipts, not only spoken claims', publicCalls === 2 && (await status()).public_research.content_verified_this_process === true);
  const before = await type('Explain in five short sentences how surface tension shapes a soap bubble. Use no tools.', 'Active spoken connection before refresh', {wait: false});
  await poll(s => s.audioPlaying && s.renderedSignalSamples > before.renderedSignalSamples, 'Actual active speech before refresh', 20);
  const firstId = (await state()).conversationId; report.refresh = {at: new Date().toISOString(), conversationId: firstId, mechanism: 'Actual page.reload during rendered speech; existing pagehide cleanup, no guard override.'};
  await page.reload({waitUntil: 'domcontentloaded', timeout: 30000}); await page.waitForFunction(() => window.__einstein?.stats.avatarReady && window.__einstein.stats.nativeStatus, undefined, {timeout: 60000});
  const fresh = await state(); check('Refreshed actual frontend is inactive without microphone or queued audio', !fresh.active && !fresh.connecting && !fresh.microphoneActive && !fresh.stream && !fresh.audioPlaying && fresh.playerEntries === 0);
  await settled(firstId); const count = attempts + renewals; report.cooldown = {startedAt: new Date().toISOString(), waitSeconds: 33};
  const reconnectAt = Date.now() + 33000; while (Date.now() < reconnectAt) { guard(); await pause(250); }
  check('No automatic reconnect while waiting for cooldown', attempts + renewals === count && !(await state()).active && !(await status()).active);
  const beforeReconnect = await status(), continuedCookie = (await context.cookies(origin)).find(c => c.name === 'einstein_visitor');
  check('Same own visitor and empty room before manual reconnect', sha256(continuedCookie?.value || '') === report.visitor.sha256 && beforeReconnect.available && !beforeReconnect.active && beforeReconnect.room_active_sessions === 0 && beforeReconnect.last_session?.conversation_id === firstId);
  await type('For this public recovery test, say hello in one short sentence and wait. Use no tools.', 'One manual UI reconnect after cooldown');
  const secondId = (await state()).conversationId; check('Manual reconnect created one new independent provider conversation', secondId !== firstId && secondId === report.sessions[1]?.conversationId && report.sessions.length === 2 && attempts === 2 && permits === 2);
  await stop(); await settled(secondId); const final = await state();
  check('Actual Stop cleared local capture and playback', !final.active && !final.connecting && !final.microphoneActive && !final.stream && !final.audioPlaying && final.playerEntries === 0 && inputBytes === 0);
  await Promise.all(credentials); guard(); check('No unexpected external requests or console errors', report.requests.every(r => allowedPublicRequest(r, origin, chunks)) && report.errors.length === 0);
  report.state = 'PUBLIC_RESEARCH_REFRESH_RECOVERY_PASSED';
} catch (e) { report.state = 'FAILED_OR_INCOMPLETE'; report.failure = redact(e.message); }
finally {
  await stop().catch(e => report.limits.push(redact('Stop cleanup: ' + e.message)));
  const pending = report.sessions.find(s => !s.final?.last_session?.provider_usage?.final_usage_confirmed); if (pending && page && !page.isClosed()) await settled(pending.conversationId).catch(e => report.limits.push(redact('Final usage cleanup: ' + e.message)));
  await browser?.close().catch(() => {}); clearInterval(watchdog); report.completedAt = new Date().toISOString();
  for (let i = 0; i < report.prompts.length; i++) { const p = report.prompts[i], events = report.events.slice(p.eventStart, report.prompts[i + 1]?.eventStart); p.actualJoinedSpokenAnswer = spokenAnswer(events); const receipt = events.findLast(e => e.event === 'sources'); if (receipt) p.actualPostSourceNarration = spokenAnswer(events.filter(e => Date.parse(e.at) >= Date.parse(receipt.at))); }
  report.elapsedSeconds = (Date.now() - Date.parse(report.startedAt)) / 1000;
  report.observed = {providerSessions: report.sessions.length, connectionAttempts: attempts, transportRenewals: renewals, totalSocketAttempts: attempts + renewals, permitPosts: permits, publicToolCalls: publicCalls, microphoneInputBytes: inputBytes,
    streams: streams.map(s => ({lastSequence: s.lastSequence, duplicates: s.duplicates, controls: s.controls, renewals: s.renewalAttempts || 0, pendingPackets: s.pending.size}))};
  if (report.state === 'PUBLIC_RESEARCH_REFRESH_RECOVERY_PASSED' && (fatal || report.elapsedSeconds > 360 || report.limits.length || report.sessions.length !== 2 || streams.some(s => s.pending.size) || report.sessions.some(s => s.final?.last_session?.provider_usage?.final_usage_confirmed !== true))) { report.state = 'FAILED_OR_INCOMPLETE'; report.failure = redact(fatal || 'Deadline or final session cleanup was not confirmed.'); }
  await flush(); console.log(JSON.stringify({state: report.state, output, observed: report.observed, failure: report.failure}));
}
if (report.state !== 'PUBLIC_RESEARCH_REFRESH_RECOVERY_PASSED') process.exitCode = 1;
