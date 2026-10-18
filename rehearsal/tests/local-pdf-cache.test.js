import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Exercise the real snapshot method. The fake canvas counts raster/encoding
// work; actual browser pixel identity is checked separately.
const source = await readFile(new URL('../src/local-pdf.js', import.meta.url), 'utf8');
const {LocalPDF} = await import('data:text/javascript;base64,' + Buffer.from(
  'const GlobalWorkerOptions={};const workerURL="";\n' + source.replace(/^import .*\n/gm, '')).toString('base64'));

function fixture(t) {
  const saved = globalThis.document, calls = {draw: 0, encode: 0};
  globalThis.document = {createElement() {return {width: 0, height: 0,
    getContext() {return {fillRect() {}, drawImage() {calls.draw++;}};},
    toDataURL() {return `data:image/jpeg;base64,exact-encoded-fixture-${++calls.encode}`;}};}};
  t.after(() => {if (saved === undefined) delete globalThis.document; else globalThis.document = saved;});
  const pdf = new LocalPDF();
  Object.assign(pdf, {serial: 4, document: {}, manifest: {id: 'a'.repeat(64), pages: 3, name: 'local.pdf'},
    canvas: {width: 1500, height: 1943}, pageNumber: 2, text: 'Original text',
    fragments: [{text: 'Original region text', x: .2, y: .3, width: .1, height: .1}]});
  return {pdf, calls};
}

test('repeat reads reuse exact JPEG bytes without drawing or encoding, and callers cannot mutate the cache', t => {
  const {pdf, calls} = fixture(t), region = [.1, .2, .5, .6];
  const first = pdf.snapshot(region), expected = structuredClone(first);
  first.document.id = 'changed'; first.region[0] = 0; first.image.data = 'changed'; first.text = 'changed';
  const again = pdf.snapshot(region);
  assert.deepEqual(again, expected); assert.deepEqual(calls, {draw: 1, encode: 1});
  assert.equal(pdf.canvas.width, 1500); assert.equal(pdf.canvas.height, 1943);
});

test('crop, page, document, render serial, canvas replacement or dimensions invalidate the single-view snapshot', t => {
  const {pdf, calls} = fixture(t);
  let region = [0, 0, 1, 1], previous = pdf.snapshot(region).image.data;
  for (const change of [() => {region = [.1, .2, .4, .5];}, () => {pdf.pageNumber = 3;},
    () => {pdf.manifest = {...pdf.manifest, id: 'b'.repeat(64)};}, () => {pdf.serial++;},
    () => {pdf.document = {};}, () => {pdf.canvas = {...pdf.canvas};}, () => {pdf.canvas.width--;}]) {
    change(); const current = pdf.snapshot(region).image.data;
    assert.notEqual(current, previous); previous = current;
  }
  assert.equal(calls.encode, 8); assert.equal(calls.draw, 8);
});

test('close drops selected source pixels, document metadata and cached bytes', async t => {
  const {pdf} = fixture(t); pdf.snapshot(); assert(pdf.snapshotCache);
  await pdf.close();
  assert.equal(pdf.snapshotCache, null); assert.equal(pdf.canvas, null); assert.equal(pdf.manifest, null);
  assert.throws(() => pdf.snapshot(), /Render a page/);
});
