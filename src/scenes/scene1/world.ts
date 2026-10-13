import {
  CatmullRomCurve3,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  Quaternion,
  Vector3,
  type Object3D,
} from 'three';
import { CONFIG } from '../../config';
import { easeOut, linear } from '../../core/clock';
import type { StoryContext } from '../../story/context';
import { PALETTE } from '../shared/palette';
import {
  alpsCard,
  basket,
  card,
  cherryTree,
  clockTower,
  fountain,
  house,
  ladder,
  patch,
  person,
  ribbon,
  ridgeCard,
  rng,
  startArch,
  stoneBridge,
  sun,
} from '../shared/placeholders';

/*
 * Layout on the double page (page space, metres-free units: spread width = 1).
 * Left page: old-town square with fountain, clock tower and start arch.
 * Centre:    stream from the lake with the long stone bridge.
 * Right page: cherry orchard with the hero tree and the basket.
 * Back edge: papercut backdrop — Alps, Zugerberg ridge, Lake Zug, sun.
 */
const HALF_DEPTH = 0.5 / CONFIG.spreadAspect; // ≈ 0.354

export const LAYOUT = {
  fountain: new Vector3(-0.28, 0, 0.02),
  tower: new Vector3(-0.1, 0, -0.07),
  arch: new Vector3(-0.17, 0, 0.125),
  bridge: new Vector3(0.035, 0, 0.115),
  heroTree: new Vector3(0.31, 0, 0.0),
  basket: new Vector3(0.225, 0, 0.15),
  ladderFoot: new Vector3(0.262, 0, 0.055),
};

const BRIDGE_H = 0.03;

export interface Runner {
  group: Group;
  ladder: Object3D;
}

export interface Scene1World {
  root: Group;
  tower: Object3D;
  bell: Object3D;
  path: CatmullRomCurve3;
  runners: Runner[];
  villagers: Group[];
  heroTree: Object3D;
  basket: Object3D;
  ringBell(): Promise<void>;
  runRace(): Promise<void>;
  cheer(): void;
  dispose(): void;
}

