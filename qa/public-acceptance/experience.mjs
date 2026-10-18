// Focused experience protocol. Importing this module and --plan are offline.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {publicOrigin, redact, safeEvent, ObservedNativeStream, sha256, spokenAnswer,
  playbackBoundaryObserved, playbackAfterReceipts, characterChunkPlan, characterChunkReceipt, allowedPublicRequest} from './helpers.mjs';

export const EXPERIENCE_PLAN = Object.freeze({
  state: 'PREPARED_NOT_RUN',
  contractVersion: 'source-v2',
  scope: 'One complete cumulative annotation walkthrough on the original TraceMonkey Figure 2 pixels, followed by a restart and cancellation by a new typed question, within one provider session.',
  allocation: {providerSessions: 1, connectionAttempts: 1, transportRenewals: 1,
    visionChecks: 3, presentationConversions: 0, feedbackSubmissions: 0,
    sessionSeconds: 240, wholeRunSeconds: 360},
  latencyLimitsMs: {shareToSourceAction: 4000, teachingRequestToFirstDiagram: 6000,
    renderAckToUsefulNarration: 2500, boundaryToNextDiagram: 1500, speechOnsetToInk: 300},
  sourceView: {viewport: {width: 1280, height: 720}, minimumWorkspaceWidthFraction: .6,
    requireExactOriginalCropPixels: true, humanTextLegibility: 'UNVERIFIED'},
  walkthrough: {requestedSteps: 3, requestedSentencesPerStep: 1, acceptedStageCount: [2, 6],
    requireEveryStageHeard: true, completionStatus: 'presented-progressively', restartWithoutNewVision: true,
    postCompletionMaximumWords: 8},
  fixture: {name: 'Original TraceMonkey research PDF', page: 2, pages: 14,
    sha256: '3662ff519e485810520552bf301d8c3b2b917fd2f83303f4965d7abed367e113'},
  gates: ['--run', 'EINSTEIN_PUBLIC_READY=1', 'EINSTEIN_PUBLIC_BUDGET_APPROVED=1',
    'EINSTEIN_PUBLIC_URL', 'EINSTEIN_PUBLIC_PDF', 'EINSTEIN_PUBLIC_DEPLOYMENT_ID', 'EINSTEIN_PUBLIC_RELEASE_SHA'],
  stop: 'First provider, source, renderer, protocol, latency or allocation failure. No retry, microphone input, extra session, public search, conversion, feedback or provider fallback.',
  acceptance: ['exact served frontend and character bytes', 'operator-pinned voice/German configured delivery metadata',
    'selected original page 2 only; no unrequested page-1 inspection',
    'own browser speech-drain readiness before initial teaching or marks; readiness cannot count as a heard stage',
    'inspected source-region identities and cumulative original-PDF marks; no replacement graph',
    'stable enlarged original crop, actual mark render acknowledgement before commentary, ink within 300ms of rendered-speech onset',
    'fresh useful post-render narration and rendered-quiet boundary before the next source mark',
    'every first-walkthrough stage heard and inked, with confirmed progressive completion',
    'no whole-plan replay after completion; restart reuses the current observation',
    'new typed question cancels the active sequence and receives a fresh answer',
    'actual browser output recording, staged first/final/restarted screenshots, confirmed final provider usage and room zero'],
  interpretation: 'A mechanics pass is not a human teaching-quality, age, accent, naturalness, acoustic or physical-microphone verdict. Original-crop identity and displayed width do not establish that a person can read its text. Actual transcripts, audio and figures require content review. First useful narration uses fresh transcript content after the render ACK, not the first silent PCM or a short acknowledgement. These predeclared latency limits are acceptance targets, not prior measured performance.',
});

const when = value => Date.parse(value.at);
const plain = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
// A natural inflection (record → records, compile → compiles) retains its
// focus. This narrow normalization is not paraphrase or truth verification.
const focusForm = word => word.length > 4 ? word.replace(/s$/, '') : word;
const useful = (text, focus) => plain(text).length >= 6 && plain(focus).filter(w => w.length > 2 && !['the', 'and', 'for', 'with', 'from'].includes(w)).some(word => plain(text).some(spoken => focusForm(spoken) === focusForm(word)));
const pageCount = /\b(?:14|fourteen)(?:\s+|-)\s*pages?\b/i;
export const firstFollowupSentence = text => (String(text).match(/[^.!?]+[.!?]/g) || [text])
  .find(sentence => pageCount.test(sentence) || plain(sentence).length >= 4) || '';

function usefulNarration(deltas, focus) {
  let text = ''; const spans = [];
  for (const delta of deltas) {
    spans.push({start: text.length, end: text.length + (delta.text || '').length, at: delta.at});
    text += delta.text || '';
    for (const match of text.matchAll(/[^.!?]+[.!?]?/g)) {
      if (!useful(match[0], focus)) continue;
      const offset = match.index + match[0].search(/\S/);
      return {at: spans.find(span => span.start <= offset && span.end > offset)?.at || null, confirmedAt: delta.at};
    }
  }
  return {at: null, confirmedAt: null};
}

/** Independently cross-check server proposals, actual browser ACKs and local
 * rendered-speech receipts. This deliberately makes no scientific truth claim.
 */
export function teachingProgress(events, sourceId, localSteps = []) {
  const stages = events.filter(e => e.direction === 'received' && e.event === 'teaching_step');
  const result = [];
  for (const [position, stage] of stages.entries()) {
    if (stage.index !== position || !Number.isInteger(stage.count) || stage.count < 2 || stage.count > 6 ||
      stage.sequence_id !== stages[0].sequence_id || stage.count !== stages[0].count) throw Error('Teaching stage identity, count or order changed.');
    const action = events.findLast(e => e.direction === 'received' && e.event === 'presentation_action' && e.action?.kind === 'diagram' && when(e) <= when(stage));
    const graph = action?.action.graph, ids = graph?.nodes?.map(n => n.id);
    if (!graph || ids.length !== position + 1 || new Set(ids).size !== ids.length ||
      !graph.sources?.some(s => s.id === sourceId) || graph.edges?.some(e => !ids.includes(e.from) || !ids.includes(e.to))) throw Error('Diagram jumped ahead or lost its inspected source/visible endpoints.');
    if (position && JSON.stringify(graph.nodes.slice(0, -1)) !== JSON.stringify(result.at(-1).nodes)) throw Error('A cumulative teaching prefix changed its earlier nodes.');
    const ack = events.find(e => e.direction === 'sent' && e.type === 'presentation_result' &&
      e.action_id === action.action.action_id && e.status === 'displayed' && e.revision === action.action.revision);
    if (!ack || when(ack) > when(stage) + 100 || ack.rendered_elements !== graph.nodes.length + graph.edges.length) throw Error('Teaching narration has no matching actual rendered-diagram ACK.');
    const focus = events.findLast(e => e.direction === 'received' && e.event === 'presentation_action' &&
      e.action?.kind === 'focus' && e.action.element_id === graph.nodes.at(-1).id && when(e) >= when(ack) && when(e) <= when(stage));
    const focusAck = focus && events.find(e => e.direction === 'sent' && e.type === 'presentation_result' &&
      e.action_id === focus.action.action_id && e.status === 'focused' && e.revision === focus.action.revision);
    if (!focusAck || when(focusAck) > when(stage) + 100 || focusAck.rendered_elements !== graph.nodes.length + graph.edges.length || stage.focus_label !== graph.nodes.at(-1).label) throw Error('The spoken teaching step lacks an actual new-node focus ACK.');
    const nextAction = events.find(e => e.direction === 'received' && e.event === 'presentation_action' && e.action?.kind === 'diagram' && when(e) > when(action));
    const boundaries = events.filter(e => e.direction === 'sent' && e.type === 'teaching_boundary' && e.sequence_id === stage.sequence_id && e.index === stage.index);
    if (boundaries.length > 1) throw Error('A teaching stage produced duplicate boundary receipts.');
    const boundary = boundaries[0];
    const end = nextAction ? when(nextAction) : Infinity;
    const narration = events.filter(e => e.direction === 'received' && e.event === 'output_transcript' && when(e) >= when(stage) && when(e) < end);
    const joined = spokenAnswer(narration), usefulSpeech = usefulNarration(narration, stage.focus_label), usefulAt = usefulSpeech.at;
    const local = localSteps.find(s => s.sequenceId === stage.sequence_id && s.index === stage.index);
    if (nextAction && (!boundary || boundary.heard !== true || boundary.manual || when(boundary) > when(nextAction) + 100)) throw Error('The next node arrived without a fresh heard boundary for its predecessor.');
    if (boundary && (boundary.heard !== true || boundary.manual || !usefulAt || when(boundary) + 100 < Date.parse(usefulAt) ||
      narration.some(delta => when(delta) > when(boundary) + 100) ||
      !local?.signalObserved || local.heard !== true || local.renderedSignalSamples <= local.baselineSignalSamples ||
      !Number.isFinite(local.boundaryAt) || local.playerVersion == null)) throw Error('A teaching boundary lacks fresh useful transcript and actual rendered-signal evidence.');
    result.push({sequenceId: stage.sequence_id, index: stage.index, count: stage.count, focusLabel: stage.focus_label,
      narrationRequested: stage.narration, nodes: graph.nodes, sources: graph.sources,
      actionAt: action.at, diagramRenderAckAt: ack.at, renderAckAt: focusAck.at, teachingStepAt: stage.at,
      usefulNarrationAt: usefulAt, usefulNarrationConfirmedAt: usefulSpeech.confirmedAt,
      actualPostRenderNarration: joined.trim(),
      boundaryAt: boundary?.at || null, heard: boundary?.heard === true, localEvidence: local || null,
      renderAckToUsefulNarrationMs: usefulAt ? Date.parse(usefulAt) - when(focusAck) : null,
      previousBoundaryToActionMs: position && result.at(-1).boundaryAt ? when(action) - Date.parse(result.at(-1).boundaryAt) : null});
  }
  return result;
}

