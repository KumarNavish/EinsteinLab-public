/** A PPTX conversion is a separate, explicit upload. The returned PDF then
 * uses the existing page viewer, pixel inspection and annotation workflow. */
export const PRESENTATION_LIMITS = Object.freeze({bytes: 8 * 1024 * 1024, pdfBytes: 20 * 1024 * 1024, slides: 120});
const MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const messages = {
  401: 'Start a visitor session before converting a presentation.',
  403: 'This session cannot convert a presentation. Refresh and try again.',
  408: 'The presentation upload took too long. Please try again.',
  413: 'Choose a PPTX of at most 8 MB.',
  415: 'Choose a PPTX presentation.',
  422: 'This presentation could not be converted safely. HTTPS citation links and simple chart data workbooks are supported. Remove macros, linked content, OLE objects or chart workbook formulas, or export the deck to PDF.',
  429: 'Another presentation is converting. Please try again shortly.',
  503: 'Presentation conversion is unavailable. Export your deck to PDF and open that file.',
};

export async function convertPresentation(file, {fetcher = globalThis.fetch, signal} = {}) {
  if (!(file instanceof File) || !/\.pptx$/i.test(file.name) || file.size < 100 || file.size > PRESENTATION_LIMITS.bytes) {
    throw new Error('Choose a PPTX of at most 8 MB.');
  }
  const response = await fetcher('/api/presentation/convert', {method: 'POST', credentials: 'same-origin',
    headers: {'Content-Type': MIME}, body: file, signal, cache: 'no-store'});
  if (!response.ok) throw new Error(messages[response.status] || 'Presentation conversion failed. Please try again or export the deck to PDF.');
  if (response.headers.get('content-type')?.split(';')[0] !== 'application/pdf') throw new Error('The conversion did not return a PDF.');
  if (Number(response.headers.get('content-length')) > PRESENTATION_LIMITS.pdfBytes) throw new Error('The converted PDF exceeds 20 MB.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The converted PDF could not be read.');
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > PRESENTATION_LIMITS.pdfBytes) throw new Error('The converted PDF exceeds 20 MB.');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  if (bytes < 8) throw new Error('The converted PDF is empty.');
  const name = file.name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\.pptx$/i, '').slice(0, 140) || 'Selected deck';
  return new File(chunks, `${name} · converted slides.pdf`, {type: 'application/pdf'});
}

const node = (tag, attributes = {}, text = '') => {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  element.textContent = text;
  return element;
};

export function attachPresentationUpload(app) {
  const footer = document.querySelector('#material-actions');
  if (!footer || !app.paper) return null;
  const button = node('button', {id: 'presentation-open', type: 'button', class: 'view-control'}, 'Open slides');
  const dialog = node('dialog', {id: 'presentation-upload', class: 'sheet settings-sheet presentation-sheet', 'aria-labelledby': 'presentation-upload-title'});
  const heading = node('div', {class: 'sheet-heading'});
  const title = node('h2', {id: 'presentation-upload-title'}, 'Open a presentation');
  const disclosure = node('p', {class: 'sheet-intro'}, 'Choose a PPTX of up to 8 MB and 120 slides. Convert and open uploads it for temporary conversion, then displays the rendered slides. Temporary files are deleted after conversion.');
  const limits = node('p', {class: 'privacy-note'}, 'LibreOffice renders the slides; fonts, animation and effects may differ. HTTPS citation links and simple chart workbooks are supported. Macros, OLE objects, linked content and workbook formulas are refused. Share only material you are allowed to upload.');
  const input = node('input', {id: 'presentation-file', type: 'file', accept: `.pptx,${MIME}`, 'aria-label': 'Select a PPTX presentation'});
  const submit = node('button', {id: 'presentation-convert', type: 'button', class: 'send-button', disabled: ''}, 'Convert and open');
  const close = node('button', {id: 'presentation-cancel', type: 'button', class: 'secondary-button'}, 'Cancel');
  const status = node('p', {id: 'presentation-status', role: 'status', 'aria-live': 'polite'});
  heading.append(title);
  dialog.append(heading, disclosure, limits, input, status, submit, close);
  footer.append(button); document.body.append(dialog);
  let controller = null;
  let serial = 0;
  const cancel = () => { serial++; controller?.abort(); controller = null; submit.disabled = !input.files?.[0]; input.disabled = false; };
  button.onclick = () => { status.textContent = ''; dialog.showModal(); };
  close.onclick = () => dialog.close();
  dialog.addEventListener('close', cancel);
  input.onchange = () => { cancel(); status.textContent = ''; };
  submit.onclick = async () => {
    const file = input.files?.[0];
    if (!file || controller) return;
    const selected = ++serial;
    const pending = new AbortController(); controller = pending;
    const timeout = setTimeout(() => pending.abort(), 60000);
    submit.disabled = true; input.disabled = true;
    status.textContent = 'Converting the selected presentation. This may take up to forty seconds…';
    try {
      const pdf = await convertPresentation(file, {signal: controller.signal});
      if (selected !== serial) return;
      await app.paper.open(pdf);
      if (selected !== serial || !app.paper.pdf?.manifest) return;
      app.paper.presentationName = file.name;
      app.paper.pdf.manifest.source_format = 'converted-pptx';
      app.paper.pdf.manifest.scope = 'PDF rendering of a visitor-selected PPTX. Converted by LibreOffice; fonts, animation and effects may differ from the source presentation.';
      app.paper.panel.querySelector('.paper-kicker').textContent = 'PRESENTATION · CONVERTED PDF';
      app.paper.updateProcessingNotice();
      app.paper.message.textContent = 'Slides ready. Check the rendering before discussing. Not shared with the conversation.';
      app.stats.document.sourceKind = 'converted-pptx';
      app.paper.paint();
      input.value = ''; dialog.close();
    } catch (error) {
      if (selected === serial) status.textContent = error.name === 'AbortError' ? 'Conversion was cancelled or took too long. You can try again.' : error.message;
    } finally {
      clearTimeout(timeout);
      if (selected === serial) { controller = null; input.disabled = false; submit.disabled = !input.files?.[0]; }
    }
  };
  window.addEventListener('pagehide', cancel);
  return {button, dialog, cancel};
}
