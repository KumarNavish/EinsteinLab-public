import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {characterBytes, loadCharacter, CHARACTER_APP_ORIGIN} from '../src/character-transfer.js';

// Offline synthetic bytes and mocked fetch only. No CDN, browser or provider calls.
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(count = 1) {
  const parts = Array.from({length: count}, (_, i) => new Uint8Array(i < count - 1 ? 4194304 : 32).fill(i + 1));
  const bytes = Buffer.concat(parts), sha256 = hash(bytes);
  return {parts, bytes, manifest: {origin: 'https://einstein-mobiliar-lab.netlify.app', pathPrefix: `/character/${sha256}/`, bytes: bytes.length, sha256,
    chunks: parts.map((part, i) => ({name: `${String(i).padStart(3, '0')}-${hash(part)}.bin`, bytes: part.length, sha256: hash(part)}))}};
}
const response = bytes => new Response(bytes, {headers: {'content-length': String(bytes.length)}});

test('small verified transfer preserves every byte and reports real progress', async () => {
  const source = fixture(), progress = [];
  const bytes = await characterBytes(source.manifest, event => progress.push(event), async (url, options) => {
    assert.equal(url, source.manifest.origin + source.manifest.pathPrefix + source.manifest.chunks[0].name);
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    return response(source.parts[0]);
  });
  assert.deepEqual(Buffer.from(bytes), source.bytes);
  assert.deepEqual(progress.map(event => event.loaded), [0, source.bytes.length]);
  assert(progress.every(event => event.total === source.bytes.length));
});

test('transfer uses at most four in-flight requests and preserves manifest order', async () => {
  const source = fixture(5); let active = 0, maximum = 0;
  const bytes = await characterBytes(source.manifest, undefined, async url => {
    active++; maximum = Math.max(maximum, active);
    const index = Number(url.split('/').at(-1).slice(0, 3));
    await new Promise(resolve => setTimeout(resolve, (5 - index) * 2)); active--;
    return response(source.parts[index]);
  });
  assert.equal(maximum, 4); assert.deepEqual(Buffer.from(bytes), source.bytes);
});

test('encoded transport length does not replace decoded byte and hash checks', async () => {
  const source = fixture();
  const encodedResponse = bytes => new Response(bytes, {headers: {'content-length': '19'}});
  const bytes = await characterBytes(source.manifest, undefined, async () => encodedResponse(source.parts[0]));
  assert.deepEqual(Buffer.from(bytes), source.bytes);
  for (const wrong of [new Uint8Array(31), new Uint8Array(32), new Uint8Array(33)]) {
    await assert.rejects(characterBytes(source.manifest, undefined, async () => encodedResponse(wrong)));
  }
});

test('unsafe manifest targets and invalid chunk declarations fail before any request', async () => {
  const source = fixture(); let calls = 0;
  for (const change of [{origin: 'https://other.example.org'}, {origin: 'https://einstein-mobiliar-lab.netlify.app@evil.example.org'},
    {pathPrefix: '/character/../private/'}, {bytes: 55079785}, {chunks: []},
    {chunks: [{...source.manifest.chunks[0], name: '../escape.bin'}]}, {chunks: [{...source.manifest.chunks[0], bytes: 31}]}]) {
    await assert.rejects(characterBytes({...source.manifest, ...change}, undefined, async () => { calls++; }));
  }
  assert.equal(calls, 0);
});

test('wrong, short, oversized, redirected or failed bytes cannot become a verified character', async () => {
  const source = fixture();
  for (const make of [() => response(new Uint8Array(32)), () => response(new Uint8Array(31)),
    () => new Response(new Uint8Array(33)), () => new Response(null, {status: 302}),
    () => { const value = response(source.parts[0]); Object.defineProperty(value, 'url', {value: 'https://other.example.org/file'}); return value; },
    () => { throw Error('offline synthetic network fault'); }]) {
    await assert.rejects(characterBytes(source.manifest, undefined, async () => make()));
  }
  const wrongFullHash = {...source.manifest, sha256: 'a'.repeat(64), pathPrefix: `/character/${'a'.repeat(64)}/`};
  await assert.rejects(characterBytes(wrongFullHash, undefined, async () => response(source.parts[0])));
});

test('only exact public app uses verified transfer; local and other origins retain original loader', async () => {
  const calls = [], loader = {loadAsync: async (...args) => { calls.push(args); return 'original'; }, parseAsync: () => { throw Error('unverified parse'); }};
  const progress = () => {};
  for (const origin of ['http://127.0.0.1:8765', 'https://preview.example.org', CHARACTER_APP_ORIGIN + '.evil.example.org']) {
    assert.equal(await loadCharacter(loader, progress, {origin, fetcher: () => { throw Error('unexpected fetch'); }}), 'original');
  }
  assert(calls.every(args => args[0] === '/assets/einstein.glb' && args[1] === progress));
  await assert.rejects(loadCharacter(loader, progress, {origin: CHARACTER_APP_ORIGIN, transfer: fixture().manifest, fetcher: () => { throw Error('unexpected fetch'); }}), /original asset/);
  let parsed = false;
  await assert.rejects(loadCharacter({parseAsync: () => { parsed = true; }}, progress, {origin: CHARACTER_APP_ORIGIN, fetcher: async () => response(new Uint8Array(1))}));
  assert.equal(parsed, false); assert.equal(calls.length, 3);
});
