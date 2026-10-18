import {getDocument, GlobalWorkerOptions} from 'pdfjs-dist';
import workerURL from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerURL;
export const PDF_LIMITS = Object.freeze({bytes: 20 * 1024 * 1024, pages: 200, pixels: 5_000_000, text: 14000});

export function checkedRegion(value = [0, 0, 1, 1]) {
  if (!Array.isArray(value) || value.length !== 4 || value.some(n => typeof n !== 'number' || !Number.isFinite(n))) throw new Error('A page region requires four finite normalized coordinates.');
  const [x, y, width, height] = value;
  if (x < 0 || y < 0 || width < .025 || height < .025 || x + width > 1.000001 || y + height > 1.000001) throw new Error('The requested region is outside the original page.');
  return [...value];
}

export function digestHex(bytes) {
  return crypto.subtle.digest('SHA-256', bytes).then(value => [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, '0')).join(''));
}

/** Only bytes explicitly selected by the visitor are parsed. No remote URL,
 * file-system path, embedded attachment, script, form action or link is executed.
 * The whole document remains in this browser's memory until close().
 */
export class LocalPDF {
  constructor() {
    this.serial = 0;
    this.document = null;
    this.loading = null;
    this.owner = null;
    this.renderTask = null;
    this.page = null;
    this.canvas = null;
    this.manifest = null;
    this.pageNumber = 0;
    this.snapshotCache = null;
  }

