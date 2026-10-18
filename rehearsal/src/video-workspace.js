import * as THREE from 'three';
import './media-workspace.css';
import {sourceProcessingNotice} from './processing-consent.js';
import {setPresentationFocus, clearPresentationFocus} from './embodied-attention.js';

const el = (tag, attributes = {}, text = '') => {
  const node = document.createElement(tag);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
  node.textContent = text;
  return node;
};
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

/** Actual browser-local source media, not a generated video or an embedded webpage.
 * No video bytes leave the browser. A visitor explicitly approves bounded frame
 * sharing; every model operation is tied to the current file and conversation.
 */
export class VideoWorkspace {
  constructor(app) {
    this.app = app; this.serial = 0; this.url = null; this.file = null; this.manifest = null;
    this.approved = false; this.sharedSession = null; this.operations = 0; this.busy = false;
    this.actionSerial = 0; this.commandSerial = 0; this.activeAction = null;
    this.waiters = new Set(); this.lastRead = null; this.annotation = null; this.appliedRevision = 0;
    this.input = el('input', {id: 'video-file', type: 'file', accept: 'video/mp4,video/webm,.mp4,.webm', hidden: ''});
    this.openButton = el('button', {id: 'video-open', type: 'button', class: 'view-control'}, 'Open a video');
    document.querySelector('#material-actions').append(this.openButton, this.input);
    this.panel = el('section', {id: 'video-workspace', class: 'media-workspace', 'aria-label': 'Selected original video', hidden: ''});
    const heading = el('header', {class: 'media-heading'});
    this.title = el('h2', {id: 'video-title'}, 'Selected video');
    this.remove = el('button', {type: 'button', id: 'video-remove', class: 'icon-button', 'aria-label': 'Remove selected video'}, '×');
    heading.append(this.title, this.remove);
    this.video = el('video', {id: 'original-video', controls: '', playsinline: '', preload: 'auto'});
    this.overlay = el('canvas', {id: 'video-annotations', 'aria-label': 'Explanatory video annotations'});
    this.frame = el('div', {class: 'video-frame'}); this.frame.append(this.video, this.overlay);
    const controls = el('div', {class: 'media-controls'});
    this.rewind = el('button', {id: 'video-rewind', type: 'button', class: 'view-control'}, 'Back 5 seconds');
    this.speed = el('select', {id: 'video-speed', 'aria-label': 'Video playback speed'});
    for (const value of [.5, .75, 1, 1.25, 1.5]) this.speed.append(el('option', {value: String(value)}, `${value}×`));
    this.speed.value = '1'; controls.append(this.rewind, this.speed);
    this.discussButton = el('button', {id: 'video-discuss', type: 'button', class: 'primary-button', disabled: ''}, 'Discuss this video with Einstein');
    this.info = el('p', {id: 'video-status', role: 'status'});
    this.privacy = el('p', {class: 'media-privacy'}, sourceProcessingNotice(app.stats.nativeStatus, 'video'));
    this.caption = el('p', {id: 'video-caption', class: 'media-privacy'}, 'Original MP4 or WebM · annotations are separate overlays. Video URLs and streaming services are not supported.');
    this.panel.append(heading, this.frame, controls, this.discussButton, this.info, this.caption, this.privacy);
    document.querySelector('#app').append(this.panel);
    this.app.stats.video = {selected: false, approved: false};
    this.openButton.onclick = () => this.input.click();
    this.input.onchange = () => { const file = this.input.files?.[0]; this.input.value = ''; if (file) void this.open(file); };
    this.remove.onclick = () => this.close();
    this.rewind.onclick = () => this.command({kind: 'rewind', seconds: 5}).catch(error => this.showError(error));
    this.speed.onchange = () => this.command({kind: 'rate', rate: Number(this.speed.value)}).catch(error => this.showError(error));
    this.discussButton.onclick = () => this.discuss();
    this.video.addEventListener('play', () => this.clearMarks());
    this.video.addEventListener('seeking', () => this.clearMarks());
    this.resizeObserver = new ResizeObserver(() => this.layout()); this.resizeObserver.observe(this.frame);
    this.app.native.videoHandler = (action, valid) => this.apply(action, valid);
    this.app.native.videoCancelHandler = identity => this.cancel(identity);
    window.addEventListener('pagehide', () => this.close());
  }

