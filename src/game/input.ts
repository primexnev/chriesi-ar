import { ICONS } from '../ui/icons';

export type Dir = 'up' | 'down' | 'left' | 'right';

const DIRS: Dir[] = ['left', 'up', 'down', 'right'];
const KEYS: Record<string, Dir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
};
const ICON: Record<Dir, string> = { up: ICONS.arrowUp, down: ICONS.arrowDown, left: ICONS.arrowLeft, right: ICONS.arrowRight };
const LABEL: Record<Dir, string> = { up: 'Hoch', down: 'Runter', left: 'Links', right: 'Rechts' };
const SWIPE_MIN_PX = 36;

type Listener = (dir: Dir) => void;

/**
 * The four arrow buttons at the bottom of the screen, plus keyboard arrows (WASD) and
 * swipes on the canvas. Every source reports the same `Dir`; the game never cares which.
 */
export class ArrowPad {
  readonly el: HTMLElement;
  private buttons = new Map<Dir, HTMLButtonElement>();
  private listeners = new Set<Listener>();
  private enabled = new Set<Dir>(DIRS);
  private swipe: { x: number; y: number; id: number } | null = null;

  constructor(parent: HTMLElement, private readonly swipeEl: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'arrow-pad';
    for (const dir of DIRS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `arrow-btn arrow-${dir}`;
      b.innerHTML = ICON[dir];
      b.setAttribute('aria-label', LABEL[dir]);
      // pointerdown, not click: a race needs the press to count the moment the finger lands.
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.emit(dir);
      });
      b.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.emit(dir);
        }
      });
      this.buttons.set(dir, b);
      this.el.appendChild(b);
    }
    parent.appendChild(this.el);
    window.addEventListener('keydown', this.onKey);
    swipeEl.addEventListener('pointerdown', this.onSwipeStart);
    swipeEl.addEventListener('pointerup', this.onSwipeEnd);
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Resolves on the next press of one of `dirs` (any arrow when omitted). */
  next(dirs: Dir[] = DIRS): Promise<Dir> {
    return new Promise((resolve) => {
      const off = this.on((d) => {
        if (!dirs.includes(d)) return;
        off();
        resolve(d);
      });
    });
  }

  /** Only these arrows are shown as active; the others are dimmed and ignored. */
  only(dirs: Dir[]): void {
    this.enabled = new Set(dirs);
    for (const [d, b] of this.buttons) b.classList.toggle('is-off', !this.enabled.has(d));
  }

  /** The arrow the game expects now (read by the `?autoplay` review pilot). */
  want: Dir | null = null;

  /** The arrow the player should press now; `show` adds the pulsing highlight. */
  hint(dir: Dir | null, show = true): void {
    this.want = dir;
    for (const [d, b] of this.buttons) b.classList.toggle('is-hint', show && d === dir);
  }

  /** Programmatic press, same path as a finger or key. */
  press(dir: Dir): void {
    this.emit(dir);
  }

  /** Short red shake on a wrong press. */
  shake(dir: Dir): void {
    const b = this.buttons.get(dir);
    if (!b) return;
    b.classList.remove('is-wrong');
    void b.offsetWidth;
    b.classList.add('is-wrong');
  }

  setVisible(on: boolean): void {
    this.el.classList.toggle('is-hidden', !on);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    this.swipeEl.removeEventListener('pointerdown', this.onSwipeStart);
    this.swipeEl.removeEventListener('pointerup', this.onSwipeEnd);
    this.listeners.clear();
    this.el.remove();
  }

  private emit(dir: Dir): void {
    if (!this.enabled.has(dir) || this.el.classList.contains('is-hidden')) return;
    const b = this.buttons.get(dir)!;
    b.classList.remove('is-pressed');
    void b.offsetWidth;
    b.classList.add('is-pressed');
    for (const fn of [...this.listeners]) fn(dir);
  }

  private onKey = (e: KeyboardEvent): void => {
    const dir = KEYS[e.key];
    if (!dir || e.repeat) return;
    e.preventDefault();
    this.emit(dir);
  };

  private onSwipeStart = (e: PointerEvent): void => {
    this.swipe = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };

  private onSwipeEnd = (e: PointerEvent): void => {
    const s = this.swipe;
    this.swipe = null;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN_PX) return;
    if (Math.abs(dx) > Math.abs(dy)) this.emit(dx > 0 ? 'right' : 'left');
    else this.emit(dy > 0 ? 'down' : 'up');
  };
}
