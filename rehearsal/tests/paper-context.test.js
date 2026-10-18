import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Exercise the actual workspace methods with local DOM and transport recorders.
// Canvas rendering remains covered separately by the original-crop regression.
const source = await readFile(new URL('../src/paper-workspace.js', import.meta.url), 'utf8');
const imports = 'const sourceProcessingNotice=()=>"Selected pages use the configured provider.";const clearPresentationFocus=()=>{};\n';
const {PaperWorkspace} = await import('data:text/javascript;base64,' + Buffer.from(imports + source.replace(/^import .*\n/gm, '')).toString('base64'));
const id = 'a'.repeat(64);
const node = () => ({hidden: false, disabled: false, dataset: {}, style: {}, attributes: {}, textContent: '',
  setAttribute(name, value) {this.attributes[name] = value;}, removeAttribute(name) {delete this.attributes[name];},
  focus() {this.focused = true;}, classList: {add() {}, remove() {}}});

function fixture() {
  const packets = [], snapshots = [];
  const native = {active: false, serial: 1, sharedDocument: null,
    offerDocument(document) {packets.push({type: 'document_offer', document}); this.sharedDocument = {id: document.id, pages: document.pages};},
    selectDocumentView(view) {packets.push({type: 'document_view', view}); return true;},
    revokeDocument() {packets.push({type: 'document_revoke'}); this.sharedDocument = null;},
    start() {assert.fail('Consent or metadata capture must not start voice.');}, sendText() {assert.fail('No orientation or inference request is allowed.');}};
  const pdf = {manifest: {id, pages: 3, name: 'original.pdf', kind: 'visitor-selected-pdf'}, pageNumber: 2,
    canvas: {width: 1500, height: 1943}, snapshot(region) {
      snapshots.push([...region]); return {document: {...this.manifest}, page: this.pageNumber, region: [...region], text: 'Actual extracted page text', image: {data: 'local-source-fixture'}};
    }};
  const workspace = Object.assign(Object.create(PaperWorkspace.prototype), {app: {native, stats: {document: {}, nativeStatus: {provider: 'OpenAI'}}},
    pdf, serial: 5, region: [0, 0, 1, 1], approved: false, sharedSession: null, consentDocumentId: null,
    pendingConsent: null, panel: node(), contextChip: node(), contextScope: node(), stopSharing: node(),
    consent: node(), consentNotice: node(), allowSharing: node(), selectArea: node(), selectionBox: node(),
    surface: {...node(), getBoundingClientRect: () => ({left: 100, top: 50, width: 600, height: 400}),
      setPointerCapture() {}, releasePointerCapture() {}}, share: node(), message: node(),
    ink: {cancel() {}}, paint() {}});
  return {workspace, native, pdf, packets, snapshots};
}

test('context metadata is exact and defensive, without exposing source text or pixels', () => {
  const {workspace: w, packets} = fixture();
  w.region = [.1, .2, .4, .5];
  const context = w.queryContext();
  assert.deepEqual(context, {document_id: id, page: 2, pages: 3, region: [.1, .2, .4, .5], approved: false, visible: true});
  context.region[0] = .9; assert.equal(w.region[0], .1);
  assert.equal(context.text, undefined); assert.equal(context.image, undefined); assert.equal(packets.length, 0);
  w.rendering = 6; assert.equal(w.queryContext(), null); w.rendering = null;
  w.pdf.pageNumber = 4; assert.equal(w.queryContext(), null); w.pdf.pageNumber = 2;
  w.region = [0, 0, .01, 1]; assert.equal(w.queryContext(), null);
});

test('decline and approval are explicit, single-flight and never send or start anything', async () => {
  const {workspace: w, packets} = fixture();
  const first = w.requestConsent(); assert.equal(w.requestConsent(), first);
  assert.equal(w.consent.hidden, false); assert.equal(w.allowSharing.focused, true);
  w.resolveConsent(false); assert.equal(await first, false); assert.equal(w.queryContext().approved, false);
  const second = w.requestConsent(); w.resolveConsent(true);
  assert.equal(await second, true); assert.equal(w.queryContext().approved, true);
  assert.equal(w.contextChip.textContent, 'p.2 · full page · sharing allowed');
  assert.equal(w.app.stats.document.sharingAllowed, true);
  assert.equal(w.app.stats.document.sharedWithConversation, false);
  assert.equal(w.stopSharing.hidden, false); assert.equal(await w.requestConsent(), true);
  assert.equal(packets.length, 0);
});

