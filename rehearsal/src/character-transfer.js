import manifest from './character-transfer.json' with {type: 'json'};

export const CHARACTER_APP_ORIGIN = 'https://einstein-mobiliar-lab.fastapicloud.dev';
const CDN_ORIGIN = 'https://einstein-mobiliar-lab.netlify.app';
const CHARACTER_SHA256 = '0fdd4280d69169c93e69f3586b8956077223d1178523acc028b46c1b31ba89fc';
const CHARACTER_BYTES = 55079784, CHUNK_BYTES = 4 * 1024 * 1024;
const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');

// The transfer helper also accepts small synthetic manifests for offline tests.
// The production entry point below separately pins the exact original character.
export async function characterBytes(value, onProgress = () => {}, fetcher = globalThis.fetch) {
  if (value?.origin !== CDN_ORIGIN || !/^[a-f0-9]{64}$/.test(value.sha256 || '') ||
      value.pathPrefix !== `/character/${value.sha256}/` || !Number.isSafeInteger(value.bytes) ||
      value.bytes < 1 || value.bytes > CHARACTER_BYTES || !Array.isArray(value.chunks) ||
      value.chunks.length !== Math.ceil(value.bytes / CHUNK_BYTES)) throw Error('Invalid character transfer manifest.');
  for (const [index, chunk] of value.chunks.entries()) {
    if (!/^[a-f0-9]{64}$/.test(chunk.sha256 || '') || chunk.name !== `${String(index).padStart(3, '0')}-${chunk.sha256}.bin` ||
        chunk.bytes !== Math.min(CHUNK_BYTES, value.bytes - index * CHUNK_BYTES)) throw Error('Invalid character transfer chunk.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);
  const bytes = new Uint8Array(value.bytes);
  let next = 0, loaded = 0;
  try {
    onProgress({loaded: 0, total: value.bytes});
    await Promise.all(Array.from({length: Math.min(4, value.chunks.length)}, async () => {
      while (next < value.chunks.length && !controller.signal.aborted) {
        const index = next++, chunk = value.chunks[index];
        const url = value.origin + value.pathPrefix + chunk.name;
        const response = await fetcher(url, {credentials: 'omit', redirect: 'error', signal: controller.signal});
        if (response.status !== 200 || (response.url && response.url !== url) || !response.body) throw Error('Character chunk request failed.');
        // Content-Length may describe gzip transfer bytes. Validate decoded bytes below.
        const reader = response.body.getReader();
        let received = 0;
        for (;;) {
          const {done, value: part} = await reader.read(); if (done) break;
          if (received + part.byteLength > chunk.bytes) { await reader.cancel(); throw Error('Character chunk exceeded its declared size.'); }
          bytes.set(part, index * CHUNK_BYTES + received); received += part.byteLength;
          loaded += part.byteLength; onProgress({loaded, total: value.bytes});
        }
        if (received !== chunk.bytes || await digest(bytes.subarray(index * CHUNK_BYTES, index * CHUNK_BYTES + received)) !== chunk.sha256) throw Error('Character chunk integrity check failed.');
      }
    }));
    if (loaded !== value.bytes || await digest(bytes) !== value.sha256) throw Error('Character integrity check failed.');
    return bytes.buffer;
  } catch (error) {
    controller.abort();
    throw Error(error?.name === 'AbortError' ? 'Character transfer timed out or was cancelled.' : 'The original character transfer failed its download or integrity check.');
  } finally { clearTimeout(timeout); }
}

export async function loadCharacter(loader, onProgress, {origin = globalThis.location?.origin, transfer = manifest, fetcher = globalThis.fetch} = {}) {
  if (origin !== CHARACTER_APP_ORIGIN) return loader.loadAsync('/assets/einstein.glb', onProgress);
  if (transfer?.bytes !== CHARACTER_BYTES || transfer.sha256 !== CHARACTER_SHA256) throw Error('The character manifest does not match the original asset.');
  const bytes = await characterBytes(transfer, onProgress, fetcher);
  return loader.parseAsync(bytes, '/assets/');
}
