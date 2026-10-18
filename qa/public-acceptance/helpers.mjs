import {createHash} from 'node:crypto';
import {isIP} from 'node:net';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const CHARACTER_APP_ORIGIN = 'https://einstein-mobiliar-lab.fastapicloud.dev';
const CHARACTER_CDN_ORIGIN = 'https://einstein-mobiliar-lab.netlify.app';

export function publicBrowserArgs(transport) {
  if (transport === undefined || transport === 'system') return [];
  if (transport === 'direct') return ['--no-proxy-server'];
  throw Error('Choose system or direct browser transport; arbitrary proxy or browser flags are refused.');
}

// Self-contained so Playwright serializes this exact GET into the visitor page.
export async function freshBrowserStatus() {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(Error('Browser status exceeded its 5000ms deadline.')); }, 5000);
  });
  const request = (async () => {
    let response;
    try {
      response = await fetch('/api/native/status', {method: 'GET', cache: 'no-store',
        credentials: 'same-origin', redirect: 'error', signal: controller.signal});
    } catch { throw Error('Browser status network request failed.'); }
    if (response.status !== 200) throw Error(`Browser status returned HTTP ${response.status}.`);
    let value;
    try { value = await response.json(); }
    catch { throw Error('Browser status returned invalid JSON.'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Browser status returned an invalid JSON object.');
    return value;
  })();
  try { return await Promise.race([request, deadline]); }
  finally { clearTimeout(timer); }
}

export async function readServerStatus(page) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error('Server status exceeded its 5000ms host deadline.')), 5000);
  });
  // Include delayed page execution and response serialization in the same wall bound.
  try { return await Promise.race([page.evaluate(freshBrowserStatus), deadline]); }
  finally { clearTimeout(timer); }
}

export function characterChunkPlan(manifest, pin) {
  if (manifest?.origin !== CHARACTER_CDN_ORIGIN || manifest.bytes !== pin?.bytes || manifest.sha256 !== pin?.sha256 ||
      manifest.bytes !== 55079784 || manifest.sha256 !== '0fdd4280d69169c93e69f3586b8956077223d1178523acc028b46c1b31ba89fc' ||
      manifest.pathPrefix !== `/character/${manifest.sha256}/` || !Array.isArray(manifest.chunks) || manifest.chunks.length !== 14) throw Error('Character CDN manifest does not match the independently pinned original asset.');
  const urls = new Map();
  manifest.chunks.forEach((chunk, index) => {
    if (!/^[a-f0-9]{64}$/.test(chunk?.sha256 || '') || chunk.name !== `${String(index).padStart(3, '0')}-${chunk.sha256}.bin` ||
        chunk.bytes !== Math.min(4194304, manifest.bytes - index * 4194304)) throw Error('Invalid pinned character CDN chunk.');
    urls.set(manifest.origin + manifest.pathPrefix + chunk.name, chunk);
  });
  return {...manifest, urls};
}

export function characterChunkReceipt(plan, parts) {
  const chunks = plan.chunks.map(chunk => {
    const bytes = parts.get(chunk.name);
    if (!bytes || bytes.length !== chunk.bytes || sha256(bytes) !== chunk.sha256) throw Error('An observed CDN chunk response is missing or does not match its size/hash.');
    return {name: chunk.name, bytes: bytes.length, sha256: sha256(bytes)};
  });
  const combined = Buffer.concat(plan.chunks.map(chunk => parts.get(chunk.name)));
  if (combined.length !== plan.bytes || sha256(combined) !== plan.sha256) throw Error('Observed CDN response bodies do not reassemble to the original character.');
  return {bytes: combined.length, sha256: sha256(combined), chunks, measurement: 'independently-reassembled-actual-CDN-response-bodies'};
}

