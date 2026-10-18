import './style.css';
import './teaching-sequence.css';
import {LiveCaptions, spokenWords} from './live-captions.js';
import {EinsteinStage} from './scene.js';
import {SpatialBoard} from './spatial-board.js';
import {clearPresentationFocus} from './embodied-attention.js';
import {PaperWorkspace} from './paper-workspace.js';
import {VideoWorkspace} from './video-workspace.js';
import {attachPresentationUpload} from './presentation-upload.js';
import {attachPaperRetrieval} from './paper-retrieval.js';
import {processingConsent, processingProvider, configuredVoices, configuredVoice, initialVoicePreferences} from './processing-consent.js';
import {TurnGate, base64FromBlob} from './session.js';
import {SpeechPlayer} from './speech-player.js';
import {HandsFreeInput} from './voice-input.js';
import {NativeConversation, stopWhenHidden} from './native-audio.js';
import {safeEvidenceURL, renderWebGrounding, sourceProvenanceLabel} from './web-evidence.js';
import {createStatusLoader} from './service-status.js';
import {quickLabFact, contextualLabQuestion} from './quick-lab-fact.js';

const $ = selector => document.querySelector(selector);
const gate = new TurnGate();
const dialogs = [...document.querySelectorAll('dialog')];
function closeDialogs() { for (const dialog of dialogs) if (dialog.open) dialog.close(); }
function showDialog(selector) { closeDialogs(); const dialog = $(selector); dialog.showModal(); }
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => button.closest('dialog').close());
for (const dialog of dialogs) dialog.addEventListener('click', event => { if (event.target === dialog) { const box = dialog.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close(); } });
const sessionId = crypto.randomUUID();
const stats = {avatarReady: false, lastTurn: null, audioPlaying: false, state: 'ready', frame: null,
  microphoneActive: false, detectedUtterances: 0, receivedSegments: 0, mouthCueCount: 0, interruptions: 0};
let activeRequest = null;
let capabilities = null;
let recordingSpeech = false;
let inFlight = false;
let stage;
let native;
let nativeStatus = null;
let publicDeployment = false;
let statusErrorMessage = '';
const loadNativeStatus = createStatusLoader({onAttempt: attempt => {
  stats.nativeStatusCheck = {phase: 'checking', attempt};
}});
let nativeQuestion = "";
let nativeAnswer = "";
let nativeSources = [];
let nativeEvidenceHistory = [];
let teachingSources = [];
let conversationStart = null;
let questionIntent = 0;
let precedingLabQuestion = null;

function syncReplyControls() {
  const active = native?.active || native?.connecting;
  const textAvailable = processingProvider(nativeStatus) === 'OpenAI';
  $('#reply-mode option[value=text]').disabled = !textAvailable;
  if (!active && !textAvailable) $('#reply-mode').value = 'voice';
  if (active) $('#reply-mode').value = native.textOnly ? 'text' : 'voice';
  $('#reply-mode').disabled = Boolean(active);
  $('#reply-mode-note').textContent = active
    ? `${native.textOnly ? 'Written' : 'Voice'} conversation. End it to change reply mode.`
    : publicDeployment ? 'Published lab facts appear directly. Other questions use Einstein.'
      : 'Written answers work without microphone or audio setup.';
  const context = window.__einstein?.paper?.queryContext?.();
  $('#question-context').textContent = context?.visible
    ? `This question can use page ${context.page} of ${context.pages}${context.region?.some((v,i) => v !== [0,0,1,1][i]) ? ' · selected area' : ''}. ${context.approved ? 'Sharing allowed.' : 'Permission is requested before sharing.'}`
    : 'Ask freely, or open material to explore it together.';
}

function writtenAnswer(text, {question = nativeQuestion, status = ''} = {}) {
  $('#written-answer').hidden = false; $('#written-open').hidden = true;
  document.body.classList.add('reading-answer');
  $('#written-close').textContent = window.__einstein?.paper?.queryContext?.()?.visible ? 'Full source' : 'Hide';
  $('#written-question').textContent = question;
  $('#written-content').textContent = text;
  $('#written-status').textContent = status;
}
$('#written-close').onclick = () => { $('#written-answer').hidden = true; $('#written-open').hidden = false; document.body.classList.remove('reading-answer'); };
$('#written-open').onclick = () => { $('#written-answer').hidden = false; $('#written-open').hidden = true; document.body.classList.add('reading-answer'); $('#written-content').focus(); };

async function ensureConversation({textOnly = $('#reply-mode').value !== 'voice'} = {}) {
  if (native.active) return native.serial;
  if (conversationStart && conversationStart.serial !== native.serial) conversationStart = null;
  if (conversationStart) {
    if (native.textOnly !== textOnly) throw new Error('A conversation is starting. End it before changing reply mode.');
    return conversationStart.promise;
  }
  if (!nativeStatus?.available) throw new Error('Conversation is temporarily unavailable. Your question is still here.');
  const startup = native.start({microphone: false, textOnly, voice: $('#native-voice').value,
    publicWeb: $('#public-web').checked, accent: $('#native-accent').value});
  const serial = native.serial;
  const pending = startup.then(() => {
    if (!native.active || native.serial !== serial) throw new Error('The conversation was stopped. Your question is still here.');
    return serial;
  });
  conversationStart = {serial, promise: pending};
  syncReplyControls();
  try { return await pending; }
  finally { if (conversationStart?.promise === pending) { conversationStart = null; syncReplyControls(); } }
}

function restoreTeachingSources() {
  for (const {workspace, kind, id} of teachingSources) {
    const current = kind === 'paper' ? workspace.pdf?.manifest?.id : workspace.manifest?.id;
    if (current === id) { workspace.panel.hidden = false; document.body.classList.add(`${kind}-visible`); }
  }
  teachingSources = [];
}
const captions = new LiveCaptions($('#live-caption'), stats);
function resizeCaptionWindow() {
  const width = $('#live-caption').parentElement.clientWidth;
  captions.limit = innerWidth < 600 || width < 320 ? 70 : 112;
  captions.set(captions.fullText);
}
new ResizeObserver(resizeCaptionWindow).observe($('#live-caption').parentElement);
window.addEventListener('resize', resizeCaptionWindow); resizeCaptionWindow();
let voicePreview = false;
let previewFinished = false;

function resetResearchTurn() {
  stats.flashResearch = null; stats.webGrounding = null;
  $('#research-status').textContent = '';
  $('#web-search-suggestions').replaceChildren(); $('#web-search-suggestions').hidden = true;
}

