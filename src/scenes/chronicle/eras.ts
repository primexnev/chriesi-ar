import {
  BoxGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import { easeOut, linear, type StoryClock } from '../../core/clock';
import { PALETTE } from '../shared/palette';
import { basket, card, cherryTree, clockTower, house, ladder, mat, mesh, patch, person, ribbon, rng, startArch } from '../shared/placeholders';
import { Era, PAGE_D, PAGE_W } from './popup';

/*
 * The pages of the chronicle, all in Canton Zug. Miniature scale like the harvest scene
 * (people ≈ 0.04 page units). Book space: x ∈ ±PAGE_W across the spread, z ∈ ±PAGE_D/2,
 * y = 0 on the page surface. Everything is procedural paper-cut placeholder art.
 */

const HALF_D = PAGE_D / 2;
const CLOTH = { linen: 0xf3ead7, ochre: 0xc9a35a, brown: 0x8a6b45, dark: 0x6b5235, red: 0xb5452f, blue: PALETTE.zugBlue, grey: 0x7d8a96 };

function box(w: number, h: number, d: number, color: number, y = h / 2): Mesh {
  const m = mesh(new BoxGeometry(w, h, d), color);
  m.position.y = y;
  return m;
}

/** Gable roof prism along the depth, ridge along z. */
function roof(w: number, h: number, d: number, color: number, y: number): Mesh {
  const r = card(
    [
      [-w / 2, 0],
      [w / 2, 0],
      [0, h],
    ],
    d,
    color,
    'roof',
  );
  r.position.set(0, y, -d / 2);
  return r;
}

/** A few cherries on a tree crown (decoration, not pickable). Returned group can be hidden. */
function decorate(tree: Object3D, count: number, seed: number, color: number = PALETTE.cherry, size = 0.0055): Group {
  const g = new Group();
  g.name = 'deco';
  const r = rng(seed);
  const s = tree.scale.x;
  const crown = tree.userData.crown as Array<{ x: number; y: number; z: number; r: number }>;
  const geo = new SphereGeometry(size / s, 6, 5);
  for (let i = 0; i < count; i++) {
    const c = crown[i % crown.length];
    const dir = new Vector3(r() * 2 - 1, r() * 1.2 - 0.5, 0.5 + r() * 0.7).normalize();
    const m = mesh(geo, color);
    m.position.set(c.x / s, c.y / s, c.z / s).addScaledVector(dir, (c.r / s) * 0.95);
    g.add(m);
  }
  tree.add(g);
  return g;
}

function hatted(shirt: number, hat: number): Group {
  // Seed 1: the placeholder person without its own red cap.
  const p = person(shirt, 1);
  const h = mesh(new CylinderGeometry(0.0075, 0.0085, 0.004, 8), hat);
  h.position.y = 0.0405;
  p.add(h);
  return p;
}

function bowlWithCherries(radius: number, color: number, cherries: number, seed: number): Group {
  const g = new Group();
  const profile = [new Vector2(0, 0), new Vector2(radius * 0.55, 0), new Vector2(radius, radius * 0.55), new Vector2(radius * 1.02, radius * 0.6)];
  g.add(mesh(new LatheGeometry(profile, 12), mat(color, { side: DoubleSide })));
  const r = rng(seed);
  const geo = new SphereGeometry(radius * 0.32, 6, 5);
  for (let i = 0; i < cherries; i++) {
    const a = r() * Math.PI * 2;
    const d = r() * radius * 0.45;
    const c = mesh(geo, PALETTE.cherry);
    c.position.set(Math.cos(a) * d, radius * (0.5 + r() * 0.2), Math.sin(a) * d);
    g.add(c);
  }
  return g;
}

/** Bobbing idle for standing figures (inside their hinge). */
function idleBob(era: Era, figures: Object3D[]): void {
  const phases = figures.map((_, i) => i * 1.7);
  era.tick((_dt, t) => figures.forEach((f, i) => (f.position.y = Math.max(0, Math.sin(t * 2.2 + phases[i])) * 0.0018)));
}

// ------------------------------------------------------------------ 1 · Zug-Sumpf, about 1000 BC

export function prehistoryEra(clock: StoryClock): Era {
  const era = new Era(clock, 'era-prehistory');
  era.lay(box(PAGE_W * 2 - 0.02, 0.002, 0.075, PALETTE.lake, 0.001), 0, -HALF_D + 0.045);
  era.lay(patch(0.1, 0.05, PALETTE.meadow, 4), 0.11, 0.05, 0.1);

  const hut = (seed: number) => {
    const g = new Group();
    const post = new CylinderGeometry(0.0014, 0.0014, 0.02, 4);
    for (const [x, z] of [
      [-0.018, -0.014],
      [0.018, -0.014],
      [-0.018, 0.014],
      [0.018, 0.014],
    ]) {
      const p = mesh(post, PALETTE.wood);
      p.position.set(x, 0.01, z);
      g.add(p);
    }
    g.add(box(0.046, 0.003, 0.036, 0x9a6a40, 0.0215));
    g.add(box(0.036, 0.022, 0.028, 0xc9a77a, 0.034));
    g.add(roof(0.046, 0.026 + (seed % 2) * 0.004, 0.034, CLOTH.ochre, 0.045));
    const door = box(0.008, 0.012, 0.002, 0x5e3b1f, 0.029);
    door.position.z = 0.0145;
    g.add(door);
    return g;
  };
  [
    [-0.15, -0.075],
    [-0.08, -0.085],
    [-0.01, -0.075],
  ].forEach(([x, z], i) => era.stand(hut(i), x, z, 0.1 + i * 0.12));

  const canoe = box(0.045, 0.005, 0.01, 0x7a5230, 0.0025);
  era.stand(canoe, 0.08, -0.085, 0.45);
  era.tick((_dt, t) => {
    canoe.position.y = 0.0025 + Math.sin(t * 1.6) * 0.0012;
    canoe.rotation.z = Math.sin(t * 1.3) * 0.05;
  });

  // Wild cherry at the edge of the forest: small, dark fruit.
  const tree = cherryTree(0.8, 21);
  decorate(tree, 7, 3, 0x8e1b2a, 0.0045);
  era.stand(tree, 0.15, 0.03, 0.55);
  const fir = (h: number) => {
    const g = new Group();
    const cone = mesh(new CylinderGeometry(0, 0.016, h, 6), 0x3f6e3a);
    cone.position.y = h / 2 + 0.006;
    g.add(cone, box(0.004, 0.008, 0.004, 0x5e3b1f, 0.004));
    return g;
  };
  era.stand(fir(0.06), 0.19, -0.03, 0.5);
  era.stand(fir(0.05), 0.07, 0.01, 0.6);

  const people = [person(CLOTH.brown, 1), person(CLOTH.dark, 2), person(CLOTH.ochre, 4)];
  [
    [-0.05, 0.04],
    [0.04, 0.07],
    [-0.13, 0.06],
  ].forEach(([x, z], i) => era.stand(people[i], x, z, 0.7 + i * 0.08));
  idleBob(era, people);
  return era;
}

// ------------------------------------------------------------------ 2 · Cham-Hagendorn, Roman times

export interface RomanEra {
  era: Era;
  wheel: Group;
  setWheelSpeed(radPerSec: number): void;
  flood(): Promise<void>;
  excavate(): Promise<void>;
}

export function romanEra(clock: StoryClock): RomanEra {
  const era = new Era(clock, 'era-roman');
  const stream = new CatmullRomCurve3([
    new Vector3(-PAGE_W + 0.01, 0, -0.005),
    new Vector3(-0.07, 0, -0.02),
    new Vector3(0.04, 0, -0.035),
    new Vector3(PAGE_W - 0.01, 0, -0.02),
  ]);
  era.lay(ribbon(stream, 0.036, PALETTE.lake, 32, 0.001), 0, 0);
  era.lay(patch(0.09, 0.045, PALETTE.meadow, 6), 0.1, 0.06, 0.05);

  // Mill house with red tiles, wheel on its stream side.
  const mill = new Group();
  mill.add(box(0.075, 0.048, 0.05, PALETTE.stone));
  mill.add(roof(0.085, 0.024, 0.058, PALETTE.roof, 0.048));
  const door = box(0.012, 0.02, 0.002, 0x5e3b1f, 0.01);
  door.position.z = 0.026;
  mill.add(door);
  const millHinge = era.stand(mill, -0.11, -0.075, 0);

  const wheel = new Group();
  wheel.name = 'wheel';
  wheel.position.y = 0.024;
  wheel.add(mesh(new TorusGeometry(0.022, 0.0022, 5, 18), PALETTE.wood));
  wheel.add(mesh(new CylinderGeometry(0.004, 0.004, 0.008, 8).rotateX(Math.PI / 2), 0x5e3b1f));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const paddle = mesh(new BoxGeometry(0.004, 0.009, 0.012), PALETTE.wood);
    paddle.position.set(Math.cos(a) * 0.024, Math.sin(a) * 0.024, 0);
    paddle.rotation.z = a;
    const spoke = mesh(new BoxGeometry(0.0016, 0.044, 0.0016), PALETTE.wood);
    spoke.rotation.z = a / 2;
    wheel.add(paddle, spoke);
  }
  const wheelHinge = era.stand(wheel, -0.055, -0.03, 0.15);
  wheelHinge.name = 'wheel-hinge';
  let wheelSpeed = 0.6;
  era.tick((dt) => (wheel.rotation.z -= wheelSpeed * dt));

  // Table with the bowl of cherries, and the family around it.
  const table = new Group();
  table.add(box(0.06, 0.004, 0.032, PALETTE.wood, 0.016));
  for (const [x, z] of [
    [-0.026, -0.012],
    [0.026, -0.012],
    [-0.026, 0.012],
    [0.026, 0.012],
  ]) {
    const leg = box(0.003, 0.014, 0.003, 0x7a5230);
    leg.position.set(x, 0.007, z);
    table.add(leg);
  }
  const bowl = bowlWithCherries(0.012, PALETTE.cream, 7, 9);
  bowl.position.y = 0.018;
  table.add(bowl);
  const tableHinge = era.stand(table, 0.08, 0.035, 0.3);
  const family = [person(CLOTH.linen, 1), person(CLOTH.red, 2), person(CLOTH.linen, 4)];
  const familyHinges = [
    [0.04, 0.0],
    [0.12, 0.005],
    [0.085, -0.01],
  ].map(([x, z], i) => era.stand(family[i], x, z, 0.4 + i * 0.1));
  idleBob(era, family);

  // ---- flood: rain, rising water that turns into mud
  const rainCount = 90;
  const rain = new InstancedMesh(new BoxGeometry(0.0007, 0.012, 0.0007), era.own(new MeshBasicMaterial({ color: 0x9cc4e8 })), rainCount);
  rain.visible = false;
  const drops = Array.from({ length: rainCount }, (_, i) => ({ x: (rng(i + 1)() - 0.5) * 2 * PAGE_W, z: (rng(i + 50)() - 0.5) * PAGE_D, y: rng(i + 99)() * 0.2 }));
  const dummy = new Object3D();
  era.group.add(rain);
  era.tick((dt) => {
    if (!rain.visible) return;
    drops.forEach((d, i) => {
      d.y -= dt * 0.35;
      if (d.y < 0) d.y += 0.2;
      dummy.position.set(d.x, d.y, d.z);
      dummy.updateMatrix();
      rain.setMatrixAt(i, dummy.matrix);
    });
    rain.instanceMatrix.needsUpdate = true;
  });
  const waterMat = era.own(new MeshLambertMaterial({ color: PALETTE.lake, transparent: true, opacity: 0.7 }));
  const water = new Mesh(new BoxGeometry(PAGE_W * 2 - 0.004, 0.001, PAGE_D - 0.004), waterMat);
  water.visible = false;
  era.group.add(water);
  const mud = new Color(0x775039);
  const lakeColor = new Color(PALETTE.lake);

  // ---- 1944: archaeologists and the stones in the mud
  const dig = new Group();
  dig.visible = false;
  const hole = mesh(new CylinderGeometry(0.022, 0.018, 0.002, 16), 0x4e3423);
  hole.position.set(0.08, 0.03, 0.035);
  dig.add(hole);
  const stoneGeo = new SphereGeometry(0.0028, 6, 5);
  const halo = mesh(new TorusGeometry(0.014, 0.0012, 4, 24), 0xd6ab53);
  halo.rotation.x = -Math.PI / 2;
  halo.position.set(0.08, 0.034, 0.035);
  for (let i = 0; i < 5; i++) {
    const s = mesh(stoneGeo, 0xe6d3ae);
    s.position.set(0.08 + Math.cos(i * 1.3) * 0.007, 0.0325, 0.035 + Math.sin(i * 1.3) * 0.006);
    s.scale.set(1, 0.75, 0.8);
    dig.add(s);
  }
  dig.add(halo);
  const archaeologists = [hatted(0xc2a878, 0x8a6b45), hatted(0x9fb08a, 0x8a6b45)];
  archaeologists[0].position.set(0.045, 0.03, 0.03);
  archaeologists[1].position.set(0.115, 0.03, 0.02);
  const brush = box(0.0015, 0.016, 0.0015, PALETTE.wood);
  brush.position.set(0.012, 0.012, 0.006);
  brush.rotation.z = 0.8;
  archaeologists[0].add(brush);
  dig.add(...archaeologists);
  era.group.add(dig);
  era.tick((_dt, t) => {
    if (!dig.visible) return;
    halo.rotation.z = t;
    halo.scale.setScalar(1 + Math.sin(t * 4) * 0.12);
    brush.rotation.z = 0.8 + Math.sin(t * 9) * 0.35;
    archaeologists[0].rotation.x = 0.35;
  });

  return {
    era,
    wheel: wheelHinge,
    setWheelSpeed: (s) => (wheelSpeed = s),
    async flood() {
      rain.visible = true;
      water.visible = true;
      water.position.y = 0.001;
      // The family and the table leave as the water rises.
      const leaving = Promise.all([...familyHinges, tableHinge].map((h, i) => clock.wait(600 + i * 250).then(() => era.toggle(h, false, 500))));
      await clock.tween(3200, (k) => {
        water.position.y = 0.001 + k * 0.022;
        waterMat.color.copy(lakeColor);
      });
      await leaving;
      await Promise.all([
        era.toggle(wheelHinge, false, 500),
        era.toggle(millHinge, false, 600),
        clock.tween(1600, (k) => {
          waterMat.color.copy(lakeColor).lerp(mud, k);
          waterMat.opacity = 0.7 + 0.3 * k;
          water.position.y = 0.023 + k * 0.006;
        }),
      ]);
      rain.visible = false;
    },
    async excavate() {
      dig.visible = true;
      await clock.tween(900, (k) => {
        hole.scale.setScalar(Math.max(0.001, k));
        archaeologists.forEach((a) => (a.scale.y = Math.max(0.001, easeOut(k))));
      });
    },
  };
}