test('an open consent request cannot approve a replacement document or a hidden page', async () => {
  for (const change of [w => {w.pdf.manifest.id = 'b'.repeat(64);}, w => {w.panel.hidden = true;}]) {
    const {workspace: w} = fixture(); const consent = w.requestConsent(); change(w); w.resolveConsent(true);
    assert.equal(await consent, false); assert.equal(w.queryContext().approved, false);
  }
});

test('capture is unavailable without consent or visibility, and reuses the existing original-page snapshot', async () => {
  const {workspace: w, snapshots, packets} = fixture();
  await assert.rejects(w.approvedPageInput(), /allow sharing/); assert.equal(snapshots.length, 0);
  w.consentDocumentId = id; w.panel.hidden = true;
  await assert.rejects(w.approvedPageInput(), /visible page/); assert.equal(snapshots.length, 0);
  w.panel.hidden = false; w.region = [.1, .2, .4, .5];
  const input = await w.approvedPageInput();
  assert.deepEqual(input.region, w.region); assert.equal(input.document.id, id); assert.equal(input.page, 2);
  assert.equal(input.text, 'Actual extracted page text'); assert.equal(snapshots.length, 1); assert.equal(packets.length, 0);
});

test('capture fails closed if page, crop, consent or document changes while it is pending', async () => {
  for (const change of [w => {w.pdf.pageNumber = 3;}, w => {w.region = [.1, .2, .4, .5];},
    w => {w.consentDocumentId = null;}, w => {w.pdf = {...w.pdf};}, w => {w.serial++;}]) {
    const {workspace: w} = fixture(); w.consentDocumentId = id; let finish;
    w.pdf.snapshot = () => new Promise(resolve => {finish = resolve;});
    const pending = w.approvedPageInput(); change(w); finish({image: 'stale source'});
    await assert.rejects(pending, /changed/);
  }
});

test('sharing offers once per actual session and reuses unchanged view without extra cancellation or inference', () => {
  const {workspace: w, native, packets} = fixture(); w.consentDocumentId = id;
  assert.throws(() => w.shareCurrentView(), /connect/); assert.equal(packets.length, 0);
  w.message.textContent = 'Original page ready. Not shared with the conversation.';
  native.active = true; w.shareCurrentView(); w.shareCurrentView();
  assert.deepEqual(packets.map(packet => packet.type), ['document_offer', 'document_view']);
  assert.equal(w.contextChip.textContent, 'p.2 · full page · shared');
  assert.equal(w.message.textContent, 'Shared for this conversation only. Use Stop sharing to revoke access.');
  assert.equal(w.app.stats.document.sharingAllowed, true);
  assert.equal(w.app.stats.document.sharedWithConversation, true);
  w.region = [.1, .2, .4, .5]; w.shareCurrentView();
  assert.equal(packets.filter(packet => packet.type === 'document_offer').length, 1);
  assert.deepEqual(packets.at(-1).view.region, w.region);
  native.serial = 2; w.shareCurrentView();
  assert.equal(packets.filter(packet => packet.type === 'document_offer').length, 2);
  native.sharedDocument = null; w.updateContext();
  assert.match(w.contextChip.textContent, /sharing allowed/);
  w.shareCurrentView(); assert.equal(packets.filter(packet => packet.type === 'document_offer').length, 3);
});

test('failed page synchronization does not claim current-session sharing', () => {
  const {workspace: w, native} = fixture(); w.consentDocumentId = id; native.active = true;
  native.selectDocumentView = () => false;
  assert.throws(() => w.shareCurrentView(), /could not be shared/);
  w.updateContext(); assert.match(w.contextChip.textContent, /sharing allowed/); assert.equal(w.approved, false);
});

