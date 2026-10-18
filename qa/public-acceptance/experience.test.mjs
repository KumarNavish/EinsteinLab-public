import test from 'node:test';
import assert from 'node:assert/strict';
import {EXPERIENCE_PLAN, teachingProgress, teachingSequenceEvents, completedTeaching, firstFollowupSentence,
  sourceTeachingProgress, completedSourceTeaching, readableSourceCrop, observedEvent, preparedTeaching} from './experience.mjs';

const at = milliseconds => new Date(Date.UTC(2026, 9, 17) + milliseconds).toISOString();
const sourceId = 'pdf-original-p2';
function fixture() {
  const nodes = [{id: 'stable', label: 'Stable types', x: .2, y: .4, detail: ''}, {id: 'change', label: 'Types change', x: .6, y: .4, detail: ''}];
  const graph = count => ({nodes: nodes.slice(0, count), edges: count === 1 ? [] : [{from: 'stable', to: 'change'}], sources: [{id: sourceId}]});
  const events = [
    {at: at(0), event: 'presentation_action', action: {action_id: 'view-0', kind: 'diagram', revision: 1, graph: graph(1)}},
    {at: at(100), direction: 'sent', type: 'presentation_result', action_id: 'view-0', revision: 1, status: 'displayed', rendered_elements: 1},
    {at: at(125), event: 'presentation_action', action: {action_id: 'focus-0', kind: 'focus', revision: 2, element_id: 'stable'}},
    {at: at(150), direction: 'sent', type: 'presentation_result', action_id: 'focus-0', revision: 2, status: 'focused', rendered_elements: 1},
    {at: at(200), event: 'teaching_step', sequence_id: 'sequence', index: 0, count: 3, focus_label: 'Stable types', narration: 'Stable types let the compiled trace reuse its assumptions.'},
    {at: at(300), event: 'output_transcript', text: 'Stable types let this compiled trace reuse its assumptions.'},
    {at: at(2000), direction: 'sent', type: 'teaching_boundary', sequence_id: 'sequence', index: 0, heard: true},
    {at: at(2100), event: 'presentation_action', action: {action_id: 'view-1', kind: 'diagram', revision: 3, graph: graph(2)}},
    {at: at(2200), direction: 'sent', type: 'presentation_result', action_id: 'view-1', revision: 3, status: 'displayed', rendered_elements: 3},
    {at: at(2220), event: 'presentation_action', action: {action_id: 'focus-1', kind: 'focus', revision: 4, element_id: 'change'}},
    {at: at(2250), direction: 'sent', type: 'presentation_result', action_id: 'focus-1', revision: 4, status: 'focused', rendered_elements: 3},
    {at: at(2300), event: 'teaching_step', sequence_id: 'sequence', index: 1, count: 3, focus_label: 'Types change', narration: 'When types change, this path leaves the compiled trace.'},
    {at: at(2400), event: 'output_transcript', text: 'When types change, this path leaves the compiled trace.'},
  ];
  const local = [{sequenceId: 'sequence', index: 0, heard: true, signalObserved: true,
    baselineSignalSamples: 100, renderedSignalSamples: 1000, playerVersion: 1, boundaryAt: 2000}];
  for (const event of events) event.direction ||= 'received';
  return {events, local, action0: events[0], ack0: events[1], focus0: events[2], focusAck0: events[3],
    stage0: events[4], narration0: events[5], boundary0: events[6], action1: events[7], ack1: events[8],
    focus1: events[9], focusAck1: events[10], stage1: events[11], narration1: events[12]};
}