export function teachingSequenceEvents(events, sequenceId) {
  const start = events.findIndex(e => e.direction === 'received' && e.event === 'teaching_started' && e.sequence_id === sequenceId);
  if (start < 0) throw Error('No actual teaching-start receipt for this sequence.');
  const finish = events.findIndex((e, index) => index > start && e.direction === 'received' && e.event === 'teaching_finished' && e.sequence_id === sequenceId);
  const next = events.findIndex((e, index) => index > start && e.direction === 'received' && e.event === 'teaching_started');
  const end = finish >= 0 && (next < 0 || finish < next) ? finish + 1 : next >= 0 ? next : events.length;
  return events.slice(start, end);
}

export function completedTeaching(events, sequenceId, sourceId, localSteps) {
  const own = teachingSequenceEvents(events, sequenceId), started = own[0];
  const finished = own.find(e => e.direction === 'received' && e.event === 'teaching_finished' && e.sequence_id === sequenceId);
  const progression = teachingProgress(own, sourceId, localSteps), count = started.count;
  if (!finished || finished.status !== EXPERIENCE_PLAN.walkthrough.completionStatus ||
    progression.length !== count || progression.some(stage => stage.count !== count || !stage.heard) ||
    finished.rendered_steps !== count || finished.local_speech_boundaries_confirmed !== count || finished.manual_advances !== 0 ||
    when(finished) + 100 < Date.parse(progression.at(-1)?.boundaryAt)) throw Error('Full walkthrough completion lacks every matching rendered and heard stage.');
  return {sequenceId, count, startedAt: started.at, finishedAt: finished.at, progression, completion: finished};
}

const normalizedRegion = value => Array.isArray(value) && value.length === 4 && value.every(Number.isFinite) &&
  value[0] >= 0 && value[1] >= 0 && value[2] > 0 && value[3] > 0 && value[0] + value[2] <= 1.000001 && value[1] + value[3] <= 1.000001;
const sameRegion = (a, b) => normalizedRegion(a) && normalizedRegion(b) && a.every((n, index) => Math.abs(n - b[index]) <= .000001);
const containsRegion = (outer, inner) => normalizedRegion(outer) && normalizedRegion(inner) &&
  inner[0] >= outer[0] - .000001 && inner[1] >= outer[1] - .000001 &&
  inner[0] + inner[2] <= outer[0] + outer[2] + .000001 && inner[1] + inner[3] <= outer[1] + outer[3] + .000001;

/** Initial speech drain is readiness only; it cannot certify a heard stage. */
export function preparedTeaching(events, sequenceId) {
  const starts = events.filter(e => e.direction === 'received' && e.event === 'teaching_started' && e.sequence_id === sequenceId);
  if (starts.length !== 1) return null;
  const started = starts[0], before = events.slice(0, events.indexOf(started));
  const preps = before.filter(e => e.direction === 'received' && e.event === 'teaching_prepare' && e.sequence_id === sequenceId);
  const receipts = before.filter(e => e.direction === 'sent' && e.type === 'teaching_ready' && e.sequence_id === sequenceId);
  const prep = preps[0], ready = receipts[0];
  if (preps.length !== 1 || receipts.length !== 1 || ready.ready !== true || ready.audio_playing !== false ||
    !Number.isFinite(ready.rendered_quiet_ms) || ready.rendered_quiet_ms < 900 || ready.rendered_quiet_ms > 600000 ||
    events.indexOf(prep) >= events.indexOf(ready) || ![prep, ready, started].every(e => Number.isFinite(when(e))) ||
    when(ready) < when(prep) || when(ready) - when(prep) > 8000 || when(started) < when(ready) ||
    before.some(e => e.event === 'document_action' && e.action?.teaching?.sequence_id === sequenceId)) return null;
  return {sequenceId, requestedAt: prep.at, readyAt: ready.at, startedAt: started.at,
    renderedQuietMs: ready.rendered_quiet_ms, audioPlaying: false, heardStage: false};
}

/** source-v2: source pixels and source-owned marks, independently of the
 * historical conceptual-graph receipts accepted by teachingProgress above. */
