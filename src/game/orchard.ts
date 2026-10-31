import { AdditiveBlending, Group, Mesh, MeshBasicMaterial, RingGeometry, Vector3 } from 'three';
import { easeOut, linear } from '../core/clock';
import { basket, cherry } from '../scenes/shared/placeholders';
import type { GameEnv } from './env';
import type { Dir } from './input';
import type { Racer } from './racer';
import { ArrowSign } from './sign';
import type { Tree } from './world';

/** Where the cherry is, as the child says it. */
const PICK_WORD: Record<Dir, string> = { up: 'Oben!', down: 'Unten!', left: 'Links!', right: 'Rechts!' };
const SIGN_SIDE: Record<Dir, Vector3> = {
  up: new Vector3(0, 0.75, 0),
  down: new Vector3(0.35, -0.65, 0),
  left: new Vector3(-0.7, 0.1, 0),
  right: new Vector3(0.7, 0.1, 0),
};

/*
 * The orchard stop: run to the tree, set the ladder (timing gauge), climb, pick cherries
 * with the arrows, climb down and run on. Rivals do the same, scripted and without input.
 */
export const CHERRIES_TO_PICK = 15;
/**
 * Page units per metre at the tree: the tree is ≈ 28 cm tall on the page, so tree, ladder and
 * basket stay in view from a 45° angle without backing far away from the magazine.
 */
export const ORCHARD_SCALE = 0.04;
/** Cherries on the ladder are drawn larger than life so they read on the page. */
const CHERRY_SIZE = 28;
const LEAN = 0.36;
/** Feet position along the ladder while picking. */
const CLIMB_TO = 1.35;
const GAUGE_ZONE: [number, number] = [0.35, 0.65];

/**
 * Where the ladder stands and leans for a tree. The ladder is set on the reader's side of the
 * trunk and leans away from the reader (−z): seen from the phone it faces the camera, the child
 * climbs with its back to us, and left / right / up / down on the screen are the arrows.
 */
function spot(tree: Tree) {
  const base = tree.at.clone().add(new Vector3(0, 0, 2.3));
  return {
    base,
    stand: base.clone().add(new Vector3(0, 0, 0.75)),
    facing: 0,
    /** Unit vector up the leaning ladder. */
    up: new Vector3(0, Math.cos(LEAN), -Math.sin(LEAN)),
    toTree: new Vector3(0, 0, -1),
    left: new Vector3(-1, 0, 0),
  };
}

/** A ladder pivot at the base; rotation.x leans it (negative = towards the tree). */
function ladderPivot(env: GameEnv, racer: Racer, tree: Tree): Group {
  const pivot = new Group();
  pivot.position.copy(spot(tree).base);
  const l = racer.runner.ladder;
  l.rotation.set(0, 0, 0);
  l.position.set(0, 0, 0);
  pivot.add(l);
  racer.runner.carrying = false;
  env.root.add(pivot);
  return pivot;
}

/** Scripted jog (orchard, kitchen door). Faces the direction of travel. */
export async function jogTo(env: GameEnv, racer: Racer, to: Vector3, speed = 6): Promise<void> {
  const root = racer.runner.root;
  const from = root.position.clone();
  const dist = from.distanceTo(to);
  racer.scripted = true;
  racer.scriptSpeed = speed;
  racer.runner.pose = 'run';
  root.rotation.y = Math.atan2(-(to.x - from.x), -(to.z - from.z));
  await env.clock.tween((dist / speed) * 1000, (k) => root.position.lerpVectors(from, to, k), linear);
  racer.scriptSpeed = 0;
  racer.runner.pose = 'idle';
}

async function climb(env: GameEnv, racer: Racer, tree: Tree, upwards: boolean): Promise<void> {
  const sp = spot(tree);
  const root = racer.runner.root;
  const bottom = sp.stand.clone();
  // On the ladder: a little in front of the rungs, towards the street.
  const top = sp.base.clone().addScaledVector(sp.up, CLIMB_TO).addScaledVector(sp.toTree, -0.4);
  racer.runner.pose = 'climb';
  root.rotation.y = sp.facing;
  await env.clock.tween(1300, (k) => root.position.lerpVectors(upwards ? bottom : top, upwards ? top : bottom, k));
  racer.runner.pose = upwards ? 'pick' : 'idle';
}