function completeFixture() {
  const f = fixture();
  f.events.unshift({at: at(-100), direction: 'received', event: 'teaching_started', sequence_id: 'sequence', count: 3, source_ids: [sourceId]});
  const finalNode = {id: 'interpret', label: 'Interpreter', x: .8, y: .6, detail: ''};
  const finalGraph = {nodes: [...f.action1.action.graph.nodes, finalNode],
    edges: [...f.action1.action.graph.edges, {from: 'change', to: 'interpret'}], sources: [{id: sourceId}]};
  const tail = [
    {at: at(4000), direction: 'sent', type: 'teaching_boundary', sequence_id: 'sequence', index: 1, heard: true},
    {at: at(4100), event: 'presentation_action', action: {action_id: 'view-2', kind: 'diagram', revision: 5, graph: finalGraph}},
    {at: at(4200), direction: 'sent', type: 'presentation_result', action_id: 'view-2', revision: 5, status: 'displayed', rendered_elements: 5},
    {at: at(4220), event: 'presentation_action', action: {action_id: 'focus-2', kind: 'focus', revision: 6, element_id: 'interpret'}},
    {at: at(4250), direction: 'sent', type: 'presentation_result', action_id: 'focus-2', revision: 6, status: 'focused', rendered_elements: 5},
    {at: at(4300), event: 'teaching_step', sequence_id: 'sequence', index: 2, count: 3, focus_label: 'Interpreter', narration: 'The interpreter resumes execution when this compiled trace exits.'},
    {at: at(4400), event: 'output_transcript', text: 'The interpreter resumes execution when this compiled trace exits.'},
    {at: at(6000), direction: 'sent', type: 'teaching_boundary', sequence_id: 'sequence', index: 2, heard: true},
    {at: at(6100), event: 'teaching_finished', sequence_id: 'sequence', status: 'presented-progressively', rendered_steps: 3, local_speech_boundaries_confirmed: 3, manual_advances: 0},
  ].map(event => ({direction: 'received', ...event}));
  f.events.push(...tail);
  f.local.push(...[1, 2].map(index => ({sequenceId: 'sequence', index, heard: true, signalObserved: true,
    baselineSignalSamples: index * 1000, renderedSignalSamples: (index + 1) * 1000, playerVersion: index + 1, boundaryAt: index === 1 ? 4000 : 6000})));
  return {...f, boundary1: tail[0], boundary2: tail[7], finished: tail[8]};
}

test('the plan is bounded and mechanics never certify human voice or teaching quality', () => {
  assert.equal(EXPERIENCE_PLAN.allocation.providerSessions, 1);
  assert.equal(EXPERIENCE_PLAN.allocation.connectionAttempts, 1);
  assert.equal(EXPERIENCE_PLAN.allocation.sessionSeconds, 240);
  assert.equal(EXPERIENCE_PLAN.allocation.visionChecks, 3);
  assert.equal(EXPERIENCE_PLAN.walkthrough.requireEveryStageHeard, true);
  assert.equal(EXPERIENCE_PLAN.walkthrough.restartWithoutNewVision, true);
  assert.match(EXPERIENCE_PLAN.interpretation, /not a human teaching-quality/);
});

test('source-cited prefixes require render, new narration and a heard boundary before the next node', () => {
  const f = fixture(), progress = teachingProgress(f.events, sourceId, f.local);
  assert.equal(progress.length, 2); assert.equal(progress[0].heard, true);
  assert.equal(progress[0].renderAckToUsefulNarrationMs, 150);
  assert.equal(progress[1].previousBoundaryToActionMs, 100);
  assert.equal(progress[1].heard, false);
});

test('a correct source and final node count cannot cure a static all-at-once reveal', () => {
  const f = fixture(); f.action0.action.graph.nodes.push({id: 'future', label: 'Future node'});
  assert.throws(() => teachingProgress(f.events, sourceId, f.local), /jumped ahead/);
});

test('a missing, wrong or stale browser ACK never establishes visible teaching', () => {
  for (const mutate of [f => { f.events = f.events.filter(event => event !== f.ack0); }, f => { f.ack0.action_id = 'old-view'; }, f => { f.ack0.revision = 0; }]) {
    const f = fixture(); mutate(f); assert.throws(() => teachingProgress(f.events, sourceId, f.local), /rendered-diagram ACK/);
  }
});

