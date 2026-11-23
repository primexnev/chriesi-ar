import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  MathUtils,
  Object3D,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Mesh,
} from 'three';
import { AssetLibrary } from '../core/assets';
import { StoryClock, easeOut } from '../core/clock';
import { modelUrls, Models } from '../scenes/shared/models';
import { PALETTE } from '../scenes/shared/palette';
import { basket, mat, mesh } from '../scenes/shared/placeholders';
import { GestureInput, type SwipeDir, type Want } from './gestures';
import type { GameOptions } from './index';
import { buildJourneyWorld, shadowDisc, tapRing, type JourneyWorld } from './journey-world';
import { JourneyUI, type HintKind } from './journey-ui';
import { gameModelUrls } from './models';
import { Runner, runnerPlaceholder } from './runner';

/*
 * «Chriesi-Reise» — the game after the story, rebuilt after the teachers' review:
 *  - the whole world is seen from above at once, larger than the printed spread
 *  - the way is a path through the whole map, not a straight street
 *  - no clock, no rivals, no places: the child moves the walker on with one gesture per
 *    obstacle (tap, swipe up / down / sideways, hold, rub, circle), and nothing can be lost
 *  - help is always near: a hand shows the gesture, and after a while a big «Weiter» button
 *    (or Space / Enter) does it instead, so every child gets to the end
 */

/** Page units per metre: the 72 × 48 m board is ≈ 1.9 × 1.25 spread widths. */
const SCALE = 0.026;
/** Walking pace (m/s): calm, so the child can follow the walker along the path. */
const WALK = 4.6;
/** The walker stops this far (m) before an obstacle and waits for the gesture. */
const STOP_GAP = 2.4;
/** After this long without the gesture, the «Weiter» button appears. */
const HELP_AFTER_MS = 9000;
const CHERRIES = 5;
const JARS = 3;

type Step = (s: number) => Promise<void>;

/** Our GLB models used on the map (the rest of the library is for the story). */
const MAP_MODELS = ['clockTower', 'house_0', 'house_1', 'house_2', 'fountain', 'bridge', 'startArch', 'alps', 'zugerberg', 'marketStall', 'church', 'mill'];

export async function runJourney(opts: GameOptions): Promise<void> {
  opts.music?.preload();
  const library = new AssetLibrary(opts.stage.tracker!.renderer);
  const story = modelUrls();
  await library.loadAll({
    ...Object.fromEntries(MAP_MODELS.map((k) => [k, story[k]])),
    raceRunner: gameModelUrls().raceRunner,
  });
  for (;;) {
    const choice = await playJourney(opts, library);
    if (choice === 'story') break;
  }
}

