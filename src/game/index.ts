import {
  CanvasTexture,
  CircleGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  Plane,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
  type Material,
  type Object3D,
} from 'three';
import type { Sfx } from '../audio/sfx';
import { CONFIG, type Quality } from '../config';
import { AssetLibrary } from '../core/assets';
import { StoryClock } from '../core/clock';
import type { Stage } from '../core/stage';
import { Models } from '../scenes/shared/models';
import { PALETTE } from '../scenes/shared/palette';
import type { GameEnv, GameView, ViewShot } from './env';
import { ArrowPad, type Dir } from './input';
import { buildKitchen, KITCHEN_SCALE } from './kitchen';
import { gameModelUrls } from './models';
import { jogTo, playerOrchard, rivalOrchard } from './orchard';
import { answerFor, layoutObstacles, Racer, RUN_SPEED, type Obstacle } from './racer';
import { Runner, runnerPlaceholder } from './runner';
import { ArrowSign, DIR_WORD } from './sign';
import { countdown, GameHud, showResults, showTitle, type ResultChoice, type Split } from './ui';
import { buildWorld, FINISH, LANES, RUN1_END, RUN2_START, type GameWorld, type Tree } from './world';

/*
 * «Chriesisturm» — the game after the story. Inspired by the real ladder race in Zug:
 * run through the old town with a ladder, dodge obstacles with the arrows, pick cherries in
 * the orchard, run on to the finish and turn the cherries into jam in the kitchen. Time counts.
 *
 * Played in AR on the printed spread (or in the 3D view): the course is a diorama clipped to
 * the page edges. Only a window of the street is on the page; it slides under the runner and
 * zooms in for the orchard and the kitchen. Nothing moves the runner past an obstacle by
 * itself: obstacles block the way until the child presses the right arrow.
 */

export interface GameOptions {
  stage: Stage;
  ui: HTMLElement;
  sfx: Sfx;
  quality: Quality;
  /** Review helpers: game-time multiplier and a pilot that plays by itself (dev only). */
  speed?: number;
  autoplay?: boolean;
  /** Review: `orchard` starts the race just before the cherry trees. */
  startAt?: string | null;
}

const RIVALS = 4;
const RIVAL_SHIRTS = [PALETTE.zugBlue, 0xf2b134, PALETTE.leaf, 0x8e5bb5];
const RIVAL_NAMES = ['Lena', 'Noah', 'Mia', 'Luca'];
/** Clean dodges in a row that earn a «Turbo!». */
const TURBO_EVERY = 3;
/** «Endspurt!» this far before the finish line (m). */
const SPRINT_AT = 70;

/** Name above a rival's head, so the race has faces. */
function nameTag(name: string, color: number): Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4eedc';
  g.beginPath();
  g.roundRect(8, 12, 240, 72, 36);
  g.fill();
  g.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  g.beginPath();
  g.arc(46, 48, 18, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#382719';
  g.font = 'bold 44px Georgia, serif';
  g.textBaseline = 'middle';
  g.fillText(name, 76, 50);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  const s = new Sprite(new SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(1.3, 0.49, 1);
  s.position.y = 2.25;
  s.renderOrder = 9;
  return s;
}
const BEST_KEY = 'chriesisturm-best';
const PROMPT_AHEAD = 22;
/** Page units per metre while running: ≈ 27 m of street on the page, the runner ≈ 4.5 cm tall. */
const RUN_SCALE = 0.026;
/** The runner sits in the front part of the page; this much street is visible ahead. */
const RUN_LOOK_AHEAD = 10;
/** Tutorial: the first crate, banner and cart freeze the race this close (m) until the right arrow. */
const TEACH_AT: Record<Obstacle['kind'], number> = { barrel: 2.4, garland: 1.8, cart: 4 };
/** Where the runner is held when it reaches an obstacle without the right move (m before its centre). */
const HOLD_GAP: Record<Obstacle['kind'], number> = { barrel: 0.8, garland: 0.6, cart: 1.7 };
const TEACH_TEXT: Record<Dir, string> = {
  up: 'Drück ↑ zum Springen!',
  down: 'Drück ↓ zum Ducken!',
  left: 'Drück ← zum Ausweichen!',
  right: 'Drück → zum Ausweichen!',
};
const HALF_W = 0.5;
const HALF_D = 0.5 / CONFIG.spreadAspect;

function readBest(): number | null {
  try {
    const v = Number(localStorage.getItem(BEST_KEY));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}
function writeBest(s: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(s));
  } catch {
    /* private mode: no best time, the game still works */
  }
}