test('old source, altered earlier prefix and invalid endpoints are rejected', () => {
  for (const mutate of [f => { f.action0.action.graph.sources = [{id: 'another-page'}]; },
    f => { f.action1.action.graph.nodes[0] = {id: 'changed', label: 'Changed'}; },
    f => { f.action1.action.graph.edges[0].to = 'hidden-future-node'; }]) {
    const f = fixture(); mutate(f); assert.throws(() => teachingProgress(f.events, sourceId, f.local));
  }
});

test('an acknowledgement prelude, stale signal, manual continue or absent boundary cannot advance', () => {
  for (const mutate of [f => { f.narration0.text = 'All right, I will look at that.'; },
    f => { f.local[0].renderedSignalSamples = f.local[0].baselineSignalSamples; },
    f => { f.boundary0.heard = false; f.boundary0.manual = true; },
    f => { f.events = f.events.filter(event => event !== f.boundary0); }]) {
    const f = fixture(); mutate(f); assert.throws(() => teachingProgress(f.events, sourceId, f.local), /boundary/);
  }
});

test('a late predecessor sentence after its purported boundary is not seamless progression', () => {
  const f = fixture();
  for (const event of f.events.filter(event => Date.parse(event.at) >= Date.parse(f.action1.at))) event.at = at(Date.parse(event.at) - Date.parse(at(0)) + 300);
  f.events.splice(f.events.indexOf(f.action1), 0, {at: at(2200), direction: 'received', event: 'output_transcript', text: 'Stable types still have more to explain.'});
  assert.throws(() => teachingProgress(f.events, sourceId, f.local), /boundary/);
});

test('a changed sequence or skipped stage is rejected rather than stitched into a pass', () => {
  for (const change of [{sequence_id: 'another-sequence'}, {index: 2}, {count: 4}]) {
    const f = fixture(); Object.assign(f.stage1, change);
    assert.throws(() => teachingProgress(f.events, sourceId, f.local), /identity/);
  }
});

test('a short acknowledgement does not improve the measured useful-narration onset', () => {
  const f = fixture(); f.narration0.text = 'All right.';
  f.events.splice(f.events.indexOf(f.narration0) + 1, 0, {at: at(700), direction: 'received', event: 'output_transcript', text: ' Stable types let this compiled trace reuse its assumptions.'});
  const progress = teachingProgress(f.events, sourceId, f.local);
  assert.equal(progress[0].renderAckToUsefulNarrationMs, 550);
  assert.equal(progress[0].usefulNarrationConfirmedAt, at(700));
});

test('visitor text and supplied source content cannot stand in for received spoken narration', () => {
  const f = fixture(); f.narration0.direction = 'sent'; f.narration0.type = 'text';
  assert.throws(() => teachingProgress(f.events, sourceId, f.local), /boundary/);
});

test('a diagram alone cannot claim that its new node was actually focused', () => {
  for (const mutate of [f => { f.events = f.events.filter(event => event !== f.focusAck0); },
    f => { f.focus0.action.element_id = 'future'; }, f => { f.stage0.focus_label = 'Another item'; }]) {
    const f = fixture(); mutate(f); assert.throws(() => teachingProgress(f.events, sourceId, f.local), /focus ACK/);
  }
});

test('a concise fresh answer is accepted while a stale preceding explanation stays visible as failure evidence', () => {
  assert.equal(firstFollowupSentence('Mhm. Fourteen pages.'), ' Fourteen pages.');
  assert.equal(firstFollowupSentence('This is a 14-page PDF.'), 'This is a 14-page PDF.');
  assert.equal(firstFollowupSentence('The guard fails and execution exits. It has fourteen pages.'), 'The guard fails and execution exits.');
});

test('a full walkthrough requires all three actual rendered and heard stages plus explicit completion', () => {
  const f = completeFixture(), full = completedTeaching(f.events, 'sequence', sourceId, f.local);
  assert.equal(full.count, 3); assert.equal(full.progression.length, 3);
  assert(full.progression.every(stage => stage.heard));
  assert.equal(full.progression.at(-1).nodes.length, 3);
  assert.equal(full.completion.status, 'presented-progressively');
});

