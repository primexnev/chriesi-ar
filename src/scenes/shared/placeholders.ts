import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  LatheGeometry,
  Mesh,
  MeshLambertMaterial,
  Path,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  type Curve,
  type Material,
  type Vector3,
} from 'three';
import { PALETTE } from './palette';

/**
 * Procedural stand-ins for Nevzat's models, in the papercut / low-poly look.
 * Node names follow the GLB conventions in README.md (e.g. `bell`, `crown`, `wing_L`)
 * so story code works unchanged once real models replace these.
 */

const materials = new Map<string, MeshLambertMaterial>();

export function mat(color: number, opts: { side?: typeof DoubleSide; transparent?: boolean } = {}): MeshLambertMaterial {
  const key = `${color}-${opts.side ?? 0}-${opts.transparent ?? false}`;
  let m = materials.get(key);
  if (!m) {
    m = new MeshLambertMaterial({ color, flatShading: true, side: opts.side, transparent: opts.transparent });
    materials.set(key, m);
  }
  return m;
}

export function mesh(geo: BufferGeometry, color: number | Material, name = ''): Mesh {
  const m = new Mesh(geo, typeof color === 'number' ? mat(color) : color);
  m.name = name;
  return m;
}

/** Deterministic random so placeholder layouts are stable between reloads. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A flat papercut card: a 2D silhouette in XY, extruded `depth` along +z. */
export function card(points: Array<[number, number]>, depth: number, color: number, name = ''): Mesh {
  const shape = new Shape(points.map(([x, y]) => new Vector2(x, y)));
  return mesh(new ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 4 }), color, name);
}

/** Flat ribbon along a curve (paths, streams). Lies on y = curve.y + lift. */
export function ribbon(curve: Curve<Vector3>, width: number, color: number, segments = 48, lift = 0.0015): Mesh {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u);
    const nx = -t.z;
    const nz = t.x;
    const len = Math.hypot(nx, nz) || 1;
    const hw = width / 2;
    pos.push(p.x + (nx / len) * hw, p.y + lift, p.z + (nz / len) * hw);
    pos.push(p.x - (nx / len) * hw, p.y + lift, p.z - (nz / len) * hw);
    if (i < segments) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return mesh(geo, mat(color, { side: DoubleSide }));
}

// ---------------------------------------------------------------- backdrop

export function alpsCard(seed = 3): Group {
  const g = new Group();
  g.name = 'alps';
  const r = rng(seed);
  const layer = (offsetY: number, color: number, z: number, peaks: number) => {
    const pts: Array<[number, number]> = [[-0.5, 0]];
    for (let i = 0; i <= peaks; i++) {
      const x = -0.5 + i / peaks;
      const peak = i % 2 === 1;
      pts.push([x, offsetY + (peak ? 0.1 + r() * 0.09 : 0.04 + r() * 0.04)]);
    }
    pts.push([0.5, 0]);
    const m = card(pts, 0.004, color);
    m.position.z = z;
    g.add(m);
  };
  layer(0.02, PALETTE.alpsShadow, 0, 13);
  layer(0, PALETTE.alps, 0.012, 9);
  return g;
}

export function ridgeCard(): Mesh {
  // Zugerberg: long, gentle, forested ridge rising to the left.
  const pts: Array<[number, number]> = [[-0.5, 0]];
  for (let i = 0; i <= 24; i++) {
    const x = -0.5 + i / 24;
    const y = 0.075 + 0.035 * Math.sin((i / 24) * Math.PI * 0.9 + 0.3) - 0.03 * (i / 24) + 0.006 * Math.sin(i * 1.7);
    pts.push([x, y]);
  }
  pts.push([0.5, 0]);
  return card(pts, 0.006, PALETTE.ridge, 'zugerberg');
}

export function sun(): Group {
  const g = new Group();
  g.name = 'sun';
  g.add(mesh(new CircleGeometry(0.03, 14), PALETTE.sun));
  for (let i = 0; i < 10; i++) {
    const ray = mesh(new BoxGeometry(0.004, 0.014, 0.002), PALETTE.sun);
    const a = (i / 10) * Math.PI * 2;
    ray.position.set(Math.cos(a) * 0.042, Math.sin(a) * 0.042, 0);
    ray.rotation.z = a - Math.PI / 2;
    g.add(ray);
  }
  return g;
}

