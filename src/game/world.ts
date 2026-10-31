import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  type Object3D,
} from 'three';
import type { Quality } from '../config';
import { easeInOut, easeOut, type StoryClock } from '../core/clock';
import type { Models } from '../scenes/shared/models';
import { PALETTE } from '../scenes/shared/palette';
import { alpsCard, clockTower, cherryTree, fountain, house, mat, mesh, ridgeCard, rng } from '../scenes/shared/placeholders';

/*
 * The race course through Zug, in metres. Runners move along −z; `d` is the distance
 * from the start line (world z = −d). Lanes are fixed x positions.
 *
 *   d −40 … 235   Altstadt: houses, cheering crowd behind barriers, Zytturm
 *   d 235 … 300   Chriesi orchard (trees on both sides)
 *   d 300 … 505   lake promenade (Zugersee on the left), crowd, houses on the right
 *   d 505         finish: the «Chriesi-Chuchi» house
 */
export const LANES = [-1.7, 0, 1.7] as const;
export const RUN1_END = 242;
export const RUN2_START = 282;
export const FINISH = 505;
export const STREET_HALF = 3.2;

export type ObstacleKind = 'barrel' | 'garland' | 'cart';

export interface Tree {
  root: Group;
  /** Base of the trunk (world). */
  at: Vector3;
  /** −1 left of the course, +1 right. */
  side: number;
  taken: boolean;
}

export interface PageWindow {
  /** Course x at the middle of the page. */
  x: number;
  halfWidth: number;
  halfDepth: number;
}

export interface GameWorld {
  root: Group;
  trees: Tree[];
  /** The tree the player picks from. */
  playerTree: Tree;
  /** Back wall of the finish house; the kitchen opens here. */
  finishHouse: Group;
  /** Mountains and sky cards that follow the camera along z. */
  backdrop: Group;
  /**
   * `range`: pieces further than this from `focusD` are skipped (they are off the page anyway).
   * `page`: the visible window in course metres. Pieces lie flat at the front / back page edge and
   * rise as they move onto the page, like a pop-up, instead of being cut open; pieces standing
   * beside the page are hidden (their tops would show beyond the paper from a low angle).
   */
  update(dt: number, time: number, focusD: number, range?: number, page?: PageWindow): void;
  /** Pop-up book style: everything folds flat and sinks away (finish transition). */
  fold(clock: StoryClock, ms: number): Promise<void>;
  dispose(): void;
}

const SHIRTS = [PALETTE.cherry, PALETTE.zugBlue, 0xffffff, 0xf2b134, PALETTE.leaf, 0x8e5bb5, 0xe8743b, 0x2b2d42];