test('a claimed finished status cannot hide a missing last boundary, partial plan or manual advance', () => {
  for (const mutate of [f => { f.events = f.events.filter(event => event !== f.boundary2); },
    f => { f.events = f.events.filter(event => event.action?.action_id !== 'view-2' && event.index !== 2); },
    f => { f.finished.status = 'paused'; }, f => { f.finished.manual_advances = 1; },
    f => { f.finished.local_speech_boundaries_confirmed = 2; }]) {
    const f = completeFixture(); mutate(f);
    assert.throws(() => completedTeaching(f.events, 'sequence', sourceId, f.local));
  }
});

test('completion cannot precede the last local spoken boundary or count duplicate receipts', () => {
  const early = completeFixture(); early.finished.at = at(5700);
  assert.throws(() => completedTeaching(early.events, 'sequence', sourceId, early.local), /completion/);
  const duplicate = completeFixture(); duplicate.events.splice(duplicate.events.indexOf(duplicate.boundary2), 0, {...duplicate.boundary2});
  assert.throws(() => completedTeaching(duplicate.events, 'sequence', sourceId, duplicate.local), /duplicate/);
});

test('a restart is audited in its own event window and cannot borrow completed stages', () => {
  const first = completeFixture(), second = completeFixture();
  for (const event of second.events) {
    event.at = at(Date.parse(event.at) - Date.parse(at(0)) + 10000);
    if (event.sequence_id) event.sequence_id = 'restart';
    if (event.action_id) event.action_id = 'restart-' + event.action_id;
    if (event.action?.action_id) event.action.action_id = 'restart-' + event.action.action_id;
  }
  const events = [...first.events, ...second.events];
  const local = second.local.map(step => ({...step, sequenceId: 'restart'}));
  assert.equal(completedTeaching(events, 'sequence', sourceId, first.local).progression.length, 3);
  assert.equal(completedTeaching(events, 'restart', sourceId, local).progression.length, 3);
  assert(!teachingSequenceEvents(events, 'sequence').some(event => event.sequence_id === 'restart'));
  assert.throws(() => completedTeaching(events, 'restart', sourceId, first.local), /boundary/);
});

test('an interleaved restart cannot turn an unfinished first walkthrough into a complete one', () => {
  const f = completeFixture();
  f.events.splice(f.events.indexOf(f.finished), 0, {at: at(6050), direction: 'received', event: 'teaching_started', sequence_id: 'restart', count: 3});
  assert.throws(() => completedTeaching(f.events, 'sequence', sourceId, f.local), /completion/);
});

