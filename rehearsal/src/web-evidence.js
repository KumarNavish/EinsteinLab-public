export function safeEvidenceURL(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host.startsWith('127.') || host === '[::1]') return null;
    return url.href;
  } catch { return null; }
}

/** Provider HTML stays inside a scriptless sandbox, never in the application DOM. */
export function searchSuggestionsDocument(html) {
  const policy = "default-src 'none'; style-src 'unsafe-inline'; img-src https://www.google.com https://www.gstatic.com data:; base-uri 'none'; form-action 'none'";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"></head><body>${String(html).slice(0, 80000)}</body></html>`;
}

export function renderWebGrounding(packet, container) {
  container.replaceChildren();
  const html = packet.search_suggestions_html;
  container.hidden = !html;
  if (!html) return;
  const label = document.createElement('span'); label.className = 'web-research-label'; label.textContent = 'Google Search · supporting sources';
  const frame = document.createElement('iframe');
  frame.title = 'Google Search suggestions for this answer';
  frame.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
  frame.referrerPolicy = 'no-referrer';
  frame.srcdoc = searchSuggestionsDocument(html);
  container.append(label, frame);
}

export function sourceProvenanceLabel(source) {
  if (source.source_kind === 'openai-public-search') return 'OpenAI web search · cited summary, not a verbatim passage';
  if (source.source_kind === 'openai-public-page') return 'OpenAI opened webpage · cited summary, images/layout not verified';
  if (source.source_kind === 'exa-public-search') return 'Exa public search highlights · not a full-page read';
  if (source.source_kind === 'exa-public-page') return 'Exa extracted public page text · images/layout not verified';
  if (source.source_kind === 'google-search-grounding') return 'Google provider-linked claim · not a verbatim quote';
  if (source.source_kind === 'live-official-lab') return 'Official lab webpage read';
  return 'Public lab snapshot';
}