  waitEvent(name, timeout = 8000) {
    return new Promise((resolve, reject) => {
      const settle = error => { clearTimeout(timer); this.video.removeEventListener(name, ok); this.video.removeEventListener('error', failed); this.waiters.delete(cancel); error ? reject(error) : resolve(); };
      const ok = () => settle();
      const failed = () => settle(new Error('The browser could not decode this video.'));
      const cancel = () => settle(new Error('The selected video changed.'));
      const timer = setTimeout(() => settle(new Error('Video operation timed out.')), timeout);
      this.waiters.add(cancel); this.video.addEventListener(name, ok, {once: true}); this.video.addEventListener('error', failed, {once: true});
    });
  }
  showError(error) { this.info.textContent = error.message; this.info.dataset.state = 'error'; }

  async open(file) {
    this.close(); const serial = ++this.serial;
    this.panel.hidden = false; document.body.classList.add('video-visible');
    this.title.textContent = file?.name || 'Selected video'; this.info.textContent = 'Opening the original video in this browser…';
    try {
      if (!(file instanceof File) || file.size < 32 || file.size > 80 * 1024 * 1024 || !/\.(mp4|webm)$/i.test(file.name) || /[\u0000-\u001f\u007f]/.test(file.name)) throw new Error('Choose an MP4 or WebM video of at most 80 MB.');
      const bytes = await file.arrayBuffer(); if (serial !== this.serial) return;
      const prefix = new Uint8Array(bytes, 0, 16);
      const webm = prefix[0] === 0x1a && prefix[1] === 0x45 && prefix[2] === 0xdf && prefix[3] === 0xa3;
      const mp4 = String.fromCharCode(...prefix.slice(4, 8)) === 'ftyp';
      if (!webm && !mp4) throw new Error('The file header is not a supported video container.');
      const id = await digest(bytes); if (serial !== this.serial) return;
      this.url = URL.createObjectURL(file); this.file = file;
      const ready = this.waitEvent('loadedmetadata'); this.video.src = this.url; this.video.load(); await ready;
      if (serial !== this.serial) return;
      if (!Number.isFinite(this.video.duration) || this.video.duration <= 0 || this.video.duration > 600) throw new Error('This workspace supports finite videos of up to ten minutes.');
      if (!this.video.videoWidth || !this.video.videoHeight || this.video.videoWidth > 4096 || this.video.videoHeight > 4096 || this.video.videoWidth * this.video.videoHeight > 8_294_400) throw new Error('Video dimensions exceed the 4K rendering budget.');
      this.manifest = {id, name: file.name.slice(0, 180), bytes: file.size, duration: this.video.duration, width: this.video.videoWidth, height: this.video.videoHeight};
      this.info.textContent = `Original video ready · ${this.video.duration.toFixed(1)} seconds. Not shared with the conversation.`;
      this.info.dataset.state = 'ready'; this.speed.value = '1'; this.video.playbackRate = 1; this.layout(); this.discussButton.disabled = false;
      this.app.stats.video = {selected: true, approved: false, ...this.manifest};
    } catch (error) {
      if (serial !== this.serial) return;
      this.closeSource(); this.showError(error);
    }
  }

  layout() {
    if (!this.video.videoWidth) return;
    if (this.overlay.width !== this.video.videoWidth) this.overlay.width = this.video.videoWidth;
    if (this.overlay.height !== this.video.videoHeight) this.overlay.height = this.video.videoHeight;
    this.frame.style.aspectRatio = `${this.video.videoWidth}/${this.video.videoHeight}`;
    this.paintMarks();
  }
  updateProcessingNotice() { this.privacy.textContent = sourceProcessingNotice(this.app.stats.nativeStatus, 'video'); }
  paintMarks() {
    const c = this.overlay.getContext('2d'); c.clearRect(0, 0, this.overlay.width, this.overlay.height);
    if (!this.annotation) return;
    const {region: [x, y, w, h], label} = this.annotation;
    const width = this.overlay.width, height = this.overlay.height;
    c.lineWidth = Math.max(3, width / 300); c.strokeStyle = '#b2481e'; c.fillStyle = 'rgba(235,149,57,.08)';
    c.fillRect(x * width, y * height, w * width, h * height); c.strokeRect(x * width, y * height, w * width, h * height);
    if (label) {
      const font = Math.max(14, width / 55); c.font = `${font}px system-ui`;
      const tx = Math.max(4, x * width), ty = Math.max(font + 6, y * height - 6);
      c.fillStyle = '#fffbed'; c.fillRect(tx - 3, ty - font, Math.min(c.measureText(label).width + 8, width - tx), font + 5);
      c.fillStyle = '#78341b'; c.fillText(label, tx, ty - 2, Math.max(1, width - tx - 4));
    }
  }
  clearMarks() {
    clearPresentationFocus(this.app.stage, this);
    this.annotation = null; this.lastRead = null; this.paintMarks();
    this.app.stats.video.markCount = 0;
  }

