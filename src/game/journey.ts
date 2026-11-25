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
import { buildJourneyWorld, MAP_HALF_W, shadowDisc, tapRing, villager, type JourneyWorld } from './journey-world';
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

/** Page units per metre: the 72 × 48 m board is ≈ 2.4 × 1.6 spread widths, bigger than the paper. */
const SCALE = 0.034;
/** The walker, a little bigger than life so the child always finds it. */
const RUNNER = 1.5;
/** Obstacles grow with the walker. */
const PROP = 1.3;
/** Basket size: ≈ 0.6 m across, carried in the right hand. */
const BASKET = 10;
/** Cherries in the basket: ≈ 0.3 m, big enough to count from above. */
const BASKET_CHERRY = 1.6;
/** Walking pace (m/s): calm, so the child can follow the walker along the path. */
const WALK = 4.6;
/** The walker stops this far (m) before an obstacle and waits for the gesture. */
const STOP_GAP = 3;
/** After this long without the gesture, the «Weiter» button appears. */
const HELP_AFTER_MS = 9000;
const CHERRIES = 5;
/** Page units per metre in the kitchen: the 6 m room fills the spread. */
const KITCHEN = 0.16;
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

let runnerRef: Runner | null = null;

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
  if (import.meta.env.DEV) (window as unknown as { __journey: unknown }).__journey = { world, stage, holder, clock, get runner() { return runnerRef; } };
  tracker.lockView?.(true);
  tracker.overview?.(true, MAP_HALF_W * 2 * SCALE);

  // ---- the walker: a low-poly child with the ladder of the Chriesisturm
  const runner = new Runner(
    models.get('raceRunner', () => runnerPlaceholder(PALETTE.cherry, 0)),
    library.animations('raceRunner'),
  );
  runner.root.scale.setScalar(RUNNER);
  // no ladder on this walk (it swept through the people beside the path): a basket in the hand instead
  runner.carrying = false;
  runner.ladder.removeFromParent();
  const hand = runner.model.getObjectByName('Hand_R') ?? runner.model.getObjectByName('arm_R');
  const bask = basket();
  bask.scale.setScalar(BASKET);
  world.root.add(bask);
  const contents = bask.getObjectByName('contents')!;
  runnerRef = runner;
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
  const handAt = new Vector3();
  /** The basket hangs from the hand by its handle, upright, turned with the walker. */
  const carryBasket = () => {
    if (bask.parent !== world.root) return;
    if (hand) {
      runner.root.updateMatrixWorld(true);
      hand.getWorldPosition(handAt);
      world.root.worldToLocal(handAt);
    } else handAt.copy(runner.root.position).add(new Vector3(0.5, 1, 0));
    // keep the basket clear of the legs: its centre at least a basket-radius plus a hip from the body axis
    const dx = handAt.x - runner.root.position.x;
    const dz = handAt.z - runner.root.position.z;
    const off = Math.hypot(dx, dz) || 1;
    const out = Math.max(off, 0.03 * BASKET + 0.2 * RUNNER) / off;
    bask.position.set(runner.root.position.x + dx * out, Math.max(0.15, handAt.y - 0.05 * BASKET), runner.root.position.z + dz * out);
    bask.rotation.y = runner.root.rotation.y;
  };
  const tick = clock.onUpdate((dt, t) => {
    runner.update(dt, speed);
    carryBasket();
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
  let ringSize = 1;
  const offRing = clock.onUpdate((_dt, t) => {
    if (!ring.visible) return;
    ring.scale.setScalar(ringSize * (1 + Math.sin(t * 6) * 0.12));
  });

  /** In the kitchen the ring lies around the thing on the table, not on the ground. */
  let ringOnTable = false;
  const ask = async (want: Want, text: string, ringAt?: Object3D, size = 1): Promise<SwipeDir | Want['kind']> => {
    const kind: HintKind = want.kind === 'swipe' ? want.dir : want.kind;
    ui.hint(kind, text);
    if (ringAt) {
      ringAt.getWorldPosition(tmp);
      ring.parent!.worldToLocal(tmp);
      ring.position.set(tmp.x, ringOnTable ? tmp.y + 0.12 : 0.15, tmp.z);
      ringSize = size;
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
    obj.scale.multiplyScalar(PROP);
    world.root.add(obj);
    return u * world.length;
  };
  /** Move an obstacle off the path, sideways in its own frame. */
  const shove = async (obj: Object3D, side: number, ms = 700) => {
    const from = obj.position.clone();
    const dir = new Vector3(side, 0, 0).applyAxisAngle(new Vector3(0, 1, 0), obj.rotation.y);
    await clock.tween(ms, (k) => {
      obj.position.copy(from).addScaledVector(dir, k * 5);
      obj.position.y = Math.sin(k * Math.PI) * 1.8;
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
        runner.root.rotation.y -= Math.PI / 2; // turn right, to the tree
        for (let i = 0; i < CHERRIES; i++) {
          await ask({ kind: 'tap', target: crown }, i === 0 ? 'Tippe auf den Baum: pflück Kirschen!' : `Noch ${CHERRIES - i}!`, crown);
          runner.pose = 'pick';
          const c = treeCherries[i];
          if (c) {
            const from = c.getWorldPosition(new Vector3());
            const fromScale = c.getWorldScale(new Vector3()).x / (SCALE * BASKET);
            contents.add(c);
            c.rotation.set(0, i, 0);
            const fromLocal = contents.worldToLocal(from);
            // two layers: three cherries at the bottom, two on top
            const a = (i < 3 ? i / 3 : (i - 3) / 2 + 0.25) * Math.PI * 2;
            const ring = i < 3 ? 0.011 : 0.006;
            const end = new Vector3(Math.cos(a) * ring, i < 3 ? 0.012 : 0.026, Math.sin(a) * ring);
            await clock.tween(550, (k) => {
              c.position.lerpVectors(fromLocal, end, k);
              c.position.y += Math.sin(k * Math.PI) * 0.08;
              c.scale.setScalar(fromScale + (BASKET_CHERRY - fromScale) * k);
            });
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

  // ---- the Chriesi-Chuchi: the map makes way for a big kitchen that fills the page
  const kitchen = buildTable();
  const room = buildKitchen();
  kitchen.root.scale.setScalar(1);
  room.root.add(kitchen.root);
  tracker.overview?.(false);
  await clock.tween(700, (k) => board.scale.setScalar(SCALE * Math.max(0.001, 1 - k)), (k) => k * k);
  board.visible = false;
  // the walker stands behind the table and looks at the child; the basket is put down beside it
  room.root.add(runner.root);
  // between the bowl and the pot, tall enough that the whole upper body shows above the table
  runner.root.position.set(-0.55, 0, -1.05);
  runner.root.rotation.y = Math.PI;
  runner.root.scale.setScalar(1.35);
  runner.pose = 'idle';
  room.root.add(bask);
  bask.position.set(-1.9, 0, 0.75);
  bask.rotation.y = 0.4;
  room.root.add(ring);
  ringOnTable = true;
  holder.add(room.root);
  const offRoom = clock.onUpdate((_dt, t) => room.update(t));
  await clock.tween(800, (k) => room.root.scale.setScalar(KITCHEN * Math.max(0.001, k)), easeOut);

  await ask({ kind: 'rub', strokes: 4 }, 'Wasch die Kirschen: reib hin und her!', kitchen.bowl, 0.42);
  sfx.splash();
  kitchen.washed();
  praise('Sauber!');
  await ask({ kind: 'circle', turns: 1.5 }, 'Rühr im Topf: mal einen Kreis!', kitchen.pot, 0.42);
  sfx.plop();
  kitchen.cooked();
  praise('Fein!');
  for (let i = 0; i < JARS; i++) {
    await ask({ kind: 'swipe', dir: 'down' }, i === 0 ? 'Füll die Gläser: wisch nach unten!' : `Noch ${JARS - i} Glas!`, kitchen.jars[i], 0.17);
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
  offRoom();
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


/** The Chriesi-Chuchi inside, in metres, centred on the table: floor, half-timbered back wall,
 *  window, shelf with jars, stove, and two neighbours who cheer. Open to the front and above. */
function buildKitchen() {
  const root = new Group();
  root.name = 'kitchen';
  root.scale.setScalar(0.001);
  for (let i = 0; i < 6; i++) {
    const plank = mesh(new BoxGeometry(6.2, 0.12, 0.74), i % 2 ? 0xc8935a : 0xb9844d);
    plank.position.set(0, -0.06, -1.85 + i * 0.74);
    root.add(plank);
  }
  const rug = mesh(new CylinderGeometry(2.1, 2.1, 0.03, 24), PALETTE.cherry);
  rug.position.y = 0.015;
  const rugIn = mesh(new CylinderGeometry(1.75, 1.75, 0.035, 24), PALETTE.cream);
  rugIn.position.y = 0.02;
  root.add(rug, rugIn);
  // the back wall, half-timbered like the old town houses
  const wall = mesh(new BoxGeometry(6.2, 3, 0.2), 0xf3e6cc);
  wall.position.set(0, 1.5, -2.3);
  root.add(wall);
  const beam = (w: number, h: number, x: number, y: number, rz = 0) => {
    const b = mesh(new BoxGeometry(w, h, 0.26), 0x6b4a2b);
    b.position.set(x, y, -2.2);
    b.rotation.z = rz;
    root.add(b);
  };
  beam(6.2, 0.18, 0, 0.09);
  beam(6.2, 0.18, 0, 2.95);
  beam(6.2, 0.16, 0, 1.25);
  for (const x of [-3.02, -0.35, 3.02]) beam(0.18, 3, x, 1.5);
  beam(0.14, 1.9, -1.7, 2.1, 0.65);
  // window with the lake and a mountain behind it, red curtains
  const frame = mesh(new BoxGeometry(1.5, 1.2, 0.1), 0x6b4a2b);
  frame.position.set(1.35, 2.05, -2.16);
  const sky = mesh(new BoxGeometry(1.3, 1.0, 0.1), 0x9cd3f0);
  sky.position.set(1.35, 2.05, -2.12);
  const lake = mesh(new BoxGeometry(1.3, 0.3, 0.1), PALETTE.lake);
  lake.position.set(1.35, 1.7, -2.1);
  const peak = mesh(new ConeGeometry(0.38, 0.5, 4), 0xe8eef5);
  peak.position.set(1.2, 2.06, -2.1);
  const cross = mesh(new BoxGeometry(0.06, 1.0, 0.12), 0x6b4a2b);
  cross.position.set(1.35, 2.05, -2.06);
  root.add(frame, sky, lake, peak, cross);
  for (const x of [0.5, 2.2]) {
    const curtain = mesh(new BoxGeometry(0.32, 1.35, 0.08), PALETTE.cherry);
    curtain.position.set(x, 2.05, -2.02);
    root.add(curtain);
  }
  // a shelf with jam from last year
  const shelf = mesh(new BoxGeometry(1.9, 0.08, 0.36), 0x8a5a33);
  shelf.position.set(-1.7, 1.7, -2.02);
  root.add(shelf);
  for (let i = 0; i < 4; i++) {
    const jar = mesh(new CylinderGeometry(0.13, 0.13, 0.3, 8), PALETTE.cherry);
    jar.position.set(-2.35 + i * 0.43, 1.89, -2.0);
    const lid = mesh(new CylinderGeometry(0.15, 0.15, 0.06, 8), 0xf2b134);
    lid.position.set(-2.35 + i * 0.43, 2.07, -2.0);
    root.add(jar, lid);
  }
  // the stove with its pipe, on the right
  const stove = mesh(new BoxGeometry(1.1, 0.95, 0.9), 0x2b3a67);
  stove.position.set(2.45, 0.475, -1.55);
  const plate = mesh(new BoxGeometry(1.14, 0.06, 0.94), 0x3c3f4a);
  plate.position.set(2.45, 0.98, -1.55);
  const door = mesh(new BoxGeometry(0.5, 0.35, 0.04), PALETTE.copper);
  door.position.set(2.45, 0.45, -1.09);
  const pipe = mesh(new CylinderGeometry(0.1, 0.1, 2.0, 8), 0x3c3f4a);
  pipe.position.set(2.75, 2.0, -1.8);
  const kettle = mesh(new CylinderGeometry(0.2, 0.26, 0.3, 8), PALETTE.copper);
  kettle.position.set(2.25, 1.16, -1.55);
  root.add(stove, plate, door, pipe, kettle);
  // two neighbours cheer the child on
  const fans = [villager(5, { wheelchair: true }), villager(8, { child: true })];
  fans[0].root.position.set(-2.3, 0, -0.75);
  fans[1].root.position.set(2.3, 0, 0.35);
  for (const f of fans) {
    f.root.rotation.y = Math.atan2(-f.root.position.x, -f.root.position.z);
    root.add(f.root);
  }
  return {
    root,
    update(t: number) {
      for (const f of fans) f.arm.rotation.z = -2.3 + Math.sin(t * 5 + f.phase) * 0.45;
    },
  };
}
