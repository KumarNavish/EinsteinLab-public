/** Keep the current spoken clause readable; the complete answer stays in history.
 * This is a display window, not a summary, paraphrase, or semantic rewrite.
 */
export function captionWindow(text, maxCharacters = 112) {
  if (typeof text !== 'string') return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  // Keep hesitation in the complete transcript, without leaving a bare
  // placeholder on screen while an evidence tool is still working.
  if (/^(?:m*h+m+|u+m+|uh|er)[.!?,…\s]*$/iu.test(clean)) return '';
  if (!clean || clean.length <= maxCharacters) return clean;
  // Prefer the latest sentence/clause, but retain a useful length rather than
  // flashing a one-word fragment at each punctuation mark.
  const tail = clean.slice(-maxCharacters - 1);
  const boundary = tail.search(/\s/);
  let result = boundary >= 0 ? tail.slice(boundary + 1) : tail.slice(-maxCharacters);
  const stops = [...result.matchAll(/[.!?;:]\s+/g)];
  for (let index = stops.length - 1; index >= 0; index--) {
    const candidate = result.slice(stops[index].index + stops[index][0].length);
    if (candidate.length >= 36) { result = candidate; break; }
  }
  return result.length < clean.length ? '… ' + result : result;
}

export class LiveCaptions {
  constructor(element, stats, limit = 112) {
    this.element = element;
    this.stats = stats;
    this.limit = limit;
    this.fullText = '';
  }
  set(text) {
    this.fullText = typeof text === 'string' ? text : '';
    const visible = captionWindow(this.fullText, this.limit);
    if (this.element.textContent !== visible) this.element.textContent = visible;
    this.stats.captionCharacters = visible.length;
    this.stats.fullCaptionCharacters = this.fullText.length;
    this.stats.captionTruncatedForDisplay = visible !== this.fullText.replace(/\s+/g, ' ').trim();
  }
  clear() { this.set(''); }
}
