import test from 'node:test';
import assert from 'node:assert/strict';
import {convertPresentation, PRESENTATION_LIMITS} from '../src/presentation-upload.js';

const deck = () => new File([new Uint8Array(150)], 'Selected deck.pptx', {type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'});

test('only explicitly selected bounded PPTX files are uploaded', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; throw Error('not expected'); };
  for (const file of [new File(['x'], 'x.pptx'), new File([new Uint8Array(150)], 'x.pptm'), new File([new Uint8Array(PRESENTATION_LIMITS.bytes + 1)], 'big.pptx')]) {
    await assert.rejects(convertPresentation(file, {fetcher}), /PPTX of at most 8 MB/);
  }
  assert.equal(calls, 0);
});

test('converts through the same-origin session endpoint into a PDF File', async () => {
  const selected = deck();
  const file = await convertPresentation(selected, {fetcher: async (url, options) => {
    assert.equal(url, '/api/presentation/convert');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.body, selected);
    assert.equal(options.cache, 'no-store');
    return new Response('%PDF-synthetic-only', {headers: {'content-type': 'application/pdf'}});
  }});
  assert.equal(file.name, 'Selected deck · converted slides.pdf');
  assert.equal(file.type, 'application/pdf');
});

test('runtime absence is reported without using response diagnostics', async () => {
  await assert.rejects(convertPresentation(deck(), {fetcher: async () => new Response('secret/private/converter/path', {status: 503})}), /conversion is unavailable/);
});

test('rejects a non-PDF response and oversized PDF header', async () => {
  await assert.rejects(convertPresentation(deck(), {fetcher: async () => new Response('html', {headers: {'content-type': 'text/html'}})}), /did not return a PDF/);
  await assert.rejects(convertPresentation(deck(), {fetcher: async () => new Response('pdf', {headers: {'content-type': 'application/pdf', 'content-length': String(PRESENTATION_LIMITS.pdfBytes + 1)}})}), /exceeds 20 MB/);
});

test('bounds PDF bytes even if the response omits content length', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(PRESENTATION_LIMITS.pdfBytes + 1)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(convertPresentation(deck(), {fetcher: async () => new Response(stream, {headers: {'content-type': 'application/pdf'}})}), /exceeds 20 MB/);
  assert.equal(cancelled, true);
});