export function sourceTeachingProgress(events, sequenceId, sourceId, localSteps = [], inkSteps = [], clock = {}) {
  const own = teachingSequenceEvents(events, sequenceId), started = own[0];
  const inspection = events.slice(0, events.indexOf(started)).findLast(e => e.direction === 'received' &&
    e.event === 'document_inspected' && e.document_id === EXPERIENCE_PLAN.fixture.sha256 && e.page === EXPERIENCE_PLAN.fixture.page);
  if (started.mode !== 'source' || started.source_id !== sourceId || started.document_id !== EXPERIENCE_PLAN.fixture.sha256 ||
    started.page !== EXPERIENCE_PLAN.fixture.page || !/^[a-f0-9]{64}$/.test(started.image_sha256 || '') ||
    inspection?.image_sha256 !== started.image_sha256 || !Array.isArray(inspection.regions) ||
    !normalizedRegion(started.view_region) || sameRegion(started.view_region, [0, 0, 1, 1]) ||
    !Number.isInteger(started.count) || started.count < 2 || started.count > 6) throw Error('Source-v2 teaching lacks the exact inspected original page, image and enlarged crop.');
  if (own.some(e => e.direction === 'received' && e.event === 'presentation_action')) throw Error('Source-v2 teaching replaced the original with a conceptual view.');
  if (own.some(e => e.direction === 'received' && e.event === 'document_action' &&
    (e.action?.kind !== 'mark' || e.action?.teaching?.sequence_id !== sequenceId))) throw Error('Source-v2 teaching contains an unrelated original-document operation.');
  const stages = own.filter(e => e.direction === 'received' && e.event === 'teaching_step'), result = [];
  const actions = own.filter(e => e.direction === 'received' && e.event === 'document_action' && e.action?.teaching?.sequence_id === sequenceId);
  for (const [position, stage] of stages.entries()) {
    if (stage.mode !== 'source' || stage.index !== position || stage.count !== started.count || stage.sequence_id !== sequenceId ||
      stage.source_id !== sourceId || stage.document_id !== started.document_id || stage.page !== started.page ||
      stage.image_sha256 !== started.image_sha256 || !sameRegion(stage.view_region, started.view_region)) throw Error('Source-v2 teaching stage identity, count or source changed.');
    const matching = actions.filter(e => e.action.teaching.index === stage.index);
    if (matching.length !== 1) throw Error('Source-v2 stage lacks one unique original-mark proposal.');
    const action = matching[0], a = action.action, identity = a.teaching;
    const region = inspection.regions.find(r => r.id === stage.region_id && r.page === stage.page);
    if (a.kind !== 'mark' || a.replace !== true || a.document_id !== started.document_id || a.page !== started.page ||
      identity.count !== started.count || identity.source_id !== sourceId || identity.image_sha256 !== started.image_sha256 ||
      identity.region_id !== stage.region_id || identity.focus_label !== stage.focus_label ||
      !sameRegion(a.view_region, started.view_region) || !Array.isArray(a.marks) || a.marks.length !== position + 1 ||
      !region || !sameRegion(a.marks.at(-1)?.region, region.region) ||
      a.marks.some(mark => !['box', 'ellipse', 'arrow'].includes(mark.kind) || !containsRegion(started.view_region, mark.region)) ||
      position && JSON.stringify(a.marks.slice(0, -1)) !== JSON.stringify(result.at(-1).marks)) throw Error('Source-v2 marks lost inspected-region provenance, stable crop or cumulative prefix.');
    const receipts = own.filter(e => e.direction === 'sent' && e.type === 'document_result' && e.action_id === a.action_id);
    const ack = receipts[0];
    if (receipts.length !== 1 || !ack.ok || ack.document_id !== a.document_id || ack.revision !== a.revision ||
      ack.page !== a.page || ack.mark_count !== a.marks.length || !sameRegion(ack.region, started.view_region) ||
      stage.action_id !== a.action_id || own.indexOf(action) >= own.indexOf(ack) || own.indexOf(ack) >= own.indexOf(stage)) throw Error('Source-v2 commentary lacks its actual original-mark render ACK.');
    const nextAction = actions.find(e => e.action.teaching.index === position + 1);
    const end = nextAction ? own.indexOf(nextAction) : own.length;
    const narration = own.slice(position ? own.indexOf(action) + 1 : 1, end).filter(e => e.direction === 'received' && e.event === 'output_transcript');
    const boundaries = own.filter(e => e.direction === 'sent' && e.type === 'teaching_boundary' && e.sequence_id === sequenceId && e.index === position);
    if (boundaries.length > 1) throw Error('Source-v2 stage produced duplicate boundary receipts.');
    const boundary = boundaries[0], local = localSteps.find(s => s.sequenceId === sequenceId && s.index === position);
    const inks = inkSteps.filter(s => s.sequenceId === sequenceId && s.index === position), ink = inks[0];
    for (const event of [started, inspection, action, ack, stage, ...narration, ...boundaries]) {
      if (!Number.isFinite(when(event))) throw Error('Source-v2 receipt has an invalid observation clock.');
    }
    if (when(ack) < when(action) - 100 || when(stage) < when(ack) - 100) throw Error('Source-v2 render ACK observation order is invalid.');
    if (narration.some(e => own.indexOf(e) < own.indexOf(stage) || when(e) < when(ack) - 100)) throw Error('Source-v2 commentary preceded the original-mark acknowledgement.');
    const usefulSpeech = usefulNarration(narration, stage.focus_label);
    if (nextAction && (!boundary || boundary.heard !== true || boundary.manual || own.indexOf(boundary) >= own.indexOf(nextAction))) throw Error('The next source mark arrived before its predecessor was heard.');
    if (inks.length !== 1 || ink.sourceId !== sourceId || ink.regionId !== stage.region_id || ink.count !== stage.count ||
      ink.imageSha256 !== started.image_sha256 || !sameRegion(ink.viewRegion, started.view_region) ||
      !Number.isFinite(ink.renderedAt) || !Number.isFinite(clock.timeOrigin) ||
      clock.timeOrigin + ink.renderedAt > when(ack) + 100 ||
      clock.timeOrigin + ink.renderedAt < when(action) - 100) throw Error('Source-v2 mark has no matching local original-render receipt.');
    let onsetToInk = null;
    if (ink.inkStartedAt != null) {
      onsetToInk = ink.inkStartedAt - local?.signalObservedAt;
      if (!local?.signalObserved || !Number.isFinite(local.signalObservedAt) || !Number.isFinite(ink.inkStartedAt) ||
        clock.timeOrigin + local.signalObservedAt < when(stage) - 100 ||
        ink.inkStartedAt < ink.renderedAt || onsetToInk < 0 || onsetToInk > EXPERIENCE_PLAN.latencyLimitsMs.speechOnsetToInk) throw Error('Source-v2 ink did not start within 300ms of fresh rendered speech.');
    } else if (local?.signalObserved && Number.isFinite(local.signalObservedAt) &&
      Number.isFinite(clock.now) && clock.now - local.signalObservedAt > EXPERIENCE_PLAN.latencyLimitsMs.speechOnsetToInk) throw Error('Source-v2 ink missed the 300ms rendered-speech onset deadline.');
    if (ink.inkCompletedAt != null && (!Number.isFinite(ink.inkCompletedAt) || !Number.isFinite(ink.inkStartedAt) ||
      ink.inkCompletedAt < ink.inkStartedAt || ink.phase !== 'inked')) throw Error('Source-v2 ink completion clock or phase is invalid.');
    if (boundary && (boundary.heard !== true || boundary.manual || !usefulSpeech.at || own.indexOf(boundary) <= own.indexOf(stage) ||
      narration.some(e => when(e) > when(boundary) + 100) || when(boundary) + 100 < Date.parse(usefulSpeech.at) ||
      !local?.signalObserved || local.heard !== true || local.renderedSignalSamples <= local.baselineSignalSamples ||
      !Number.isFinite(local.boundaryAt) || !Number.isInteger(local.playerVersion) ||
      position && local.playerVersion <= result.at(-1).localEvidence?.playerVersion || onsetToInk == null ||
      ink.phase !== 'inked' || !Number.isFinite(ink.inkCompletedAt) || ink.inkCompletedAt > local.boundaryAt + 100)) throw Error('Source-v2 boundary lacks fresh useful speech and a completed source mark.');
    result.push({contractVersion: 'source-v2', sequenceId, index: position, count: stage.count, focusLabel: stage.focus_label,
      sourceId, page: stage.page, imageSha256: started.image_sha256, regionId: stage.region_id, viewRegion: started.view_region,
      narrationRequested: stage.narration, marks: a.marks, actionAt: action.at, renderAckAt: ack.at, teachingStepAt: stage.at,
      usefulNarrationAt: usefulSpeech.at, usefulNarrationConfirmedAt: usefulSpeech.confirmedAt,
      actualPostRenderNarration: spokenAnswer(narration).trim(), boundaryAt: boundary?.at || null,
      heard: boundary?.heard === true, localEvidence: local || null, inkEvidence: ink,
      speechOnsetToInkMs: onsetToInk,
      renderAckToUsefulNarrationMs: usefulSpeech.at ? Date.parse(usefulSpeech.at) - when(ack) : null,
      previousBoundaryToActionMs: position && result.at(-1).boundaryAt ? when(action) - Date.parse(result.at(-1).boundaryAt) : null});
  }
  if (actions.some((e, index) => e.action.teaching.index !== index || index > stages.length || index >= started.count)) throw Error('Source-v2 marks jumped beyond the next stage.');
  return result;
}

export function completedSourceTeaching(events, sequenceId, sourceId, localSteps, inkSteps, clock) {
  const own = teachingSequenceEvents(events, sequenceId), started = own[0];
  const progression = sourceTeachingProgress(events, sequenceId, sourceId, localSteps, inkSteps, clock);
  const finished = own.find(e => e.direction === 'received' && e.event === 'teaching_finished' && e.sequence_id === sequenceId);
  if (!finished || finished.status !== EXPERIENCE_PLAN.walkthrough.completionStatus || progression.length !== started.count ||
    progression.some(stage => !stage.heard || stage.inkEvidence.phase !== 'inked') ||
    finished.rendered_steps !== started.count || finished.local_speech_boundaries_confirmed !== started.count || finished.manual_advances !== 0 ||
    !Number.isFinite(when(finished)) || when(finished) + 100 < Date.parse(progression.at(-1)?.boundaryAt)) throw Error('Source-v2 completion lacks every rendered, inked and heard stage.');
  return {contractVersion: 'source-v2', sequenceId, count: started.count, startedAt: started.at, finishedAt: finished.at, progression, completion: finished};
}