// ------------------------------------------------------------------ 3 · Chriesimärt 1627

export function marketEra(clock: StoryClock): Era {
  const era = new Era(clock, 'era-market');
  era.lay(patch(0.19, 0.1, PALETTE.stone, 3), 0, 0);
  [
    [-0.17, -0.09, 1],
    [-0.1, -0.095, 3],
    [0.12, -0.095, 4],
    [0.18, -0.085, 2],
  ].forEach(([x, z, v], i) => era.stand(house(v), x, z, i * 0.08));

  const stall = (seed: number) => {
    const g = new Group();
    g.add(box(0.05, 0.004, 0.025, PALETTE.wood, 0.017));
    for (const x of [-0.022, 0.022]) {
      const leg = box(0.003, 0.016, 0.003, 0x7a5230);
      leg.position.set(x, 0.008, 0.01);
      g.add(leg);
      const pole = box(0.0025, 0.045, 0.0025, 0x7a5230);
      pole.position.set(x, 0.0225, -0.011);
      g.add(pole);
    }
    // Striped awning, sloping towards the reader.
    for (let i = 0; i < 5; i++) {
      const s = box(0.011, 0.002, 0.03, i % 2 ? 0xffffff : PALETTE.cherry, 0);
      s.position.set(-0.022 + i * 0.011, 0.043, 0.0);
      s.rotation.x = 0.35;
      g.add(s);
    }
    for (const x of [-0.012, 0.012]) {
      const b = basket();
      b.scale.setScalar(0.45);
      b.position.set(x, 0.019, 0.002);
      const cherryGeo = new SphereGeometry(0.008, 6, 5);
      for (let k = 0; k < 4; k++) {
        const c = mesh(cherryGeo, PALETTE.cherry);
        c.position.set(Math.cos(k * 1.6 + seed) * 0.01, 0.024, Math.sin(k * 1.6 + seed) * 0.01);
        b.add(c);
      }
      g.add(b);
    }
    return g;
  };
  [
    [-0.12, -0.01],
    [0.0, -0.03],
    [0.12, -0.005],
  ].forEach(([x, z], i) => era.stand(stall(i), x, z, 0.3 + i * 0.1));

  const shoppers = [person(CLOTH.red, 1), person(CLOTH.linen, 2), person(CLOTH.blue, 3), person(CLOTH.ochre, 4), person(CLOTH.grey, 5)];
  const spots = [
    [-0.16, 0.05],
    [-0.06, 0.06],
    [0.04, 0.04],
    [0.1, 0.07],
    [0.17, 0.05],
  ];
  const hinges = spots.map(([x, z], i) => era.stand(shoppers[i], x, z, 0.55 + i * 0.07));
  idleBob(era, shoppers);
  // Two shoppers stroll slowly between the stalls.
  era.tick((_dt, t) => {
    hinges[1].position.x = spots[1][0] + Math.sin(t * 0.5) * 0.03;
    hinges[3].position.x = spots[3][0] + Math.sin(t * 0.4 + 2) * 0.025;
  });
  return era;
}