// Synthetic protocol fixtures validate the auditor only; they are not public
// acceptance receipts, source-image inspections or rendered browser evidence.
function sourceFixture(sequenceId = 'source-sequence') {
  const documentId = EXPERIENCE_PLAN.fixture.sha256, image = 'a'.repeat(64), crop = [.1, .2, .8, .6];
  const regions = ['Stable types', 'Types change', 'Interpreter'].map((label, index) => ({
    id: `p2-aaaaaaaaaa-r${index + 1}`, label, page: 2, region: [.15 + index * .2, .3, .12, .2]}));
  const inspection = {at: at(-100), direction: 'received', event: 'document_inspected', document_id: documentId,
    page: 2, image_sha256: image, regions};
  const started = {at: at(0), direction: 'received', event: 'teaching_started', sequence_id: sequenceId,
    mode: 'source', source_id: sourceId, document_id: documentId, page: 2, image_sha256: image, view_region: crop, count: 3};
  const events = [inspection, started], local = [], ink = [], actions = [], acks = [], stages = [], narrations = [], boundaries = [];
  const marks = regions.map(region => ({kind: 'ellipse', region: region.region, label: region.label}));
  for (let index = 0; index < 3; index++) {
    const offset = index * 2000, identity = {sequence_id: sequenceId, index, count: 3, focus_label: regions[index].label,
      source_id: sourceId, region_id: regions[index].id, image_sha256: image};
    const action = {at: at(offset + 100), direction: 'received', event: 'document_action', action: {
      action_id: `${sequenceId}-mark-${index}`, kind: 'mark', document_id: documentId, revision: index + 1,
      page: 2, replace: true, view_region: [...crop], marks: structuredClone(marks.slice(0, index + 1)), teaching: {...identity}}};
    const ack = {at: at(offset + 150), direction: 'sent', type: 'document_result', action_id: action.action.action_id,
      document_id: documentId, revision: index + 1, ok: true, page: 2, region: [...crop], mark_count: index + 1};
    const stage = {...started, ...identity, at: at(offset + 200), event: 'teaching_step', action_id: action.action.action_id,
      narration: `${regions[index].label} explains the transition shown in the original figure.`};
    const narration = {at: at(offset + 300), direction: 'received', event: 'output_transcript', text: stage.narration};
    const boundary = {at: at(offset + 2000), direction: 'sent', type: 'teaching_boundary', sequence_id: sequenceId, index, heard: true};
    events.push(action, ack, stage, narration, boundary);
    actions.push(action); acks.push(ack); stages.push(stage); narrations.push(narration); boundaries.push(boundary);
    local.push({sequenceId, index, count: 3, heard: true, signalObserved: true, signalObservedAt: offset + 310,
      baselineSignalSamples: index * 1000, renderedSignalSamples: (index + 1) * 1000, playerVersion: index + 1, boundaryAt: offset + 2000});
    ink.push({sequenceId, index, count: 3, sourceId, regionId: regions[index].id, imageSha256: image, viewRegion: [...crop],
      renderedAt: offset + 140, inkStartedAt: offset + 380, inkCompletedAt: offset + 1080, phase: 'inked'});
  }
  const finished = {at: at(6100), direction: 'received', event: 'teaching_finished', sequence_id: sequenceId,
    status: 'presented-progressively', rendered_steps: 3, local_speech_boundaries_confirmed: 3, manual_advances: 0};
  events.push(finished);
  return {events, started, inspection, actions, acks, stages, narrations, boundaries, finished, local, ink,
    clock: {timeOrigin: Date.parse(at(0)), now: 6100}, crop};
}
const sourceProgress = f => sourceTeachingProgress(f.events, f.started.sequence_id, sourceId, f.local, f.ink, f.clock);
const sourceComplete = f => completedSourceTeaching(f.events, f.started.sequence_id, sourceId, f.local, f.ink, f.clock);

test('source-v2 preserves the allocation and latency ceilings with a separate original-pixel contract', () => {
  assert.equal(EXPERIENCE_PLAN.contractVersion, 'source-v2');
  assert.deepEqual(EXPERIENCE_PLAN.allocation, {providerSessions: 1, connectionAttempts: 1, transportRenewals: 1,
    visionChecks: 3, presentationConversions: 0, feedbackSubmissions: 0, sessionSeconds: 240, wholeRunSeconds: 360});
  assert.deepEqual(EXPERIENCE_PLAN.latencyLimitsMs, {shareToSourceAction: 4000, teachingRequestToFirstDiagram: 6000,
    renderAckToUsefulNarration: 2500, boundaryToNextDiagram: 1500, speechOnsetToInk: 300});
  assert.deepEqual(EXPERIENCE_PLAN.sourceView.viewport, {width: 1280, height: 720});
  assert.equal(EXPERIENCE_PLAN.sourceView.minimumWorkspaceWidthFraction, .6);
  assert.equal(EXPERIENCE_PLAN.sourceView.humanTextLegibility, 'UNVERIFIED');
});

test('source-v2 joins exact source regions, cumulative marks, browser ACKs, fresh speech and ink clocks', () => {
  const f = sourceFixture(), progress = sourceProgress(f), complete = sourceComplete(f);
  assert.equal(progress.length, 3); assert.equal(complete.contractVersion, 'source-v2');
  assert.deepEqual(progress.map(stage => stage.marks.length), [1, 2, 3]);
  assert.deepEqual(progress.map(stage => stage.speechOnsetToInkMs), [70, 70, 70]);
  assert.equal(progress[0].renderAckToUsefulNarrationMs, 150);
  assert.equal(progress[1].previousBoundaryToActionMs, 100);
  assert(complete.progression.every(stage => stage.heard && stage.inkEvidence.phase === 'inked'));
  assert.throws(() => teachingProgress(teachingSequenceEvents(f.events, f.started.sequence_id), sourceId, f.local));
});

