import {
  Box3,
  BoxGeometry,
  type BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  ConeGeometry,
  Curve,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  LineCurve3,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type Material,
  MathUtils,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Models } from '../scenes/shared/models';
import { PALETTE } from '../scenes/shared/palette';
import { card, cherry, cherryTree, clockTower, fountain, house, mat, mesh, patch, ribbon, rng, starling, startArch } from '../scenes/shared/placeholders';
import { gameLadder } from './runner';

/*
 * The journey map: a small Zug, in metres (y up, +z towards the reader), seen whole from above
 * and larger than the printed spread. Our GLB models stand in for the placeholders wherever
 * they exist (Models.get fits them onto the placeholder's size).
 *
 *   Kolinplatz (front middle)  town square: Zytturm, Kolin fountain, chapel, start arch
 *   Altstadt lane              rows of houses, the street climbs out of town to the east
 *   Zugerberg (back right)     cherry orchards at its foot, the ridge behind the board
 *   mill                       below the orchards, where the path comes down to the lake
 *   Seepromenade (left)        along the shore of Lake Zug, the Alps beyond the lake
 *   Landsgemeindeplatz         on the lake: Chriesimärt stalls and the Chriesi-Chuchi (finish)
 *
 * Not a map of Zug, but its parts in the right places: the lake to the west, the old town on
 * the shore, the Zugerberg with its cherry trees to the east.
 */
