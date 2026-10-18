/** Explicit retrieval of an accessible public PDF; actual pages use LocalPDF. */
const LIMIT = 20 * 1024 * 1024;
const unavailable = 'This link could not be opened. Use a direct, accessible HTTPS PDF link, or download the paper yourself and open that local PDF. Login pages and paywalls are not supported.';

export async function retrievePaper(url, {fetcher = globalThis.fetch, signal} = {}) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('Enter a direct public HTTPS PDF link.'); }
  if (typeof url !== 'string' || url.length > 2048 || parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) throw new Error('Enter a direct public HTTPS PDF link.');
  const response = await fetcher('/api/paper/retrieve', {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({url}), signal, cache: 'no-store'});
  if (!response.ok) throw new Error(response.status === 429 ? 'Paper retrieval is busy. Please try again shortly.' : response.status === 413 ? 'The public PDF exceeds 20 MB.' : unavailable);
  if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/pdf' || Number(response.headers.get('content-length')) > LIMIT) throw new Error(unavailable);
  const reader = response.body?.getReader();
  if (!reader) throw new Error(unavailable);
  const chunks = []; let size = 0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > LIMIT) throw new Error('The public PDF exceeds 20 MB.');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const file = new File(chunks, 'public-paper.pdf', {type: 'application/pdf'});
  if (file.size < 8 || await file.slice(0, 5).text() !== '%PDF-') throw new Error(unavailable);
  const fingerprint = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(value => value.toString(16).padStart(2, '0')).join('');
  let source = url;
  try {
    const final = new URL(response.headers.get('x-paper-source-url') || url);
    if (final.protocol === 'https:' && !final.username && !final.password && (!final.port || final.port === '443')) source = final.href;
  } catch { /* Use the validated visitor URL if the optional attribution is absent. */ }
  return {file, source, fingerprint};
}

const node = (tag, attributes = {}, text = '') => {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  element.textContent = text;
  return element;
};

export function attachPaperRetrieval(app) {
  const footer = document.querySelector('#material-actions');
  if (!footer || !app.paper) return null;
  const button = node('button', {id: 'paper-link-open', type: 'button', class: 'view-control'}, 'Open paper link');
  const dialog = node('dialog', {id: 'paper-link-dialog', class: 'sheet settings-sheet', 'aria-labelledby': 'paper-link-title'});
  const heading = node('div', {class: 'sheet-heading'});
  const close = node('button', {type: 'button', class: 'icon-button', 'aria-label': 'Close paper link'}, '×');
  heading.append(node('h2', {id: 'paper-link-title'}, 'Open a public paper'), close);
  const explanation = node('p', {class: 'privacy-note'}, 'Paste a direct HTTPS PDF link of up to 20 MB. Retrieve and open asks the Einstein server to fetch that public file, then displays its original pages here. Login pages, paywalls and website-to-PDF conversion are not supported. Discussing the paper requires separate approval.');
  const form = node('form');
  const label = node('label', {for: 'paper-link-url'}, 'Public PDF URL');
  const input = node('input', {id: 'paper-link-url', type: 'url', required: '', maxlength: '2048', placeholder: 'https://…/paper.pdf', autocomplete: 'off'});
  input.style.cssText = 'width:100%;margin:12px 0;padding:12px;border:1px solid #b8c0b3;border-radius:6px;background:#fff;color:#26352b;font:inherit;box-sizing:border-box';
  const status = node('p', {id: 'paper-link-status', role: 'status', 'aria-live': 'polite'});
  const submit = node('button', {id: 'paper-link-retrieve', type: 'submit', class: 'secondary-button'}, 'Retrieve and open');
  form.append(label, input, status, submit); dialog.append(heading, explanation, form);
  const localButton = footer.querySelector('#paper-open');
  if (localButton) localButton.after(button); else footer.append(button);
  document.body.append(dialog);
  let serial = 0, controller = null;
  const cancel = () => { serial++; controller?.abort(); controller = null; input.disabled = false; submit.disabled = false; };
  button.onclick = () => { status.textContent = ''; dialog.showModal(); input.focus(); };
  close.onclick = () => dialog.close();
  dialog.addEventListener('close', cancel);
  form.onsubmit = async event => {
    event.preventDefault();
    if (controller) return;
    const current = ++serial, documentSerial = app.paper.serial;
    const pending = new AbortController(); controller = pending;
    const timeout = setTimeout(() => pending.abort(), 17000);
    input.disabled = true; submit.disabled = true; status.textContent = 'Retrieving the original public PDF…';
    try {
      const {file, source, fingerprint} = await retrievePaper(input.value.trim(), {signal: pending.signal});
      if (current !== serial) return;
      if (documentSerial !== app.paper.serial) throw new Error('Another document was selected while this link was loading. Try this link again to replace it.');
      // Retrieval is complete; closing the dialog cancels no document rendering.
      input.value = ''; dialog.close();
      await app.paper.open(file);
      if (app.paper.pdf?.manifest?.id !== fingerprint) return;
      app.paper.panel.querySelector('.paper-kicker').textContent = 'PUBLIC PAPER · ORIGINAL PDF';
      app.stats.document.sourceKind = 'retrieved-public-pdf';
      app.paper.updateProcessingNotice();
      const link = node('a', {href: source, target: '_blank', rel: 'noopener noreferrer'}, 'Original public source');
      app.paper.message.replaceChildren('Original pages ready. ', link, '. Not shared with the conversation.');
    } catch (error) {
      if (current === serial) status.textContent = error.name === 'AbortError' ? 'Retrieval was cancelled or took too long. Try again or open a local PDF.' : error.message;
    } finally {
      clearTimeout(timeout);
      if (current === serial) { controller = null; input.disabled = false; submit.disabled = false; }
    }
  };
  window.addEventListener('pagehide', cancel);
  return {button, dialog, cancel};
}
