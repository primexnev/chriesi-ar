import {
  BoxGeometry,
  type BufferGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  ConeGeometry,
  Curve,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Object3D,
} from 'three';
import type { Models } from '../scenes/shared/models';
import { PALETTE } from '../scenes/shared/palette';
import { card, cherry, cherryTree, clockTower, fountain, house, mat, mesh, patch, ribbon, rng, startArch, stoneBridge } from '../scenes/shared/placeholders';

/*
 * The journey map: a small Zug, in metres (y up, +z towards the reader), seen whole from above
 * and larger than the printed spread. Our GLB models stand in for the placeholders wherever
 * they exist (Models.get fits them onto the placeholder's size).
 *
 *   Kolinplatz (front middle)  town square: Zytturm, Kolin fountain, chapel, start arch
 *   Altstadt lane              rows of houses, the street climbs out of town to the east
 *   Zugerberg (back right)     cherry orchards at its foot, the ridge behind the board
 *   Lorze stream and mill      the path crosses the stream on a stone bridge
 *   Seepromenade (left)        along the shore of Lake Zug, the Alps beyond the lake
 *   Landsgemeindeplatz         on the lake: Chriesimärt stalls and the Chriesi-Chuchi (finish)
 *
 * Not a map of Zug, but its parts in the right places: the lake to the west, the old town on
 * the shore, the Zugerberg with its cherry trees to the east.
 */
/** Layout spread: the town is drawn at 1.5× its first size so houses and squares have room. */
const F = 1.5;
export const MAP_HALF_W = 24 * F;
export const MAP_HALF_D = 16 * F;

/** The race: from Kolinplatz through the Altstadt, up to the orchards, back down to the lake. */
const PATH: Array<[number, number]> = [
  [5 * F, 11.5 * F], // Kolinplatz
  [8.5 * F, 8 * F],
  [10.5 * F, 3.5 * F], // Altstadt lane
  [12.5 * F, -1.5 * F],
  [17 * F, -4.5 * F], // out of town, to the orchards
  [21 * F, -9 * F],
  [18 * F, -13.5 * F],
  [11 * F, -12.5 * F],
  [5 * F, -8.5 * F], // down past the mill, over the Lorze
  [-1.5 * F, -4 * F],
  [-5 * F, 0 * F], // the lakeshore
  [-5.8 * F, 5 * F], // Seepromenade
  [-3.5 * F, 9.5 * F], // Landsgemeindeplatz
];
const PATH_WIDTH = 2.6;
const STREAM: Array<[number, number]> = [
  [5 * F, -16 * F],
  [3.5 * F, -11.5 * F],
  [1.5 * F, -7 * F],
  [-3 * F, -6.5 * F],
  [-9.5 * F, -7 * F],
];
const shoreX = (z: number) => (-8.6 + Math.sin((z / F) * 0.28) * 1.1) * F;

/** Named places along the path (metres from the start) where the game stops for a gesture. */
export interface Stops {
  crate: number;
  garland: number;
  cart: number;
  gate: number;
  tree: number;
  log: number;
  bridge: number;
  cat: number;
}

/** Skin tones, hair colours and clothes for the villagers: the town is everyone's town. */
const SKIN = [0xf6d5b8, 0xe8b48c, 0xc98e5d, 0x9c6239, 0x6b4126, 0x4a2c1a];
const HAIR = [0x2b1d14, 0x5a3a22, 0xd9a441, 0x1c1c22, 0xb0b0b0, 0x8c3b22];
const CLOTHES = [PALETTE.zugBlue, PALETTE.cherry, PALETTE.leaf, 0xf2b134, 0x8e5bb5, 0x2a9d8f, 0xe76f51];

export interface Villager {
  root: Group;
  arm: Object3D;
  phase: number;
}

export interface JourneyWorld {
  root: Group;
  path: CatmullRomCurve3;
  length: number;
  stops: Stops;
  /** The Chriesi-Chuchi at the end of the path; its front faces the path. */
  finish: Object3D;
  /** The tree the child picks from, on the walker's right beside the path. */
  tree: Group;
  /** The Zytturm, whose bell starts the race. */
  tower: Object3D;
  /** Extra height of the path at `s` (the bridge deck). */
  heightAt(s: number): number;
  /** Spots beside the path, facing it: the cheering children stand here (journey.ts). */
  roadside: Array<{ x: number; z: number; ry: number }>;
  update(dt: number, t: number): void;
}