/** Houses stay below this share of the Zytturm's height, so the tower rises above the roofs. */
const HOUSE_MAX = 0.55;

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
  [5 * F, -8.5 * F], // down past the mill
  [-1.5 * F, -4 * F],
  [-5 * F, 0 * F], // the lakeshore
  [-5.8 * F, 5 * F], // Seepromenade
  [-3.5 * F, 9.5 * F], // Landsgemeindeplatz
];
/** The Chriesimärt stalls on the two squares: x, z, awning colour. */
const STALL_SPOTS: Array<[number, number, number]> = [
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
/**
 * The old-town lanes (metres), parallel to the shore like Zug's Unter- and Oberaltstadt: narrow
 * cobbled gaps between long rows of houses that stand wall to wall, back to back between lanes.
 */
const OLD_TOWN_LANES: Array<[[number, number], [number, number]]> = [
  [[0.6, -3.5], [0.6, 9.5]],
  [[7.9, -4], [7.9, 8.5]],
];
/** Outline of the paved old town (x, z in metres): from the promenade to the race lane. */
const OLD_TOWN_PAVING: Array<[number, number]> = [
  [-7, -3], [11.5, -5.5], [14.8, 2], [13.5, 9], [8, 8.5], [0, 10.5], [-6.5, 9], [-7.8, 3],
];
const PATH_WIDTH = 2.6;
/**
 * The places of the narrated story (Abdullah's Erzählskript) off the race path, so story and race
 * share one map: x, z and the clearing kept around each, in metres.
 */
const STORY_SPOTS = {
  /** St. Michael's church: its biggest bell is the Chriesigloggä (tracks 4, 9, 27). */
  michael: [29.5, 5, 5.6],
  /** St. Verena's chapel in the orchards, where the 1000th tree was planted (track 23): in the
   * middle of four orchard trees inside the race loop, which all keep their places. */
  verena: [18.75, -13.3, 1.8],
} as const;
/** Footpaths of the story beside the race (x, z points in metres; stone in town, dirt outside). */
const STORY_LANES: Array<{ pts: Array<[number, number]>; stone: boolean }> = [
  // Kolinplatz down to the shore of Lake Zug (track 1), past the Chriesimärt (track 30)
  { pts: [[2.5, 10.2], [-2.5, 9.8], [-7, 9.4], [-11.4, 9.2]], stone: true },
  // from the end of the town up to St. Michael's church, the bell of the Chriesisturm
  { pts: [[19.6, -2.4], [22.5, -0.6], [25.4, 1.8]], stone: false },
  // from the race path into the orchard, between two rows of trees, to St. Verena's chapel
  { pts: [[18.75, -18.9], [18.75, -15.3]], stone: false },
];
const shoreX = (z: number) => (-8.6 + Math.sin((z / F) * 0.28) * 1.1) * F;

/** One place of the narrated story: which tracks are told there, and where it stands. */
export interface StoryStop {
  id: 'lake' | 'michael' | 'allmend' | 'overview' | 'verena' | 'liebfrauen' | 'maert';
  title: string;
  tracks: number[];
  at: Vector3;
}

/** Named places along the path (metres from the start) where the game stops for a gesture. */
export interface Stops {
  crate: number;
  garland: number;
  cart: number;
  gate: number;
  tree: number;
  log: number;
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
  /** The Zytturm, the tallest building of the town. */
  tower: Object3D;
  /** The building whose bell starts the race: St. Michael's church (the Zytturm without it). */
  bell: Object3D;
  /** The story's places in the order the narration visits them (Abdullah's Erzählskript): a camera
   * can go from one to the next while the tracks play. */
  storyStops: StoryStop[];
  /** Spots beside the path, facing it: the cheering children stand here (journey.ts). */
  roadside: Array<{ x: number; z: number; ry: number }>;
  /** Spots on the two squares where people stand about (our modelled children, journey.ts). */
  square: Array<{ x: number; z: number; ry: number }>;
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
  const faceThePath = (o: Object3D) => {
    const p = path.getPointAt(sNear(o.position.x, o.position.z) / length);
    o.rotation.y = Math.atan2(p.x - o.position.x, p.z - o.position.z);
  };
  /** Rotation that lays an object's local x along the path at `s` (the start arch). */
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
    occupied.every(([ox, oz, or]) => Math.hypot(ox - x, oz - z) > or + rad);
  const put = (o: Object3D, x: number, z: number, rad: number) => {
    o.position.set(x, 0, z);
    root.add(o);
    occupied.push([x, z, rad]);
    return o;
  };
  // the story's places and footpaths are kept clear before anything else is laid out
  const laneCurves = STORY_LANES.map(({ pts }) => new CatmullRomCurve3(pts.map(([x, z]) => new Vector3(x, 0, z))));
  const storyKept: Array<[number, number, number]> = [
    ...Object.values(STORY_SPOTS).map(([x, z, rad]): [number, number, number] => [x, z, rad]),
    ...laneCurves.flatMap((c) => c.getSpacedPoints(Math.ceil(c.getLength())).map((p): [number, number, number] => [p.x, p.z, 0.75])),
  ];
  occupied.push(...storyKept);

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

  // ---- the mill below the orchards
  put(models.get(models.has('zugMill') ? 'zugMill' : 'mill', mill), -1.2 * F, -10.5 * F, 3.2);

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
  // the story's footpaths: narrower, a little below the race path where they meet it
  STORY_LANES.forEach(({ stone }, i) => {
    const n = Math.max(8, Math.round(laneCurves[i].getLength() / 0.5));
    root.add(
      ribbon(laneCurves[i], 1.9, stone ? 0xa79f90 : 0x9c7a4c, n, 0.045),
      ribbon(laneCurves[i], 1.5, stone ? 0xd6cdbb : 0xc49a62, n, 0.065),
    );
  });
  // cobbles thin out into the dirt over BLEND metres, so the town ends softly
  const BLEND = 6;
  const cobbleDensity = (s: number) => Math.min(1, Math.max(0, (Math.max(townEnd - s, s - promenade) + BLEND) / (2 * BLEND)));
  const UP = new Vector3(0, 1, 0);
  const q = new Quaternion();
  /** One stone; `len` fixes its length (a laid cobble), otherwise it varies (a pebble). */
  const stoneAt = (x: number, y: number, z: number, yaw: number, size: number, palette: number[], len?: number, rand = r) => {
    const k = 0.8 + rand() * 0.35;
    return {
      m: new Matrix4().compose(new Vector3(x, y, z), q.setFromAxisAngle(UP, yaw), new Vector3(size, 1, len ?? size * k)),
      c: palette[Math.floor(rand() * palette.length)],
    };
  };
  // the cobbles are laid in tidy rows; they draw their colours from their own random numbers, and
  // `r()` is still called as often as before, so the trees and bushes laid out after them stay put
  const cr = rng(seed * 31 + 5);
  const cobbles: Array<{ m: Matrix4; c: number }> = [];
  const pebbles: Array<{ m: Matrix4; c: number }> = [];
  let row = 0;
  const ROW = 0.5;
  const sideAt = (s: number, lat: number) => {
    const u = MathUtils.clamp(s / length, 0, 1);
    const p = path.getPointAt(u);
    const t = path.getTangentAt(u);
    return new Vector3(p.x - t.z * lat, 0, p.z + t.x * lat);
  };
  for (let s = 0; s <= length; s += ROW, row++) {
    const p = path.getPointAt(s / length);
    const t = path.getTangentAt(s / length);
    const d = cobbleDensity(s);
    for (let lat = -1.05 + (row % 2) * 0.25; lat <= 1.05; lat += 0.5) {
      if (r() < d) {
        r();
        // in a bend the rows close up on the inside: each stone is as long as its own row allows
        const a = sideAt(s - ROW / 2, lat);
        const b = sideAt(s + ROW / 2, lat);
        const len = Math.min(0.42, a.distanceTo(b) - 0.08);
        const c = sideAt(s, lat);
        const stone = stoneAt(c.x, 0.09, c.z, Math.atan2(b.x - a.x, b.z - a.z), 0.42, COBBLE, Math.max(len, 0.05));
        if (len >= 0.12) cobbles.push(stone); // a bend too tight for a stone leaves the gap
      } else if (d < 0.3 && r() < 0.06) pebbles.push(stoneAt(p.x - t.z * lat * 1.1, 0.1, p.z + t.x * lat * 1.1, r() * 6, 0.9 + r() * 0.6, PEBBLE));
    }
  }
  // both squares are cobbled with the old town further down, on its one grid; this loop only
  // draws the random numbers it always drew, so the rest of the map keeps its layout
  const SQUARES = [
    [5 * F, 9.5 * F, 6.5 * F * 0.82, 5 * F * 0.82],
    [-3 * F, 10.5 * F, 5 * F * 0.82, 4 * F * 0.82],
  ];
  for (const [cx, cz, rx, rz] of SQUARES) {
    for (let x = cx - rx; x <= cx + rx; x += 0.55)
      for (let z = cz - rz; z <= cz + rz; z += 0.55) {
        if (((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2 > 1 || r() < 0.12) continue;
        if (distToPath(x, z) < PATH_WIDTH / 2 + 0.2) continue;
        for (let k = 0; k < 5; k++) r();
      }
  }
  root.add(scatter(new BoxGeometry(1, 0.05, 1), cobbles), scatter(new IcosahedronGeometry(0.12, 0), pebbles));

  // ---- Kolinplatz: Zytturm, Kolin fountain, chapel, start arch
  // the Zytturm joins the house row along the lane further down (as the real one stands in its row)
  const tower = models.get(models.has('zytturm') ? 'zytturm' : 'clockTower', () => scaled(clockTower(), 46));
  root.add(tower);
  const towerHeight = new Box3().setFromObject(tower).max.y;
  put(models.get('fountain', () => scaled(fountain(), 55)), 2.8 * F, 8 * F, 1.8);
  // the old generated chapel gives way to a low-poly Zug house once those are loaded
  // the Liebfrauenkapelle beside the start (the story's chapel); a Zug house or the old chapel without it
  const chapelKey = ['zugLiebfrauen', 'zugHouseD', 'church'].find((k) => models.has(k)) ?? 'church';
  const church = put(models.get(chapelKey, () => scaled(chapel(), 0.6)), 9.8 * F, 14.2 * F, 2.6);
  faceThePath(church);
  // the race gate: the Meshy sign with START on its board (the old striped arch without it); the
  // same sign says ZIEL at the finish (placed with the Chriesi-Chuchi below)
  const raceGate = (u: number, text: string) => {
    const gate = models.has('zugRaceSign') ? signText(models.get('zugRaceSign', () => scaled(startArch(), 70)), text) : models.get('startArch', () => scaled(startArch(), 70));
    const p = path.getPointAt(u);
    gate.position.set(p.x, 0, p.z);
    // the gate's posts stand along its local z: lay that across the path
    gate.rotation.y = alongPath(u * length);
    root.add(gate);
    return gate;
  };
  raceGate(0.012, 'START');

  // ---- St. Michael's church above the town, its door to the lane from the town (tracks 4, 9, 27):
  // the second-tallest building, below the Zytturm, and no longer than ~9 m
  let michael: Object3D | null = null;
  if (models.has('zugStMichael')) {
    const m = models.get('zugStMichael', () => new Group());
    const box = new Box3().setFromObject(m).getSize(new Vector3());
    m.scale.multiplyScalar(Math.min((0.8 * towerHeight) / box.y, 9 / Math.max(box.x, box.z)));
    const [x, z] = STORY_SPOTS.michael;
    const [ex, ez] = STORY_LANES[1].pts[STORY_LANES[1].pts.length - 1];
    m.position.set(x, 0, z);
    m.rotation.y = Math.atan2(ex - x, ez - z); // the front (+z) towards the lane's end
    root.add(m);
    michael = m;
  }
  let verena: Object3D | null = null;
  // ---- St. Verena's chapel in the orchard, its porch towards the footpath that leads to it
  if (models.has('zugStVerena')) {
    const v = models.get('zugStVerena', () => new Group());
    const box = new Box3().setFromObject(v).getSize(new Vector3());
    v.scale.multiplyScalar(5 / Math.max(box.x, box.z));
    const [x, z] = STORY_SPOTS.verena;
    const [ex, ez] = STORY_LANES[2].pts[STORY_LANES[2].pts.length - 1];
    v.position.set(x, 0, z);
    v.rotation.y = Math.atan2(ex - x, ez - z);
    root.add(v);
    verena = v;
    // the 1000th tree, planted in December 2018: a young cherry tree beside the chapel's door
    const young = cherryTree(1, 1000);
    young.scale.setScalar(17); // the orchard's grown trees stand at 36–48
    young.position.set(x - 2.2, 0, z - 2.6);
    root.add(young);
  }

  // ---- Altstadt, after the real one: long rows of houses wall to wall, parallel to the shore, each
  // facing its lane: both sides of the race lane, the lakefront row, two narrow old-town lanes.
  // the low-poly Zug houses once loaded, the older generated houses otherwise
  const houseKeys = models.has('zugHouseA') ? ['zugHouseA', 'zugHouseB', 'zugHouseC', 'zugHouseD', 'zugHouseE'] : ['house_0', 'house_1', 'house_2'];
  // spots kept for what is placed after the houses: the Chriesi-Chuchi and the market stalls
  const end0 = path.getPointAt(1);
  const et0 = path.getTangentAt(1);
  const kept: Array<[number, number, number]> = [
    ...storyKept,
    [end0.x + et0.x * 5, end0.z + et0.z * 5, 5.5],
    ...STALL_SPOTS.map(([x, z]): [number, number, number] => [x, z, 2.2]),
  ];
  let hv = 0;
  /** Next house in the rotation, sized below the tower; null if the spot is taken. */
  const nextHouse = () => {
    const v = hv;
    const h = models.get(houseKeys[v % houseKeys.length], () => scaled(house(v % 5), 58));
    // the Zytturm stays the tallest building of the town: no house reaches past 55 % of it
    const hh = new Box3().setFromObject(h).max.y;
    if (hh > HOUSE_MAX * towerHeight) h.scale.multiplyScalar((HOUSE_MAX * towerHeight) / hh);
    return { h, size: new Box3().setFromObject(h).getSize(new Vector3()) };
  };
  /**
   * A row of houses along `curve` on side `k` (+1 left, −1 right of the walking direction),
   * fronts `gap` metres from the curve, each house touching the next.
   */
  /** Ground plans of the houses placed so far, as oriented rectangles (centre, half sizes, angle). */
  const plans: Array<{ x: number; z: number; hx: number; hz: number; a: number }> = [];
  const overlaps = (A: (typeof plans)[0], B: (typeof plans)[0]) => {
    // separating axes: the two edge directions of each rectangle
    const corners = (R: (typeof plans)[0]) => {
      const c = Math.cos(R.a), s2 = Math.sin(R.a);
      return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, k]) => [R.x + i * R.hx * c + k * R.hz * s2, R.z - i * R.hx * s2 + k * R.hz * c]);
    };
    const ca = corners(A), cb = corners(B);
    for (const R of [A, B]) {
      for (const [ax, az] of [[Math.cos(R.a), -Math.sin(R.a)], [Math.sin(R.a), Math.cos(R.a)]]) {
        const pa = ca.map(([x, z]) => x * ax + z * az), pb = cb.map(([x, z]) => x * ax + z * az);
        if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
      }
    }
    return true;
  };
  /**
   * A row of houses along `curve` on side `k` (+1 left, −1 right of the walking direction),
   * fronts `gap` metres from the curve, each house touching the next.
   */
  const houseRow = (curve: Curve<Vector3>, k: 1 | -1, gap: number, from = 0, to = 1) => {
    const len = curve.getLength();
    const others = occupied.length; // circles of everything placed before the houses
    for (let d = from * len; d < to * len; ) {
      const { h, size } = nextHouse();
      const mid = Math.min(1, (d + size.x * 0.425) / len);
      const p = curve.getPointAt(mid);
      const t = curve.getTangentAt(mid);
      const off = gap + size.z / 2;
      const x = p.x - t.z * k * off;
      const z = p.z + t.x * k * off;
      const a = Math.atan2(t.z * k, -t.x * k); // the front (+z) faces the street
      // the roof overhangs the walls by ~8 % each side: walls touch, eaves overlap as in a real row
      const plan = { x, z, hx: size.x * 0.42, hz: size.z * 0.45, a };
      const rad = Math.max(size.x, size.z) / 2;
      const clear =
        Math.abs(x) < MAP_HALF_W - rad &&
        Math.abs(z) < MAP_HALF_D - rad &&
        distToPath(x, z) > rad * 0.8 + PATH_WIDTH / 2 &&
        !inLake(x, z, rad) &&
        occupied.slice(0, others).every(([ox, oz, or]) => Math.hypot(ox - x, oz - z) > or + rad * 0.75) &&
        kept.every(([kx, kz, kr]) => Math.hypot(kx - x, kz - z) > kr + rad * 0.85) &&
        plans.every((q) => !overlaps(plan, q));
      if (clear) {
        h.position.set(x, 0, z);
        h.rotation.y = a;
        root.add(h);
        plans.push(plan);
        hv++;
        d += size.x * 0.85;
      } else d += 0.6;
    }
  };
  // the Zytturm stands in the lane's row like a house: same front line, facing the street
  {
    const [ox, oz] = [12.2 * F, 9.6 * F];
    const ts = sNear(ox, oz) / length;
    const p = path.getPointAt(ts);
    const t = path.getTangentAt(ts);
    const k = (ox - p.x) * -t.z + (oz - p.z) * t.x > 0 ? 1 : -1;
    const size = new Box3().setFromObject(tower).getSize(new Vector3());
    const off = PATH_WIDTH / 2 + 0.35 + size.z / 2;
    const a = Math.atan2(t.z * k, -t.x * k);
    tower.position.set(p.x - t.z * k * off, 0, p.z + t.x * k * off);
    tower.rotation.y = a;
    plans.push({ x: tower.position.x, z: tower.position.z, hx: size.x / 2, hz: size.z / 2, a });
  }
  // the lane out of town, both sides
  const lane = new SubPath(path, 0.02, 0.22);
  houseRow(lane, 1, PATH_WIDTH / 2 + 0.35);
  houseRow(lane, -1, PATH_WIDTH / 2 + 0.35);
  // the lakefront: one row along the Seepromenade on the town side, fronts towards the lake
  const shoreA = sNear(-5 * F, -0.5 * F) / length;
  const shoreB = sNear(-4.6 * F, 7.6 * F) / length;
  houseRow(new SubPath(path, shoreA, shoreB), -1, PATH_WIDTH / 2 + 0.35);
  // Kolinplatz: a ring of house fronts around the cobbled square
  const ringPts: Vector3[] = [];
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    ringPts.push(new Vector3(5 * F + Math.cos(a) * 6.5 * F * 0.9, 0, 9.5 * F + Math.sin(a) * 5 * F * 0.9));
  }
  houseRow(new CatmullRomCurve3(ringPts, true), -1, 0.3);
  // the whole old town is paved, as in Zug: no meadow between the rows
  const paving = card(OLD_TOWN_PAVING.map(([x, z]): [number, number] => [x, -z]), 0.02, 0xd2c7b2);
  paving.rotation.x = -Math.PI / 2;
  paving.position.y = 0.03;
  root.add(paving);
  // the old-town lanes between the lake and the lane: narrow, paved like the path
  const LANE_W = 1.4;
  const lanes = OLD_TOWN_LANES.map(([[x0, z0], [x1, z1]]) => new LineCurve3(new Vector3(x0, 0, z0), new Vector3(x1, 0, z1)));
  for (const l of lanes) {
    root.add(ribbon(l, LANE_W, 0xd6cdbb, 16, 0.06));
    // nothing else stands in the lane
    for (let u = 0; u <= 1; u += 0.04) {
      const p = l.getPointAt(u);
      occupied.push([p.x, p.z, LANE_W / 2]);
    }
  }
  for (const l of lanes) {
    houseRow(l, 1, LANE_W / 2 + 0.1);
    houseRow(l, -1, LANE_W / 2 + 0.1);
  }
  // cobbles over the whole paved old town and its lanes, like the path and the squares; none
  // under the houses (they would not show) or on the path (it has its own)
  const inPaving = (x: number, z: number) => {
    let inside = false;
    for (let i = 0, k = OLD_TOWN_PAVING.length - 1; i < OLD_TOWN_PAVING.length; k = i++) {
      const [xi, zi] = OLD_TOWN_PAVING[i];
      const [xk, zk] = OLD_TOWN_PAVING[k];
      if (zi > z !== zk > z && x < ((xk - xi) * (z - zi)) / (zk - zi) + xi) inside = !inside;
    }
    return inside;
  };
  const underHouse = (x: number, z: number) =>
    plans.some((q) => {
      const dx = x - q.x;
      const dz = z - q.z;
      const c = Math.cos(q.a);
      const s = Math.sin(q.a);
      return Math.abs(dx * c - dz * s) < q.hx && Math.abs(dx * s + dz * c) < q.hz;
    });
  const townCobbles: Array<{ m: Matrix4; c: number }> = [];
  const inSquare = (x: number, z: number) => SQUARES.some(([cx, cz, rx, rz]) => ((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2 <= 1);
  const clear = (x: number, z: number) => !underHouse(x, z) && distToPath(x, z) >= PATH_WIDTH / 2 + 0.2;
  // the random numbers this grid always drew (see the squares above)
  for (let x = -8; x <= 15; x += 0.55)
    for (let z = -6; z <= 11; z += 0.55) {
      const sx = x + ((Math.round(z / 0.55) % 2) * 0.27);
      if (inPaving(sx, z) && r() >= 0.1 && clear(sx, z)) for (let k = 0; k < 5; k++) r();
    }
  // one grid in running bond over the paved town and both squares: every stone the same size,
  // square to the grid, with an even joint between them
  const GRID = 0.55;
  const [gx0, gx1, gz0, gz1] = SQUARES.reduce(
    ([a, b, c, d], [cx, cz, rx, rz]) => [Math.min(a, cx - rx), Math.max(b, cx + rx), Math.min(c, cz - rz), Math.max(d, cz + rz)],
    [-8, 15.5, -6, 11],
  );
  for (let gz = Math.floor(gz0 / GRID); gz * GRID <= gz1; gz++)
    for (let gx = Math.floor(gx0 / GRID) - 1; gx * GRID <= gx1; gx++) {
      const z = gz * GRID;
      const x = (gx + (Math.abs(gz) % 2) / 2) * GRID;
      if ((inPaving(x, z) || inSquare(x, z)) && clear(x, z)) townCobbles.push(stoneAt(x, 0.075, z, 0, 0.46, COBBLE, 0.46, cr));
    }
  root.add(scatter(new BoxGeometry(1, 0.05, 1), townCobbles));
  for (const q of plans) occupied.push([q.x, q.z, Math.max(q.hx, q.hz)]);

  // ---- Landsgemeindeplatz: the Chriesi-Chuchi at the end, Chriesimärt stalls around it
  const end = path.getPointAt(1);
  const et = path.getTangentAt(1);
  const finish = models.get(models.has('zugChuchi') ? 'zugChuchi' : 'house_2', () => scaled(house(2), 90));
  // the Chriesi-Chuchi is the big house of the square, but still below the Zytturm
  const fh = new Box3().setFromObject(finish).max.y;
  if (fh > 0.75 * towerHeight) finish.scale.multiplyScalar((0.75 * towerHeight) / fh);
  finish.position.set(end.x + et.x * 5, 0, end.z + et.z * 5);
  finish.rotation.y = Math.atan2(-et.x, -et.z);
  root.add(finish);
  occupied.push([finish.position.x, finish.position.z, 4.5]);
  // the runner stops at the end of the path, just past the finish gate
  raceGate(1 - 1.2 / length, 'ZIEL');
  const sign = new Group();
  const disc = mesh(new CylinderGeometry(0.9, 0.9, 0.12, 12), PALETTE.cream);
  disc.rotation.x = Math.PI / 2;
  const fruit = mesh(new SphereGeometry(0.42, 8, 6), PALETTE.cherry);
  fruit.position.z = 0.12;
  sign.add(disc, fruit);
  sign.position.set(finish.position.x - et.x * 3.4, 6.2, finish.position.z - et.z * 3.4);
  sign.rotation.y = finish.rotation.y;
  root.add(sign);
  for (const [x, z, c] of STALL_SPOTS) {
    if (!free(x, z, 1.6)) continue;
    faceThePath(put(models.get(models.has('zugStall') ? 'zugStall' : 'marketStall', () => stall(c)), x, z, 1.8));
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
  const allmendAt = new Vector3(17 * F, 0, -4.5 * F);
  // ---- the Allmend, the town's common orchard (track 6): a sign where the race comes in, and
  // picking ladders leaning on a few trees by the path (tracks 10, 11)
  if (models.has('zugRaceSign')) {
    const s = sNear(17 * F, -4.5 * F);
    const p = path.getPointAt(s / length);
    const t = path.getTangentAt(s / length);
    const off = PATH_WIDTH / 2 + 1.9;
    const side = [1, -1].find((k) => free(p.x - t.z * k * off, p.z + t.x * k * off, 1.2)) ?? 1;
    const sign = signText(models.get('zugRaceSign', () => scaled(startArch(), 70)), 'Allmend');
    sign.scale.multiplyScalar(0.42);
    sign.position.set(p.x - t.z * side * off, 0, p.z + t.x * side * off);
    sign.rotation.y = alongPath(s);
    root.add(sign);
    occupied.push([sign.position.x, sign.position.z, 1.4]);
    allmendAt.copy(sign.position);
  }
  const ladders: Object3D[] = [];
  for (const t of trees) {
    if (t === tree || ladders.length >= 3) continue;
    const s = sNear(t.position.x, t.position.z);
    const p = path.getPointAt(s / length);
    const d = Math.hypot(p.x - t.position.x, p.z - t.position.z);
    // a tree near the path, and not next to another ladder
    if (d < 3.4 || d > 6.5 || ladders.some((l) => Math.hypot(l.position.x - t.position.x, l.position.z - t.position.z) < 12)) continue;
    const dx = (t.position.x - p.x) / d;
    const dz = (t.position.z - p.z) / d;
    const l = gameLadder();
    // its foot on the path side of the trunk, its top leaning into the crown
    l.position.set(t.position.x - dx * 1.5, 0, t.position.z - dz * 1.5);
    l.rotation.y = Math.atan2(dx, dz);
    l.rotateX(0.34);
    root.add(l);
    ladders.push(l);
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
  // the people cheering beside the path, on alternate sides, facing it (none in the lake)
  const roadside: JourneyWorld['roadside'] = [];
  for (const u of [0.02, 0.04, 0.07, 0.1, 0.13, 0.17, 0.24, 0.3, 0.42, 0.5, 0.6, 0.7, 0.78, 0.84, 0.89, 0.93, 0.97]) {
    const p = path.getPointAt(u);
    const t = path.getTangentAt(u);
    const k = roadside.length % 2 ? 1 : -1;
    const x = p.x - t.z * k * (PATH_WIDTH / 2 + 0.9);
    const z = p.z + t.x * k * (PATH_WIDTH / 2 + 0.9);
    if (inLake(x, z, 0.3)) continue;
    roadside.push({ x, z, ry: Math.atan2(p.x - x, p.z - z) });
  }
  // leave the fence open where the game stops (crate, gate, picking tree, cart) and where
  // someone stands cheering
  const fenceGaps = [sNear(15 * F, -3.2 * F), sNear(19.5 * F, -7 * F), treeS, sNear(8 * F, -10.6 * F), ...STORY_LANES.map(({ pts: [[x, z]] }) => sNear(x, z))];
  for (const side of [-1, 1]) {
    let prev: Vector3 | null = null;
    for (let s = townEnd + 5; s < promenade - 4; s += 1.6) {
      const p = path.getPointAt(s / length);
      const t = path.getTangentAt(s / length);
      const x = p.x - t.z * side * 2.25;
      const z = p.z + t.x * side * 2.25;
      const blocked = fenceGaps.some((u) => Math.abs(u - s) < 3.5) || roadside.some((q) => Math.hypot(q.x - x, q.z - z) < 1.4);
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

  // a little landing stage where the lane from Kolinplatz reaches the shore
  {
    const lz = STORY_LANES[0].pts[STORY_LANES[0].pts.length - 1][1];
    const sx = shoreX(lz);
    const landing = mesh(new BoxGeometry(3.6, 0.16, 1.3), PALETTE.wood);
    landing.position.set(sx - 1.6, 0.22, lz);
    root.add(landing);
    for (let k = 0; k < 2; k++) for (const e of [-0.55, 0.55]) posts.push(item(sx - 0.6 - k * 2, 0.1, lz + e, 0, 0.16, 0.5, 0.16, 0x6b4a2b));
  }

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
  const square: JourneyWorld['square'] = [];
  let vi = 0;
  for (const { x, z, ry } of roadside) {
    if (!roadsideVillagers) {
      vi++; // same seeds for the people on the squares either way
      continue;
    }
    const v = villager(vi, { wheelchair: vi === 3, child: vi % 4 === 2 });
    vi++;
    v.root.position.set(x, 0, z);
    v.root.rotation.y = ry;
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
    const ry = r() * Math.PI * 2;
    occupied.push([x, z, 0.6]);
    if (!roadsideVillagers) {
      // the modelled children stand here instead (journey.ts)
      square.push({ x, z, ry });
      vi++;
      continue;
    }
    const v = villager(vi, { wheelchair: vi === 21, child: vi % 3 === 0 });
    vi++;
    v.root.position.set(x, 0, z);
    v.root.rotation.y = ry;
    root.add(v.root);
    villagers.push(v);
  }

  // ---- one draw call per material for everything that only stands there: the houses and the
  // trees other than the picking tree (a phone draws hundreds of small meshes slowly)
  const still: Object3D[] = [];
  root.traverse((o) => {
    const key = o.userData?.assetKey as string | undefined;
    if (key && /^zug(House|Chuchi)/.test(key)) still.push(o);
  });
  for (const t of trees) if (t !== tree) still.push(t);
  still.push(...ladders);
  batchStatic(root, still);

  // the first three stops teach the three moves once each — jump, duck, change sides — and
  // from then on the obstacles come without a word (the fence stays open at cart, gate, tree)
  const stops: Stops = {
    log: sNear(9.6 * F, 6 * F),
    garland: sNear(11 * F, 1 * F),
    crate: sNear(15 * F, -3.2 * F),
    gate: sNear(19.5 * F, -7 * F),
    tree: treeS,
    cart: sNear(8 * F, -10.6 * F),
    cat: sNear(-5.5 * F, 2.5 * F),
  };
  // birds over Lake Zug (track 1: «Hörst du die Vögel?»), circling slowly
  const birds = [0, 1, 2, 3].map((i) => {
    const b = models.get('starling', starling);
    b.scale.multiplyScalar(14);
    b.userData.circle = { r: 4 + i * 1.6, h: 6.5 + (i % 2) * 1.2, phase: i * 1.7, speed: 0.22 + i * 0.03 };
    root.add(b);
    return b;
  });
  const wheel = root.getObjectByName('wheel');
  return {
    root,
    path,
    length,
    stops,
    finish,
    tree,
    tower,
    bell: michael ?? tower,
    // one round over the map: from the lake across to St. Michael and up to the Allmend, up over the
    // whole town, down at St. Verena, to the start at the Liebfrauenkapelle, through the town to the
    // market by the lake
    storyStops: [
      { id: 'lake', title: 'Zugersee', tracks: [1, 2, 3], at: new Vector3(shoreX(4) - 4, 0, 4) },
      { id: 'michael', title: 'St. Michael · Chriesigloggä', tracks: [4, 5, 6, 7, 8, 9], at: (michael ?? tower).position.clone() },
      { id: 'allmend', title: 'Allmend', tracks: [10, 11, 12, 13, 14, 15, 16], at: allmendAt },
      // the town grows (tracks 17, 18): the camera rises over the whole map, then comes down at St. Verena
      { id: 'overview', title: 'Zug von oben', tracks: [17, 18], at: new Vector3(4 * F, 0, 0) },
      { id: 'verena', title: 'Kapelle St. Verena · 1000. Baum', tracks: [19, 20, 21, 22, 23, 24, 25, 26], at: verena ? verena.position.clone() : new Vector3(STORY_SPOTS.verena[0], 0, STORY_SPOTS.verena[1]) },
      { id: 'liebfrauen', title: 'Liebfrauenkapelle · Start', tracks: [27, 28, 29], at: church.position.clone() },
      { id: 'maert', title: 'Landsgemeindeplatz · Chriesimärt', tracks: [30, 31, 33], at: finish.position.clone() },
    ],
    roadside,
    square,
    update(dt, t) {
      for (const v of villagers) v.arm.rotation.z = -2.3 + Math.sin(t * 5 + v.phase) * 0.45;
      for (const b of boats) {
        b.position.y = Math.sin(t * 1.4 + b.userData.bob * 2) * 0.08;
        b.rotation.z = Math.sin(t * 1.1 + b.userData.bob) * 0.05;
      }
      if (wheel) wheel.rotation.x += dt * 0.8;
      for (const b of birds) {
        const { r: cr, h, phase, speed } = b.userData.circle as { r: number; h: number; phase: number; speed: number };
        const a = t * speed + phase;
        b.position.set(-24 + Math.cos(a) * cr, h + Math.sin(a * 2) * 0.3, 2 + Math.sin(a) * cr);
        // the bird's head is its +x: it looks along its way round the circle
        b.rotation.y = Math.atan2(Math.cos(a), Math.sin(a)) + Math.PI;
      }
    },
  };
}

/**
 * Merge the meshes under `objects` into one mesh per material, in `root`'s space, and remove the
 * originals. Only for things nothing moves, hides or looks up afterwards.
 */
function batchStatic(root: Object3D, objects: Object3D[]): void {
  root.updateMatrixWorld(true);
  const toRoot = new Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<Material, BufferGeometry[]>();
  const meshes: Mesh[] = [];
  for (const o of objects)
    o.traverse((m) => {
      if (!(m instanceof Mesh) || m instanceof InstancedMesh || Array.isArray(m.material) || !m.visible) return;
      const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(
        new Matrix4().multiplyMatrices(toRoot, m.matrixWorld),
      );
      const list = groups.get(m.material) ?? [];
      list.push(g);
      groups.set(m.material, list);
      meshes.push(m);
    });
  for (const [material, geos] of groups) {
    // keep only the attributes every piece has (some carry uv or colour, others not)
    const names = Object.keys(geos[0].attributes).filter((n) => geos.every((g) => g.getAttribute(n)));
    for (const g of geos) for (const n of Object.keys(g.attributes)) if (!names.includes(n)) g.deleteAttribute(n);
    const merged = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const batch = new Mesh(merged, material);
    batch.name = 'batched';
    root.add(batch);
  }
  for (const m of meshes) m.removeFromParent();
}

/**
 * Paints `text` on both faces of the race sign's blank board: the model marks the inside of the
 * blue frame on each face with an empty (`board_front`, `board_back`), scaled to its width and
 * height, its local y pointing out of the face (scripts/build-race-sign.py). The letters are one
 * canvas texture, as wide as the frame is, on a quad per face, centred in the frame.
 */
function signText(sign: Object3D, text: string): Object3D {
  const front = sign.getObjectByName('board_front');
  if (!front) return sign;
  // the canvas has the frame's own proportions, so the letters are not stretched
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = Math.round((1024 * front.scale.z) / front.scale.x);
  const g = canvas.getContext('2d');
  if (!g) return sign;
  const font = (px: number) => `800 ${px}px ui-rounded, 'SF Pro Rounded', 'Arial Rounded MT Bold', system-ui, sans-serif`;
  // as big as fits: three quarters of the frame's height, at most 80 % of its width
  let px = 0.75 * canvas.height;
  g.font = font(px);
  px = Math.min(px, (px * 0.8 * canvas.width) / g.measureText(text).width);
  g.font = font(px);
  g.textAlign = 'center';
  // centred on the capitals themselves, not on the line box (which leaves room for descenders)
  g.textBaseline = 'alphabetic';
  const m = g.measureText(text);
  const baseline = canvas.height / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
  g.fillStyle = '#1f55a3';
  g.fillText(text, canvas.width / 2, baseline);
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 4;
  const paint = new MeshLambertMaterial({ map, alphaTest: 0.5 });
  const quad = new PlaneGeometry(1, 1);
  for (const name of ['board_front', 'board_back']) {
    const board = sign.getObjectByName(name);
    if (!board) continue;
    const letters = new Mesh(quad, paint);
    // the quad faces +z; the board's face points along the empty's local y, its top along -z
    letters.rotation.x = -Math.PI / 2;
    // just in front of the planks, so the letters do not flicker into them
    letters.position.y = 0.006;
    letters.name = 'sign_text';
    board.add(letters);
  }
  return sign;
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
