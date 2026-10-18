import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createStatusLoader} from '../src/service-status.js';
import {quickLabFact, contextualLabQuestion} from '../src/quick-lab-fact.js';
import {processingProvider, configuredVoices, configuredVoice, initialVoicePreferences} from '../src/processing-consent.js';

const available = {available: true, public_deployment: true, provider: 'OpenAI', model: 'gpt-live-1',
  default_voice: 'flitz', voices: {flitz: {label: 'Configured voice'}}};
const response = (value = available, status = 200) => ({ok: status === 200, status, json: async () => value});
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return {promise, resolve}; };

test('concurrent status checks share one same-origin GET cycle and never request a provider', async () => {
  const wait = deferred(), calls = [];
  const load = createStatusLoader({fetcher: (url, options) => { calls.push({url, options}); return wait.promise; }});
  const first = load(), second = load();
  assert.equal(first, second); assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/native/status');
  assert.equal(calls[0].options.method, 'GET'); assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[0].options.cache, 'no-store'); assert.equal(calls[0].options.redirect, 'error');
  wait.resolve(response()); assert.deepEqual(await first, available);
});

test('transport failure retries once, then returns the actual status', async () => {
  let calls = 0; const attempts = [];
  const load = createStatusLoader({retryDelayMs: 0, onAttempt: index => attempts.push(index), fetcher: async () => {
    if (++calls === 1) throw new TypeError('Synthetic network failure');
    return response();
  }});
  assert.deepEqual(await load(), available); assert.equal(calls, 2); assert.deepEqual(attempts, [1, 2]);
});

for (const status of [502, 503, 504]) test(`HTTP ${status} allows exactly one delayed GET retry`, async () => {
  let calls = 0;
  const load = createStatusLoader({retryDelayMs: 0, fetcher: async () => { calls++; return response(null, status); }});
  await assert.rejects(load(), error => error.code === 'http' && error.httpStatus === status);
  assert.equal(calls, 2);
});

for (const status of [400, 401, 403, 404, 429, 500]) test(`HTTP ${status} stops without retrying`, async () => {
  let calls = 0;
  const load = createStatusLoader({retryDelayMs: 0, fetcher: async () => { calls++; return response(null, status); }});
  await assert.rejects(load(), error => error.httpStatus === status);
  assert.equal(calls, 1);
});

test('a valid unavailable status is returned once without retry or provider start', async () => {
  let calls = 0;
  const value = {...available, available: false, reason: 'Operator approval required'};
  const load = createStatusLoader({fetcher: async () => { calls++; return response(value); }});
  assert.deepEqual(await load(), value); assert.equal(calls, 1);
});

test('the deadline covers a response whose JSON body never finishes, then stops after one retry', async () => {
  const signals = [];
  const load = createStatusLoader({timeoutMs: 5, retryDelayMs: 0, fetcher: async (_url, options) => {
    signals.push(options.signal); return {ok: true, json: () => new Promise(() => {})};
  }});
  await assert.rejects(load(), error => error.code === 'timeout');
  assert.equal(signals.length, 2); assert(signals.every(signal => signal.aborted));
});

test('a stalled body can recover on its one retry without accepting the late first body', async () => {
  const firstBody = deferred(); let calls = 0;
  const load = createStatusLoader({timeoutMs: 5, retryDelayMs: 0, fetcher: async () => ++calls === 1 ?
    {ok: true, json: () => firstBody.promise} : response()});
  assert.deepEqual(await load(), available);
  firstBody.resolve({...available, available: false}); await Promise.resolve();
  assert.equal(calls, 2);
});

test('body transport errors may retry; malformed JSON and invalid status shapes do not', async () => {
  let calls = 0;
  const load = createStatusLoader({retryDelayMs: 0, fetcher: async () => ++calls === 1 ?
    {ok: true, json: async () => { throw new TypeError('Body transport failed'); }} : response()});
  assert.deepEqual(await load(), available); assert.equal(calls, 2);
  for (const value of [null, [], {}, {available: 'yes'}, 'not a status']) {
    let count = 0;
    const invalid = createStatusLoader({fetcher: async () => { count++; return response(value); }});
    await assert.rejects(invalid(), error => error.code === 'invalid-response'); assert.equal(count, 1);
  }
  calls = 0;
  const malformed = createStatusLoader({fetcher: async () => { calls++; return {ok: true, json: async () => { throw new SyntaxError('Malformed JSON'); }}; }});
  await assert.rejects(malformed(), error => error.code === 'invalid-response'); assert.equal(calls, 1);
});

test('an explicit later check starts a fresh bounded GET cycle after a failed one', async () => {
  let healthy = false, calls = 0;
  const load = createStatusLoader({retryDelayMs: 0, fetcher: async () => {
    calls++; if (!healthy) throw new TypeError('Offline'); return response();
  }});
  await assert.rejects(load()); assert.equal(calls, 2);
  healthy = true; assert.deepEqual(await load(), available); assert.equal(calls, 3);
});

