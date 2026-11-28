import { Vector3, type Camera, type Object3D } from 'three';

/**
 * Touch gestures for the journey game. The child is asked for one gesture at a time; the
 * game waits until it comes, so nothing can be missed or lost.
 *
 *   tap     a short touch, on a thing in the scene when `target` is given (generous radius)
 *   swipe   a quick stroke up, down, left, right, or `side` (left or right)
 *   hold    finger down and still for HOLD_MS
 *   rub     back and forth (stroking a cat, washing cherries)
 *   circle  round and round (stirring the pot)
 *   scoop   free dragging: the scene moves a thing with the finger and calls `finishNow()`
 *
 * Every gesture can also be done with the keyboard (Space / Enter, arrows for swipes) and with
 * the big «Weiter» button the game shows after a while, so no child gets stuck.
 */
export type SwipeDir = 'up' | 'down' | 'left' | 'right';
export type Want =
  | { kind: 'tap'; target?: Object3D }
  | {
      kind: 'swipe';
      dir: SwipeDir | 'side';
      /** Side steps past an obstacle: the stroke (px, y down) → +1 / −1 along the obstacle's own x,
       *  or 0 when it does not go the way the scene needs. Checked with the camera of that moment,
       *  so it works whichever way the path runs across the screen. */
      across?: (dx: number, dy: number) => number;
    }
  | { kind: 'hold' }
  | { kind: 'rub'; strokes?: number }
  | { kind: 'circle'; turns?: number }
  | { kind: 'scoop' };

export interface Expectation {
  /** Resolves with the swipe direction (or the gesture kind) once the gesture is done. */
  done: Promise<SwipeDir | Want['kind']>;
  /** Completes it from outside (the help button, the review pilot). */
  complete(): void;
  cancel(): void;
}

const TAP_MAX_MS = 400;
const TAP_MAX_PX = 22;
const SWIPE_MIN_PX = 40;
const HOLD_MS = 900;
const RUB_MIN_PX = 18;
const KEY_DIR: Record<string, SwipeDir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

interface Track {
  id: number;
  x0: number;
  y0: number;
  t0: number;
  x: number;
  y: number;
  moved: number;
  /** rub: last stroke direction along the dominant axis and how many times it turned */
  dir: number;
  strokeFrom: number;
  turns: number;
  /** circle: last movement angle and the signed sum of its changes */
  lastAngle: number | null;
  lastX: number;
  lastY: number;
  turned: number;
  holdTimer: number;
}

export class GestureInput {
  private want: Want | null = null;
  private finish: ((r: SwipeDir | Want['kind']) => void) | null = null;
  private track: Track | null = null;
  private readonly tmp = new Vector3();
  /** The side the last `across` swipe went (+1 / −1); null when help or the pilot finished it. */
  lastSide: number | null = null;

  /** Progress of hold / rub / circle, 0 … 1 (for the ring in the hint). */
  onProgress: (p: number) => void = () => {};
  /** Every finger move while a gesture is wanted (px): lets the scene react as the child moves. */
  onDrag: (dx: number, dy: number) => void = () => {};
  /** A gesture came, but not the one asked for (gentle hint, never a penalty). */
  onMiss: () => void = () => {};