function swingNeedle(t: number): number {
  const p = (t / 2.6) % 1;
  return p < 0.5 ? p * 2 : 2 - p * 2;
}

/** The player's orchard stop. Resolves back on the track, ladder on the shoulder. */
export async function playerOrchard(env: GameEnv, racer: Racer, tree: Tree, returnTo: Vector3): Promise<void> {
  const { clock, pad, hud, sfx, view } = env;
  const sp = spot(tree);
  racer.running = false;
  hud.setStage('Chriesi pflücken');
  const root = racer.runner.root;
  // Zoom the page in on the tree: ladder, crown and basket fill the spread.
  view.frame(sp.stand.clone().lerp(tree.at, 0.5), ORCHARD_SCALE, 2);
  await jogTo(env, racer, sp.stand);
  root.rotation.y = sp.facing;

  // ---- 1 · set the ladder: press ↑ while the needle is in the green band
  const pivot = ladderPivot(env, racer, tree);
  racer.runner.pose = 'pick';
  racer.runner.reach = 'up';
  hud.showPrompt('up', 'Leiter aufstellen!');
  pad.only(['up']);
  pad.hint('up');
  let placed = false;
  while (!placed) {
    const t0 = clock.time;
    const off = clock.onUpdate((_dt, t) => {
      const v = swingNeedle(t - t0);
      hud.setGauge(v, GAUGE_ZONE);
      pivot.rotation.x = -(LEAN + (v - 0.5) * 1.5);
    });
    await pad.next(['up']);
    off();
    const v = swingNeedle(clock.time - t0);
    if (v >= GAUGE_ZONE[0] && v <= GAUGE_ZONE[1]) {
      placed = true;
      sfx.plop();
      hud.toast('Perfekt!');
      const from = pivot.rotation.x;
      await clock.tween(250, (k) => (pivot.rotation.x = from + (-LEAN - from) * k));
    } else {
      sfx.bump();
      hud.toast('Hoppla!', 'bad');
      const from = pivot.rotation.x;
      const fall = Math.sign(from || -1) * 1.3;
      await clock.tween(450, (k) => (pivot.rotation.x = from + (fall - from) * k), easeOut);
      await clock.wait(450);
      await clock.tween(400, (k) => (pivot.rotation.x = fall + (-LEAN - fall) * k));
    }
  }
  hud.setGauge(null);
  hud.showPrompt(null);
  pad.hint(null);
  racer.runner.reach = null;

  // ---- 2 · climb up, hang the basket on the ladder
  const bask = basket();
  bask.scale.setScalar(11);
  bask.position.copy(sp.base).addScaledVector(sp.up, 1.1).addScaledVector(sp.toTree, -0.35);
  env.root.add(bask);
  const contents = bask.getObjectByName('contents')!;
  await climb(env, racer, tree, true);

  // ---- 3 · pick: a cherry appears up / down / left / right, press that arrow
  pad.only(['up', 'down', 'left', 'right']);
  hud.setCounter(`0 / ${CHERRIES_TO_PICK}`);
  hud.showPrompt(null, 'Pflück die Chriesi!');
  const ring = new Mesh(
    new RingGeometry(0.3, 0.42, 20),
    new MeshBasicMaterial({ color: 0xffe07a, transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false }),
  );
  env.root.add(ring);
  const chest = () => root.position.clone().add(new Vector3(0, 1.35, 0));
  const offset: Record<Dir, Vector3> = {
    up: new Vector3(0, 1.05, 0).addScaledVector(sp.toTree, 0.5),
    // Beside the legs, so the child's body does not hide it from the phone behind.
    down: new Vector3(0.45, -0.95, 0).addScaledVector(sp.toTree, 0.3),
    left: sp.left.clone().multiplyScalar(1.05).addScaledVector(sp.toTree, 0.55).add(new Vector3(0, 0.15, 0)),
    right: sp.left.clone().multiplyScalar(-1.05).addScaledVector(sp.toTree, 0.55).add(new Vector3(0, 0.15, 0)),
  };
  const dirs: Dir[] = ['up', 'down', 'left', 'right'];
  let last: Dir | null = null;
  // The arrow to press floats next to every cherry, and the same button lights up below.
  const sign = new ArrowSign(0.75, PICK_WORD);
  env.root.add(sign.sprite);
  let signDir: Dir | null = null;
  const signAt = new Vector3();
  const offRing = clock.onUpdate((_dt, t) => {
    ring.lookAt(view.cameraPosition());
    ring.scale.setScalar(1 + Math.sin(t * 9) * 0.12);
    sign.show(signDir, signAt.x, signAt.y + Math.sin(t * 6) * 0.05, signAt.z, Math.sin(t * 8));
  });
  for (let n = 0; n < CHERRIES_TO_PICK; n++) {
    let dir = dirs[Math.floor(Math.random() * 4)];
    if (dir === last) dir = dirs[(dirs.indexOf(dir) + 1 + Math.floor(Math.random() * 3)) % 4];
    last = dir;
    const c = cherry();
    c.scale.setScalar(0.001);
    c.position.copy(chest()).add(offset[dir]);
    env.root.add(c);
    ring.position.copy(c.position);
    ring.visible = true;
    void clock.tween(160, (k) => c.scale.setScalar(Math.max(0.001, CHERRY_SIZE * easeOut(k))));
    pad.hint(dir);
    hud.showPrompt(dir, PICK_WORD[dir]);
    signDir = dir;
    // Next to the cherry on its outer side, so it never covers the fruit or the child.
    signAt.copy(c.position).add(SIGN_SIDE[dir]);
    for (;;) {
      const pressed = await pad.next();
      if (pressed === dir) break;
      pad.shake(pressed);
      sfx.miss();
      hud.toast('Daneben!', 'bad', 500);
    }
    ring.visible = false;
    signDir = null;
    racer.runner.reach = dir;
    sfx.pop(n % 12);
    hud.setCounter(`${n + 1} / ${CHERRIES_TO_PICK}`);
    const from = c.position.clone();
    const into = new Vector3((Math.random() - 0.5) * 0.02, 0.01 + n * 0.0012, (Math.random() - 0.5) * 0.02);
    void clock
      .tween(320, (k) => {
        c.position.lerpVectors(from, env.root.worldToLocal(bask.localToWorld(into.clone())), k);
        c.position.y += Math.sin(k * Math.PI) * 0.4;
      })
      .then(() => {
        contents.add(c);
        c.position.copy(into);
        c.scale.setScalar(1);
        sfx.plop();
      });
    await clock.wait(110);
    racer.runner.reach = null;
  }
  offRing();
  sign.dispose();
  ring.removeFromParent();
  ring.geometry.dispose();
  (ring.material as MeshBasicMaterial).dispose();
  pad.hint(null);
  hud.showPrompt(null);
  sfx.fanfare();
  hud.toast('Korb voll!', 'good', 1400);

  // ---- 4 · down, ladder back on the shoulder, basket in the other hand, back to the race
  await climb(env, racer, tree, false);
  racer.runner.shoulderLadder();
  pivot.removeFromParent();
  bask.position.set(-0.42, 0.75, 0);
  bask.scale.setScalar(6.5);
  racer.runner.root.add(bask);
  hud.setCounter(null);
  await jogTo(env, racer, returnTo, 7);
}

/** Rival at its tree: scripted, no input. Takes about `pickSeconds` on top of the jog. */
export async function rivalOrchard(env: GameEnv, racer: Racer, tree: Tree, pickSeconds: number, returnTo: Vector3): Promise<void> {
  const sp = spot(tree);
  racer.running = false;
  await jogTo(env, racer, sp.stand);
  racer.runner.root.rotation.y = sp.facing;
  const pivot = ladderPivot(env, racer, tree);
  pivot.rotation.x = -1.2;
  await env.clock.tween(700, (k) => (pivot.rotation.x = -(1.2 + (LEAN - 1.2) * k)));
  await climb(env, racer, tree, true);
  const reaches: Array<Dir | null> = ['up', 'left', null, 'right', 'down'];
  const t0 = env.clock.time;
  let i = 0;
  while (env.clock.time - t0 < pickSeconds) {
    racer.runner.reach = reaches[i++ % reaches.length];
    await env.clock.wait(650);
  }
  racer.runner.reach = null;
  await climb(env, racer, tree, false);
  racer.runner.shoulderLadder();
  pivot.removeFromParent();
  await jogTo(env, racer, returnTo, 7);
}