// ------------------------------------------------------------------ 4 · Allmend and Chriesigloggä, 1711

export interface AllmendEra {
  era: Era;
  tower: Object3D;
  /** Tree objects (direct children of their hinge, for the picking game). */
  trees: Object3D[];
  ringBell(): Promise<void>;
  /** Night watch on/off: the guard with his lantern walks between the trees. */
  setNight(on: boolean): void;
  rush(): Promise<void>;
  /** The child's runner leans the ladder against `tree`; others go to the remaining trees. */
  leanLadders(tree: Object3D): Promise<{ root: Group; heroTree: Object3D; basket: Object3D }>;
}

export function allmendEra(clock: StoryClock, sfx: { bell(at?: number): void }): AllmendEra {
  const era = new Era(clock, 'era-allmend');
  era.lay(patch(0.1, 0.1, PALETTE.stone, 5), -0.11, 0.0);
  era.lay(patch(0.11, 0.105, PALETTE.meadow, 8), 0.105, 0.0);

  // Old St. Michael: nave and bell tower (the present church was only built around 1900).
  const nave = new Group();
  nave.add(box(0.055, 0.04, 0.06, PALETTE.cream));
  nave.add(roof(0.065, 0.026, 0.066, PALETTE.roof, 0.04));
  era.stand(nave, -0.115, -0.08, 0);
  const tower = clockTower();
  tower.scale.setScalar(0.72);
  era.stand(tower, -0.17, -0.07, 0.08);
  const bell = tower.getObjectByName('bell') ?? tower;

  const treeSpots = [
    [0.05, -0.06],
    [0.155, -0.045],
    [0.115, 0.045],
  ];
  const trees = treeSpots.map(([x, z], i) => {
    const t = cherryTree(0.85, 30 + i);
    decorate(t, 9, 40 + i);
    era.stand(t, x, z, 0.25 + i * 0.1);
    return t;
  });

  // Guard with a lantern: warm glow without a real light (no shader recompiles).
  const guard = hatted(0x3d405b, 0x2b2d42);
  const lantern = new Group();
  lantern.add(new Mesh(new SphereGeometry(0.0035, 8, 6), era.own(new MeshBasicMaterial({ color: 0xffd27a }))));
  const glow = new Mesh(new SphereGeometry(0.014, 10, 8), era.own(new MeshBasicMaterial({ color: 0xffc35a, transparent: true, opacity: 0.3, depthWrite: false })));
  lantern.add(glow);
  lantern.position.set(0.009, 0.02, 0.006);
  guard.add(lantern);
  const guardHinge = era.stand(guard, 0.1, -0.005, 0.5);
  let night = false;
  era.tick((_dt, t) => {
    lantern.visible = night;
    if (!night) return;
    const a = t * 0.45;
    guardHinge.position.set(0.105 + Math.cos(a) * 0.065, 0, -0.005 + Math.sin(a) * 0.035);
    guard.position.y = Math.abs(Math.sin(t * 6)) * 0.0015;
    glow.scale.setScalar(1 + Math.sin(t * 7) * 0.08);
  });

  // Citizens waiting on the square with ladders on their shoulders.
  // Staggered rows facing the Allmend, so the carried ladders do not overlap.
  const shirts = [PALETTE.zugBlue, CLOTH.red, CLOTH.ochre];
  const runners = shirts.map((shirt, i) => {
    const p = person(shirt, i + 1);
    const l = ladder(0.065);
    l.rotation.z = -Math.PI / 2;
    l.position.set(-0.032, 0.028, 0.009);
    p.add(l);
    return { person: p, ladder: l, hinge: era.stand(p, -0.15 + (i % 2) * 0.03, 0.015 + i * 0.04, 0.6 + i * 0.06) };
  });
  const ladderFoot = (tree: Object3D, side: number) => new Vector3(tree.parent!.position.x - 0.03 * side, 0, tree.parent!.position.z + 0.028);

  const runTo = (r: (typeof runners)[number], to: Vector3, ms: number) => {
    const from = r.hinge.position.clone();
    r.person.rotation.y = Math.atan2(-(to.z - from.z), to.x - from.x);
    return clock.tween(
      ms,
      (k) => {
        r.hinge.position.lerpVectors(from, to, k);
        r.person.position.y = k < 1 ? Math.abs(Math.sin(k * ms * 0.02)) * 0.004 : 0;
      },
      linear,
    );
  };

  let rushed: Promise<void> | null = null;
  return {
    era,
    tower,
    trees,
    async ringBell() {
      sfx.bell(0);
      sfx.bell(0.9);
      sfx.bell(1.8);
      await clock.tween(2600, (k) => (bell.rotation.z = Math.sin(k * Math.PI * 6) * 0.5 * (1 - k)), linear);
    },
    setNight(on) {
      night = on;
      // By day the guard stands by the church.
      if (!on) guardHinge.position.set(-0.07, 0, -0.035);
    },
    rush() {
      // Everyone dashes from the square to the edge of the Allmend, then waits for the child.
      rushed = Promise.all(runners.map((r, i) => runTo(r, new Vector3(-0.05 + i * 0.022, 0, -0.05 + i * 0.05), 1600 + i * 180))).then(() => undefined);
      return rushed;
    },
    async leanLadders(heroTree) {
      await rushed;
      const order = [heroTree, ...trees.filter((t) => t !== heroTree)];
      await Promise.all(
        runners.map(async (r, i) => {
          const tree = order[i];
          const foot = ladderFoot(tree, 1);
          await runTo(r, foot.clone().add(new Vector3(-0.014, 0, 0.008)), 1200 + i * 250);
          // The ladder leaves the shoulder and leans against the crown.
          const treeHinge = tree.parent!;
          treeHinge.attach(r.ladder);
          const fromPos = r.ladder.position.clone();
          const fromQ = r.ladder.quaternion.clone();
          const footLocal = new Vector3(-0.03, 0, 0.028);
          const top = new Vector3(-0.008, 0.085, 0.006);
          const toQ = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), top.clone().sub(footLocal).normalize());
          await clock.tween(
            900,
            (k) => {
              r.ladder.position.lerpVectors(fromPos, footLocal, k);
              r.ladder.quaternion.slerpQuaternions(fromQ, toQ, k);
              r.ladder.scale.setScalar(1 + 0.25 * k);
            },
            easeOut,
          );
        }),
      );
      // Basket at the foot of the child's tree; the tree hinge is the game's root.
      const root = heroTree.parent as Group;
      const b = basket();
      b.scale.setScalar(0.55);
      b.position.set(0.035, 0, 0.035);
      root.add(b);
      heroTree.getObjectByName('deco')!.visible = false;
      return { root, heroTree, basket: b };
    },
  };
}