export function readableSourceCrop(view, expectedRegion) {
  return view?.visible === true && view.documentId === EXPERIENCE_PLAN.fixture.sha256 && view.page === EXPERIENCE_PLAN.fixture.page &&
    sameRegion(view.region, expectedRegion) && !sameRegion(view.region, [0, 0, 1, 1]) &&
    Number.isFinite(view.surfaceWidth) && Number.isFinite(view.workspaceWidth) && view.workspaceWidth > 0 &&
    Number.isFinite(view.surfaceHeight) && Number.isFinite(view.workspaceHeight) && view.workspaceHeight > 0 &&
    view.surfaceWidth >= view.workspaceWidth * EXPERIENCE_PLAN.sourceView.minimumWorkspaceWidthFraction &&
    view.surfaceWidth <= view.workspaceWidth + 1 && view.surfaceHeight > 0 && view.surfaceHeight <= view.workspaceHeight + 1;
}

export function observedEvent(value) {
  const event = safeEvent(value);
  for (const key of ['sequence_id', 'index', 'count', 'heard', 'manual', 'rendered_steps', 'local_speech_boundaries_confirmed', 'manual_advances', 'accent', 'mode', 'source_id', 'region_id']) {
    if (value[key] !== undefined) event[key] = value[key];
  }
  for (const key of ['ready', 'audio_playing']) if (typeof value[key] === 'boolean') event[key] = value[key];
  if (Number.isFinite(value.rendered_quiet_ms)) event.rendered_quiet_ms = value.rendered_quiet_ms;
  for (const key of ['region', 'view_region']) if (normalizedRegion(value[key])) event[key] = [...value[key]];
  if (value.event === 'document_action' && value.action) {
    const action = value.action, clean = {};
    for (const key of ['action_id', 'document_id', 'revision', 'view_revision', 'kind', 'page', 'replace']) if (action[key] !== undefined) clean[key] = action[key];
    for (const key of ['region', 'view_region']) if (normalizedRegion(action[key])) clean[key] = [...action[key]];
    if (Array.isArray(action.marks)) clean.marks = action.marks.slice(0, 12).map(mark => ({kind: mark.kind,
      ...(normalizedRegion(mark.region) ? {region: [...mark.region]} : {}), ...(mark.region_id ? {region_id: mark.region_id} : {}), label: redact(mark.label || '')}));
    if (action.teaching) clean.teaching = Object.fromEntries(['sequence_id', 'index', 'count', 'focus_label', 'source_id', 'region_id', 'image_sha256']
      .filter(key => action.teaching[key] !== undefined).map(key => [key, typeof action.teaching[key] === 'string' ? redact(action.teaching[key]) : action.teaching[key]]));
    event.action = clean;
  }
  if (value.focus_label !== undefined) event.focus_label = redact(value.focus_label);
  if (value.narration !== undefined) event.narration = redact(value.narration);
  if (value.title !== undefined) event.title = redact(value.title);
  if (Array.isArray(value.source_ids)) event.source_ids = value.source_ids.slice(0, 4);
  return event;
}

