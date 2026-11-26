import {
  BoxGeometry,
  CircleGeometry,
  Color,
  MeshLambertMaterial,
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
  DoubleSide,
  Euler,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  type Mesh,
} from 'three';
import { AssetLibrary } from '../core/assets';
import { StoryClock, easeOut } from '../core/clock';
import { modelUrls, Models } from '../scenes/shared/models';
import { PALETTE } from '../scenes/shared/palette';
import { basket, mesh } from '../scenes/shared/placeholders';
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
/** How far a lane change takes the child off the middle of the path (metres). */
const LANE = 1.25;
/** After this long without the gesture, the «Weiter» button appears. */
const HELP_AFTER_MS = 9000;
/** A move the child already knows: its hint shows only after this long without the gesture. */
const QUIET_HINT_MS = 4000;
/** Practice obstacles (metres along the path): a second garland and log, between the cheering children. */
const PRACTICE = { garland: 56, log: 85.6 };
const CHERRIES = 5;
/** Spoken lines of the harvest (script paper, «Harvest game»): files in public/assets/audio/narration. */
const VOICE_LINES = ['SC3_C01', 'SC3_O01', 'R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'SC3_C02'] as const;
type VoiceId = (typeof VOICE_LINES)[number];
const REACTIONS: VoiceId[] = ['R01', 'R02', 'R03', 'R04', 'R05', 'R06'];
/** Page units per metre in the kitchen: the 6 m room fills the spread. */
const KITCHEN = 0.16;
const JARS = 3;

type Step = (s: number) => Promise<void>;

/** Children beside the path, cheering when the walker comes by (one model each, taken in turn). */
const SUPPORTERS = ['supporterBoy1', 'supporterGirl1', 'supporterBoy2'] as const;
/** Size of the cheering children (the walker is RUNNER). */
const SUPPORTER = 1.35;
/** They cheer while the walker is this close (map metres), and stand waving otherwise. */
const CHEER_NEAR = 14;
/** At most this many children stand about on the squares (each one is a skinned model). */
const SQUARE_CROWD = 6;

/** Our GLB models used on the map (the rest of the library is for the story). */
const MAP_MODELS = ['clockTower', 'house_0', 'house_1', 'house_2', 'fountain', 'bridge', 'startArch', 'alps', 'zugerberg', 'marketStall', 'church', 'mill', 'zugHouseA', 'zugHouseB', 'zugHouseC', 'zugHouseD', 'zugHouseE', 'zytturm', 'zugChuchi', 'zugMill', 'zugStall'];

export async function runJourney(opts: GameOptions): Promise<void> {
  opts.music?.preload();
  const library = new AssetLibrary(opts.stage.tracker!.renderer);
  const story = modelUrls();
  await library.loadAll({
    ...Object.fromEntries(MAP_MODELS.map((k) => [k, story[k]])),
    raceRunner: gameModelUrls().raceRunner,
    raceRunnerGirl: gameModelUrls().raceRunnerGirl,
    ...Object.fromEntries(SUPPORTERS.map((k) => [k, gameModelUrls()[k]])),
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
  const haveSupporters = SUPPORTERS.every((k) => library.has(k));
  const world: JourneyWorld = buildJourneyWorld(models, 7, !haveSupporters);
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
  // warm bounce light from below: a green one turned the pastel house fronts grey-green
  const hemi = new HemisphereLight(0xeaf3ff, 0xe0cfa8, 1.8);
  const sun = new DirectionalLight(0xffffff, 2.2);
  sun.position.set(-0.4, 1, 0.6);
  holder.add(board, hemi, sun, sun.target);
  stage.content.add(holder);
  if (import.meta.env.DEV) (window as unknown as { __journey: unknown }).__journey = { world, stage, holder, clock, get runner() { return runnerRef; } };
  tracker.lockView?.(true);
  tracker.overview?.(true, MAP_HALF_W * 2 * SCALE);

  // ---- start card: the child picks who walks (boy or girl), then the walker is built
  const ui = new JourneyUI(opts.ui);
  const who = await ui.choose();
  const runnerKey = who === 'girl' ? 'raceRunnerGirl' : 'raceRunner';

  // ---- the walker: a low-poly child with the ladder of the Chriesisturm
  const runner = new Runner(
    models.get(runnerKey, () => runnerPlaceholder(PALETTE.cherry, 0)),
    library.animations(runnerKey),
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
  let lat = 0;
  let speed = 0;
  const tmp = new Vector3();
  const place = () => {
    const u = MathUtils.clamp(s / world.length, 0, 1);
    world.path.getPointAt(u, tmp);
    const t = world.path.getTangentAt(u);
    // `lat`: sideways off the middle of the path (a lane change), along the obstacles' own x
    runner.root.position.set(tmp.x + t.z * lat, y + world.heightAt(s), tmp.z - t.x * lat);
    runner.root.rotation.y = Math.atan2(-t.x, -t.z);
    shadow.position.set(tmp.x + t.z * lat, 0.13 + world.heightAt(s), tmp.z - t.x * lat);
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
  // ---- our modelled children everywhere in town: cheering beside the path, standing about on the
  // squares (the primitive villagers stay only without the models). The square crowd also has the
  // racer the player did not pick.
  const otherRacer = runnerKey === 'raceRunner' ? 'raceRunnerGirl' : 'raceRunner';
  const CROWD = [...SUPPORTERS, otherRacer];
  const child = (key: string, i: number) => {
    const kid = new Runner(models.get(key, () => runnerPlaceholder(PALETTE.leaf, i)), []);
    kid.ladder.removeFromParent();
    kid.carrying = false;
    kid.t = i * 0.37; // not all in step
    kid.root.scale.setScalar(SUPPORTER);
    return kid;
  };
  const stand = (kid: Runner, spot: { x: number; z: number; ry: number }) => {
    kid.root.position.set(spot.x, 0, spot.z);
    // spots turn +z to the path (the villagers' front); our children look down −z, as the runner does
    kid.root.rotation.y = spot.ry + Math.PI;
    world.root.add(kid.root);
    return kid;
  };
  const supporters = haveSupporters
    ? [
        ...world.roadside.map((spot, i) => stand(child(SUPPORTERS[i % SUPPORTERS.length], i), spot)),
        ...world.square.slice(0, SQUARE_CROWD).map((spot, i) => stand(child(CROWD[(i + 1) % CROWD.length], i + 20), spot)),
      ]
    : [];
  let frame = 0;
  const tick = clock.onUpdate((dt, t) => {
    runner.update(dt, speed);
    // the children far from the walker are small on screen: their pose is worked out every 4th
    // frame only (28 skinned children every frame cost a phone too much)
    frame++;
    supporters.forEach((kid, i) => {
      const d = Math.hypot(kid.root.position.x - runner.root.position.x, kid.root.position.z - runner.root.position.z);
      kid.pose = d < CHEER_NEAR ? 'cheer' : 'idle';
      if (d < CHEER_NEAR * 1.5) kid.update(dt, 0);
      else if ((frame + i) % 4 === 0) kid.update(dt * 4, 0);
    });
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
  const gestures = new GestureInput(tracker.inputElement, () => stage.tracker?.camera ?? null);
  /** What the scene does while the child is in the middle of a gesture (set per station). */
  let react: { drag?: (dx: number, dy: number) => void; progress?: (p: number) => void } = {};
  gestures.onProgress = (p) => {
    ui.progress(p);
    react.progress?.(p);
  };
  gestures.onDrag = (dx, dy) => react.drag?.(dx, dy);
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
  /** On the race path (not in the kitchen), and the moves the child has already done there. */
  let racing = true;
  const learned = new Set<string>();
  const ask = async (want: Want, text: string, ringAt?: Object3D, size = 1, onHelp?: () => void): Promise<SwipeDir | Want['kind']> => {
    const kind: HintKind = want.kind === 'swipe' ? want.dir : want.kind;
    // on the race, a move the child has done once (jump, duck, change sides) is not explained
    // again: the obstacle itself says what to do. Only a child who waits a while gets the hint.
    const move = racing && want.kind === 'swipe' ? (want.dir === 'up' || want.dir === 'down' ? want.dir : 'side') : null;
    const quiet = move !== null && learned.has(move);
    let settled = false;
    const showHint = () => {
      if (settled) return;
      ui.hint(kind, text);
      if (ringAt) {
        ringAt.getWorldPosition(tmp);
        ring.parent!.worldToLocal(tmp);
        ring.position.set(tmp.x, ringOnTable ? tmp.y + 0.12 : 0.15, tmp.z);
        ringSize = size;
        ring.visible = true;
      }
    };
    if (quiet) void clock.wait(QUIET_HINT_MS).then(showHint);
    else showHint();
    const exp = gestures.expect(want);
    void clock.wait(HELP_AFTER_MS + (quiet ? QUIET_HINT_MS : 0)).then(() => {
      if (settled) return;
      ui.showHelp(() => exp.complete());
      onHelp?.(); // the help line is said again when the child seems stuck
    });
    if (opts.autoplay) void clock.wait(700).then(() => !settled && exp.complete());
    const result = await exp.done;
    settled = true;
    if (move) learned.add(move);
    ring.visible = false;
    ui.hideHelp();
    ui.hideHint();
    return result;
  };
  // ---- spoken lines (IDs from the script paper). One voice at a time: a new line cuts the old one.
  const VOICE_URL = `${import.meta.env.BASE_URL}assets/audio/narration/`;
  /** The team's recording wins when it is there (.wav or .mp3); the generated .m4a is the fallback. */
  const voiceBuffer = async (id: VoiceId) => {
    const a = opts.audio;
    if (!a) return null;
    for (const ext of ['wav', 'mp3', 'm4a']) {
      const b = await a.load(`${VOICE_URL}${id}.${ext}`);
      if (b) return b;
    }
    return null;
  };
  let speaking: AudioBufferSourceNode | null = null;
  const say = async (id: VoiceId) => {
    const b = await voiceBuffer(id);
    if (!b || !opts.audio) return;
    try {
      speaking?.stop();
    } catch {
      /* already ended */
    }
    speaking = opts.audio.play(b, 1);
  };
  void Promise.all(VOICE_LINES.map(voiceBuffer)); // warm the cache while the start card is up
  /** «every second or third tap» a random happy line (R01 … R06), never the same twice in a row. */
  let tapsToNext = 2;
  let lastReaction = '';
  const reactToTap = () => {
    if (--tapsToNext > 0) return;
    tapsToNext = 2 + Math.floor(Math.random() * 2);
    const pool = REACTIONS.filter((r) => r !== lastReaction);
    lastReaction = pool[Math.floor(Math.random() * pool.length)];
    void say(lastReaction as VoiceId);
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
  /** +1 or −1 along the object's own x so that it moves the way the finger went on screen,
   *  whichever side the camera (or the phone in AR) looks from. */
  const screenSide = (obj: Object3D, swipe: 'left' | 'right') => {
    const cam = stage.tracker?.camera;
    if (!cam) return swipe === 'right' ? 1 : -1;
    obj.updateMatrixWorld(true);
    const a = obj.getWorldPosition(new Vector3()).project(cam);
    const b = obj.localToWorld(new Vector3(1, 0, 0)).project(cam);
    const xGoesRight = b.x > a.x;
    return (swipe === 'right') === xGoesRight ? 1 : -1;
  };
  /** The swipe on screen that sends the child to `side` (±1 along the obstacle's x). */
  const sideToward = (obj: Object3D, side: number): 'left' | 'right' => (screenSide(obj, 'right') === side ? 'right' : 'left');
  /** A lane change past an obstacle: out to `side`, past it, back to the middle of the path. */
  const dodge = async (stop: number, side: number, ms = 1300) => {
    runner.pose = 'run';
    speed = WALK * 0.8;
    await clock.tween(ms, (k) => {
      s = stop + k * STOP_GAP * 2.6;
      lat = side * LANE * Math.min(1, Math.sin(k * Math.PI) * 1.8);
      place();
    });
    lat = 0;
    speed = 0;
    runner.pose = 'idle';
    place();
  };
  /** Stand an object at `at` metres along the path, `off` to the side, facing the race. */
  const alongPath = (obj: Object3D, atS: number, off: number) => {
    const u = MathUtils.clamp(atS / world.length, 0, 1);
    const p = world.path.getPointAt(u);
    const t = world.path.getTangentAt(u);
    obj.position.set(p.x + t.z * off, 0, p.z - t.x * off);
    obj.rotation.y = Math.atan2(t.x, t.z);
  };

  // 1 · a crate in the middle of the path: change lane, either side
  const crate = new Group();
  // narrow enough to run past on either side (it stands in the middle of a 2.6 m path)
  const box = mesh(new BoxGeometry(0.95, 1.1, 1.0), PALETTE.wood);
  box.position.y = 0.6;
  const band = mesh(new BoxGeometry(1.0, 0.16, 1.05), 0x7a5230);
  band.position.y = 0.6;
  crate.add(box, band);
  const crateS = at(world.stops.crate, crate);

  // 2 · a log: swipe up to jump
  const makeLog = () => {
    const log = new Group();
    const trunk = mesh(new CylinderGeometry(0.4, 0.4, 2.6, 7), 0x7a5230);
    trunk.rotation.z = Math.PI / 2;
    trunk.position.y = 0.4;
    log.add(trunk);
    return log;
  };
  const logS = at(world.stops.log, makeLog());

  // 3 · a low garland: swipe down to duck (`half`: how far out the poles stand)
  const makeGarland = (half = 1.6) => {
    const garland = new Group();
    for (const x of [-half, half]) {
      const pole = mesh(new CylinderGeometry(0.09, 0.09, 2.2, 5), PALETTE.cream);
      pole.position.set(x, 1.1, 0);
      garland.add(pole);
    }
    const n = Math.max(5, Math.round(((half - 0.25) * 2) / 0.45) + 1);
    for (let i = 0; i < n; i++) {
      const flag = mesh(new ConeGeometry(0.22, 0.4, 3), i % 2 ? PALETTE.cherry : PALETTE.cream);
      flag.rotation.x = Math.PI;
      flag.position.set(-(half - 0.25) + (i * (half - 0.25) * 2) / (n - 1), 1.75 - Math.sin((i / (n - 1)) * Math.PI) * 0.25, 0);
      garland.add(flag);
    }
    return garland;
  };
  const garlandS = at(world.stops.garland, makeGarland());

  // once taught, the moves come back further on without a word: the child knows what to do now
  // (between the cheering children, and narrow enough to stand inside the fence)
  const garland2S = at(PRACTICE.garland, makeGarland(1.45));
  const log2S = at(PRACTICE.log, makeLog());

  // 4 · a garden gate, half closed: change to the open side
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
  // half closed: the wing on the +x side stands open, the child runs through that half
  wings[1].rotation.y = -1.6;

  // 5 · the cherry tree beside the path: tap the crown to pick
  const treeS = world.stops.tree;
  const crown = new Object3D();
  crown.position.set(0, 0.09, 0);
  world.tree.add(crown);
  const treeCherries = world.tree.children.filter((c) => c.name === 'cherry');

  // 6 · a hand cart on one half of the path: change to the free half
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
  // parked on the −x half of the path: the child changes to the other side
  cart.position.add(new Vector3(-LANE, 0, 0).applyAxisAngle(new Vector3(0, 1, 0), cart.rotation.y));

  // 7 · a cat beside the path that wants a race: tap quickly to sprint past it
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
  // on the edge of the path, in front of the cheering children (they stand 2.2 m out), looking
  // the way the race goes
  const CAT_SIDE = -LANE;
  cat.position.add(new Vector3(CAT_SIDE, 0, 0).applyAxisAngle(new Vector3(0, 1, 0), cat.rotation.y));

  const jump: Step = async (stop) => {
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
  };
  const duck: Step = async (stop) => {
    await ask({ kind: 'swipe', dir: 'down' }, 'Wisch nach unten zum Ducken!');
    sfx.whoosh();
    runner.pose = 'slide';
    await clock.tween(1000, (k) => {
      s = stop + k * (STOP_GAP * 2);
      place();
    });
    runner.pose = 'idle';
    praise();
  };

  // ---- the stations, in order
  const steps: Array<[number, Step]> = [
    [
      crateS,
      async (stop) => {
        const dir = await ask({ kind: 'swipe', dir: 'side' }, 'Wisch zur Seite: lauf um die Kiste!', crate);
        sfx.whoosh();
        await dodge(stop, dir === 'left' || dir === 'right' ? screenSide(crate, dir) : 1);
        praise();
      },
    ],
    [logS, jump],
    [log2S, jump],
    [garlandS, duck],
    [garland2S, duck],
    [
      gateS,
      async (stop) => {
        const dir = sideToward(gate, 1);
        await ask({ kind: 'swipe', dir }, `Das Tor ist halb zu: wisch nach ${dir === 'left' ? 'links' : 'rechts'}!`, gate);
        sfx.whoosh();
        await dodge(stop, 1);
        praise();
      },
    ],
    [
      treeS + STOP_GAP,
      async () => {
        runner.root.rotation.y -= Math.PI / 2; // turn right, to the tree
        for (let i = 0; i < CHERRIES; i++) {
          if (i === 0) void say('SC3_O01'); // «Tippe auf die Chriesi.»
          await ask({ kind: 'tap', target: crown }, i === 0 ? 'Tippe auf die Chriesi!' : `Noch ${CHERRIES - i}!`, crown, 1, () => say('SC3_O01'));
          runner.pose = 'pick';
          if (i < CHERRIES - 1) reactToTap();
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
        praise('Die Hutte ist voll! Juhui!');
        void say('SC3_C02');
        place();
      },
    ],
    [
      cartS,
      async (stop) => {
        const dir = sideToward(cart, 1);
        await ask({ kind: 'swipe', dir }, `Der Wagen steht im Weg: wisch nach ${dir === 'left' ? 'links' : 'rechts'}!`, cart);
        sfx.whoosh();
        await dodge(stop, 1);
        praise();
      },
    ],
    [
      catS,
      async (stop) => {
        // a little race: every quick tap is a sprint; the cat runs along, a bit slower
        const SPRINTS = 4;
        let catS2 = stop + 1.5;
        for (let i = 0; i < SPRINTS; i++) {
          await ask({ kind: 'tap' }, i === 0 ? 'Die Katze will ein Wettrennen! Tippe schnell!' : `Schneller! Noch ${SPRINTS - i}!`);
          sfx.whoosh();
          runner.pose = 'run';
          speed = WALK * 1.6;
          const from = s;
          const catFrom = catS2;
          await clock.tween(380, (k) => {
            s = from + k * 2.2;
            catS2 = catFrom + k * 1.5;
            alongPath(cat, catS2, CAT_SIDE);
            place();
          });
        }
        speed = 0;
        runner.pose = 'cheer';
        praise('Gewonnen!');
        await clock.wait(700);
        runner.pose = 'idle';
      },
    ],
  ];

  // ---- start
  // Compile all shaders before the first step, so it does not stutter.
  try {
    await tracker.renderer.compileAsync(tracker.scene, tracker.camera);
  } catch {
    /* older drivers: compiled on first draw instead */
  }
  void opts.music?.start();
  // The race starts like the real Chriesisturm: with the bell.
  await ask({ kind: 'tap', target: world.tower }, 'Tippe auf den Zytturm: die Glocke läutet!', world.tower);
  sfx.bell();
  praise('Los!');
  void say('SC3_C01'); // «Chriesisturm! Hilf mir pflücken!»
  steps.sort((a, b) => a[0] - b[0]);
  for (const [obstacleS, step] of steps) {
    const stop = Math.max(s, obstacleS - STOP_GAP);
    await walkTo(stop);
    await step(stop);
  }
  await walkTo(world.length);

  // ---- the race is won: the walker cheers, confetti rains, «Bravo!» — then the kitchen
  racing = false;
  runner.pose = 'cheer';
  sfx.fanfare();
  const offConfetti = confetti(world.root, runner.root.position, clock);
  await clock.wait(600);
  await ui.raceWon();
  offConfetti();

  // ---- the Chriesi-Chuchi: the map makes way for a big kitchen that fills the page
  const kitchen = buildTable();
  const room = buildKitchen(haveSupporters ? [child('supporterGirl1', 40), child('supporterBoy2', 41)] : null);
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
  const offRoom = clock.onUpdate((dt, t) => {
    room.update(t, dt);
    kitchen.update(dt, t);
  });
  await clock.tween(800, (k) => room.root.scale.setScalar(KITCHEN * Math.max(0.001, k)), easeOut);

  // wash: the water sloshes with every stroke of the finger, drops fly at each turn
  let lastP = 0;
  react = {
    drag: (dx, dy) => kitchen.slosh(Math.abs(dx) >= Math.abs(dy) ? dx : dy),
    progress: (p) => {
      if (p > lastP) kitchen.splash(4);
      lastP = p;
    },
  };
  await ask({ kind: 'rub', strokes: 4 }, 'Wasch die Kirschen: reib hin und her!', kitchen.bowl, 0.42);
  react = {};
  sfx.splash();
  kitchen.splash(10);
  kitchen.washed();
  praise('Sauber!');
  // the clean cherries hop from the bowl into the pot, one after another
  await clock.tween(1300, (k) => kitchen.hopToPot(k), (k) => k);
  sfx.plop();
  // stir: the spoon goes round with the finger, the cherries melt into jam, steam rises
  kitchen.heat(true);
  react = { progress: (p) => kitchen.stir(p) };
  await ask({ kind: 'circle', turns: 1.5 }, 'Rühr im Topf: mal einen Kreis!', kitchen.pot, 0.42);
  react = {};
  // when help or the keyboard finished it, finish the turn on screen as well
  const from = kitchen.stirred;
  await clock.tween(600, (k) => kitchen.stir(from + (1 - from) * k));
  sfx.plop();
  kitchen.cooked();
  praise('Fein!');
  // fill: the ladle goes over the jar, jam pours in, the lid drops on
  for (let i = 0; i < JARS; i++) {
    await ask({ kind: 'swipe', dir: 'down' }, i === 0 ? 'Füll die Gläser: wisch nach unten!' : `Noch ${JARS - i} Glas!`, kitchen.jars[i], 0.17);
    sfx.plop();
    await clock.tween(1300, (k) => kitchen.pour(i, k), (k) => k);
    await clock.tween(350, (k) => kitchen.lid(i, k), easeOut);
  }
  kitchen.heat(false);

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

/** The kitchen table: bowl, pot and jars, in metres, with everything that moves when the child
 *  washes (water sloshes, drops fly), stirs (spoon goes round, cherries melt, steam) and fills
 *  (ladle over the jar, a stream of jam, the lid drops on). */
function buildTable() {
  const root = new Group();
  const TOP = 1.07;
  const top = mesh(new BoxGeometry(3.4, 0.14, 1.4), PALETTE.wood);
  top.position.y = TOP - 0.07;
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

  // ---- the wash bowl: water that tilts and ripples, five cherries bobbing in it
  const BOWL = new Vector3(-1.1, TOP, 0);
  const bowl = mesh(new CylinderGeometry(0.5, 0.36, 0.3, 14), PALETTE.zugBlue);
  bowl.position.set(BOWL.x, TOP + 0.15, BOWL.z);
  const rim = mesh(new TorusGeometry(0.5, 0.035, 5, 18), 0xffffff);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(BOWL.x, TOP + 0.3, BOWL.z);
  const water = new Group();
  water.position.set(BOWL.x, TOP + 0.31, BOWL.z);
  const waterDisc = mesh(new CylinderGeometry(0.46, 0.46, 0.03, 16), new MeshLambertMaterial({ color: 0x6fb2e0, transparent: true, opacity: 0.85 }));
  const ripple = mesh(new TorusGeometry(0.3, 0.018, 4, 20), 0xd6efff);
  ripple.rotation.x = Math.PI / 2;
  ripple.position.y = 0.02;
  water.add(waterDisc, ripple);
  root.add(bowl, rim, water);
  const washCherries: Object3D[] = [];
  const homes: Vector3[] = [];
  for (let i = 0; i < 5; i++) {
    const c = cherryMesh();
    const a = (i / 5) * Math.PI * 2;
    const home = new Vector3(BOWL.x + Math.cos(a) * 0.22, TOP + 0.38, BOWL.z + Math.sin(a) * 0.22);
    c.position.copy(home);
    homes.push(home);
    washCherries.push(c);
    root.add(c);
  }
  // splash drops
  const drops: Array<{ m: Mesh; v: Vector3; life: number }> = [];
  for (let i = 0; i < 14; i++) {
    const m = mesh(new SphereGeometry(0.045, 5, 4), 0x9cd3f0);
    m.visible = false;
    root.add(m);
    drops.push({ m, v: new Vector3(), life: 0 });
  }

  // ---- the pot: dark and empty, then cherries, then jam; the spoon goes round inside
  const POT = new Vector3(0, TOP, 0);
  const pot = mesh(new CylinderGeometry(0.48, 0.42, 0.52, 14), PALETTE.copper);
  pot.position.set(POT.x, TOP + 0.26, POT.z);
  const potRim = mesh(new TorusGeometry(0.48, 0.035, 5, 18), 0xb87333);
  potRim.rotation.x = Math.PI / 2;
  potRim.position.set(POT.x, TOP + 0.52, POT.z);
  for (const side of [-1, 1]) {
    const ear = mesh(new BoxGeometry(0.16, 0.06, 0.1), 0x3c3f4a);
    ear.position.set(POT.x + side * 0.55, TOP + 0.44, POT.z);
    root.add(ear);
  }
  const jamMat = new MeshLambertMaterial({ color: 0x3a2418 });
  const jam = mesh(new CylinderGeometry(0.44, 0.44, 0.03, 16), jamMat);
  jam.position.set(POT.x, TOP + 0.535, POT.z);
  root.add(pot, potRim, jam);
  const swirl = new Group();
  swirl.position.set(POT.x, TOP + 0.58, POT.z);
  const potCherries: Object3D[] = [];
  for (let i = 0; i < 5; i++) {
    const c = cherryMesh();
    const a = (i / 5) * Math.PI * 2 + 0.4;
    c.position.set(Math.cos(a) * 0.24, 0, Math.sin(a) * 0.24);
    c.visible = false;
    swirl.add(c);
    potCherries.push(c);
  }
  const spoonPivot = new Group();
  spoonPivot.position.copy(swirl.position);
  const spoon = new Group();
  const stick = mesh(new BoxGeometry(0.07, 1.0, 0.07), 0xc8935a);
  stick.position.y = 0.42;
  const scoop = mesh(new SphereGeometry(0.09, 6, 4), 0xc8935a);
  scoop.scale.y = 0.5;
  spoon.add(stick, scoop);
  spoon.position.set(0.24, -0.02, 0);
  spoon.rotation.z = 0.35;
  spoonPivot.add(spoon);
  root.add(swirl, spoonPivot);
  // steam puffs rise while the pot is hot
  const steamMat = new MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 });
  const puffs: Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const p = mesh(new SphereGeometry(0.12, 6, 5), steamMat);
    p.visible = false;
    root.add(p);
    puffs.push(p);
  }

  // ---- the jars, the ladle and the stream of jam
  const jars: Group[] = [];
  const fills: Mesh[] = [];
  const lids: Mesh[] = [];
  for (let i = 0; i < JARS; i++) {
    const jar = new Group();
    const glass = mesh(new CylinderGeometry(0.18, 0.18, 0.42, 10), new MeshLambertMaterial({ color: 0xdfeef5, transparent: true, opacity: 0.55 }));
    glass.position.y = 0.21;
    const fill = mesh(new CylinderGeometry(0.165, 0.165, 0.4, 10), PALETTE.cherry);
    fill.scale.y = 0.01;
    fill.position.y = 0.01;
    fill.visible = false;
    const lid = mesh(new CylinderGeometry(0.21, 0.21, 0.08, 10), 0xf2b134);
    lid.position.y = 0.46;
    lid.visible = false;
    jar.add(fill, glass, lid);
    jar.position.set(0.85 + i * 0.42, TOP, 0);
    root.add(jar);
    jars.push(jar);
    fills.push(fill);
    lids.push(lid);
  }
  const ladle = new Group();
  const cup = mesh(new SphereGeometry(0.14, 8, 5, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0x9aa0a6);
  const ladleJam = mesh(new CircleGeometry(0.13, 10), PALETTE.cherry);
  ladleJam.rotation.x = -Math.PI / 2;
  ladleJam.position.y = -0.02;
  const ladleHandle = mesh(new BoxGeometry(0.05, 0.05, 0.75), 0x9aa0a6);
  ladleHandle.position.set(0, 0.12, -0.4);
  ladleHandle.rotation.x = -0.35;
  ladle.add(cup, ladleJam, ladleHandle);
  ladle.visible = false;
  const streamGeo = new CylinderGeometry(0.035, 0.05, 1, 6);
  streamGeo.translate(0, -0.5, 0);
  const stream = mesh(streamGeo, PALETTE.cherry);
  stream.visible = false;
  root.add(ladle, stream);

  root.scale.setScalar(0.01);
  let slosh = 0;
  let sloshV = 0;
  let hot = false;
  let puffAt = 0;
  const api = {
    root,
    bowl,
    pot,
    jars,
    /** How far the stirring got (0 … 1). */
    stirred: 0,
    /** Finger moved `d` px: a push on the water. */
    slosh(d: number) {
      sloshV += MathUtils.clamp(d, -40, 40) * 0.012;
    },
    /** `n` drops jump out of the bowl. */
    splash(n: number) {
      let left = n;
      for (const d of drops) {
        if (left <= 0) break;
        if (d.life > 0) continue;
        const a = Math.random() * Math.PI * 2;
        d.m.position.set(BOWL.x + Math.cos(a) * 0.3, TOP + 0.36, BOWL.z + Math.sin(a) * 0.3);
        d.v.set(Math.cos(a) * (0.6 + Math.random() * 0.6), 1.6 + Math.random() * 1.2, Math.sin(a) * (0.6 + Math.random() * 0.6));
        d.life = 1;
        d.m.visible = true;
        left--;
      }
    },
    washed() {
      waterDisc.material = new MeshLambertMaterial({ color: 0xa9dcf7, transparent: true, opacity: 0.85 });
    },
    /** 0 → 1: the five cherries jump from the bowl into the pot, one after another. */
    hopToPot(k: number) {
      washCherries.forEach((c, i) => {
        const t = MathUtils.clamp(k * 1.8 - i * 0.2, 0, 1);
        const to = swirl.localToWorld(potCherries[i].position.clone());
        root.worldToLocal(to);
        c.position.lerpVectors(homes[i], to, t);
        c.position.y += Math.sin(t * Math.PI) * 0.7;
        c.visible = t < 1;
        potCherries[i].visible = t >= 1;
      });
      if (k >= 1) jamMat.color.setHex(0x8a2433);
    },
    heat(on: boolean) {
      hot = on;
    },
    /** 0 → 1: the spoon turns one and a half times, cherries melt into bright jam. */
    stir(p: number) {
      api.stirred = Math.max(api.stirred, p);
      const q = api.stirred;
      spoonPivot.rotation.y = -q * Math.PI * 3;
      swirl.rotation.y = spoonPivot.rotation.y * 0.6;
      potCherries.forEach((c, i) => c.scale.setScalar(Math.max(0.01, 1 - MathUtils.clamp(q * 1.4 - i * 0.08, 0, 1))));
      jamMat.color.setHex(0x8a2433).lerp(tmpColor.setHex(PALETTE.cherry), q);
    },
    cooked() {
      api.stir(1);
      potCherries.forEach((c) => (c.visible = false));
    },
    /** 0 → 1 for jar `i`: the ladle dips, swings over the jar, jam pours in. */
    pour(i: number, k: number) {
      const jar = jars[i].position;
      const over = new Vector3(jar.x, TOP + 1.0, jar.z);
      const dip = new Vector3(POT.x, TOP + 0.66, POT.z);
      ladle.visible = k < 1;
      ladle.rotation.z = 0;
      if (k < 0.25) {
        ladle.position.lerpVectors(new Vector3(POT.x, TOP + 1.0, POT.z), dip, k / 0.25);
      } else if (k < 0.5) {
        const t = (k - 0.25) / 0.25;
        ladle.position.lerpVectors(dip, over, t);
        ladle.position.y += Math.sin(t * Math.PI) * 0.25;
      } else {
        ladle.position.copy(over);
        ladle.rotation.z = -Math.min(1, (k - 0.5) / 0.15) * 1.1; // tip it
      }
      ladleJam.visible = k < 0.85;
      const pouring = k > 0.6 && k < 0.95;
      stream.visible = pouring;
      const f = MathUtils.clamp((k - 0.6) / 0.35, 0, 1);
      if (pouring) {
        const surface = TOP + 0.02 + 0.4 * f;
        stream.position.set(jar.x + 0.08, TOP + 0.95, jar.z);
        stream.scale.y = Math.max(0.05, TOP + 0.95 - surface);
      }
      fills[i].visible = f > 0.02;
      fills[i].scale.y = Math.max(0.01, f);
      fills[i].position.y = 0.2 * f + 0.01;
    },
    /** 0 → 1: the lid falls onto jar `i` with a little bounce. */
    lid(i: number, k: number) {
      const l = lids[i];
      l.visible = true;
      l.position.y = 0.46 + (1 - k) * 0.5 + Math.sin(k * Math.PI) * 0.05;
      if (k >= 1) l.position.y = 0.46;
    },
    update(dt: number, t: number) {
      // the water: a damped spring that tilts the surface and rocks the cherries
      sloshV += -slosh * 30 * dt;
      sloshV *= Math.exp(-dt * 3);
      slosh = MathUtils.clamp(slosh + sloshV * dt, -1, 1);
      water.rotation.z = slosh * 0.22;
      water.rotation.x = Math.sin(t * 2.3) * 0.03 + slosh * 0.08;
      ripple.scale.setScalar(0.6 + ((t * 0.8) % 1) * 0.9);
      washCherries.forEach((c, i) => {
        if (c.position.distanceTo(homes[i]) > 0.25) return; // hopping to the pot
        c.position.x = homes[i].x + slosh * 0.12;
        c.position.y = homes[i].y + Math.sin(t * 5 + i * 1.3) * 0.02 + Math.abs(slosh) * 0.05;
        c.rotation.z = slosh * 1.2 + i;
      });
      for (const d of drops) {
        if (d.life <= 0) continue;
        d.v.y -= 9 * dt;
        d.m.position.addScaledVector(d.v, dt);
        d.life -= dt * 1.4;
        if (d.m.position.y < TOP || d.life <= 0) {
          d.life = 0;
          d.m.visible = false;
        }
      }
      // steam
      puffAt -= dt;
      if (hot && puffAt <= 0) {
        const p = puffs.find((m) => !m.visible);
        if (p) {
          p.visible = true;
          p.position.set(POT.x + (Math.random() - 0.5) * 0.4, TOP + 0.6, POT.z + (Math.random() - 0.5) * 0.3);
          p.scale.setScalar(0.6);
        }
        puffAt = 0.35;
      }
      for (const p of puffs) {
        if (!p.visible) continue;
        p.position.y += dt * 0.6;
        p.position.x += Math.sin(t * 2 + p.id) * dt * 0.1;
        p.scale.multiplyScalar(1 + dt * 0.8);
        if (p.position.y > TOP + 1.7) p.visible = false;
      }
    },
  };
  return api;
}
const tmpColor = new Color();

/** A cherry in metres for the kitchen: big enough to see from the page. */
function cherryMesh(): Group {
  const g = new Group();
  const fruit = mesh(new SphereGeometry(0.1, 8, 6), PALETTE.cherry);
  const stem = mesh(new CylinderGeometry(0.01, 0.01, 0.14, 4), PALETTE.leafDark);
  stem.position.set(0.02, 0.13, 0);
  stem.rotation.z = 0.3;
  g.add(fruit, stem);
  return g;
}

/** The Chriesi-Chuchi inside, in metres, centred on the table: floor, half-timbered back wall,
 *  window, shelf with jars, stove, and two neighbours who cheer. Open to the front and above. */
function buildKitchen(kids: Runner[] | null) {
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
  // two neighbours cheer the child on: our modelled children, or primitive villagers without them
  const fans = kids ?? [villager(5, { wheelchair: true }), villager(8, { child: true })];
  const spots: Array<[number, number]> = [[-2.3, -0.75], [2.3, 0.35]];
  fans.forEach((f, i) => {
    f.root.position.set(spots[i][0], 0, spots[i][1]);
    f.root.rotation.y = Math.atan2(-spots[i][0], -spots[i][1]);
    if (kids) f.root.scale.setScalar(1.2);
    root.add(f.root);
  });
  return {
    root,
    update(t: number, dt = 1 / 60) {
      for (const f of fans) {
        if (f instanceof Runner) {
          f.pose = 'cheer';
          f.update(dt, 0);
        } else f.arm.rotation.z = -2.3 + Math.sin(t * 5 + f.phase) * 0.45;
      }
    },
  };
}

/**
 * Confetti over the finish: little paper squares in the town's colours fall around `at`, turning
 * and drifting, for a few seconds. Returns a function that removes it.
 */
function confetti(parent: Object3D, at: Vector3, clock: { onUpdate(fn: (dt: number) => void): () => void }): () => void {
  const COLORS = [PALETTE.cherry, 0xffffff, PALETTE.zugBlue, 0xf2b134];
  const N = 140;
  // big enough to read from the overview camera, which sees the whole board
  const geo = new PlaneGeometry(0.42, 0.26);
  const meshes = new InstancedMesh(geo, new MeshBasicMaterial({ side: DoubleSide }), N);
  const bits = Array.from({ length: N }, (_, i) => ({
    p: new Vector3(at.x + (Math.random() - 0.5) * 9, 3 + Math.random() * 7, at.z + (Math.random() - 0.5) * 9),
    v: new Vector3((Math.random() - 0.5) * 0.6, -1 - Math.random() * 0.8, (Math.random() - 0.5) * 0.6),
    r: new Euler(Math.random() * 6, Math.random() * 6, 0),
    spin: 3 + Math.random() * 5,
    c: COLORS[i % COLORS.length],
  }));
  const m = new Matrix4();
  const q = new Quaternion();
  const one = new Vector3(1, 1, 1);
  bits.forEach((b, i) => meshes.setColorAt(i, new Color(b.c)));
  parent.add(meshes);
  const off = clock.onUpdate((dt) => {
    bits.forEach((b, i) => {
      b.p.addScaledVector(b.v, dt);
      if (b.p.y < 0.05) b.p.y = 6 + Math.random() * 4; // keep it raining until the card is tapped
      b.r.x += b.spin * dt;
      b.r.y += b.spin * 0.6 * dt;
      meshes.setMatrixAt(i, m.compose(b.p, q.setFromEuler(b.r), one));
    });
    meshes.instanceMatrix.needsUpdate = true;
  });
  return () => {
    off();
    meshes.removeFromParent();
    geo.dispose();
    (meshes.material as MeshBasicMaterial).dispose();
  };
}