async function playJourney(opts: GameOptions, library: AssetLibrary): Promise<'again' | 'story'> {
  const { stage, sfx } = opts;
  const tracker = stage.tracker!;
  const models = new Models(library);
  const world: JourneyWorld = buildJourneyWorld(models);
  const clock = new StoryClock();
  const offFrame = stage.onFrame((dt) => {
    if (!stage.clock.isPaused) clock.tick(dt * (opts.speed ?? 1));
  });

  // ---- the board on the page: no clipping, the whole map at once
  const holder = new Group();
  holder.name = 'journey-board';
  const board = new Group();
  board.scale.setScalar(SCALE);
  board.position.y = 0.002;
  board.add(world.root);
  const hemi = new HemisphereLight(0xeaf3ff, PALETTE.meadow, 1.8);
  const sun = new DirectionalLight(0xffffff, 2.2);
  sun.position.set(-0.4, 1, 0.6);
  holder.add(board, hemi, sun, sun.target);
  stage.content.add(holder);
  if (import.meta.env.DEV) (window as unknown as { __journey: unknown }).__journey = { world, stage, holder };
  tracker.lockView?.(true);
  tracker.overview?.(true);

  // ---- the walker: a low-poly child with the ladder of the Chriesisturm
  const runner = new Runner(
    models.get('raceRunner', () => runnerPlaceholder(PALETTE.cherry, 0)),
    library.animations('raceRunner'),
  );
  runner.root.scale.setScalar(1.3);
  const shadow = shadowDisc(0.7);
  world.root.add(runner.root, shadow);
  let s = 0;
  let y = 0;
  let speed = 0;
  const tmp = new Vector3();
  const place = () => {
    const u = MathUtils.clamp(s / world.length, 0, 1);
    world.path.getPointAt(u, tmp);
    const t = world.path.getTangentAt(u);
    runner.root.position.set(tmp.x, y + world.heightAt(s), tmp.z);
    runner.root.rotation.y = Math.atan2(-t.x, -t.z);
    shadow.position.set(tmp.x, 0.13 + world.heightAt(s), tmp.z);
    shadow.scale.setScalar(Math.max(0.5, 1 - y * 0.3));
  };
  place();
  const tick = clock.onUpdate((dt, t) => {
    runner.update(dt, speed);
    world.update(dt, t);
  });

  /** Walk along the path to `to` (metres from the start). */
  const walkTo = (to: number, pace = WALK) =>
    new Promise<void>((resolve) => {
      runner.pose = 'run';
      const off = clock.onUpdate((dt) => {
        speed = Math.min(pace, speed + dt * 6);
        s = Math.min(to, s + speed * dt);
        place();
        if (s >= to - 1e-3) {
          off();
          speed = 0;
          runner.pose = 'idle';
          resolve();
        }
      });
    });

  // ---- asking for a gesture: hand hint, ring on the thing, help button later
  const ui = new JourneyUI(opts.ui);
  const gestures = new GestureInput(tracker.inputElement, () => stage.tracker?.camera ?? null);
  gestures.onProgress = (p) => ui.progress(p);
  gestures.onMiss = () => ui.nudge();
  const ring = tapRing(1.6);
  ring.visible = false;
  world.root.add(ring);
  const offRing = clock.onUpdate((_dt, t) => {
    if (!ring.visible) return;
    ring.scale.setScalar(1 + Math.sin(t * 6) * 0.12);
  });

  const ask = async (want: Want, text: string, ringAt?: Object3D): Promise<SwipeDir | Want['kind']> => {
    const kind: HintKind = want.kind === 'swipe' ? want.dir : want.kind;
    ui.hint(kind, text);
    if (ringAt) {
      ringAt.getWorldPosition(tmp);
      world.root.worldToLocal(tmp);
      ring.position.set(tmp.x, 0.15, tmp.z);
      ring.visible = true;
    }
    const exp = gestures.expect(want);
    let settled = false;
    void clock.wait(HELP_AFTER_MS).then(() => {
      if (!settled) ui.showHelp(() => exp.complete());
    });
    if (opts.autoplay) void clock.wait(700).then(() => !settled && exp.complete());
    const result = await exp.done;
    settled = true;
    ring.visible = false;
    ui.hideHelp();
    ui.hideHint();
    return result;
  };
  const praise = (text = 'Super!') => {
    ui.praise(text);
    sfx.pop(3);
  };

  // ---- obstacles stand across the path; their local x runs across it
  const at = (stop: number, obj: Object3D) => {
    const u = stop / world.length;
    const p = world.path.getPointAt(u);
    const t = world.path.getTangentAt(u);
    obj.position.set(p.x, 0, p.z);
    obj.rotation.y = Math.atan2(t.x, t.z);
    world.root.add(obj);
    return u * world.length;
  };
  /** Move an obstacle off the path, sideways in its own frame. */
  const shove = async (obj: Object3D, side: number, ms = 700) => {
    const from = obj.position.clone();
    const dir = new Vector3(side, 0, 0).applyAxisAngle(new Vector3(0, 1, 0), obj.rotation.y);
    await clock.tween(ms, (k) => {
      obj.position.copy(from).addScaledVector(dir, k * 4);
      obj.position.y = Math.sin(k * Math.PI) * 0.8;
      obj.rotation.z = -side * k * 0.6;
    }, easeOut);
  };

  // 1 · a crate: tap it away
  const crate = new Group();
  const box = mesh(new BoxGeometry(1.5, 1.2, 1.2), PALETTE.wood);
  box.position.y = 0.6;
  const band = mesh(new BoxGeometry(1.55, 0.18, 1.25), 0x7a5230);
  band.position.y = 0.6;
  crate.add(box, band);
  const crateS = at(world.stops.crate, crate);

  // 2 · a log: swipe up to jump
  const log = new Group();
  const trunk = mesh(new CylinderGeometry(0.4, 0.4, 2.6, 7), 0x7a5230);
  trunk.rotation.z = Math.PI / 2;
  trunk.position.y = 0.4;
  log.add(trunk);
  const logS = at(world.stops.log, log);

  // 3 · a low garland: swipe down to duck
  const garland = new Group();
  for (const x of [-1.6, 1.6]) {
    const pole = mesh(new CylinderGeometry(0.09, 0.09, 2.2, 5), PALETTE.cream);
    pole.position.set(x, 1.1, 0);
    garland.add(pole);
  }
  for (let i = 0; i < 7; i++) {
    const flag = mesh(new ConeGeometry(0.22, 0.4, 3), i % 2 ? PALETTE.cherry : PALETTE.cream);
    flag.rotation.x = Math.PI;
    flag.position.set(-1.35 + i * 0.45, 1.75 - Math.sin((i / 6) * Math.PI) * 0.25, 0);
    garland.add(flag);
  }
  const garlandS = at(world.stops.garland, garland);

  // 4 · a garden gate: hold to open
  const gate = new Group();
  const wings: Group[] = [];
  for (const side of [-1, 1]) {
    const post = mesh(new BoxGeometry(0.22, 1.6, 0.22), PALETTE.wood);
    post.position.set(side * 1.5, 0.8, 0);
    const wing = new Group();
    wing.position.set(side * 1.4, 0, 0);
    const plank = mesh(new BoxGeometry(1.35, 1.0, 0.1), 0xd8a65a);
    plank.position.set(-side * 0.68, 0.7, 0);
    wing.add(plank);
    gate.add(post, wing);
    wings.push(wing);
  }
  const gateS = at(world.stops.gate, gate);

  // 5 · the cherry tree beside the path: tap the crown to pick
  const treeS = world.stops.tree;
  const crown = new Object3D();
  crown.position.set(0, 0.09, 0);
  world.tree.add(crown);
  const treeCherries = world.tree.children.filter((c) => c.name === 'cherry');

  // 6 · a hand cart: swipe sideways to push it off the path
  const cart = new Group();
  const bed = mesh(new BoxGeometry(1.8, 0.6, 1.2), 0xb4553a);
  bed.position.y = 0.75;
  cart.add(bed);
  for (const x of [-0.7, 0.7]) {
    const wheel = mesh(new TorusGeometry(0.32, 0.09, 4, 10), 0x3c3f4a);
    wheel.position.set(x, 0.35, 0.62);
    cart.add(wheel);
  }
  const cartS = at(world.stops.cart, cart);

  // 7 · a cat sitting on the path: stroke it, then it walks away
  const cat = new Group();
  const catBody = mesh(new BoxGeometry(0.5, 0.45, 0.9), 0xe09f3e);
  catBody.position.y = 0.3;
  const catHead = mesh(new BoxGeometry(0.42, 0.38, 0.38), 0xe09f3e);
  catHead.position.set(0, 0.68, 0.45);
  cat.add(catBody, catHead);
  for (const x of [-0.12, 0.12]) {
    const ear = mesh(new ConeGeometry(0.08, 0.18, 3), 0xc77d2a);
    ear.position.set(x, 0.92, 0.45);
    cat.add(ear);
  }
  const tail = mesh(new CylinderGeometry(0.05, 0.05, 0.7, 4), 0xc77d2a);
  tail.position.set(0, 0.55, -0.55);
  tail.rotation.x = -0.7;
  cat.add(tail);
  cat.scale.setScalar(1.3);
  const catS = at(world.stops.cat, cat);
  cat.rotation.y += Math.PI; // looks at the walker

  // ---- the stations, in order
  const steps: Array<[number, Step]> = [
    [
      crateS,
      async () => {
        await ask({ kind: 'tap', target: crate }, 'Tippe auf die Kiste!', crate);
        sfx.whoosh();
        await shove(crate, 1);
        crate.visible = false;
        praise();
      },
    ],
    [
      logS,
      async (stop) => {
        await ask({ kind: 'swipe', dir: 'up' }, 'Wisch nach oben zum Springen!');
        sfx.whoosh();
        runner.pose = 'jump';
        await clock.tween(900, (k) => {
          s = stop + k * (STOP_GAP * 2);
          y = Math.sin(k * Math.PI) * 1.6;
          place();
        });
        y = 0;
        place();
        praise('Hopp!');
      },
    ],
    [
      garlandS,
      async (stop) => {
        await ask({ kind: 'swipe', dir: 'down' }, 'Wisch nach unten zum Ducken!');
        sfx.whoosh();
        runner.pose = 'slide';
        await clock.tween(1000, (k) => {
          s = stop + k * (STOP_GAP * 2);
          place();
        });
        runner.pose = 'idle';
        praise();
      },
    ],
    [
      gateS,
      async () => {
        await ask({ kind: 'hold' }, 'Halte deinen Finger, das Tor geht auf!', gate);
        sfx.chirp();
        await clock.tween(800, (k) => wings.forEach((w, i) => (w.rotation.y = (i ? -1 : 1) * k * 1.6)));
        praise();
      },
    ],
    [
      treeS + STOP_GAP,
      async () => {
        const bask = basket();
        bask.scale.setScalar(28);
        bask.position.set(0.55, 0.75, -0.25);
        runner.root.add(bask);
        const contents = bask.getObjectByName('contents')!;
        runner.root.rotation.y -= Math.PI / 2; // turn right, to the tree
        for (let i = 0; i < CHERRIES; i++) {
          await ask({ kind: 'tap', target: crown }, i === 0 ? 'Tippe auf den Baum: pflück Kirschen!' : `Noch ${CHERRIES - i}!`, crown);
          runner.pose = 'pick';
          const c = treeCherries[i];
          if (c) {
            const from = c.getWorldPosition(new Vector3());
            contents.add(c);
            const fromLocal = contents.worldToLocal(from);
            const end = new Vector3((i % 3) * 0.012 - 0.012, 0.012, (i % 2) * 0.01 - 0.005);
            await clock.tween(450, (k) => {
              c.position.lerpVectors(fromLocal, end, k);
              c.position.y += Math.sin(k * Math.PI) * 0.06;
            });
            c.scale.setScalar(0.9);
          }
          sfx.plop();
          runner.pose = 'idle';
        }
        praise('Super, ein voller Korb!');
        place();
      },
    ],
    [
      cartS,
      async () => {
        const dir = await ask({ kind: 'swipe', dir: 'side' }, 'Schieb den Wagen zur Seite!', cart);
        sfx.whoosh();
        await shove(cart, dir === 'left' ? -1 : 1, 900);
        praise();
      },
    ],
    [
      catS,
      async () => {
        await ask({ kind: 'rub', strokes: 4 }, 'Streichle die Katze: hin und her!', cat);
        sfx.chirp();
        await clock.tween(250, (k) => (cat.position.y = Math.sin(k * Math.PI) * 0.5));
        await shove(cat, 1, 900);
        praise('Miau!');
      },
    ],
  ];

  // ---- start
  // Compile all shaders while the start card is up, so the first steps do not stutter.
  try {
    await tracker.renderer.compileAsync(tracker.scene, tracker.camera);
  } catch {
    /* older drivers: compiled on first draw instead */
  }
  void opts.music?.start();
  await ui.title();
  // The race starts like the real Chriesisturm: with the bell.
  await ask({ kind: 'tap', target: world.tower }, 'Tippe auf den Zytturm: die Glocke läutet!', world.tower);
  sfx.bell();
  praise('Los!');
  steps.sort((a, b) => a[0] - b[0]);
  for (const [obstacleS, step] of steps) {
    const stop = Math.max(s, obstacleS - STOP_GAP);
    await walkTo(stop);
    await step(stop);
  }
  await walkTo(world.length);

  // ---- the Chriesi-Chuchi: a table in front of the house
  const kitchen = buildTable();
  const end = world.path.getPointAt(1);
  const et = world.path.getTangentAt(1);
  kitchen.root.position.set(end.x + et.x * 1.6 - et.z * 1.8, 0, end.z + et.z * 1.6 + et.x * 1.8);
  kitchen.root.rotation.y = Math.atan2(et.z, -et.x);
  world.root.add(kitchen.root);
  await clock.tween(600, (k) => kitchen.root.scale.setScalar(Math.max(0.01, k)), easeOut);
  runner.root.rotation.y = Math.atan2(kitchen.root.position.x - runner.root.position.x, kitchen.root.position.z - runner.root.position.z) + Math.PI;

  await ask({ kind: 'rub', strokes: 4 }, 'Wasch die Kirschen: reib hin und her!', kitchen.bowl);
  sfx.splash();
  kitchen.washed();
  praise('Sauber!');
  await ask({ kind: 'circle', turns: 1.5 }, 'Rühr im Topf: mal einen Kreis!', kitchen.pot);
  sfx.plop();
  kitchen.cooked();
  praise('Fein!');
  for (let i = 0; i < JARS; i++) {
    await ask({ kind: 'swipe', dir: 'down' }, i === 0 ? 'Füll die Gläser: wisch nach unten!' : `Noch ${JARS - i} Glas!`, kitchen.jars[i]);
    sfx.plop();
    await clock.tween(500, (k) => kitchen.fill(i, k));
  }

  // ---- the end: everybody has made it
  runner.pose = 'cheer';
  sfx.fanfare();
  opts.music?.stop(1.2);
  void opts.music?.win();
  await clock.wait(900);
  const choice = await ui.finale();

  // ---- clean up
  tick();
  offRing();
  offFrame();
  gestures.dispose();
  ui.dispose();
  holder.removeFromParent();
  holder.traverse((o) => (o as Mesh).geometry?.dispose());
  tracker.lockView?.(false);
  tracker.overview?.(false);
  return choice;
}

