import { Group, MathUtils } from 'three';
import { LANES, type ObstacleKind } from './world';
import { obstacleMesh } from './world';
import { rng } from '../scenes/shared/placeholders';
import type { Runner } from './runner';

/** Calm pace for children: obstacles come into view ≈ 4 s before they arrive. */
export const RUN_SPEED = 5.6;
// Long, floaty jumps and slides (≈ 0.9 s / 1.1 s) forgive early or late presses.
const JUMP_V = 5.2;
const GRAVITY = 11.5;
const SLIDE_S = 1.1;
const STUMBLE_S = 1.1;
const LANE_SWITCH = 7; // per second, exponential

export interface Obstacle {
  kind: ObstacleKind;
  d: number;
  /** Blocked lanes; garlands block all three. */
  lanes: number[];
  obj: Group;
  /** Player already passed it (hit or cleared). */
  passed: boolean;
  hit: boolean;
}

/** Physics + state of one runner on the course; shared by the player and the rivals. */
export class Racer {
  d = 0;
  x = 0;
  y = 0;
  lane = 1;
  speed = 0;
  topSpeed = RUN_SPEED;
  running = false;
  /** Off the track (orchard, kitchen): position comes from a script, only the pose updates. */
  scripted = false;
  scriptSpeed = 0;
  private vy = 0;
  private slideLeft = 0;
  private stumbleLeft = 0;

  constructor(readonly runner: Runner) {}

  get airborne(): boolean {
    return this.y > 0.05;
  }
  get sliding(): boolean {
    return this.slideLeft > 0;
  }
  get stumbling(): boolean {
    return this.stumbleLeft > 0;
  }

  place(d: number, lane: number): void {
    this.d = d;
    this.lane = lane;
    this.x = LANES[lane];
    this.sync();
  }

  jump(): boolean {
    if (this.airborne || this.stumbling) return false;
    this.slideLeft = 0;
    this.vy = JUMP_V;
    this.y = 0.06;
    this.kick();
    return true;
  }

  slide(): boolean {
    if (this.stumbling) return false;
    if (this.airborne) this.vy = Math.min(this.vy, -JUMP_V); // drop fast out of a jump
    this.slideLeft = SLIDE_S;
    this.kick();
    return true;
  }

  steer(dir: -1 | 1): boolean {
    const next = MathUtils.clamp(this.lane + dir, 0, LANES.length - 1);
    if (next === this.lane) return false;
    this.lane = next;
    this.kick();
    return true;
  }

  /** Standing in front of an obstacle: the right move gets the runner going again at once. */
  private kick(): void {
    if (this.running) this.speed = Math.max(this.speed, this.topSpeed * 0.85);
  }

  /** Held in front of an obstacle until the right arrow is pressed. */
  holdAt(d: number): void {
    this.d = Math.min(this.d, d);
    this.speed = 0;
    this.sync();
  }

  stumble(): void {
    this.stumbleLeft = STUMBLE_S;
    this.slideLeft = 0;
    this.speed = Math.min(this.speed, 2.2);
  }

  update(dt: number): void {
    if (this.scripted) {
      this.runner.update(dt, this.scriptSpeed);
      return;
    }
    const target = !this.running ? 0 : this.stumbling ? 2.2 : this.topSpeed;
    // Quick to slow down, a little slower to get back to full speed.
    this.speed += (target - this.speed) * (1 - Math.exp(-dt * (target < this.speed ? 8 : 2.4)));
    this.d += this.speed * dt;
    this.x += (LANES[this.lane] - this.x) * (1 - Math.exp(-dt * LANE_SWITCH));
    if (this.y > 0 || this.vy > 0) {
      this.vy -= GRAVITY * dt;
      this.y = Math.max(0, this.y + this.vy * dt);
      if (this.y === 0) this.vy = 0;
    }
    this.slideLeft = Math.max(0, this.slideLeft - dt);
    this.stumbleLeft = Math.max(0, this.stumbleLeft - dt);
    const r = this.runner;
    if (this.running || this.speed > 0.3) {
      r.pose = this.stumbling ? 'stumble' : this.airborne ? 'jump' : this.sliding ? 'slide' : 'run';
    }
    r.update(dt, this.speed);
    this.sync();
  }

  /** Does this obstacle stop the racer right now? */
  blockedBy(o: Obstacle): boolean {
    const inLane = o.lanes.some((l) => Math.abs(this.x - LANES[l]) < 0.95);
    if (!inLane) return false;
    if (o.kind === 'barrel') return this.y < 0.55;
    if (o.kind === 'garland') return !this.sliding;
    return true;
  }

  private sync(): void {
    const root = this.runner.root;
    root.position.set(this.x, this.y, -this.d);
    root.rotation.set(0, (LANES[this.lane] - this.x) * -0.25, 0);
  }
}

/** The obstacle line-up for one stretch; random per race but always passable. */
/**
 * `intro` kinds come first, one at a time, in the player's starting lane (the tutorial):
 * a crate to jump, a banner to slide under, a cart to dodge.
 */
export function layoutObstacles(d0: number, d1: number, seed: number, gap: [number, number], intro: ObstacleKind[] = []): Obstacle[] {
  const r = rng(seed);
  const out: Obstacle[] = [];
  let d = d0;
  let last: ObstacleKind | null = null;
  while (d < d1) {
    const n = out.length;
    let kind: ObstacleKind = n < intro.length ? intro[n] : (['barrel', 'barrel', 'cart', 'cart', 'garland'] as const)[Math.floor(r() * 5)];
    if (n >= intro.length && kind === 'garland' && last === 'garland') kind = 'barrel';
    let lanes: number[];
    if (kind === 'garland') lanes = [0, 1, 2];
    else if (n < intro.length) lanes = [1];
    else {
      const free = Math.floor(r() * 3);
      lanes = [0, 1, 2].filter((l) => l !== free);
      if (r() < 0.45) lanes = [lanes[Math.floor(r() * 2)]];
    }
    const obj = new Group();
    obj.name = `obstacle_${kind}`;
    if (kind === 'garland') obj.add(obstacleMesh(kind));
    else
      for (const l of lanes) {
        const m = obstacleMesh(kind, Math.floor(r() * 10));
        m.position.x = LANES[l];
        obj.add(m);
      }
    obj.position.z = -d;
    out.push({ kind, d, lanes, obj, passed: false, hit: false });
    last = kind;
    d += gap[0] + r() * (gap[1] - gap[0]);
  }
  return out;
}

/** What should a runner press for this obstacle when standing in `lane`? */
export function answerFor(o: Obstacle, lane: number): 'up' | 'down' | 'left' | 'right' | null {
  if (!o.lanes.includes(lane)) return null;
  if (o.kind === 'barrel') return 'up';
  if (o.kind === 'garland') return 'down';
  // Cart: the nearest free lane.
  const free = [lane - 1, lane + 1].filter((l) => l >= 0 && l <= 2 && !o.lanes.includes(l));
  if (!free.length) {
    const any = [0, 1, 2].find((l) => !o.lanes.includes(l))!;
    return any < lane ? 'left' : 'right';
  }
  return free[0] < lane ? 'left' : 'right';
}