  async command(action, valid = () => true) {
    if (!this.manifest) throw new Error('No valid video is selected.');
    if (!valid() || this.busy) throw new Error('A video operation is still running or was interrupted.');
    if (++this.operations > 100) throw new Error('Video action budget reached. Close and reopen the file to continue.');
    const serial = this.serial, command = ++this.commandSerial, previous = this.video.currentTime;
    this.busy = true;
    try {
      if (action.kind === 'pause' || action.kind === 'hide') this.video.pause();
      else if (action.kind === 'play') await this.video.play();
      else if (action.kind === 'seek' || action.kind === 'rewind') {
        if (!Number.isFinite(action.seconds) || action.seconds < 0) throw new Error('Invalid video time.');
        const seconds = action.kind === 'rewind' ? Math.max(0, previous - action.seconds) : action.seconds;
        if (!Number.isFinite(seconds) || seconds < 0 || seconds > this.video.duration) throw new Error('Requested position is outside this video.');
        this.video.pause();
        if (Math.abs(this.video.currentTime - seconds) > .01) { const seek = this.waitEvent('seeked'); this.video.currentTime = seconds; await seek; }
      } else if (action.kind === 'rate') {
        if (![.5, .75, 1, 1.25, 1.5].includes(action.rate)) throw new Error('Unsupported playback speed.');
        this.video.playbackRate = action.rate; this.speed.value = String(action.rate);
      } else throw new Error('Unknown video operation.');
      if (serial !== this.serial || !valid()) throw new Error('The video action was cancelled.');
      if (action.kind === 'hide') { this.panel.hidden = true; document.body.classList.remove('video-visible'); clearPresentationFocus(this.app.stage, this); }
      else { this.panel.hidden = false; document.body.classList.add('video-visible'); }
      await nextFrame(); if (serial !== this.serial || !valid()) throw new Error('The video action was cancelled.');
      const receipt = {time: this.video.currentTime, previous_time: previous, duration: this.video.duration, paused: this.video.paused, rate: this.video.playbackRate};
      this.app.stats.video = {...this.app.stats.video, ...receipt}; return receipt;
    } catch (error) {
      // A late failure from an old file must never stop its replacement.
      if (serial === this.serial && command === this.commandSerial) this.video.pause();
      throw error;
    } finally { if (serial === this.serial && command === this.commandSerial) this.busy = false; }
  }