// ---------------------------------------------------------------- town

const HOUSE_COLORS = [PALETTE.cream, 0xf2d8b0, 0xe9c6a5, 0xdfe7ea, 0xf3e1c2];

export function house(variant = 0): Group {
  const g = new Group();
  g.name = `house_${variant}`;
  const r = rng(variant * 31 + 7);
  const w = 0.05 + r() * 0.02;
  const d = 0.045;
  const h = 0.045 + r() * 0.03;
  const body = mesh(new BoxGeometry(w, h, d), HOUSE_COLORS[variant % HOUSE_COLORS.length], 'body');
  body.position.y = h / 2;
  g.add(body);
  // Gable roof: a triangle extruded across the depth.
  const rh = 0.028;
  const roof = card(
    [
      [-w / 2 - 0.005, 0],
      [w / 2 + 0.005, 0],
      [0, rh],
    ],
    d + 0.008,
    PALETTE.roof,
    'roof',
  );
  roof.position.set(0, h, -d / 2 - 0.004);
  g.add(roof);
  // Windows and a door on the front (+z).
  const win = new BoxGeometry(0.009, 0.011, 0.002);
  for (const x of [-w / 4, w / 4]) {
    const wm = mesh(win, PALETTE.zugBlue);
    wm.position.set(x, h * 0.68, d / 2 + 0.001);
    g.add(wm);
  }
  const door = mesh(new BoxGeometry(0.011, 0.018, 0.002), PALETTE.wood);
  door.position.set(0, 0.009, d / 2 + 0.001);
  g.add(door);
  return g;
}

/** Clock tower with an open belfry. The bell hangs from a pivot named `bell`. */
export function clockTower(): Group {
  const g = new Group();
  g.name = 'clock_tower';
  const s = 0.042;
  const h = 0.15;
  const body = mesh(new BoxGeometry(s, h, s), PALETTE.cream, 'body');
  body.position.y = h / 2;
  g.add(body);
  const face = mesh(new CircleGeometry(0.011, 12), 0xffffff);
  face.position.set(0, h - 0.018, s / 2 + 0.001);
  g.add(face);
  const hand = mesh(new BoxGeometry(0.0015, 0.008, 0.001), 0x333333);
  hand.position.set(0, h - 0.015, s / 2 + 0.002);
  g.add(hand);
  // Belfry: four posts and a roof.
  const postGeo = new BoxGeometry(0.005, 0.038, 0.005);
  for (const [x, z] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const p = mesh(postGeo, PALETTE.cream);
    p.position.set((x * s) / 2.3, h + 0.019, (z * s) / 2.3);
    g.add(p);
  }
  const roof = mesh(new ConeGeometry(s * 0.85, 0.05, 4), PALETTE.zugBlue, 'roof');
  roof.rotation.y = Math.PI / 4;
  roof.position.y = h + 0.038 + 0.025;
  g.add(roof);

  const pivot = new Group();
  pivot.name = 'bell';
  pivot.position.y = h + 0.034;
  const profile = [
    new Vector2(0.0, 0),
    new Vector2(0.004, 0),
    new Vector2(0.006, -0.006),
    new Vector2(0.008, -0.016),
    new Vector2(0.0125, -0.024),
    new Vector2(0.0125, -0.026),
  ];
  const bell = mesh(new LatheGeometry(profile, 10), mat(0xd4a52c, { side: DoubleSide }), 'bell_mesh');
  pivot.add(bell);
  g.add(pivot);
  return g;
}

export function fountain(): Group {
  const g = new Group();
  g.name = 'fountain';
  const basin = mesh(new CylinderGeometry(0.036, 0.038, 0.013, 10), PALETTE.stone);
  basin.position.y = 0.0065;
  const water = mesh(new CylinderGeometry(0.032, 0.032, 0.002, 10), PALETTE.lake, 'water');
  water.position.y = 0.0125;
  const column = mesh(new CylinderGeometry(0.005, 0.007, 0.04, 6), PALETTE.stone);
  column.position.y = 0.02;
  const top = mesh(new CylinderGeometry(0.012, 0.006, 0.006, 8), PALETTE.stone);
  top.position.y = 0.042;
  const figure = mesh(new CapsuleGeometry(0.004, 0.01, 2, 6), PALETTE.zugBlue);
  figure.position.y = 0.053;
  g.add(basin, water, column, top, figure);
  return g;
}

