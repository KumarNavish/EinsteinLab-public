import * as THREE from 'three';
import './paper-workspace.css';
import {sourceProcessingNotice, processingProvider} from './processing-consent.js';
import {setPresentationFocus, clearPresentationFocus} from './embodied-attention.js';
import {SourceInk} from './source-ink.js';

const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const el = (tag, attributes = {}, text = '') => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  node.textContent = text;
  return node;
};

/** Original-page viewer. Annotations are on a different canvas; source pixels
 * are never overwritten. Source coordinates survive zoom, resize and crops.
 */
export class PaperWorkspace {
  constructor(app) {
    this.app = app; this.serial = 0; this.pdf = null; this.region = [0, 0, 1, 1];
    this.marks = new Map(); this.approved = false; this.sharedSession = null;
    this.consentDocumentId = null; this.pendingConsent = null;
    this.ink = new SourceInk({paint: () => this.paintAnnotations(),
      publish: steps => { if (this.app.stats.document) this.app.stats.document.teachingMarks = steps; }});
    this.fileInput = el('input', {id: 'paper-file', type: 'file', accept: '.pdf,application/pdf', hidden: ''});
    this.openButton = el('button', {id: 'paper-open', class: 'view-control', type: 'button'}, 'Open a paper');
    document.querySelector('#material-actions').append(this.openButton, this.fileInput);
    this.panel = el('section', {id: 'paper-workspace', 'aria-label': 'Original PDF workspace', hidden: ''});
    const heading = el('header', {class: 'paper-heading'});
    const titleBox = el('div');
    titleBox.append(el('span', {class: 'paper-kicker'}, 'ORIGINAL DOCUMENT · BROWSER-LOCAL'));
    this.title = el('h2', {id: 'paper-title'}, 'Selected PDF'); titleBox.append(this.title);
    this.closeButton = el('button', {type: 'button', id: 'paper-remove', class: 'icon-button', 'aria-label': 'Remove selected PDF'}, '×');
    heading.append(titleBox, this.closeButton);
    const controls = el('div', {class: 'paper-controls'});
    this.previous = el('button', {type: 'button', id: 'paper-previous', class: 'view-control', 'aria-label': 'Previous PDF page'}, '←');
    this.pageInput = el('input', {id: 'paper-page', type: 'number', min: '1', value: '1', 'aria-label': 'PDF page number'});
    this.pageTotal = el('span', {id: 'paper-page-total'}, '/ 0');
    this.next = el('button', {type: 'button', id: 'paper-next', class: 'view-control', 'aria-label': 'Next PDF page'}, '→');
    this.fit = el('button', {type: 'button', id: 'paper-fit', class: 'view-control'}, 'Full page');
    this.zoom = el('select', {id: 'paper-zoom', 'aria-label': 'PDF display zoom'});
    for (const [value, label] of [['1','Fit page'],['1.5','150%'],['2','200%']]) {
      const option = el('option', {value}, label); this.zoom.append(option);
    }
    this.selectArea = el('button', {type: 'button', id: 'paper-select-area', class: 'view-control', 'aria-pressed': 'false'}, 'Select area');
    controls.append(this.previous, this.pageInput, this.pageTotal, this.next, this.fit, this.zoom, this.selectArea);
    const context = el('div', {class: 'paper-context'});
    const contextRow = el('div', {class: 'paper-context-row'});
    this.contextChip = el('button', {type: 'button', id: 'paper-context', 'aria-expanded': 'false', 'aria-controls': 'paper-consent'}, 'No page selected');
    this.stopSharing = el('button', {type: 'button', id: 'paper-stop-sharing', class: 'text-button', hidden: ''}, 'Stop sharing');
    this.contextScope = el('p', {class: 'paper-context-scope'});
    contextRow.append(this.contextChip, this.stopSharing); context.append(contextRow, this.contextScope);
    this.consent = el('div', {id: 'paper-consent', role: 'group', 'aria-labelledby': 'paper-consent-heading', hidden: ''});
    this.consent.append(el('p', {id: 'paper-consent-heading'}, 'Let Einstein see the pages you show from this document?'));
    this.consentNotice = el('p', {class: 'paper-consent-notice'});
    this.allowSharing = el('button', {type: 'button', id: 'paper-allow-sharing', class: 'primary-button'}, 'Allow sharing');
    this.keepLocal = el('button', {type: 'button', id: 'paper-keep-local', class: 'text-button'}, 'Keep local');
    const consentActions = el('div', {class: 'paper-consent-actions'}); consentActions.append(this.allowSharing, this.keepLocal);
    this.consent.append(this.consentNotice, consentActions); context.append(this.consent);
    this.scroll = el('div', {class: 'paper-scroll', tabindex: '0', 'aria-label': 'Scrollable original PDF page'});
    this.surface = el('div', {class: 'paper-surface'});
    this.base = el('canvas', {id: 'paper-original', role: 'img', 'aria-label': 'Original selected PDF page'});
    this.overlay = el('canvas', {id: 'paper-annotations', 'aria-label': 'Explanatory annotation overlay'});
    this.notes = el('ol', {id: 'paper-notes', 'aria-label': 'Explanation on the original source', hidden: ''});
    this.selectionBox = el('div', {class: 'paper-selection-box', hidden: ''});
    this.surface.append(this.base, this.overlay, this.selectionBox); this.scroll.append(this.surface, this.notes);
    this.caption = el('p', {id: 'paper-caption', class: 'paper-caption'}, '');
    const sharing = el('div', {class: 'paper-sharing'});
    this.share = el('button', {type: 'button', id: 'paper-discuss', class: 'primary-button'}, 'Discuss this PDF with Einstein');
    this.privacy = el('p', {class: 'paper-privacy'}, sourceProcessingNotice(app.stats.nativeStatus));
    this.sharingSummary = el('p', {class: 'paper-sharing-summary'}, `Discussing shares requested pages with ${processingProvider(app.stats.nativeStatus)}.`);
    const privacyDetails = el('details', {class: 'paper-sharing-details'});
    privacyDetails.append(el('summary', {}, 'How sharing works'), this.privacy);
    this.message = el('p', {id: 'paper-status', role: 'status'});
    sharing.append(this.share, this.sharingSummary, privacyDetails, this.message);
    this.panel.append(heading, context, controls, this.scroll, this.caption, sharing); document.querySelector('#app').append(this.panel);
    this.openButton.onclick = () => this.fileInput.click();
    this.fileInput.onchange = async () => { const file = this.fileInput.files?.[0]; this.fileInput.value = ''; if (file) await this.open(file); };
    this.closeButton.onclick = () => this.close();
    this.previous.onclick = () => this.navigateByVisitor(this.pdf?.pageNumber - 1);
    this.next.onclick = () => this.navigateByVisitor(this.pdf?.pageNumber + 1);
    this.pageInput.onchange = () => this.commitPage();
    this.pageInput.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); this.commitPage(); } };
    this.fit.onclick = () => this.navigateByVisitor(this.pdf?.pageNumber, [0, 0, 1, 1]);
    this.zoom.onchange = () => this.fitDisplay();
    this.contextChip.onclick = () => { void this.requestConsent(); };
    this.allowSharing.onclick = () => this.resolveConsent(true);
    this.keepLocal.onclick = () => this.resolveConsent(false);
    this.stopSharing.onclick = () => { this.app.native.revokeDocument?.(); this.revoke(); };
    this.selectArea.onclick = () => this.selection ? this.cancelSelection() : this.beginSelection();
    this.surface.onpointerdown = event => this.selectionPointer(event, 'start');
    this.surface.onpointermove = event => this.selectionPointer(event, 'move');
    this.surface.onpointerup = event => this.selectionPointer(event, 'end');
    this.surface.onpointercancel = () => this.cancelSelection();
    this.surface.onkeydown = event => this.selectionKey(event);
    this.panel.addEventListener('keydown', event => {
      if (event.key === 'Escape' && (this.pendingConsent || this.selection)) {
        event.preventDefault(); event.stopPropagation();
        if (this.pendingConsent) this.resolveConsent(false); else this.cancelSelection();
      }
    });
    this.resizeObserver = new ResizeObserver(() => this.fitDisplay());
    this.resizeObserver.observe(this.scroll);
    this.share.onclick = () => this.discuss();
    this.app.native.documentHandler = (action, valid) => this.apply(action, valid);
    this.app.stats.document = {selected: false, approved: false};
    window.addEventListener('pagehide', () => this.close());
  }

  async open(file) {
    await this.close();
    this.presentationName = null;
    this.panel.querySelector('.paper-kicker').textContent = 'ORIGINAL DOCUMENT · BROWSER-LOCAL';
    this.privacy.textContent = sourceProcessingNotice(this.app.stats.nativeStatus);
    const serial = ++this.serial;
    this.panel.hidden = false; document.body.classList.add('paper-visible');
    this.title.textContent = file.name; this.message.textContent = 'Opening the original PDF in this browser…';
    this.share.disabled = true;
    this.pageInput.disabled = this.previous.disabled = this.next.disabled = true;
    this.pageInput.value = '1';
    this.zoom.value = '1';
    try {
      const {LocalPDF} = await import('./local-pdf.js');
      if (serial !== this.serial) return;
      const pdf = new LocalPDF(); this.pdf = pdf;
      const manifest = await pdf.open(file);
      if (serial !== this.serial) { await pdf.close(); return; }
      this.title.textContent = manifest.name;
      this.pageInput.max = String(manifest.pages); this.pageTotal.textContent = '/ ' + manifest.pages;
      this.app.stats.document = {selected: true, approved: false, id: manifest.id, pages: manifest.pages, name: manifest.name, page: 1};
      await this.navigate(1);
      this.pageInput.disabled = false;
      this.share.disabled = false;
      this.message.textContent = 'Original page ready. Not shared with the conversation.';
    } catch (error) {
      if (serial !== this.serial) return;
      this.message.textContent = error.name === 'PasswordException' ? 'Encrypted PDFs are not supported by this viewer.' : /(?:Failed to fetch dynamically imported module|Importing a module script failed)/i.test(error.message) ? 'The app was updated. Reload this page and choose your document again.' : error.message;
      this.share.disabled = true;
    }
  }

  async navigateByVisitor(page, region = [0, 0, 1, 1]) {
    if (!Number.isInteger(page) || page < 1 || page > (this.pdf?.manifest?.pages || 0)) {
      this.pageInput.value = String(this.app.stats.document.page || this.pdf?.pageNumber || 1); return;
    }
    const selection = JSON.stringify([page, region]);
    if (this.visitorNavigation === selection) return;
    this.visitorNavigation = selection;
    this.cancelSelection();
    this.ink?.cancel();
    delete this.panel?.dataset.teaching;
    const native = this.app.native;
    if (this.approved && this.sharedSession === native.serial && native.active) {
      if (!native.selectDocumentView({document_id: this.pdf.manifest.id, page, region})) { this.visitorNavigation = null; return; }
      this.sharedViewKey = JSON.stringify([this.pdf.manifest.id, page, region]);
    } else if (native.active) {
      native.cancelTeaching(); native.resetPlayback(); native.suppressAudio = true;
    }
    try { return await this.navigate(page, region); }
    catch { this.pageInput.value = String(this.app.stats.document.page || 1); }
    finally { if (this.visitorNavigation === selection) this.visitorNavigation = null; }
  }

  commitPage() {
    const page = Number(this.pageInput.value);
    if (page === this.app.stats.document.page) return;
    void this.navigateByVisitor(page);
  }

  async navigate(page, region = [0, 0, 1, 1], valid = () => true) {
    if (!this.pdf?.document) return;
    const serial = ++this.serial;
    this.cancelSelection(); this.rendering = serial; this.updateContext();
    clearPresentationFocus(this.app.stage, this);
    this.message.textContent = 'Rendering page ' + page + '…';
    try {
      if (!valid()) throw new Error('Document action interrupted.');
      await this.pdf.show(page);
      if (serial !== this.serial || !valid()) throw new Error('Document action interrupted.');
      const {checkedRegion} = await import('./local-pdf.js');
      this.region = checkedRegion(region);
      this.panel.hidden = false; document.body.classList.add('paper-visible');
      this.paint();
      this.pageInput.value = String(page); this.previous.disabled = page <= 1; this.next.disabled = page >= this.pdf.manifest.pages;
      this.app.stats.document.page = page;
      this.scroll.scrollTop = 0; this.scroll.scrollLeft = 0;
      await nextFrame();
      if (serial !== this.serial || !valid()) throw new Error('Document action interrupted.');
      this.message.textContent = this.approved ? 'Shared for this conversation only. Use Stop sharing to revoke access.' : 'Original page ready. Not shared with the conversation.';
      return this.pdf.snapshot(this.region);
    } catch (error) {
      if (serial === this.serial) this.message.textContent = error.message;
      throw error;
    } finally {
      if (this.rendering === serial) { this.rendering = null; this.updateContext(); }
    }
  }

  queryContext() {
    const pdf = this.pdf, manifest = pdf?.manifest, region = this.region;
    if (this.rendering || !manifest || !/^[a-f0-9]{64}$/.test(manifest.id)
        || !pdf.canvas?.width || !pdf.canvas?.height || !Number.isInteger(pdf.pageNumber)
        || !Number.isInteger(manifest.pages) || manifest.pages < 1 || manifest.pages > 200
        || pdf.pageNumber < 1 || pdf.pageNumber > manifest.pages || !Array.isArray(region) || region.length !== 4
        || region.some(value => typeof value !== 'number' || !Number.isFinite(value))) return null;
    const [x, y, w, h] = region;
    if (x < 0 || y < 0 || w < .025 || h < .025 || x + w > 1.000001 || y + h > 1.000001) return null;
    const shared = this.approved && this.app.native.active && this.sharedSession === this.app.native.serial
      && this.app.native.sharedDocument?.id === manifest.id;
    return {document_id: manifest.id, page: pdf.pageNumber, pages: manifest.pages, region: [...region],
      approved: this.consentDocumentId === manifest.id || Boolean(shared), visible: this.panel.hidden === false};
  }

  async approvedPageInput() {
    const before = this.queryContext(), pdf = this.pdf, serial = this.serial;
    if (!before?.approved || !before.visible) throw new Error('Choose a visible page and allow sharing first.');
    const packet = await pdf.snapshot(before.region);
    const after = this.queryContext();
    if (this.pdf !== pdf || this.serial !== serial || !after?.approved || !after.visible
        || after.document_id !== before.document_id || after.page !== before.page
        || after.region.some((value, index) => value !== before.region[index])) throw new Error('The shared page changed before capture completed.');
    return packet;
  }

  shareCurrentView() {
    const context = this.queryContext(), native = this.app.native;
    if (!context?.approved || !context.visible || !native.active) throw new Error('Allow sharing and connect a conversation first.');
    const attached = this.approved && this.sharedSession === native.serial && native.sharedDocument?.id === context.document_id;
    if (!attached) {
      native.offerDocument({...this.pdf.manifest, approved: true});
      this.sharedViewKey = null;
    }
    const key = JSON.stringify([context.document_id, context.page, context.region]);
    if (this.sharedViewKey !== key) {
      if (!native.selectDocumentView({document_id: context.document_id, page: context.page, region: context.region})) throw new Error('The current page could not be shared.');
      this.sharedViewKey = key;
    }
    this.approved = true; this.sharedSession = native.serial;
    this.panel.classList.add('paper-shared'); this.share.textContent = 'Discuss this page';
    this.app.stats.document.approved = true; this.updateContext();
    this.message.textContent = 'Shared for this conversation only. Use Stop sharing to revoke access.';
    return this.queryContext();
  }

  requestConsent() {
    const context = this.queryContext();
    if (!context?.visible) return Promise.resolve(false);
    if (context.approved) return Promise.resolve(true);
    if (this.pendingConsent) return this.pendingConsent.promise;
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    this.pendingConsent = {documentId: context.document_id, promise, resolve};
    this.consentNotice.textContent = sourceProcessingNotice(this.app.stats.nativeStatus,
      this.presentationName ? 'converted-pptx' : this.app.stats.document?.sourceKind);
    this.consent.hidden = false; this.contextChip.setAttribute('aria-expanded', 'true');
    this.allowSharing.focus();
    return promise;
  }

  resolveConsent(allow) {
    const pending = this.pendingConsent;
    if (!pending) return;
    const context = this.queryContext();
    const approved = allow === true && context?.visible && context.document_id === pending.documentId;
    this.pendingConsent = null; this.consent.hidden = true;
    if (approved) this.consentDocumentId = context.document_id;
    this.updateContext(); this.contextChip.focus(); pending.resolve(Boolean(approved));
  }

  updateContext() {
    if (!this.contextChip) return;
    const context = this.queryContext();
    this.app.stats.document.sharingAllowed = Boolean(context?.approved);
    this.app.stats.document.sharedWithConversation = Boolean(context && this.approved && this.app.native.active &&
      this.sharedSession === this.app.native.serial && this.app.native.sharedDocument?.id === context.document_id);
    this.contextChip.disabled = !context || context.approved;
    this.contextChip.setAttribute('aria-expanded', String(Boolean(this.pendingConsent)));
    this.selectArea.disabled = !context?.visible;
    this.stopSharing.hidden = !context?.approved;
    if (!context) {
      this.contextChip.textContent = this.rendering ? 'Changing page…' : 'No page selected'; this.contextScope.textContent = ''; return;
    }
    const full = context.region.every((value, index) => value === [0, 0, 1, 1][index]);
    const shared = this.approved && this.app.native.active && this.sharedSession === this.app.native.serial
      && this.app.native.sharedDocument?.id === context.document_id;
    const permission = shared ? 'shared' : context.approved ? 'sharing allowed' : 'not shared';
    this.contextChip.textContent = `p.${context.page} · ${full ? 'full page' : 'selected area'} · ${permission}`;
    this.contextChip.dataset.sharing = shared ? 'shared' : context.approved ? 'allowed' : 'local';
    this.contextChip.title = shared ? 'This page is shared with the current conversation. Stop sharing revokes access.'
      : context.approved ? 'You allowed sharing this document, but it is not attached to a current conversation. No inspection is implied.'
      : 'This page is local. Allow sharing before Einstein can inspect it.';
    const percent = value => Number((value * 100).toFixed(2));
    const [x, y, w, h] = context.region;
    const area = full ? '' : `${percent(x)}–${percent(x + w)}% across, ${percent(y)}–${percent(y + h)}% down. `;
    this.contextScope.textContent = area + (context.approved ? 'Einstein can inspect what you show when you ask.' : 'Only you can see this. Select the chip to allow sharing.');
  }

  beginSelection() {
    const context = this.queryContext();
    if (!context?.visible) return;
    const w = Math.min(1, Math.max(.8, .025 / context.region[2])), h = Math.min(1, Math.max(.8, .025 / context.region[3]));
    this.selection = {serial: this.serial, page: context.page, source: context.region, box: [(1 - w) / 2, (1 - h) / 2, w, h]};
    this.surface.dataset.selecting = 'true'; this.surface.tabIndex = 0;
    this.selectArea.textContent = 'Cancel selection'; this.selectArea.setAttribute('aria-pressed', 'true');
    this.message.textContent = 'Drag a box. Keyboard: arrows move; Shift + arrows resize; Enter selects; Escape cancels.';
    this.contextScope.textContent = this.message.textContent;
    this.paintSelection(); this.surface.focus();
  }

  paintSelection() {
    const box = this.selection?.box;
    this.selectionBox.hidden = !box;
    if (box) for (const [index, name] of ['left', 'top', 'width', 'height'].entries()) this.selectionBox.style[name] = `${box[index] * 100}%`;
  }

  cancelSelection() {
    if (!this.selection) return;
    if (this.surface.hasPointerCapture?.(this.selection.pointerId)) this.surface.releasePointerCapture(this.selection.pointerId);
    this.selection = null;
    delete this.surface.dataset.selecting; this.surface.removeAttribute('tabindex');
    this.selectionBox.hidden = true; this.selectArea.textContent = 'Select area'; this.selectArea.setAttribute('aria-pressed', 'false');
    this.message.textContent = 'Selection cancelled. Current view unchanged.';
    this.updateContext();
  }

  selectionPointer(event, phase) {
    const selection = this.selection;
    if (!selection || phase === 'start' && event.button !== 0) return;
    const bounds = this.surface.getBoundingClientRect();
    if (!bounds.width || !bounds.height || phase === 'start' && selection.pointerId !== undefined) return;
    const point = [Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height))];
    if (phase === 'start') {
      event.preventDefault(); selection.pointerId = event.pointerId; selection.start = point;
      this.surface.setPointerCapture(event.pointerId);
    }
    if (selection.pointerId !== event.pointerId || !selection.start) return;
    const [x, y] = selection.start;
    selection.box = [Math.min(x, point[0]), Math.min(y, point[1]), Math.abs(x - point[0]), Math.abs(y - point[1])];
    this.paintSelection();
    if (phase === 'end') { this.surface.releasePointerCapture(event.pointerId); void this.commitSelection(); }
  }

  selectionKey(event) {
    if (!this.selection) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.cancelSelection(); return; }
    if (event.key === 'Enter') { event.preventDefault(); void this.commitSelection(); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const box = this.selection.box, horizontal = ['ArrowLeft', 'ArrowRight'].includes(event.key), axis = horizontal ? 0 : 1;
    const change = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -.02 : .02;
    if (event.shiftKey) box[axis + 2] = Math.max(.025 / this.selection.source[axis + 2], Math.min(1 - box[axis], box[axis + 2] + change));
    else box[axis] = Math.max(0, Math.min(1 - box[axis + 2], box[axis] + change));
    this.paintSelection();
  }

  async commitSelection() {
    const selection = this.selection;
    if (!selection) return;
    const [x, y, w, h] = selection.source, [left, top, width, height] = selection.box;
    const region = [x + left * w, y + top * h, width * w, height * h];
    this.cancelSelection();
    if (selection.serial !== this.serial || selection.page !== this.pdf?.pageNumber
        || selection.source.some((value, index) => value !== this.region[index])) return;
    if (region[2] < .025 || region[3] < .025) { this.message.textContent = 'Select a larger area, or use Full page.'; return; }
    await this.navigateByVisitor(selection.page, region);
  }

  fitDisplay() {
    if (!this.base.width || !this.base.height || this.panel.hidden) return;
    const availableWidth = Math.max(120, this.scroll.clientWidth - 32);
    const teaching = this.panel.dataset.teaching === 'source';
    const sideNotes = teaching && innerWidth > 900;
    const roomWidth = Math.max(120, availableWidth - (sideNotes ? 180 : 0));
    const roomHeight = Math.max(100, this.scroll.clientHeight - 32 - (teaching && !sideNotes ? this.notes.clientHeight + 12 : 0));
    const fit = Math.min(roomWidth, roomHeight * this.base.width / this.base.height);
    const width = teaching ? Math.min(roomWidth, Math.max(availableWidth * .64, fit)) : fit;
    this.surface.style.width = `${Math.max(80, width * Number(this.zoom.value))}px`;
  }

  updateProcessingNotice() {
    this.sharingSummary.textContent = `Discussing shares requested pages with ${processingProvider(this.app.stats.nativeStatus)}.`;
    this.privacy.textContent = sourceProcessingNotice(this.app.stats.nativeStatus,
      this.presentationName ? 'converted-pptx' : this.app.stats.document?.sourceKind);
  }

  paint() {
    const source = this.pdf?.canvas;
    if (!source) return;
    const [x, y, w, h] = this.region;
    const previous = this.paintedCrop;
    if (!previous || previous.source !== source || previous.width !== source.width || previous.height !== source.height
        || previous.region.some((value, index) => value !== this.region[index])) {
      // Original page canvases are immutable. Preserve their crop while marks
      // change: repeated resampling after GPU/CPU readback fallback changes pixels.
      const base = this.base.cloneNode(false);
      base.width = Math.max(1, Math.round(source.width * w)); base.height = Math.max(1, Math.round(source.height * h));
      const context = base.getContext('2d', {alpha: false});
      context.fillStyle = '#fff'; context.fillRect(0, 0, base.width, base.height);
      context.drawImage(source, x * source.width, y * source.height, source.width * w, source.height * h, 0, 0, base.width, base.height);
      this.base.replaceWith(base); this.base = base;
      this.overlay.width = base.width; this.overlay.height = base.height;
      this.paintedCrop = {source, width: source.width, height: source.height, region: [x, y, w, h]};
    }
    this.paintAnnotations();
    this.fitDisplay();
    this.updateContext();
  }

  paintAnnotations() {
    if (!this.pdf?.canvas) return;
    const [x, y, w, h] = this.region;
    const c = this.overlay.getContext('2d'); c.clearRect(0, 0, this.overlay.width, this.overlay.height);
    const marks = this.marks.get(this.pdf.pageNumber) || [];
    for (const [index, mark] of marks.entries()) {
      const [left, top, width, height] = mark.region;
      const rx = (left - x) / w * this.overlay.width, ry = (top - y) / h * this.overlay.height;
      const rw = width / w * this.overlay.width, rh = height / h * this.overlay.height;
      const stroke = Math.max(2, this.overlay.width / 400);
      c.strokeStyle = '#b2481e'; c.fillStyle = 'rgba(227,149,57,.12)'; c.lineWidth = stroke;
      const active = this.ink?.pending?.step;
      const teaching = this.panel.dataset.teaching === 'source';
      const isCurrent = teaching && index === active?.index;
      c.globalAlpha = teaching ? (isCurrent ? .2 : .48) : 1;
      c.beginPath();
      if (mark.kind === 'ellipse') c.ellipse(rx + rw / 2, ry + rh / 2, rw / 2, rh / 2, 0, 0, Math.PI * 2);
      else if (mark.kind === 'arrow') { c.moveTo(rx, ry); c.lineTo(rx + rw, ry + rh); }
      else c.rect(rx, ry, rw, rh);
      if (mark.kind !== 'arrow') c.fill(); c.stroke();
      if (isCurrent && active.progress > 0) {
        // Ink the perimeter in source coordinates; the faint whole outline
        // has already been rendered and acknowledged before speech injection.
        c.globalAlpha = 1; c.strokeStyle = '#a54b25'; c.lineWidth = stroke * 1.4;
        const perimeter = mark.kind === 'ellipse' ? Math.PI * Math.hypot(rw, rh) : 2 * (rw + rh);
        c.setLineDash([Math.max(.01, perimeter * active.progress), perimeter]); c.stroke(); c.setLineDash([]);
      }
      c.globalAlpha = teaching && !isCurrent ? .58 : 1;
      if (mark.kind === 'arrow') {
        const angle = Math.atan2(rh, rw), length = stroke * 5;
        c.beginPath(); c.moveTo(rx + rw, ry + rh); c.lineTo(rx + rw - length * Math.cos(angle - .5), ry + rh - length * Math.sin(angle - .5));
        c.moveTo(rx + rw, ry + rh); c.lineTo(rx + rw - length * Math.cos(angle + .5), ry + rh - length * Math.sin(angle + .5)); c.stroke();
      }
      c.globalAlpha = 1;
      if (mark.label && !teaching) {
        c.font = `${Math.max(13, this.overlay.width / 70)}px system-ui`; c.textBaseline = 'top';
        const labelY = Math.max(2, ry - this.overlay.width / 45), labelX = Math.max(2, rx);
        c.fillStyle = 'rgba(255,252,239,.96)'; c.fillRect(labelX - 3, labelY - 2, Math.min(c.measureText(mark.label).width + 8, this.overlay.width - labelX), this.overlay.width / 40);
        c.fillStyle = '#873b1c'; c.fillText(mark.label, labelX, labelY, Math.max(1, this.overlay.width - labelX - 5));
      }
    }
    const teaching = this.panel.dataset.teaching === 'source';
    this.notes.hidden = !teaching;
    if (teaching) {
      const labels = JSON.stringify(marks.map(mark => mark.label));
      if (this.notes.dataset.labels !== labels) {
        this.notes.replaceChildren(...marks.map(mark => el('li', {}, mark.label || 'Source detail')));
        this.notes.dataset.labels = labels;
      }
      for (const [index, note] of [...this.notes.children].entries()) {
        note.dataset.phase = this.ink.steps[index]?.phase || 'ghost';
        note.setAttribute('aria-current', String(index === this.ink.pending?.step.index));
      }
    }
    this.caption.textContent = this.presentationName
      ? `Converted slide ${this.pdf.pageNumber} of ${this.pdf.manifest.pages} · LibreOffice render; fonts/effects may differ. ${marks.length ? 'Colored marks are explanatory overlays.' : ''}`
      : `Page ${this.pdf.pageNumber} of ${this.pdf.manifest.pages} · ${marks.length ? 'Colored marks are Einstein’s explanatory overlay; source unchanged.' : 'Original source pixels, not a generated reconstruction.'}`;
    this.app.stats.document.markCount = marks.length;
  }

  async discuss() {
    if (!this.pdf?.manifest || this.share.disabled) return;
    const identity = this.pdf.manifest.id;
    this.share.disabled = true;
    try {
      if (!await this.requestConsent() || this.pdf?.manifest?.id !== identity) return;
      this.message.textContent = 'Sharing allowed. Ask about this page; choose a written or spoken answer.';
      this.app.composeQuestion();
    } catch (error) { this.message.textContent = error.message; }
    finally { this.share.disabled = !this.pdf?.manifest; }
  }

  async apply(action, valid) {
    if (!this.approved || !this.app.native.active || this.sharedSession !== this.app.native.serial || !this.pdf?.manifest || action.document_id !== this.pdf.manifest.id || !valid()) throw new Error('This document is not shared with the current conversation.');
    const result = {action_id: action.action_id, document_id: action.document_id, revision: action.revision, ok: true};
    if (action.kind === 'read') {
      const current = this.queryContext();
      const sameView = current?.visible && current.page === action.page && Array.isArray(action.region) && action.region.length === 4
        && current.region.every((value, index) => value === action.region[index]);
      // The approved page is already painted. Re-rendering it adds PDF parsing,
      // resampling and two animation frames before the model can inspect it.
      const packet = sameView ? await this.approvedPageInput() : await this.navigate(action.page, action.region, valid);
      if (!valid()) throw new Error('Document action interrupted.');
      if (!packet) throw new Error('The source page could not be rendered.');
      this.app.stats.document.lastInspectedPage = action.page;
      this.sharedViewKey = JSON.stringify([action.document_id, action.page, packet.region]);
      return {...result, page: action.page, region: packet.region, text: packet.text, image: packet.image};
    }
    if (action.kind === 'mark') {
      this.cancelSelection();
      if (this.pdf.pageNumber !== action.page) await this.navigate(action.page, [0, 0, 1, 1], valid);
      if (!valid()) throw new Error('Document action interrupted.');
      const oldRegion = [...this.region];
      this.panel.hidden = false; document.body.classList.add('paper-visible');
      if (action.view_region) {
        const {checkedRegion} = await import('./local-pdf.js'); this.region = checkedRegion(action.view_region);
      }
      const previous = this.marks.get(action.page) || [];
      const next = action.replace ? action.marks : [...previous, ...action.marks];
      if (next.length > 12) throw new Error('The per-page annotation budget is twelve marks.');
      if (action.teaching) {
        this.panel.dataset.teaching = 'source';
        if (this.ink.steps[0]?.sequenceId !== action.teaching.sequence_id) this.zoom.value = '1';
        this.message.textContent = '';
        this.ink.begin(action.teaching, this.region, valid);
      } else { delete this.panel.dataset.teaching; this.ink.clear(); }
      const pdf = this.pdf, serial = this.serial;
      const annotationRevision = this.annotationRevision = (this.annotationRevision || 0) + 1;
      const ownsRender = () => this.pdf === pdf && this.serial === serial && this.annotationRevision === annotationRevision;
      this.marks.set(action.page, next); this.paint();
      await nextFrame(); if (!valid()) {
        // A cancelled render may undo only its own unacknowledged overlay.
        // Visitor navigation, a new mark or a replacement file owns newer state.
        if (ownsRender()) { this.ink.cancel(); this.region = oldRegion; this.marks.set(action.page, previous); this.paint(); }
        throw new Error('Document action interrupted.');
      }
      if (action.teaching) this.ink.rendered();
      this.pointAt(action.marks.at(-1).region);
      this.sharedViewKey = JSON.stringify([action.document_id, action.page, this.region]);
      return {...result, page: action.page, region: [...this.region], mark_count: action.marks.length};
    }
    if (action.kind === 'hide') {
      this.sharedViewKey = null;
      this.panel.hidden = true; document.body.classList.remove('paper-visible');
      clearPresentationFocus(this.app.stage, this);
      await nextFrame(); if (!valid()) throw new Error('Document action interrupted.');
      return result;
    }
    throw new Error('Unsupported document action.');
  }

  pointAt(region) {
    // Orient toward the displayed document; no eye or physical contact claim.
    const stage = this.app.stage;
    const [x, y, w, h] = region;
    stage.actor.updateWorldMatrix(true, false);
    const target = stage.actor.localToWorld(new THREE.Vector3(.8 + (x + w / 2) * .8, 1.9 - (y + h / 2) * 1.1, -.2));
    setPresentationFocus(stage, target, this);
  }

  showOriginal() {
    if (!this.pdf) return;
    this.annotationRevision = (this.annotationRevision || 0) + 1;
    this.ink.cancel(); delete this.panel.dataset.teaching;
    this.marks.delete(this.pdf.pageNumber); this.paint();
  }

  revoke() {
    this.resolveConsent(false); this.cancelSelection(); this.consentDocumentId = null;
    if (this.pdf) this.pdf.snapshotCache = null;
    this.sharedViewKey = null;
    this.approved = false; this.sharedSession = null; this.ink.cancel();
    this.app.stats.document.approved = false;
    this.panel.classList.remove('paper-shared'); delete this.panel.dataset.teaching;
    this.share.disabled = !this.pdf?.manifest;
    this.share.textContent = 'Discuss this PDF with Einstein';
    if (this.pdf?.manifest) { this.message.textContent = 'Original page ready. Not shared with the conversation.'; this.paint(); }
    clearPresentationFocus(this.app.stage, this);
    this.updateContext();
  }

  async close() {
    this.resolveConsent(false); this.cancelSelection(); this.consentDocumentId = null; this.rendering = null;
    this.sharedViewKey = null;
    this.serial++;
    this.paintedCrop = null;
    this.ink?.clear(); delete this.panel.dataset.teaching; this.panel.classList.remove('paper-shared');
    const previous = this.pdf; this.pdf = null;
    if (this.approved) this.app.native.revokeDocument?.();
    this.approved = false; this.sharedSession = null; this.marks.clear();
    this.panel.hidden = true; document.body.classList.remove('paper-visible');
    clearPresentationFocus(this.app.stage, this);
    this.app.stats.document = {selected: false, approved: false};
    this.base.width = this.base.height = this.overlay.width = this.overlay.height = 1;
    if (previous) await previous.close();
    this.updateContext();
  }
}
