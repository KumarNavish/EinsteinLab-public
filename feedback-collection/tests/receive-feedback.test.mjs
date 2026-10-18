import test from 'node:test';
import assert from 'node:assert/strict';
import {receiver} from '../functions/receive-feedback.mjs';

const secret = 'a'.repeat(64);
const sample = {request_id: 'f0743d71-9e23-48e6-b76e-1d356adcb0fc', rating: 3, realism: null, voice: null,
  kind: 'bug', message: 'ENGINEERING DELIVERY TEST — not a visitor review.', context: 'Authored test'};

function fixture() {
  const objects = new Map(); let writes = 0;
  const store = {
    async setJSON(key, value, options) {
      assert.equal(options.onlyIfNew, true); writes++;
      if (objects.has(key)) return {modified: false};
      objects.set(key, value); return {modified: true};
    },
    async get(key, options) { assert.equal(options.consistency, 'strong'); return objects.get(key); },
  };
  return {objects, writes: () => writes, receive: receiver({secret: () => secret, store: () => store})};
}
function request(body = sample, authorization = `Bearer ${secret}`, method = 'POST') {
  return new Request('https://fixture.invalid/.netlify/functions/receive-feedback', {
    method, headers: {'authorization': authorization, 'content-type': 'application/json'},
    ...(method === 'POST' ? {body: JSON.stringify(body)} : {}),
  });
}

test('unauthenticated callers cannot write or read feedback', async () => {
  const f = fixture();
  for (const auth of ['', 'Bearer bad', `Bearer ${'b'.repeat(64)}`]) assert.equal((await f.receive(request(sample, auth))).status, 403);
  assert.equal((await f.receive(request(sample, `Bearer ${secret}`, 'GET'))).status, 405);
  assert.equal(f.writes(), 0);
});

test('only explicit bounded fields reach immutable storage', async () => {
  const f = fixture();
  for (const change of [{rating: true}, {rating: 6}, {request_id: '../../secret'}, {transcript: 'never collect'}, {message: 'x'.repeat(2001)}]) {
    assert.equal((await f.receive(request({...sample, ...change}))).status, 400);
  }
  assert.equal((await f.receive(request({...sample, message: 'x'.repeat(6001)}))).status, 413);
  assert.equal(f.writes(), 0);
  const response = await f.receive(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {received: true, id: sample.request_id});
  assert.equal(f.objects.size, 1);
  assert.equal(f.objects.get(sample.request_id).message, sample.message);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.has('access-control-allow-origin'), false);
});

test('a retry preserves one object and a conflicting payload cannot overwrite it', async () => {
  const f = fixture();
  assert.equal((await f.receive(request())).status, 200);
  assert.equal((await f.receive(request())).status, 200);
  assert.equal((await f.receive(request({...sample, rating: 5}))).status, 409);
  assert.equal(f.objects.size, 1);
  assert.equal(f.objects.get(sample.request_id).rating, 3);
});

test('storage failures never claim receipt or expose provider errors', async () => {
  const receive = receiver({secret: () => secret, store: () => {throw Error('secret provider detail');}});
  const response = await receive(request());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {received: false});
});

test('UTF-8 split across stream chunks is decoded intact', async () => {
  const f = fixture(), text = JSON.stringify({...sample, message: 'A café diagram'}), bytes = new TextEncoder().encode(text);
  const split = bytes.indexOf(0xc3) + 1;
  const body = new ReadableStream({start(c) {c.enqueue(bytes.slice(0, split)); c.enqueue(bytes.slice(split)); c.close();}});
  const response = await f.receive(new Request('https://fixture.invalid/', {method: 'POST', duplex: 'half',
    headers: {'authorization': `Bearer ${secret}`, 'content-type': 'application/json'}, body}));
  assert.equal(response.status, 200);
  assert.equal(f.objects.get(sample.request_id).message, 'A café diagram');
});
