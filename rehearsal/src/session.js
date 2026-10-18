/** Stale-response and playback ownership, independent of rendering and transport. */
export class TurnGate {
  constructor() { this.version = 0; this.abort = null; }
  next() { this.abort?.abort(); this.abort = new AbortController(); return {version: ++this.version, signal: this.abort.signal}; }
  current(version) { return version === this.version; }
  cancel() { this.version++; this.abort?.abort(); this.abort = null; }
}
export function bytesFromBase64(text) {
  const binary = atob(text); const bytes = new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
  return bytes;
}
export async function base64FromBlob(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = '';
  for(let i=0;i<bytes.length;i+=8192) binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(binary);
}
