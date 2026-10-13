import { ICONS, type IconName } from './icons';

interface ButtonSpec {
  icon: IconName;
  label: string;
  onClick: () => void;
}

/** Icon-only buttons. German aria-labels for screen readers / parents. */
export class Hud {
  readonly el: HTMLElement;
  private top: HTMLElement;
  private center: HTMLElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.top = document.createElement('div');
    this.top.className = 'hud-top';
    this.center = document.createElement('div');
    this.center.className = 'hud-center';
    this.el.append(this.top, this.center);
    parent.appendChild(this.el);
  }

  /** Small corner button. Returns the element so the caller can update its icon. */
  addCorner(spec: ButtonSpec): HTMLButtonElement {
    const b = this.button(spec, 'btn-icon');
    this.top.appendChild(b);
    return b;
  }

  /** Large, centred call-to-action button (e.g. replay, switch to 3D). */
  showAction(spec: ButtonSpec): HTMLButtonElement {
    const b = this.button(spec, 'btn-round');
    this.center.appendChild(b);
    return b;
  }

  clearActions(): void {
    this.center.replaceChildren();
  }

  static setIcon(b: HTMLButtonElement, icon: IconName, label: string): void {
    b.innerHTML = ICONS[icon];
    b.setAttribute('aria-label', label);
  }

  private button({ icon, label, onClick }: ButtonSpec, className: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = className;
    b.innerHTML = ICONS[icon];
    b.setAttribute('aria-label', label);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  }
}