test('source-v2 rejects missing inspection, another page or image, unknown region and guessed coordinates', () => {
  for (const mutate of [f => { f.events.shift(); }, f => { f.inspection.page = 1; },
    f => { f.inspection.image_sha256 = 'b'.repeat(64); }, f => { f.started.mode = 'diagram'; },
    f => { f.started.document_id = 'b'.repeat(64); }, f => { f.stages[0].mode = 'diagram'; }, f => { f.stages[0].region_id = 'invented'; },
    f => { f.actions[0].action.marks[0].region[0] += .01; },
    f => { f.inspection.regions[0].page = 1; }, f => { f.actions[0].action.teaching.source_id = 'uninspected-source'; }]) {
    const f = sourceFixture(); mutate(f); assert.throws(() => sourceProgress(f));
  }
});

test('source-v2 rejects a replacement graph, all-at-once marks, rewritten prefix or moving crop', () => {
  for (const mutate of [f => { f.events.splice(2, 0, {at: at(50), direction: 'received', event: 'presentation_action', action: {kind: 'diagram'}}); },
    f => { f.actions[0].action.marks.push(...structuredClone(f.actions[1].action.marks)); },
    f => { f.actions[1].action.marks[0].label = 'Rewritten'; }, f => { f.actions[1].action.replace = false; },
    f => { f.actions[1].action.view_region = [0, 0, 1, 1]; }, f => { f.started.view_region = [0, 0, 1, 1]; },
    f => { f.actions[0].action.marks[0].region = [0, 0, .1, .1]; },
    f => { f.events.splice(3, 0, {...f.actions[0], action: {...f.actions[0].action, teaching: undefined}}); }]) {
    const f = sourceFixture(); mutate(f); assert.throws(() => sourceProgress(f));
  }
});

test('source-v2 requires the exact successful original-document ACK before stage commentary', () => {
  for (const mutate of [f => { f.events.splice(f.events.indexOf(f.acks[0]), 1); },
    f => { f.acks[0].ok = false; }, f => { f.acks[0].revision = 9; }, f => { f.acks[0].action_id = 'stale'; },
    f => { f.acks[0].document_id = 'stale'; }, f => { f.acks[0].page = 1; }, f => { f.acks[0].mark_count = 2; },
    f => { f.acks[0].region = [0, 0, 1, 1]; }, f => { f.stages[0].action_id = 'stale'; },
    f => { f.events.splice(2, 0, {...f.narrations[0], at: at(50)}); },
    f => { f.events.splice(f.events.indexOf(f.acks[0]), 0, {...f.narrations[0], at: at(120)}); }]) {
    const f = sourceFixture(); mutate(f); assert.throws(() => sourceProgress(f), /ACK|acknowledgement/);
  }
});

test('source-v2 rejects duplicate, skipped and cross-sequence stages or mark proposals', () => {
  for (const mutate of [f => { f.stages[1].sequence_id = 'other'; }, f => { f.stages[1].count = 4; },
    f => { f.stages[1].index = 2; }, f => { f.events.splice(2, 0, structuredClone(f.actions[0])); },
    f => { f.actions[2].action.teaching.index = 4; }]) {
    const f = sourceFixture(); mutate(f); assert.throws(() => sourceProgress(f));
  }
});

