import { Group, Mesh, MeshBasicMaterial, SphereGeometry, Vector3, type Object3D } from 'three';
import { CONFIG } from '../../config';
import { easeOut, linear } from '../../core/clock';
import type { LineId } from '../../audio/narrator';
import type { StoryContext } from '../../story/context';
import type { Minigame } from '../shared/minigame';
import { TapMarker } from '../shared/marker';
import { cherry, rng, starling, type CrownSphere } from '../shared/placeholders';
import type { Scene1World } from './world';

/** The parts of a world the game needs; the tree must be a direct child of `root`. */
export type PickingWorld = Pick<Scene1World, 'root' | 'heroTree' | 'basket'>;

/** Lines the game speaks on its own; `null` skips the line. */
export interface PickingLines {
  cheer: LineId | null;
  hint: LineId;
  bird: LineId;
}

const SCENE1_LINES: PickingLines = { cheer: 's1_pick_cheer', hint: 's1_pick_hint', bird: 's1_starling' };

interface Cherry {
  obj: Object3D;
  home: Vector3;
  phase: number;
}

/**
 * Harvest game: tap anywhere on the tree crown → the nearest cherry flies into the basket.
 * A starling steals one cherry once (playful, not a penalty). No score, no fail state:
 * when the child stops playing, a hint comes, and later the remaining cherries
 * drop into the basket on their own so the story always continues.
 */
export class PickingGame implements Minigame {
  private readonly root: Group;
  private readonly hitArea = new Group();
  private readonly marker: TapMarker;
  private remaining: Cherry[] = [];
  private inFlight = 0;
  private picked = 0;
  private total: number;
  private birdDone = false;
  private birdBusy = false;
  private lastActivity = 0;
  private hinted = false;
  private autoPicking = false;
  private cheered = false;
  private speech: Promise<void> = Promise.resolve();
  private offTap: (() => void) | null = null;
  private offUpdate: (() => void) | null = null;
  private finish: (() => void) | null = null;

  constructor(
    private readonly ctx: StoryContext,
    private readonly world: PickingWorld,
    /** Line still being spoken when the game starts; game lines queue after it. */
    speakingBefore: Promise<void> = Promise.resolve(),
    private readonly lines: PickingLines = SCENE1_LINES,
  ) {
    this.speech = speakingBefore;
    this.root = world.root;
    this.total = ctx.quality === 'lite' ? 8 : 10;
    this.marker = new TapMarker(ctx.stage.clock, 0.06);
    this.root.add(this.marker.sprite);
  }

  run(): Promise<void> {
    const clock = this.ctx.stage.clock;
    this.spawnCherries();
    this.lastActivity = clock.time;
    this.offTap = this.ctx.stage.addTapTarget(this.hitArea, (_o, point) => this.onTap(point));
    this.offUpdate = clock.onUpdate((_dt, t) => this.update(t));
    return new Promise((resolve) => {
      this.finish = resolve;
    });
  }

  dispose(): void {
    this.offTap?.();
    this.offUpdate?.();
    this.marker.hide();
    this.root.remove(this.marker.sprite, this.hitArea);
  }

  // ------------------------------------------------------------------ setup

  /** Crown spheres in root space: GLB `cherry_slot*` empties win, else placeholder metadata. */
  private crownSpheres(): CrownSphere[] {
    const tree = this.world.heroTree;
    const list = (tree.userData.crown as CrownSphere[] | undefined) ?? [];
    if (list.length) {
      return list.map((c) => ({ x: tree.position.x + c.x, y: tree.position.y + c.y, z: tree.position.z + c.z, r: c.r }));
    }
    // Fallback for real models without metadata: one sphere around the upper half.
    return [{ x: tree.position.x, y: tree.position.y + 0.13, z: tree.position.z, r: 0.07 }];
  }

  private spawnCherries(): void {
    const r = rng(7);
    const crowns = this.crownSpheres();
    const tree = this.world.heroTree;
    this.root.updateMatrixWorld(true);
    const slots: Vector3[] = [];
    tree.traverse((o) => {
      if (o.name.startsWith('cherry_slot')) slots.push(this.root.worldToLocal(o.getWorldPosition(new Vector3())));
    });

    for (let i = 0; i < this.total; i++) {
      let home: Vector3;
      if (slots[i]) {
        home = slots[i];
      } else {
        const c = crowns[i % crowns.length];
        // Front-facing hemisphere so cherries are visible from the reader's side.
        const dir = new Vector3(r() * 2 - 1, r() * 1.3 - 0.4, 0.45 + r() * 0.8).normalize();
        home = new Vector3(c.x, c.y, c.z).addScaledVector(dir, c.r * 0.92);
      }
      const obj = this.ctx.models.get('cherry', cherry);
      obj.position.copy(home);
      this.root.add(obj);
      this.remaining.push({ obj, home, phase: r() * 6 });
    }

    // Generous invisible hit volumes around the crown — small fingers, big targets.
    const hitMat = new MeshBasicMaterial({ visible: false });
    for (const c of crowns) {
      const m = new Mesh(new SphereGeometry(c.r * 1.35, 10, 8), hitMat);
      m.position.set(c.x, c.y, c.z);
      this.hitArea.add(m);
    }
    this.root.add(this.hitArea);
  }

  // ------------------------------------------------------------------ interaction