export function allowedPublicRequest(request, appOrigin, chunkPlan) {
  if (request.origin === appOrigin) return true;
  return Boolean(chunkPlan?.urls.has(request.origin + request.path) && request.method === 'GET' &&
    request.hasQuery === false && request.credentialHeadersPresent === false);
}
export const PLAN = Object.freeze({
  state: 'PREPARED_NOT_RUN',
  passState: 'PUBLIC_OPENAI_PROTOCOL_PASSED',
  scope: 'External HTTPS visitor acceptance. Actual production app and provider; no bridge mocks, route interception, guard overrides or simulated success.',
  expectedProviders: {provider: 'OpenAI', voice: 'gpt-live-1', backend: 'gpt-6.1-sol', sourceVision: 'gpt-6.1-sol', evidence: 'gpt-6.1-sol'},
  playbackBoundary: 'Client-local playback_idle after actual queue drain or 450ms rendered silence plus speaker delay; GPT-Live provides no voice turn-complete or interruption event.',
  allocation: {providerSessions: 2, connectionAttempts: 3, transportRenewals: 4, expectedCapacityDeniedAttempts: 1,
    specialistCalls: 9, presentationConversions: 1, wholeRunSeconds: 900, sessionSeconds: 570},
  expectedSpecialistCalls: {paper: 2, videoFrames: 2, convertedSlides: 2, whiteboardImage: 1, evidenceSynthesis: 1},
  requiredCoverage: ['consent-decline', 'spoken-multiturn', 'source-box-and-ellipse', 'video', 'two-slide-deck',
    'conceptual-create-revise-focus-inspect-dismiss', 'official-lab-evidence', 'synthetic-mic-local-overlap',
    'isolation', 'capacity', 'responsive-security', 'cleanup'],
  feedback: 'No submission. Earlier keyless request 915ea6fc-937a-4d64-bf6a-fde9d574c431 passed authenticated owner readback.',
  gates: ['--run', 'EINSTEIN_PUBLIC_READY=1', 'EINSTEIN_PUBLIC_BUDGET_APPROVED=1',
    'EINSTEIN_PUBLIC_URL=https://exact-public-origin', 'EINSTEIN_PUBLIC_PDF=public-source.pdf',
    'EINSTEIN_PUBLIC_DEPLOYMENT_ID=owner-verified-uuid', 'EINSTEIN_PUBLIC_RELEASE_SHA=exact-deployed-commit',
    'EINSTEIN_PUBLIC_VOICE_ID=approved-custom-voice'],
  microphone: 'Explicitly approved synthetic authored WAV through Chrome fake capture device and actual getUserMedia/worklet/resampler/WebSocket/provider. No human mic, acoustic or naturalness verdict.',
  stop: 'First provider/quota/billing/vision/validation failure, exhausted allocation, or 15-minute deadline. No session retry or paid fallback.',
  coverage: ['consent decline', 'actual textured avatar', 'typed spoken multi-turn', 'two isolated visitors',
    'capacity rejection', 'source PDF figure and source-owned box plus ellipse', 'video play/pause/seek/rewind/speed, two actual frames and source-ID mark',
    'PPTX conversion, source-grounded two-slide explanation and actual 1→2→1 navigation', 'conceptual diagram creation, revision, focus, pixel inspection and dismissal',
    'official lab evidence-source question', 'synthetic microphone transcription and barge-in/topic change',
    'interrupt, source removal, settled server cleanup', 'mobile/desktop overflow and CSP',
    'actual served frontend and character byte hashes', 'no additional feedback submission'],
});

