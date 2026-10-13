/**
 * Pausable story clock. All story timing (waits, tweens, animations) runs on this clock,
 * so pausing it (e.g. when tracking is lost) freezes the whole story consistently.
 */
type UpdateFn = (dt: number, time: number) => void;

interface PendingWait {
  at: number;
  resolve: () => void;
}

export class StoryClock {
  time = 0;
  private paused = false;
  private waits: PendingWait[] = [];
  private updates = new Set<UpdateFn>();

  get isPaused(): boolean {
    return this.paused;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  /** Advance by real seconds; called once per rendered frame. */
  tick(realDt: number): void {
    if (this.paused) return;
    // Clamp so a backgrounded tab does not jump the story forward.
    const dt = Math.min(realDt, 0.1);
    this.time += dt;
    for (const fn of this.updates) fn(dt, this.time);
    if (this.waits.length) {
      const due = this.waits.filter((w) => w.at <= this.time);
      if (due.length) {
        this.waits = this.waits.filter((w) => w.at > this.time);
        due.forEach((w) => w.resolve());
      }
    }
  }

  /** Per-frame callback in story time. Returns an unsubscribe function. */
  onUpdate(fn: UpdateFn): () => void {
    this.updates.add(fn);
    return () => this.updates.delete(fn);
  }

  wait(ms: number): Promise<void> {
    return new Promise((resolve) => this.waits.push({ at: this.time + ms / 1000, resolve }));
  }

  /** Run `fn(t)` with t going 0 → 1 over `ms`, eased. */
  tween(ms: number, fn: (t: number) => void, ease: (t: number) => number = easeInOut): Promise<void> {
    return new Promise((resolve) => {
      const start = this.time;
      const dur = Math.max(ms / 1000, 1e-3);
      fn(0);
      const off = this.onUpdate((_dt, time) => {
        const t = Math.min((time - start) / dur, 1);
        fn(ease(t));
        if (t >= 1) {
          off();
          resolve();
        }
      });
    });
  }
}

export const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
export const easeOut = (t: number): number => 1 - (1 - t) ** 3;
export const linear = (t: number): number => t;
