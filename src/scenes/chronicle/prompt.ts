import { Vector3, type Object3D } from 'three';
import type { LineId } from '../../audio/narrator';
import type { StoryClock } from '../../core/clock';
import type { StoryContext } from '../../story/context';
import { TapMarker } from '../shared/marker';

/** Idle time before an interaction continues by itself (the child can never get stuck). */
export const AUTO_CONTINUE_MS = 20_000;

/**
 * Separates watching time from waiting-for-the-child time, so the animation length
 * (budget: 4–5 minutes) can be measured independently of how long children play.
 */
export class Pacing {
  waited = 0;
  readonly marks: Array<[string, number]> = [];
  private start: number;

  constructor(private readonly clock: StoryClock) {
    this.start = clock.time;
  }

  mark(label: string): void {
    this.marks.push([label, this.clock.time - this.start]);
  }

  /** Runs `fn` and books its whole duration as waiting time. */
  async waiting<T>(fn: () => Promise<T>): Promise<T> {
    const t0 = this.clock.time;
    try {
      return await fn();
    } finally {
      this.waited += this.clock.time - t0;
    }
  }

  report(): { total: number; waited: number; animation: number; marks: Array<[string, number]> } {
    const total = this.clock.time - this.start;
    return { total, waited: this.waited, animation: total - this.waited, marks: this.marks };
  }
}

/** Inline SVG icons for the accessible on-screen alternatives to tapping in 3D. */
export const PROMPT_ICONS = {
  wheel:
    '<circle cx="16" cy="16" r="11"/><circle cx="16" cy="16" r="2.5"/><path d="M16 5v22M5 16h22M8.2 8.2l15.6 15.6M23.8 8.2L8.2 23.8"/>',
  bell: '<path d="M16 4v2M9 22c0-9 2-14 7-14s7 5 7 14zM6 22h20M14 26a2 2 0 0 0 4 0"/>',
  tree: '<circle cx="16" cy="12" r="8"/><path d="M16 20v9M12 29h8"/><circle cx="13" cy="12" r="1.6"/><circle cx="19" cy="14" r="1.6"/>',
  stir: '<path d="M6 17h20a10 7 0 0 1-20 0zM22 4l-7 14"/><path d="M9 10a7 4 0 0 1 9-3" stroke-dasharray="2 3"/>',
  seed: '<ellipse cx="16" cy="13" rx="5" ry="7"/><path d="M5 27c4-3 18-3 22 0M16 20v5"/>',
} as const;

function actionButton(icon: keyof typeof PROMPT_ICONS, label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn-icon story-action';
  b.setAttribute('aria-label', label);
  b.innerHTML = `<svg viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${PROMPT_ICONS[icon]}</svg>`;
  document.getElementById('ui')!.appendChild(b);
  return b;
}

export interface TapPromptSpec {
  /** Tappable objects; the first one is used by the button and the auto-continue. */
  targets: Object3D[];
  line: LineId;
  icon: keyof typeof PROMPT_ICONS;
  label: string;
  /** Pulsing ring position relative to each target, in its parent's (unscaled) space. */
  markerOffset?: Vector3;
  markerSize?: number;
}

/**
 * Speaks the prompt, shows pulsing rings and an accessible button, and resolves with the
 * target the child chose. After AUTO_CONTINUE_MS without input the first target is chosen.
 */