// ------------------------------------------------------------------ 5 · The first Zuger Kirschtorte, 1915

export interface BakeryEra {
  era: Era;
  bowl: Group;
  stir(delta: number, progress: number): void;
  revealCake(): Promise<void>;
}

export function bakeryEra(clock: StoryClock): BakeryEra {
  const era = new Era(clock, 'era-bakery');
  era.lay(patch(0.2, 0.105, 0xc9a06a, 12), 0, 0);
  const wall = new Group();
  wall.add(box(PAGE_W * 2 - 0.03, 0.1, 0.006, 0xf3e1c2));
  const win = box(0.06, 0.04, 0.002, 0xbfdcf0, 0.06);
  win.position.set(0.11, 0.06, 0.004);
  const frame = box(0.002, 0.04, 0.003, PALETTE.wood, 0.06);
  frame.position.set(0.11, 0.06, 0.005);
  wall.add(win, frame);
  // Shelf with preserving jars: «ins Glas».
  const shelf = box(0.1, 0.004, 0.02, PALETTE.wood, 0.068);
  shelf.position.set(-0.1, 0.068, 0.012);
  wall.add(shelf);
  const glass = era.own(new MeshLambertMaterial({ color: 0xd9eef0, transparent: true, opacity: 0.55 }));
  for (let i = 0; i < 4; i++) {
    const jar = new Mesh(new CylinderGeometry(0.0065, 0.0065, 0.014, 10), glass);
    jar.position.set(-0.135 + i * 0.023, 0.077, 0.012);
    const fill = mesh(new CylinderGeometry(0.0058, 0.0058, 0.009, 10), 0x8e1b2a);
    fill.position.set(jar.position.x, 0.0745, 0.012);
    const lid = mesh(new CylinderGeometry(0.0072, 0.0072, 0.003, 10), i % 2 ? 0xffffff : PALETTE.cherry);
    lid.position.set(jar.position.x, 0.0855, 0.012);
    wall.add(jar, fill, lid);
  }
  era.stand(wall, 0, -HALF_D + 0.012, 0);

  const table = new Group();
  table.add(box(0.15, 0.006, 0.06, PALETTE.wood, 0.03));
  for (const [x, z] of [
    [-0.068, -0.025],
    [0.068, -0.025],
    [-0.068, 0.025],
    [0.068, 0.025],
  ]) {
    const leg = box(0.004, 0.027, 0.004, 0x7a5230);
    leg.position.set(x, 0.0135, z);
    table.add(leg);
  }
  era.stand(table, 0, 0.0, 0.2);

  const baker = hatted(0xffffff, 0xffffff);
  const tallHat = mesh(new CylinderGeometry(0.0075, 0.006, 0.012, 8), 0xffffff);
  tallHat.position.y = 0.048;
  baker.add(tallHat);
  baker.scale.setScalar(1.25);
  era.stand(baker, 0.045, -0.05, 0.35);
  idleBob(era, [baker]);

  // Copper bowl with batter and a wooden spoon that follows the child's circles.
  const bowl = new Group();
  bowl.name = 'bowl';
  const profile = [new Vector2(0, 0), new Vector2(0.014, 0), new Vector2(0.024, 0.014), new Vector2(0.026, 0.018)];
  bowl.add(mesh(new LatheGeometry(profile, 16), mat(PALETTE.copper, { side: DoubleSide })));
  const batter = mesh(new CylinderGeometry(0.021, 0.021, 0.002, 16), 0xf0dcb4);
  batter.position.y = 0.012;
  bowl.add(batter);
  const spoon = new Group();
  const stick = box(0.0024, 0.05, 0.0024, PALETTE.wood, 0);
  stick.position.set(0.009, 0.03, 0);
  stick.rotation.z = -0.35;
  spoon.add(stick);
  bowl.add(spoon);
  // Generous invisible tap volume.
  bowl.add(new Mesh(new SphereGeometry(0.04, 8, 6), era.own(new MeshBasicMaterial({ visible: false }))));
  bowl.position.y = 0.033;
  era.stand(bowl, -0.035, 0.005, 0.45);

  // The cake: almond meringue, pink Kirsch-soaked sponge, buttercream, icing sugar.
  const cake = new Group();
  const layer = (r: number, h: number, y: number, color: number) => {
    const m = mesh(new CylinderGeometry(r, r, h, 20), color);
    m.position.y = y + h / 2;
    cake.add(m);
  };
  layer(0.026, 0.004, 0, 0xd9b27a);
  layer(0.026, 0.004, 0.004, 0xf3e6c8);
  layer(0.026, 0.008, 0.008, 0xe7a1a8);
  layer(0.026, 0.004, 0.016, 0xf3e6c8);
  layer(0.026, 0.004, 0.02, 0xd9b27a);
  layer(0.0262, 0.0012, 0.024, 0xffffff);
  const almond = new BoxGeometry(0.004, 0.006, 0.0015);
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const s = mesh(almond, 0xe8d3a8);
    s.position.set(Math.cos(a) * 0.0265, 0.012, Math.sin(a) * 0.0265);
    s.rotation.y = -a;
    cake.add(s);
  }
  cake.position.set(0.035, 0.033, 0.012);
  cake.visible = false;
  era.group.add(cake);

  let angle = 0;
  return {
    era,
    bowl,
    stir(delta, progress) {
      angle += delta;
      spoon.rotation.y = angle;
      batter.rotation.y = angle * 0.5;
      batter.scale.setScalar(1 + Math.sin(progress * Math.PI * 6) * 0.02);
    },
    async revealCake() {
      cake.visible = true;
      await clock.tween(900, (k) => cake.scale.setScalar(Math.max(0.001, k < 1 ? 1.15 * easeOut(k) - 0.15 * k : 1)));
    },
  };
}