function error(message = '') {
  $('#error-message').textContent = message;
  $('#error').hidden = !message;
  document.body.classList.toggle('has-message', Boolean(message));
  $('#native-status-retry').hidden = !message || stats.nativeStatusCheck?.phase !== 'failed';
  $('#ask-in-writing').hidden = !message || native?.active || native?.connecting || !nativeStatus?.available || stats.nativeMode === 'text';
  positionNotice();
}
function positionNotice() {
  document.body.style.setProperty('--notice-bottom', `${Math.ceil($('#error').getBoundingClientRect().bottom) + 12}px`);
}
new ResizeObserver(positionNotice).observe($('#error'));
$('#error-dismiss').onclick = () => error();

function state(id, text) {
  stats.state = id;
  if (stage) { stage.busy = id === 'thinking' || id === 'listening'; stage.setConversationState?.(id); }
  document.body.dataset.state = id;
  $('#state').dataset.state = id;
  $('#state').textContent = text || ({thinking: 'Considering your question…', speaking: 'Albert is speaking. You may interrupt.', listening: 'Go on. I’m listening.'})[id] || '';
}

function ready() {
  if (recordingSpeech) return;
  if (native?.active && (native.pendingEvidence.size || native.teaching.active)) {
    state('thinking', native.teaching.active ? 'Following the source…' : 'Reading your material…'); return;
  }
  state('ready', stats.microphoneActive ? 'Listening for your next question' : native?.active ? 'Ask another question' : 'Ready to explore');
}

try {
  stage = new EinsteinStage($('#stage'), info => {
    if (info.ready) {
      $('#asset-state').hidden = true;
      stats.avatarReady = true;
      stats.motion = info.motion;
    }
    if (info.loading != null) $('#asset-state').textContent = `Restoring Einstein’s character · ${info.loading}%`;
    if (info.error) { $('#asset-state').textContent = info.error; error(info.error); }
    if (info.fps) {
      stats.frame = info;
      $('#audio-diagnostics').textContent = `Continuous audio · ${stats.audioUnderruns || 0} buffer underruns · ${stats.audioToneFramesSuppressed || 0} narrow-band tone frames suppressed. Headset/system sounds are not part of this measurement.`;
      $('#render-stats').textContent = `${info.fps} fps · ${Math.round(info.triangles / 1000)}k triangles · desktop`;
    }
  });
} catch (failure) {
  error('3D rendering unavailable: ' + failure.message);
  $('#asset-state').textContent = 'This browser could not create a WebGL renderer.';
}

const board = stage ? new SpatialBoard(stage, stats) : null;
const teachingControls = document.createElement('aside');
teachingControls.id = 'teaching-controls'; teachingControls.hidden = true;
teachingControls.setAttribute('aria-label', 'Developing the explanation');
teachingControls.innerHTML = '<span id="teaching-step-label" role="status" aria-live="polite"></span><button type="button" id="teaching-source" class="view-control" hidden>Source</button><button type="button" id="teaching-next" class="view-control">Next idea</button><button type="button" id="teaching-pause" class="view-control">Pause</button>';
$('#experience').append(teachingControls);
$('#teaching-next').onclick = () => {
  if (native?.teaching.continueManually()) native.resetPlayback({preserveFocus: true});
};
$('#teaching-pause').onclick = () => {
  native?.cancelTeaching(); board?.cancelPending(); native.resetPlayback(); native.suppressAudio = true;
  $('#teaching-step-label').textContent = 'Paused. Ask about this idea.';
  $('#teaching-next').disabled = true; $('#teaching-pause').disabled = true;
};
$('#teaching-source').onclick = () => {
  native?.cancelTeaching(); native.resetPlayback(); native.suppressAudio = true; board?.reset();
  captions.clear();
  restoreTeachingSources();
  window.__einstein?.paper?.showOriginal();
  teachingControls.hidden = true; document.body.classList.remove('progressive-teaching');
};

const player = new SpeechPlayer(stage, playback => {
  native?.playbackState(playback);
  if (recordingSpeech || native?.speaking) return;
  if (playback === 'playing') state('speaking', handsFree.active ? 'Albert is speaking · you may interrupt' : 'Albert is speaking');
  else if (playback === 'buffering' && inFlight) state('thinking', 'Preparing the next spoken sentence');
  else if (!inFlight) ready();
  if (playback === 'idle' && voicePreview && previewFinished && !player.receiving) { voicePreview = false; native.stop(); }
}, stats);

const handsFree = new HandsFreeInput({
  outputActive: () => stats.audioPlaying,
  onStart: () => {
    recordingSpeech = true;
    stats.detectedUtterances++;
    if (inFlight || stats.audioPlaying) stats.interruptions++;
    interrupt(false);
    state('listening', 'I’m listening · pause when your question is complete');
  },
  onEnd: async blob => {
    recordingSpeech = false;
    const encoded = await base64FromBlob(blob);
    if (!handsFree.active) return;
    await ask('', encoded);
  },
  onState: active => {
    stats.microphoneActive = active;
    $('#microphone-label').textContent = active ? 'End conversation' : 'Begin a conversation';
    $('#microphone').setAttribute('aria-pressed', String(active));
    if (!inFlight && !recordingSpeech && !stats.audioPlaying) ready();
  },
});