/** A villager in metres: body, head, hair; one in a wheelchair, some children. */
export function villager(seed: number, opts: { wheelchair?: boolean; child?: boolean } = {}): Villager {
  const r = rng(seed * 97 + 11);
  const skin = SKIN[seed % SKIN.length];
  const hair = HAIR[Math.floor(r() * HAIR.length)];
  const cloth = CLOTHES[Math.floor(r() * CLOTHES.length)];
  const root = new Group();
  root.name = 'villager';
  const body = new Group();
  root.add(body);
  const s = opts.child ? 0.72 : 1;
  const seat = opts.wheelchair ? 0.55 : 0;
  if (opts.wheelchair) {
    for (const x of [-0.38, 0.38]) {
      const wheel = mesh(new TorusGeometry(0.36, 0.05, 5, 12), 0x3c3f4a);
      wheel.rotation.y = Math.PI / 2;
      wheel.position.set(x, 0.38, 0);
      root.add(wheel);
    }
    const chair = mesh(new BoxGeometry(0.66, 0.08, 0.55), 0x3c3f4a);
    chair.position.y = seat;
    const back = mesh(new BoxGeometry(0.66, 0.6, 0.08), 0x3c3f4a);
    back.position.set(0, seat + 0.32, -0.26);
    root.add(chair, back);
  } else {
    for (const x of [-0.12, 0.12]) {
      const leg = mesh(new CylinderGeometry(0.08, 0.08, 0.8, 5), 0x34495e);
      leg.position.set(x, 0.4, 0);
      body.add(leg);
    }
  }
  const torsoY = opts.wheelchair ? seat + 0.35 : 1.1;
  const torso = mesh(new CylinderGeometry(0.22, 0.27, 0.7, 6), cloth);
  torso.position.y = torsoY;
  const head = mesh(new SphereGeometry(0.2, 7, 5), skin);
  head.position.y = torsoY + 0.56;
  const hairCap = mesh(new SphereGeometry(0.215, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), hair);
  hairCap.position.y = torsoY + 0.6;
  body.add(torso, head, hairCap);
  if (r() < 0.35) {
    const back = mesh(new BoxGeometry(0.36, 0.42, 0.14), r() < 0.5 ? hair : cloth);
    back.position.set(0, torsoY + 0.42, -0.14);
    body.add(back);
  }
  const armGeo = new CylinderGeometry(0.06, 0.06, 0.6, 5);
  const still = mesh(armGeo, cloth);
  still.position.set(-0.3, torsoY + 0.05, 0);
  still.rotation.z = 0.15;
  const arm = new Group();
  arm.position.set(0.28, torsoY + 0.3, 0);
  const armMesh = mesh(armGeo, cloth);
  armMesh.position.y = 0.3;
  const hand = mesh(new SphereGeometry(0.08, 5, 4), skin);
  hand.position.y = 0.62;
  arm.add(armMesh, hand);
  body.add(still, arm);
  root.scale.setScalar(s * 1.25);
  return { root, arm, phase: r() * Math.PI * 2 };
}

/** A stretch of the path (u0 … u1), for paving it piece by piece. */
class SubPath extends Curve<Vector3> {
  constructor(
    private readonly base: Curve<Vector3>,
    private readonly u0: number,
    private readonly u1: number,
  ) {
    super();
  }
  override getPoint(t: number, target = new Vector3()): Vector3 {
    return this.base.getPointAt(this.u0 + (this.u1 - this.u0) * t, target);
  }
}

/** Many small pieces (cobbles, pebbles) in one draw call: detail up close, calm from afar. */
function scatter(geo: BufferGeometry, items: Array<{ m: Matrix4; c: number }>): InstancedMesh {
  const im = new InstancedMesh(geo, mat(0xffffff), items.length);
  const col = new Color();
  items.forEach((it, i) => {
    im.setMatrixAt(i, it.m);
    im.setColorAt(i, col.setHex(it.c));
  });
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  return im;
}
const COBBLE = [0xcfc6b4, 0xbdb3a0, 0xd9d1c0, 0xb0a690, 0xc7b9a0, 0xa99f8c];
const PEBBLE = [0x8f7b62, 0xa08c70, 0x7d6a52];

// ---- placeholders in metres (the GLBs are fitted onto them)

const scaled = (o: Object3D, s: number) => {
  o.scale.setScalar(s);
  return o;
};

function chapel(): Group {
  const g = new Group();
  g.name = 'church';
  const nave = mesh(new BoxGeometry(5, 4.5, 8), PALETTE.cream);
  nave.position.y = 2.25;
  const roof = card([[-2.8, 0], [2.8, 0], [0, 2.6]], 8.4, PALETTE.roof);
  roof.position.set(0, 4.5, -4.2);
  const tower = mesh(new BoxGeometry(2, 9, 2), PALETTE.cream);
  tower.position.set(0, 4.5, 4.2);
  const spire = mesh(new ConeGeometry(1.5, 3.4, 4), PALETTE.zugBlue);
  spire.position.set(0, 10.7, 4.2);
  spire.rotation.y = Math.PI / 4;
  g.add(nave, roof, tower, spire);
  return g;
}

function stall(cloth: number): Group {
  const g = new Group();
  g.name = 'market_stall';
  const table = mesh(new BoxGeometry(3, 1, 1.6), PALETTE.wood);
  table.position.y = 0.5;
  g.add(table);
  for (const [x, z] of [[-1.4, -0.7], [1.4, -0.7], [-1.4, 0.7], [1.4, 0.7]]) {
    const pole = mesh(new BoxGeometry(0.12, 2.4, 0.12), PALETTE.wood);
    pole.position.set(x, 1.2, z);
    g.add(pole);
  }
  const awning = mesh(new BoxGeometry(3.4, 0.16, 2), cloth);
  awning.position.y = 2.45;
  awning.rotation.x = 0.12;
  g.add(awning);
  for (let i = 0; i < 6; i++) {
    const c = mesh(new SphereGeometry(0.16, 5, 4), PALETTE.cherry);
    c.position.set(-1 + i * 0.4, 1.12, 0.1);
    g.add(c);
  }
  return g;
}

