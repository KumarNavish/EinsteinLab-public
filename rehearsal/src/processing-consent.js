export function processingProvider(status = {}) {
  status ||= {};
  if (/openai/i.test(status.provider || '')) return 'OpenAI';
  if (/google/i.test(status.provider || '') || /^gemini/i.test(status.model || '')) return 'Google';
  return 'the configured AI provider';
}

export function processingNotice(status = {}) {
  status ||= {};
  if (status.privacy) return status.privacy;
  const provider = processingProvider(status);
  const policy = provider === 'Google'
    ? 'Google’s free tier may use shared content to improve its products.'
    : 'The provider’s API processing terms apply.';
  return `Your voice, questions, and pages or frames you choose to share are processed by ${provider}. ${policy} Share only material you are allowed to send. Einstein’s server does not save microphone audio or conversation transcripts.`;
}

export function sourceProcessingNotice(status = {}, kind = 'pdf') {
  status ||= {};
  const provider = processingProvider(status);
  const policy = status.privacy || (provider === 'Google' ? 'Google’s free tier may use shared content to improve its products.' : 'The provider’s API processing terms apply.');
  const source = kind === 'video' ? 'Opening is local. Discussing shares requested frames; the video file and its audio remain in this browser.'
    : kind === 'converted-pptx' ? 'This deck was uploaded for temporary server conversion and returned as PDF. Temporary conversion files were deleted. Discussing shares requested slide images and text.'
    : `${kind === 'retrieved-public-pdf' ? 'This public PDF was retrieved by the Einstein server at your request. ' : ''}Opening is local. Discussing shares requested page images and text; the full PDF remains in this browser.`;
  return `${source} Shared content is processed by ${provider} during this conversation. ${policy} Share only material you are allowed to send.`;
}

export function configuredVoices(status = {}) {
  status ||= {};
  return Object.entries(status.voices || {}).map(([id, value]) => ({id, label: value?.label || id}));
}

export function configuredVoice(status, preferred) {
  const choices = configuredVoices(status);
  return [preferred, status?.default_voice, choices[0]?.id].find(id => choices.some(choice => choice.id === id)) || '';
}

export const VOICE_PERSONA_VERSION = 'elder-german-v2';

// Replace the previous default once; keep choices made after this release.
export function initialVoicePreferences(status, saved = {}) {
  const target = status?.default_voice;
  const version = `${VOICE_PERSONA_VERSION}:${target || ''}`;
  const migrate = processingProvider(status) === 'OpenAI' && (target === 'flitz' || /^voice_[A-Za-z0-9_-]+$/.test(target || '')) &&
    configuredVoices(status).some(choice => choice.id === target) && saved.version !== version;
  return {voice: configuredVoice(status, migrate ? target : saved.voice),
    accent: !migrate && ['german', 'original'].includes(saved.accent) ? saved.accent : 'german',
    migrate, version};
}

/** Approval is scoped to the displayed provider, model and policy. */
export function processingConsent(getStatus = () => ({})) {
  let approved = null;
  let pending = null;
  const dialog = document.createElement('dialog');
  dialog.className = 'sheet settings-sheet';
  dialog.setAttribute('aria-labelledby', 'processing-heading');
  const heading = document.createElement('h2'); heading.id = 'processing-heading'; heading.textContent = 'Before we begin';
  const notice = document.createElement('p'); notice.className = 'plain-note';
  const accept = document.createElement('button'); accept.className = 'primary-button'; accept.textContent = 'Agree and begin';
  const cancel = document.createElement('button'); cancel.className = 'text-button'; cancel.textContent = 'Not now';
  dialog.append(heading, notice, accept, cancel); document.querySelector('#app').append(dialog);
  accept.onclick = () => dialog.close('approved'); cancel.onclick = () => dialog.close('cancelled');
  return async function approve() {
    const status = getStatus() || {};
    const decision = JSON.stringify([processingProvider(status), status.model, status.privacy]);
    if (approved === decision) return;
    if (!pending) pending = new Promise((resolve, reject) => {
      notice.textContent = processingNotice(status);
      dialog.returnValue = '';
      dialog.addEventListener('close', () => {
        pending = null;
        if (dialog.returnValue === 'approved') { approved = decision; resolve(); }
        else reject(new Error('The conversation has not started. You can begin whenever you are ready.'));
      }, {once: true});
      dialog.showModal();
    });
    await pending;
    if (JSON.stringify([processingProvider(getStatus() || {}), getStatus()?.model, getStatus()?.privacy]) !== approved) return approve();
  };
}