  constructor(
    private readonly el: HTMLElement,
    private readonly camera: () => Camera | null,
  ) {
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.cancelTrack);
    window.addEventListener('keydown', this.key);
  }

  expect(want: Want): Expectation {
    this.cancel();
    this.want = want;
    this.lastSide = null;
    const done = new Promise<SwipeDir | Want['kind']>((resolve) => (this.finish = resolve));
    this.onProgress(0);
    return {
      done,
      complete: () => this.succeed(want.kind === 'swipe' ? (want.dir === 'side' ? 'right' : want.dir) : want.kind),
      cancel: () => this.cancel(),
    };
  }

  /** The scene says the free drag (`scoop`) has reached its goal. */
  finishNow(): void {
    if (this.want) this.succeed(this.want.kind === 'swipe' ? (this.want.dir === 'side' ? 'right' : this.want.dir) : this.want.kind);
  }

  cancel(): void {
    this.want = null;
    this.finish = null;
    this.cancelTrack();
  }

  dispose(): void {
    this.cancel();
    this.el.removeEventListener('pointerdown', this.down);
    this.el.removeEventListener('pointermove', this.move);
    this.el.removeEventListener('pointerup', this.up);
    this.el.removeEventListener('pointercancel', this.cancelTrack);
    window.removeEventListener('keydown', this.key);
  }

  private succeed(result: SwipeDir | Want['kind']): void {
    const f = this.finish;
    this.want = null;
    this.finish = null;
    this.cancelTrack();
    this.onProgress(1);
    f?.(result);
  }

  private down = (e: PointerEvent): void => {
    if (!this.want || this.track) return;
    this.track = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      t0: performance.now(),
      x: e.clientX,
      y: e.clientY,
      moved: 0,
      dir: 0,
      strokeFrom: 0,
      turns: 0,
      lastAngle: null,
      lastX: e.clientX,
      lastY: e.clientY,
      turned: 0,
      holdTimer: 0,
    };
    const w = this.want;
    if (w.kind === 'hold') {
      const t = this.track;
      const step = () => {
        if (this.track !== t || this.want !== w) return;
        const p = Math.min(1, (performance.now() - t.t0) / HOLD_MS);
        this.onProgress(p);
        if (p >= 1) this.succeed('hold');
        else t.holdTimer = requestAnimationFrame(step);
      };
      t.holdTimer = requestAnimationFrame(step);
    }
  };

  private move = (e: PointerEvent): void => {
    const t = this.track;
    const w = this.want;
    if (!t || !w || e.pointerId !== t.id) return;
    const dx = e.clientX - t.x;
    const dy = e.clientY - t.y;
    t.moved = Math.max(t.moved, Math.hypot(e.clientX - t.x0, e.clientY - t.y0));
    t.x = e.clientX;
    t.y = e.clientY;
    this.onDrag(dx, dy);
    if (w.kind === 'hold' && t.moved > TAP_MAX_PX * 2) {
      // a wandering finger restarts the hold instead of failing it
      t.t0 = performance.now();
      t.x0 = e.clientX;
      t.y0 = e.clientY;
      t.moved = 0;
      this.onProgress(0);
    }
    if (w.kind === 'rub') {
      // count turns of the stroke along whichever axis the finger goes most
      const along = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
      if (Math.abs(along) > 1) {
        const d = Math.sign(along);
        const pos = Math.abs(dx) >= Math.abs(dy) ? e.clientX : e.clientY;
        if (t.dir === 0) {
          t.dir = d;
          t.strokeFrom = pos;
        } else if (d !== t.dir && Math.abs(pos - t.strokeFrom) > RUB_MIN_PX) {
          t.dir = d;
          t.strokeFrom = pos;
          t.turns++;
          const need = w.strokes ?? 4;
          this.onProgress(Math.min(1, t.turns / need));
          if (t.turns >= need) this.succeed('rub');
        }
      }
    }
    if (w.kind === 'circle') {
      const sx = e.clientX - t.lastX;
      const sy = e.clientY - t.lastY;
      if (Math.hypot(sx, sy) < 10) return;
      const a = Math.atan2(sy, sx);
      if (t.lastAngle !== null) {
        let d = a - t.lastAngle;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        // a sharp reversal is not part of a circle
        if (Math.abs(d) < 1.6) t.turned += d;
      }
      t.lastAngle = a;
      t.lastX = e.clientX;
      t.lastY = e.clientY;
      const need = (w.turns ?? 1.5) * 2 * Math.PI;
      this.onProgress(Math.min(1, Math.abs(t.turned) / need));
      if (Math.abs(t.turned) >= need) this.succeed('circle');
    }
  };

  private up = (e: PointerEvent): void => {
    const t = this.track;
    const w = this.want;
    if (!t || e.pointerId !== t.id) return;
    this.cancelTrack();
    if (!w) return;
    const dx = e.clientX - t.x0;
    const dy = e.clientY - t.y0;
    const dist = Math.hypot(dx, dy);
    const ms = performance.now() - t.t0;
    if (w.kind === 'tap') {
      if (dist <= TAP_MAX_PX * 2 && ms <= TAP_MAX_MS * 2) {
        if (!w.target || this.near(w.target, e.clientX, e.clientY)) return this.succeed('tap');
      }
      return this.onMiss();
    }
    if (w.kind === 'swipe') {
      if (dist < SWIPE_MIN_PX) return this.onMiss();
      if (w.across) return this.acrossSwipe(w.across, dx, dy);
      const dir: SwipeDir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
      const ok = w.dir === dir || (w.dir === 'side' && (dir === 'left' || dir === 'right'));
      return ok ? this.succeed(dir) : this.onMiss();
    }
    if (w.kind === 'hold') return this.onProgress(0);
    // scoop: the thing stays where the finger left it, the child just goes on
    if (w.kind === 'scoop') return;
    // rub / circle: lifting the finger starts the count over, without any penalty
    this.onProgress(0);
    if (dist < TAP_MAX_PX) this.onMiss();
  };

  private cancelTrack = (): void => {
    if (this.track?.holdTimer) cancelAnimationFrame(this.track.holdTimer);
    this.track = null;
  };

  /** Keyboard: Space / Enter do any gesture, arrows do swipes (switch access, desktop). */
  private key = (e: KeyboardEvent): void => {
    const w = this.want;
    if (!w || e.repeat) return;
    const dir = KEY_DIR[e.key];
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      this.succeed(w.kind === 'swipe' ? (w.dir === 'side' ? 'right' : w.dir) : w.kind);
    } else if (dir && w.kind === 'swipe' && w.across) {
      e.preventDefault();
      const [dx, dy] = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[dir];
      this.acrossSwipe(w.across, dx, dy);
    } else if (dir && w.kind === 'swipe') {
      e.preventDefault();
      if (w.dir === dir || (w.dir === 'side' && (dir === 'left' || dir === 'right'))) this.succeed(dir);
      else this.onMiss();
    }
  };

  private acrossSwipe(across: (dx: number, dy: number) => number, dx: number, dy: number): void {
    const side = across(dx, dy);
    if (!side) return this.onMiss();
    const dir: SwipeDir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
    this.lastSide = side;
    this.succeed(dir);
  }

  /** Is the screen point close to the thing? Generous: children's fingers are big. */
  private near(target: Object3D, x: number, y: number): boolean {
    const cam = this.camera();
    if (!cam) return true;
    const rect = this.el.getBoundingClientRect();
    target.getWorldPosition(this.tmp).project(cam);
    if (this.tmp.z > 1) return true;
    const sx = rect.left + ((this.tmp.x + 1) / 2) * rect.width;
    const sy = rect.top + ((1 - this.tmp.y) / 2) * rect.height;
    const r = Math.max(90, Math.min(rect.width, rect.height) * 0.2);
    return Math.hypot(sx - x, sy - y) <= r;
  }
}