native = new NativeConversation({player, stats,
  onError: message => error(message),
  onState: status => {
    $('#microphone-label').textContent = stats.microphoneActive || native.microphoneStarting || (native.active && native.textOnly) ? 'End conversation' : native.active ? 'Speak to Albert' : 'Begin a conversation';
    syncReplyControls();
    $('#microphone').setAttribute('aria-pressed', String(stats.microphoneActive));
    if (status === 'speaking') state('speaking', 'Albert is speaking. You may interrupt.');
    else if (status === 'thinking' || status === 'connecting') state('thinking', status === 'connecting' ? 'Beginning the conversation…' : 'Considering your question…');
    else if (['consent','audio-preparation','session-permit','provider-connection','microphone-permission'].includes(status)) {
      const phases = {consent:'Waiting for your approval', 'audio-preparation':'Preparing voice playback…',
        'session-permit':'Checking conversation availability…', 'provider-connection':'Connecting Albert…',
        'microphone-permission':'Waiting for microphone permission'};
      state('thinking', phases[status]);
    }
    else if (status === 'listening' || status === 'connected') {
      if (native.pendingEvidence.size || native.teaching.active) state('thinking', 'Reading your material…');
      else if (stats.microphoneActive) state('listening', 'Go on. I’m listening.');
      else ready();
    }
    else if (status === 'closed') {
      questionIntent++;
      board?.reset(); window.__einstein?.video?.revoke(); window.__einstein?.paper?.revoke();
      if (document.body.classList.contains('progressive-teaching')) restoreTeachingSources();
      teachingControls.hidden = true; document.body.classList.remove('progressive-teaching');
      voicePreview = false; $('#preview-voice').textContent = 'Hear this voice'; ready(); refreshNativeStatus();
    }
  },
  onEvent: event => {
    if (event.event === 'teaching_started') {
      const app = window.__einstein;
      const visible = [{workspace: app?.paper, kind: 'paper', id: app?.paper?.pdf?.manifest?.id},
        {workspace: app?.video, kind: 'video', id: app?.video?.manifest?.id}]
        .filter(source => source.id && !source.workspace.panel.hidden);
      if (visible.length) teachingSources = visible;
      $('#teaching-source').hidden = teachingSources.length === 0;
      teachingControls.dataset.mode = event.mode || 'diagram';
      for (const {workspace, kind} of visible) {
        if (event.mode === 'source' && kind === 'paper') { board?.reset(); continue; }
        clearPresentationFocus(stage, workspace);
        if (kind === 'video') workspace.video.pause();
        workspace.panel.hidden = true; document.body.classList.remove(`${kind}-visible`);
      }
      teachingControls.hidden = false; document.body.classList.add('progressive-teaching');
      $('#teaching-step-label').textContent = event.title || 'Developing the idea';
      $('#teaching-next').disabled = true; $('#teaching-pause').disabled = false;
    }
    if (event.event === 'teaching_text') {
      nativeAnswer = event.text;
      writtenAnswer(event.text, {status: 'Take your time. Choose Next idea when ready.'});
      window.__einstein?.paper?.ink.onset(event, performance.now(), 'visible-commentary');
      state('ready', 'Read this idea, then continue when ready');
    }
    if (event.event === 'teaching_speech_onset') window.__einstein?.paper?.ink.onset(event, event.audible_at);
    if (event.event === 'teaching_local_cancel') window.__einstein?.paper?.ink.cancel();
    if (event.event === 'document_view_selected' || event.event === 'source_revoked') {
      nativeAnswer = ''; captions.clear();
      teachingControls.hidden = true; document.body.classList.remove('progressive-teaching');
    }
    if (event.event === 'teaching_step') {
      nativeAnswer = ''; captions.clear();
      $('#teaching-step-label').textContent = `${event.index + 1} / ${event.count} · ${event.focus_label}`;
      $('#teaching-next').disabled = false;
    }
    if (event.event === 'teaching_finished') {
      if (native.teaching.active) native.teaching.cancel();
      $('#teaching-step-label').textContent = event.status === 'presented-progressively' ? 'The explanation, on your source.' : 'Paused. Ask about this idea.';
      if (native.textOnly) $('#written-status').textContent = event.status === 'presented-progressively'
        ? 'The explanation is complete. Ask a follow-up when ready.'
        : 'The walkthrough paused. Ask to continue from this idea.';
      $('#teaching-next').disabled = true; $('#teaching-pause').disabled = true;
    }
    if (event.event === 'document_tool_requested') state('thinking', 'Opening the requested part…');
    if (event.event === 'document_vision_started') state('thinking', 'Looking closely at this page…');
    if (event.event === 'document_inspected') state('thinking', 'Connecting the ideas…');
    if (event.event === 'connected') {
      document.body.classList.add('engaged'); board?.reset();
      if (!native.textOnly) {
        $('#written-answer').hidden = true; document.body.classList.remove('reading-answer');
        $('#written-open').hidden = !$('#written-content').textContent;
      }
    }
    if (event.event === 'interrupted') board?.cancelPending();
    if (event.event === 'presentation_cancel') board?.cancelPending(event.action_id);
    if (event.event === 'presentation_action') {
      stats.presentationActions ??= [];
      stats.presentationActions.push({kind: event.action.kind, revision: event.action.revision, action_id: event.action.action_id, receivedAt: performance.now()});
      if (stats.presentationActions.length > 30) stats.presentationActions.shift();
    }

    if (event.event === 'web_grounding') {
      stats.webGrounding = event;
      nativeSources = [...new Map([...nativeSources, ...event.sources].map(source => [source.id, source])).values()];
      nativeEvidenceHistory = nativeSources;
      showSources(nativeSources);
      renderWebGrounding(event, $('#web-search-suggestions'));
      $('#research-status').textContent = `Google Search checked ${new Date(event.checked_at).toLocaleString()} · ${event.sources.length} linked sources. Citation metadata is not a guarantee of correctness.`;
    }
    if (event.event === 'research_started') { stats.flashResearch = {status: 'running', model: event.model}; $('#research-status').textContent = `${event.model} is checking the evidence…`; }
    if (event.event === 'research_complete') {
      stats.flashResearch = {status: event.status, model: event.model, answer: event.answer, claims: event.claims || []};
      $('#research-status').textContent = event.status === 'source-bound' ? `${event.model} completed the source-bound check. Interpretation and uncertainty remain explicit.` : 'The additional evidence check did not complete; do not treat this answer as verified by that check.';
    }
    if (['work_plan','work_activity','calculation','draft_ready'].includes(event.event)) {
      $('#task-notes').hidden = false; $('#source-toggle').hidden = false; $('#source-toggle').textContent = 'Task & research notes';
      stats.workEvents ??= []; stats.workEvents.push(event);
      if (stats.workEvents.length > 70) stats.workEvents.shift();
      if (event.event === 'work_plan' && event.plan) {
        $('#task-goal').textContent = event.plan.goal;
        $('#task-plan').replaceChildren(...event.plan.steps.map(step => { const item=document.createElement('li');item.textContent=step;return item; }));
        $('#task-activity').replaceChildren();
      } else if (event.event === 'work_activity') {
        const row=document.createElement('p'); row.className='activity-row';row.textContent=event.tool.replaceAll('_',' ')+' · '+event.status+(event.source_count ? ' · '+event.source_count+' source passages' : '');$('#task-activity').append(row);
      } else if (event.event === 'calculation') {
        const row=document.createElement('p');row.className='calculation-row';row.textContent=event.result.expression+' = '+event.result.result;$('#task-activity').append(row);
      } else if (event.event === 'draft_ready') {
        const section=document.createElement('section');section.className='draft-card';const heading=document.createElement('h4');heading.textContent=event.title;
        const preview=document.createElement('pre');preview.textContent=event.markdown;
        const download=document.createElement('button');download.className='secondary-button';download.textContent='Download this draft';
        download.onclick=()=>{const object=URL.createObjectURL(new Blob([event.markdown],{type:'text/markdown;charset=utf-8'}));const link=document.createElement('a');link.href=object;link.download='einstein-research-note.md';link.click();setTimeout(()=>URL.revokeObjectURL(object),15000);};
        section.append(heading,preview,download);$('#task-drafts').append(section);stats.latestDraft={title:event.title,sha256:event.sha256,markdown:event.markdown};
      }
    }
    if (event.event === 'input_start' && event.source === 'client-local') {
      const paper = window.__einstein?.paper, context = paper?.queryContext?.();
      if (context?.approved && context.visible) {
        try { paper.shareCurrentView(); } catch (failure) { error(failure.message); }
      }
    }
    if (event.event === 'input_start') { board?.cancelPending(); resetResearchTurn(); nativeQuestion = event.source === 'typed' ? event.text : ''; nativeAnswer = ''; nativeSources = []; captions.clear(); if (native.textOnly) writtenAnswer('', {status: 'Considering your question…'}); }
    if (event.event === 'input_transcript') { nativeQuestion += event.text; stats.lastTranscript = nativeQuestion; }
    if (event.event === 'output_transcript') { nativeAnswer += event.text; if (native.textOnly) writtenAnswer(nativeAnswer, {status: 'Developing the answer…'}); else captions.set(nativeAnswer); }
    if (event.event === 'sources') { nativeSources = event.sources; nativeEvidenceHistory = event.sources; showSources(nativeSources); }
    if (event.event === 'interrupted') { nativeAnswer = ''; captions.clear(); }
    if (event.event === 'audio' && stats.nativeFirstPacketMs != null) $('#measurement').textContent = `First audio packet ${(stats.nativeFirstPacketMs / 1000).toFixed(2)} s · ${stats.nativeProvider || processingProvider(nativeStatus)} ${stats.nativeModel || ''} · audio-driven face`;
    if (event.event === 'turn_complete' || (event.event === 'playback_idle' && event.source === 'client-local')) {
      if (voicePreview) previewFinished = true;
      if (nativeAnswer.trim()) {
        appendTurn(nativeQuestion.trim() || (native.textOnly ? 'Written conversation' : 'Native voice conversation'), nativeAnswer.trim(), native.textOnly ? 'native-text' : 'native-audio');
        if (native.textOnly) writtenAnswer(nativeAnswer.trim(), {status: 'Ask a follow-up, or select another part of the source.'});
        stats.lastTurn = {question: nativeQuestion.trim(), answer: nativeAnswer.trim(), mode: native.textOnly ? 'native-text' : 'native-audio', sources: (nativeSources.length ? nativeSources : nativeEvidenceHistory).map(source => source.url), sourceScope: nativeSources.length ? 'this-turn-lookup' : 'conversation-context', research: stats.flashResearch || null, webQueries: stats.webGrounding?.queries || [], voice: stats.nativeVoice, firstPacketMs: stats.nativeFirstPacketMs, provider: stats.nativeProvider || processingProvider(nativeStatus), model: stats.nativeModel, boundary: event.event === 'playback_idle' ? 'client-local-playback-idle' : 'provider-turn-complete', lipsyncKind: native.textOnly ? 'none' : stats.audioFaceReady ? 'audio-viseme-estimate' : 'audio-reactive'};
      }
      nativeQuestion = ''; nativeAnswer = ''; nativeSources = [];
      if (native.pendingEvidence.size && !native.teaching.active) captions.clear();
    }
    if (event.event === 'notice') error(event.message);
  }
});

