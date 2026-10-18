import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {NativeConversation} from '../src/native-audio.js';

// Load the actual workspace methods without its CSS/Three browser dependencies.
// The DOM constructor and PDF rendering are not executed in these offline fixtures.
const workspaceSource = await readFile(new URL('../src/paper-workspace.js', import.meta.url), 'utf8');
const {PaperWorkspace} = await import('data:text/javascript;base64,' + Buffer.from(workspaceSource.replace(/^import .*\n/gm, '')).toString('base64'));
const document = {id: 'a'.repeat(64), name: 'local.pdf', pages: 3, bytes: 1800, kind: 'visitor-selected-pdf', approved: true};

function viewerDOM(t) {
  const saved = globalThis.document;
  globalThis.document = {body: {classList: {add() {}}}};
  t.after(() => { if (saved === undefined) delete globalThis.document; else globalThis.document = saved; });
}

function fixture(t) {
  const saved = globalThis.WebSocket;
  globalThis.WebSocket = class { static OPEN = 1; };
  t.after(() => { if (saved === undefined) delete globalThis.WebSocket; else globalThis.WebSocket = saved; });
  const packets = [], stats = {}, player = {version: 0, entries: [], stop() { this.version++; }};
  const native = new NativeConversation({stats, player, onEvent() {}, onState() {}, onError() {}});
  native.active = true; native.serial = 1;
  native.socket = {readyState: 1, send(packet) { packets.push(JSON.parse(packet)); }};
  native.offerDocument(document);
  return {native, packets, player};
}

test('approved navigation cancels teaching and sends selection metadata before rendering', async t => {
  const {native, packets, player} = fixture(t);
  const workspace = Object.assign(Object.create(PaperWorkspace.prototype), {app: {native}, approved: true,
    sharedSession: 1, pdf: {manifest: document}, navigate: async (page, region) => {
      assert.equal(native.documentViewRevision, 1); assert.equal(native.suppressAudio, true);
      assert.ok(player.version > 0);
      assert.deepEqual(packets.at(-1), {type: 'document_view', view: {document_id: document.id, page: 3, region: [0, 0, 1, 1], view_revision: 1}});
      return {page, region};
    }});
  assert.deepEqual(await workspace.navigateByVisitor(3), {page: 3, region: [0, 0, 1, 1]});
  const view = packets.findIndex(packet => packet.type === 'document_view');
  assert.equal(packets[view - 1].type, 'teaching_cancel');
  assert.equal(packets.filter(packet => packet.type === 'document_offer').length, 1, 'Navigation must not re-offer the file.');
  assert.equal(packets.filter(packet => packet.type === 'text').length, 0, 'Navigation must not request a model response.');
});

test('unshared and previous-session navigation remains local', async t => {
  const {native, packets} = fixture(t);
  let renders = 0;
  const workspace = Object.assign(Object.create(PaperWorkspace.prototype), {app: {native}, approved: false,
    sharedSession: 1, pdf: {manifest: document}, navigate: async () => { renders++; }});
  await workspace.navigateByVisitor(2);
  workspace.approved = true; workspace.sharedSession = 0;
  await workspace.navigateByVisitor(3);
  assert.equal(renders, 2);
  assert.equal(packets.filter(packet => packet.type === 'document_view').length, 0);
});

test('invalid, unapproved, revoked or mismatched view metadata cannot transmit or cancel', t => {
  const {native, packets} = fixture(t);
  const view = {document_id: document.id, page: 2, region: [0, 0, 1, 1]};
  for (const changes of [{document_id: 'b'.repeat(64)}, {page: 0}, {page: 4}, {page: true}, {page: '2'},
    {region: [0, 0, NaN, 1]}, {region: [false, 0, 1, 1]}, {region: [0, 0, .01, 1]}, {image: 'unapproved'}]) {
    const count = packets.length;
    assert.equal(native.selectDocumentView({...view, ...changes}), false);
    assert.equal(packets.length, count);
  }
  native.revokeDocument();
  let count = packets.length;
  assert.equal(native.selectDocumentView(view), false); assert.equal(packets.length, count);
  native.offerDocument({...document, approved: false}); count = packets.length;
  assert.equal(native.selectDocumentView(view), false); assert.equal(packets.length, count);
});