/** Text painted on a canvas (banners, house sign). */
export function textTexture(text: string, bg: string, fg: string, w = 512, h = 128): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  g.font = `bold ${Math.round(h * 0.56)}px Georgia, serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + h * 0.03);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Wraps a page-space placeholder and scales it to metres. */
/** Share of the half page depth over which pieces rise up from the page edge. */
const EDGE_RISE = 0.3;

function big(obj: Object3D, s: number): Group {
  const g = new Group();
  obj.scale.multiplyScalar(s);
  g.add(obj);
  return g;
}

/** Arch over the street with a painted banner. */
export function bannerArch(text: string, colors: [string, string]): Group {
  const g = new Group();
  const pole = new CylinderGeometry(0.12, 0.14, 5.4, 8);
  for (const x of [-STREET_HALF - 0.4, STREET_HALF + 0.4]) {
    const p = mesh(pole, PALETTE.wood);
    p.position.set(x, 2.7, 0);
    g.add(p);
  }
  const tex = textTexture(text, colors[0], colors[1], 1024, 160);
  const banner = new Mesh(new BoxGeometry(2 * STREET_HALF + 1.2, 1.1, 0.12), [
    mat(PALETTE.zugBlue),
    mat(PALETTE.zugBlue),
    mat(PALETTE.zugBlue),
    mat(PALETTE.zugBlue),
    new MeshLambertMaterial({ map: tex }),
    new MeshLambertMaterial({ map: tex }),
  ]);
  banner.position.y = 4.9;
  g.add(banner);
  return g;
}

/** Obstacle meshes. Barrels are jumped, garlands slid under, carts dodged sideways. */
export function obstacleMesh(kind: ObstacleKind, seed = 0): Group {
  const g = new Group();
  g.name = `obstacle_${kind}`;
  if (kind === 'barrel') {
    // A stack of cherry crates / a barrel, ≈ 0.9 m high.
    if (seed % 2) {
      const b = mesh(new CylinderGeometry(0.42, 0.42, 0.9, 12), PALETTE.wood);
      b.position.y = 0.45;
      const hoop = new TorusGeometry(0.43, 0.03, 4, 16);
      for (const y of [0.2, 0.7]) {
        const h = mesh(hoop, 0x5e3b1f);
        h.rotation.x = Math.PI / 2;
        h.position.y = y;
        g.add(h);
      }
      g.add(b);
    } else {
      for (let i = 0; i < 2; i++) {
        const crate = mesh(new BoxGeometry(1.1, 0.42, 0.7), 0xc99a5b);
        crate.position.set(0, 0.21 + i * 0.44, 0);
        crate.rotation.y = i * 0.15;
        g.add(crate);
      }
      const fruit = mesh(new BoxGeometry(0.95, 0.08, 0.55), PALETTE.cherry);
      fruit.position.y = 0.9;
      g.add(fruit);
    }
  } else if (kind === 'garland') {
    // Low festival banner across the whole street: slide under it.
    const pole = new CylinderGeometry(0.08, 0.08, 1.9, 6);
    for (const x of [-STREET_HALF - 0.2, STREET_HALF + 0.2]) {
      const p = mesh(pole, 0xffffff);
      p.position.set(x, 0.95, 0);
      g.add(p);
    }
    const tex = textTexture('Hopp Zug!', '#2a6fb5', '#ffffff', 512, 96);
    const cloth = new Mesh(new PlaneGeometry(2 * STREET_HALF + 0.4, 0.55), new MeshLambertMaterial({ map: tex, side: DoubleSide }));
    cloth.position.y = 1.45;
    g.add(cloth);
  } else {
    // Leiterwagen loaded with cherry baskets, occupies one lane.
    const bed = mesh(new BoxGeometry(1.3, 0.5, 2.4), PALETTE.wood);
    bed.position.y = 0.75;
    g.add(bed);
    const wheel = new CylinderGeometry(0.36, 0.36, 0.1, 10);
    for (const [x, z] of [
      [-0.68, -0.8],
      [0.68, -0.8],
      [-0.68, 0.8],
      [0.68, 0.8],
    ]) {
      const w = mesh(wheel, 0x5e3b1f);
      w.rotation.z = Math.PI / 2;
      w.position.set(x, 0.36, z);
      g.add(w);
    }
    for (let i = 0; i < 3; i++) {
      const b = mesh(new CylinderGeometry(0.3, 0.24, 0.35, 8), 0xc99a5b);
      b.position.set(0, 1.18, -0.75 + i * 0.75);
      const fruit = mesh(new SphereGeometry(0.27, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), PALETTE.cherry);
      fruit.position.set(0, 1.3, -0.75 + i * 0.75);
      g.add(b, fruit);
    }
  }
  return g;
}

export function buildWorld(models: Models, quality: Quality): GameWorld {
  const root = new Group();
  root.name = 'race_world';
  const r = rng(11);
  const lite = quality === 'lite';
  const foldables: Object3D[] = [];
  const disposables: Array<{ dispose(): void }> = [];

  // ---- ground
  const ground = mesh(new PlaneGeometry(400, 800), PALETTE.meadow);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.02, -250);
  root.add(ground);
  const strip = (x0: number, x1: number, d0: number, d1: number, color: number, y = 0) => {
    const m = mesh(new PlaneGeometry(x1 - x0, d1 - d0), color);
    m.rotation.x = -Math.PI / 2;
    m.position.set((x0 + x1) / 2, y, -(d0 + d1) / 2);
    root.add(m);
    return m;
  };
  strip(-STREET_HALF, STREET_HALF, -60, FINISH + 30, PALETTE.path, 0.01);
  // Pavement in front of the houses (town sections only).
  strip(-7, -STREET_HALF, -60, 236, PALETTE.stone);
  strip(STREET_HALF, 7, -60, 236, PALETTE.stone);
  strip(STREET_HALF, 7, 298, FINISH + 30, PALETTE.stone);
  strip(-6.5, -STREET_HALF, 298, FINISH + 30, PALETTE.stone);
  // Zugersee along the promenade, with a stone quay edge.
  const lake = strip(-200, -6.5, 296, FINISH + 120, PALETTE.lake, -0.05);
  lake.name = 'lake';
  const quay = mesh(new BoxGeometry(0.5, 0.5, FINISH - 296), PALETTE.stone);
  quay.position.set(-6.5, 0.1, -(296 + FINISH) / 2);
  root.add(quay);
  // Lane markings.
  for (const x of [-0.85, 0.85]) {
    for (let d = 2; d < FINISH; d += 6) {
      if (d > 236 && d < 298) continue;
      const m = mesh(new PlaneGeometry(0.08, 2.4), 0xfff6e0);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.02, -d);
      root.add(m);
    }
  }
  // Start and finish lines.
  for (const d of [0, FINISH]) {
    const line = mesh(new PlaneGeometry(2 * STREET_HALF, 0.5), 0xffffff);
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.03, -d);
    root.add(line);
  }

  // ---- houses
  const addHouse = (x: number, d: number, side: number, variant: number) => {
    const h = models.get(`raceHouse_${variant % 4}`, () => big(house(variant), 105));
    h.position.set(x, 0, -d);
    h.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    root.add(h);
    foldables.push(h);
  };
  const row = (side: number, d0: number, d1: number, seed: number) => {
    let d = d0;
    let v = seed;
    while (d < d1) {
      const w = 5.5 + r() * 2.2;
      addHouse(side * 8.6, d + w / 2, side, v++);
      d += w + 0.6 + r() * 1.2;
    }
  };
  row(-1, -45, 232, 0);
  row(1, -45, 232, 3);
  row(1, 300, FINISH - 6, 7);

  // Zytturm next to the start, a fountain further on.
  const tower = models.get('raceTower', () => big(clockTower(), 190));
  tower.position.set(-10.5, 0, -28);
  root.add(tower);
  foldables.push(tower);
  const well = models.get('raceFountain', () => big(fountain(), 70));
  well.position.set(5.6, 0, -130);
  root.add(well);
  foldables.push(well);

  // ---- barriers along the street (town and promenade)
  const posts: Array<[number, number]> = [];
  for (const side of [-1, 1]) {
    for (let d = -40; d < FINISH; d += 3) {
      if (d > 232 && d < 300) continue;
      posts.push([side * (STREET_HALF + 0.25), d]);
    }
  }
  const postMesh = new InstancedMesh(new BoxGeometry(0.1, 1, 0.1), mat(PALETTE.cherry), posts.length);
  const m4 = new Matrix4();
  posts.forEach(([x, d], i) => postMesh.setMatrixAt(i, m4.makeTranslation(x, 0.5, -d)));
  root.add(postMesh);
  disposables.push(postMesh.geometry);
  for (const side of [-1, 1]) {
    for (const [d0, d1] of [
      [-40, 232],
      [300, FINISH],
    ]) {
      const rail = mesh(new BoxGeometry(0.06, 0.14, d1 - d0), 0xffffff);
      rail.position.set(side * (STREET_HALF + 0.25), 0.9, -(d0 + d1) / 2);
      root.add(rail);
    }
  }

  // ---- bunting high over the street: Zug white–blue pennants
  const pos: number[] = [];
  const col: number[] = [];
  const white = new Color(0xffffff);
  const blue = new Color(PALETTE.zugBlue);
  const red = new Color(PALETTE.cherry);
  for (let d = 12; d < FINISH; d += 24) {
    if (d > 232 && d < 300) continue;
    const n = 14;
    for (let i = 0; i < n; i++) {
      const x0 = -6 + (12 * i) / n;
      const x1 = x0 + 12 / n;
      const sag = (x: number) => 6.4 - 0.9 * (1 - (x / 6) ** 2);
      const xm = (x0 + x1) / 2;
      pos.push(x0, sag(x0), -d, x1, sag(x1), -d, xm, sag(xm) - 0.6, -d);
      const c = i % 3 === 2 ? red : i % 2 ? blue : white;
      for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
    }
  }
  const buntGeo = new BufferGeometry();
  buntGeo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  buntGeo.setAttribute('color', new Float32BufferAttribute(col, 3));
  const bunting = new Mesh(buntGeo, new MeshBasicMaterial({ vertexColors: true, side: DoubleSide }));
  root.add(bunting);
  disposables.push(buntGeo, bunting.material as MeshBasicMaterial);

  // ---- start arch, finish house
  const start = bannerArch('Chriesisturm', ['#ffffff', '#2a6fb5']);
  start.position.z = -0.5;
  root.add(start);
  foldables.push(start);
  const goal = bannerArch('Ziel', ['#c8263a', '#ffffff']);
  goal.position.z = -FINISH;
  root.add(goal);
  foldables.push(goal);

  const finishHouse = models.get('raceFinishHouse', () => {
    const g = big(house(2), 230);
    const sign = new Mesh(new PlaneGeometry(6, 1.3), new MeshBasicMaterial({ map: textTexture('Chriesi-Chuchi', '#f4eedc', '#c8263a') }));
    sign.position.set(0, 7.6, 5.3);
    g.add(sign);
    return g;
  });
  finishHouse.position.set(0, 0, -(FINISH + 14));
  root.add(finishHouse);

  // ---- orchard: four trees on each side
  const trees: Tree[] = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const d = 248 + i * 11 + (side > 0 ? 0 : 5);
      const t = models.get('raceCherryTree', () => {
        const g = big(cherryTree(1, 20 + i * 3 + side), 55);
        // Fruit dots on the crown so the trees read as cherry trees from the street.
        const crown = (g.children[0].userData.crown as Array<{ x: number; y: number; z: number; r: number }>) ?? [];
        const fruitGeo = new SphereGeometry(0.12, 6, 4);
        for (let k = 0; k < 26; k++) {
          const c = crown[k % crown.length];
          const a = k * 2.399;
          const e = Math.sin(k * 1.3) * 0.6;
          const f = mesh(fruitGeo, PALETTE.cherry);
          f.position.set(
            (c.x + Math.cos(a) * Math.cos(e) * c.r) * 55,
            (c.y + Math.sin(e) * c.r) * 55,
            (c.z + Math.sin(a) * Math.cos(e) * c.r) * 55,
          );
          g.add(f);
        }
        return g;
      });
      const at = new Vector3(side * (7 + r() * 0.6), 0, -d);
      t.position.copy(at);
      t.rotation.y = r() * Math.PI;
      root.add(t);
      foldables.push(t);
      trees.push({ root: t as Group, at, side, taken: false });
    }
  }
  const playerTree = trees.find((t) => t.side > 0)!;
  playerTree.taken = true;

  // ---- crowd: instanced bodies and heads along the barriers
  const spots: Array<{ x: number; d: number; phase: number; speed: number; scale: number }> = [];
  const step = lite ? 1.6 : 1.1;
  const rows = lite ? 1 : 2;
  for (const side of [-1, 1]) {
    for (const [d0, d1] of [
      [-30, 232],
      [300, FINISH - 2],
    ]) {
      for (let d = d0; d < d1; d += step) {
        for (let rw = 0; rw < rows; rw++) {
          if (r() < 0.25) continue;
          spots.push({
            x: side * (STREET_HALF + 0.9 + rw * 0.75 + r() * 0.25),
            d: d + r() * 0.6,
            phase: r() * Math.PI * 2,
            speed: 5 + r() * 5,
            scale: 0.75 + r() * 0.35,
          });
        }
      }
    }
  }
  const bodyGeo = new CapsuleGeometry(0.22, 0.6, 2, 6);
  const headGeo = new SphereGeometry(0.18, 7, 5);
  const bodies = new InstancedMesh(bodyGeo, new MeshLambertMaterial({ flatShading: true }), spots.length);
  const heads = new InstancedMesh(headGeo, mat(PALETTE.skin), spots.length);
  const tint = new Color();
  spots.forEach((_, i) => bodies.setColorAt(i, tint.setHex(SHIRTS[Math.floor(r() * SHIRTS.length)])));
  const crowd = new Group();
  crowd.name = 'crowd';
  crowd.add(bodies, heads);
  root.add(crowd);
  disposables.push(bodyGeo, headGeo, bodies.material as MeshLambertMaterial);
  const placeCrowd = (time: number, focusD: number, all = false) => {
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      // Only people near the runner jump; the rest stand still (cheap on phones).
      const near = Math.abs(s.d - focusD) < 45;
      if (!near && !all) continue;
      const hop = near ? Math.abs(Math.sin(time * s.speed + s.phase)) * 0.28 : 0;
      m4.makeScale(s.scale, s.scale, s.scale).setPosition(s.x, (0.52 + hop) * s.scale, -s.d);
      bodies.setMatrixAt(i, m4);
      m4.setPosition(s.x, (1.22 + hop) * s.scale, -s.d);
      heads.setMatrixAt(i, m4);
    }
    bodies.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
  };
  placeCrowd(0, 0, true);

  // ---- backdrop: Zugerberg and the Alps, travelling with the camera
  const backdrop = new Group();
  const alps = alpsCard(5);
  alps.scale.set(900, 700, 1);
  alps.position.set(0, -4, -380);
  const ridge = ridgeCard();
  ridge.scale.set(600, 520, 1);
  ridge.position.set(-120, -6, -330);
  backdrop.add(alps, ridge);
  root.add(backdrop);

  let lastFocus = 0;
  let folded = false;
  return {
    root,
    trees,
    playerTree,
    finishHouse: finishHouse as Group,
    backdrop,
    update(_dt, time, focusD, range = Infinity, page) {
      backdrop.position.z = -focusD;
      for (const o of folded ? [] : foldables) {
        const dz = Math.abs(-o.position.z - focusD);
        o.visible = dz < range && (!page || Math.abs(o.position.x - page.x) < page.halfWidth);
        if (!o.visible || !page) continue;
        const base = ((o.userData.baseScaleY as number | undefined) ??= o.scale.y);
        const k = Math.min(1, Math.max(0, (page.halfDepth - dz) / (page.halfDepth * EDGE_RISE)));
        o.scale.y = base * Math.max(0.02, k * k * (3 - 2 * k));
      }
      lastFocus = focusD;
      placeCrowd(time, focusD);
    },
    async fold(clock, ms) {
      // Fold every piece flat like a closing pop-up page, nearest first.
      const items = foldables
        .map((o) => ({ o, dist: Math.abs(-o.position.z - lastFocus) }))
        .sort((a, b) => a.dist - b.dist);
      const tweens = items.map(({ o }, i) => {
        const delay = Math.min(i * 18, ms * 0.5);
        // World-axis folds: sideways away from the street, or backwards for pieces across it.
        o.rotation.order = 'ZYX';
        const side = Math.abs(o.position.x) > 1 ? Math.sign(o.position.x) : 0;
        return clock.wait(delay).then(() =>
          clock.tween(ms * 0.5, (k) => {
            const a = (Math.PI / 2) * easeInOut(k);
            if (side) o.rotation.z = -side * a;
            else o.rotation.x = -a;
            o.position.y = -easeOut(k) * 0.6;
          }),
        );
      });
      // The finish house is lifted away to reveal the kitchen inside.
      const lift = clock.tween(ms * 0.6, (k) => {
        finishHouse.position.y = 22 * easeInOut(k);
        finishHouse.scale.setScalar(Math.max(0.001, 1 - easeInOut(k)));
      });
      const sink = clock.tween(ms * 0.7, (k) => {
        crowd.position.y = -2.2 * k;
        bunting.position.y = 8 * k;
        postMesh.position.y = -1.2 * k;
      });
      await Promise.all([...tweens, sink, lift]);
      finishHouse.visible = false;
      crowd.visible = false;
      bunting.visible = false;
      // Flat pieces would lie in the kitchen floor and flicker through it.
      folded = true;
      for (const o of foldables) o.visible = false;
    },
    dispose() {
      root.removeFromParent();
      disposables.forEach((d) => d.dispose());
      postMesh.dispose();
      bodies.dispose();
      heads.dispose();
    },
  };
}