native.presentationHandler = (action, valid) => { if (!board) throw new Error("Visual renderer unavailable"); return board.apply(action, valid); };
const approveProcessing = processingConsent(() => native?.textOnly ? {...nativeStatus, model: nativeStatus?.text_model || 'gpt-6.1-sol'} : nativeStatus);
native.beforeStart = () => {
  if (!nativeStatus?.available) throw new Error('Check the conversation service before beginning.');
  return publicDeployment ? approveProcessing() : undefined;
};

window.__einstein = {stats, player, stage, native, board, captions, ask: question => ask(question), interrupt: () => interrupt(),
  composeQuestion: () => { closeDialogs(); syncReplyControls(); showDialog('#question-dialog'); $('#question').focus(); },
  ensureConversation, startVoice: () => startVoice(), stopVoice: async () => { await handsFree.stop(); await interrupt(); }, refreshNativeStatus};
window.__einstein.paper = new PaperWorkspace(window.__einstein);
window.__einstein.video = new VideoWorkspace(window.__einstein);
attachPresentationUpload(window.__einstein);
attachPaperRetrieval(window.__einstein);
if (performance.getEntriesByType('navigation')[0]?.type === 'reload') {
  $('#source-recovery').hidden = false;
}
$('#source-recovery-open').onclick = () => { $('#source-recovery').hidden = true; $('#material-menu').showPopover(); };
$('#source-recovery-dismiss').onclick = () => { $('#source-recovery').hidden = true; };
$('#material-menu').addEventListener('click', event => {
  if (event.target.closest('button')) $('#material-menu').hidePopover();
});

async function interrupt(updateState = true) {
  questionIntent++;
  window.__einstein?.paper?.resolveConsent?.(false);
  if (native?.active || native?.connecting) await native.stop();
  const request = activeRequest;
  activeRequest = null;
  gate.cancel();
  player.stop();
  inFlight = false;
  if (updateState) ready();
  if (!request) return;
  try {
    await fetch('/api/cancel', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({session_id: sessionId, request_id: request})});
  } catch { /* Transport abort already invalidates client playback. */ }
}

function appendTurn(question, answer, mode) {
  document.body.classList.add('engaged');
  captions.set(answer);
  const article = document.createElement('article'); article.className = 'turn';
  const q = document.createElement('p'); q.className = 'user-question'; q.textContent = question;
  const who = document.createElement('p'); who.className = 'speaker'; who.textContent = 'ALBERT';
  const p = document.createElement('p'); p.className = 'answer'; p.textContent = mode === 'native-audio' ? spokenWords(answer) : answer;
  const label = document.createElement('small'); label.className = 'mode';
  label.textContent = mode === 'native-text' ? 'Written conversation · source actions confirmed in the viewer' : mode === 'native-audio' ? `Voice conversation · ${stats.nativeProvider || processingProvider(nativeStatus)} ${stats.nativeModel || ''}${native.continuousAudio ? ' · local playback pause' : ''}` : mode === 'prepared-introduction' ? 'Prepared opening · authored, not a historical quotation' :
    mode === 'reviewed-research-note' ? 'Reviewed research note · source snapshot verified, not live generation' : mode === 'source-fact' ? 'Fact stated in the public source' : mode === 'local-synthesis' ? 'Generated explanation · evidence checks applied' :
    mode === 'abstention' ? 'Evidence unavailable · no answer invented' : 'Direct extract from the lab website';
  article.append(q, who, p, label);
  $('#transcript').append(article);
  requestAnimationFrame(() => { $('#transcript').scrollTop = $('#transcript').scrollHeight; });
}