// Exercise the actual status/UI functions without running WebGL, local audio,
// provider transport or the rest of the application bootstrap.
const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const between = (start, end) => {
  const first = main.indexOf(start), last = main.indexOf(end, first);
  assert(first >= 0 && last > first); return main.slice(first, last);
};
function ui(fetcher) {
  const nodes = new Map(), controls = {native: [{}], local: [{}]};
  const $ = selector => {
    if (!nodes.has(selector)) {
      const label = {};
      nodes.set(selector, {textContent: '', value: '', hidden: false, disabled: false,
        closest: () => label, replaceChildren() {}});
    }
    return nodes.get(selector);
  };
  $('#conversation-engine').value = 'local';
  const stats = {}, calls = {approval: 0, closed: 0, starts: 0, stops: 0, text: []};
  const native = {active: false, connecting: false, serial: 0, sendText: text => calls.text.push(text),
    start() { calls.starts++; throw Error('No provider start is allowed in this fixture.'); },
    async stop() { calls.stops++; this.serial++; this.active = this.connecting = false; }};
  const document = {body: {classList: {toggle() {}, add() {}}}, querySelector: $,
    querySelectorAll: selector => controls[selector.includes('data-native') ? 'native' : 'local'], createElement: () => ({})};
  const code = [between('async function ensureConversation(', '\nfunction restoreTeachingSources'), between('function error(', 'function positionNotice('),
    between('function updateVoiceControls(', "$('#public-web').checked"),
    between('native.beforeStart = () => {', '\nwindow.__einstein ='),
    between('async function ask(', '\nasync function startVoice('),
    between('async function startVoice(', "\n$('#question-form').addEventListener")].join('\n');
  return {stats, native, calls, nodes, controls, $, ...new Function('$', 'stats', 'native', 'document', 'window',
    'localStorage', 'processingProvider', 'configuredVoices', 'configuredVoice', 'initialVoicePreferences',
    'createStatusLoader', 'fetcher', 'calls', 'quickLabFact', 'contextualLabQuestion', `
      let nativeStatus = null, publicDeployment = false, statusErrorMessage = '', questionIntent = 0, conversationStart = null;
      let precedingLabQuestion = null;
      const syncReplyControls = () => {};
      const interrupt = async () => {questionIntent++; await native.stop();};
      const loadNativeStatus = createStatusLoader({fetcher, retryDelayMs: 0,
        onAttempt: attempt => { stats.nativeStatusCheck = {phase: 'checking', attempt}; }});
      const positionNotice = () => {}, closeDialogs = () => { calls.closed++; };
      const approveProcessing = async () => { calls.approval++; };
      const handsFree = {active: false}, resetResearchTurn = () => {};
      let nativeQuestion = '', nativeAnswer = '', nativeSources = [];
      ${code}
      return {refreshNativeStatus, pinPublicMode, ask, startVoice, status: () => nativeStatus};
    `)($, stats, native, document, {}, {getItem: () => null, setItem() {}},
      processingProvider, configuredVoices, configuredVoice, initialVoicePreferences, createStatusLoader, fetcher, calls,
      question => quickLabFact(question, {fetcher}), contextualLabQuestion)};
}

test('failed UI checks clear both status copies; public health pins mode and keeps key/local UI hidden', async () => {
  let healthy = true;
  const view = ui(async () => { if (!healthy) throw new TypeError('Offline'); return response(); });
  await view.refreshNativeStatus(); assert.equal(view.stats.nativeStatus.available, true);
  healthy = false; await view.refreshNativeStatus();
  assert.equal(view.status(), null); assert.equal(view.stats.nativeStatus, null);
  assert.equal(view.stats.nativeStatusCheck.phase, 'failed');
  assert.equal(view.$('#native-status-retry').hidden, false);
  view.pinPublicMode({public_deployment: true});
  assert.equal(view.$('#conversation-engine').value, 'native');
  assert.equal(view.$('#conversation-engine option[value=local]').disabled, true);
  assert.equal(view.$('#conversation-engine').closest('label').hidden, true);
  assert.equal(view.$('#native-setup').hidden, true); assert.equal(view.$('#native-setup').open, false);
  assert.equal(view.$('#preview-voice').hidden, true); assert.equal(view.$('#preview-voice').disabled, true);
  assert.equal(view.$('#native-voice').disabled, true); assert.equal(view.$('#native-accent').disabled, true);
  assert.match(view.$('#native-status').textContent, /could not be reached/);
  assert(view.controls.local.every(control => control.hidden));
  await view.ask('A question'); await view.startVoice();
  assert.equal(view.calls.approval, 0); assert.equal(view.$('#native-setup').open, false);
});

test('unknown status disables voice choices and preview while its first GET is still pending', async () => {
  const wait = deferred(), view = ui(() => wait.promise);
  const pending = view.refreshNativeStatus();
  assert.equal(view.$('#preview-voice').hidden, true); assert.equal(view.$('#preview-voice').disabled, true);
  assert.equal(view.$('#native-voice').disabled, true); assert.equal(view.$('#native-accent').disabled, true);
  wait.resolve(response()); await pending;
  assert.equal(view.$('#native-voice').disabled, false); assert.equal(view.$('#native-accent').disabled, false);
  assert.equal(view.calls.approval, 0);
});

