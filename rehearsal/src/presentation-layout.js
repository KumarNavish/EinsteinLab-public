import './presentation-layout.css';

/** Keep real controls, captions and source material in separate occupied bands.
 * Uses measured geometry rather than another stack of breakpoint offsets.
 * No transcript, voice mode, model, file or provider state is changed.
 */
export class PresentationLayout {
  constructor(root = document.querySelector('#experience')) {
    this.root = root;
    this.dock = root?.querySelector('.conversation-dock');
    this.footer = root?.querySelector('.quiet-footer');
    this.caption = root?.querySelector('.caption-region');
    this.pending = 0; this.closed = false;
    if (!root || !this.dock || !this.footer || !this.caption) return;
    this.observer = new ResizeObserver(() => this.request());
    for (const element of [root, this.dock, this.footer, this.caption]) this.observer.observe(element);
    this.mutations = new MutationObserver(() => this.request());
    this.mutations.observe(document.body, {attributes: true, attributeFilter: ['class']});
    this.mutations.observe(this.dock, {subtree: true, childList: true, attributes: true, attributeFilter: ['hidden']});
    this.mutations.observe(this.caption, {subtree: true, childList: true, characterData: true});
    this.resize = () => this.request();
    window.addEventListener('resize', this.resize);
    window.visualViewport?.addEventListener('resize', this.resize);
    window.addEventListener('pagehide', () => this.dispose(), {once: true});
    this.request();
  }

  set(name, value) {
    const text = Math.ceil(value) + 'px';
    if (this.root.style.getPropertyValue(name) !== text) this.root.style.setProperty(name, text);
  }

  request() {
    if (this.closed || this.pending) return;
    this.pending = requestAnimationFrame(() => { this.pending = 0; this.measure(); });
  }

  measure() {
    if (this.closed || !this.root) return;
    const root = this.root.getBoundingClientRect();
    const footer = this.footer.getBoundingClientRect();
    // A wrapping footer must not sit underneath the microphone button.
    const footerVisible = footer.height > 0 && getComputedStyle(this.footer).display !== 'none';
    this.set('--voice-control-floor', footerVisible ? Math.max(28, root.bottom - footer.top + 10) : 28);
    const dock = this.dock.getBoundingClientRect();
    this.set('--spoken-caption-floor', Math.max(110, root.bottom - dock.top + 14));
    const caption = this.caption.getBoundingClientRect();
    const hasCaption = this.caption.textContent.trim() && getComputedStyle(this.caption).display !== 'none';
    const materialFloor = root.bottom - (hasCaption ? caption.top : dock.top) + 16;
    // Published to the app so independently positioned PDF/video panels can use it.
    const floor = Math.ceil(Math.max(145, materialFloor)) + 'px';
    if (document.documentElement.style.getPropertyValue('--presentation-floor') !== floor) document.documentElement.style.setProperty('--presentation-floor', floor);
    this.root.dataset.layoutReady = 'true';
  }

  dispose() {
    this.closed = true;
    if (this.pending) cancelAnimationFrame(this.pending);
    this.observer?.disconnect(); this.mutations?.disconnect();
    window.removeEventListener('resize', this.resize);
    window.visualViewport?.removeEventListener('resize', this.resize);
  }
}

if (typeof document !== 'undefined') new PresentationLayout();