export function buildScene1World(ctx: StoryContext): Scene1World {
  const { models, stage, quality } = ctx;
  const clock = stage.clock;
  const lite = quality === 'lite';
  const root = new Group();
  root.name = 'scene1';
  const r = rng(42);

  // ---- light (inside the content so it moves with the page in AR)
  const hemi = new HemisphereLight(0xfff6e0, 0x9bbf7a, 1.6);
  const sunLight = new DirectionalLight(0xfff0d0, 1.8);
  sunLight.position.set(0.4, 1, 0.6);
  root.add(hemi, sunLight, sunLight.target);

  // ---- backdrop cards along the back edge
  const alps = models.get('alps', () => alpsCard());
  alps.position.set(0, 0, -HALF_DEPTH + 0.01);
  alps.scale.set(1, 1.1, 1);
  const ridge = models.get('zugerberg', ridgeCard);
  ridge.position.set(0, 0, -HALF_DEPTH + 0.05);
  const theSun = models.get('sun', sun);
  theSun.position.set(0.33, 0.25, -HALF_DEPTH + 0.005);
  root.add(alps, ridge, theSun);

  // Lake Zug: a flat cut-out with a wavy shore.
  const lakePts: Array<[number, number]> = [];
  for (let i = 0; i <= 20; i++) lakePts.push([-0.5 + i / 20, -0.17 + 0.012 * Math.sin(i * 1.3)]);
  lakePts.push([0.5, -0.29], [-0.5, -0.29]);
  const lake = card(lakePts, 0.002, PALETTE.lake, 'lake');
  lake.rotation.x = Math.PI / 2;
  lake.position.y = 0.002;
  root.add(lake);

  const clouds: Mesh[] = [];
  if (!lite) {
    for (let i = 0; i < 3; i++) {
      const pts: Array<[number, number]> = [];
      for (let k = 0; k <= 10; k++) {
        const a = Math.PI * (k / 10);
        pts.push([Math.cos(a) * 0.045, Math.sin(a) * (0.016 + 0.008 * Math.sin(k * 2.1))]);
      }
      const c = card(pts, 0.002, 0xffffff, 'cloud');
      c.position.set(-0.35 + i * 0.32, 0.21 + r() * 0.05, -HALF_DEPTH + 0.02);
      clouds.push(c);
      root.add(c);
    }
  }

  // ---- stream + bridge
  const stream = new CatmullRomCurve3([
    new Vector3(0.03, 0, -0.17),
    new Vector3(0.05, 0, -0.06),
    new Vector3(0.02, 0, 0.04),
    new Vector3(0.04, 0, 0.115),
    new Vector3(0.025, 0, 0.22),
    new Vector3(0.05, 0, HALF_DEPTH - 0.01),
  ]);
  root.add(ribbon(stream, 0.04, PALETTE.lake, 48, 0.001));
  const bridge = models.get('bridge', () => stoneBridge(0.17, BRIDGE_H));
  bridge.position.copy(LAYOUT.bridge);
  root.add(bridge);

  // ---- old-town square
  root.add(patch(0.16, 0.11, PALETTE.stone, 3).translateX(-0.29).translateY(0.01));
  const fnt = models.get('fountain', fountain);
  fnt.position.copy(LAYOUT.fountain);
  root.add(fnt);
  const houseSpots: Array<[number, number, number]> = [
    [-0.44, -0.1, 0.35],
    [-0.36, -0.13, 0],
    [-0.27, -0.14, 0],
    [-0.185, -0.13, -0.1],
    [-0.45, 0.07, 1.3],
  ];
  houseSpots.forEach(([x, z, ry], i) => {
    const h = models.get(`house_${i % 3}`, () => house(i));
    h.position.set(x, 0, z);
    h.rotation.y = ry;
    root.add(h);
  });
  const tower = models.get('clockTower', clockTower);
  tower.position.copy(LAYOUT.tower);
  root.add(tower);
  const bell = tower.getObjectByName('bell') ?? tower;

  const arch = models.get('startArch', startArch);
  arch.position.copy(LAYOUT.arch);
  root.add(arch);

  const villagers: Group[] = [];
  const shirts = [0xe07a5f, 0x81b29a, 0xf2cc8f, 0x9c89b8, PALETTE.zugBlue, 0xf28482];
  const count = lite ? 3 : 6;
  for (let i = 0; i < count; i++) {
    const v = models.get('villager', () => person(shirts[i % shirts.length], i)) as Group;
    const a = (i / count) * Math.PI * 2 + 0.4;
    v.position.set(LAYOUT.fountain.x + Math.cos(a) * 0.065, 0.003, LAYOUT.fountain.z + Math.sin(a) * 0.055);
    v.lookAt(LAYOUT.arch.x, 0.003, LAYOUT.arch.z);
    v.userData.phase = r() * Math.PI * 2;
    villagers.push(v);
    root.add(v);
  }

  // ---- race path: square → arch → over the bridge → orchard
  const path = new CatmullRomCurve3(
    [
      new Vector3(-0.25, 0, 0.13),
      new Vector3(-0.17, 0, 0.125),
      new Vector3(-0.1, 0, 0.118),
      new Vector3(-0.072, 0.002, 0.115),
      new Vector3(-0.05, BRIDGE_H, 0.115),
      new Vector3(0.035, BRIDGE_H, 0.115),
      new Vector3(0.12, BRIDGE_H, 0.115),
      new Vector3(0.142, 0.002, 0.116),
      new Vector3(0.17, 0, 0.12),
      new Vector3(0.21, 0, 0.105),
      new Vector3(0.245, 0, 0.07),
    ],
    false,
    'centripetal',
  );
  root.add(ribbon(path, 0.022, PALETTE.path, 64, 0.0025));

  // ---- orchard
  root.add(patch(0.17, 0.13, PALETTE.meadow, 9).translateX(0.31).translateY(0.01));
  const bgTrees: Array<[number, number, number]> = [
    [0.19, -0.075, 0.95],
    [0.43, -0.085, 1.05],
    [0.445, 0.14, 0.9],
  ];
  bgTrees.forEach(([x, z, s], i) => {
    const t = models.get('cherryTreeHarvested', () => cherryTree(s, i + 5));
    t.position.set(x, 0, z);
    root.add(t);
  });
  const heroTree = models.get('cherryTree', () => cherryTree(1.5, 1));
  heroTree.position.copy(LAYOUT.heroTree);
  root.add(heroTree);
  const bsk = models.get('basket', basket);
  bsk.position.copy(LAYOUT.basket);
  root.add(bsk);

  // ---- runners with ladders (Zug colours)
  const runners: Runner[] = [PALETTE.zugBlue, 0xffffff, PALETTE.cherry].map((shirt, i) => {
    const g = models.get('runner', () => person(shirt, i + 1)) as Group;
    const l = models.get('ladder', () => ladder());
    // Carried on the shoulder, lying along the running direction (local +x).
    l.rotation.z = -Math.PI / 2;
    l.position.set(-0.036, 0.028, 0.009);
    g.add(l);
    root.add(g);
    return { group: g, ladder: l };
  });
  const laneOffsets = [0, -0.011, 0.011];
  const startGaps = [0, 0.025, 0.05];
  const placeRunner = (runner: Runner, u: number, lane: number, bob = 0) => {
    const p = path.getPointAt(Math.min(Math.max(u, 0), 1));
    const t = path.getTangentAt(Math.min(Math.max(u, 0.001), 1));
    const side = new Vector3(-t.z, 0, t.x).normalize().multiplyScalar(lane);
    runner.group.position.set(p.x + side.x, p.y + 0.0025 + bob, p.z + side.z);
    runner.group.rotation.y = Math.atan2(-t.z, t.x);
  };
  const raceLength = path.getLength();
  /** u < 0 means "behind the start line", extended straight back along -x. */
  const poseAt = (i: number, u: number, bob = 0) => {
    placeRunner(runners[i], Math.max(u, 0), laneOffsets[i], bob);
    if (u < 0) runners[i].group.position.x += u * raceLength;
  };
  runners.forEach((_, i) => poseAt(i, -startGaps[i] / raceLength));

  // ---- ambient animation (story time)
  const offAmbient = clock.onUpdate((dt, t) => {
    villagers.forEach((v) => {
      const hop = v.userData.hop as number | undefined;
      const phase = v.userData.phase as number;
      const idle = Math.max(0, Math.sin(t * 2 + phase)) * 0.0015;
      v.position.y = 0.003 + idle + (hop ? Math.abs(Math.sin((t - hop) * 9)) * 0.012 * Math.max(0, 1 - (t - hop) / 2) : 0);
    });
    clouds.forEach((c, i) => {
      c.position.x += dt * 0.004 * (1 + i * 0.3);
      if (c.position.x > 0.5) c.position.x = -0.5;
    });
    theSun.rotation.z = t * 0.1;
  });

  async function ringBell(): Promise<void> {
    ctx.sfx.bell(0);
    ctx.sfx.bell(0.9);
    ctx.sfx.bell(1.8);
    await clock.tween(
      2600,
      (k) => {
        bell.rotation.z = Math.sin(k * Math.PI * 6) * 0.5 * (1 - k);
      },
      linear,
    );
  }

  function cheer(): void {
    villagers.forEach((v, i) => (v.userData.hop = clock.time + i * 0.08));
  }

  async function runRace(): Promise<void> {
    const durations = [6.6, 7.1, 7.6];
    const stopAt = [1, 0.93, 0.86];
    await Promise.all(
      runners.map((_, i) => {
        const startU = -startGaps[i] / raceLength;
        return clock.tween(
          durations[i] * 1000,
          (k) => {
            const bob = k < 1 ? Math.abs(Math.sin(k * durations[i] * 11)) * 0.004 : 0;
            poseAt(i, startU + (stopAt[i] - startU) * k, bob);
          },
          linear,
        );
      }),
    );
    // The winner leans the ladder against the hero tree.
    const lead = runners[0];
    root.attach(lead.ladder);
    const fromPos = lead.ladder.position.clone();
    const fromQ = lead.ladder.quaternion.clone();
    const top = new Vector3(LAYOUT.heroTree.x - 0.02, 0.115, LAYOUT.heroTree.z + 0.02);
    const dir = top.clone().sub(LAYOUT.ladderFoot).normalize();
    const toQ = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir);
    await clock.tween(
      1100,
      (k) => {
        lead.ladder.position.lerpVectors(fromPos, LAYOUT.ladderFoot, k);
        lead.ladder.quaternion.slerpQuaternions(fromQ, toQ, k);
        lead.ladder.scale.setScalar(1 + 0.35 * k);
      },
      easeOut,
    );
  }

  stage.content.add(root);

  return {
    root,
    tower,
    bell,
    path,
    runners,
    villagers,
    heroTree,
    basket: bsk,
    ringBell,
    runRace,
    cheer,
    dispose() {
      offAmbient();
      stage.content.remove(root);
      root.traverse((o) => (o as Mesh).geometry?.dispose());
    },
  };
}