/** Plays rounds on the page until the family chooses to go back to the story. */
export async function runGame(opts: GameOptions): Promise<void> {
  const library = new AssetLibrary(opts.stage.tracker!.renderer);
  await library.loadAll(gameModelUrls());
  let best = readBest();
  for (;;) {
    const result = await playRound(library, opts, best);
    if (result.best !== null) best = result.best;
    if (result.choice === 'story') break;
  }
}

interface RivalState {
  racer: Racer;
  /** Own pace; the actual top speed bends towards the player to keep the race close. */
  base: number;
  stage: 'run1' | 'orchard' | 'run2' | 'done';
  finishAt: number;
  kitchenSeconds: number;
  pickSeconds: number;
  orchardAt: number;
  /** Obstacles this rival will (deliberately) not avoid. */
  clumsy: Set<Obstacle>;
  reaction: number;
}

/**
 * Diorama on the page: `holder` sits on the content anchor (page space), `diorama` scales
 * metres to page units, and the course root slides so the view centre lands mid-page.
 * Four clipping planes keep everything inside the spread.
 */
function mountDiorama(stage: Stage, clock: StoryClock, worldRoot: Group) {
  const holder = new Group();
  holder.name = 'game';
  const diorama = new Group();
  diorama.position.y = 0.002;
  holder.add(diorama);
  diorama.add(worldRoot);
  const hemi = new HemisphereLight(0xeaf3ff, PALETTE.meadow, 1.7);
  const sun = new DirectionalLight(0xffffff, 2.3);
  sun.position.set(-0.4, 1, 0.5);
  holder.add(hemi, sun, sun.target);
  stage.content.add(holder);

  const pagePlanes = [
    new Plane(new Vector3(-1, 0, 0), HALF_W),
    new Plane(new Vector3(1, 0, 0), HALF_W),
    new Plane(new Vector3(0, 0, -1), HALF_D),
    new Plane(new Vector3(0, 0, 1), HALF_D),
  ];
  const planes = pagePlanes.map((p) => p.clone());
  const touched = new Set<Material>();
  let frames = 0;
  const clip = (o: Object3D) => {
    const m = (o as Mesh).material as Material | Material[] | undefined;
    if (!m) return;
    for (const mm of Array.isArray(m) ? m : [m]) {
      if (mm.clippingPlanes === planes) continue;
      mm.clippingPlanes = planes;
      mm.needsUpdate = true;
      touched.add(mm);
    }
  };
  const offPose = stage.onBeforeRender(() => {
    const r = stage.tracker?.renderer;
    if (r) r.localClippingEnabled = true;
    stage.content.updateWorldMatrix(true, false);
    planes.forEach((p, i) => p.copy(pagePlanes[i]).applyMatrix4(stage.content.matrixWorld));
    // New objects (picked cherries, stones, jars …) get the planes within a few frames.
    if (frames++ % 12 === 0) holder.traverse(clip);
  });

  // ---- view: slide and zoom the window of the course shown on the page
  const center = new Vector3(0, 0, -6);
  let scale = 0.03;
  const goal: ViewShot = { center: center.clone(), scale };
  let fn: (() => ViewShot) | null = null;
  let ease = 3;
  const offView = clock.onUpdate((dt) => {
    if (fn) {
      const s = fn();
      goal.center.copy(s.center);
      goal.scale = s.scale;
    }
    const k = 1 - Math.exp(-dt * ease);
    center.lerp(goal.center, k);
    // Zoom in log space so close-ups and wide shots blend evenly.
    scale = Math.exp(Math.log(scale) + (Math.log(goal.scale) - Math.log(scale)) * k);
    diorama.scale.setScalar(scale);
    worldRoot.position.set(-center.x, 0, -center.z);
  });
  const camWorld = new Vector3();
  const view: GameView = {
    frame(c, s, e = 3) {
      fn = null;
      goal.center.copy(c);
      goal.scale = s;
      ease = e;
    },
    follow(f, e = 4) {
      fn = f;
      ease = e;
    },
    cameraPosition() {
      stage.tracker?.camera.getWorldPosition(camWorld);
      return worldRoot.worldToLocal(camWorld);
    },
  };
  return {
    view,
    /** How far from the view centre (m) anything can still be on the page. */
    range: () => Math.hypot(HALF_W, HALF_D) / scale + 12,
    /** The part of the course on the page, in metres. */
    page: () => ({ x: center.x, halfWidth: HALF_W / scale, halfDepth: HALF_D / scale }),
    viewCenter: () => center,
    dispose() {
      offPose();
      offView();
      holder.removeFromParent();
      touched.forEach((m) => {
        m.clippingPlanes = null;
        m.needsUpdate = true;
      });
      const r = stage.tracker?.renderer;
      if (r) r.localClippingEnabled = false;
    },
  };
}