// ------------------------------------------------------------------ 6 · The trees disappear, 1950 → 2000

export interface DeclineEra {
  era: Era;
  /** Trees fold away one by one while houses and a road rise; `onYear` gets 1950 … 2000. */
  play(onYear: (year: number) => void): Promise<void>;
}

export function declineEra(clock: StoryClock): DeclineEra {
  const era = new Era(clock, 'era-decline');
  era.lay(patch(0.2, 0.105, PALETTE.meadow, 14), 0, 0);
  const spots = [
    [-0.16, -0.07],
    [-0.06, -0.08],
    [0.06, -0.075],
    [0.16, -0.065],
    [-0.12, 0.05],
    [0.0, 0.055],
    [0.12, 0.05],
  ];
  const trees = spots.map(([x, z], i) => {
    const t = cherryTree(0.62, 50 + i);
    decorate(t, 4, 60 + i);
    return era.stand(t, x, z, i * 0.08);
  });
  const road = era.lay(box(PAGE_W * 2 - 0.02, 0.002, 0.022, 0x8d8d8d, 0.001), 0, -0.005, 0);
  road.visible = false;
  const houses = spots.map(([x, z], i) => {
    const h = house(i + 1);
    h.scale.setScalar(0.95);
    const hinge = era.stand(h, x, z, 0);
    hinge.visible = false;
    return hinge;
  });
  return {
    era,
    async play(onYear) {
      await era.toggle(road, true, 700);
      for (let i = 0; i < trees.length; i++) {
        await era.toggle(trees[i], false, 450);
        void era.toggle(houses[i], true, 550);
        onYear(1950 + Math.round(((i + 1) / trees.length) * 50));
        await clock.wait(350);
      }
    },
  };
}