function showSources(sources) {
  $('#source-box').hidden = !sources.length;
  $('#source-toggle').hidden = !sources.length && $('#task-notes').hidden;
  $('#sources').replaceChildren();
  $('#sources').hidden = false;
  $('#source-toggle').setAttribute('aria-expanded', 'false');
  const pages = new Set(sources.map(source => source.url || source.document_id + ':p' + source.page)).size;
  $('#source-toggle').textContent = `Research notes · ${pages} source page${pages === 1 ? '' : 's'}`;
  if (pages === 1 && sources[0]?.source_kind === 'cached-official-lab') {
    const date = new Date(sources[0].fetched_at);
    const title = sources[0].section === 'Our Team' ? 'Lab team page' : sources[0].title;
    if (title && Number.isFinite(date.getTime())) $('#source-toggle').textContent = `From: ${title} · ${date.toLocaleDateString('en-GB', {day:'numeric',month:'short'})}`;
  }
  for (const source of sources) {
    const article = document.createElement('article');
    const link = document.createElement('a'); link.textContent = source.title;
    const url = safeEvidenceURL(source.url);
    if (url) link.href = url;
    link.target = '_blank'; link.rel = 'noopener noreferrer';
    const text = document.createElement('p'); text.textContent = source.excerpt;
    const date = document.createElement('small');
    date.textContent = source.source_kind === 'visitor-selected-pdf' ? `Original visitor-selected PDF · page ${source.page} · ${source.document_id.slice(0, 12)}` : sourceProvenanceLabel(source) + ' · ' + new Date(source.fetched_at).toLocaleString() + ' · ' + source.id;
    article.append(link, text, date); $('#sources').append(article);
  }
}

async function ask(question, audio = '', opening = false) {
  if (!nativeStatus && !native?.active) { closeDialogs(); unavailableStatus(); return; }
  if ($('#conversation-engine').value === 'native') {
    closeDialogs(); document.body.classList.add('engaged'); error();
    let intent;
    try {
      intent = ++questionIntent;
      const paper = window.__einstein?.paper;
      const video = window.__einstein?.video;
      const paperSerial = paper?.serial, videoSerial = video?.serial;
      const factEligible = () => publicDeployment && !opening && !audio && $('#reply-mode').value === 'text'
        && !native.active && !native.connecting && !conversationStart && !handsFree.active
        && !paper?.pdf && paper?.panel.hidden !== false && !video?.manifest && video?.panel.hidden !== false
        && paper?.serial === paperSerial && video?.serial === videoSerial;
      // A complete, dated website fact can be read without starting a model.
      // Selected artifacts and active conversations keep their existing path.
      if (factEligible()) {
        const began = performance.now();
        const fact = await quickLabFact(question);
        if (intent !== questionIntent) return;
        if (!factEligible()) return;
        if (fact) {
          resetResearchTurn(); nativeQuestion = question; nativeAnswer = fact.answer;
          nativeSources = nativeEvidenceHistory = fact.sources; showSources(fact.sources);
          appendTurn(question, fact.answer, 'source-fact');
          const date = new Date(fact.sources[0].fetched_at).toLocaleDateString();
          writtenAnswer(fact.answer, {question, status: `From the lab website · read ${date}.`});
          stats.lastTurn = {question, answer: fact.answer, mode: 'source-fact',
            sources: fact.sources.map(source => source.url), provider: null, model: null,
            firstAnswerMs: performance.now() - began, lookupMs: fact.lookup_ms};
          precedingLabQuestion = question;
          if ($('#question').value.trim() === question) $('#question').value = '';
          return;
        }
      }
      if (!native.active && !nativeStatus?.available) { if (publicDeployment) throw new Error('Conversation is temporarily unavailable. Please try again later.'); showDialog('#settings-dialog'); $('#native-setup').open = true; throw new Error('The native route needs the existing free-tier key entered locally and explicit audio-processing approval.'); }
      if (handsFree.active) await handsFree.stop();
      let context = paper?.queryContext?.();
      if (paper?.panel.hidden === false && !context) throw new Error('The page is still changing. Your question is still here; ask when it is ready.');
      if (context?.visible && !context.approved) {
        const allowed = await paper.requestConsent();
        if (intent !== questionIntent) return;
        if (!allowed) throw new Error('The page was not shared. Your question is still here; close the material to ask without it.');
      }
      const conversationSerial = await ensureConversation({textOnly: opening ? false : $('#reply-mode').value !== 'voice'});
      if (intent !== questionIntent || !native.active || native.serial !== conversationSerial) return;
      context = paper?.queryContext?.();
      if (paper?.panel.hidden === false && !context) throw new Error('The page changed while connecting. Your question is still here; ask again when it is ready.');
      if (context?.visible) await paper.shareCurrentView();
      if (intent !== questionIntent || !native.active || native.serial !== conversationSerial) return;
      resetResearchTurn(); nativeQuestion = question || 'Introduction'; nativeAnswer = ''; nativeSources = [];
      const prompt = opening ? 'Introduce yourself briefly as a digital interpretation of Einstein and invite a question about the Mobiliar Lab.' : question;
      const target = context?.visible ? `\n[Current shared page ${context.page}/${context.pages}, region ${JSON.stringify(context.region.map(value => Number(value.toFixed(5))))}. Use this view for “this”; inspect figure details before describing them.]` : '';
      const prior = !opening && !context?.visible && !video?.manifest ? precedingLabQuestion : null;
      native.sendText(contextualLabQuestion(prompt + target, prior), {displayText: prompt});
      precedingLabQuestion = null;
      if ($('#question').value.trim() === question) $('#question').value = '';
    } catch (failure) { if (intent == null || intent === questionIntent) error(failure.message); }
    return;
  }
  closeDialogs();
  document.body.classList.add('engaged');
  captions.clear();
  await interrupt(false);
  error();
  const ticket = gate.next();
  const requestId = crypto.randomUUID();
  activeRequest = requestId;
  const playerVersion = player.begin();
  const started = performance.now();
  stats.requestStartedAt = started;
  stats.receivedSegments = 0; stats.mouthCueCount = 0;
  $('#measurement').textContent = 'Current turn in progress · timing will appear with its voice output · API cost $0';
  inFlight = true;
  state('thinking', audio ? 'Transcribing your question locally' : opening ? 'Beginning the prepared introduction' : 'Consulting the lab’s published evidence');
  let answerSeen = false;
  try {
    const response = await fetch('/api/turn/stream', {method: 'POST',
      headers: {'Content-Type': 'application/json'}, signal: ticket.signal,
      body: JSON.stringify({session_id: sessionId, request_id: requestId, question,
        audio_base64: audio, speak: $('#sound').checked, evidence_only: $('#evidence-only').checked,
        voice_mode: $('#voice-mode').value, opening})});
    if (!response.ok) {
      const data = await response.json(); throw new Error(data.detail || `Request failed (${response.status})`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    const handle = async event => {
      if (!gate.current(ticket.version)) return;
      if (event.request_id && event.request_id !== requestId) return;
      if (event.event === 'error') throw new Error(event.detail || 'The local runtime could not finish this turn.');
      if (event.event === 'state' && !stats.audioPlaying) state('thinking', event.state === 'transcribing' ? 'Transcribing your question locally' : 'Considering the published evidence');
      if (event.event === 'transcript') stats.lastTranscript = event.question;
      if (event.event === 'answer' || event.event === 'replay') {
        answerSeen = true;
        stats.lastTurn = {question: event.question, answer: event.answer, mode: event.mode,
          sources: event.sources.map(source => source.url), answerReceivedMs: Math.round(performance.now() - started),
          generationRejected: event.generation_rejected || null, timings: null};
        appendTurn(event.question, event.answer, event.mode); showSources(event.sources);
        if (event.event === 'replay' && event.audio_base64 && $('#sound').checked) {
          await player.enqueue(event.audio_base64, event.mouthCues || [], playerVersion);
          stats.lastTurn.timings = event.timings;
        }
      }
      if (event.event === 'audio' && $('#sound').checked) {
        stats.receivedSegments++;
        stats.mouthCueCount += event.mouthCues?.length || 0;
        if (event.text) player.nextCaption = event.text;
        if (stats.receivedSegments === 1 && Number.isFinite(event.elapsed_ms)) {
          $('#measurement').textContent = `First voice segment ${(event.elapsed_ms / 1000).toFixed(2)} s · completing this response · API cost $0`;
        }
        await player.enqueue(event.audio_base64, event.mouthCues || [], playerVersion);
      }
      if (event.event === 'done') {
        if (stats.lastTurn) {
          stats.lastTurn.timings = event.timings;
          stats.lastTurn.voiceEngine = event.voice_engine;
          stats.lastTurn.lipsyncKind = event.lipsync_kind;
          stats.lastTurn.receivedMs = Math.round(performance.now() - started);
        }
        const timings = event.timings;
        const first = timings.server_first_audio_ms;
        $('#measurement').textContent = `${first == null ? 'Text response' : 'First voice segment ' + (first / 1000).toFixed(2) + ' s'} · total server ${(timings.server_total_ms / 1000).toFixed(2)} s · API cost $0`;
        if (event.audio_error) error('The answer is available, but local voice synthesis failed: ' + event.audio_error);
      }
    };
    while (gate.current(ticket.version)) {
      const {value, done} = await reader.read();
      if (done) break;
      pending += decoder.decode(value, {stream: true});
      let end;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        if (line.trim()) await handle(JSON.parse(line));
      }
    }
    pending += decoder.decode();
    if (pending.trim()) await handle(JSON.parse(pending));
    if (!gate.current(ticket.version)) return;
    if (!answerSeen) throw new Error('The stream ended without a validated answer.');
    inFlight = false; activeRequest = null; player.finish();
    if (!stats.audioPlaying && !player.entries.length) ready();
  } catch (failure) {
    if (failure.name === 'AbortError' || !gate.current(ticket.version)) return;
    // A failed producer must not leave partial speech or its network reader alive.
    inFlight = false; activeRequest = null; gate.cancel(); player.stop();
    void fetch('/api/cancel', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({session_id: sessionId, request_id: requestId})}).catch(() => {});
    state('error', 'That turn could not be completed');
    error(failure.message);
  }
}

