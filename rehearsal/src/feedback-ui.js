const dialog = document.querySelector('#feedback-dialog');
const form = document.querySelector('#feedback-form');
const result = document.querySelector('#feedback-result');
const submit = document.querySelector('#feedback-send');
const hosted = document.createElement('section');
hosted.hidden = true;
hosted.setAttribute('aria-label', 'Private feedback collection');
dialog.append(hosted);
let permit = null;
let pending = null;
let busy = false;

async function openFeedback() {
  if (!dialog.open) dialog.showModal();
  if (pending || permit) return;
  submit.disabled = true;
  result.textContent = 'Opening the private feedback form…';
  try {
    const health = await fetch('/api/health', {cache: 'no-store'});
    if (!health.ok) throw new Error('Feedback is temporarily unavailable. Please try again shortly.');
    const capabilities = await health.json();
    if (capabilities.public_deployment && !capabilities.feedback_inline) {
      form.hidden = true;
      dialog.querySelector('.privacy-note').hidden = true;
      hosted.hidden = false;
      const description = document.createElement('p');
      description.className = 'privacy-note';
      hosted.replaceChildren(description);
      if (capabilities.feedback_url !== 'https://einstein-mobiliar-lab.netlify.app/') {
        description.textContent = 'Private feedback collection is temporarily unavailable. Please try again later.';
        return;
      }
      description.textContent = 'The private form opens in a new tab and includes a human check. Your conversation stays here; no transcript or recording is attached.';
      const link = document.createElement('a');
      link.href = capabilities.feedback_url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'send-button';
      link.style.cssText = 'box-sizing:border-box;text-decoration:none';
      link.textContent = 'Open private feedback form ↗';
      hosted.append(link);
      return;
    }
    form.hidden = false;
    hosted.hidden = true;
    dialog.querySelector('.privacy-note').hidden = false;
    const response = await fetch('/api/feedback/permit', {cache: 'no-store'});
    if (!response.ok) throw new Error('Feedback is temporarily unavailable. Your conversation is unaffected.');
    const body = await response.json();
    permit = body.permit;
    result.textContent = '';
  } catch (error) { result.textContent = error.message; }
  finally { submit.disabled = !permit; }
}

document.querySelector('#feedback-toggle').addEventListener('click', openFeedback);
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || (!permit && !pending)) return;
  busy = true; submit.disabled = true;
  // Preserve the same request after a network failure: never create duplicate feedback.
  if (!pending) {
    const data = new FormData(form);
    const optional = name => data.get(name) ? Number(data.get(name)) : null;
    pending = {request_id: crypto.randomUUID(), permit, rating: Number(data.get('rating')),
      realism: optional('realism'), voice: optional('voice'), kind: data.get('kind'),
      message: data.get('message') || '', context: data.get('context') || '', website: data.get('website') || ''};
  }
  result.textContent = 'Saving your feedback…';
  try {
    const response = await fetch('/api/feedback', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(pending)});
    const body = await response.json();
    if (!response.ok || !body.received || body.id !== pending.request_id) throw new Error(body.detail || 'Feedback was not confirmed. Retry preserves the same submission.');
    result.textContent = 'Your feedback was saved privately. Thank you.';
    result.dataset.receipt = body.id;
    pending = null; permit = null; form.reset();
  } catch (error) { result.textContent = error.message; }
  finally { busy = false; submit.disabled = !pending && !permit; }
});