export const REMAINING_PLAN = Object.freeze({
  ...PLAN,
  passState: 'PUBLIC_REMAINING_SCENARIOS_PASSED',
  gates: PLAN.gates.filter(gate => !gate.startsWith('EINSTEIN_PUBLIC_PDF=')),
  scope: 'Focused remaining scenarios on one fresh actual visitor. Prior conversation, PDF, video, isolation, consent-decline and capacity evidence must be reviewed separately; this run cannot pass the full protocol.',
  allocation: {providerSessions: 1, connectionAttempts: 1, transportRenewals: 2, expectedCapacityDeniedAttempts: 0,
    specialistCalls: 5, presentationConversions: 1, wholeRunSeconds: 900, sessionSeconds: 570},
  expectedSpecialistCalls: {convertedSlides: 2, whiteboardImage: 1, evidenceSynthesis: 1},
  requiredCoverage: ['two-slide-deck', 'conceptual-create-revise-focus-inspect-dismiss',
    'official-lab-evidence', 'synthetic-mic-local-overlap', 'responsive-security', 'cleanup'],
  coverage: ['actual textured avatar and served source/asset hashes', 'two-slide PPTX walkthrough with source-owned annotations and 1→2→1 navigation',
    'conceptual creation, revision, focus, actual image inspection and dismissal', 'official lab evidence',
    'synthetic microphone and local overlap', 'mobile/security', 'graceful close, final provider usage and empty room'],
});

export const MICROPHONE_PLAN = Object.freeze({
  ...PLAN,
  passState: 'PUBLIC_MICROPHONE_SCENARIOS_PASSED',
  gates: [...PLAN.gates.filter(gate => !gate.startsWith('EINSTEIN_PUBLIC_PDF=')), '--microphone-only'],
  scope: 'Focused synthetic microphone acceptance on one fresh actual visitor. Prior source, media, lab, conversation, isolation and capacity evidence must be reviewed separately; this run cannot pass the full protocol.',
  allocation: {providerSessions: 1, connectionAttempts: 1, transportRenewals: 2, expectedCapacityDeniedAttempts: 0,
    specialistCalls: 0, presentationConversions: 0, wholeRunSeconds: 360, sessionSeconds: 180},
  expectedSpecialistCalls: {},
  requiredCoverage: ['synthetic-mic-local-overlap', 'responsive-security', 'cleanup'],
  stop: 'First provider/quota/billing/protocol failure, any specialist or conversion attempt, exhausted allocation, 180-second session or six-minute whole-run deadline. No session retry or paid fallback.',
  coverage: ['authored synthetic microphone transcription, actual local overlap suppression and post-input rendered response',
    'mobile/desktop overflow and CSP', 'actual Interrupt, final provider usage and empty room'],
});

export function publicOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw Error('Set EINSTEIN_PUBLIC_URL to the exact public HTTPS origin.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/' ||
      isIP(url.hostname) || /^(localhost|.*\.(?:localhost|local|internal|test|invalid|example))$/i.test(url.hostname) || !url.hostname.includes('.')) {
    throw Error('Public acceptance requires one public HTTPS origin without credentials, port, path or query.');
  }
  return url.origin;
}

export function redact(value) {
  return String(value).replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\b(?:cookie|set-cookie|authorization)\s*:[^\r\n]*/gi, '[private-header-redacted]')
    .replace(/einstein_visitor=[^;\s"'<>]+/gi, 'einstein_visitor=[redacted]')
    .replace(/AIza[\w-]{20,}|AQ\.[\w.-]{30,}/g, '[credential-redacted]')
    .replace(/sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g, '[credential-redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/(?:https?|wss?):\/\/[^\s"<>]+/g, raw => {
      try { const u = new URL(raw); return u.origin + u.pathname; } catch { return '[URL-redacted]'; }
    }).slice(0, 2500);
}

