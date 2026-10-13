/** Subtitle line at the bottom of the screen. Every spoken line is shown here. */
export class Subtitles {
  readonly el: HTMLElement;
  private enabled = true;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'subtitles';
    this.el.setAttribute('aria-live', 'polite');
    this.el.setAttribute('role', 'status');
    parent.appendChild(this.el);
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.el.classList.toggle('is-off', !on);
  }

  show(text: string): void {
    this.el.textContent = text;
    this.el.classList.add('is-visible');
  }

  hide(): void {
    this.el.classList.remove('is-visible');
  }
}