/** The kitchen table in front of the Chriesi-Chuchi: bowl, pot and jars, in metres. */
function buildTable() {
  const root = new Group();
  const top = mesh(new BoxGeometry(3.4, 0.14, 1.4), PALETTE.wood);
  top.position.y = 1.0;
  root.add(top);
  for (const [x, z] of [
    [-1.5, -0.55],
    [1.5, -0.55],
    [-1.5, 0.55],
    [1.5, 0.55],
  ]) {
    const leg = mesh(new BoxGeometry(0.12, 1.0, 0.12), 0x7a5230);
    leg.position.set(x, 0.5, z);
    root.add(leg);
  }
  const bowl = mesh(new CylinderGeometry(0.45, 0.32, 0.3, 9), PALETTE.zugBlue);
  bowl.position.set(-1.1, 1.22, 0);
  const water = mesh(new CylinderGeometry(0.4, 0.4, 0.02, 9), PALETTE.lake);
  water.position.set(-1.1, 1.34, 0);
  const pot = mesh(new CylinderGeometry(0.45, 0.42, 0.5, 9), PALETTE.copper);
  pot.position.set(0, 1.32, 0);
  const jam = mesh(new CylinderGeometry(0.4, 0.4, 0.02, 9), PALETTE.cream);
  jam.position.set(0, 1.58, 0);
  const spoon = mesh(new BoxGeometry(0.06, 0.8, 0.06), PALETTE.wood);
  spoon.position.set(0.2, 1.75, 0);
  spoon.rotation.z = -0.3;
  root.add(bowl, water, pot, jam, spoon);
  const jars: Group[] = [];
  const fills: Mesh[] = [];
  for (let i = 0; i < JARS; i++) {
    const jar = new Group();
    const glass = mesh(new CylinderGeometry(0.18, 0.18, 0.42, 8), 0xdfeef5);
    glass.position.y = 0.21;
    const fill = mesh(new CylinderGeometry(0.17, 0.17, 0.4, 8), PALETTE.cherry);
    fill.scale.y = 0.01;
    fill.position.y = 0.01;
    const lid = mesh(new CylinderGeometry(0.2, 0.2, 0.08, 8), 0xf2b134);
    lid.position.y = 0.46;
    lid.visible = false;
    jar.add(glass, fill, lid);
    jar.position.set(0.85 + i * 0.42, 1.07, 0);
    root.add(jar);
    jars.push(jar);
    fills.push(fill);
  }
  const washCherries = new Group();
  for (let i = 0; i < 5; i++) {
    const c = mesh(new SphereGeometry(0.09, 6, 4), PALETTE.cherry);
    c.position.set(-1.1 + (i - 2) * 0.12, 1.4, (i % 2) * 0.12 - 0.06);
    washCherries.add(c);
  }
  root.add(washCherries);
  root.scale.setScalar(0.01);
  return {
    root,
    bowl,
    pot,
    jars,
    washed() {
      water.material = mat(0x9cc9ea);
    },
    cooked() {
      jam.material = mat(PALETTE.cherry);
      washCherries.visible = false;
      spoon.rotation.z = 0.3;
    },
    fill(i: number, k: number) {
      const f = fills[i];
      f.scale.y = Math.max(0.01, k);
      f.position.y = 0.2 * k + 0.01;
      if (k >= 1) jars[i].children[2].visible = true;
    },
  };
}