export function safeEvent(value) {
  const out = {};
  for (const key of ['event', 'type', 'generation', 'status', 'code', 'page', 'time', 'model', 'voice',
    'image_sha256', 'regions', 'action', 'reason', 'tool', 'source_count', 'diagnostic', 'vision_seconds',
    'revision', 'document_id', 'video_id', 'action_id', 'ok', 'mark_count', 'paused', 'rate',
    'provider', 'source', 'boundary', 'continuous_audio', 'backend_continues', 'overlap', 'rendered_elements', 'transport', 'scope', 'frame_hash', 'privacy']) {
    if (value[key] !== undefined) out[key] = value[key];
  }
  if (value.text !== undefined) {
    if (value.type === 'document_result') {
      out.textBytes = Buffer.byteLength(value.text); out.text_sha256 = sha256(value.text);
    } else out.text = redact(value.text);
  }
  if (value.message !== undefined) out.message = redact(value.message);
  if (value.answer !== undefined) out.answer = redact(value.answer);
  if (Array.isArray(value.claims)) out.claims = value.claims.slice(0, 5);
  if (value.image) out.image = {mime_type: value.image.mime_type, width: value.image.width,
    height: value.image.height, bytes: Buffer.from(value.image.data || '', 'base64').length,
    sha256: sha256(Buffer.from(value.image.data || '', 'base64'))};
  if (value.sources) out.sources = value.sources.slice(0, 8).map(source => ({id: source.id,
    title: source.title, url: source.url, page: source.page, document_id: source.document_id,
    source_kind: source.source_kind, source_scope: source.source_scope, fetched_at: source.fetched_at,
    text_sha256: source.text_sha256, excerptBytes: Buffer.byteLength(source.excerpt || ''),
    excerpt_sha256: sha256(source.excerpt || '')}));
  if (value.type === 'text') out.text = redact(value.text);
  if (value.document) out.document = value.document;
  if (value.video) out.video = value.video;
  return out;
}

// Observe one logical conversation across its actual WebSocket carriers. Keep
// renewal tickets out of receipts and count replayed audio/tool events only once.
export class ObservedNativeStream {
  lastSequence = 0;
  pending = new Map();
  pendingBytes = 0;
  renewable = false;
  duplicates = 0;
  controls = 0;
  connection = null;

  receive(value) {
    if (['transport_ready', 'transport_fenced'].includes(value.event)) {
      this.renewable = true; this.controls++;
      return [];
    }
    if (String(value.event || '').startsWith('transport_')) throw Error('Unknown native transport control.');
    if (value.event === 'connected') {
      const identity = {conversation_id: value.conversation_id, provider: value.provider, model: value.model};
      if (Object.values(identity).some(v => typeof v !== 'string' || !v.length || v.length > 128)) throw Error('Missing native conversation identity.');
      if (this.connection && Object.keys(identity).some(key => identity[key] !== this.connection[key])) throw Error('Transport renewal changed the provider conversation.');
      this.connection ??= identity;
    }
    if (!this.renewable && value.transport_seq === undefined) return [value];
    this.renewable = true;
    const sequence = value.transport_seq;
    if (!Number.isSafeInteger(sequence) || sequence < 1) throw Error('Invalid native transport sequence.');
    if (sequence <= this.lastSequence || this.pending.has(sequence)) { this.duplicates++; return []; }
    const bytes = Buffer.byteLength(JSON.stringify(value));
    if (this.pending.size >= 512 || this.pendingBytes + bytes > 1024 * 1024) throw Error('Native transport observation buffer exceeded.');
    this.pending.set(sequence, {value, bytes}); this.pendingBytes += bytes;
    const ordered = [];
    while (this.pending.has(this.lastSequence + 1)) {
      const next = this.pending.get(++this.lastSequence);
      this.pending.delete(this.lastSequence); this.pendingBytes -= next.bytes;
      ordered.push(next.value);
    }
    return ordered;
  }
}

export function playbackBoundaryObserved(before, after) {
  const boundary = after.lastPlaybackBoundaryReason === 'playback-drained' ? after.playerEntries === 0 :
    after.lastPlaybackBoundaryReason === 'rendered-silence' && after.renderedQuietMs >= 450;
  return after.active === true && after.continuousAudio === true &&
    after.playbackBoundaries > before.playbackBoundaries && after.outputBytes > before.outputBytes &&
    after.renderedSignalSamples > before.renderedSignalSamples &&
    after.lastPlaybackBoundaryEpochMs > before.lastPlaybackBoundaryEpochMs &&
    !after.audioPlaying && !after.speaking && !after.suppressAudio && boundary &&
    after.lastTurn?.boundary === 'client-local-playback-idle' && Boolean(after.lastTurn?.answer?.trim());
}