test('a successful original-page read acknowledgement keeps authority without redundant view invalidation', async () => {
  const {workspace: w, native, packets} = fixture(); w.consentDocumentId = id; native.active = true;
  w.shareCurrentView();
  w.navigate = async (page, region) => {w.pdf.pageNumber = page; w.region = region; return w.pdf.snapshot(region);};
  const ack = await w.apply({kind: 'read', action_id: 'actual-page-read', document_id: id, revision: 1, page: 3, region: [.2, .3, .4, .5]}, () => true);
  assert.equal(ack.ok, true); assert.equal(ack.page, 3); assert.deepEqual(ack.region, [.2, .3, .4, .5]);
  w.shareCurrentView();
  assert.deepEqual(packets.map(packet => packet.type), ['document_offer', 'document_view']);
});

test('reading the exact approved visible view skips PDF rendering and keeps its pixels and crop', async () => {
  const {workspace: w, native, snapshots} = fixture(); w.consentDocumentId = id; native.active = true;
  w.region = [.2, .3, .4, .5]; w.shareCurrentView();
  w.navigate = () => assert.fail('An already visible source must not be rendered again.');
  const serial = w.serial, canvas = w.pdf.canvas;
  const ack = await w.apply({kind: 'read', action_id: 'current-view', document_id: id, revision: 1, page: 2, region: [...w.region]}, () => true);
  assert.equal(ack.ok, true); assert.equal(ack.image.data, 'local-source-fixture');
  assert.deepEqual(ack.region, w.region); assert.equal(w.serial, serial); assert.equal(w.pdf.canvas, canvas);
  assert.equal(snapshots.length, 1); assert.equal(w.app.stats.document.lastInspectedPage, 2);
});

test('different, hidden or changing views still use the guarded navigation path', async () => {
  for (const change of [w => {w.region = [.1, .2, .4, .5];}, w => {w.panel.hidden = true;}, w => {w.rendering = 6;}]) {
    const {workspace: w, native} = fixture(); w.consentDocumentId = id; native.active = true; w.shareCurrentView(); change(w);
    let navigations = 0;
    w.navigate = async (page, region) => {navigations++; return {page, region, text: 'new view', image: {data: 'new pixels'}};};
    const ack = await w.apply({kind: 'read', action_id: 'new-view', document_id: id, revision: 1, page: 2, region: [0, 0, 1, 1]}, () => true);
    assert.equal(navigations, 1); assert.equal(ack.image.data, 'new pixels');
  }
});

test('a reused current view cannot acknowledge after cancellation or sharing revocation', async () => {
  for (const revoked of [false, true]) {
    const {workspace: w, native} = fixture(); w.consentDocumentId = id; native.active = true; w.shareCurrentView();
    let valid = true, finish;
    w.pdf.snapshot = () => new Promise(resolve => {finish = resolve;});
    const pending = w.apply({kind: 'read', action_id: 'cancelled-view', document_id: id, revision: 1, page: 2, region: [0, 0, 1, 1]}, () => valid);
    if (revoked) {native.revokeDocument(); w.revoke();} else valid = false;
    finish({text: 'old text', image: {data: 'old pixels'}});
    await assert.rejects(pending, /changed|interrupted/);
    assert.equal(w.app.stats.document.lastInspectedPage, undefined);
  }
});

test('old-session and foreign-document authority cannot bypass local consent', () => {
  const {workspace: w, native, packets} = fixture();
  w.approved = true; w.sharedSession = 1; native.active = true; native.serial = 2; native.sharedDocument = {id};
  assert.equal(w.queryContext().approved, false); assert.throws(() => w.shareCurrentView(), /Allow sharing/);
  native.serial = 1; native.sharedDocument.id = 'b'.repeat(64);
  assert.equal(w.queryContext().approved, false); assert.equal(packets.length, 0);
});

test('revocation clears permission and metadata authority while keeping the local source open', () => {
  const {workspace: w, native, pdf} = fixture();
  w.consentDocumentId = id; native.active = true; w.shareCurrentView();
  pdf.snapshotCache = {privateBytes: 'a previously shared page'};
  native.revokeDocument(); w.revoke();
  assert.equal(pdf.snapshotCache, null);
  assert.equal(w.pdf, pdf); assert.equal(w.queryContext().approved, false);
  assert.match(w.contextChip.textContent, /not shared/); assert.equal(w.stopSharing.hidden, true);
  assert.equal(w.message.textContent, 'Original page ready. Not shared with the conversation.');
  assert.throws(() => w.shareCurrentView(), /Allow sharing/);
});

