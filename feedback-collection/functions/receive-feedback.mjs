import {createHash, timingSafeEqual} from 'node:crypto';
import {getStore} from '@netlify/blobs';

const headers = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'};
const reply = (status, value) => Response.json(value, {status, headers});
const fields = ['request_id', 'rating', 'realism', 'voice', 'kind', 'message', 'context'];

// Immutable JSON objects, one per explicit submission. No counters, accounts,
// public read endpoint, transcripts, microphone data or visitor identifiers.
export function submission(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !fields.includes(k))) throw Error();
  if (typeof body.request_id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(body.request_id)) throw Error();
  for (const field of ['rating', 'realism', 'voice']) {
    if (field !== 'rating' && body[field] == null) continue;
    if (!Number.isInteger(body[field]) || body[field] < 1 || body[field] > 5) throw Error();
  }
  if (!['impression', 'bug', 'suggestion'].includes(body.kind)) throw Error();
  for (const [field, limit] of [['message', 2000], ['context', 1000]]) {
    if (typeof body[field] !== 'string' || Array.from(body[field]).length > limit) throw Error();
  }
  return Object.fromEntries(fields.map(k => [k, body[k] ?? null]));
}

export function authorized(value, secret) {
  if (typeof secret !== 'string' || !/^[a-f0-9]{64}$/.test(secret) || typeof value !== 'string') return false;
  const supplied = Buffer.from(value), expected = Buffer.from(`Bearer ${secret}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function receiver({secret, store, now = () => new Date().toISOString()}) {
  return async request => {
    if (request.method !== 'POST') return reply(405, {received: false});
    if (!authorized(request.headers.get('authorization'), secret())) return reply(403, {received: false});
    let size = 0, value;
    const chunks = [];
    try {
      if (request.headers.get('content-type') !== 'application/json') return reply(415, {received: false});
      for await (const chunk of request.body ?? []) {
        size += chunk.byteLength;
        if (size > 6000) return reply(413, {received: false});
        chunks.push(Buffer.from(chunk));
      }
      value = submission(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } catch { return reply(400, {received: false}); }
    try {
      const digest = createHash('sha256').update(JSON.stringify(value)).digest('hex');
      const collection = store();
      const {modified} = await collection.setJSON(value.request_id, {...value, created_at: now(), digest}, {onlyIfNew: true});
      if (!modified) {
        const existing = await collection.get(value.request_id, {type: 'json', consistency: 'strong'});
        if (existing?.digest !== digest) return reply(409, {received: false});
      }
      return reply(200, {received: true, id: value.request_id});
    } catch {
      // Provider errors, secret values and submitted text never enter logs.
      return reply(503, {received: false});
    }
  };
}

export default receiver({
  secret: () => Netlify.env.get('EINSTEIN_FEEDBACK_RELAY_SECRET'),
  store: () => getStore({name: 'einstein-feedback', consistency: 'strong'}),
});

export const config = {
  rateLimit: {action: 'rate_limit', aggregateBy: 'domain', windowSize: 60, windowLimit: 1},
};
