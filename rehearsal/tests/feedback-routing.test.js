import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../src/feedback-ui.js', import.meta.url), 'utf8');

// Isolated DOM/transport fixtures. No original service, database or external POST.
function fixture(health, receipt = {received: true, id: 'fixture-submission'}) {
  class Element {
    constructor() { this.children = []; this.events = {}; this.dataset = {}; this.style = {}; }
    append(child) { this.children.push(child); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(name, callback) { this.events[name] = callback; }
    setAttribute() {}
    showModal() { this.open = true; }
    querySelector() { return privacy; }
    reset() { this.wasReset = true; }
  }
  const privacy = new Element();
  const elements = new Map(['feedback-dialog', 'feedback-form', 'feedback-result', 'feedback-send', 'feedback-toggle'].map(id => ['#' + id, new Element()]));
  const requests = [];
  const document = {querySelector: selector => elements.get(selector), createElement: () => new Element()};
  vm.runInNewContext(source, {document, crypto: {randomUUID: () => 'fixture-submission'},
    FormData: class {get(name) { return {rating: '4', kind: 'bug', message: 'Explicit offline engineering fixture.'}[name] || ''; }},
    fetch: async (url, options) => {
      requests.push({url, options});
      return {ok: true, json: async () => url === '/api/health' ? health : url.endsWith('/permit') ? {permit: 'fixture-permit'} : receipt};
    }});
  return {elements, requests, privacy,
    open: () => elements.get('#feedback-toggle').events.click(),
    submit: () => elements.get('#feedback-form').events.submit({preventDefault() {}})};
}

test('a mismatched receipt preserves the exact pending submission', async () => {
  const f = fixture({public_deployment: true, feedback_inline: true}, {received: true, id: 'wrong-id'});
  await f.open(); await f.submit(); await f.submit();
  assert.equal(f.elements.get('#feedback-form').wasReset, undefined);
  assert.equal(f.elements.get('#feedback-result').dataset.receipt, undefined);
  assert.deepEqual(f.requests[2].options.body, f.requests[3].options.body);
  assert.match(f.elements.get('#feedback-result').textContent, /not confirmed/);
});

test('public feedback offers the exact HTTPS destination without collection API calls', async () => {
  const f = fixture({public_deployment: true, feedback_url: 'https://einstein-mobiliar-lab.netlify.app/'});
  await f.open();
  assert.equal(f.elements.get('#feedback-form').hidden, true);
  const link = f.elements.get('#feedback-dialog').children[0].children[1];
  assert.equal(link.href, 'https://einstein-mobiliar-lab.netlify.app/');
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener noreferrer');
  assert.deepEqual(f.requests.map(item => item.url), ['/api/health']);
});

for (const url of [null, 'javascript:alert(1)', 'https://evil.example/', 'https://einstein-mobiliar-lab.netlify.app/?redirect=evil']) {
  test('public feedback rejects an unapproved destination: ' + url, async () => {
    const f = fixture({public_deployment: true, feedback_url: url});
    await f.open();
    const panel = f.elements.get('#feedback-dialog').children[0];
    assert.equal(panel.children.length, 1);
    assert.match(panel.children[0].textContent, /temporarily unavailable/);
    assert.deepEqual(f.requests.map(item => item.url), ['/api/health']);
  });
}

for (const health of [{public_deployment: false}, {public_deployment: true, feedback_inline: true}]) {
test('configured inline feedback keeps its permit, submission and matching receipt: ' + JSON.stringify(health), async () => {
  const f = fixture(health);
  await f.open();
  assert.equal(f.elements.get('#feedback-form').hidden, false);
  assert.equal(f.elements.get('#feedback-send').disabled, false);
  await f.submit();
  assert.deepEqual(f.requests.map(item => item.url), ['/api/health', '/api/feedback/permit', '/api/feedback']);
  assert.equal(JSON.parse(f.requests[2].options.body).permit, 'fixture-permit');
  assert.equal(f.elements.get('#feedback-result').dataset.receipt, 'fixture-submission');
  assert.equal(f.elements.get('#feedback-form').wasReset, true);
});
}