test('GET-only Retry recovers status but leaves consent and provider start for the explicit user action', async () => {
  let healthy = false, requests = 0;
  const view = ui(async () => { requests++; if (!healthy) throw new TypeError('Offline'); return response(); });
  await view.refreshNativeStatus(); assert.equal(requests, 2);
  assert.throws(() => view.native.beforeStart(), /Check the conversation service/);
  healthy = true; view.$('#native-status-retry').onclick(); await view.refreshNativeStatus();
  assert.equal(requests, 3); assert.equal(view.status().available, true);
  assert.equal(view.$('#native-status-retry').hidden, true);
  assert.equal(view.calls.approval, 0); assert.equal(view.native.active, false);
  await view.native.beforeStart(); assert.equal(view.calls.approval, 1);
});

test('public health pins an initially failed check, and known public unavailability never opens local key setup', async () => {
  const failed = ui(async () => response(null, 403));
  await failed.refreshNativeStatus(); assert.equal(failed.status(), null);
  failed.pinPublicMode({public_deployment: true});
  assert.equal(failed.$('#conversation-engine').value, 'native');
  assert.equal(failed.$('#native-setup').hidden, true);
  await failed.ask('A question'); await failed.startVoice();
  assert.equal(failed.calls.approval, 0);
  const unavailable = ui(async () => response({...available, available: false}));
  await unavailable.refreshNativeStatus();
  await unavailable.ask('A question'); await unavailable.startVoice();
  assert.equal(unavailable.$('#native-setup').hidden, true);
  assert.equal(unavailable.$('#native-setup').open, false);
  assert.equal(unavailable.calls.approval, 0);
});

test('a failed settings GET preserves typed turns and Stop on the already-consented active connection', async () => {
  let healthy = true, checks = 0;
  const view = ui(async () => { checks++; if (!healthy) throw new TypeError('Offline'); return response(); });
  await view.refreshNativeStatus(); view.native.active = true;
  healthy = false; await view.refreshNativeStatus();
  assert.equal(view.status(), null); assert.equal(checks, 3);
  await view.ask('Continue with the current idea.');
  assert.deepEqual(view.calls.text, ['Continue with the current idea.']);
  assert.equal(view.calls.starts, 0); assert.equal(view.calls.approval, 0); assert.equal(checks, 3);
  view.stats.microphoneActive = true; await view.startVoice();
  assert.equal(view.calls.stops, 1); assert.equal(view.native.active, false);
  await view.ask('A new conversation is still unavailable.');
  assert.equal(view.calls.text.length, 1); assert.equal(view.calls.starts, 0);
});

test('questions submitted during one startup coalesce to the latest intent without a second session', async () => {
  const view = ui(async () => response()), wait = deferred();
  await view.refreshNativeStatus();
  view.native.start = async ({textOnly}) => { view.native.textOnly = textOnly; view.calls.starts++; view.native.connecting = true; await wait.promise; view.native.active = true; view.native.connecting = false; };
  const first = view.ask('Old question.');
  const second = view.ask('Current question.');
  wait.resolve(); await Promise.all([first, second]);
  assert.equal(view.calls.starts, 1);
  assert.deepEqual(view.calls.text, ['Current question.']);
});

test('Stop permits an explicit switch to writing while the retired voice startup is still pending', async () => {
  const view=ui(async()=>response()),oldWait=deferred(),newWait=deferred();await view.refreshNativeStatus();
  view.native.start=async({textOnly})=>{
    view.calls.starts++;view.native.textOnly=textOnly;view.native.connecting=true;const serial=++view.native.serial;
    await (textOnly?newWait.promise:oldWait.promise);
    if(view.native.serial===serial){view.native.active=true;view.native.connecting=false;}
  };
  view.$('#reply-mode').value='voice';const old=view.ask('Canceled voice question.');
  await view.startVoice();assert.equal(view.native.connecting,false);
  view.$('#reply-mode').value='text';const current=view.ask('Written replacement.');
  assert.equal(view.calls.starts,2);assert.equal(view.native.textOnly,true);
  oldWait.resolve();await old;
  // An old finally must not remove the current startup owner.
  const latest=view.ask('Latest written question.');assert.equal(view.calls.starts,2);
  newWait.resolve();await Promise.all([current,latest]);
  assert.deepEqual(view.calls.text,['Latest written question.']);
});

test('a finished written walkthrough replaces the manual-next hint with its actual state', () => {
  const code = between("    if (event.event === 'teaching_finished')", "    if (event.event === 'document_tool_requested')");
  for (const [status, expected] of [['paused', /paused.*continue/i], ['presented-progressively', /complete.*follow-up/i]]) {
    const nodes = new Map(), $ = id => { if (!nodes.has(id)) nodes.set(id, {}); return nodes.get(id); };
    const native = {textOnly: true, teaching: {active: true, cancel() { this.active = false; }}};
    new Function('event', 'native', '$', code)({event: 'teaching_finished', status}, native, $);
    assert.match($('#written-status').textContent, expected);
    assert.equal($('#teaching-next').disabled, true);
    assert.equal(native.teaching.active, false);
  }
});