async function playRound(library: AssetLibrary, opts: GameOptions, best: number | null): Promise<{ choice: ResultChoice; best: number | null }> {
  const { sfx, ui, quality, stage } = opts;
  const models = new Models(library);
  const world: GameWorld = buildWorld(models, quality);
  world.backdrop.visible = false;
  const townPieces = [...world.root.children];
  const kitchen = buildKitchen();
  kitchen.root.position.copy(world.finishHouse.position);
  world.root.add(kitchen.root);

  // The game clock follows the story clock's pauses (tracking lost, tab hidden).
  const clock = new StoryClock();
  const offFrame = stage.onFrame((dt) => {
    if (!stage.clock.isPaused) clock.tick(dt * (opts.speed ?? 1));
  });
  const dio = mountDiorama(stage, clock, world.root);
  const view = dio.view;
  // One-finger orbiting of the 3D view would fight with swipes.
  stage.tracker?.lockView?.(true);
  stage.tracker?.focus?.(null);
  if (import.meta.env.DEV) (window as unknown as { __game: unknown }).__game = { clock, view };

  // ---- UI and input
  const hud = new GameHud(ui);
  const pad = new ArrowPad(ui, stage.tracker!.inputElement);
  hud.setVisible(false);
  pad.setVisible(false);
  const env: GameEnv = { clock, pad, hud, sfx, root: world.root, view, quality };

  // ---- racers
  const shadowGeo = new CircleGeometry(0.45, 14);
  const shadowMat = new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false });
  const makeRacer = (key: string, shirt: number, seed: number): Racer => {
    // Placeholders are adult-sized; scale them to the child runner (≈ 1.6 m).
    const model = models.get(key, () => {
      const g = runnerPlaceholder(shirt, seed);
      g.scale.setScalar(0.82);
      return g;
    });
    const runner = new Runner(model, library.animations(key));
    world.root.add(runner.root);
    const racer = new Racer(runner);
    const shadow = new Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    world.root.add(shadow);
    clock.onUpdate(() => {
      const p = runner.root.position;
      shadow.position.set(p.x, 0.04, p.z);
      shadow.visible = runner.root.visible;
      shadow.scale.setScalar(Math.max(0.4, 1 - p.y * 0.25));
    });
    return racer;
  };
  const player = makeRacer('raceRunner', PALETTE.cherry, 0);
  player.place(0, 1);
  if (import.meta.env.DEV) Object.assign((window as unknown as { __game: object }).__game, { player });
  const rivals: RivalState[] = Array.from({ length: RIVALS }, (_, i) => {
    const racer = makeRacer('raceRival', RIVAL_SHIRTS[i], i + 1);
    racer.place(i < 2 ? 0.4 : -1.6, i % 2 ? 2 : 0);
    // About as fast as the player: only clean runs and turbos keep you in front.
    racer.topSpeed = RUN_SPEED * (0.98 + Math.random() * 0.08);
    racer.runner.root.add(nameTag(RIVAL_NAMES[i], RIVAL_SHIRTS[i]));
    return {
      racer,
      base: racer.topSpeed,
      stage: 'run1',
      finishAt: 0,
      kitchenSeconds: 45 + Math.random() * 15,
      pickSeconds: 14 + Math.random() * 9,
      orchardAt: 0,
      clumsy: new Set(),
      reaction: 0.9 + Math.random() * 0.3,
    };
  });
  let playerStage: RivalState['stage'] = 'run1';
  let playerOrchardAt = 0;

  // ---- obstacles: random every round, rivals stumble over some of them
  const obstacles = [
    // First stretch: few obstacles, far apart, and the three kinds introduced one by one.
    ...layoutObstacles(40, RUN1_END - 14, Math.floor(Math.random() * 1e6), [9, 13], ['barrel', 'garland', 'cart']),
    ...layoutObstacles(RUN2_START + 16, FINISH - 10, Math.floor(Math.random() * 1e6), [7, 10]),
  ];
  obstacles.forEach((o) => world.root.add(o.obj));
  if (import.meta.env.DEV) Object.assign((window as unknown as { __game: object }).__game, { obstacles });
  for (const r of rivals) for (const o of obstacles) if (Math.random() < 0.12) r.clumsy.add(o);

  // ---- start: title over the start line, then countdown
  for (const r of [player, ...rivals.map((x) => x.racer)]) r.runner.pose = 'idle';
  // `slow` scales the runners' time: 0 freezes the race during the tutorial, the crowd keeps cheering.
  let slow = 1;
  let slowTarget = 1;
  const tick = clock.onUpdate((dt, t) => {
    slow += (slowTarget - slow) * (1 - Math.exp(-dt * 10));
    if (Math.abs(slowTarget - slow) < 0.01) slow = slowTarget;
    player.update(dt * slow);
    rivals.forEach((r) => r.racer.update(dt * slow));
    world.update(dt, t, -dio.viewCenter().z, dio.range(), dio.page());
  });
  const sign = new ArrowSign(1.6);
  world.root.add(sign.sprite);
  view.frame(new Vector3(0, 0, -5), 0.032, 2);
  await showTitle(ui, best);
  hud.setVisible(true);
  hud.setStage('Start');
  hud.setTime(0);
  sfx.cheer(3.2);
  await countdown(ui, (ms) => clock.wait(1.3 * ms), (go) => sfx.beep(go));
  const startAt = clock.time;
  // Time spent frozen in the tutorial does not count.
  let teachTime = 0;
  const elapsed = () => clock.time - startAt - teachTime;
  const splits: Split[] = [];
  let lapAt = 0;
  const lap = (label: string, icon: Split['icon']) => {
    splits.push({ label, icon, seconds: elapsed() - lapAt });
    lapAt = elapsed();
  };
  let timing = true;
  const offTimer = clock.onUpdate(() => {
    if (timing) hud.setTime(elapsed());
  });

  // ---- input while running
  pad.setVisible(true);
  pad.only(['up', 'down', 'left', 'right']);
  /** Arrow the tutorial is waiting for; other arrows are ignored meanwhile. */
  let teachWant: Dir | null = null;
  const act = (dir: Dir) => {
    const ok = dir === 'up' ? player.jump() : dir === 'down' ? player.slide() : player.steer(dir === 'left' ? -1 : 1);
    if (ok) sfx.whoosh();
  };
  const offPad = pad.on((dir: Dir) => {
    if (!player.running) return;
    if (teachWant && dir !== teachWant) {
      pad.shake(dir);
      sfx.miss();
      return;
    }
    act(dir);
  });

  // ---- per-frame race logic: collisions, prompts, rival AI, place
  let cheerAt = 0;
  const progressOf = (stage: RivalState['stage'], d: number, orchardAt: number, pick: number, finishAt: number) => {
    if (stage === 'done') return 10_000 - finishAt;
    if (stage === 'orchard') return RUN1_END + Math.min(1, (clock.time - orchardAt) / pick) * (RUN2_START - RUN1_END);
    return d;
  };
  const prevD = new Map<Racer, number>();
  const taught = new Set<Obstacle['kind']>();
  let pilotRaceAt = 0;
  let teach: Obstacle | null = null;
  let stuck: Obstacle | null = null;
  /** Obstacles the player had to deal with (they were in its lane when they came up). */
  const faced = new Set<Obstacle>();
  let streak = 0;
  let lastPlace = 0;
  let placeToastAt = 0;
  let sprinting = false;
  const race = clock.onUpdate((dt, t) => {
    const racers = [player, ...rivals.map((r) => r.racer)];
    for (const r of racers) {
      if (!r.running) {
        prevD.set(r, r.d);
        continue;
      }
      const before = prevD.get(r) ?? r.d;
      // Rivals stumble over what they miss; the player is held instead (see below).
      if (r !== player)
        for (const o of obstacles) if (o.d > before && o.d <= r.d && r.blockedBy(o)) r.stumble();
      prevD.set(r, r.d);
    }

    // The player cannot pass an obstacle without the right move: it stops in front of it.
    stuck = null;
    if (player.running) {
      for (const o of obstacles) {
        const gap = HOLD_GAP[o.kind];
        if (player.d < o.d - gap - 0.05 || player.d > o.d) continue;
        if (!player.blockedBy(o) || (o.kind === 'barrel' && player.airborne)) continue;
        player.holdAt(o.d - gap);
        stuck = o;
        if (!o.hit) {
          o.hit = true;
          sfx.bump();
          hud.toast('Autsch!', 'bad', 700);
        }
        break;
      }
    }

    // Prompt for the player's next obstacle (the orchard and kitchen run their own prompts):
    // the arrow button, a word in the middle and a sign floating above the obstacle itself.
    if (player.running) {
      let want: Dir | null = null;
      const next = obstacles.find((o) => o.d > player.d - 0.2 && o.d - player.d < PROMPT_AHEAD && answerFor(o, player.lane));
      if (next) {
        want = answerFor(next, player.lane);
        faced.add(next);
        if ((want === 'up' && player.airborne) || (want === 'down' && player.sliding)) want = null;
        // First crate, banner, cart: stop in front of it and wait for the arrow.
        if (want && !taught.has(next.kind) && next.d - player.d < TEACH_AT[next.kind]) {
          taught.add(next.kind);
          teach = next;
        }
      }
      if (teach && (teach.d < player.d || !answerFor(teach, player.lane))) teach = null;
      const waiting = (teach !== null && want !== null) || stuck !== null;
      slowTarget = teach && want ? 0 : 1;
      if (teach && want) teachTime += dt;
      teachWant = teach && want ? want : null;
      pad.hint(want);
      hud.showPrompt(want, want ? (waiting ? TEACH_TEXT[want] : DIR_WORD[want]) : '');
      if (want && next) {
        const x = next.kind === 'garland' ? 0 : LANES[player.lane];
        sign.show(want, x, 3.4 + Math.sin(t * 5) * 0.12, -next.d, waiting ? Math.sin(t * 8) : 0);
      } else sign.show(null);
    }

    // Clean dodges in a row build up to a «Turbo!»; a bump resets the run.
    if (player.running) {
      for (const o of obstacles) {
        if (o.passed || o.d > player.d) continue;
        o.passed = true;
        if (o.hit) streak = 0;
        else if (faced.has(o)) {
          streak++;
          if (streak % TURBO_EVERY === 0) {
            player.boost(2.2);
            sfx.fanfare();
            hud.toast('Turbo!', 'good', 1000);
          } else {
            sfx.pop(streak);
            hud.toast(streak > 1 ? `Super! ×${streak}` : 'Super!', 'good', 600);
          }
        }
      }
      if (playerStage === 'run2' && !sprinting && player.d > FINISH - SPRINT_AT) {
        sprinting = true;
        hud.toast('Endspurt!', 'good', 1300);
        sfx.cheer(4, 0.24);
      }
    }

    // Rivals dodge like the player would, a beat before the obstacle.
    // Their pace bends towards the player's, so the field stays together and overtakes happen.
    for (const r of rivals) {
      const rc = r.racer;
      if (!rc.running) continue;
      if (player.running && r.stage === playerStage) {
        const gap = rc.d - player.d;
        const f = gap > 10 ? 0.86 : gap > 4 ? 0.95 : gap < -10 ? 1.16 : gap < -4 ? 1.06 : 1;
        rc.topSpeed = r.base * f;
      } else rc.topSpeed = r.base;
      const o = obstacles.find((x) => x.d > rc.d && x.d - rc.d < 10 && answerFor(x, rc.lane));
      if (!o || r.clumsy.has(o)) continue;
      const a = answerFor(o, rc.lane);
      const dist = o.d - rc.d;
      if (a === 'up' && dist < rc.speed * 0.36 * r.reaction) rc.jump();
      else if (a === 'down' && dist < rc.speed * 0.3 * r.reaction) rc.slide();
      else if ((a === 'left' || a === 'right') && dist < 8 * r.reaction) rc.steer(a === 'left' ? -1 : 1);
    }

    // Review pilot (dev): dodges like a rival, a little late now and then.
    if (opts.autoplay && player.running && pad.want && t > pilotRaceAt) {
      const o = obstacles.find((x) => x.d > player.d - 0.1 && answerFor(x, player.lane));
      const dist = o ? o.d - player.d : 99;
      const due = slowTarget === 0 || stuck || (pad.want === 'up' ? dist < 2.4 : pad.want === 'down' ? dist < 1.8 : dist < 5);
      if (due) {
        pilotRaceAt = t + 0.3;
        pad.press(pad.want);
      }
    }

    // Place and mini map.
    const me = progressOf(playerStage, player.d, playerOrchardAt, 22, elapsed());
    const others = rivals.map((r) => progressOf(r.stage, r.racer.d, r.orchardAt, r.pickSeconds + 6, r.finishAt));
    const place = 1 + others.filter((p) => p > me).length;
    hud.setPlace(place, RIVALS + 1);
    // Overtaking is announced (not too often, and not in the crush right after the start).
    if (player.running && lastPlace && place !== lastPlace && t > placeToastAt && elapsed() > 4) {
      placeToastAt = t + 1.5;
      if (place < lastPlace) {
        sfx.pop(8);
        hud.toast(place === 1 ? 'Du führst!' : `Überholt! ${place}. Platz`, 'good', 1000);
      } else hud.toast(`${place}. Platz`, 'bad', 800);
    }
    lastPlace = place;
    hud.setTrack([me, ...others].map((p) => (p > 5000 ? 1 : p / FINISH)));

    if (t > cheerAt && player.running) {
      cheerAt = t + (sprinting ? 1.2 : 2.6 + Math.random() * 2);
      sfx.cheer(1.8, sprinting ? 0.16 : 0.09);
    }
  });

  // Off the track the pilot presses whatever the game currently expects.
  let pilotAt = 0;
  const offPilot = clock.onUpdate((_dt, t) => {
    if (!opts.autoplay || player.running || !pad.want || t < pilotAt) return;
    pilotAt = t + 0.06 + Math.random() * (Math.random() < 0.3 ? 1.6 : 0.3);
    pad.press(pad.want);
  });

  const until = (fn: () => boolean) =>
    new Promise<void>((resolve) => {
      if (fn()) return resolve();
      const off = clock.onUpdate(() => {
        if (fn()) {
          off();
          resolve();
        }
      });
    });

  // ---- rivals' own race, scripted around the shared physics
  const freeTrees = world.trees.filter((t) => !t.taken);
  const rivalRuns = rivals.map(async (r, i) => {
    const rc = r.racer;
    rc.running = true;
    await until(() => rc.d >= RUN1_END + i * 0.5);
    r.stage = 'orchard';
    r.orchardAt = clock.time;
    const tree: Tree = freeTrees[i % freeTrees.length];
    const back = new Vector3(LANES[i % 2 ? 2 : 0], 0, -RUN2_START);
    await rivalOrchard(env, rc, tree, r.pickSeconds, back);
    rc.scripted = false;
    rc.place(RUN2_START, i % 2 ? 2 : 0);
    r.stage = 'run2';
    rc.running = true;
    await until(() => rc.d >= FINISH);
    rc.running = false;
    r.stage = 'done';
    r.finishAt = elapsed();
    rc.runner.pose = 'cheer';
    await jogTo(env, rc, new Vector3(LANES[i % 3] * 1.6, 0, -(FINISH + 7)), 5);
    rc.runner.root.visible = false;
  });
  void rivalRuns;

  if (opts.startAt === 'orchard') {
    player.place(RUN1_END - 4, 1);
    rivals.forEach((r, i) => r.racer.place(RUN1_END - 6 - i, i % 3));
    obstacles.forEach((o) => (o.passed = o.d < RUN1_END));
  }

  // ---- 1 · Lauf zum Baum
  hud.setStage('Lauf zum Chriesibaum');
  player.running = true;
  rivals.forEach((r) => (r.racer.running = true));
  const runView = (): ViewShot => ({ center: new Vector3(0, 0, -(player.d + RUN_LOOK_AHEAD)), scale: RUN_SCALE });
  view.follow(runView, 3);
  await until(() => player.d >= RUN1_END);
  lap('Lauf zum Baum', 'flag');

  // ---- 2 · orchard
  playerStage = 'orchard';
  playerOrchardAt = clock.time;
  sign.show(null);
  pad.hint(null);
  hud.showPrompt(null);
  player.running = false;
  await playerOrchard(env, player, world.playerTree, new Vector3(LANES[1], 0, -RUN2_START));
  player.scripted = false;
  player.place(RUN2_START, 1);
  playerStage = 'run2';
  lap('Pflücken', 'cherries');

  // ---- 3 · run to the finish
  pad.only(['up', 'down', 'left', 'right']);
  hud.setStage('Lauf ins Ziel');
  hud.toast('Weiter!', 'good', 900);
  player.running = true;
  view.follow(runView, 2);
  await until(() => player.d >= FINISH);
  player.running = false;
  playerStage = 'done';
  lap('Lauf ins Ziel', 'flag');
  race();
  sign.show(null);
  pad.hint(null);
  hud.showPrompt(null);
  hud.setTrack(null);
  hud.setPlace(null);
  hud.toast('Ziel! Ab in die Chuchi!', 'good', 1600);
  sfx.cheer(3, 0.2);
  sfx.fanfare();

  // ---- 4 · the town folds away, the kitchen opens
  pad.setVisible(false);
  hud.setStage('Chriesi-Chuchi');
  view.frame(new Vector3(0, 0, -(FINISH + 8)), 0.032, 2);
  await jogTo(env, player, new Vector3(0, 0, -(FINISH + 6)), 6);
  view.frame(kitchen.root.position.clone().add(new Vector3(0, 0, -0.75)), KITCHEN_SCALE, 1.6);
  sfx.page();
  await world.fold(clock, 1700);
  // Only the kitchen stays: street, rails and lake would share the floor's height and flicker.
  for (const c of townPieces) c.visible = false;
  obstacles.forEach((o) => (o.obj.visible = false));
  // Cherries in, ladder off: the race basket goes on the table.
  const bask = player.runner.root.getObjectByName('basket');
  if (bask) {
    kitchen.root.add(bask);
    bask.position.set(-3.1, 1.0, 0.45);
    bask.scale.setScalar(8);
  }
  player.runner.ladder.removeFromParent();
  player.runner.carrying = false;
  player.runner.root.position.copy(kitchen.root.position).add(new Vector3(-3.6, 0, -1.55));
  await kitchen.unfold(env, 1500);
  pad.setVisible(true);
  const kitchenSplits = await kitchen.run(env, player);
  (['Waschen', 'Entsteinen', 'Kochen', 'Abfüllen'] as const).forEach((label, i) =>
    splits.push({ label, icon: (['cherries', 'cherries', 'replay', 'flag'] as const)[i], seconds: kitchenSplits[i] }),
  );
  timing = false;
  offTimer();
  const total = elapsed();
  hud.setTime(total);
  pad.setVisible(false);
  hud.showPrompt(null);

  // ---- 5 · results
  const rivalTotals = rivals.map((r) => {
    if (r.stage === 'done') return r.finishAt + r.kitchenSeconds;
    const left = FINISH - progressOf(r.stage, r.racer.d, r.orchardAt, r.pickSeconds + 6, 0);
    return total + Math.max(0, left) / 7.5 + r.kitchenSeconds;
  });
  const place = 1 + rivalTotals.filter((t) => t < total).length;
  const isBest = best === null || total < best;
  if (isBest) writeBest(total);
  await clock.wait(1400);
  hud.setVisible(false);
  const choice = await showResults(ui, { total, splits, place, of: RIVALS + 1, best, isBest });

  // ---- clean up this round
  tick();
  offPad();
  offPilot();
  offFrame();
  pad.dispose();
  hud.dispose();
  sign.dispose();
  kitchen.dispose();
  world.dispose();
  shadowGeo.dispose();
  shadowMat.dispose();
  world.root.traverse((o) => (o as Mesh).geometry?.dispose());
  dio.dispose();
  stage.tracker?.lockView?.(false);
  return { choice, best: isBest ? total : best };
}
