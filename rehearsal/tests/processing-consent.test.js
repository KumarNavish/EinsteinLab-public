import test from 'node:test';
import assert from 'node:assert/strict';
import {processingConsent, processingNotice, sourceProcessingNotice, configuredVoices, configuredVoice, initialVoicePreferences, VOICE_PERSONA_VERSION} from '../src/processing-consent.js';

const openAI = {provider: 'OpenAI', model: 'gpt-live-1', privacy: 'OpenAI API processing terms apply. Abuse-monitoring logs may be retained for up to 30 days; backend response state may also be retained.',
  voices: {marin: {label: 'Marin'}, cedar: {label: 'Cedar'}}, default_voice: 'cedar'};

test('previous default migrates once to German persona and later choices survive reload', () => {
  const current = {...openAI, voices: {...openAI.voices, flitz: {label: 'Flitz'}}, default_voice: 'flitz'};
  const version = `${VOICE_PERSONA_VERSION}:flitz`;
  assert.deepEqual(initialVoicePreferences(current, {voice: 'cedar', accent: 'original'}),
    {voice: 'flitz', accent: 'german', migrate: true, version});
  assert.deepEqual(initialVoicePreferences(current, {voice: 'marin', accent: 'original', version}),
    {voice: 'marin', accent: 'original', migrate: false, version});
  assert.equal(initialVoicePreferences(openAI, {voice: 'marin', accent: 'original'}).voice, 'marin');
});

test('a saved designed default replaces the previous stock persona once, preserving subsequent choices', () => {
  const current = {...openAI, default_voice: 'voice_operatorPinned', voices: {...openAI.voices,
    flitz: {label: 'Flitz'}, voice_operatorPinned: {label: 'Designed elder'}}};
  const first = initialVoicePreferences(current, {voice: 'flitz', accent: 'german', version: 'elder-german-v1'});
  assert.equal(first.voice, 'voice_operatorPinned'); assert.equal(first.migrate, true);
  const later = initialVoicePreferences(current, {voice: 'flitz', accent: 'original', version: first.version});
  assert.equal(later.voice, 'flitz'); assert.equal(later.accent, 'original'); assert.equal(later.migrate, false);
  const changed = initialVoicePreferences({...current, default_voice: 'voice_second', voices: {...current.voices, voice_second: {label: 'Another designed elder'}}}, first);
  assert.equal(changed.voice, 'voice_second'); assert.equal(changed.migrate, true);
});

test('OpenAI consent and selected-source copy use only the configured API policy', () => {
  assert.equal(processingNotice(openAI), openAI.privacy);
  for (const text of [processingNotice(openAI), ...['pdf', 'video', 'converted-pptx', 'retrieved-public-pdf'].map(kind => sourceProcessingNotice(openAI, kind))]) {
    assert.match(text, /OpenAI/); assert.match(text, /API processing terms/);
    assert.match(text, /up to 30 days/);
    assert(!/Google|free tier|free-tier|confidential|not used.*train/i.test(text));
  }
  assert.match(sourceProcessingNotice(openAI, 'video'), /video file and its audio remain in this browser/);
  assert.match(sourceProcessingNotice(openAI, 'converted-pptx'), /uploaded for temporary server conversion/);
  assert.deepEqual(configuredVoices(openAI), [{id: 'marin', label: 'Marin'}, {id: 'cedar', label: 'Cedar'}]);
  assert.equal(configuredVoice(openAI, 'Algenib'), 'cedar');
  assert.equal(configuredVoice(openAI, 'marin'), 'marin');
  assert.equal(configuredVoice({voices: {Algenib: {label: 'Algenib'}}, default_voice: 'Algenib'}, 'cedar'), 'Algenib');
});

test('local Google disclosures remain explicit, while unknown status names no assumed provider', () => {
  assert.match(processingNotice({model: 'gemini-local-fixture'}), /Google’s free tier may use/);
  assert(!processingNotice(null).includes('Google'));
  assert.deepEqual(configuredVoices(null), []);
});

test('consent cannot carry over to a different provider or policy', async t => {
  class Element extends EventTarget {
    children = []; textContent = ''; showCount = 0;
    setAttribute() {}
    append(...nodes) { this.children.push(...nodes); }
    showModal() { this.showCount++; }
    close(value) { this.returnValue = value; this.dispatchEvent(new Event('close')); }
  }
  const previous = globalThis.document, nodes = [], app = new Element();
  globalThis.document = {createElement() { const node = new Element(); nodes.push(node); return node; }, querySelector() { return app; }};
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  let status = {provider: 'Google', model: 'gemini-fixture'};
  const approve = processingConsent(() => status), first = approve(), concurrent = approve();
  const dialog = nodes[0]; assert.equal(dialog.showCount, 1);
  dialog.close('approved'); await Promise.all([first, concurrent]); await approve();
  assert.equal(dialog.showCount, 1);
  status = openAI;
  const second = approve(); assert.equal(dialog.showCount, 2);
  assert.match(nodes[2].textContent, /OpenAI/);
  dialog.close('cancelled'); await assert.rejects(second, /has not started/);
});