test('a deliberate pointer box maps through the visible crop to exact original source coordinates', async () => {
  const {workspace: w, packets} = fixture(); w.region = [.2, .3, .6, .4]; const views = [];
  w.navigateByVisitor = async (page, region) => views.push({page, region});
  w.beginSelection();
  const pointer = (x, y) => ({button: 0, pointerId: 1, clientX: x, clientY: y, preventDefault() {}});
  w.selectionPointer(pointer(160, 150), 'start'); w.selectionPointer(pointer(520, 350), 'move');
  assert.equal(views.length, 0, 'Previewing an area cannot send or navigate.');
  w.selectionPointer(pointer(520, 350), 'end'); await Promise.resolve();
  assert.equal(views[0].page, 2);
  views[0].region.forEach((value, index) => assert(Math.abs(value - [.26, .4, .36, .2][index]) < 1e-12));
  assert.equal(packets.length, 0); assert.equal(w.selection, null);
});

test('tiny, stale and cancelled selections cannot change the current page', async () => {
  const {workspace: w} = fixture(); let navigations = 0; w.navigateByVisitor = () => {navigations++;};
  w.beginSelection(); w.selection.box = [0, 0, .01, .01]; await w.commitSelection();
  assert.match(w.message.textContent, /larger area/);
  w.beginSelection(); w.serial++; await w.commitSelection();
  w.beginSelection(); w.region = [.1, .2, .4, .5]; await w.commitSelection();
  w.beginSelection(); w.cancelSelection(); await w.commitSelection();
  assert.equal(navigations, 0);
});

test('keyboard selection exposes movement and resizing; Escape cancels locally without propagating', async () => {
  const {workspace: w, packets} = fixture(); const views = []; let prevented = 0, stopped = 0;
  w.navigateByVisitor = async (page, region) => views.push({page, region});
  const key = (value, shiftKey = false) => ({key: value, shiftKey, preventDefault() {prevented++;}, stopPropagation() {stopped++;}});
  w.beginSelection(); const initial = [...w.selection.box];
  w.selectionKey(key('ArrowRight')); w.selectionKey(key('ArrowDown', true));
  assert(w.selection.box[0] > initial[0]); assert(w.selection.box[3] > initial[3]);
  w.selectionKey(key('Enter')); await Promise.resolve(); assert.equal(views.length, 1);
  w.beginSelection(); w.selectionKey(key('Escape'));
  assert.equal(w.selection, null); assert.equal(views.length, 1); assert.equal(packets.length, 0);
  assert.equal(prevented, 4); assert.equal(stopped, 3);
});

test('Discuss requests consent and opens a question without starting or inspecting', async () => {
  for (const active of [false, true]) {
    const {workspace:w,native,packets,snapshots}=fixture();let composed=0;
    native.active=active;w.app.composeQuestion=()=>{composed++;};
    const pending=w.discuss();await Promise.resolve();assert.equal(composed,0);
    w.resolveConsent(true);await pending;
    assert.equal(composed,1);assert.equal(w.consentDocumentId,id);
    assert.equal(packets.length,0);assert.equal(snapshots.length,0);
    assert.match(w.message.textContent,/Ask about this page/);
  }
});

test('declined or replaced documents never open the question composer', async () => {
  for (const changed of [false,true]) {
    const {workspace:w,packets}=fixture();w.app.composeQuestion=()=>assert.fail('No valid consent');
    const pending=w.discuss();await Promise.resolve();
    if(changed)w.pdf=null;
    w.resolveConsent(false);await pending;
    assert.equal(packets.length,0);
  }
});

const videoSource = await readFile(new URL('../src/video-workspace.js', import.meta.url), 'utf8');
const {VideoWorkspace} = await import('data:text/javascript;base64,' + Buffer.from(videoSource.replace(/^import .*\n/gm, '')).toString('base64'));
test('generic Stop emits no video revocation when no video was shared', () => {
  for (const approved of [false,true]) {
    let revokes=0;
    const workspace=Object.assign(Object.create(VideoWorkspace.prototype),{approved,sharedSession:approved?1:null,
      app:{stats:{video:{}},native:{revokeVideo(){revokes++;}}},cancel(){},clearMarks(){},video:{pause(){}}});
    workspace.revoke();workspace.revoke();
    assert.equal(revokes,Number(approved));assert.equal(workspace.approved,false);
  }
});