async function startVoice() {
  error();
  if (!nativeStatus && !native?.active) { unavailableStatus(); return; }
  if ($('#conversation-engine').value === 'native') {
    if (native.connecting || (native.active && (stats.microphoneActive || native.microphoneStarting || native.textOnly))) { await interrupt(); return; }
    if (native.active && !stats.microphoneActive) {
      try { await native.startMicrophone(native.serial); closeDialogs(); }
      catch (failure) { error(failure.message); }
      return;
    }
    if (!nativeStatus?.available) { if (publicDeployment) { error('Conversation is temporarily unavailable. Please try again later.'); return; } showDialog('#settings-dialog'); $('#native-setup').open = true; $('#native-key').focus(); error('Enter the existing verified free-tier key locally before starting native voice.'); return; }
    try {
      await interrupt(false); await handsFree.stop(); closeDialogs(); document.body.classList.add('engaged');
      nativeQuestion = ''; nativeAnswer = ''; nativeSources = [];
      await native.start({microphone: true, opening: true, voice: $('#native-voice').value, publicWeb: $('#public-web').checked, accent: $('#native-accent').value});
    } catch (failure) { error(failure.message); }
    return;
  }
  try {
    closeDialogs();
    document.body.classList.add('engaged');
    await player.activate();
    if (handsFree.active) {
      await handsFree.stop(); recordingSpeech = false; await interrupt();
      return;
    }
    await handsFree.start();
    state('ready', 'Listening · ask naturally and pause when finished');
  } catch (failure) {
    state('ready', 'Microphone unavailable');
    error(failure.message);
  }
}

