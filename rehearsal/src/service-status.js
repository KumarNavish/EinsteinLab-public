/** A status check never requests a permit, starts audio or contacts a provider. */
class StatusError extends Error {
  constructor(code, httpStatus = null) {
    super(code === 'timeout' ? 'The conversation service took too long to respond.' :
      code === 'http' ? `The conversation service could not be checked (HTTP ${httpStatus}).` :
      code === 'invalid-response' ? 'The conversation service returned an unreadable status.' :
      'The conversation service could not be reached.');
    this.code = code; this.httpStatus = httpStatus;
    this.retryable = ['timeout', 'transport'].includes(code) || [502, 503, 504].includes(httpStatus);
  }
}

async function attempt(fetcher, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new StatusError('timeout')); }, timeoutMs);
  });
  const request = (async () => {
    let response;
    try {
      response = await fetcher('/api/native/status', {method: 'GET', credentials: 'same-origin',
        cache: 'no-store', redirect: 'error', signal: controller.signal});
    } catch { throw new StatusError(controller.signal.aborted ? 'timeout' : 'transport'); }
    if (!response.ok) throw new StatusError('http', response.status);
    let status;
    try { status = await response.json(); }
    catch (error) { throw new StatusError(controller.signal.aborted ? 'timeout' : error instanceof TypeError ? 'transport' : 'invalid-response'); }
    if (!status || typeof status !== 'object' || Array.isArray(status) || typeof status.available !== 'boolean') {
      throw new StatusError('invalid-response');
    }
    return status;
  })();
  try { return await Promise.race([request, deadline]); }
  finally { clearTimeout(timer); }
}

export function createStatusLoader({fetcher = globalThis.fetch, timeoutMs = 9000, retryDelayMs = 1000,
  onAttempt = () => {}} = {}) {
  let pending = null;
  return function loadStatus() {
    if (!pending) pending = (async () => {
      for (let index = 1; index <= 2; index++) {
        onAttempt(index);
        try { return await attempt(fetcher, timeoutMs); }
        catch (error) {
          if (!error.retryable || index === 2) throw error;
          await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        }
      }
    })().finally(() => { pending = null; });
    return pending;
  };
}
