import test from 'node:test';
import assert from 'node:assert/strict';
import {safeEvidenceURL, searchSuggestionsDocument} from '../src/web-evidence.js';
test('official and external HTTPS evidence links remain actionable', () => {
  assert.equal(safeEvidenceURL('https://ethz.ch/research'), 'https://ethz.ch/research');
  assert.equal(safeEvidenceURL('https://www.nature.com/articles/example'), 'https://www.nature.com/articles/example');
});
test('unsafe links are not made clickable', () => {
  for (const value of ['javascript:alert(1)', 'file:///etc/passwd', 'https://127.0.0.1/', 'https://user:pass@example.com', 'not a URL']) assert.equal(safeEvidenceURL(value), null);
});
test('Google suggestions receive a script-denying CSP', () => {
  const html=searchSuggestionsDocument('<span>Google Search</span><script>parent.secret()</script>');
  assert(html.includes("default-src 'none'"));
  assert(html.includes("form-action 'none'"));
  assert(html.includes('Google Search'));
});


import {sourceProvenanceLabel} from '../src/web-evidence.js';
test('external provider evidence is never mislabelled as an official lab snapshot', () => {
  assert.match(sourceProvenanceLabel({source_kind:'openai-public-search'}), /OpenAI web search.*not a verbatim/);
  assert.match(sourceProvenanceLabel({source_kind:'openai-public-page'}), /OpenAI opened webpage.*cited summary/);
  assert.match(sourceProvenanceLabel({source_kind:'exa-public-search'}), /Exa public search highlights/);
  assert.match(sourceProvenanceLabel({source_kind:'exa-public-page'}), /Exa extracted public page/);
  assert.doesNotMatch(sourceProvenanceLabel({source_kind:'exa-public-page'}), /lab snapshot/);
});
