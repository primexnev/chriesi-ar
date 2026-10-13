import { ICONS, type IconName } from './icons';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (html) e.innerHTML = html;
  return e;
}

/**
 * Start screen. The big play button is the one gesture that unlocks audio and
 * triggers the camera permission prompt. `onStart` runs synchronously in the tap.
 */
export function showStartScreen(root: HTMLElement, onStart: () => void): void {
  const screen = el('section', 'overlay start-screen');
  screen.innerHTML = `
    <div class="start-art">${ICONS.cherries}</div>
    <button class="btn-start" type="button" aria-label="Geschichte starten">${ICONS.play}</button>
    <p class="parent-hint" lang="de">
      <span class="hint-icon">${ICONS.soundOn}</span> Ton an
      <span class="hint-sep">·</span>
      <span class="hint-icon">${ICONS.camera}</span> Kamera auf die Doppelseite
    </p>`;
  const btn = screen.querySelector('button')!;
  btn.addEventListener(
    'click',
    () => {
      onStart();
      screen.classList.add('is-leaving');
      setTimeout(() => screen.remove(), 400);
    },
    { once: true },
  );
  root.appendChild(screen);
  btn.focus();
}

export class Loading {
  private elm = el('div', 'overlay loading', `<div class="loading-cherry">${ICONS.cherries}</div>`);

  constructor(private readonly root: HTMLElement) {
    this.elm.setAttribute('role', 'progressbar');
    this.elm.setAttribute('aria-label', 'Lädt');
  }

  show(): void {
    this.root.appendChild(this.elm);
  }

  hide(): void {
    this.elm.remove();
  }
}

/** "Point the phone at the double page" hint, animated, no text. */
export class ScanHint {
  private elm = el('div', 'scan-hint', ICONS.scan);

  constructor(private readonly root: HTMLElement) {
    this.elm.setAttribute('role', 'img');
    this.elm.setAttribute('aria-label', 'Handy auf die Doppelseite richten');
  }

  show(): void {
    if (!this.elm.isConnected) this.root.appendChild(this.elm);
  }

  hide(): void {
    this.elm.remove();
  }
}

/** Short notice for the parent (icon + one line). Never blocks: the story goes on. */
export function notify(root: HTMLElement, icon: IconName, text: string, ms = 5000): void {
  const n = el('div', 'notice', `<span class="notice-icon">${ICONS[icon]}</span><span lang="de">${text}</span>`);
  n.setAttribute('role', 'status');
  root.appendChild(n);
  setTimeout(() => {
    n.classList.add('is-leaving');
    setTimeout(() => n.remove(), 400);
  }, ms);
}

/** Blocking error with a single action (only for unrecoverable cases, e.g. GPU context lost). */
export function showFatal(root: HTMLElement, text: string, actionLabel: string, action: () => void): void {
  const screen = el('section', 'overlay fatal');
  screen.innerHTML = `<div class="start-art">${ICONS.cherries}</div><p lang="de">${text}</p>`;
  const btn = el('button', 'btn-round', ICONS.replay);
  btn.type = 'button';
  btn.setAttribute('aria-label', actionLabel);
  btn.addEventListener('click', action);
  screen.appendChild(btn);
  root.appendChild(screen);
}