  async snapshot(valid = () => true) {
    const serial = this.serial;
    await this.command({kind: 'pause'}, valid);
    if (this.video.readyState < 2) await this.waitEvent('loadeddata');
    if (serial !== this.serial || !valid()) throw new Error('Frame inspection was cancelled.');
    const stamp = this.video.currentTime;
    const scale = Math.min(1, 1024 / this.video.videoWidth, 768 / this.video.videoHeight);
    const canvas = document.createElement('canvas'); canvas.width = Math.round(this.video.videoWidth * scale); canvas.height = Math.round(this.video.videoHeight * scale);
    canvas.getContext('2d', {alpha: false}).drawImage(this.video, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/jpeg', .8).split(',')[1];
    if (data.length > 350000) throw new Error('The selected frame exceeds the inspection payload limit.');
    const bytes = Uint8Array.from(atob(data), value => value.charCodeAt(0));
    const hash = await digest(bytes);
    if (serial !== this.serial || !valid() || !this.video.paused || Math.abs(this.video.currentTime - stamp) > .001) throw new Error('Frame inspection was cancelled or the playhead changed.');
    this.lastRead = {time: stamp, serial, hash};
    return {time: stamp, width: canvas.width, height: canvas.height, mime_type: 'image/jpeg', data, hash};
  }

  async discuss() {
    if (!this.manifest || this.discussButton.disabled) return;
    const serial = this.serial; this.discussButton.disabled = true;
    this.info.textContent = 'Preparing the approved conversation…';
    try {
      const native = this.app.native;
      if (native.connecting) throw new Error('The voice connection is still starting. Please wait.');
      if (!native.active) {
        if (!this.app.stats.nativeStatus?.available) throw new Error('Native voice is not currently available. The selected file remains local.');
        document.querySelector('#conversation-engine').value = 'native';
        await native.start({microphone: false, voice: document.querySelector('#native-voice').value, accent: document.querySelector('#native-accent').value, publicWeb: document.querySelector('#public-web')?.checked === true});
      }
      if (serial !== this.serial || !this.manifest) return;
      if (this.sharedSession !== native.serial) this.appliedRevision = 0;
      this.approved = true; this.sharedSession = native.serial; this.app.stats.video.approved = true;
      native.offerVideo({...this.manifest, approved: true});
      native.sendText('I selected a video and approve requested frame inspection for this conversation. Inspect its first frame, describe only what is actually visible in one short sentence, and pause for my question. Do not infer its content from its filename.');
      this.info.textContent = 'Frame sharing approved for this conversation. The video file and its audio remain in this browser.';
    } catch (error) {
      if (serial === this.serial) { this.revoke(); this.showError(error); }
    }
    finally { if (serial === this.serial) this.discussButton.disabled = !this.manifest; }
  }

  async apply(action, valid) {
    if (!action || typeof action.action_id !== 'string' || !Number.isSafeInteger(action.revision) || !this.approved || !this.app.native.active || this.sharedSession !== this.app.native.serial || !this.manifest || action.video_id !== this.manifest.id || !valid() || action.revision <= this.appliedRevision || this.activeAction) throw new Error('This video action does not belong to the approved conversation.');
    const serial = this.serial, operation = ++this.actionSerial;
    this.activeAction = action.action_id;
    const current = () => serial === this.serial && operation === this.actionSerial && valid() && this.app.native.active && this.sharedSession === this.app.native.serial && this.approved;
    try {
    let result;
    if (action.kind === 'inspect') {
      if (action.seconds !== undefined) await this.command({kind: 'seek', seconds: action.seconds}, current);
      const frame = await this.snapshot(current);
      result = {time: frame.time, paused: true, rate: this.video.playbackRate, image: {mime_type: frame.mime_type, data: frame.data}};
      this.app.stats.video.inspectedFrameTime = frame.time;
    } else if (action.kind === 'mark') {
      await this.command({kind: 'seek', seconds: action.time}, current);
      const frame = await this.snapshot(current);
      if (frame.hash !== action.frame_hash) throw new Error('The source frame no longer matches the inspected image.');
      const [x, y, w, h] = action.region || [];
      if (!Array.isArray(action.region) || action.region.length !== 4 || ![x, y, w, h].every(Number.isFinite) || x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1.00001 || y + h > 1.00001 || typeof action.label !== 'string' || action.label.length > 100 || /[\u0000-\u001f\u007f]/.test(action.label)) throw new Error('Invalid source-frame annotation.');
      this.annotation = {region: action.region, label: action.label}; this.paintMarks();
      await nextFrame(); if (!current()) { this.clearMarks(); throw new Error('Annotation was cancelled.'); }
      this.pointAt(action.region);
      this.app.stats.video.markCount = 1;
      result = {time: frame.time, paused: true, frame_hash: frame.hash, rate: this.video.playbackRate};
    } else result = await this.command(action, current);
    if (!current()) throw new Error('The video action was cancelled.');
    this.appliedRevision = action.revision;
    this.info.textContent = `${action.kind === 'inspect' ? 'Original frame returned for inspection' : 'Video action applied'} · ${Number(result.time).toFixed(2)} s`;
    return {action_id: action.action_id, video_id: action.video_id, revision: action.revision, ok: true, ...result};
    } finally { if (operation === this.actionSerial) this.activeAction = null; }
  }

  pointAt(region) {
    const stage = this.app.stage;
    if (!stage?.camera) return;
    const rect = this.video.getBoundingClientRect();
    const x = rect.left + (region[0] + region[2] / 2) * rect.width, y = rect.top + (region[1] + region[3] / 2) * rect.height;
    const point = new THREE.Vector3(x / innerWidth * 2 - 1, 1 - y / innerHeight * 2, .5).unproject(stage.camera);
    const ray = point.sub(stage.camera.position).normalize();
    setPresentationFocus(stage, stage.camera.position.clone().addScaledVector(ray, 3), this);
  }

  revoke() {
    const wasShared = this.approved || this.sharedSession != null;
    this.cancel(); this.appliedRevision = 0;
    this.approved = false; this.sharedSession = null; this.app.stats.video.approved = false;
    if (wasShared) this.app.native.revokeVideo?.();
    this.video.pause(); this.clearMarks();
  }
  cancel(identity) {
    if (identity !== undefined && identity !== this.activeAction) return;
    this.actionSerial++; this.commandSerial++; this.activeAction = null;
    for (const cancel of [...this.waiters]) cancel();
    this.busy = false; this.video.pause(); this.clearMarks();
  }
  closeSource() {
    this.cancel();
    this.video.pause(); this.video.removeAttribute('src'); this.video.load();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null; this.file = null; this.manifest = null; this.approved = false; this.sharedSession = null;
    this.lastRead = null; this.annotation = null; this.operations = 0; this.busy = false; this.appliedRevision = 0;
    this.discussButton.disabled = true; this.paintMarks(); this.app.stats.video = {selected: false, approved: false};
  }
  close() {
    this.serial++; if (this.approved) this.app.native.revokeVideo?.();
    this.closeSource(); this.panel.hidden = true; document.body.classList.remove('video-visible');
  }
}