export async function runExperience() {
  if (process.env.EINSTEIN_PUBLIC_READY !== '1' || process.env.EINSTEIN_PUBLIC_BUDGET_APPROVED !== '1') throw Error('Public-ready and budget gates are missing. No browser opened.');
  const repo = fileURLToPath(new URL('../../', import.meta.url)), origin = publicOrigin(process.env.EINSTEIN_PUBLIC_URL);
  if (origin !== 'https://einstein-mobiliar-lab.fastapicloud.dev') throw Error('This run is scoped to the existing approved public host.');
  const deployment = {id: process.env.EINSTEIN_PUBLIC_DEPLOYMENT_ID, sourceCommit: process.env.EINSTEIN_PUBLIC_RELEASE_SHA};
  const expectedVoice = process.env.EINSTEIN_PUBLIC_VOICE_ID || 'flitz';
  if (expectedVoice !== 'flitz' && !/^voice_[A-Za-z0-9_-]{1,128}$/.test(expectedVoice)) throw Error('Pin the reviewed operator voice ID or Flitz. No browser opened.');
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(deployment.id || '') || !/^[a-f0-9]{40}$/.test(deployment.sourceCommit || '')) throw Error('Exact owner-verified deployment and source are required.');
  const runtimePaths = ['lab_backend', 'rehearsal', 'deploy', 'scripts/build_fastapi_bundle.py', 'tools/build_slides_runtime.py', 'THIRD_PARTY_NOTICES.md'];
  let harnessCommit;
  try {
    harnessCommit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repo, encoding: 'utf8'}).trim();
    execFileSync('git', ['merge-base', '--is-ancestor', deployment.sourceCommit, harnessCommit], {cwd: repo});
    execFileSync('git', ['diff', '--exit-code', deployment.sourceCommit, '--', ...runtimePaths], {cwd: repo, stdio: 'pipe'});
  } catch { throw Error('Reviewed tracked runtime inputs must match the deployed ancestor. No browser opened.'); }
  const pdf = await fs.readFile(process.env.EINSTEIN_PUBLIC_PDF || '').catch(() => null);
  if (!pdf || sha256(pdf) !== EXPERIENCE_PLAN.fixture.sha256 || !pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw Error('The reviewed original TraceMonkey PDF is required. No browser opened.');
  const inputs = JSON.parse(await fs.readFile(path.join(repo, 'deploy/release-inputs.json'))), pin = inputs.assets.find(a => a.name === 'einstein.glb');
  const chunks = characterChunkPlan(JSON.parse(await fs.readFile(path.join(repo, 'rehearsal/src/character-transfer.json'))), pin);
  const index = await fs.readFile(path.join(repo, 'rehearsal/dist/index.html'), 'utf8');
  const expected = Object.fromEntries(await Promise.all([...index.matchAll(/(?:src|href)="(\/assets\/[^"?]+)"/g)].map(async ([, p]) => [p, sha256(await fs.readFile(path.join(repo, 'rehearsal/dist', p)))])));
  if (!Object.keys(expected).some(p => p.endsWith('.js'))) throw Error('Build the reviewed frontend before running.');
  const {chromium} = await import('../../rehearsal/node_modules/@playwright/test/index.mjs');
  const output = path.join(repo, `evidence/${new Date().toISOString().slice(0, 10)}-public-acceptance`, 'experience-' + new Date().toISOString().replace(/[:.]/g, '-'));
  await fs.mkdir(output, {recursive: true});
  const report = {state: 'RUNNING_UNVERIFIED', startedAt: new Date().toISOString(), origin, plan: EXPERIENCE_PLAN,
    contractVersion: EXPERIENCE_PLAN.contractVersion, ownerVerifiedDeployment: deployment, expectedVoice, sourceProvenance: {harnessCommit, runtimePaths, runtimeInputsIdenticalToDeployedCommit: true},
    harnessSha256: sha256(await fs.readFile(fileURLToPath(import.meta.url))), fixture: EXPERIENCE_PLAN.fixture,
    checks: [], events: [], prompts: [], snapshots: [], screenshots: [], assets: {}, requests: [], errors: [], limits: [],
    humanReview: {teachingMeaningAndUsefulness: 'UNVERIFIED', elderlyGermanAccentedEnglish: 'UNVERIFIED', naturalness: 'UNVERIFIED'}};
  let browser, context, page, stream, fatal = null, activeAt = null, permits = 0, attempts = 0, renewals = 0, sessions = 0, visionChecks = 0, inputBytes = 0;
  const captures = [], credentials = [], parts = new Map();
  const until = Date.now() + EXPERIENCE_PLAN.allocation.wholeRunSeconds * 1000, pause = ms => new Promise(r => setTimeout(r, ms));
  const flush = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  const check = (name, pass, evidence = {}) => { report.checks.push({at: new Date().toISOString(), name, passed: Boolean(pass), ...evidence}); if (!pass) throw Error(name); };
  const auditedLatencies = new Set();
  function auditLatencies(progression) {
    for (const stage of progression) {
      for (const [metric, limit] of [['renderAckToUsefulNarrationMs', EXPERIENCE_PLAN.latencyLimitsMs.renderAckToUsefulNarration], ['previousBoundaryToActionMs', EXPERIENCE_PLAN.latencyLimitsMs.boundaryToNextDiagram], ['speechOnsetToInkMs', EXPERIENCE_PLAN.latencyLimitsMs.speechOnsetToInk]]) {
        const value = stage[metric], key = `${stage.sequenceId}:${stage.index}:${metric}`;
        if (value === null || auditedLatencies.has(key)) continue;
        auditedLatencies.add(key);
        check(`Teaching step ${stage.index + 1}: ${metric}`, Number.isFinite(value) && value >= 0 && value <= limit, {sequenceId: stage.sequenceId, latencyMs: value, limitMs: limit});
      }
    }
  }
  async function stop() {
    if (!page || page.isClosed()) return;
    for (let i = 0; i < 4 && await page.locator('dialog[open]').count(); i++) await page.keyboard.press('Escape');
    const s = await state().catch(() => null); if (s?.active || s?.connecting) await page.click('#interrupt', {timeout: 5000});
  }
  const fail = reason => { if (!fatal) { fatal = redact(reason); void stop().catch(() => {}); } };
  function guard() {
    if (fatal) throw Error(fatal);
    if (Date.now() > until - 25000 || activeAt && Date.now() - activeAt > 215000) throw Error('Experience active deadline reached; cleanup time reserved.');
  }
  async function state() {
    return page.evaluate(() => {
      const a = window.__einstein;
      return {at: new Date().toISOString(), performanceTimeOrigin: performance.timeOrigin, performanceNow: performance.now(),
        active: a.native.active, connecting: a.native.connecting, avatarReady: a.stats.avatarReady,
        continuousAudio: a.native.continuousAudio, provider: a.stats.nativeProvider, model: a.stats.nativeModel,
        voice: a.stats.nativeVoice, conversationId: a.stats.nativeConversationId,
        microphoneActive: a.stats.microphoneActive, stream: Boolean(a.native.stream), speaking: a.native.speaking,
        outputBytes: a.stats.nativeOutputBytes || 0, renderedSignalSamples: a.stats.audioRenderedSignalSamples || 0,
        renderedQuietMs: a.stats.audioRenderedQuietMs || 0, audioPlaying: a.stats.audioPlaying,
        playerVersion: a.player.version, playerEntries: a.player.entries.length, suppressAudio: a.native.suppressAudio,
        playbackBoundaries: a.stats.nativePlaybackBoundaries || 0,
        lastPlaybackBoundaryEpochMs: Number.isFinite(a.stats.nativeLastPlaybackBoundaryAt) ? performance.timeOrigin + a.stats.nativeLastPlaybackBoundaryAt : null,
        lastPlaybackBoundaryReason: a.stats.nativeLastPlaybackBoundaryReason, lastTurn: a.stats.lastTurn,
        teaching: a.stats.teaching || null, teachingPreparation: a.stats.teachingPreparation || null, visual: a.stats.visual, document: a.stats.document,
        documentView: (() => {
          const p = a.paper, bounds = p.surface.getBoundingClientRect();
          return {visible: !p.panel.hidden, documentId: p.pdf?.manifest?.id, page: p.pdf?.pageNumber,
            region: [...p.region], surfaceWidth: bounds.width, surfaceHeight: bounds.height,
            workspaceWidth: p.scroll.clientWidth, workspaceHeight: p.scroll.clientHeight,
            marks: (p.marks.get(p.pdf?.pageNumber) || []).map(mark => ({kind: mark.kind, region: [...mark.region], label: mark.label || ''}))};
        })(),
        error: document.querySelector('#error').hidden ? '' : document.querySelector('#error-message').textContent,
        texturedMeshes: (() => { let n = 0; a.stage.model?.traverse(x => { if (x.isMesh && (Array.isArray(x.material) ? x.material : [x.material]).some(m => m?.map)) n++; }); return n; })()};
    });
  }
  async function poll(predicate, label, seconds = 45) {
    const end = Math.min(until - 25000, Date.now() + seconds * 1000);
    while (Date.now() < end) {
      guard(); const s = await state();
      if (s.microphoneActive || s.stream || inputBytes) throw Error('Unexpected microphone input.');
      if (s.error) throw Error('Public app error: ' + s.error);
      if (report.activeSequenceId && report.selectedSourceId && s.teaching?.sequenceId === report.activeSequenceId) {
        try {
          auditLatencies(sourceTeachingProgress(report.events, report.activeSequenceId, report.selectedSourceId, s.teaching.steps, s.document?.teachingMarks || [], {timeOrigin: s.performanceTimeOrigin, now: s.performanceNow}));
        } catch (error) {
          report.auditFailureSnapshot = s;
          await flush();
          throw error;
        }
      }
      const key = JSON.stringify([s.teaching?.sequenceId, s.teaching?.index, s.teaching?.phase, s.teaching?.signalObserved, s.documentView?.region, s.document?.teachingMarks?.map(mark => [mark.sequenceId, mark.index, mark.phase, mark.inkStartedAt, mark.inkCompletedAt]), s.playbackBoundaries]);
      if (report.snapshots.at(-1)?.key !== key) { report.snapshots.push({key, ...s}); await flush(); }
      if (await predicate(s)) return s;
      if (sessions && !s.active && !s.connecting) throw Error('Own provider session closed before acceptance.');
      await pause(150);
    }
    throw Error('Bounded wait expired: ' + label);
  }
  const status = async () => { const response = await page.request.get(origin + '/api/native/status', {timeout: 5000}); if (!response.ok()) throw Error('Native status read failed.'); return response.json(); };
  async function type(text, label) {
    guard(); const prompt = {at: new Date().toISOString(), text, label, eventStart: report.events.length}; report.prompts.push(prompt);
    const question = page.locator('#question'); if (!await question.isVisible()) await page.click('#keyboard-toggle');
    if (!await page.locator('#reply-mode').isDisabled()) await page.selectOption('#reply-mode', 'voice');
    await question.fill(text); await page.click('#send');
    const consent = page.locator('dialog[aria-labelledby="processing-heading"]'); if (await consent.isVisible()) await consent.getByRole('button', {name: 'Agree and begin', exact: true}).click();
    return prompt;
  }
  async function screenshot(name) { const target = path.join(output, name); await page.screenshot({path: target}); const bytes = await fs.readFile(target); report.screenshots.push({name, bytes: bytes.length, sha256: sha256(bytes), at: new Date().toISOString()}); }
  async function sourcePixels(label, region) {
    const view = (await state()).documentView;
    check(label + ': original crop enlarged and inside the source workspace', readableSourceCrop(view, region), {view});
    const pixels = await page.evaluate(async () => {
      const p = window.__einstein.paper, original = p.pdf.canvas, [x, y, w, h] = p.region;
      const expected = document.createElement('canvas'); expected.width = p.base.width; expected.height = p.base.height;
      const c = expected.getContext('2d', {alpha: false}); c.fillStyle = '#fff'; c.fillRect(0, 0, expected.width, expected.height);
      c.drawImage(original, x * original.width, y * original.height, w * original.width, h * original.height, 0, 0, expected.width, expected.height);
      const hash = async canvas => {
        const bytes = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
      };
      return {originalPagePixelSha256: await hash(original), expectedCropPixelSha256: await hash(expected),
        displayedCropPixelSha256: await hash(p.base), cropWidth: p.base.width, cropHeight: p.base.height};
    });
    report.sourceOriginalPixelSha256 ||= pixels.originalPagePixelSha256;
    check(label + ': displayed base contains exact original crop pixels', pixels.displayedCropPixelSha256 === pixels.expectedCropPixelSha256 &&
      pixels.originalPagePixelSha256 === report.sourceOriginalPixelSha256, {pixels});
    report.sourceCropEvidence ||= []; report.sourceCropEvidence.push({label, at: new Date().toISOString(), view, pixels});
  }
  async function settle() {
    const end = Math.min(until - 3000, Date.now() + 22000); let s;
    while (Date.now() < end) {
      s = await status();
      if (!s.active && s.room_active_sessions === 0 && s.last_session?.conversation_id === report.connection?.conversation_id && s.last_session.provider_usage?.final_usage_confirmed) break;
      await pause(250);
    }
    report.finalStatus = {active: s?.active, room_active_sessions: s?.room_active_sessions, last_session: s?.last_session};
    check('Own session returned final usage and room zero', !s?.active && s?.room_active_sessions === 0 && s?.last_session?.conversation_id === report.connection?.conversation_id && s?.last_session?.provider_usage?.final_usage_confirmed === true);
  }
  const watchdog = setInterval(() => {
    if (Date.now() >= until || activeAt && Date.now() - activeAt >= 240000) { fatal ||= 'Hard experience deadline.'; void browser?.close(); }
    else if (activeAt && Date.now() - activeAt >= 215000) fail('Experience session cleanup deadline.');
  }, 500);
  try {
    browser = await chromium.launch({channel: 'chrome', headless: true, args: []});
    context = await browser.newContext({viewport: EXPERIENCE_PLAN.sourceView.viewport, permissions: []}); page = await context.newPage();
    const cdp = await context.newCDPSession(page); await cdp.send('Network.enable', {maxTotalBufferSize: 180000000, maxResourceBufferSize: 80000000});
    page.on('request', request => {
      const u = new URL(request.url()); if (!/^https?:$/.test(u.protocol)) return;
      const event = {origin: u.origin, path: u.pathname, method: request.method(), hasQuery: Boolean(u.search)}; report.requests.push(event);
      if (u.origin !== origin) credentials.push(request.allHeaders().then(headers => { event.credentialHeadersPresent = 'cookie' in headers || 'authorization' in headers; if (!allowedPublicRequest(event, origin, chunks)) fail('Unexpected external or credentialed CDN request.'); }).catch(() => fail('CDN credential check failed.')));
      if (request.method() === 'POST') {
        if (u.pathname === '/api/native/permit') { if (++permits > 1) fail('More than one permit attempt.'); }
        else fail('Unexpected HTTP write, upload, conversion or feedback.');
      }
    });
    page.on('response', response => captures.push((async () => {
      const u = new URL(response.url()), chunk = chunks.urls.get(response.url());
      if (u.origin === origin && response.status() >= 400) fail(`Public HTTP rejection ${response.status()} on ${u.pathname}`);
      if (u.origin === origin && expected[u.pathname] && response.status() === 200) report.assets[u.pathname] = sha256(await response.body());
      if (chunk) { const bytes = await response.body(); if (response.status() !== 200 || bytes.length !== chunk.bytes || sha256(bytes) !== chunk.sha256) throw Error('Pinned character CDN bytes changed.'); parts.set(chunk.name, bytes); }
    })().catch(error => fail(error.message))));
    page.on('pageerror', error => { report.errors.push(redact(error.message)); fail('Browser page error.'); });
    page.on('console', message => { if (message.type() === 'error') { report.errors.push(redact(message.text())); fail('Browser console error.'); } });
    page.on('websocket', socket => {
      const u = new URL(socket.url());
      if (u.origin !== origin.replace('https:', 'wss:')) { fail('Unexpected WebSocket origin.'); return; }
      if (u.pathname === '/api/native/voice') { if (++attempts > 1) fail('More than one provider connection attempt.'); stream = new ObservedNativeStream(); }
      else if (u.pathname === '/api/native/renew') { if (++renewals > 1 || !stream) fail('Unexpected carrier renewal.'); }
      else { fail('Unexpected WebSocket path.'); return; }
      const observed = stream;
      socket.on('framereceived', ({payload}) => {
        let value; try { value = JSON.parse(String(payload)); } catch { return; }
        try { for (const v of observed.receive(value)) {
          if (v.event === 'audio') continue;
          const event = {at: new Date().toISOString(), direction: 'received', ...observedEvent(v)}; report.events.push(event);
          if (v.event === 'connected') {
            sessions++; activeAt = Date.now(); report.connection = {...event, conversation_id: v.conversation_id};
            if (sessions !== 1 || v.provider !== 'OpenAI' || v.model !== 'gpt-live-1' || v.voice !== expectedVoice || v.accent !== 'german' || !v.continuous_audio) fail('Unexpected voice/provider/session metadata.');
          }
          if (v.event === 'input_transcript' && String(v.text || '').trim()) fail('Phantom microphone transcript without approved input PCM.');
          if (['document_vision_started', 'video_vision_started', 'research_started', 'visual_inspected'].includes(v.event) && ++visionChecks > 3) fail('Vision/specialist allocation exceeded.');
          if (report.restartRequestAt && ['document_vision_started', 'video_vision_started', 'research_started', 'visual_inspected'].includes(v.event)) fail('Restart repeated source/specialist inspection instead of using the current observation.');
          if (v.event === 'document_action' && ['read', 'mark'].includes(v.action?.kind) && v.action?.page !== 2) fail('Backend left the explicitly selected page 2.');
          if (v.event === 'presentation_action') fail('Source-v2 replaced the original PDF with a conceptual view.');
          if (v.event === 'document_action' && v.action?.kind === 'mark' && (!report.teachingRequestAt || report.firstWalkthrough && !report.restartRequestAt)) fail('An unrequested source mark appeared.');
          if (['video_action', 'video_vision_started', 'research_started', 'error', 'document_inspection_failed', 'document_action_failed', 'document_cancel', 'presentation_cancel'].includes(v.event)) fail('Provider, source or renderer failure/unapproved operation.');
          if (v.event === 'work_activity' && ['search_public', 'read_public', 'consult_flash'].includes(v.tool)) fail('Unapproved external research or redundant specialist.');
          if (report.cancellation && v.event === 'teaching_step' && v.sequence_id === report.cancellation.sequenceId) fail('Cancelled explanation revealed another step.');
          if (report.cancellation && (v.event === 'document_action' && v.action?.kind === 'mark' || v.event === 'teaching_started')) fail('A new source stage arrived after cancellation.');
          if (v.event === 'teaching_finished' && report.phase === 'complete-first-walkthrough' && v.status !== 'presented-progressively') fail('First walkthrough paused before every spoken stage completed.');
        } } catch (error) { fail(error.message); }
      });
      socket.on('framesent', ({payload}) => {
        if (typeof payload !== 'string') { inputBytes += payload.length; fail('Unexpected microphone PCM.'); return; }
        let value; try { value = JSON.parse(payload); } catch { return; }
        report.events.push({at: new Date().toISOString(), direction: 'sent', ...observedEvent(value)});
        if ((value.type === 'document_result' && value.ok === false) || value.type === 'presentation_result' && ['failed', 'cancelled'].includes(value.status)) fail('Actual browser rejected the source or conceptual view.');
      });
      socket.on('socketerror', error => { report.errors.push(redact(error)); fail('WebSocket transport error.'); });
    });
    await page.goto(origin, {waitUntil: 'domcontentloaded', timeout: 30000});
    await page.waitForFunction(() => window.__einstein?.stats.avatarReady && window.__einstein.stats.nativeStatus, undefined, {timeout: 120000});
    await Promise.all(captures); await Promise.all(credentials); guard(); report.character = characterChunkReceipt(chunks, parts); parts.clear();
    check('Actual served entry and original character bytes match', Object.entries(expected).every(([name, hash]) => report.assets[name] === hash) && (await state()).texturedMeshes > 0);
    const initial = await status(); report.initialStatus = {provider: initial.provider, model: initial.model, available: initial.available, funding_verified: initial.funding_verified, room_active_sessions: initial.room_active_sessions, default_voice: initial.default_voice};
    check('Fresh visitor, empty room and funded configured voice', !initial.active && initial.last_session === null && initial.room_active_sessions === 0 && initial.provider === 'OpenAI' && initial.model === 'gpt-live-1' && initial.available && initial.funding_verified && initial.default_voice === expectedVoice);
    const cookie = (await context.cookies(origin)).find(item => item.name === 'einstein_visitor');
    report.visitor = cookie ? {sha256: sha256(cookie.value), httpOnly: cookie.httpOnly, secure: cookie.secure, sameSite: cookie.sameSite} : null;
    check('Fresh visitor has a secure isolated cookie', report.visitor?.httpOnly && report.visitor.secure && report.visitor.sameSite === 'Strict');
    await type('Hello. Please wait while I open a figure.', 'Ordinary opening');
    await poll(s => s.active && s.continuousAudio && s.renderedSignalSamples > 0, 'Actual spoken opening', 20);
    await page.evaluate(() => {
      const capture = window.__einstein.player.capture?.stream; if (!capture) throw Error('Actual output recording unavailable.');
      const recorder = new MediaRecorder(capture, {mimeType: 'audio/webm;codecs=opus'}), recording = {recorder, parts: []};
      window.__experienceRecording = recording; recorder.ondataavailable = event => { if (event.data.size) recording.parts.push(event.data); }; recorder.start(1000);
    });
    await poll(s => !s.audioPlaying && s.renderedQuietMs >= 900, 'Opening has paused', 15);
    await page.setInputFiles('#paper-file', process.env.EINSTEIN_PUBLIC_PDF);
    await page.waitForFunction(() => window.__einstein.paper.pdf?.manifest && !document.querySelector('#paper-discuss').disabled, undefined, {timeout: 30000});
    await page.fill('#paper-page', '2'); await page.locator('#paper-page').press('Enter'); await page.locator('#paper-next').focus();
    await page.waitForFunction(() => window.__einstein.paper.pdf?.pageNumber === 2 && window.__einstein.paper.base.width > 0, undefined, {timeout: 15000});
    const beforeShare = await state(), shareStart = report.events.length;
    const shareAt = Date.now(); report.sourceShareAt = new Date(shareAt).toISOString(); await page.click('#paper-discuss');
    if (await page.locator('#paper-allow-sharing').isVisible()) await page.click('#paper-allow-sharing');
    await type('Read the selected page and briefly explain what it shows, using the actual source image and text.', 'Explicit source inspection question');
    const inspected = await poll(s => {
      const events = report.events.slice(shareStart), receipt = events.find(e => e.event === 'document_inspected' && e.page === 2);
      const narration = receipt ? spokenAnswer(events.filter(e => when(e) > when(receipt))) : '';
      return receipt && plain(narration).length >= 6 && playbackBoundaryObserved(beforeShare, s) && playbackAfterReceipts(s, events) && s.renderedQuietMs >= 900;
    }, 'Actual selected source page 2 inspected and briefly explained', 45);
    const sourceId = `pdf-${EXPERIENCE_PLAN.fixture.sha256.slice(0, 16)}-p2`;
    report.selectedSourceId = sourceId;
    check('Actual source pixels and citation belong to the selected original page', inspected.document.id === EXPERIENCE_PLAN.fixture.sha256 && inspected.document.page === 2 && report.events.some(e => e.event === 'sources' && e.sources?.some(s => s.id === sourceId && s.page === 2)) && !report.events.some(e => e.event === 'document_action' && e.action?.page === 1));
    const sourceAction = report.events.find(e => e.event === 'document_action'); report.sourceActionLatencyMs = when(sourceAction) - shareAt;
    check('Selected-page action begins without the old planning detour', report.sourceActionLatencyMs <= EXPERIENCE_PLAN.latencyLimitsMs.shareToSourceAction, {latencyMs: report.sourceActionLatencyMs});
    await screenshot('00-original-figure-page-2.png');
    const teachingPrompt = 'Help me understand what happens when the types change. Explain this original figure in three short steps, one sentence per idea. Annotate its inspected regions directly; keep the original figure visible.';
    report.phase = 'complete-first-walkthrough';
    report.teachingRequestAt = new Date().toISOString(); await type(teachingPrompt, 'Ordinary source-specific progressive teaching request');
    const first = await poll(s => report.events.some(e => e.event === 'teaching_step' && e.index === 0 && e.mode === 'source') &&
      s.documentView?.marks.length === 1 && s.teaching?.index === 0, 'First acknowledged mark on the original figure', 15);
    const firstSequenceId = first.teaching.sequenceId; report.activeSequenceId = firstSequenceId;
    report.initialSpeechDrain = preparedTeaching(report.events, firstSequenceId);
    check('Own prior speech drained before the initial mark without claiming a heard stage', Boolean(report.initialSpeechDrain));
    const firstAction = report.events.find(e => e.event === 'document_action' && e.action?.teaching?.sequence_id === firstSequenceId);
    report.teachingActionLatencyMs = when(firstAction) - Date.parse(report.teachingRequestAt);
    check('First meaningful source mark begins promptly', report.teachingActionLatencyMs >= 0 && report.teachingActionLatencyMs <= EXPERIENCE_PLAN.latencyLimitsMs.teachingRequestToFirstDiagram, {latencyMs: report.teachingActionLatencyMs});
    const firstStart = report.events.find(e => e.event === 'teaching_started' && e.sequence_id === firstSequenceId);
    check('First mark retains the actual original page and bounded stage plan', firstStart?.mode === 'source' && firstStart.source_id === sourceId && first.teaching.count >= 2 && first.teaching.count <= 6 && !first.visual.visible);
    await sourcePixels('First source stage', firstStart.view_region);
    await screenshot('01-first-source-mark.png');
    await poll(s => s.teaching?.sequenceId === firstSequenceId && s.teaching.index === 1 && s.documentView?.marks.length === 2,
      'First walkthrough develops a second cumulative source mark', 45);
    await screenshot('02-second-source-mark.png');
    const complete = await poll(s => report.events.some(e => e.event === 'teaching_finished' && e.sequence_id === firstSequenceId) &&
      s.teaching?.sequenceId === firstSequenceId && !s.teaching.active && s.teaching.steps.length === s.teaching.count, 'Every first-walkthrough source stage completes', 120);
    report.firstWalkthrough = completedSourceTeaching(report.events, firstSequenceId, sourceId, complete.teaching.steps,
      complete.document.teachingMarks, {timeOrigin: complete.performanceTimeOrigin, now: complete.performanceNow});
    check('The complete walkthrough contains every rendered, inked and heard source stage', report.firstWalkthrough.progression.length === first.teaching.count && report.firstWalkthrough.progression.every(stage => stage.heard && stage.inkEvidence.phase === 'inked'));
    auditLatencies(report.firstWalkthrough.progression);
    check('The final original figure retains the complete cumulative source marks', complete.documentView.marks.length === report.firstWalkthrough.count && !complete.visual.visible);
    await sourcePixels('Completed source walkthrough', firstStart.view_region);
    await screenshot('03-complete-original-source-marks.png');
    const completionIndex = report.events.findIndex(e => e.event === 'teaching_finished' && e.sequence_id === firstSequenceId);
    const closingUntil = Date.now() + 3000;
    while (Date.now() < closingUntil) { guard(); await pause(200); }
    await poll(s => !s.audioPlaying && s.renderedQuietMs >= 900, 'Completed explanation pauses for the visitor', 5);
    report.firstWalkthrough.postCompletionNarration = spokenAnswer(report.events.slice(completionIndex + 1));
    check('Completed walkthrough pauses without replaying the whole explanation', plain(report.firstWalkthrough.postCompletionNarration).length <= EXPERIENCE_PLAN.walkthrough.postCompletionMaximumWords, {actualPostCompletionNarration: report.firstWalkthrough.postCompletionNarration});
    check('Completed walkthrough adds no further mark without a request', !report.events.slice(completionIndex + 1).some(e => e.event === 'document_action' && e.action?.kind === 'mark'));

    // Its complete evidence is sealed above. A new mark replaces the local ink
    // ledger before the new teaching_step arrives; do not audit that new ledger
    // against the retired sequence while waiting for the restart to begin.
    report.activeSequenceId = null;
    report.phase = 'restart-then-interrupt'; report.restartRequestAt = new Date().toISOString();
    const restart = await type('Start that explanation again, one idea at a time. Keep the same three short steps on the original figure.', 'Ordinary restart using the same observed source');
    const restartFirst = await poll(s => s.teaching?.sequenceId !== firstSequenceId && s.teaching?.index === 0 && s.documentView?.marks.length === 1,
      'Restart begins an independently identified first source mark', 15);
    const restartSequenceId = restartFirst.teaching.sequenceId; report.activeSequenceId = restartSequenceId;
    const restartAction = report.events.find(e => e.event === 'document_action' && e.action?.teaching?.sequence_id === restartSequenceId);
    report.restartActionLatencyMs = when(restartAction) - Date.parse(restart.at);
    check('Restart begins promptly without another source-vision request', report.restartActionLatencyMs >= 0 && report.restartActionLatencyMs <= EXPERIENCE_PLAN.latencyLimitsMs.teachingRequestToFirstDiagram, {latencyMs: report.restartActionLatencyMs});
    const followupText = 'Stop building. In one short sentence, how many pages are in this selected PDF?';
    if (!await page.locator('#question').isVisible()) await page.click('#keyboard-toggle');
    await page.fill('#question', followupText); // Only ordinary Send cancels the sequence.
    const second = await poll(s => s.teaching?.sequenceId === restartSequenceId && s.documentView?.marks.length === 2 &&
      s.teaching.index === 1 && s.teaching.signalObserved && useful(s.teaching.transcript, s.teaching.focusLabel) && s.audioPlaying,
      'Restart reaches its second spoken cumulative source mark', 45);
    await sourcePixels('Restarted source stage', firstStart.view_region);
    await screenshot('04-restarted-second-source-mark-before-interruption.png');
    report.restartSpeechDrain = preparedTeaching(report.events, restartSequenceId);
    check('Restart has its own prior-speech drain receipt', Boolean(report.restartSpeechDrain));
    report.restartProgression = sourceTeachingProgress(report.events, restartSequenceId, sourceId, second.teaching.steps,
      second.document.teachingMarks, {timeOrigin: second.performanceTimeOrigin, now: second.performanceNow});
    check('Restart repeats the source progression with separate fresh speech receipts', report.restartProgression.length === 2 && report.restartProgression[0].heard);
    auditLatencies(report.restartProgression);
    const beforeFollowup = await state();
    check('Second source step is still speaking when the visitor interrupts', beforeFollowup.teaching?.index === 1 && beforeFollowup.teaching.active && beforeFollowup.audioPlaying);
    report.cancellation = {at: new Date().toISOString(), sequenceId: restartSequenceId, interruptedIndex: 1,
      originalView: beforeFollowup.documentView, inkBefore: beforeFollowup.document.teachingMarks};
    report.activeSequenceId = null;
    const followup = await type(followupText, 'New ordinary question cancels further source annotation');
    const frozen = await poll(s => !s.teaching?.active && s.document?.teachingMarks?.every(mark => ['paused', 'inked'].includes(mark.phase)),
      'New question stops source progression and ink within 500ms', .5);
    report.cancellation.freezeObservedAt = frozen.at;
    report.cancellation.freezeLatencyMs = Date.parse(frozen.at) - Date.parse(followup.at);
    check('Source progression and ink stop within 500ms of the new question', report.cancellation.freezeLatencyMs >= 0 && report.cancellation.freezeLatencyMs <= 500);
    const frozenInk = JSON.stringify(frozen.document.teachingMarks);
    const answer = await poll(s => {
      check('Cancelled original marks and crop stay at the last acknowledged stage',
        JSON.stringify(s.documentView.marks) === JSON.stringify(beforeFollowup.documentView.marks) &&
        sameRegion(s.documentView.region, beforeFollowup.documentView.region) && JSON.stringify(s.document.teachingMarks) === frozenInk);
      const fresh = report.events.slice(followup.eventStart), text = spokenAnswer(fresh);
      return fresh.some(e => e.type === 'teaching_cancel' && e.sequence_id === restartSequenceId) && pageCount.test(text) &&
        playbackBoundaryObserved(beforeFollowup, s) && playbackAfterReceipts(s, fresh);
    }, 'Fresh page-count answer after cancelling the active source explanation', 25);
    const freshAnswer = spokenAnswer(report.events.slice(followup.eventStart));
    const firstSubstantiveSentence = firstFollowupSentence(freshAnswer);
    check('The first substantive follow-up answer addresses the new question', pageCount.test(firstSubstantiveSentence), {actualFirstSubstantiveSentence: firstSubstantiveSentence});
    const waitUntil = Date.now() + 3000;
    while (Date.now() < waitUntil) { guard(); const s = await state(); check('Cancelled source marks and ink remain frozen',
      JSON.stringify(s.documentView.marks) === JSON.stringify(beforeFollowup.documentView.marks) &&
      sameRegion(s.documentView.region, beforeFollowup.documentView.region) && JSON.stringify(s.document.teachingMarks) === frozenInk && !s.visual.visible); await pause(250); }
    report.followup = {actualAnswer: freshAnswer, state: answer};
    check('Actual configured synthetic performance matches the pinned voice with German direction', report.connection.voice === expectedVoice && report.connection.accent === 'german');
    await stop(); await settle();
    const stopped = await state(); check('Stop clears capture and playback', !stopped.active && !stopped.connecting && !stopped.microphoneActive && !stopped.stream && !stopped.audioPlaying && stopped.playerEntries === 0 && inputBytes === 0);
    await Promise.all(credentials); check('No extra services, microphone, feedback, conversion or browser errors', report.requests.every(r => allowedPublicRequest(r, origin, chunks)) && report.errors.length === 0 && sessions === 1 && permits === 1 && attempts === 1 && renewals <= 1 && visionChecks <= 3);
    report.state = 'PUBLIC_SOURCE_EXPERIENCE_V2_MECHANICS_PASSED_CONTENT_REVIEW_PENDING';
  } catch (error) { report.state = 'FAILED_OR_INCOMPLETE'; report.failure = redact(error.message); }
  finally {
    await stop().catch(error => report.limits.push(redact('Stop: ' + error.message)));
    if (!report.connection && page && !page.isClosed()) {
      // Preserve the two independent readiness conditions before closing a failed startup.
      // This observation does not alter the readiness deadline or start a provider.
      try {
        report.startupDiagnostic = await page.evaluate(() => ({
          at: new Date().toISOString(), appPresent: Boolean(window.__einstein),
          avatarReady: window.__einstein?.stats.avatarReady === true,
          nativeStatusReceived: Boolean(window.__einstein?.stats.nativeStatus),
          nativeStatusAvailable: window.__einstein?.stats.nativeStatus?.available ?? null,
          assetState: document.querySelector('#asset-state')?.textContent || '',
          serviceState: document.querySelector('#native-status')?.textContent || '',
        }));
        report.startupDiagnostic.serviceState = redact(report.startupDiagnostic.serviceState);
        await screenshot('startup-failure.png');
      } catch (error) { report.limits.push(redact('Startup DOM diagnostic: ' + error.message)); }
      try {
        const s = await status();
        report.finalStatus = {active: s.active, room_active_sessions: s.room_active_sessions, last_session: s.last_session};
      } catch (error) { report.limits.push(redact('Startup diagnostic: ' + error.message)); }
    }
    if (report.connection && !report.finalStatus?.last_session?.provider_usage?.final_usage_confirmed && page && !page.isClosed()) await settle().catch(error => report.limits.push(redact('Final usage: ' + error.message)));
    if (page && !page.isClosed()) {
      try {
        const encoded = await page.evaluate(async () => {
          const recording = window.__experienceRecording; if (!recording) return null;
          if (recording.recorder.state !== 'inactive') await new Promise(resolve => { recording.recorder.addEventListener('stop', resolve, {once: true}); recording.recorder.stop(); });
          const blob = new Blob(recording.parts, {type: 'audio/webm;codecs=opus'});
          return new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(blob); });
        });
        if (!encoded) throw Error('No actual browser output recording.');
        const bytes = Buffer.from(encoded, 'base64'); if (bytes.length < 1000) throw Error('Actual browser output recording is empty.');
        await fs.writeFile(path.join(output, 'actual-browser-output.webm'), bytes);
        report.recording = {file: 'actual-browser-output.webm', bytes: bytes.length, sha256: sha256(bytes), scope: 'Actual SpeechPlayer capture stream; no replacement waveform or physical acoustic verdict.'};
      } catch (error) { report.limits.push(redact(error.message)); }
    }
    await browser?.close().catch(() => {}); clearInterval(watchdog);
    await Promise.allSettled(captures); await Promise.allSettled(credentials);
    report.completedAt = new Date().toISOString(); report.elapsedSeconds = (Date.now() - Date.parse(report.startedAt)) / 1000;
    report.observed = {providerSessions: sessions, connectionAttempts: attempts, permitPosts: permits, transportRenewals: renewals, visionChecks, microphoneInputBytes: inputBytes,
      transport: stream ? {lastSequence: stream.lastSequence, duplicates: stream.duplicates, controls: stream.controls, pendingPackets: stream.pending.size} : null};
    for (const [index, prompt] of report.prompts.entries()) prompt.actualJoinedSpokenAnswer = spokenAnswer(report.events.slice(prompt.eventStart, report.prompts[index + 1]?.eventStart));
    if (report.state.startsWith('PUBLIC_') && (fatal || report.limits.length || !report.recording || report.screenshots.length < 5 || !report.firstWalkthrough?.progression?.every(stage => stage.heard) || stream?.pending.size || !report.finalStatus?.last_session?.provider_usage?.final_usage_confirmed)) {
      report.state = 'FAILED_OR_INCOMPLETE'; report.failure = fatal || 'Recording, screenshot or settled cleanup evidence is incomplete.';
    }
    await flush(); console.log(JSON.stringify({state: report.state, output, observed: report.observed, failure: report.failure}));
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes('--run')) console.log(JSON.stringify(EXPERIENCE_PLAN, null, 2));
  else if (!(await runExperience()).state.startsWith('PUBLIC_')) process.exitCode = 1;
}