test('queued old document action is rejected before it can navigate the viewer', async t => {
  const {native, packets} = fixture(t);
  native.documentHandler = () => assert.fail('The old action reached the viewer.');
  const action = {action_id: 'old', document_id: document.id, revision: 1, view_revision: 0, kind: 'read', page: 1};
  native.handle({event: 'document_action', generation: 0, action}, 1);
  native.selectDocumentView({document_id: document.id, page: 3});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(packets.find(packet => packet.type === 'document_result').ok, false);
});

test('an in-flight document action loses validity when the visitor selects another page', async t => {
  const {native, packets} = fixture(t);
  let finish, valid;
  native.documentHandler = (_action, current) => { valid = current; return new Promise(resolve => { finish = resolve; }); };
  const action = {action_id: 'running', document_id: document.id, revision: 1, view_revision: 0, kind: 'read', page: 1};
  native.handle({event: 'document_action', generation: 0, action}, 1);
  await Promise.resolve(); assert.equal(valid(), true);
  native.selectDocumentView({document_id: document.id, page: 2});
  assert.equal(valid(), false);
  finish({action_id: action.action_id, document_id: document.id, revision: 1, ok: true, image: 'late page pixels'});
  await new Promise(resolve => setImmediate(resolve));
  const receipt = packets.find(packet => packet.type === 'document_result');
  assert.equal(receipt.ok, false); assert.equal(receipt.image, undefined);
});

test('current page action stays valid', async t => {
  const {native, packets} = fixture(t);
  native.selectDocumentView({document_id: document.id, page: 2});
  native.documentHandler = (action, valid) => {
    assert.equal(valid(), true); return {action_id: action.action_id, document_id: document.id, revision: 1, ok: true};
  };
  native.handle({event: 'document_action', generation: 0, action: {action_id: 'current', document_id: document.id, revision: 1, view_revision: 1}}, 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(packets.find(packet => packet.type === 'document_result').ok, true);
});

test('annotation acknowledgement reports the actual displayed crop', async t => {
  viewerDOM(t);
  const saved = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = callback => queueMicrotask(callback);
  t.after(() => { if (saved === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = saved; });
  const crop = [.1, .2, .5, .6];
  const workspace = Object.assign(Object.create(PaperWorkspace.prototype), {app: {native: {active: true, serial: 1}},
    approved: true, sharedSession: 1, pdf: {manifest: document, pageNumber: 2}, region: crop,
    panel: {dataset: {}}, ink: {clear() {}}, marks: new Map(), paint() {}, pointAt() {}});
  const result = await workspace.apply({action_id: 'mark', document_id: document.id, revision: 1, kind: 'mark',
    page: 2, replace: true, marks: [{kind: 'box', region: [.1, .2, .3, .3]}]}, () => true);
  assert.deepEqual(result.region, crop);
  assert.notEqual(result.region, crop, 'The acknowledgement owns its crop value.');
});

test('a cancelled annotation cannot restore its crop or marks over a newer PDF view', async t => {
  viewerDOM(t);
  const saved = globalThis.requestAnimationFrame, frames = [];
  globalThis.requestAnimationFrame = callback => frames.push(callback);
  t.after(() => { if (saved === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = saved; });
  let valid = true, paints = 0, cancels = 0;
  const old = {manifest: document, pageNumber: 2};
  const workspace = Object.assign(Object.create(PaperWorkspace.prototype), {app: {native: {active: true, serial: 1}},
    serial: 5, approved: true, sharedSession: 1, pdf: old, region: [.5, .24, .42, .25],
    panel: {dataset: {}}, ink: {clear() {}, cancel() {cancels++;}}, marks: new Map(), paint() {paints++;}, pointAt() {}});
  const pending = workspace.apply({action_id: 'old-mark', document_id: document.id, revision: 1,
    kind: 'mark', page: 2, replace: true, marks: [{kind: 'box', region: [.6, .3, .1, .1]}]}, () => valid);
  const rejection = assert.rejects(pending, /interrupted/);
  const latestMarks = [{kind: 'box', region: [.1, .1, .2, .2]}];
  valid = false; workspace.pdf = {manifest: {...document, id: 'b'.repeat(64)}, pageNumber: 2};
  workspace.serial++; workspace.region = [0, 0, 1, 1]; workspace.marks.set(2, latestMarks);
  while (frames.length) frames.shift()();
  await rejection;
  assert.deepEqual(workspace.region, [0, 0, 1, 1]); assert.equal(workspace.marks.get(2), latestMarks);
  assert.equal(paints, 1); assert.equal(cancels, 0);
});