$('#question-form').addEventListener('submit', event => {
  event.preventDefault();
  const question = $('#question').value.trim();
  if (question) ask(question);
});
$('#question').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); $('#question-form').requestSubmit(); }
});
$('#microphone').onclick = startVoice;
$('#interrupt').onclick = () => { stats.interruptions++; interrupt(); };
$('#introduction').onclick = () => ask('', '', true);
for (const button of document.querySelectorAll('[data-question]')) button.onclick = () => ask(button.dataset.question);
$('#source-toggle').onclick = () => {
  showDialog('#evidence-dialog');
  $('#source-toggle').setAttribute('aria-expanded', 'true');
};
$('#evidence-dialog').addEventListener('close', () => $('#source-toggle').setAttribute('aria-expanded', 'false'));
$('#keyboard-toggle').onclick = () => { syncReplyControls(); showDialog('#question-dialog'); $('#question').focus(); };
$('#ask-in-writing').onclick = () => { error(); $('#reply-mode').value = 'text'; syncReplyControls(); showDialog('#question-dialog'); $('#question').focus(); };
$('#reply-mode').onchange = syncReplyControls;
window.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open]')) return;
  if (native?.active || native?.connecting) { event.preventDefault(); stats.interruptions++; interrupt(); }
});
$('#settings-toggle').onclick = () => { refreshNativeStatus(); showDialog('#settings-dialog'); };
$('#sound').onchange = () => player.setMuted(!$('#sound').checked);
$('#captions').onchange = () => document.body.classList.toggle('captions-off', !$('#captions').checked);
$('#portrait').onclick = () => stage?.view('portrait');
$('#fullbody').onclick = () => stage?.view('full');
$('#xr').onclick = async () => {
  try { closeDialogs(); await stage.enterAR(); state('ready', 'Look at the floor; select to place Einstein'); }
  catch (failure) { error(failure.message); }
};
window.addEventListener('pagehide', () => { player.stop(); handsFree.stop(); native.stop(); });
stopWhenHidden(document, () => { handsFree.stop(); recordingSpeech = false; interrupt(); }, () => Boolean(stage?.renderer.xr.isPresenting));

function updateVoiceControls() {
  const external = $('#conversation-engine').value === 'native';
  document.querySelectorAll('[data-native-control]').forEach(element => { element.hidden = !external; });
  document.querySelectorAll('[data-local-control]').forEach(element => { element.hidden = external; });
  const openAI = processingProvider(nativeStatus) === 'OpenAI';
  $('#preview-voice').hidden = !external || openAI || !nativeStatus;
  $('#preview-voice').disabled = native?.active || native?.connecting || openAI || !nativeStatus;
  $('#native-voice').disabled = native?.active || native?.connecting || !nativeStatus;
  $('#native-accent').disabled = native?.active || native?.connecting || !nativeStatus;
  $('#native-voice-note').textContent = native?.active ? `Speaking with ${stats.nativeVoice || $('#native-voice').value}. End this conversation before changing voice.` : 'The selected voice and English delivery apply when the next conversation begins.';
  if (native?.active && native.textOnly) {
    $('#native-status').textContent = `Written conversation · ${stats.nativeProvider || processingProvider(nativeStatus)} ${stats.nativeModel || ''}. Microphone and voice playback are off.`;
  } else if (nativeStatus) {
    $('#native-status').textContent = !external ? 'Local mode: speech and the lab snapshot stay on this Mac.' : nativeStatus.available ?
      `${nativeStatus.active ? 'Connected' : 'Ready'} · ${processingProvider(nativeStatus)} ${nativeStatus.model} · ${nativeStatus.active_voice || $('#native-voice').value}. ${nativeStatus.provider_session_verified ? 'A real provider connection has succeeded.' : 'The saved key is configured; connection will be checked when you begin.'} Audio is shared with ${processingProvider(nativeStatus)} only when you start.` : nativeStatus.reason || 'Native voice is unavailable.';
  }
}
function pinPublicMode(value) {
  if (value?.public_deployment !== true) return;
  publicDeployment = true;
  $('#conversation-engine').value = 'native';
  $('#conversation-engine option[value=local]').disabled = true;
  $('#conversation-engine').closest('label').hidden = true;
  $('#native-setup').hidden = true; $('#native-setup').open = false;
  updateVoiceControls();
}
function unavailableStatus() {
  error(stats.nativeStatusCheck?.phase === 'checking' ? 'Checking the conversation service. Please wait a moment.' :
    statusErrorMessage || 'The conversation service is unavailable. Retry the connection before beginning.');
}
async function refreshNativeStatus() {
  $('#native-status-retry').disabled = true; $('#native-status-retry').hidden = true;
  updateVoiceControls();
  $('#native-status').textContent = 'Checking the conversation service…';
  try {
    nativeStatus = await loadNativeStatus();
    stats.nativeStatus = nativeStatus;
    stats.nativeStatusCheck = {phase: 'ready', available: nativeStatus.available};
    pinPublicMode(nativeStatus);
    const provider = processingProvider(nativeStatus);
    const publicResearch = nativeStatus.public_research;
    const webProvider = provider === 'OpenAI' ? 'OpenAI' : 'Exa';
    $('#public-web-label').textContent = `Public web research · ${webProvider}`;
    $('#web-capability').textContent = `Official lab pages: cached with source dates; refreshed on request. Optional public search and webpage reading: ${webProvider}. Evidence specialist: ${nativeStatus.research?.model || 'unavailable'}. Availability is checked separately.`;
    $('#public-web-note').textContent = (publicResearch?.privacy || `Queries and URLs go to ${webProvider}; returned evidence is processed by ${provider}.`) + (provider === 'OpenAI' ? ' Uses the operator’s existing API credit and spending limit.' : '') + ' Login pages and paywalls are not supported. Applies to the next conversation.';
    $('#voice-processing-note').textContent = `Voice conversation keeps the microphone open until you end it. ${nativeStatus.public_deployment ? '' : 'Local mode processes audio on this Mac. '}Voice, questions and selected pages or frames are shared with ${provider} after approval. This service does not save microphone audio. Headphones are recommended; room echo is not yet verified.`;
    $('#native-setup').hidden = publicDeployment;
    $('#conversation-engine option[value=native]').textContent = `Voice · ${provider}`;
    const choices = configuredVoices(nativeStatus);
    let savedVoice, savedAccent, savedVersion;
    try {
      savedVoice = stats.voicePreferencesLoaded ? $('#native-voice').value : localStorage.getItem('einstein-native-voice');
      savedAccent = localStorage.getItem('einstein-native-accent');
      savedVersion = localStorage.getItem('einstein-voice-persona');
    } catch {}
    const preferences = initialVoicePreferences(nativeStatus, {voice: savedVoice, accent: savedAccent, version: savedVersion});
    $('#native-voice').replaceChildren(...choices.map(({id, label}) => { const option = document.createElement('option'); option.value = id; option.textContent = label; return option; }));
    $('#native-voice').value = stats.voicePreferencesLoaded ? configuredVoice(nativeStatus, savedVoice) : preferences.voice;
    window.__einstein?.paper?.updateProcessingNotice(); window.__einstein?.video?.updateProcessingNotice();
    if (!stats.voicePreferencesLoaded) {
      let engine;
      try { engine = localStorage.getItem('einstein-conversation-engine'); } catch {}
      $('#conversation-engine').value = publicDeployment || ((engine === 'native' || !engine) && nativeStatus.available) ? 'native' : 'local';
      if (nativeStatus.public_deployment) {
        document.querySelector('#conversation-engine option[value=local]').disabled = true;
        $('#native-setup').hidden = true;
        $('#conversation-engine').closest('label').hidden = true;
      }
      $('#native-accent').value = preferences.accent;
      if (preferences.migrate) try {
        localStorage.setItem('einstein-native-voice', preferences.voice);
        localStorage.setItem('einstein-native-accent', preferences.accent);
        localStorage.setItem('einstein-voice-persona', preferences.version);
      } catch {}
      stats.voicePreferencesLoaded = true;
    }
    updateVoiceControls();
    if ($('#error-message').textContent === statusErrorMessage) error();
    statusErrorMessage = '';
  } catch (failure) {
    nativeStatus = null; stats.nativeStatus = null;
    stats.nativeStatusCheck = {phase: 'failed', code: failure.code || 'status-update', httpStatus: failure.httpStatus || null};
    statusErrorMessage = failure.message;
    $('#native-status').textContent = statusErrorMessage;
    $('#native-setup').hidden = true; $('#native-setup').open = false;
    updateVoiceControls();
    error(statusErrorMessage);
  } finally { $('#native-status-retry').disabled = false; }
}
$('#native-status-retry').onclick = () => { error(); refreshNativeStatus(); };
$('#public-web').checked = localStorage.getItem('einstein-public-web') === 'true';
$('#public-web').onchange = () => localStorage.setItem('einstein-public-web', String($('#public-web').checked));
$('#conversation-engine').onchange = async () => {
  try { localStorage.setItem('einstein-conversation-engine', $('#conversation-engine').value); } catch {}
  await handsFree.stop(); recordingSpeech = false; await interrupt();
  $('#native-setup').open = !publicDeployment && Boolean(nativeStatus) && $('#conversation-engine').value === 'native' && !nativeStatus.available;
  updateVoiceControls();
};
$('#native-accent').onchange = () => { try { localStorage.setItem('einstein-native-accent', $('#native-accent').value); } catch {} updateVoiceControls(); };
$('#native-voice').onchange = () => { try { localStorage.setItem('einstein-native-voice', $('#native-voice').value); } catch {} updateVoiceControls(); };
$('#preview-voice').onclick = async () => {
  if (processingProvider(nativeStatus) === 'OpenAI') { error('Recorded voice previews are unavailable for this provider.'); return; }
  if (voicePreview) { voicePreview = false; player.stop(); $('#preview-voice').textContent = 'Hear this voice'; ready(); return; }
  if (native.active || native.connecting) { error('End the current conversation before comparing a voice.'); return; }
  try {
    await handsFree.stop(); await interrupt(false); recordingSpeech = false;
    voicePreview = true; previewFinished = false; $('#preview-voice').textContent = 'Stop preview';
    await player.prepareNative();
    const chosen = $('#native-voice').value;
    const response = await fetch('/voice-previews/' + ($('#native-accent').value === 'german' ? 'german/' : '') + encodeURIComponent(chosen) + '.wav');
    if (!response.ok) throw new Error('The recorded voice sample is unavailable.');
    const version = player.begin();
    const buffer = await player.context.decodeAudioData(await response.arrayBuffer());
    if (!voicePreview) return;
    player.schedule(buffer, [], version, true);
    previewFinished = true; player.finish();
    $('#native-voice-note').textContent = `Recorded ${chosen} sample with ${$('#native-accent').value === 'german' ? 'German-influenced English direction' : 'original English delivery'}. No API request. This is a synthetic interpretation, not an authenticated historical voice.`;
    captions.set($('#native-accent').value === 'german' ? 'Perhaps the most interesting question is not whether a machine can think. It is whether the machine helps us think more clearly. Let us look at the evidence together, and remain a little suspicious of an answer that seems too perfect.' : 'A good question is a promising beginning. Tell me, what are you curious about?');
  } catch (failure) { voicePreview = false; $('#preview-voice').textContent = 'Hear this voice'; error(failure.message); }
};

