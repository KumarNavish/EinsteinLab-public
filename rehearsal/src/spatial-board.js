import * as THREE from 'three';
import {setPresentationFocus, clearPresentationFocus} from './embodied-attention.js';
import {layoutDiagram, arrowRoute, extendsDiagram} from './diagram-layout.js';
import {paintSourcePassage} from './source-passage-painter.js';

const W = 1600, H = 1000;
const ink = '#24342f', accent = '#52765e', muted = '#64736a';
const genericCaption = 'Conceptual explanation, not experimental evidence.';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** A real scene object painted from bounded graph data; never arbitrary HTML or URLs. */
export class SpatialBoard {
  constructor(stage, stats) {
    this.stage = stage; this.stats = stats; this.serial = 0; this.committed = null;
    this.canvas = document.createElement('canvas'); this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas); this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = Math.min(8, stage.renderer.capabilities.getMaxAnisotropy());
    this.group = new THREE.Group(); this.group.name = 'ResearchWhiteboard';
    this.group.position.set(1.30, 1.34, -.30);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.94, 1.2125), new THREE.MeshBasicMaterial({map: this.texture, side: THREE.DoubleSide, toneMapped: false}));
    this.mesh.name = 'AcknowledgedConceptualDiagram'; this.mesh.renderOrder = 2;
    const backing = new THREE.Mesh(new THREE.BoxGeometry(1.96, 1.2325, .025), new THREE.MeshStandardMaterial({color: '#bdc8b8', roughness: .95}));
    backing.position.z = -.023; backing.castShadow = true;
    this.group.add(backing, this.mesh); stage.actor.add(this.group); this.group.visible = false;
    this.renderCount = 0; this.mesh.onAfterRender = () => { this.renderCount++; };
    this.label = document.createElement('button'); this.label.id = 'read-diagram';
    this.label.className = 'diagram-read'; this.label.textContent = 'Read the diagram'; this.label.hidden = true;
    document.querySelector('#app').append(this.label);
    this.dialog = document.createElement('dialog'); this.dialog.className = 'diagram-dialog'; this.dialog.id = 'diagram-dialog';
    this.dialog.setAttribute('aria-label', 'Conceptual research diagram');
    const close = document.createElement('button'); close.textContent = 'Close'; close.className = 'secondary-button';
    close.addEventListener('click', () => this.dialog.close());
    this.heading = document.createElement('h2'); this.image = document.createElement('canvas'); this.image.width = W; this.image.height = H;
    this.description = document.createElement('p'); this.description.className = 'diagram-description';
    this.textList = document.createElement('ol'); this.textList.className = 'diagram-text-list';
    this.sourceList = document.createElement('div'); this.sourceList.className = 'diagram-sources';
    this.dialog.append(close, this.heading, this.image, this.textList, this.description, this.sourceList); document.body.append(this.dialog);
    this.outline = document.createElement('section'); this.outline.id = 'teaching-outline'; this.outline.hidden = true;
    this.outline.setAttribute('aria-label', 'Explanation in progress');
    this.outlineTitle = document.createElement('h2'); this.outlineList = document.createElement('ol');
    this.outlineList.className = 'diagram-text-list'; this.outline.append(this.outlineTitle, this.outlineList);
    document.querySelector('#app').append(this.outline);
    window.addEventListener('resize', () => {
      if (this.group.visible) this.compose();
    });
    this.label.onclick = () => { this.syncAccessible(); if (!this.dialog.open) this.dialog.showModal(); };
    this.stats.visual = {visible: false, revision: 0};
  }

  bounds(node) {
    return this.layout?.boxes[node.id] || {x: 0, y: 0, width: 240, height: 128};
  }

  wrap(text, x, y, maxWidth, lineHeight, maxLines = 3) {
    const words = String(text).split(/\s+/); let line = '', lines = [];
    for (const word of words) {
      if (this.ctx.measureText((line + ' ' + word).trim()).width > maxWidth && line) { lines.push(line); line = word; }
      else line = (line + ' ' + word).trim();
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = lines[maxLines - 1].replace(/\s+\S*$/, '') + '…'; }
    for (let i = 0; i < lines.length; i++) this.ctx.fillText(lines[i], x, y + i * lineHeight, maxWidth);
    return lines.length;
  }

  draw(graph, count = Infinity, focus = null, annotation = '') {
    const c = this.ctx; this.layout = layoutDiagram(graph.nodes);
    c.clearRect(0, 0, W, H); c.fillStyle = '#fafaf4'; c.fillRect(0, 0, W, H);
    c.fillStyle = accent; c.font = '600 20px system-ui'; c.textAlign = 'left';
    c.fillText('CONCEPTUAL EXPLANATION', 64, 57);
    c.fillStyle = ink; c.font = '44px Georgia'; this.wrap(graph.title, 64, 125, 1460, 50, 2);
    const visible = new Set(graph.nodes.slice(0, count).map(node => node.id));
    const edgeKinds = new Set();
    c.lineWidth = 4;
    for (let i = 0; i < graph.edges.length; i++) {
      const edge = graph.edges[i];
      if (count < graph.nodes.length + i + 1 || !visible.has(edge.from) || !visible.has(edge.to)) continue;
      edgeKinds.add(edge.kind);
      const a = this.bounds(graph.nodes.find(node => node.id === edge.from));
      const b = this.bounds(graph.nodes.find(node => node.id === edge.to));
      const route = arrowRoute(a, b, i);
      c.strokeStyle = focus === edge.id ? '#b15c39' : '#6f866f'; c.fillStyle = c.strokeStyle;
      c.lineWidth = focus === edge.id ? 6 : 3;
      c.setLineDash(edge.kind === 'causal-hypothesis' ? [12, 9] : edge.kind === 'association' ? [3, 8] : []);
      c.beginPath(); c.moveTo(route.start.x, route.start.y);
      if (route.kind === 'arch') c.bezierCurveTo(route.control1.x, route.control1.y, route.control2.x, route.control2.y, route.end.x, route.end.y);
      else c.lineTo(route.end.x, route.end.y);
      c.stroke(); c.setLineDash([]);
      const {x: ux, y: uy} = route.endDirection, end = route.end;
      c.beginPath(); c.moveTo(end.x, end.y); c.lineTo(end.x - ux * 15 - uy * 8, end.y - uy * 15 + ux * 8); c.lineTo(end.x - ux * 15 + uy * 8, end.y - uy * 15 - ux * 8); c.closePath(); c.fill();
      if (edge.label) {
        c.font = '21px system-ui'; c.textAlign = 'left';
        const width = Math.min(290, Math.max(190, Math.abs(route.end.x - route.start.x) - 45));
        const lx = route.label.x - width / 2, ly = route.label.y;
        c.fillStyle = '#fafaf4'; c.fillRect(lx - 6, ly - 22, width + 12, 54);
        c.fillStyle = muted; this.wrap(edge.label, lx, ly, width, 25, 2);
      }
    }
    for (const node of graph.nodes) {
      if (!visible.has(node.id)) continue;
      const r = this.bounds(node);
      c.fillStyle = node.id === focus ? '#e3edd7' : '#f0f3e9'; c.strokeStyle = node.id === focus ? '#b15c39' : '#aebfa5'; c.lineWidth = node.id === focus ? 5 : 2;
      c.beginPath(); c.roundRect(r.x, r.y, r.width, r.height, 14); c.fill(); c.stroke();
      c.fillStyle = ink; c.font = '500 26px system-ui'; c.textAlign = 'left';
      this.wrap(node.label, r.x + 18, r.y + 36, r.width - 36, 30, 3);
    }
    c.textAlign = 'left'; c.font = '23px system-ui'; c.fillStyle = focus ? '#8b4b33' : muted;
    const caption = annotation || (graph.caption === genericCaption ? '' : graph.caption);
    if (caption) this.wrap(caption, 64, 857, 1470, 31, 2);
    c.fillStyle = muted; c.font = '17px system-ui';
    if (edgeKinds.has('association') || edgeKinds.has('causal-hypothesis')) {
      const legend = [['information', 'Solid: information'], ['association', 'Dotted: association'],
        ['causal-hypothesis', 'Dashed: causal hypothesis']].filter(([kind]) => edgeKinds.has(kind)).map(([, label]) => label);
      c.fillText(legend.join('  ·  '), 64, 952);
    }
    const sourceCount = new Set(graph.sources.map(source => source.id || source.url)).size;
    c.textAlign = 'right'; if (sourceCount) c.fillText(`${sourceCount} cited source${sourceCount === 1 ? '' : 's'}`, 1536, 952);
    this.texture.needsUpdate = true;
    this.syncAccessible(graph);
  }

  syncAccessible(graph = this.graph) {
    if (this.passage) { this.syncPassageAccessible(); return; }
    if (!graph) return;
    this.dialog.dataset.view = 'diagram'; this.textList.hidden = false;
    this.renderText(this.textList, graph);
    this.outline.hidden = false; this.outlineTitle.textContent = graph.title;
    this.renderText(this.outlineList, graph);
    this.heading.textContent = graph.title;
    this.image.getContext('2d').drawImage(this.canvas, 0, 0);
    this.image.setAttribute('role', 'img'); this.image.setAttribute('aria-label', graph.nodes.map(n => n.label).join('; '));
    this.description.textContent = 'Conceptual explanation. ' + (graph.caption === genericCaption ? '' : graph.caption);
    this.sourceList.replaceChildren();
    for (const source of graph.sources || []) {
      let url; try { url = new URL(source.url); } catch { continue; }
      if (url.protocol !== 'https:' || url.username || url.password) continue;
      const link = document.createElement('a'); link.href = url.href; link.textContent = source.title || url.hostname;
      link.target = '_blank'; link.rel = 'noopener noreferrer'; this.sourceList.append(link);
    }
  }

  renderText(list, graph) {
    const focus = this.committed?.focus;
    list.replaceChildren(...graph.nodes.map(node => {
      const item = document.createElement('li'); item.dataset.elementId = node.id;
      item.classList.toggle('current-idea', node.id === focus);
      const title = document.createElement('h3'); title.textContent = node.label; item.append(title);
      const incoming = graph.edges.filter(edge => edge.to === node.id).map(edge => {
        const origin = graph.nodes.find(source => source.id === edge.from)?.label;
        return `${origin} → ${node.label}${edge.label ? ': ' + edge.label : ''}${edge.kind === 'causal-hypothesis' ? ' (hypothesis)' : edge.kind === 'association' ? ' (association)' : ''}`;
      });
      if (node.detail || incoming.length) {
        const detail = document.createElement('p'); detail.textContent = [node.detail, ...incoming].filter(Boolean).join(' · '); item.append(detail);
      }
      return item;
    }));
  }

  paintPassage() {
    this.passageLayout = paintSourcePassage(this.canvas, this.passage);
    this.texture.needsUpdate = true; this.syncPassageAccessible();
  }

  syncPassageAccessible() {
    const passage = this.passage;
    if (!passage) return;
    this.dialog.dataset.view = 'source'; this.textList.hidden = true; this.outline.hidden = true;
    this.heading.textContent = passage.title;
    this.image.getContext('2d').drawImage(this.canvas, 0, 0);
    this.image.setAttribute('role', 'img'); this.image.setAttribute('aria-label', passage.text);
    this.description.textContent = passage.scope + ' ' + passage.text;
    this.sourceList.replaceChildren();
    const link = document.createElement('a'); link.href = passage.url; link.textContent = 'Open original source';
    link.target = '_blank'; link.rel = 'noopener noreferrer'; this.sourceList.append(link);
  }

  compose() {
    this.stage.resize();
    if (!this.savedCamera) this.savedCamera = {position: this.stage.camera.position.clone(), target: this.stage.controls.target.clone()};
    if (this.stage.renderer.xr.isPresenting) return;
    const aspect = this.stage.camera.aspect;
    const distance = Math.max(3.5, 2.96 / (2 * Math.tan(THREE.MathUtils.degToRad(this.stage.camera.fov / 2)) * aspect));
    this.stage.controls.maxDistance = Math.max(4, distance + .5);
    this.stage.camera.position.set(.76, 1.43, distance);
    this.stage.controls.target.set(.76, 1.30, 0); this.stage.controls.update();
  }

  attention(elementId = null) {
    // A new whole diagram is not a request to wave at its centre. Wait until a
    // specific node/edge or a source passage has actually been selected.
    if (!elementId && !this.passageLayout?.boxes?.length) { clearPresentationFocus(this.stage, this); return; }
    let x = this.passageLayout && this.passage ? this.passageLayout.focus[0] : W / 2, y = this.passageLayout && this.passage ? this.passageLayout.focus[1] : H / 2;
    if (elementId && this.graph) {
      const node = this.graph.nodes.find(item => item.id === elementId);
      if (node) { const r = this.bounds(node); x = r.x + r.width / 2; y = r.y + r.height / 2; }
      else {
        const edge = this.graph.edges.find(item => item.id === elementId);
        if (edge) { const a = this.bounds(this.graph.nodes.find(n => n.id === edge.from)), b = this.bounds(this.graph.nodes.find(n => n.id === edge.to)); x = (a.x + b.x + a.width) / 2; y = (a.y + b.y + a.height) / 2; }
        else { clearPresentationFocus(this.stage, this); return; }
      }
    }
    this.group.updateWorldMatrix(true, false);
    const point = this.group.localToWorld(new THREE.Vector3((x / W - .5) * 1.94, (.5 - y / H) * 1.2125, .03));
    setPresentationFocus(this.stage, point, this);
    this.stats.visualTarget = point.toArray();
  }

  async paintReceipt(serial, valid) {
    const before = this.renderCount, until = performance.now() + 2500;
    while (performance.now() < until) {
      if (serial !== this.serial || !valid()) throw new Error('Visual operation interrupted');
      if (this.renderCount > before) return;
      await pause(20);
    }
    throw new Error('The scene did not render the visual before its deadline');
  }

  async apply(action, valid = () => true) {
    if (!action || !['diagram', 'focus', 'hide', 'inspect', 'source', 'phrase'].includes(action.kind) || !Number.isInteger(action.revision)) throw new Error('Invalid visual command');
    if (!valid()) throw new Error('Stale visual command');
    const serial = ++this.serial;
    this.pending = {action, serial};
    try {
      if (action.kind === 'diagram') {
        const extending = this.group.visible && extendsDiagram(this.graph, action.graph);
        this.passage = null; this.label.textContent = 'Read the diagram'; this.graph = action.graph; this.group.visible = true; document.body.classList.add('teaching-active'); this.compose(); this.attention();
        const total = this.graph.nodes.length + this.graph.edges.length;
        for (let count = extending ? total : 1; count <= total; count++) {
          if (serial !== this.serial || !valid()) throw new Error('Visual operation interrupted');
          this.draw(this.graph, count); await pause(matchMedia('(prefers-reduced-motion:reduce)').matches ? 0 : 85);
        }
        await this.paintReceipt(serial, valid);
        this.committed = {graph: this.graph, passage: null, focus: null, annotation: '', revision: action.revision}; this.label.hidden = false;
      } else if (action.kind === 'focus') {
        if (!this.graph) throw new Error('No diagram is visible');
        this.draw(this.graph, Infinity, action.element_id, action.annotation); this.attention(action.element_id);
        await this.paintReceipt(serial, valid);
        this.committed = {graph: this.graph, focus: action.element_id, annotation: action.annotation, revision: action.revision};
        this.renderText(this.textList, this.graph); this.renderText(this.outlineList, this.graph);
        if (matchMedia('(max-width:650px)').matches) {
          const active = [...this.outlineList.children].find(item => item.dataset.elementId === action.element_id);
          if (active) this.outline.scrollTop = Math.max(0, active.offsetTop - 16);
        }
      } else if (action.kind === 'source' || action.kind === 'phrase') {
        this.passage = action.passage; this.graph = null;
        this.group.visible = true; this.label.hidden = false; this.label.textContent = 'Read the source excerpt';
        document.body.classList.add('teaching-active'); this.compose();
        this.paintPassage(); this.attention();
        await this.paintReceipt(serial, valid);
        const textBytes = new TextEncoder().encode(this.passage.text);
        const hashBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', textBytes));
        const hash = [...hashBytes].map(value => value.toString(16).padStart(2, '0')).join('');
        if (hash !== this.passage.displayed_text_sha256) throw new Error('Rendered passage does not match its source hash');
        this.committed = {graph: null, passage: this.passage, focus: null, revision: action.revision};
      } else if (action.kind === 'inspect') {
        if ((!this.graph && !this.passage) || !this.group.visible) throw new Error('No displayed diagram to inspect');
        await this.paintReceipt(serial, valid);
      } else {
        this.hide();
        await pause(30);
        if (serial !== this.serial || !valid()) throw new Error('Visual operation interrupted');
        this.committed = null;
      }
      const result = {revision: action.revision, status: {diagram: 'displayed', focus: 'focused', hide: 'hidden', inspect: 'inspected', source: 'source-displayed', phrase: 'phrase-focused'}[action.kind],
        rendered_elements: this.graph ? this.graph.nodes.length + this.graph.edges.length : this.passage ? 1 : 0};
      this.stats.visual = {displayLayout: this.layout, visible: this.group.visible, revision: action.revision, title: this.graph?.title || this.passage?.title || '', graph: this.graph, passage: this.passage, passageLayout: this.passageLayout,
        focused: this.committed?.focus, acknowledgedRenderCount: this.renderCount};
      if (this.passage) {
        result.displayed_text_sha256 = this.passage.displayed_text_sha256;
        result.highlighted_quote = this.passage.quote;
      }
      if (action.kind === 'inspect') {
        const snapshot = document.createElement('canvas'); snapshot.width = 1280; snapshot.height = 800;
        snapshot.getContext('2d').drawImage(this.canvas, 0, 0, 1280, 800);
        result.image = {mime_type: 'image/jpeg', width: 1280, height: 800,
          data: snapshot.toDataURL('image/jpeg', .9).split(',')[1]};
        this.stats.visualImageInspections = (this.stats.visualImageInspections || 0) + 1;
      }
      return result;
    } catch (error) {
      if (serial === this.serial) this.restoreCommitted();
      throw error;
    } finally { if (this.pending?.serial === serial) this.pending = null; }
  }

  hide() {
    this.outline.hidden = true;
    this.group.visible = false; this.graph = null; this.passage = null; this.passageLayout = null; document.body.classList.remove('teaching-active'); this.label.hidden = true;
    if (this.dialog.open) this.dialog.close();
    clearPresentationFocus(this.stage, this);
    if (this.savedCamera && !this.stage.renderer.xr.isPresenting) {
      this.stage.camera.position.copy(this.savedCamera.position); this.stage.controls.target.copy(this.savedCamera.target);
      this.stage.controls.maxDistance = 4; this.stage.controls.update();
    }
    this.savedCamera = null;
  }

  restoreCommitted() {
    if (this.committed?.passage) {
      this.graph = null; this.passage = this.committed.passage;
      this.group.visible = true; this.label.hidden = false; this.label.textContent = 'Read the source excerpt';
      document.body.classList.add('teaching-active'); this.compose(); this.paintPassage(); this.attention();
    } else if (this.committed) {
      this.passage = null;
      this.graph = this.committed.graph; this.group.visible = true; document.body.classList.add('teaching-active'); this.label.hidden = false;
      this.compose(); this.draw(this.graph, Infinity, this.committed.focus, this.committed.annotation); this.attention(this.committed.focus);
    } else this.hide();
  }

  cancelPending(actionId = null) {
    if (!this.pending || (actionId && this.pending.action.action_id !== actionId)) return;
    this.serial++; this.pending = null; this.restoreCommitted();
  }

  reset() {
    this.serial++; this.pending = null; this.committed = null; this.hide();
    this.stats.visual = {visible: false, revision: 0};
  }
}
