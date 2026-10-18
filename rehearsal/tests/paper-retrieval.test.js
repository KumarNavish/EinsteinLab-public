import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {retrievePaper} from '../src/paper-retrieval.js';

const pdf = '%PDF-1.7\ncontrolled offline fixture\n%%EOF\n';
const url = 'https://fixture.example/paper.pdf';

test('explicit retrieval posts only a URL and preserves exact returned PDF bytes', async () => {
  const result = await retrievePaper(url, {fetcher: async (target, request) => {
    assert.equal(target, '/api/paper/retrieve');
    assert.equal(request.method, 'POST'); assert.equal(request.credentials, 'same-origin');
    assert.deepEqual(JSON.parse(request.body), {url});
    return new Response(pdf, {headers: {'content-type': 'application/pdf', 'x-paper-source-url': 'https://fixture.example/final.pdf'}});
  }});
  assert.equal(await result.file.text(), pdf);
  assert.equal(result.source, 'https://fixture.example/final.pdf');
  assert.equal(result.fingerprint, createHash('sha256').update(pdf).digest('hex'));
});

test('unsafe URL shapes cannot initiate a request', async () => {
  for (const input of ['http://fixture.example/p.pdf', 'file:///private/key', 'https://user:pass@fixture.example/p.pdf', 'https://fixture.example:444/p.pdf', 'invalid']) {
    await assert.rejects(retrievePaper(input, {fetcher: () => assert.fail('Unexpected request')}));
  }
});

test('paywall and remote failure details stay unavailable', async () => {
  await assert.rejects(retrievePaper(url, {fetcher: async () => new Response('DO NOT EXPOSE upstream details', {status: 422})}), error => !error.message.includes('DO NOT EXPOSE') && error.message.includes('paywalls'));
  await assert.rejects(retrievePaper(url, {fetcher: async () => new Response('<html>paywall</html>', {headers: {'content-type': 'text/html'}})}));
  await assert.rejects(retrievePaper(url, {fetcher: async () => new Response('not a PDF', {headers: {'content-type': 'application/pdf'}})}));
});

test('body and advertised size are bounded even without Content-Length', async () => {
  await assert.rejects(retrievePaper(url, {fetcher: async () => new Response(pdf, {headers: {'content-type': 'application/pdf', 'content-length': String(20 * 1024 * 1024 + 1)}})}));
  let cancelled = false;
  const stream = new ReadableStream({pull(controller) { controller.enqueue(new Uint8Array(20 * 1024 * 1024 + 1)); }, cancel() { cancelled = true; }});
  await assert.rejects(retrievePaper(url, {fetcher: async () => new Response(stream, {headers: {'content-type': 'application/pdf'}})}));
  assert(cancelled);
});

test('caller cancellation is passed through and unsafe optional attribution is ignored', async () => {
  const controller = new AbortController();
  const result = await retrievePaper(url, {signal: controller.signal, fetcher: async (target, request) => {
    assert.equal(request.signal, controller.signal);
    return new Response(pdf, {headers: {'content-type': 'application/pdf', 'x-paper-source-url': 'javascript:alert(1)'}});
  }});
  assert.equal(result.source, url);
});
