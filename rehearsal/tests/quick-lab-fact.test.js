import test from 'node:test';
import assert from 'node:assert/strict';
import {quickLabFact, contextualLabQuestion} from '../src/quick-lab-fact.js';

const fact = {status: 'source-fact', answer: 'A stated public fact.', sources: [{
  url: 'https://mobililab.ethz.ch/', fetched_at: '2000-01-01T00:00:00Z'}]};
test('a later model follow-up retains the public question subject within the existing input limit', () => {
  const previous = 'What are the expected outcomes of Delegating to Agentic AI?';
  const actual = contextualLabQuestion('Why might that matter?', previous);
  assert.ok(actual.startsWith('Why might that matter?'));
  assert.ok(actual.includes(previous));
  assert.ok(contextualLabQuestion('q'.repeat(700), 'p'.repeat(700)).length <= 1000);
  assert.equal(contextualLabQuestion('Original question', null), 'Original question');
});
test('a complete dated fact uses one public read and preserves its attribution', async () => {
  const calls = [];
  const actual = await quickLabFact('What does the lab do?', {fetcher: async (...args) => {
    calls.push(args); return {ok: true, json: async () => fact};
  }});
  assert.deepEqual(actual, fact); assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/api/lab/answer');
  assert.deepEqual(JSON.parse(calls[0][1].body), {question: 'What does the lab do?'});
});
test('synthesis and incomplete provenance remain with the normal answer route', async () => {
  for (const value of [{status: 'model-required'}, {...fact, sources: []}, {...fact, sources: [{}]}]) {
    assert.equal(await quickLabFact('question', {fetcher: async () => ({ok: true, json: async () => value})}), null);
  }
});
test('transport failure does not swallow a valid ordinary question', async () => {
  assert.equal(await quickLabFact('question', {fetcher: async () => { throw Error('offline'); }}), null);
});
test('the deadline covers an indefinitely pending JSON body and aborts its fetch', async () => {
  let signal;
  const answer = await quickLabFact('question', {timeoutMs: 5, fetcher: async (_path, options) => {
    signal = options.signal; return {ok: true, json: () => new Promise(() => {})};
  }});
  assert.equal(answer, null); assert.equal(signal.aborted, true);
});
test('an origin denial propagates instead of trying an alternate answer route', async () => {
  await assert.rejects(quickLabFact('question', {fetcher: async () => ({ok: false, status: 403})}), /this site/);
});