export async function tapPrompt(ctx: StoryContext, pacing: Pacing, spec: TapPromptSpec): Promise<Object3D> {
  const { stage } = ctx;
  const clock = stage.clock;
  const markers = spec.targets.map((target) => {
    const m = new TapMarker(clock, spec.markerSize ?? 0.06);
    // Parent space, so a scaled target (e.g. a tree) does not shrink the ring.
    (target.parent ?? target).add(m.sprite);
    m.sprite.position.copy(target.position).add(spec.markerOffset ?? new Vector3(0, 0.05, 0));
    m.show();
    return m;
  });
  const button = actionButton(spec.icon, spec.label);
  let choose!: (o: Object3D) => void;
  let chosen = false;
  const choice = new Promise<Object3D>((resolve) => {
    choose = (o) => {
      if (chosen || clock.isPaused) return;
      chosen = true;
      resolve(o);
    };
  });
  const offs = spec.targets.map((t) => stage.addTapTarget(t, () => choose(t)));
  button.addEventListener('click', () => choose(spec.targets[0]));
  offs.push(clock.onUpdate(() => (button.disabled = clock.isPaused)));

  await ctx.narrator.say(spec.line);
  const result = await pacing.waiting(async () => {
    let idle = 0;
    const offIdle = clock.onUpdate((dt) => {
      idle += dt;
      if (idle * 1000 >= AUTO_CONTINUE_MS) choose(spec.targets[0]);
    });
    const r = await choice;
    offIdle();
    return r;
  });
  offs.forEach((off) => off());
  button.remove();
  markers.forEach((m) => {
    m.hide();
    m.sprite.removeFromParent();
    m.sprite.material.dispose();
  });
  ctx.sfx.pop();
  return result;
}

/**
 * Stirring: draw circles with a finger anywhere on the screen (measured around the bowl),
 * or tap the bowl / the button for a quarter turn each. `onTurn` receives every angle step.
 * Completes after `turns` full circles; stirs by itself after AUTO_CONTINUE_MS without input.
 */
export async function stirPrompt(
  ctx: StoryContext,
  pacing: Pacing,
  bowl: Object3D,
  line: LineId,
  onTurn: (delta: number, progress: number) => void,
  turns = 2,
): Promise<void> {
  const { stage } = ctx;
  const clock = stage.clock;
  const tracker = stage.tracker!;
  const el = tracker.inputElement;
  const goal = turns * Math.PI * 2;
  let done = 0;
  let idle = 0;
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => (finish = resolve));
  let lastClick = 0;
  const advance = (delta: number) => {
    if (clock.isPaused || done >= goal) return;
    idle = 0;
    done = Math.min(goal, done + Math.abs(delta));
    onTurn(Math.sign(delta || 1) * Math.abs(delta), done / goal);
    // A soft click every quarter turn.
    if (Math.floor(done / (Math.PI / 2)) > lastClick) {
      lastClick = Math.floor(done / (Math.PI / 2));
      ctx.sfx.plop();
    }
    if (done >= goal) finish();
  };

  const marker = new TapMarker(clock, 0.07);
  bowl.add(marker.sprite);
  marker.sprite.position.set(0, 0.03, 0);
  marker.show();
  const button = actionButton('stir', 'Umrühren');
  button.addEventListener('click', () => advance(Math.PI / 2));
  const offTap = stage.addTapTarget(bowl, () => advance(Math.PI / 2));

  // Screen-space angle around the bowl.
  const centre = () => {
    const p = bowl.getWorldPosition(new Vector3()).project(tracker.camera);
    const r = el.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
  };
  let prev: number | null = null;
  const angleOf = (e: PointerEvent) => {
    const c = centre();
    return Math.atan2(e.clientY - c.y, e.clientX - c.x);
  };
  const onDown = (e: PointerEvent) => (prev = angleOf(e));
  const onMove = (e: PointerEvent) => {
    if (prev === null) return;
    const a = angleOf(e);
    const delta = Math.atan2(Math.sin(a - prev), Math.cos(a - prev));
    prev = a;
    if (Math.abs(delta) < 1.2) advance(delta);
  };
  const onUp = () => (prev = null);
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  tracker.lockView?.(true);

  await ctx.narrator.say(line);
  await pacing.waiting(async () => {
    let auto = false;
    const offIdle = clock.onUpdate((dt) => {
      idle += dt;
      if (!auto && idle * 1000 >= AUTO_CONTINUE_MS) auto = true;
      if (auto) advance(dt * 4.5);
      button.disabled = clock.isPaused;
    });
    await finished;
    offIdle();
  });

  el.removeEventListener('pointerdown', onDown);
  el.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  tracker.lockView?.(false);
  offTap();
  button.remove();
  marker.hide();
  marker.sprite.removeFromParent();
  marker.sprite.material.dispose();
}
