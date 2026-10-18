/** An optional public-source read, never a provider/session request. */
class FactAccessError extends Error {}

export function contextualLabQuestion(question, previous) {
  if (!previous) return question;
  const label = '\nPrevious question answered from the public lab website (context only): ';
  const context = previous.slice(0, Math.max(0, Math.min(200, 1000 - question.length - label.length)));
  return context ? question + label + context : question;
}

export async function quickLabFact(question, {fetcher = globalThis.fetch, timeoutMs = 1200} = {}) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise(resolve => {
    timer = setTimeout(() => { controller.abort(); resolve(null); }, timeoutMs);
  });
  const request = (async () => {
    try {
      const response = await fetcher('/api/lab/answer', {method: 'POST', credentials: 'same-origin',
        cache: 'no-store', redirect: 'error', signal: controller.signal,
        headers: {'Content-Type': 'application/json'}, body: JSON.stringify({question})});
      if (response.status === 403) throw new FactAccessError('Website facts require a request from this site.');
      if (!response.ok) return null;
      const fact = await response.json();
      return fact?.status === 'source-fact' && typeof fact.answer === 'string' && fact.answer.trim()
        && Array.isArray(fact.sources) && fact.sources.length && fact.sources.every(source =>
          typeof source.url === 'string' && typeof source.fetched_at === 'string') ? fact : null;
    } catch (error) {
      if (error instanceof FactAccessError) throw error;
      return null;
    }
  })();
  try { return await Promise.race([request, deadline]); }
  finally { clearTimeout(timer); }
}