export function playbackAfterReceipts(state, events) {
  const receipts = events.filter(e => (e.direction === 'sent' && ['document_result', 'video_result', 'presentation_result'].includes(e.type)) ||
    ['document_inspected', 'video_inspected', 'visual_inspected', 'research_complete', 'output_transcript'].includes(e.event));
  // Node observes a socket receipt just after the page; allow 100ms scheduling skew.
  return receipts.every(e => Number.isFinite(Date.parse(e.at)) && state.lastPlaybackBoundaryEpochMs >= Date.parse(e.at) - 100);
}

export function syntheticMicrophoneResponseObserved(before, after, events) {
  // Local input_start and input_end each discard the player epoch. Require
  // rendered signal in the resumed epoch, rather than earlier overlap speech.
  return playbackBoundaryObserved(before, after) && playbackAfterReceipts(after, events) &&
    after.playerVersion === before.playerVersion + 2 &&
    after.nativeUtterances === before.nativeUtterances + 1 && after.renderedEpochSignalSamples > 0 &&
    /bubble|round/i.test(inputTranscript(events)) && /bubble|round|tension/i.test(spokenAnswer(events)) &&
    /bubble|round|tension/i.test(after.lastTurn?.answer || '');
}

export function sourceOwnedMarks(diagnostic, kinds) {
  return diagnostic?.tool === 'mark_selected_pdf' && Array.isArray(diagnostic.marks) &&
    diagnostic.marks.length >= kinds.length && diagnostic.marks.every(mark => mark.region_id_known && mark.region_id_matches_page) &&
    kinds.every(kind => diagnostic.marks.some(mark => mark.kind === kind));
}

export function missingCoverage(coverage, required = PLAN.requiredCoverage) {
  return required.filter(key => coverage[key] !== true);
}

export function spokenAnswer(events) {
  return events.filter(event => event.direction === 'received' && event.event === 'output_transcript')
    .map(event => event.text || '').join('');
}

// Legacy spokenAnswer/observedSpokenAnswer names contain received text, not a
// listening verdict. Untagged continuous PCM cannot identify audible word onset.
export const ANSWER_MEASUREMENT_VERSION = 'prompt-specific-received-v1';