function mill(): Group {
  const g = new Group();
  g.name = 'mill';
  const body = mesh(new BoxGeometry(4.5, 4, 4), 0xe9d6b0);
  body.position.y = 2;
  const roof = card([[-2.6, 0], [2.6, 0], [0, 2.2]], 4.4, PALETTE.roof);
  roof.position.set(0, 4, -2.2);
  const wheel = mesh(new CylinderGeometry(1.6, 1.6, 0.5, 10), PALETTE.wood);
  wheel.rotation.z = Math.PI / 2;
  wheel.position.set(2.6, 1.6, 0);
  wheel.name = 'wheel';
  g.add(body, roof, wheel);
  return g;
}

function mountains(x0: number, x1: number, snowy: boolean, seed: number): Group {
  const g = new Group();
  g.name = snowy ? 'alps' : 'zugerberg';
  const r = rng(seed);
  const n = Math.round((x1 - x0) / 4.5);
  for (let i = 0; i < n; i++) {
    const h = snowy ? 4 + r() * 3.5 : 3.5 + r() * 1.5;
    const x = x0 + (i + 0.5) * ((x1 - x0) / n);
    const m = mesh(new ConeGeometry(snowy ? 3.4 : 4.4, h, 5), snowy ? PALETTE.alpsShadow : PALETTE.ridge);
    m.position.set(x, h / 2, r() * 1.5);
    m.rotation.y = r() * 3;
    g.add(m);
    if (snowy) {
      const cap = mesh(new ConeGeometry(1.2, h * 0.32, 5), PALETTE.alps);
      cap.position.set(x, h * 0.84, m.position.z);
      cap.rotation.y = m.rotation.y;
      g.add(cap);
    }
  }
  return g;
}