  private onTap(worldPoint: Vector3): void {
    if (!this.remaining.length) return;
    const p = this.root.worldToLocal(worldPoint.clone());
    this.pick(this.nearest(p));
  }

  private nearest(p: Vector3): Cherry {
    let best = this.remaining[0];
    let bestD = Infinity;
    for (const c of this.remaining) {
      const d = c.home.distanceToSquared(p);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  private pick(c: Cherry): void {
    const clock = this.ctx.stage.clock;
    this.remaining = this.remaining.filter((x) => x !== c);
    this.lastActivity = clock.time;
    this.hinted = false;
    this.marker.hide();
    this.ctx.sfx.pop(this.picked);
    this.picked++;
    this.inFlight++;

    const contents = this.world.basket.getObjectByName('contents') ?? this.world.basket;
    const from = c.obj.position.clone();
    const n = this.picked;
    const landLocal = new Vector3(
      Math.cos(n * 2.4) * 0.012 * ((n % 3) / 2 + 0.3),
      0.008 + Math.floor(n / 4) * 0.005,
      Math.sin(n * 2.4) * 0.012 * ((n % 3) / 2 + 0.3),
    );
    this.root.updateMatrixWorld(true);
    const to = this.root.worldToLocal(contents.localToWorld(landLocal.clone()));

    void clock
      .tween(
        650,
        (k) => {
          c.obj.position.lerpVectors(from, to, k);
          c.obj.position.y += Math.sin(k * Math.PI) * 0.06;
          c.obj.rotation.z = k * 6;
        },
        linear,
      )
      .then(() => {
        contents.attach(c.obj);
        c.obj.position.copy(landLocal);
        this.ctx.sfx.plop();
        this.inFlight--;
        this.afterPick();
      });
  }

  private afterPick(): void {
    if (!this.cheered && this.picked >= Math.ceil(this.total / 2) && !this.autoPicking) {
      this.cheered = true;
      if (this.lines.cheer) this.say(this.lines.cheer);
    }
    this.checkDone();
  }

  private checkDone(): void {
    if (this.remaining.length || this.inFlight || this.birdBusy) return;
    // Let any line in progress finish before the story moves on.
    void this.speech.then(() => {
      this.dispose();
      this.finish?.();
    });
  }

  private say(id: LineId): void {
    this.speech = this.speech.then(() => this.ctx.narrator.say(id));
  }

  // ------------------------------------------------------------------ per frame

  private update(t: number): void {
    // Cherries sway gently on the branches.
    for (const c of this.remaining) {
      c.obj.position.y = c.home.y + Math.sin(t * 2 + c.phase) * 0.0012;
      c.obj.rotation.z = Math.sin(t * 1.6 + c.phase) * 0.15;
    }

    if (!this.birdDone && this.picked >= 3 && this.remaining.length >= 3) void this.starlingVisit();

    const idle = (t - this.lastActivity) * 1000;
    if (!this.hinted && idle > CONFIG.pickIdleHintAfterMs && this.remaining.length) {
      this.hinted = true;
      const target = this.remaining[0];
      this.marker.sprite.position.copy(target.home);
      this.marker.show();
      this.say(this.lines.hint);
    }
    if (!this.autoPicking && idle > CONFIG.pickAutoFinishAfterMs) {
      this.autoPicking = true;
      void this.autoFinish();
    }
  }

  private async autoFinish(): Promise<void> {
    const clock = this.ctx.stage.clock;
    while (this.remaining.length) {
      this.pick(this.remaining[0]);
      await clock.wait(500);
    }
  }

  private async starlingVisit(): Promise<void> {
    this.birdDone = true;
    this.birdBusy = true;
    const clock = this.ctx.stage.clock;
    // Reserve the cherry nearest the top of the tree.
    const prey = this.remaining.reduce((a, b) => (b.home.y > a.home.y ? b : a));
    this.remaining = this.remaining.filter((x) => x !== prey);

    const bird = this.ctx.models.get('starling', starling);
    const wings = ['wing_L', 'wing_R'].map((n) => bird.getObjectByName(n)).filter(Boolean) as Object3D[];
    const flap = clock.onUpdate((_dt, t) => wings.forEach((w, i) => (w.rotation.x = Math.sin(t * 28) * 0.9 * (i ? -1 : 1))));
    const start = new Vector3(0.62, 0.26, -0.05);
    const perch = prey.home.clone().add(new Vector3(0.012, 0.012, 0.01));
    const exit = new Vector3(-0.15, 0.4, -0.45);
    bird.position.copy(start);
    this.root.add(bird);
    const face = (from: Vector3, to: Vector3) => (bird.rotation.y = Math.atan2(-(to.z - from.z), to.x - from.x));

    this.ctx.sfx.chirp();
    face(start, perch);
    await clock.tween(1500, (k) => {
      bird.position.lerpVectors(start, perch, k);
      bird.position.y += Math.sin(k * Math.PI) * 0.04;
    });
    this.ctx.sfx.chirp();
    this.say(this.lines.bird);
    bird.attach(prey.obj);
    await clock.wait(500);
    face(perch, exit);
    await clock.tween(1700, (k) => bird.position.lerpVectors(perch, exit, k), easeOut);
    flap();
    this.root.remove(bird);
    this.birdBusy = false;
    this.checkDone();
  }
}