export function protocolAnswerMatches(label, events, visual) {
  const text = spokenAnswer(events).replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
  const sentences = text.split(/[.!?](?:\s+|(?=[A-Z]))/).map(sentence => sentence.replace(/[.!?]+$/, '').trim()).filter(sentence => sentence &&
    !/\b(?:i'll|i will|let me|i can|i'm waiting|going to)\b/i.test(sentence));
  const any = test => sentences.some(sentence => test(sentence.toLowerCase()));
  switch (label) {
    case 'remaining-scenarios session start':
    case 'microphone-scenarios session start': return /\b(?:hello|hi|welcome|greetings)\b/i.test(text);
    case 'first typed native answer': return any(s => /\b(?:bubble|sphere)\b/.test(s) && /\b(?:round|spherical|sphere)\b/.test(s) && /surface tension/.test(s) && /minimiz|smallest (?:surface|area)/.test(s));
    case 'spoken multi-turn followup': return any(s => /surface tension/.test(s) && /inward|pulls? in/.test(s) && /\b(?:air|pressure)\b/.test(s) && /outward|push(?:es|ing)? out/.test(s));
    case 'independent visitor context': return any(s => /\b(?:no|not|don't|cannot|can't)\b/.test(s) && /know|idea|access|see|information/.test(s));
    case 'actual original figure inspection': return any(s => /tracemonkey/i.test(s) && /sieve|state machine|trac(?:e|ing)/.test(s));
    case 'original source-ID box and ellipse': return any(s => /\bbox\b/.test(s) && /\bellipse\b/.test(s) && /record/.test(s) && /compil/.test(s) && /trace/.test(s));
    case 'actual synthetic video frame zero': return originalSyntheticVideoNarrated(events);
    case 'video actual play pause and speed': return any(s => /\bpaused\b/.test(s) && /half speed|0\.5|\.5 speed/.test(s) && !/\bnot paused\b/.test(s));
    case 'second original video frame': return any(s => /\bpaused\b/.test(s) && /\b(?:there|at|2|two)\b/.test(s) && !/\bnot paused\b/.test(s));
    case 'video source-ID annotation': return any(s => /\bred square\b/.test(s) && /(?:farther|further|more)(?: to the)? right|moved? (?:to the )?right/.test(s) && /\b(?:before|first|initial|earlier|start)\b/.test(s) && !/\b(?:not|never|hasn't|isn't|doesn't)\b/.test(s));
    case 'actual rewind and stale-mark cleanup': return any(s => /^(?:one|1(?:\.0+)?) (?:second|seconds|sec|s)$/.test(s.trim()) ||
      /\b(?:at|time|position)\b.{0,25}\b(?:one|1(?:\.0+)?)\s*(?:seconds?|sec|s)\b/.test(s) && !/\b(?:not|never)\b/.test(s));
    case 'actual converted slide one inspection': return any(s => /input/.test(s) && /outcome/.test(s) && /chart|synthetic/.test(s));
    case 'converted first slide source explanation': return convertedSlideAnswerMatches(text, 1);
    case 'actual next-slide explanation': return convertedSlideAnswerMatches(text, 2);
    case 'second-slide source-ID mark': return any(s => /\bpage\s*(?:2|two)\b/.test(s) && /\bdose\b/.test(s) && /marked|outlined|boxed/.test(s));
    case 'actual previous-slide source navigation': return any(s => /\bpage\s*(?:1|one)\b/.test(s) && /\binput\b/.test(s) && /marked|outlined|boxed/.test(s));
    case 'conceptual whiteboard creation': return any(s => /conceptual/.test(s) && /pressure/.test(s) && /surface tension/.test(s) && /bubble/.test(s));
    case 'conceptual revision and focus': return any(s => /surface tension/.test(s) && /soap film/.test(s) && /emphas|focus|link|connect/.test(s));
    case 'actual whiteboard pixel inspection': return namesVisibleGraphLabels(text, visual);
    case 'actual whiteboard dismissal': return any(s => /\b(?:hidden|dismissed|removed)\b|no longer visible/.test(s));
    case 'official lab source-bound synthesis': return labEvidenceNarrated(events);
    default: throw Error(`No prompt-specific received-answer contract for: ${label}`);
  }
}

export function promptAnswerEvidence(label, startedAt, events, visual) {
  const began = Date.parse(startedAt);
  if (!Number.isFinite(began)) throw Error('Prompt measurement requires a valid start timestamp.');
  protocolAnswerMatches(label, [], visual); // Unknown waiting prompts must fail closed.
  const scoped = events.filter(event => Number.isFinite(Date.parse(event.at)) && Date.parse(event.at) >= began);
  let firstText = null, firstAck = null, firstContent = null, firstAction = null;
  const prefix = [];
  for (const event of scoped) {
    prefix.push(event);
    if (event.direction === 'received' && event.event === 'output_transcript' && String(event.text || '').trim()) {
      firstText ??= event.at;
      if (/^\s*(?:hello\b|hi\b|acknowledged\b|okay\b|ok\b|sure\b|mm\b|one moment\b|i'll\b|i will\b|let me\b|i'm waiting\b|i see (?:it|that)\b)/i.test(spokenAnswer(prefix).replace(/[’‘]/g, "'"))) firstAck ??= event.at;
      if (protocolAnswerMatches(label, prefix, visual)) firstContent ??= event.at;
    }
    if (!firstAction && event.direction === 'sent') {
      for (const [channel, kinds] of [['document', ['read', 'mark']], ['video', ['inspect', 'seek', 'rewind', 'mark']], ['presentation', ['diagram', 'focus', 'hide']]]) {
        for (const kind of kinds) if (acknowledgedAction(prefix, channel, kind) === event) {
          firstAction = {at: event.at, channel, kind, actionId: event.action_id, revision: event.revision};
        }
      }
    }
  }
  const stamp = at => at ? {at, elapsedMs: Date.parse(at) - began} : null;
  return {version: ANSWER_MEASUREMENT_VERSION, promptSpecificContentMatched: firstContent !== null,
    receivedOutputText: spokenAnswer(scoped).trim(), firstReceivedTranscript: stamp(firstText),
    firstAcknowledgementReceived: stamp(firstAck), firstPromptSpecificContentReceived: stamp(firstContent),
    firstVisibleActionReceipt: firstAction ? {...firstAction, elapsedMs: Date.parse(firstAction.at) - began} : null,
    usefulAudibleWordOnsetMs: null, audioWordAttribution: 'UNVERIFIED_UNTAGGED_CONTINUOUS_PCM'};
}

export function inputTranscript(events) {
  return events.filter(event => event.direction === 'received' && event.event === 'input_transcript')
    .map(event => event.text || '').join('');
}

export function labEvidenceNarrated(events) {
  const index = events.findLastIndex(event => event.direction === 'received' && event.event === 'research_complete' && event.status === 'source-bound');
  if (index < 0) return false;
  const answer = spokenAnswer(events.slice(index + 1));
  // The owner also reviews this narration against the actual source claims.
  return answer.trim().length >= 120 && /document|report|observ|demonstrat|finding|result|measur|evidence|source|shown|study/i.test(answer) &&
    /expect|anticipat|hypothes|aim|goal|intend|plan|propos|not.{0,40}(?:demonstrat|establish|prov|measur)|\bun(?:establish|demonstrat|proven|measur)\w*/i.test(answer);
}

export function originalSyntheticVideoNarrated(events) {
  const inspection = events.findIndex(event => event.event === 'video_inspected');
  if (inspection < 0) return false;
  const before = spokenAnswer(events.slice(0, inspection));
  const after = spokenAnswer(events.slice(inspection + 1));
  return !/\b(?:cat|couch|dog|sofa)\b/i.test(spokenAnswer(events)) &&
    !/\b(?:red|blue|square|circle|triangle|rectangle)\b/i.test(before) &&
    /\bred\s+square\b/i.test(after) && /\bblue\s+circle\b/i.test(after);
}

export function convertedSlideAnswerMatches(answer, page) {
  const text = String(answer || '').toLowerCase().replace(/\btwo\b/g, '2').replace(/\bfive\b/g, '5')
    .replace(/\bthree\b/g, '3').replace(/\bseven\b/g, '7');
  const scoped = /synthetic|test|illustrative/.test(text);
  if (page === 1) return /\b2\b/.test(text) && /\b5\b/.test(text) && /input/.test(text) && /outcome/.test(text) && scoped && /convert|libreoffice/.test(text);
  if (page === 2) return /\b3\b/.test(text) && /\b7\b/.test(text) && /control/.test(text) && /treatment/.test(text) && /dose/.test(text) && /response/.test(text) && /a\.?\s*u\.?|arbitrary units/.test(text) && scoped;
  return false;
}

export function namesVisibleGraphLabels(answer, visual) {
  if (visual?.visible !== true || !Array.isArray(visual.graph?.nodes)) return false;
  const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const text = ' ' + normalize(answer) + ' ';
  const labels = new Set(visual.graph.nodes.map(node => normalize(node.label)).filter(Boolean));
  return [...labels].filter(label => text.includes(' ' + label + ' ')).length >= 2;
}

// Calibrated only on the authored 1500x844 slide: a cold/warm Chrome rerender
// changed 66 edge pixels by <=10/channel, with signed RGB spread <=1 and no
// alpha change. This is a bounded antialias allowance, not bitwise invariance.
export const RASTER_REPLAY_LIMITS = Object.freeze({width: 1500, height: 844,
  changedPixels: 66, maxChannelDelta: 10, maxSignedRgbSpread: 1});

// Kept self-contained so Playwright executes it with transient in-page handles;
// only scalar metrics and hashes cross back to Node, never source RGBA arrays.
export async function rasterReplayDelta({reference, current}) {
  const result = {width: reference.width, height: reference.height,
    sameDimensions: reference.width === current.width && reference.height === current.height,
    referenceBytes: reference.rgba.length, currentBytes: current.rgba.length,
    changedPixels: 0, maxChannelDelta: 0, maxSignedRgbSpread: 0, alphaChanges: 0};
  if (!result.sameDimensions || reference.rgba.length !== current.rgba.length ||
      reference.rgba.length !== reference.width * reference.height * 4) return {...result, valid: false};
  for (let i = 0; i < reference.rgba.length; i += 4) {
    const red = current.rgba[i] - reference.rgba[i], green = current.rgba[i + 1] - reference.rgba[i + 1],
      blue = current.rgba[i + 2] - reference.rgba[i + 2], alpha = current.rgba[i + 3] - reference.rgba[i + 3];
    if (red || green || blue || alpha) {
      result.changedPixels++;
      result.maxChannelDelta = Math.max(result.maxChannelDelta, Math.abs(red), Math.abs(green), Math.abs(blue));
      result.maxSignedRgbSpread = Math.max(result.maxSignedRgbSpread, Math.max(red, green, blue) - Math.min(red, green, blue));
      if (alpha) result.alphaChanges++;
    }
  }
  const digest = async data => [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', data))].map(value => value.toString(16).padStart(2, '0')).join('');
  return {...result, valid: true, referenceSha256: await digest(reference.rgba), currentSha256: await digest(current.rgba)};
}

export function rasterReplayPreserved(before, after, delta) {
  const first = before?.original, last = after?.original;
  const exactDisplay = value => value?.original && value?.displayed && /^[a-f0-9]{64}$/.test(value.original.sha256 || '') && value.original.sha256 === value.displayed.sha256 &&
    value.original.width === value.displayed.width && value.original.height === value.displayed.height;
  return Boolean(first && last && before.document?.id && before.document.id === after.document?.id &&
    before.document.page === after.document.page && before.document.pages === after.document.pages &&
    before.document.sourceKind === after.document.sourceKind &&
    first.width === last.width && first.height === last.height &&
    first.width === RASTER_REPLAY_LIMITS.width && first.height === RASTER_REPLAY_LIMITS.height &&
    exactDisplay(before) && exactDisplay(after) && delta?.valid === true && delta.sameDimensions === true &&
    delta.width === first.width && delta.height === first.height &&
    delta.referenceBytes === first.width * first.height * 4 && delta.currentBytes === delta.referenceBytes &&
    delta.referenceSha256 === first.sha256 && delta.currentSha256 === last.sha256 &&
    Number.isInteger(delta.changedPixels) && delta.changedPixels >= 0 && delta.changedPixels <= RASTER_REPLAY_LIMITS.changedPixels &&
    delta.maxChannelDelta <= RASTER_REPLAY_LIMITS.maxChannelDelta &&
    delta.maxSignedRgbSpread <= RASTER_REPLAY_LIMITS.maxSignedRgbSpread && delta.alphaChanges === 0);
}

export function acknowledgedAction(events, channel, kind) {
  if (!['document', 'video', 'presentation'].includes(channel)) return null;
  const request = events.findLast(event => event.direction === 'received' && event.event === channel + '_action' && event.action?.kind === kind);
  if (!request) return null;
  return events.findLast(event => event.direction === 'sent' && event.type === channel + '_result' &&
    event.action_id === request.action.action_id && event.revision === request.action.revision &&
    (channel === 'presentation' ? event.status === {diagram: 'displayed', focus: 'focused', inspect: 'inspected', hide: 'hidden'}[kind] : event.ok === true) &&
    (!request.action.document_id || event.document_id === request.action.document_id) &&
    (!request.action.video_id || event.video_id === request.action.video_id)) || null;
}