$('#native-key-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('#native-save').disabled = true;
  $('#native-config-message').textContent = 'Saving privately on this Mac…';
  const key = $('#native-key').value.trim();
  $('#native-key').value = '';
  try {
    const response = await fetch('/api/native/configure', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({api_key: key, external_processing_approved: $('#native-consent').checked})});
    if (!response.ok) throw new Error('Configuration was not saved. Check the existing free-tier key and consent; no key value was logged.');
    await refreshNativeStatus();
    $('#native-config-message').textContent = 'Saved privately. Native voice can now be selected; the provider has not been contacted merely by saving the key.';
    $('#native-setup').open = false;
    $('#conversation-engine').value = 'native';
    try { localStorage.setItem('einstein-conversation-engine', 'native'); } catch {}
    updateVoiceControls();
  } catch (failure) { $('#native-config-message').textContent = failure.message; }
  finally { $('#native-save').disabled = false; }
});

async function initialise() {
  await refreshNativeStatus();
  try {
    const response = await fetch('/api/health');
    if (!response.ok) throw new Error('The local runtime is not ready.');
    capabilities = await response.json();
    stats.capabilities = capabilities;
    pinPublicMode(capabilities);
    if (capabilities.public_deployment) {
      $('#health').textContent = 'Voice and research · private visitor sessions';
      $('#coverage').textContent = 'Public lab sources, checked during your conversation';
      return;
    }
    $('#health').textContent = capabilities.llm_available ? 'Local intelligence · no paid APIs' : 'Evidence-only runtime · no paid APIs';
    $('#coverage').textContent = `${capabilities.pages} public pages · snapshot ${new Date(capabilities.snapshot_at).toLocaleDateString()}`;
    if (!capabilities.stt_available) { $('#microphone').disabled = true; $('#microphone-label').textContent = 'Speech model not installed'; }
    if (!capabilities.llm_available) $('#evidence-only').checked = true;
    if (!capabilities.expressive_voice_available) $('#voice-mode').value = 'fast';
    if (!capabilities.tts_available) { $('#sound').checked = false; error('No local voice is installed; text answers remain available.'); }
  } catch (failure) { $('#health').textContent = 'Local runtime unavailable'; error(failure.message); }
  try {
    if (navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')) {
      $('#xr').disabled = false; $('#xr').textContent = 'Enter Quest AR';
    }
  } catch { /* Unsupported WebXR must not block the desktop experience. */ }
}
initialise();