  async open(file) {
    await this.close();
    const serial = ++this.serial;
    if (!(file instanceof File) || file.size < 8 || file.size > PDF_LIMITS.bytes) throw new Error('Choose a PDF of at most 20 MB.');
    if (file.type && file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) throw new Error('This viewer currently accepts PDF documents.');
    const buffer = await file.arrayBuffer();
    if (serial !== this.serial) throw new Error('Document selection changed.');
    const bytes = new Uint8Array(buffer);
    const header = new TextDecoder().decode(bytes.slice(0, Math.min(1024, bytes.length)));
    if (!header.includes('%PDF-')) throw new Error('The selected file is not a PDF.');
    const fingerprint = await digestHex(buffer);
    if (serial !== this.serial) throw new Error('Document selection changed.');
    const task = getDocument({data: bytes, isEvalSupported: false, enableXfa: false,
      stopAtErrors: true, useSystemFonts: true, useWorkerFetch: false,
      isImageDecoderSupported: false, maxImageSize: PDF_LIMITS.pixels,
      canvasMaxAreaInBytes: PDF_LIMITS.pixels * 4});
    this.loading = task;
    this.owner = task;
    task.onPassword = () => { void task.destroy(); };
    let document;
    try {
      document = await Promise.race([task.promise, new Promise((_, reject) => {
        this.loadTimeout = setTimeout(() => { void task.destroy(); reject(new Error('PDF loading exceeded thirty seconds.')); }, 30000);
      })]);
      if (serial !== this.serial) { await task.destroy(); throw new Error('Document was closed while loading.'); }
      if (!Number.isInteger(document.numPages) || document.numPages < 1 || document.numPages > PDF_LIMITS.pages) throw new Error('The PDF exceeds the 200-page limit.');
      this.document = document;
      this.manifest = {id: fingerprint, name: file.name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 180) || 'Selected PDF',
        pages: document.numPages, bytes: file.size, kind: 'visitor-selected-pdf',
        scope: 'Original PDF selected in this browser. Not a webpage search, not a synthesized figure.'};
      return {...this.manifest};
    } catch (error) {
      await task.destroy().catch(() => {});
      if (this.owner === task) this.owner = null;
      if (serial === this.serial) { this.document = null; this.manifest = null; }
      throw error;
    } finally {
      clearTimeout(this.loadTimeout);
      if (this.loading === task) this.loading = null;
    }
  }

  async show(pageNumber, {width = 1500} = {}) {
    if (!this.document) throw new Error('No PDF is selected.');
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > this.document.numPages) throw new Error('That page does not exist in the selected PDF.');
    const document = this.document;
    const serial = ++this.serial;
    this.snapshotCache = null;
    const previous = this.renderTask;
    previous?.cancel();
    if (previous) { try { await previous.promise; } catch {} }
    const page = await document.getPage(pageNumber);
    if (serial !== this.serial || this.document !== document) throw new Error('Page selection changed.');
    const unit = page.getViewport({scale: 1});
    const scale = Math.min(Math.max(300, Math.min(1800, width)) / unit.width,
      Math.sqrt(PDF_LIMITS.pixels / (unit.width * unit.height)));
    const viewport = page.getViewport({scale});
    const canvas = document.ownerDocument?.createElement?.('canvas') || globalThis.document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    if (canvas.width * canvas.height > PDF_LIMITS.pixels + 5000) throw new Error('Page dimensions exceed the rendering limit.');
    const context = canvas.getContext('2d', {alpha: false});
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    const render = page.render({canvasContext: context, canvas, viewport, annotationMode: 0});
    this.renderTask = render;
    const timeout = setTimeout(() => render.cancel(), 20000);
    try { await render.promise; }
    catch (error) { canvas.width = canvas.height = 1; throw error; }
    finally { clearTimeout(timeout); if (this.renderTask === render) this.renderTask = null; }
    if (serial !== this.serial || this.document !== document) { canvas.width = canvas.height = 1; throw new Error('Page was superseded.'); }
    const content = await page.getTextContent();
    if (serial !== this.serial) { canvas.width = canvas.height = 1; throw new Error('Page was superseded.'); }
    const items = content.items.filter(item => typeof item.str === 'string');
    let text = '';
    const fragments = [];
    for (const item of items) {
      if (text.length >= PDF_LIMITS.text) break;
      const snippet = item.str.slice(0, PDF_LIMITS.text - text.length);
      text += snippet + (item.hasEOL ? '\n' : ' ');
      if (fragments.length < 1000) {
        const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
        fragments.push({text: snippet, x: x / viewport.width, y: y / viewport.height,
          width: Math.max(0, item.width * scale / viewport.width), height: Math.max(0, item.height * scale / viewport.height)});
      }
    }
    this.canvas && (this.canvas.width = this.canvas.height = 1);
    if (this.page && this.page !== page) this.page.cleanup();
    this.page = page; this.pageNumber = pageNumber; this.canvas = canvas;
    this.text = text.trim(); this.fragments = fragments;
    return {page: pageNumber, width: canvas.width, height: canvas.height, text: this.text,
      text_may_be_truncated: text.length >= PDF_LIMITS.text, fragments, canvas};
  }

  snapshot(region = [0, 0, 1, 1]) {
    if (!this.canvas || !this.manifest) throw new Error('Render a page before inspecting it.');
    const checked = checkedRegion(region);
    const [x, y, w, h] = checked;
    const original = this.canvas;
    const key = JSON.stringify([this.serial, this.manifest, this.pageNumber, original.width, original.height, checked]);
    // One selected view, in this browser's memory only. Reuse its exact encoded
    // bytes rather than resampling the immutable source on each model read.
    if (this.snapshotCache?.canvas === original && this.snapshotCache.document === this.document
        && this.snapshotCache.key === key) return structuredClone(this.snapshotCache.result);
    const sourceWidth = original.width * w, sourceHeight = original.height * h;
    const scale = Math.min(1, 1400 / sourceWidth, 1600 / sourceHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sourceWidth * scale)); canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext('2d', {alpha: false});
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(original, x * original.width, y * original.height, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
    let quality = .82;
    let data = canvas.toDataURL('image/jpeg', quality).split(',')[1];
    while (data.length > 330000 && quality > .4) { quality -= .1; data = canvas.toDataURL('image/jpeg', quality).split(',')[1]; }
    if (data.length > 350000) throw new Error('This page image is too complex for the bounded vision message; select a smaller region.');
    const text = checked.every((v, i) => v === [0, 0, 1, 1][i]) ? this.text : this.fragments
      .filter(item => item.x < x + w && item.x + item.width >= x && item.y >= y && item.y - item.height <= y + h)
      .map(item => item.text).join(' ').slice(0, PDF_LIMITS.text);
    const result = {document: {...this.manifest}, page: this.pageNumber, region: checked,
      text, image: {mime_type: 'image/jpeg', data, width: canvas.width, height: canvas.height},
      scope: 'Raster of the selected original PDF page/region, before any explanatory annotation. Text extraction may omit scanned text and mathematical structure.'};
    canvas.width = canvas.height = 1;
    this.snapshotCache = {canvas: original, document: this.document, key, result};
    return structuredClone(result);
  }

  async close() {
    this.serial++;
    clearTimeout(this.loadTimeout);
    const render = this.renderTask; this.renderTask = null; render?.cancel();
    const loading = this.loading; this.loading = null;
    const owner = this.owner; this.owner = null;
    const document = this.document; this.document = null;
    this.manifest = null; this.pageNumber = 0; this.text = ''; this.fragments = [];
    this.snapshotCache = null;
    this.page = null;
    if (this.canvas) this.canvas.width = this.canvas.height = 1;
    this.canvas = null;
    if (render) { try { await render.promise; } catch {} }
    // PDFDocumentLoadingTask owns worker termination, including after loading.
    // Do not assume the resolved document proxy exposes destroy().
    if (owner) await owner.destroy().catch(() => {});
    else if (loading) await loading.destroy().catch(() => {});
  }
}