/** Simple person: capsule body + head. Height ≈ 0.04 page units. */
export function person(shirt: number, seed = 0): Group {
  const g = new Group();
  g.name = 'person';
  const body = mesh(new CapsuleGeometry(0.0075, 0.014, 2, 6), shirt, 'body');
  body.position.y = 0.0145;
  const head = mesh(new SphereGeometry(0.0068, 8, 6), PALETTE.skin, 'head');
  head.position.y = 0.034;
  g.add(body, head);
  if (seed % 3 === 0) {
    const hat = mesh(new CylinderGeometry(0.004, 0.009, 0.006, 8), PALETTE.cherry);
    hat.position.y = 0.0405;
    g.add(hat);
  }
  return g;
}

export function ladder(length = 0.075): Group {
  const g = new Group();
  g.name = 'ladder';
  const railGeo = new BoxGeometry(0.0025, length, 0.0025);
  for (const x of [-0.007, 0.007]) {
    const rail = mesh(railGeo, PALETTE.wood);
    rail.position.set(x, length / 2, 0);
    g.add(rail);
  }
  const rungGeo = new BoxGeometry(0.014, 0.0018, 0.0018);
  for (let y = 0.008; y < length; y += 0.011) {
    const rung = mesh(rungGeo, PALETTE.wood);
    rung.position.y = y;
    g.add(rung);
  }
  return g;
}

/** Start arch over the path (path runs along local x). Banner in Zug colours white–blue–white. */
export function startArch(): Group {
  const g = new Group();
  g.name = 'start_arch';
  const span = 0.055;
  const h = 0.065;
  const poleGeo = new CylinderGeometry(0.0022, 0.0022, h, 6);
  for (const z of [-span / 2, span / 2]) {
    const p = mesh(poleGeo, PALETTE.wood);
    p.position.set(0, h / 2, z);
    g.add(p);
  }
  const stripe = new BoxGeometry(0.002, 0.0055, span);
  [0xffffff, PALETTE.zugBlue, 0xffffff].forEach((c, i) => {
    const s = mesh(stripe, c);
    s.position.set(0, h - 0.003 - i * 0.0055, 0);
    g.add(s);
  });
  return g;
}

/** Long stone bridge with three arches, spanning local x. Deck top at y = height. */
export function stoneBridge(length = 0.17, height = 0.03, width = 0.03): Group {
  const g = new Group();
  g.name = 'bridge';
  const L = length / 2;
  const shape = new Shape();
  shape.moveTo(-L - 0.02, 0);
  shape.lineTo(-L, height);
  shape.lineTo(L, height);
  shape.lineTo(L + 0.02, 0);
  shape.lineTo(-L - 0.02, 0);
  const arches = 3;
  const archW = length / arches;
  for (let i = 0; i < arches; i++) {
    const cx = -L + archW * (i + 0.5);
    const r = archW * 0.34;
    const hole = new Path();
    hole.moveTo(cx - r, 0);
    hole.lineTo(cx - r, height * 0.35);
    hole.absarc(cx, height * 0.35, r, Math.PI, 0, true);
    hole.lineTo(cx + r, 0);
    hole.lineTo(cx - r, 0);
    shape.holes.push(hole);
  }
  const body = mesh(new ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 6 }), PALETTE.stone, 'body');
  body.position.z = -width / 2;
  g.add(body);
  const parapet = new BoxGeometry(length, 0.006, 0.003);
  for (const z of [-width / 2 + 0.0015, width / 2 - 0.0015]) {
    const p = mesh(parapet, PALETTE.cream);
    p.position.set(0, height + 0.003, z);
    g.add(p);
  }
  return g;
}

// ---------------------------------------------------------------- orchard & props

export interface CrownSphere {
  x: number;
  y: number;
  z: number;
  r: number;
}