test('source-v2 measures rendered-speech onset rather than transcript or silent packet timing', () => {
  for (const mutate of [f => { f.ink[0].inkStartedAt = f.local[0].signalObservedAt + 301; },
    f => { f.ink[0].inkStartedAt = f.local[0].signalObservedAt - 1; },
    f => { f.ink[0].renderedAt = 1510; }, f => { f.local[0].signalObserved = false; },
    f => { f.local[0].signalObservedAt = null; }, f => { f.local[0].signalObservedAt = -1000; },
    f => { f.ink[0].imageSha256 = 'b'.repeat(64); }, f => { f.ink[0].regionId = 'other'; },
    f => { f.ink[0].viewRegion = [0, 0, 1, 1]; }, f => { f.ink[0].renderedAt = null; },
    f => { f.ink[0].renderedAt = -1000; }]) {
    const f = sourceFixture(); mutate(f); assert.throws(() => sourceProgress(f));
  }
});

test('source-v2 permits pending onset only until its unchanged 300ms deadline, without certifying completion', () => {
  const f = sourceFixture(); f.events = f.events.slice(0, f.events.indexOf(f.boundaries[0]));
  f.local = [{...f.local[0], heard: null, boundaryAt: null}];
  f.ink = [{...f.ink[0], inkStartedAt: null, inkCompletedAt: null, phase: 'ghost'}];
  f.clock.now = f.local[0].signalObservedAt + 299;
  assert.equal(sourceProgress(f)[0].speechOnsetToInkMs, null);
  assert.throws(() => sourceComplete(f), /completion/);
  f.clock.now += 2; assert.throws(() => sourceProgress(f), /300ms/);
});

test('source-v2 completion cannot borrow stale local speech, unfinished ink or manual boundaries', () => {
  for (const mutate of [f => { f.local[0].renderedSignalSamples = f.local[0].baselineSignalSamples; },
    f => { f.local[0].sequenceId = 'other'; }, f => { f.ink[0].sequenceId = 'other'; },
    f => { f.ink[2].phase = 'paused'; }, f => { f.ink[2].inkCompletedAt = null; },
    f => { f.ink[0].inkCompletedAt = f.local[0].boundaryAt + 101; },
    f => { f.boundaries[1].manual = true; f.boundaries[1].heard = false; },
    f => { f.finished.manual_advances = 1; }, f => { f.finished.rendered_steps = 2; },
    f => { f.finished.status = 'paused'; }, f => { f.local[1].playerVersion = f.local[0].playerVersion; },
    f => { f.events.splice(f.events.indexOf(f.boundaries[2]), 1); },
    f => { f.events.splice(f.events.indexOf(f.boundaries[2]), 0, {...f.boundaries[2]}); }]) {
    const f = sourceFixture(); mutate(f); assert.throws(() => sourceComplete(f));
  }
});

test('source-v2 restart has independent sequence, local speech and ink evidence', () => {
  const first = sourceFixture(), second = sourceFixture('restart');
  // One inspection remains valid; the restart is forbidden from spending on another one.
  const restartEvents = second.events.slice(1).map(event => ({...event, at: at(Date.parse(event.at) - Date.parse(at(0)) + 10000)}));
  const events = [...first.events, ...restartEvents];
  const local = second.local.map(step => ({...step, signalObservedAt: step.signalObservedAt + 10000, boundaryAt: step.boundaryAt + 10000}));
  const ink = second.ink.map(step => ({...step, renderedAt: step.renderedAt + 10000, inkStartedAt: step.inkStartedAt + 10000, inkCompletedAt: step.inkCompletedAt + 10000}));
  const clock = {...first.clock, now: 16100};
  assert.equal(completedSourceTeaching(events, first.started.sequence_id, sourceId, first.local, first.ink, clock).count, 3);
  assert.equal(completedSourceTeaching(events, 'restart', sourceId, local, ink, clock).count, 3);
  assert.throws(() => completedSourceTeaching(events, 'restart', sourceId, first.local, first.ink, clock));
});

