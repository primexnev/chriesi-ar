/**
 * The journey's screen layer, kept small on purpose: one hint card at the bottom that shows
 * the gesture with a moving hand and says it in words, a progress ring for hold / rub /
 * circle, praise in the middle, and one big «Weiter» button when a child needs help.
 */
export type HintKind = 'tap' | 'up' | 'down' | 'left' | 'right' | 'side' | 'hold' | 'rub' | 'circle';

const el = (tag: string, cls: string, text = ''): HTMLElement => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
};

export class JourneyUI {
  private readonly root = el('div', 'journey-ui');
  private readonly card = el('div', 'journey-hint');
  private readonly gesture = el('div', 'journey-gesture');
  private readonly hand = el('span', 'journey-hand', '👆');
  private readonly text = el('p', 'journey-text');
  private readonly help = el('button', 'journey-help', 'Weiter') as HTMLButtonElement;
  private readonly toast = el('div', 'journey-toast');
  private onHelp: (() => void) | null = null;
  private toastTimer = 0;

  constructor(parent: HTMLElement) {
    this.hand.setAttribute('aria-hidden', 'true');
    this.text.setAttribute('aria-live', 'polite');
    this.gesture.append(this.hand);
    this.card.append(this.gesture, this.text);
    this.help.type = 'button';
    this.help.hidden = true;
    this.help.addEventListener('click', () => this.onHelp?.());
    this.root.append(this.card, this.help, this.toast);
    parent.appendChild(this.root);
  }

  hint(kind: HintKind, text: string): void {
    this.gesture.dataset.kind = kind;
    this.text.textContent = text;
    this.progress(0);
    this.card.classList.add('is-visible');
  }

  hideHint(): void {
    this.card.classList.remove('is-visible');
  }

  progress(p: number): void {
    this.gesture.style.setProperty('--p', String(p));
  }

  /** A gesture that was not the one asked for: a soft wiggle, never a red cross. */
  nudge(): void {
    this.card.classList.remove('is-nudge');
    void this.card.offsetWidth;
    this.card.classList.add('is-nudge');
  }

  showHelp(fn: () => void): void {
    this.onHelp = fn;
    this.help.hidden = false;
  }

  hideHelp(): void {
    this.onHelp = null;
    this.help.hidden = true;
  }

  praise(text: string): void {
    clearTimeout(this.toastTimer);
    this.toast.textContent = text;
    this.toast.classList.add('is-visible');
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('is-visible'), 1100);
  }

  /** Start card with one button. */
  title(): Promise<void> {
    return this.card2(
      'Chriesi-Reise',
      'Geh den Weg, pflück Kirschen und koch Konfi in der Chriesi-Chuchi. Du kannst nichts falsch machen!',
      [['Los geht’s', 'go']],
    ).then(() => undefined);
  }

  finale(): Promise<'again' | 'story'> {
    return this.card2('Geschafft!', 'Drei Gläser Chriesi-Konfi. Toll gemacht!', [
      ['Nochmal', 'again'],
      ['Zur Geschichte', 'story'],
    ]);
  }

  dispose(): void {
    clearTimeout(this.toastTimer);
    this.root.remove();
  }

  private card2<T extends string>(title: string, body: string, buttons: Array<[string, T]>): Promise<T> {
    return new Promise((resolve) => {
      const box = el('div', 'journey-card');
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-label', title);
      box.append(el('h2', 'journey-card-title', title), el('p', 'journey-card-body', body));
      buttons.forEach(([label, value], i) => {
        const b = el('button', i === 0 ? 'journey-btn' : 'journey-btn is-quiet', label) as HTMLButtonElement;
        b.type = 'button';
        b.addEventListener('click', () => {
          box.remove();
          resolve(value);
        });
        box.append(b);
      });
      this.root.append(box);
      (box.querySelector('button') as HTMLButtonElement).focus();
    });
  }
}
