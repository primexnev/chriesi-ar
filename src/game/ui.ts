import { ICONS, type IconName } from '../ui/icons';
import type { Dir } from './input';

const ARROW: Record<Dir, IconName> = { up: 'arrowUp', down: 'arrowDown', left: 'arrowLeft', right: 'arrowRight' };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (html) e.innerHTML = html;
  return e;
}

export function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(1).padStart(4, '0')}`;
}

/** In-race overlay: stopwatch, stage name, place, counters, prompts and the timing gauge. */
export class GameHud {
  readonly el = el('div', 'game-hud');
  private timer = el('div', 'game-timer');
  private stage = el('div', 'game-stage');
  private place = el('div', 'game-place');
  private counter = el('div', 'game-counter');
  private prompt = el('div', 'game-prompt');
  private toastEl = el('div', 'game-toast');
  private gauge = el('div', 'game-gauge', '<i class="zone"></i><i class="needle"></i>');
  private track = el('div', 'game-track');
  private dots: HTMLElement[] = [];
  private toastTimer = 0;

  constructor(parent: HTMLElement) {
    const top = el('div', 'game-top');
    const left = el('div', 'game-top-left');
    left.append(this.timer, this.stage);
    top.append(left, this.place);
    this.el.append(top, this.track, this.counter, this.prompt, this.toastEl, this.gauge);
    this.el.setAttribute('aria-live', 'polite');
    parent.appendChild(this.el);
    this.setCounter(null);
    this.setGauge(null);
    this.setPlace(null);
  }

  setTime(s: number): void {
    this.timer.textContent = formatTime(s);
  }

  setStage(text: string): void {
    this.stage.textContent = text;
  }

  private shownPlace: number | null = null;

  setPlace(place: number | null, of = 5): void {
    this.place.hidden = place === null;
    if (place === null || place === this.shownPlace) return;
    // A little bump whenever the place changes.
    if (this.shownPlace !== null) {
      this.place.classList.remove('is-change');
      void this.place.offsetWidth;
      this.place.classList.add('is-change');
    }
    this.shownPlace = place;
    this.place.innerHTML = `<b>${place}.</b> von ${of}`;
  }

  setCounter(text: string | null, icon: IconName = 'cherries'): void {
    this.counter.hidden = text === null;
    if (text !== null) this.counter.innerHTML = `${ICONS[icon]}<span>${text}</span>`;
  }

  /** Big prompt in the middle: an arrow and/or a short word. */
  showPrompt(dir: Dir | null, text = ''): void {
    if (!dir && !text) {
      this.prompt.classList.remove('is-visible');
      return;
    }
    this.prompt.innerHTML = `${dir ? `<span class="prompt-arrow">${ICONS[ARROW[dir]]}</span>` : ''}${text ? `<span>${text}</span>` : ''}`;
    this.prompt.classList.add('is-visible');
  }

  toast(text: string, kind: 'good' | 'bad' = 'good', ms = 900): void {
    clearTimeout(this.toastTimer);
    this.toastEl.textContent = text;
    this.toastEl.className = `game-toast is-visible is-${kind}`;
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('is-visible'), ms);
  }

  /** Timing gauge: `value` 0…1 is the needle, `zone` the green band. null hides it. */
  setGauge(value: number | null, zone: [number, number] = [0.4, 0.6], vertical = false): void {
    this.gauge.hidden = value === null;
    if (value === null) return;
    this.gauge.classList.toggle('is-vertical', vertical);
    const z = this.gauge.children[0] as HTMLElement;
    const n = this.gauge.children[1] as HTMLElement;
    const prop = vertical ? 'bottom' : 'left';
    const size = vertical ? 'height' : 'width';
    z.style.cssText = `${prop}:${zone[0] * 100}%;${size}:${(zone[1] - zone[0]) * 100}%`;
    n.style.cssText = `${prop}:${value * 100}%`;
  }

  /** Mini course map: one dot per racer, 0…1 progress. Player first. */
  setTrack(progress: number[] | null): void {
    this.track.hidden = progress === null;
    if (!progress) return;
    while (this.dots.length < progress.length) {
      const d = el('i', this.dots.length ? 'dot' : 'dot is-player');
      this.track.appendChild(d);
      this.dots.push(d);
    }
    progress.forEach((p, i) => (this.dots[i].style.left = `${Math.min(1, Math.max(0, p)) * 100}%`));
  }

  setVisible(on: boolean): void {
    this.el.classList.toggle('is-hidden', !on);
  }

  dispose(): void {
    clearTimeout(this.toastTimer);
    this.el.remove();
  }
}

/** Title card before the race. Resolves when «Los geht's» is pressed. */
export function showTitle(parent: HTMLElement, best: number | null): Promise<void> {
  const screen = el('section', 'overlay game-title');
  screen.innerHTML = `
    <div class="game-card">
      <p class="cover-eyebrow">DAS SPIEL</p>
      <h1>Chriesisturm</h1>
      <p class="game-lead">Renn mit deiner Leiter durch Zug, pflück Chriesi und bring sie in die Chuchi!</p>
      <ul class="game-howto">
        <li><span>${ICONS.arrowUp}</span> springen</li>
        <li><span>${ICONS.arrowDown}</span> ducken</li>
        <li><span>${ICONS.arrowLeft}${ICONS.arrowRight}</span> ausweichen</li>
      </ul>
      ${best !== null ? `<p class="game-best">${ICONS.trophy} Bestzeit ${formatTime(best)}</p>` : ''}
      <button class="btn-start game-go" type="button" aria-label="Spiel starten">${ICONS.play}</button>
    </div>`;
  parent.appendChild(screen);
  const btn = screen.querySelector<HTMLButtonElement>('.game-go')!;
  btn.focus();
  return new Promise((resolve) => {
    btn.addEventListener(
      'click',
      () => {
        screen.classList.add('is-leaving');
        btn.disabled = true;
        setTimeout(() => screen.remove(), 400);
        resolve();
      },
      { once: true },
    );
  });
}

/** 3 · 2 · 1 · Los! — `beat(i)` runs on each number (sound), timing comes from `wait`. */
export async function countdown(parent: HTMLElement, wait: (ms: number) => Promise<void>, beat: (last: boolean) => void): Promise<void> {
  const c = el('div', 'game-countdown');
  parent.appendChild(c);
  for (const n of ['3', '2', '1', 'Los!']) {
    c.textContent = n;
    c.classList.remove('is-beat');
    void c.offsetWidth;
    c.classList.add('is-beat');
    beat(n === 'Los!');
    await wait(n === 'Los!' ? 500 : 750);
  }
  c.remove();
}

export interface Split {
  label: string;
  icon: IconName;
  seconds: number;
}

export type ResultChoice = 'again' | 'story';

export function showResults(
  parent: HTMLElement,
  r: { total: number; splits: Split[]; place: number; of: number; best: number | null; isBest: boolean },
): Promise<ResultChoice> {
  const screen = el('section', 'overlay game-results');
  const rows = r.splits
    .map((s) => `<li><span class="split-icon">${ICONS[s.icon]}</span><span>${s.label}</span><b>${formatTime(s.seconds)}</b></li>`)
    .join('');
  screen.innerHTML = `
    <div class="game-card">
      <p class="cover-eyebrow">ZIEL ERREICHT</p>
      <div class="result-place">${ICONS.trophy}<span><b>${r.place}.</b> Platz von ${r.of}</span></div>
      <p class="result-total">${formatTime(r.total)}</p>
      ${r.isBest ? '<p class="game-best is-new">Neue Bestzeit!</p>' : r.best !== null ? `<p class="game-best">Bestzeit ${formatTime(r.best)}</p>` : ''}
      <ul class="result-splits">${rows}</ul>
      <div class="result-actions">
        <button class="btn-round" type="button" data-choice="again" aria-label="Nochmals spielen">${ICONS.replay}</button>
        <button class="btn-round is-quiet" type="button" data-choice="story" aria-label="Zur Geschichte">${ICONS.book}</button>
      </div>
    </div>`;
  parent.appendChild(screen);
  return new Promise((resolve) => {
    screen.querySelectorAll<HTMLButtonElement>('[data-choice]').forEach((b) =>
      b.addEventListener('click', () => {
        screen.classList.add('is-leaving');
        setTimeout(() => screen.remove(), 400);
        resolve(b.dataset.choice as ResultChoice);
      }),
    );
    screen.querySelector<HTMLButtonElement>('[data-choice="again"]')!.focus();
  });
}