/** Cherry tree. Crown parts are named `crown`; `userData.crown` lists them as spheres. */
export function cherryTree(scale = 1, seed = 1): Group {
  const g = new Group();
  g.name = 'cherry_tree';
  const r = rng(seed);
  const trunk = mesh(new CylinderGeometry(0.006, 0.01, 0.07, 6), 0x7a5230, 'trunk');
  trunk.position.y = 0.035;
  g.add(trunk);
  const crown: CrownSphere[] = [
    { x: 0, y: 0.095, z: 0, r: 0.045 },
    { x: -0.032, y: 0.08, z: 0.006, r: 0.032 },
    { x: 0.034, y: 0.082, z: -0.004, r: 0.034 },
  ];
  crown.forEach((c, i) => {
    const m = mesh(new IcosahedronGeometry(c.r, 1), i === 0 ? PALETTE.leaf : PALETTE.leafDark, 'crown');
    m.position.set(c.x, c.y, c.z);
    m.rotation.set(r() * 3, r() * 3, 0);
    g.add(m);
  });
  g.scale.setScalar(scale);
  g.userData.crown = crown.map((c) => ({ x: c.x * scale, y: c.y * scale, z: c.z * scale, r: c.r * scale }));
  return g;
}

export function cherry(): Group {
  const g = new Group();
  g.name = 'cherry';
  const fruit = mesh(new SphereGeometry(0.0095, 10, 8), PALETTE.cherry, 'fruit');
  const stem = mesh(new CylinderGeometry(0.0008, 0.0008, 0.012, 4), PALETTE.leafDark);
  stem.position.y = 0.012;
  stem.rotation.z = 0.3;
  g.add(fruit, stem);
  return g;
}

/** Basket; cherries collected go into the child group named `contents`. */
export function basket(): Group {
  const g = new Group();
  g.name = 'basket';
  const wall = mesh(new CylinderGeometry(0.03, 0.023, 0.026, 10, 1, true), mat(PALETTE.wood, { side: DoubleSide }), 'wall');
  wall.position.y = 0.013;
  const bottom = mesh(new CircleGeometry(0.023, 10), PALETTE.wood);
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = 0.001;
  const handle = mesh(new TorusGeometry(0.029, 0.0018, 4, 14, Math.PI), PALETTE.wood);
  handle.position.y = 0.026;
  const contents = new Group();
  contents.name = 'contents';
  g.add(wall, bottom, handle, contents);
  return g;
}

/** Starling with flapping wings named `wing_L` / `wing_R`. */
export function starling(): Group {
  const g = new Group();
  g.name = 'starling';
  const body = mesh(new IcosahedronGeometry(0.011, 0), 0x2b2d42, 'body');
  body.scale.set(1.6, 0.85, 0.9);
  const head = mesh(new IcosahedronGeometry(0.0075, 0), 0x3a3d5c);
  head.position.set(0.014, 0.006, 0);
  const beak = mesh(new ConeGeometry(0.0025, 0.009, 4), 0xf2b134);
  beak.rotation.z = -Math.PI / 2;
  beak.position.set(0.024, 0.005, 0);
  g.add(body, head, beak);
  const wingGeo = new BufferGeometry();
  wingGeo.setAttribute('position', new Float32BufferAttribute([0, 0, 0, -0.016, 0, 0, -0.006, 0, 0.026], 3));
  wingGeo.computeVertexNormals();
  for (const side of [1, -1]) {
    const pivot = new Group();
    pivot.name = side > 0 ? 'wing_L' : 'wing_R';
    pivot.position.set(0.002, 0.005, 0);
    const w = mesh(wingGeo, mat(0x23253a, { side: DoubleSide }));
    w.scale.z = side;
    pivot.add(w);
    g.add(pivot);
  }
  return g;
}

/** Thin ground patch (meadow, square paving) so models do not float on bare paper. */
export function patch(rx: number, rz: number, color: number, seed = 1): Mesh {
  const r = rng(seed);
  const pts: Array<[number, number]> = [];
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 0.85 + r() * 0.2;
    pts.push([Math.cos(a) * rx * k, Math.sin(a) * rz * k]);
  }
  const m = card(pts, 0.003, color);
  m.rotation.x = Math.PI / 2;
  m.position.y = 0.003;
  return m;
}