export function buildJourneyWorld(models: Models, seed = 7, roadsideVillagers = true): JourneyWorld {
  const root = new Group();
  root.name = 'journey';
  const r = rng(seed);
  const path = new CatmullRomCurve3(PATH.map(([x, z]) => new Vector3(x, 0, z)), false, 'centripetal');
  const length = path.getLength();
  const N = 300;
  const samples = path.getSpacedPoints(N);
  const distToPath = (x: number, z: number) => Math.min(...samples.map((p) => Math.hypot(p.x - x, p.z - z)));
  /** Metres along the path of the point nearest to (x, z). */
  const sNear = (x: number, z: number) => {
    let best = 0;
    samples.forEach((p, i) => {
      if (Math.hypot(p.x - x, p.z - z) < Math.hypot(samples[best].x - x, samples[best].z - z)) best = i;
    });
    return (best / N) * length;
  };
  const inLake = (x: number, z: number, pad = 1.2) => x < shoreX(z) + pad;
  const stream = new CatmullRomCurve3(STREAM.map(([x, z]) => new Vector3(x, 0, z)));
  const streamPts = stream.getSpacedPoints(120);
  const inStream = (x: number, z: number, pad = 1.2) => streamPts.some((p) => Math.hypot(p.x - x, p.z - z) < pad + 0.8);
  const faceThePath = (o: Object3D) => {
    const p = path.getPointAt(sNear(o.position.x, o.position.z) / length);
    o.rotation.y = Math.atan2(p.x - o.position.x, p.z - o.position.z);
  };
  /** Rotation that lays an object's local x along the path at `s` (bridges). */
  const alongPath = (s: number) => {
    const t = path.getTangentAt(s / length);
    return Math.atan2(-t.z, t.x);
  };
  const occupied: Array<[number, number, number]> = [];
  const free = (x: number, z: number, rad: number) =>
    Math.abs(x) < MAP_HALF_W - rad &&
    Math.abs(z) < MAP_HALF_D - rad &&
    distToPath(x, z) > rad + PATH_WIDTH / 2 + 0.3 &&
    !inLake(x, z, rad) &&
    !inStream(x, z, rad) &&
    occupied.every(([ox, oz, or]) => Math.hypot(ox - x, oz - z) > or + rad);
  const put = (o: Object3D, x: number, z: number, rad: number) => {
    o.position.set(x, 0, z);
    root.add(o);
    occupied.push([x, z, rad]);
    return o;
  };

  // ---- the board: a meadow plate with a darker rim, larger than the paper
  const plate = mesh(new BoxGeometry(MAP_HALF_W * 2, 0.8, MAP_HALF_D * 2), PALETTE.meadow);
  plate.position.y = -0.4;
  const rim = mesh(new BoxGeometry(MAP_HALF_W * 2 + 0.6, 0.7, MAP_HALF_D * 2 + 0.6), PALETTE.leafDark);
  rim.position.y = -0.5;
  root.add(plate, rim);

  // ---- Lake Zug on the west side, the Alps beyond it, the Zugerberg behind the orchards
  const shore: Array<[number, number]> = [];
  for (let z = MAP_HALF_D; z >= -MAP_HALF_D; z -= 1) shore.push([shoreX(z), -z]);
  const lake = card([[-MAP_HALF_W, -MAP_HALF_D], ...shore, [-MAP_HALF_W, MAP_HALF_D]], 0.05, PALETTE.lake);
  lake.rotation.x = -Math.PI / 2;
  lake.position.y = 0.02;
  root.add(lake);
  const alps = models.get('alps', () => mountains(-MAP_HALF_W, 0, true, 3));
  alps.position.set(0, 0, -MAP_HALF_D - 2.6);
  const ridge = models.get('zugerberg', () => mountains(0, MAP_HALF_W, false, 5));
  ridge.position.set(0, 0, -MAP_HALF_D - 2.2);
  root.add(alps, ridge);
  const boats: Object3D[] = [];
  const BOATS: Array<[number, number, number]> = [
    [-27, -12, 1.4], [-22.5, 0, 1.1], [-18, 12, 1.6], [-31, 6, -0.6], [-25, -20, 2.2], [-30, 18, 0.4],
  ];
  for (let i = 0; i < BOATS.length; i++) {
    const boat = new Group();
    const hull = mesh(new BoxGeometry(1.6, 0.35, 0.7), PALETTE.wood);
    hull.position.y = 0.18;
    const sail = mesh(new ConeGeometry(0.6, 1.6, 3), PALETTE.cream);
    sail.position.y = 1.1;
    boat.add(hull, sail);
    boat.position.set(BOATS[i][0], 0, BOATS[i][1]);
    boat.rotation.y = BOATS[i][2];
    boat.userData.bob = i;
    root.add(boat);
    boats.push(boat);
  }
  for (let i = 0; i < 3; i++) {
    const swan = mesh(new SphereGeometry(0.3, 5, 4), 0xffffff);
    swan.scale.set(1.4, 0.8, 0.9);
    swan.position.set(-11.5 * F - 1 - i * 0.9, 0.15, 4 * F + i * 0.7);
    root.add(swan);
  }

  // ---- the Lorze stream from the Zugerberg into the lake, a mill on its bank
  root.add(ribbon(stream, 1.5, PALETTE.lake, 80, 0.03));
  let bridgeS = 0;
  {
    let best = Infinity;
    samples.forEach((p, i) => {
      for (const q of streamPts) {
        const d = Math.hypot(p.x - q.x, p.z - q.z);
        if (d < best) {
          best = d;
          bridgeS = (i / N) * length;
        }
      }
    });
  }
  const bp = path.getPointAt(bridgeS / length);
  const bridge = models.get('bridge', () => scaled(stoneBridge(0.17, 0.03, 0.03), 32));
  bridge.position.set(bp.x, 0, bp.z);
  bridge.rotation.y = alongPath(bridgeS);
  root.add(bridge);
  occupied.push([bp.x, bp.z, 3]);
  put(models.get('mill', mill), -1.2 * F, -10.5 * F, 3.2);

  // ---- ground: paving for Kolinplatz and Landsgemeindeplatz, then the path on top
  const kolin = patch(6.5 * F, 5 * F, PALETTE.stone, 3);
  kolin.position.set(5 * F, 0.03, 9.5 * F);
  const landsgemeinde = patch(5 * F, 4 * F, PALETTE.stone, 4);
  landsgemeinde.position.set(-3 * F, 0.03, 10.5 * F);
  root.add(kolin, landsgemeinde);

  // ---- the path: cobblestones in the old town and on the promenade, a dirt track in between
  const townEnd = sNear(13.5 * F, -2.6 * F);
  const promenade = sNear(-2.6 * F, -3.2 * F);
  const segments: Array<[number, number, boolean]> = [
    [0, townEnd, true],
    [townEnd, promenade, false],
    [promenade, length, true],
  ];
  for (const [s0, s1, stone] of segments) {
    const sub = new SubPath(path, s0 / length, s1 / length);
    const n = Math.max(8, Math.round((s1 - s0) / 0.5));
    root.add(
      ribbon(sub, PATH_WIDTH + 0.5, stone ? 0xa79f90 : 0x9c7a4c, n, 0.05),
      ribbon(sub, PATH_WIDTH, stone ? 0xd6cdbb : 0xc49a62, n, 0.07),
    );
  }
  // cobbles thin out into the dirt over BLEND metres, so the town ends softly
  const BLEND = 6;
  const cobbleDensity = (s: number) => Math.min(1, Math.max(0, (Math.max(townEnd - s, s - promenade) + BLEND) / (2 * BLEND)));
  const UP = new Vector3(0, 1, 0);
  const q = new Quaternion();
  const stoneAt = (x: number, y: number, z: number, yaw: number, size: number, palette: number[]) => ({
    m: new Matrix4().compose(new Vector3(x, y, z), q.setFromAxisAngle(UP, yaw), new Vector3(size, 1, size * (0.8 + r() * 0.35))),
    c: palette[Math.floor(r() * palette.length)],
  });
  const cobbles: Array<{ m: Matrix4; c: number }> = [];
  const pebbles: Array<{ m: Matrix4; c: number }> = [];
  let row = 0;
  for (let s = 0; s <= length; s += 0.5, row++) {
    const p = path.getPointAt(s / length);
    const t = path.getTangentAt(s / length);
    const yaw = Math.atan2(t.x, t.z);
    const d = cobbleDensity(s);
    for (let lat = -1.05 + (row % 2) * 0.25; lat <= 1.05; lat += 0.5) {
      if (r() < d) cobbles.push(stoneAt(p.x - t.z * lat, 0.09, p.z + t.x * lat, yaw + (r() - 0.5) * 0.25, 0.42, COBBLE));
      else if (d < 0.3 && r() < 0.06) pebbles.push(stoneAt(p.x - t.z * lat * 1.1, 0.1, p.z + t.x * lat * 1.1, r() * 6, 0.9 + r() * 0.6, PEBBLE));
    }
  }
  // both squares are cobbled too
  for (const [cx, cz, rx, rz] of [
    [5 * F, 9.5 * F, 6.5 * F * 0.82, 5 * F * 0.82],
    [-3 * F, 10.5 * F, 5 * F * 0.82, 4 * F * 0.82],
  ]) {
    for (let x = cx - rx; x <= cx + rx; x += 0.55)
      for (let z = cz - rz; z <= cz + rz; z += 0.55) {
        if (((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2 > 1 || r() < 0.12) continue;
        if (distToPath(x, z) < PATH_WIDTH / 2 + 0.2) continue;
        cobbles.push(stoneAt(x + (r() - 0.5) * 0.08, 0.05, z + (r() - 0.5) * 0.08, (r() - 0.5) * 0.2, 0.46, COBBLE));
      }
  }
  root.add(scatter(new BoxGeometry(1, 0.05, 1), cobbles), scatter(new IcosahedronGeometry(0.12, 0), pebbles));

  // ---- Kolinplatz: Zytturm, Kolin fountain, chapel, start arch
  const tower = put(models.get('clockTower', () => scaled(clockTower(), 46)), 12.2 * F, 9.6 * F, 2.4);
  faceThePath(tower);
  put(models.get('fountain', () => scaled(fountain(), 55)), 2.8 * F, 8 * F, 1.8);
  const church = put(models.get('church', () => scaled(chapel(), 0.6)), 9.8 * F, 14.2 * F, 2.6);
  faceThePath(church);
  const arch = models.get('startArch', () => scaled(startArch(), 70));
  const a0 = path.getPointAt(0.012);
  arch.position.set(a0.x, 0, a0.z);
  // the arch's poles stand along its local z: lay that across the path
  arch.rotation.y = alongPath(0.012 * length);
  root.add(arch);

  // ---- Altstadt: house rows along the lane, more houses around the squares
  const houseKeys = ['house_0', 'house_1', 'house_2'];
  let hv = 0;
  const addHouse = (x: number, z: number) => {
    if (!free(x, z, 2)) return false;
    const v = hv++;
    const h = models.get(houseKeys[v % 3], () => scaled(house(v % 5), 58));
    put(h, x, z, 2);
    faceThePath(h);
    return true;
  };
  for (let s = 0.02 * length; s < 0.22 * length; s += 3.9) {
    const p = path.getPointAt(s / length);
    const t = path.getTangentAt(s / length);
    for (const k of [-1, 1]) addHouse(p.x - t.z * k * 3.8, p.z + t.x * k * 3.8);
  }
  for (let i = 0; i < 900 && hv < 44; i++) addHouse((-6 + r() * 20) * F, (-1 + r() * 16) * F);

  // ---- Landsgemeindeplatz: the Chriesi-Chuchi at the end, Chriesimärt stalls around it
  const end = path.getPointAt(1);
  const et = path.getTangentAt(1);
  const finish = models.get('house_2', () => scaled(house(2), 90));
  finish.position.set(end.x + et.x * 5, 0, end.z + et.z * 5);
  finish.rotation.y = Math.atan2(-et.x, -et.z);
  root.add(finish);
  occupied.push([finish.position.x, finish.position.z, 4.5]);
  const sign = new Group();
  const disc = mesh(new CylinderGeometry(0.9, 0.9, 0.12, 12), PALETTE.cream);
  disc.rotation.x = Math.PI / 2;
  const fruit = mesh(new SphereGeometry(0.42, 8, 6), PALETTE.cherry);
  fruit.position.z = 0.12;
  sign.add(disc, fruit);
  sign.position.set(finish.position.x - et.x * 3.4, 6.2, finish.position.z - et.z * 3.4);
  sign.rotation.y = finish.rotation.y;
  root.add(sign);
  const stallSpots: Array<[number, number, number]> = [
    [-1 * F, 13.4 * F, PALETTE.cherry],
    [1.6 * F, 12.4 * F, PALETTE.zugBlue],
    [-0.8 * F, 6.8 * F, 0xf2b134],
    [-4.5 * F, 13.6 * F, PALETTE.leaf],
    [-6 * F, 10.6 * F, 0xf2b134],
    [-2.6 * F, 14.6 * F, PALETTE.cherry],
    [1.2 * F, 9.4 * F, PALETTE.leaf],
    [7.6 * F, 12.8 * F, PALETTE.zugBlue],
    [2 * F, 13.8 * F, 0xe76f51],
  ];
  for (const [x, z, c] of stallSpots) {
    if (!free(x, z, 1.6)) continue;
    faceThePath(put(models.get('marketStall', () => stall(c)), x, z, 1.8));
  }

  // ---- the orchards at the foot of the Zugerberg, and trees in the meadows
  const trees: Group[] = [];
  const addTree = (x: number, z: number, scale: number, withCherries: boolean) => {
    const t = cherryTree(1, Math.floor(r() * 1000));
    t.scale.setScalar(scale);
    t.position.set(x, 0, z);
    t.rotation.y = r() * 6;
    if (withCherries) {
      for (const c of t.userData.crown as Array<{ x: number; y: number; z: number; r: number }>) {
        for (let k = 0; k < 3; k++) {
          const ch = cherry();
          const a = r() * Math.PI * 2;
          const b = 0.3 + r() * 0.9;
          ch.position.set(c.x + Math.cos(a) * Math.sin(b) * c.r, c.y + Math.cos(b) * c.r * 0.9, c.z + Math.sin(a) * Math.sin(b) * c.r);
          ch.scale.setScalar(0.75);
          t.add(ch);
        }
      }
    }
    root.add(t);
    occupied.push([x, z, 1.9]);
    trees.push(t);
    return t;
  };
  const treeS = sNear(20 * F, -11.5 * F);
  const tp = path.getPointAt(treeS / length);
  const tt = path.getTangentAt(treeS / length);
  // the picking tree stands on the walker's right, just beside the path
  const tree = addTree(tp.x - tt.z * 3.3, tp.z + tt.x * 3.3, 60, true);
  // the orchard is planted in rows, as real ones are: calm to look at from any distance
  for (let gx = 3.5 * F; gx < MAP_HALF_W - 2; gx += 5.4)
    for (let gz = -MAP_HALF_D + 2.6; gz < -2 * F; gz += 5.4) {
      const x = gx + Math.sin(gz * 0.7) * 0.35;
      if (free(x, gz, 1.9)) addTree(x, gz, 42 + r() * 6, true);
    }
  // a few single trees with room around them in the meadows
  const meadowTrees = trees.length + 10;
  for (let i = 0; i < 600 && trees.length < meadowTrees; i++) {
    const x = r() * MAP_HALF_W * 2 - MAP_HALF_W;
    const z = r() * MAP_HALF_D * 2 - MAP_HALF_D;
    if ((x > -6 * F && z > -2 * F) || !free(x, z, 3.5)) continue; // not in the old town
    addTree(x, z, 36 + r() * 12, false);
  }
  // ---- a fuller countryside, all instanced (one draw call per kind): rich up close, calm from afar
  type Item = { m: Matrix4; c: number };
  const item = (x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, c: number): Item => ({
    m: new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromAxisAngle(UP, yaw), new Vector3(sx, sy, sz)),
    c,
  });
  const pick = (a: number[]) => a[Math.floor(r() * a.length)];
  const inTown = (x: number, z: number) => x > -6 * F && x < 15 * F && z > -2 * F;

  // fields: strips of wheat, rapeseed, young crops and ploughed earth in the open land
  const fieldRows: Item[] = [];
  const CROPS = [0xe9c46a, 0xf4d35e, 0xa9774a, 0xc98f5a, 0x5d9b3a];
  for (let i = 0; i < 900; i++) {
    const x = r() * MAP_HALF_W * 2 - MAP_HALF_W;
    const z = r() * MAP_HALF_D * 2 - MAP_HALF_D;
    if (inTown(x, z) || !free(x, z, 4.2)) continue;
    const crop = pick(CROPS);
    for (let k = -3; k <= 3; k++) fieldRows.push(item(x, 0.08, z + k * 1.05, 0, 7.2, 0.12, 0.75, crop));
    occupied.push([x, z, 4.2]);
  }

  // conifers: a forest belt at the foot of the mountains and along the east edge
  const firs: Item[] = [];
  const FIR = [0x2f6b3a, 0x3d7a45, 0x2a5e36, 0x4f8a4a];
  const fir = (x: number, z: number) => {
    if (!free(x, z, 1.1)) return;
    const h = 3.2 + r() * 3;
    firs.push(item(x, 0, z, r() * 6, 1.1 + r() * 0.5, h, 1.1 + r() * 0.5, pick(FIR)));
    occupied.push([x, z, 1.1]);
  };
  for (let x = -MAP_HALF_W + 1; x < MAP_HALF_W - 1; x += 1.6) for (let k = 0; k < 4; k++) fir(x + r() * 0.8, -MAP_HALF_D + 1 + k * 1.6 + r() * 0.8);
  for (let z = -MAP_HALF_D + 1; z < MAP_HALF_D - 1; z += 1.6) for (let k = 0; k < 3; k++) fir(MAP_HALF_W - 1 - k * 1.6 - r() * 0.6, z + r() * 0.8);
  for (let i = 0; i < 6; i++) {
    // small woods in the meadows
    const cx = r() * MAP_HALF_W * 2 - MAP_HALF_W;
    const cz = r() * MAP_HALF_D * 2 - MAP_HALF_D;
    if (inTown(cx, cz)) continue;
    for (let k = 0; k < 9; k++) fir(cx + (r() - 0.5) * 6, cz + (r() - 0.5) * 6);
  }

  // the dirt track gets a wooden fence and hedges, the cobbled stretches get lanterns
  const posts: Item[] = [];
  const rails: Item[] = [];
  const bushes: Item[] = [];
  const lampPosts: Item[] = [];
  const lamps: Item[] = [];
  const BUSH = [PALETTE.leafDark, 0x4f8a4a, 0x5e9b52];
  // leave the fence open where the game stops (cart, gate, picking tree, log)
  const fenceGaps = [sNear(15 * F, -3.2 * F), sNear(19.5 * F, -7 * F), treeS, sNear(8 * F, -10.6 * F)];
  for (const side of [-1, 1]) {
    let prev: Vector3 | null = null;
    for (let s = townEnd + 5; s < promenade - 4; s += 1.6) {
      const p = path.getPointAt(s / length);
      const t = path.getTangentAt(s / length);
      const x = p.x - t.z * side * 2.25;
      const z = p.z + t.x * side * 2.25;
      const blocked = Math.abs(s - bridgeS) < 5 || inStream(x, z, 0.4) || fenceGaps.some((u) => Math.abs(u - s) < 3.5);
      if (blocked) {
        prev = null;
        continue;
      }
      posts.push(item(x, 0.45, z, 0, 0.14, 0.9, 0.14, PALETTE.wood));
      if (prev) {
        const dx = x - prev.x;
        const dz = z - prev.z;
        const len = Math.hypot(dx, dz);
        for (const y of [0.35, 0.7]) rails.push(item((x + prev.x) / 2, y, (z + prev.z) / 2, Math.atan2(-dz, dx), len, 0.08, 0.06, PALETTE.wood));
      }
      prev = new Vector3(x, 0, z);
      if (r() < 0.35) {
        const bx = p.x - t.z * side * (3.1 + r() * 0.6);
        const bz = p.z + t.x * side * (3.1 + r() * 0.6);
        if (free(bx, bz, 0.5)) {
          const b = 0.6 + r() * 0.5;
          bushes.push(item(bx, b * 0.6, bz, r() * 6, b, b * 0.8, b, pick(BUSH)));
        }
      }
    }
  }
  let lampSide = 1;
  for (const [s0, s1] of [[length * 0.015, townEnd], [promenade, length * 0.985]]) {
    for (let s = s0; s < s1; s += 7, lampSide = -lampSide) {
      const p = path.getPointAt(s / length);
      const t = path.getTangentAt(s / length);
      const x = p.x - t.z * lampSide * 2.1;
      const z = p.z + t.x * lampSide * 2.1;
      if (occupied.some(([ox, oz, or]) => Math.hypot(ox - x, oz - z) < or)) continue;
      lampPosts.push(item(x, 1.1, z, 0, 0.09, 2.2, 0.09, 0x3c3f4a));
      lamps.push(item(x, 2.3, z, 0, 0.26, 0.3, 0.26, 0xffe8a3));
    }
  }

  // flowers grow in little patches, bushes here and there
  const flowers: Item[] = [];
  const BLOOM = [0xffffff, 0xf2b134, PALETTE.cherry, 0xc77dff, 0xff8fab, 0x7ec8e3];
  for (let i = 0; i < 70; i++) {
    const cx = r() * MAP_HALF_W * 2 - MAP_HALF_W;
    const cz = r() * MAP_HALF_D * 2 - MAP_HALF_D;
    if (inTown(cx, cz) || !free(cx, cz, 1.5)) continue;
    const c = pick(BLOOM);
    for (let k = 0; k < 14; k++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * 1.6;
      flowers.push(item(cx + Math.cos(a) * d, 0.18, cz + Math.sin(a) * d, 0, 1, 1, 1, r() < 0.8 ? c : 0xffffff));
    }
  }
  for (let i = 0; i < 300 && bushes.length < 110; i++) {
    const x = r() * MAP_HALF_W * 2 - MAP_HALF_W;
    const z = r() * MAP_HALF_D * 2 - MAP_HALF_D;
    if (inTown(x, z) || !free(x, z, 0.9)) continue;
    const b = 0.6 + r() * 0.5;
    bushes.push(item(x, b * 0.6, z, r() * 6, b, b * 0.8, b, pick(BUSH)));
  }

  // sheep grazing in the meadows
  const wool: Item[] = [];
  const heads: Item[] = [];
  for (let i = 0; i < 400 && wool.length < 16; i++) {
    const x = r() * MAP_HALF_W * 2 - MAP_HALF_W;
    const z = r() * MAP_HALF_D * 2 - MAP_HALF_D;
    if (inTown(x, z) || !free(x, z, 0.9)) continue;
    const yaw = r() * 6;
    wool.push(item(x, 0.6, z, yaw, 0.75, 0.6, 1, 0xf4f1ea));
    heads.push(item(x + Math.sin(yaw) * 0.75, 0.55, z + Math.cos(yaw) * 0.75, yaw, 0.3, 0.32, 0.4, 0x3a3a3a));
    occupied.push([x, z, 0.9]);
  }

  // reeds along the shore, a wooden jetty at Landsgemeindeplatz
  const reeds: Item[] = [];
  for (let z = -MAP_HALF_D + 0.5; z < MAP_HALF_D - 0.5; z += 0.35) {
    if (Math.abs(z - 10.5 * F) < 4 || r() < 0.45) continue;
    const x = shoreX(z) - 0.2 - r() * 1.1;
    const h = 0.7 + r() * 0.6;
    reeds.push(item(x, h / 2, z, 0, 0.07, h, 0.07, r() < 0.5 ? 0x7a8f3a : 0x9aa84a));
  }
  const jz = 10.5 * F;
  const jx = shoreX(jz);
  const deck = mesh(new BoxGeometry(7, 0.16, 1.4), PALETTE.wood);
  deck.position.set(jx - 3.2, 0.22, jz);
  root.add(deck);
  for (let k = 0; k < 4; k++) for (const e of [-0.6, 0.6]) posts.push(item(jx - 0.4 - k * 2.1, 0.1, jz + e, 0, 0.16, 0.5, 0.16, 0x6b4a2b));

  const unitBox = new BoxGeometry(1, 1, 1);
  const fan = new ConeGeometry(1, 1, 6);
  fan.translate(0, 0.5, 0);
  root.add(
    scatter(unitBox, fieldRows),
    scatter(fan, firs),
    scatter(unitBox, posts),
    scatter(unitBox, rails),
    scatter(unitBox, lampPosts),
    scatter(new IcosahedronGeometry(1, 0), lamps),
    scatter(new IcosahedronGeometry(1, 0), bushes),
    scatter(new IcosahedronGeometry(0.17, 0), flowers),
    scatter(new IcosahedronGeometry(1, 0), wool),
    scatter(unitBox, heads),
    scatter(unitBox, reeds),
  );

  // ---- villagers on both squares and along the way: different skin tones, ages, a wheelchair
  const villagers: Villager[] = [];
  const roadside: JourneyWorld['roadside'] = [];
  let vi = 0;
  for (const u of [0.02, 0.04, 0.07, 0.1, 0.13, 0.17, 0.24, 0.3, 0.42, 0.5, 0.6, 0.7, 0.78, 0.84, 0.89, 0.93, 0.97]) {
    const p = path.getPointAt(u);
    const t = path.getTangentAt(u);
    const k = vi % 2 ? 1 : -1;
    const x = p.x - t.z * k * (PATH_WIDTH / 2 + 0.9);
    const z = p.z + t.x * k * (PATH_WIDTH / 2 + 0.9);
    if (inLake(x, z, 0.3)) continue;
    roadside.push({ x, z, ry: Math.atan2(p.x - x, p.z - z) });
    if (!roadsideVillagers) {
      vi++; // same seeds for the people on the squares either way
      continue;
    }
    const v = villager(vi, { wheelchair: vi === 3, child: vi % 4 === 2 });
    vi++;
    v.root.position.set(x, 0, z);
    v.root.rotation.y = Math.atan2(p.x - x, p.z - z);
    root.add(v.root);
    villagers.push(v);
  }

  // people standing about on both squares, chatting in little groups
  for (let i = 0; i < 300 && vi < 30; i++) {
    const onKolin = vi % 2 === 0;
    const [cx, cz, rx, rz] = onKolin ? [5 * F, 9.5 * F, 6.5 * F * 0.8, 5 * F * 0.8] : [-3 * F, 10.5 * F, 5 * F * 0.8, 4 * F * 0.8];
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r());
    const x = cx + Math.cos(a) * rx * d;
    const z = cz + Math.sin(a) * rz * d;
    if (!free(x, z, 0.6)) continue;
    const v = villager(vi, { wheelchair: vi === 21, child: vi % 3 === 0 });
    vi++;
    v.root.position.set(x, 0, z);
    v.root.rotation.y = r() * Math.PI * 2;
    root.add(v.root);
    villagers.push(v);
    occupied.push([x, z, 0.6]);
  }

  const stops: Stops = {
    crate: sNear(9.6 * F, 6 * F),
    garland: sNear(11 * F, 1 * F),
    cart: sNear(15 * F, -3.2 * F),
    gate: sNear(19.5 * F, -7 * F),
    tree: treeS,
    log: sNear(8 * F, -10.6 * F),
    bridge: bridgeS,
    cat: sNear(-5.5 * F, 2.5 * F),
  };
  const wheel = root.getObjectByName('wheel');
  return {
    root,
    path,
    length,
    stops,
    finish,
    tree,
    tower,
    roadside,
    heightAt(s) {
      const d = Math.abs(s - bridgeS);
      return d < 3.5 ? Math.cos((d / 3.5) * (Math.PI / 2)) * 0.6 : 0;
    },
    update(dt, t) {
      for (const v of villagers) v.arm.rotation.z = -2.3 + Math.sin(t * 5 + v.phase) * 0.45;
      for (const b of boats) {
        b.position.y = Math.sin(t * 1.4 + b.userData.bob * 2) * 0.08;
        b.rotation.z = Math.sin(t * 1.1 + b.userData.bob) * 0.05;
      }
      if (wheel) wheel.rotation.x += dt * 0.8;
    },
  };
}

/** A flat pulsing ring that marks where to tap. */
export function tapRing(radius = 1.4): Mesh {
  const m = new Mesh(new TorusGeometry(radius, 0.12, 4, 24), mat(0xffffff));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.15;
  return m;
}

/** A flat shadow disc under a moving figure. */
export function shadowDisc(radius = 0.6): Mesh {
  // soft dark disc that reads on grass, dirt and cobbles alike
  const m = new Mesh(new CircleGeometry(radius, 12), new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.13;
  return m;
}
