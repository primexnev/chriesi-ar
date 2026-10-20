import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  Matrix4,
  Object3D,
  PlaneGeometry,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from '../../config';
import type { Quality } from '../../config';
import { clockTower, house, rng } from '../shared/placeholders';

/*
 * Papercut-diorama landscape for the excavation intro, covering the whole spread:
 * front meadow (flat where the villager acts) → Lake Zug → wooded foothills → snowy Alps.
 * Everything is procedural, so it costs no download. Animation runs on the story clock.
 */

const HALF_W = 0.5;
const HALF_D = (0.5 / CONFIG.spreadAspect) * 0.97;
/** Underside of the diorama block; the intro root is lifted by this much so it rests on the page. */
export const BLOCK_DEPTH = 0.012;
const BASE = -BLOCK_DEPTH;
export const WATER_Y = -0.002;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function hash(ix: number, iz: number): number {
  let h = (ix * 374761393 + iz * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Smooth value noise in [0, 1]. */
function noise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  return mix(mix(hash(ix, iz), hash(ix + 1, iz), u), mix(hash(ix, iz + 1), hash(ix + 1, iz + 1), u), v);
}

// Lake Zug: an elongated basin across the middle of the spread.
const lakeZ = (x: number) => -0.165 + 0.014 * Math.sin(x * 6 + 0.4);
const lakeR = (x: number) => 0.068 + 0.01 * Math.sin(x * 11 + 0.5);
/** < 1 inside the lake, 1 on the shoreline. */
export function lakeE(x: number, z: number): number {
  return Math.hypot(x / 0.41, (z - lakeZ(x)) / lakeR(x));
}

// Alpine peaks along the back edge: x, z, height, radius.
const PEAKS: Array<[number, number, number, number]> = [
  [-0.47, -0.31, 0.14, 0.13],
  [-0.32, -0.34, 0.21, 0.16],
  [-0.12, -0.35, 0.27, 0.18],
  [0.08, -0.335, 0.18, 0.14],
  [0.27, -0.35, 0.24, 0.17],
  [0.45, -0.325, 0.16, 0.13],
];

function mountains(x: number, z: number): number {
  let h = 0;
  for (const [px, pz, ph, pr] of PEAKS) {
    const dx = x - px, dz = (z - pz) * 1.25;
    // Mix of diamond and round distance gives faceted ridges instead of cones.
    const d = 0.55 * (Math.abs(dx + dz) + Math.abs(dx - dz)) * 0.72 + 0.45 * Math.hypot(dx, dz);
    if (d < pr) h = Math.max(h, ph * Math.pow(1 - d / pr, 1.25));
  }
  // Ridged noise breaks the silhouettes up into rock bands.
  const ridge = 1 - Math.abs(noise(x * 22, z * 22) * 2 - 1);
  return h + 0.022 * ridge * Math.min(1, h / 0.08);
}

/** Terrain height in page units; flat (y = 0) where the villager walks and digs. */
export function heightAt(x: number, z: number): number {
  const edge = smooth(0.3, 0.5, Math.abs(x));
  const front = 0.008 * edge * noise(x * 9 + 7, z * 9) - 0.007 * smooth(0.27, HALF_D, z);
  const behind = lakeZ(x) - lakeR(x) * 0.6 - z;
  const hills =
    smooth(0, 0.11, behind) * (0.03 + 0.03 * noise(x * 6 + 3, z * 6)) + 0.012 * noise(x * 18, z * 18) * smooth(0, 0.05, behind);
  const m = mountains(x, z);
  const back = Math.max(hills, m) + 0.01 * Math.min(hills, m);
  const land = mix(back, front, smooth(lakeZ(x) - 0.03, lakeZ(x) + 0.03, z));
  const e = lakeE(x, z);
  const bed = -0.0095 * (1 - Math.min(e, 1) ** 2);
  return mix(bed, land, smooth(1, 1.4, e));
}

const C = (hex: number) => new Color(hex);
const COL = {
  meadow: C(0x8fbf5a), meadowAlt: C(0x7caf4c), hill: C(0x6f9a5b), forest: C(0x557f45), alpine: C(0x9aae72),
  rock: C(0xa3a2b0), rockDark: C(0x86889c), snow: C(0xfafcff), snowShade: C(0xdde7f3), sand: C(0xe6d3a0), bed: C(0x3f86b8),
  haze: C(0xc9dcee), soil: C(0x86593a),
};

function terrainGeometry(nx: number, nz: number): BufferGeometry {
  const pos: number[] = [], col: number[] = [];
  const hx = (i: number) => -HALF_W + (i / nx) * 2 * HALF_W;
  const hz = (j: number) => -HALF_D + (j / nz) * 2 * HALF_D;
  const H: number[][] = [];
  for (let i = 0; i <= nx; i++) { H[i] = []; for (let j = 0; j <= nz; j++) H[i][j] = heightAt(hx(i), hz(j)); }
  const c = new Color();
  const face = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number) => {
    pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    // Face normal (y component) for slope; colour by height, slope and distance.
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nX = uy * vz - uz * vy, nY = uz * vx - ux * vz, nZ = ux * vy - uy * vx;
    const flat = nY / Math.hypot(nX, nY, nZ);
    const x = (ax + bx + cx) / 3, y = (ay + by + cy) / 3, z = (az + bz + cz) / 3;
    const n = noise(x * 40, z * 40), e = lakeE(x, z);
    if (y < WATER_Y + 0.0005 && e < 1.2) c.copy(COL.sand).lerp(COL.bed, smooth(-0.003, -0.009, y));
    else if (y < 0.002 && e < 1.3) c.copy(COL.sand).lerp(COL.meadow, smooth(1.1, 1.3, e));
    else if (z > lakeZ(x)) c.copy(COL.meadow).lerp(COL.meadowAlt, n);
    else {
      const snowLine = 0.115 + 0.04 * noise(x * 30, z * 30);
      if (y > snowLine && flat > 0.3) c.copy(COL.snow).lerp(COL.snowShade, smooth(0.7, 0.4, flat));
      else if (y > 0.095) c.copy(COL.rock).lerp(COL.rockDark, n);
      else if (y > 0.06) c.copy(COL.alpine).lerp(COL.rock, smooth(0.06, 0.095, y) * (0.5 + n * 0.5));
      else c.copy(COL.hill).lerp(COL.forest, n);
      c.lerp(COL.haze, 0.35 * smooth(-0.18, -0.34, z));
    }
    for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
  };
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const x0 = hx(i), x1 = hx(i + 1), z0 = hz(j), z1 = hz(j + 1);
    const a = H[i][j], b = H[i + 1][j], cc = H[i][j + 1], d = H[i + 1][j + 1];
    face(x0, a, z0, x0, cc, z1, x1, b, z0);
    face(x1, b, z0, x0, cc, z1, x1, d, z1);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

/** Soil walls around the diorama so it reads as a cut-out block of land. */
function skirtGeometry(steps: number): BufferGeometry {
  const pos: number[] = [];
  const edge = (fx: (t: number) => number, fz: (t: number) => number) => {
    for (let k = 0; k < steps; k++) {
      const x0 = fx(k / steps), z0 = fz(k / steps), x1 = fx((k + 1) / steps), z1 = fz((k + 1) / steps);
      const h0 = heightAt(x0, z0), h1 = heightAt(x1, z1);
      pos.push(x0, h0, z0, x0, BASE, z0, x1, h1, z1, x1, h1, z1, x0, BASE, z0, x1, BASE, z1);
    }
  };
  const lerpX = (t: number) => -HALF_W + t * 2 * HALF_W, lerpZ = (t: number) => -HALF_D + t * 2 * HALF_D;
  edge(lerpX, () => HALF_D);
  edge(lerpX, () => -HALF_D);
  edge(() => -HALF_W, lerpZ);
  edge(() => HALF_W, lerpZ);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

export interface Landscape {
  group: Group;
  /** Shared blob-shadow material for characters and props standing on the meadow. */
  shadowMaterial: MeshBasicMaterial;
  update(t: number): void;
  /** Hides grass tufts and flowers inside the rectangle (e.g. under the chronicle book); returns a restore function. */
  clearArea(x0: number, z0: number, x1: number, z1: number): () => void;
  dispose(): void;
}

export function buildLandscape(quality: Quality): Landscape {
  const lite = quality === 'lite';
  const group = new Group();
  group.name = 'landscape';
  const materials: Material[] = [];
  const own = <M extends Material>(m: M) => (materials.push(m), m);
  const lambert = (color: number, extra: Partial<MeshLambertMaterial> = {}) => own(new MeshLambertMaterial({ color, flatShading: true, ...extra }));
  const dummy = new Object3D();
  const random = rng(2027);

  // ---- terrain + water
  const terrain = new Mesh(terrainGeometry(lite ? 70 : 104, lite ? 48 : 72), own(new MeshLambertMaterial({ vertexColors: true, flatShading: true })));
  terrain.name = 'terrain';
  const skirt = new Mesh(skirtGeometry(lite ? 40 : 70), lambert(0x86593a, { side: DoubleSide }));
  group.add(terrain, skirt);

  const waterGeo = new PlaneGeometry(0.86, 0.18, lite ? 24 : 48, lite ? 6 : 10);
  waterGeo.rotateX(-Math.PI / 2);
  const water = new Mesh(waterGeo, own(new MeshPhongMaterial({
    color: 0x3f8fd0, specular: 0x5a7486, shininess: 90, flatShading: true, transparent: true, opacity: 0.8,
  })));
  water.position.set(0, WATER_Y, -0.165);
  water.name = 'lake';
  group.add(water);
  const waterBase = Float32Array.from(waterGeo.attributes.position.array);

  // ---- fir forest on the foothills (one instanced draw call)
  const firGeo = mergeGeometries([
    new ConeGeometry(0.011, 0.026, 6).translate(0, 0.019, 0),
    new ConeGeometry(0.0085, 0.02, 6).translate(0, 0.031, 0),
    new CylinderGeometry(0.0018, 0.0022, 0.008, 4).translate(0, 0.004, 0),
  ])!;
  const firCount = lite ? 70 : 150;
  const firs = new InstancedMesh(firGeo, lambert(0xffffff), firCount);
  const firShades = [0x3f6e3a, 0x4b7d40, 0x36603a, 0x557f45].map(C);
  const village = { x0: 0.07, x1: 0.33 };
  let placed = 0;
  for (let tries = 0; placed < firCount && tries < 6000; tries++) {
    const x = (random() - 0.5) * 2 * (HALF_W - 0.02), z = -HALF_D + 0.01 + random() * 0.2;
    const h = heightAt(x, z);
    const slope = Math.abs(heightAt(x + 0.01, z) - h) + Math.abs(heightAt(x, z + 0.01) - h);
    const nearVillage = x > village.x0 && x < village.x1 && z > lakeZ(x) - lakeR(x) - 0.06;
    if (z > lakeZ(x) - 0.02 || lakeE(x, z) < 1.35 || h < 0.004 || h > 0.1 || slope > 0.012 || nearVillage) continue;
    const s = (0.7 + random() * 0.55) * (1 - h * 2.5);
    dummy.position.set(x, h - 0.001, z);
    dummy.rotation.set(0, random() * 6, 0);
    dummy.scale.set(s, s * (0.9 + random() * 0.3), s);
    dummy.updateMatrix();
    firs.setMatrixAt(placed, dummy.matrix);
    firs.setColorAt(placed, firShades[placed % firShades.length]);
    placed++;
  }
  firs.count = placed;
  group.add(firs);

  // ---- village with a church on the far shore
  const houses: Array<[number, number]> = [[0.1, 0], [0.155, -0.015], [0.205, 0.004], [0.27, -0.01], [0.31, 0.006]];
  houses.forEach(([x, dz], i) => {
    const z = lakeZ(x) - lakeR(x) - 0.03 + dz;
    const hs = house(i + 2);
    hs.scale.setScalar(0.42);
    hs.position.set(x, heightAt(x, z) - 0.001, z);
    hs.rotation.y = (random() - 0.5) * 0.4;
    group.add(hs);
  });
  const churchX = 0.235, churchZ = lakeZ(churchX) - lakeR(churchX) - 0.055;
  const church = clockTower();
  church.scale.setScalar(0.38);
  church.position.set(churchX, heightAt(churchX, churchZ) - 0.001, churchZ);
  group.add(church);

  // ---- wooden jetty and a sailing boat
  const wood = lambert(0x9a6a40);
  const jetty = new Group();
  const jx = -0.3, jz0 = lakeZ(jx) + lakeR(jx) * 1.25;
  const deck = new Mesh(new BoxGeometry(0.022, 0.003, 0.065), wood);
  deck.position.set(0, 0.003, -0.03);
  jetty.add(deck);
  const postGeo = new CylinderGeometry(0.0018, 0.0018, 0.016, 5);
  for (const [px, pz] of [[-0.01, -0.012], [0.01, -0.012], [-0.01, -0.058], [0.01, -0.058]]) {
    const p = new Mesh(postGeo, wood);
    p.position.set(px, -0.004, pz);
    jetty.add(p);
  }
  jetty.position.set(jx, 0, jz0);
  group.add(jetty);

  const boat = new Group();
  const hull = new Mesh(new BoxGeometry(0.036, 0.007, 0.013), lambert(0xb5603a));
  hull.position.y = 0.002;
  const keel = new Mesh(new BoxGeometry(0.028, 0.004, 0.009), lambert(0x8a4528));
  keel.position.y = -0.003;
  const mast = new Mesh(new CylinderGeometry(0.0008, 0.0008, 0.05, 4), wood);
  mast.position.set(0.002, 0.03, 0);
  const sailGeo = new BufferGeometry();
  sailGeo.setAttribute('position', new Float32BufferAttribute([0.003, 0.008, 0, 0.003, 0.053, 0, -0.021, 0.009, 0, 0.004, 0.05, 0, 0.004, 0.012, 0, 0.018, 0.012, 0], 3));
  sailGeo.computeVertexNormals();
  const sail = new Mesh(sailGeo, lambert(0xfdf8ec, { side: DoubleSide }));
  const flag = new Mesh(new BoxGeometry(0.008, 0.006, 0.0006), lambert(0xd52b1e));
  flag.position.set(-0.002, 0.052, 0);
  boat.add(hull, keel, mast, sail, flag);
  boat.scale.setScalar(1.15);
  group.add(boat);

  // ---- two swans near the meadow shore
  const swans: Group[] = [];
  const white = lambert(0xfbfbf7), beak = lambert(0xf08a24);
  for (let i = 0; i < 2; i++) {
    const swan = new Group();
    const body = new Mesh(new IcosahedronGeometry(0.0065, 0), white);
    body.scale.set(1.5, 0.8, 1);
    const neck = new Mesh(new CylinderGeometry(0.0013, 0.0018, 0.012, 4), white);
    neck.position.set(0.006, 0.007, 0);
    neck.rotation.z = -0.25;
    const head = new Mesh(new IcosahedronGeometry(0.0025, 0), white);
    head.position.set(0.008, 0.013, 0);
    const bill = new Mesh(new ConeGeometry(0.0012, 0.004, 4), beak);
    bill.rotation.z = -Math.PI / 2;
    bill.position.set(0.011, 0.0125, 0);
    swan.add(body, neck, head, bill);
    swan.scale.setScalar(i ? 0.85 : 1);
    group.add(swan);
    swans.push(swan);
  }

  // ---- meadow: grass tufts, wild flowers, stones, bushes, fence
  const onMeadow = (x: number, z: number) => z > lakeZ(x) + 0.02 && lakeE(x, z) > 1.45;
  const inActionArea = (x: number, z: number) => x > -0.4 && x < 0.24 && z > -0.075 && z < 0.17;
  const tuftGeo = mergeGeometries([0, 1, 2].map((k) => new ConeGeometry(0.0016, 0.016 + k * 0.003, 3).translate(0, 0.008 + k * 0.0015, 0).rotateZ((k - 1) * 0.35).rotateY(k * 2.1)))!;
  const tuftCount = lite ? 110 : 260;
  const tufts = new InstancedMesh(tuftGeo, lambert(0xffffff), tuftCount);
  const grassShades = [0x6fa045, 0x7fb04e, 0x5f913d, 0x8cbc58].map(C);
  const flowerGeo = new IcosahedronGeometry(0.0034, 0);
  const flowerCount = lite ? 70 : 170;
  const flowers = new InstancedMesh(flowerGeo, lambert(0xffffff), flowerCount);
  const flowerShades = [0xffffff, 0xffffff, 0xf5d33f, 0xe8546b, 0xb07ad8, 0x6c9ee8].map(C);
  const scatter = (mesh: InstancedMesh, count: number, shades: Color[], y: number, scale: () => number, actionDensity: number) => {
    let n = 0;
    for (let tries = 0; n < count && tries < count * 30; tries++) {
      const x = (random() - 0.5) * 2 * (HALF_W - 0.015), z = -0.12 + random() * (HALF_D + 0.1);
      if (!onMeadow(x, z) || (inActionArea(x, z) && random() > actionDensity)) continue;
      const s = scale();
      dummy.position.set(x, heightAt(x, z) + y * s, z);
      dummy.rotation.set(0, random() * 6, 0);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      mesh.setMatrixAt(n, dummy.matrix);
      mesh.setColorAt(n, shades[n % shades.length]);
      n++;
    }
    mesh.count = n;
    group.add(mesh);
  };
  scatter(tufts, tuftCount, grassShades, 0, () => 0.7 + random() * 0.7, 0.12);
  scatter(flowers, flowerCount, flowerShades, 0.0045, () => 0.8 + random() * 0.5, 0.05);

  const stoneGeo = new IcosahedronGeometry(0.01, 0);
  const stoneMat = lambert(0xa9a49a);
  for (const [x, z, s] of [[-0.46, 0.27, 1.2], [-0.43, 0.3, 0.7], [0.45, 0.12, 1], [0.2, -0.085, 0.8], [-0.08, -0.095, 0.6], [0.36, -0.08, 0.9]]) {
    const st = new Mesh(stoneGeo, stoneMat);
    st.position.set(x, heightAt(x, z) + 0.002, z);
    st.scale.set(s * 1.2, s * 0.6, s);
    st.rotation.y = x * 9;
    group.add(st);
  }
  const bushMat = lambert(0x4f8a3e), bushMatLight = lambert(0x66a04a);
  for (const [x, z, s] of [[-0.47, -0.06, 1.1], [0.47, 0.25, 1], [0.3, 0.3, 0.8], [-0.2, 0.31, 0.9], [0.47, -0.05, 0.9]]) {
    for (let k = 0; k < 3; k++) {
      const b = new Mesh(new IcosahedronGeometry(0.013 * s * (1 - k * 0.2), 1), k ? bushMatLight : bushMat);
      b.position.set(x + (k - 1) * 0.012 * s, heightAt(x, z) + 0.008 * s, z + (k % 2) * 0.006);
      group.add(b);
    }
  }

  // Rustic fence along the front-right corner.
  const fence = new Group();
  const railGeo = new BoxGeometry(0.0025, 0.0025, 0.05);
  const fencePost = new BoxGeometry(0.004, 0.024, 0.004);
  for (let k = 0; k < 4; k++) {
    const p = new Mesh(fencePost, wood);
    p.position.set(0, 0.012, k * 0.045);
    fence.add(p);
    if (k < 3) for (const y of [0.009, 0.018]) {
      const r = new Mesh(railGeo, wood);
      r.position.set(0, y, k * 0.045 + 0.0225);
      fence.add(r);
    }
  }
  fence.position.set(0.3, heightAt(0.3, 0.17), 0.17);
  fence.rotation.y = 1.25;
  group.add(fence);

  // ---- sky life: clouds, birds, butterflies
  const cloudMat = own(new MeshLambertMaterial({ color: 0xffffff, flatShading: true, emissive: 0x9fb4c8, emissiveIntensity: 0.35 }));
  const clouds: Group[] = [];
  const cloudCount = lite ? 3 : 5;
  for (let i = 0; i < cloudCount; i++) {
    const cloud = new Group();
    const puffs = 4 + (i % 3);
    for (let k = 0; k < puffs; k++) {
      const r = 0.016 + random() * 0.014;
      const p = new Mesh(new IcosahedronGeometry(r, 1), cloudMat);
      p.position.set((k - puffs / 2) * 0.017, Math.sin((k / (puffs - 1)) * Math.PI) * 0.01, (random() - 0.5) * 0.012);
      p.scale.y = 0.75;
      cloud.add(p);
    }
    cloud.position.set(-0.55 + (i / cloudCount) * 1.1, 0.29 + random() * 0.09, -0.26 - random() * 0.08);
    cloud.userData.speed = 0.004 + random() * 0.004;
    group.add(cloud);
    clouds.push(cloud);
  }

  const wingGeo = new BoxGeometry(0.012, 0.0008, 0.0035);
  const birdMat = lambert(0x3b3f4f);
  const birds: Array<{ g: Group; l: Mesh; r: Mesh; phase: number }> = [];
  for (let i = 0; i < 3; i++) {
    const g = new Group();
    const l = new Mesh(wingGeo, birdMat), r = new Mesh(wingGeo, birdMat);
    l.position.x = -0.006;
    r.position.x = 0.006;
    g.add(l, r);
    group.add(g);
    birds.push({ g, l, r, phase: i * 2.1 });
  }

  const butterflies: Array<{ g: Group; l: Group; r: Group; phase: number; cx: number; cz: number }> = [];
  const bfWing = new BufferGeometry();
  bfWing.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0.009, 0, 0.006, 0.008, 0, -0.005], 3));
  bfWing.computeVertexNormals();
  [[0xffd23f, -0.3, 0.24], [0xff8c42, 0.3, 0.12], [0xffffff, 0.05, 0.27]].forEach(([color, cx, cz], i) => {
    const m = lambert(color, { side: DoubleSide });
    const g = new Group();
    const l = new Group(), r = new Group();
    l.add(new Mesh(bfWing, m));
    const rw = new Mesh(bfWing, m);
    rw.scale.x = -1;
    r.add(rw);
    g.add(l, r);
    g.scale.setScalar(0.9);
    group.add(g);
    butterflies.push({ g, l, r, phase: i * 1.7, cx, cz });
  });

  const shadowMaterial = own(new MeshBasicMaterial({ color: 0x2c3d1d, transparent: true, opacity: 0.2, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));

  const update = (t: number) => {
    // Water: two crossing wave trains; flat shading turns them into glittering facets.
    const p = waterGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = waterBase[i * 3], z = waterBase[i * 3 + 2];
      p.setY(i, 0.00035 * Math.sin(x * 46 + t * 1.6) + 0.00025 * Math.sin(z * 70 - t * 1.2 + x * 17));
    }
    p.needsUpdate = true;
    waterGeo.computeVertexNormals();

    // Boat sails a slow loop around the lake, heeling and bobbing.
    const w = t * 0.07;
    const bx = 0.25 * Math.cos(w), bz = lakeZ(bx) - 0.012 + 0.02 * Math.sin(w);
    boat.position.set(bx, WATER_Y + 0.001 + 0.0008 * Math.sin(t * 2.1), bz);
    boat.rotation.set(0.05 * Math.sin(t * 1.7), Math.atan2(-0.25 * Math.sin(w), 0.02 * Math.cos(w)) - Math.PI / 2, 0.08 + 0.04 * Math.sin(t * 1.3));

    swans.forEach((s, i) => {
      const a = t * 0.12 + i * 0.6;
      const sx = 0.08 + 0.06 * Math.sin(a) + i * 0.03, sz = lakeZ(sx) + 0.025 + 0.008 * Math.cos(a) - i * 0.012;
      s.position.set(sx, WATER_Y + 0.003 + 0.0004 * Math.sin(t * 2 + i), sz);
      s.rotation.y = Math.atan2(0.06 * Math.cos(a), 0.008 * Math.sin(a)) - Math.PI / 2 + Math.PI;
    });

    clouds.forEach((c) => {
      c.position.x += c.userData.speed * 0.016;
      if (c.position.x > 0.62) c.position.x = -0.62;
    });

    birds.forEach((b, i) => {
      const a = t * 0.35 + b.phase;
      b.g.position.set(-0.05 + 0.2 * Math.cos(a), 0.2 + 0.015 * Math.sin(a * 2) + i * 0.012, -0.2 + 0.06 * Math.sin(a));
      b.g.rotation.y = -a;
      const flap = Math.sin(t * 9 + b.phase * 3) * 0.6;
      b.l.rotation.z = flap;
      b.r.rotation.z = -flap;
    });

    butterflies.forEach((b) => {
      const a = t * 0.55 + b.phase;
      b.g.position.set(b.cx + 0.05 * Math.sin(a), 0.03 + 0.012 * Math.sin(a * 3.1), b.cz + 0.03 * Math.sin(a * 1.4));
      b.g.rotation.y = a + Math.PI / 2;
      const flap = 0.2 + Math.abs(Math.sin(t * 14 + b.phase)) * 1.1;
      b.l.rotation.z = flap;
      b.r.rotation.z = -flap;
    });
  };
  update(0);

  const clearArea = (x0: number, z0: number, x1: number, z1: number) => {
    const saved: Array<[InstancedMesh, number, Matrix4]> = [];
    const m = new Matrix4();
    const hidden = new Matrix4().makeScale(0, 0, 0);
    for (const mesh of [tufts, flowers]) {
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m);
        const x = m.elements[12], z = m.elements[14];
        if (x < x0 || x > x1 || z < z0 || z > z1) continue;
        saved.push([mesh, i, m.clone()]);
        mesh.setMatrixAt(i, hidden);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    return () => {
      saved.forEach(([mesh, i, matrix]) => mesh.setMatrixAt(i, matrix));
      tufts.instanceMatrix.needsUpdate = true;
      flowers.instanceMatrix.needsUpdate = true;
    };
  };

  return {
    group,
    shadowMaterial,
    update,
    clearArea,
    dispose() {
      group.removeFromParent();
      group.traverse((o) => { if (o instanceof Mesh) o.geometry.dispose(); });
      materials.forEach((m) => m.dispose());
    },
  };
}