// ------------------------------------------------------------------ 7 · New trees and the Chriesisturm, today

export interface TodayEra {
  era: Era;
  /** Saplings rise one by one; `onCount` gets 0 … 1000. */
  plant(onCount: (n: number) => void): Promise<void>;
  race(): Promise<void>;
}

export function todayEra(clock: StoryClock, sfx: { bell(at?: number): void }): TodayEra {
  const era = new Era(clock, 'era-today');
  era.lay(patch(0.1, 0.1, PALETTE.stone, 7), -0.11, 0.0);
  era.lay(patch(0.11, 0.105, PALETTE.meadow, 9), 0.105, 0.0);
  const zyt = clockTower();
  zyt.scale.setScalar(0.62);
  era.stand(zyt, -0.18, -0.08, 0);
  [
    [-0.125, -0.09, 0],
    [-0.065, -0.095, 3],
  ].forEach(([x, z, v], i) => era.stand(house(v), x, z, 0.05 + i * 0.05));
  const arch = startArch();
  arch.rotation.y = Math.PI / 2;
  era.stand(arch, -0.1, 0.075, 0.2);

  // Race loop through the old town on the left page.
  const path = new CatmullRomCurve3(
    [
      new Vector3(-0.17, 0, 0.075),
      new Vector3(-0.08, 0, 0.09),
      new Vector3(-0.025, 0, 0.05),
      new Vector3(-0.04, 0, -0.025),
      new Vector3(-0.11, 0, -0.035),
      new Vector3(-0.185, 0, 0.0),
    ],
    true,
    'centripetal',
  );
  era.lay(ribbon(path, 0.018, PALETTE.path, 64, 0.0012), 0, 0, 0.1);

  // Two ladder teams and a runner with a «Hutte» on her back.
  const team = (shirt: number, seed: number) => {
    const p = person(shirt, seed);
    const l = ladder(0.07);
    l.rotation.z = -Math.PI / 2;
    l.position.set(-0.034, 0.028, 0.009);
    p.add(l);
    return p;
  };
  const hutte = () => {
    const p = person(CLOTH.red, 2);
    const h = basket();
    h.scale.set(0.45, 0.8, 0.45);
    h.position.set(-0.009, 0.012, 0);
    p.add(h);
    return p;
  };
  const runners = [team(PALETTE.zugBlue, 1), team(0xffffff, 4), hutte()];
  const runnerHinges = runners.map((r, i) => {
    const p = path.getPointAt(0.95 - i * 0.05);
    return era.stand(r, p.x, p.z, 0.4 + i * 0.1);
  });
  const crowd = [person(CLOTH.ochre, 3), person(CLOTH.grey, 5), person(CLOTH.linen, 6)];
  [
    [-0.13, 0.11],
    [-0.06, 0.115],
    [-0.0, 0.1],
  ].forEach(([x, z], i) => era.stand(crowd[i], x, z, 0.5 + i * 0.06));
  idleBob(era, crowd);

  // Young trees on the right page (rise during `plant`, not with the page).
  const saplingSpots: Array<[number, number]> = [];
  for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) saplingSpots.push([0.04 + col * 0.045 + (row % 2) * 0.02, -0.075 + row * 0.06]);
  const saplingHinges: Group[] = [];
  const saplings = new Group();
  era.group.add(saplings);
  saplingSpots.forEach(([x, z], i) => {
    const t = cherryTree(0.3, 70 + i);
    const hinge = new Group();
    hinge.position.set(x, 0, z);
    hinge.add(t);
    hinge.scale.setScalar(0.001);
    saplings.add(hinge);
    saplingHinges.push(hinge);
  });

  return {
    era,
    async plant(onCount) {
      for (let i = 0; i < saplingHinges.length; i++) {
        const h = saplingHinges[i];
        void clock.tween(500, (k) => h.scale.setScalar(Math.max(0.001, easeOut(k))));
        onCount(Math.round(((i + 1) / saplingHinges.length) * 1000));
        await clock.wait(420);
      }
      onCount(1000);
    },
    async race() {
      sfx.bell(0);
      sfx.bell(0.9);
      const length = 6500;
      const starts = runners.map((_, i) => 0.95 - i * 0.05);
      await clock.tween(
        length,
        (k) => {
          runners.forEach((r, i) => {
            const u = (((starts[i] + k * (1.05 - i * 0.08)) % 1) + 1) % 1;
            const p = path.getPointAt(u);
            const t = path.getTangentAt(u);
            runnerHinges[i].position.set(p.x, 0, p.z);
            r.rotation.y = Math.atan2(-t.z, t.x);
            r.position.y = Math.abs(Math.sin(k * 70 + i)) * 0.004;
          });
          crowd.forEach((c, i) => (c.position.y = Math.abs(Math.sin(k * 30 + i * 2)) * 0.004));
        },
        linear,
      );
    },
  };
}