test('source-v2 crop measurements require the original selected page, stable crop and 60 percent workspace width', () => {
  const region = [.1, .2, .8, .6], view = {visible: true, documentId: EXPERIENCE_PLAN.fixture.sha256, page: 2, region,
    surfaceWidth: 600, surfaceHeight: 400, workspaceWidth: 1000, workspaceHeight: 500};
  assert.equal(readableSourceCrop(view, region), true);
  for (const change of [{visible: false}, {documentId: 'other'}, {page: 1}, {region: [0, 0, 1, 1]},
    {surfaceWidth: 599}, {surfaceWidth: 1002}, {surfaceHeight: 502}, {workspaceWidth: 0}, {surfaceWidth: NaN}]) {
    assert.equal(readableSourceCrop({...view, ...change}, region), false);
  }
});

test('source-v2 observer keeps coordinates and source region identities without unknown nested secrets', () => {
  const f = sourceFixture(), secret = 'sk-proj-' + 'x'.repeat(40);
  const action = structuredClone(f.actions[0]);
  action.action.ticket = secret; action.action.teaching.ticket = secret; action.action.marks[0].provider_body = secret;
  action.action.marks[0].label = secret;
  const observed = observedEvent(action);
  assert.deepEqual(observed.action.view_region, f.crop);
  assert.deepEqual(observed.action.marks[0].region, f.inspection.regions[0].region);
  assert.equal(observed.action.teaching.region_id, f.inspection.regions[0].id);
  assert(!JSON.stringify(observed).includes(secret));
  const ack = observedEvent({...f.acks[0], permit: secret});
  assert.deepEqual(ack.region, f.crop); assert.equal(ack.mark_count, 1); assert(!JSON.stringify(ack).includes(secret));
});


test('initial speech readiness needs its own ordered quiet receipt and never certifies a heard stage', () => {
  const events = [
    {at: at(0), direction: 'received', event: 'teaching_prepare', sequence_id: 'new'},
    {at: at(1000), direction: 'sent', type: 'teaching_ready', sequence_id: 'new', ready: true, audio_playing: false, rendered_quiet_ms: 970},
    {at: at(1100), direction: 'received', event: 'teaching_started', sequence_id: 'new'},
  ];
  assert.equal(preparedTeaching(events, 'new').heardStage, false);
  assert.equal(preparedTeaching(events, 'old'), null);
  for (const change of [{ready: false}, {audio_playing: true}, {rendered_quiet_ms: 899},
    {rendered_quiet_ms: true}, {rendered_quiet_ms: NaN}, {sequence_id: 'old'}, {at: at(9000)}]) {
    assert.equal(preparedTeaching([events[0], {...events[1], ...change}, events[2]], 'new'), null);
  }
  for (const invalid of [[events[1], events[0], events[2]], [events[0], events[2], events[1]],
    [events[0], events[1], events[1], events[2]],
    [events[0], {...events[1], event: 'document_action', action: {teaching: {sequence_id: 'new'}}}, events[1], events[2]]]) {
    assert.equal(preparedTeaching(invalid, 'new'), null);
  }
  const observed = observedEvent({...events[1], credentials: 'not permitted'});
  assert.equal(observed.ready, true); assert.equal(observed.audio_playing, false);
  assert.equal(observed.rendered_quiet_ms, 970); assert.equal(observed.credentials, undefined);
});

test('source commentary accepts singular/plural focus inflections without accepting generic or unrelated speech', () => {
  const candidate = text => {
    const f = sourceFixture();
    f.stages[2].focus_label = f.actions[2].action.teaching.focus_label = 'Record and compile';
    f.stages[2].narration = 'Record and compile creates a new specialized trace when an exit becomes hot.';
    f.narrations[2].text = text;
    return f;
  };
  const spoken = 'If that exit becomes hot, the system records and compiles a new trace for it, so execution continues efficiently with the new types.';
  assert.equal(sourceComplete(candidate(spoken)).count, 3);
  for (const text of ['All right, I will explain that part of the figure.',
    'The gardener waters the plants while the weather stays warm.', 'Records and compiles.']) {
    assert.throws(() => sourceComplete(candidate(text)), /boundary/);
  }
  const f = candidate(spoken); f.local[2].renderedSignalSamples = f.local[2].baselineSignalSamples;
  assert.throws(() => sourceComplete(f), /boundary/);
});
