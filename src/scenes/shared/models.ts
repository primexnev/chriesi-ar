import { Box3, Group, Mesh, MeshLambertMaterial, Vector3, type Material, type Object3D } from 'three';
import { CONFIG } from '../../config';
import type { AssetLibrary } from '../../core/assets';
import { animateFigure, type ClipName } from './figures';

/**
 * Model files delivered by the 3D team. Add an entry when a GLB lands in
 * public/assets/models/ — the matching placeholder is replaced automatically.
 * Keys are used by the scene code; see README.md for node-naming conventions.
 */
export const MODEL_FILES: Record<string, string> = {
  villager: 'villager.glb',
  // Rigged villagers (Meshy auto-rig) and their clips, delivered as animation-only GLBs.
  crowdVillager: 'cheer_man_rig.glb',
  clipWalk: 'clip_walk.glb',
  clipRun: 'clip_run.glb',
  clipCheer: 'clip_cheer.glb',
  clipCarry: 'clip_carry.glb',
  clockTower: 'clock_tower.glb',
  house_0: 'house_0.glb',
  house_1: 'house_1.glb',
  house_2: 'house_2.glb',
  fountain: 'fountain.glb',
  bridge: 'bridge.glb',
  startArch: 'start_arch.glb',
  basket: 'basket.glb',
  ladder: 'ladder.glb',
  starling: 'starling.glb',
  sun: 'sun.glb',
  alps: 'alps.glb',
  zugerberg: 'zugerberg.glb',
  // Chronicle pages
  cheerWoman: 'folk_woman_rig.glb',
  folkMan: 'folk_man_rig.glb',
  folkWoman: 'folk_woman_rig.glb',
  stiltHut: 'stilt_hut.glb',
  mill: 'mill.glb',
  marketStall: 'market_stall.glb',
  church: 'church.glb',
  // True low-poly Zug houses built by scripts/build-zug-house.py: the journey's Altstadt.
  zugHouseA: 'zug_house_a.glb',
  zugHouseB: 'zug_house_b.glb',
  zugHouseC: 'zug_house_c.glb',
  zugHouseD: 'zug_house_d.glb',
  zugHouseE: 'zug_house_e.glb',
  // The Zytturm (Meshy, cleaned, prepared, crisp clock faces by scripts/add-clock-faces.py): the journey's clock tower.
  zytturm: 'zug_zytturm.glb',
  // The Chriesi-Chuchi at the finish: a wide low-poly Zug house (scripts/build-zug-house.py).
  zugChuchi: 'zug_chuchi.glb',
  // The low-poly mill by the Lorze (Meshy, prepared with scripts/prepare-building.py).
  zugMill: 'zug_mill.glb',
  // The Chriesimärt stall (Meshy, cleaned and dressed with our cherries: scripts/dress-market-stall.py).
  zugStall: 'zug_stall.glb',
};

/**
 * How a model is sized onto its placeholder. Generated (Meshy) models arrive in arbitrary
 * units, so they take the placeholder's place instead of being authored to page scale:
 * - height:    uniform scale to the placeholder's height, footprint centred on it
 * - footprint: uniform scale so the ground plan fits inside the placeholder's (rows of houses)
 * - max:       uniform scale so the largest extent matches
 * - box:       per-axis scale to the placeholder's bounding box (spans that the path relies on)
 * - strip:     repeated along x at the placeholder's height (backdrop cards across the page)
 * `scale` adjusts the result where the model's proportions differ a lot from the placeholder's.
 * Keys without an entry (e.g. the rigged villager) are used exactly as delivered.
 */
interface Fit {
  mode: 'height' | 'footprint' | 'max' | 'box' | 'strip';
  scale?: number;
}
export const MODEL_FIT: Record<string, Fit> = {
  // The generated tower is about three times as wide as the placeholder for its height.
  clockTower: { mode: 'height', scale: 0.72 },
  house_0: { mode: 'footprint', scale: 1.1 },
  house_1: { mode: 'footprint', scale: 1.1 },
  house_2: { mode: 'footprint', scale: 1.1 },
  fountain: { mode: 'footprint' },
  basket: { mode: 'height', scale: 0.9 },
  // A stepladder: flattened to a single ladder of the placeholder's size.
  ladder: { mode: 'box' },
  // Raised arms make the cheering figure taller than a person's head height.
  crowdVillager: { mode: 'height', scale: 1.1 },
  cheerWoman: { mode: 'height' },
  folkMan: { mode: 'height' },
  folkWoman: { mode: 'height' },
  // The generated hut stands on a wide platform; scale up so the hut itself matches.
  stiltHut: { mode: 'footprint', scale: 1.7 },
  mill: { mode: 'footprint' },
  marketStall: { mode: 'footprint', scale: 1.1 },
  church: { mode: 'footprint', scale: 1.1 },
  zugHouseA: { mode: 'footprint', scale: 1.1 },
  zugHouseB: { mode: 'footprint', scale: 1.1 },
  zugHouseC: { mode: 'footprint', scale: 1.1 },
  zugHouseD: { mode: 'footprint', scale: 1.1 },
  zugHouseE: { mode: 'footprint', scale: 1.1 },
  // slender: sized by height to the tower placeholder
  zytturm: { mode: 'height' },
  zugChuchi: { mode: 'footprint', scale: 1.1 },
  zugMill: { mode: 'footprint' },
  // a little larger than the old stall, so the children reach the counter and stand under the awning
  zugStall: { mode: 'footprint', scale: 1.4 },
  starling: { mode: 'max' },
  sun: { mode: 'max' },
  startArch: { mode: 'box' },
  bridge: { mode: 'box' },
  alps: { mode: 'strip' },
  zugerberg: { mode: 'strip' },
  // Chriesisturm game (see src/game/models.ts)
  raceHouse_0: { mode: 'footprint' },
  raceHouse_1: { mode: 'footprint' },
  raceHouse_2: { mode: 'footprint' },
  raceHouse_3: { mode: 'footprint' },
  raceTower: { mode: 'height', scale: 0.5 },
  raceFountain: { mode: 'footprint' },
};

/**
 * Models built in flat vertex colours (scripts/build-zug-house.py). Their glTF PBR material reads
 * darker than the scene's own Lambert placeholders, so they get the same matte Lambert material.
 */
const FLAT_COLOURED = /^zug(House|Chuchi)/;
const lambertFor = new Map<Material, MeshLambertMaterial>();
function toLambert(root: Object3D): void {
  root.traverse((o) => {
    if (!(o instanceof Mesh) || Array.isArray(o.material)) return;
    let m = lambertFor.get(o.material);
    if (!m) {
      m = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
      // a little of each face's own colour as glow, so the pastels stay pastel on the shaded side
      m.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += vColor.rgb * 0.28;',
        );
      };
      lambertFor.set(o.material, m);
    }
    o.material = m;
  });
}

/** Empty nodes the scene code looks up; kept from the placeholder when a model lacks them. */
const FUNCTIONAL_NODES = ['contents'];

export function modelUrls(): Record<string, string> {
  return Object.fromEntries(Object.entries(MODEL_FILES).map(([k, f]) => [k, CONFIG.modelsUrl + f]));
}

const CLIP_KEYS: Record<ClipName, string> = { walk: 'clipWalk', run: 'clipRun', cheer: 'clipCheer', carry: 'clipCarry' };

export class Models {
  constructor(private readonly lib: AssetLibrary | null) {}

  /** Animation clips by name, from the animation-only GLBs (empty without them). */
  clips(...names: ClipName[]) {
    return names.flatMap((n) => this.lib?.animations(CLIP_KEYS[n]) ?? []);
  }

  /** A villager that animates itself (see figures.ts); `fixed` keeps one clip playing. */
  figure(key: string, placeholder: () => Object3D, fixed: ClipName | null = null): Object3D {
    const obj = this.get(key, placeholder);
    animateFigure(obj, fixed ? this.clips(fixed) : this.clips('walk', 'run', 'carry'), fixed);
    return obj;
  }

  /** Whether the real model for `key` was loaded (the placeholder is used otherwise). */
  has(key: string): boolean {
    return this.lib?.has(key) ?? false;
  }

  /** Real model if loaded, otherwise the procedural placeholder. */
  get(key: string, placeholder: () => Object3D): Object3D {
    const real = this.lib?.instance(key);
    const fit = MODEL_FIT[key];
    let obj: Object3D;
    if (!real) obj = placeholder();
    else {
      const ph = fit ? placeholder() : null;
      // An empty placeholder (code that sizes the model itself) has nothing to fit onto.
      obj = ph && !new Box3().setFromObject(ph).isEmpty() ? fitToPlaceholder(real, ph, fit!) : real;
    }
    if (real && FLAT_COLOURED.test(key)) toLambert(obj);
    obj.userData.assetKey = key;
    return obj;
  }
}

/** Wraps `real` so it occupies the placeholder's bounds; the wrapper has the placeholder's name and metadata. */
function fitToPlaceholder(real: Object3D, ph: Object3D, fit: Fit): Group {
  ph.updateMatrixWorld(true);
  const target = new Box3().setFromObject(ph);
  const want = target.getSize(new Vector3());
  const out = new Group();
  out.name = ph.name;
  Object.assign(out.userData, ph.userData);

  real.updateMatrixWorld(true);
  const have = new Box3().setFromObject(real).getSize(new Vector3());
  const k = fit.scale ?? 1;
  if (fit.mode === 'strip') {
    stripAcross(out, real, target, have);
  } else {
    if (fit.mode === 'box') real.scale.set((k * want.x) / have.x, (k * want.y) / have.y, (k * want.z) / have.z);
    else {
      const s = {
        height: want.y / have.y,
        footprint: Math.min(want.x / have.x, want.z / have.z),
        max: Math.max(want.x, want.y, want.z) / Math.max(have.x, have.y, have.z),
      }[fit.mode];
      real.scale.setScalar(k * s);
    }
    placeOn(real, target);
    out.add(real);
  }

  for (const name of FUNCTIONAL_NODES) {
    const node = ph.getObjectByName(name);
    if (node && !real.getObjectByName(name)) out.attach(node);
  }
  return out;
}

/** Bottom of `obj` on the bottom of `target`, centred over it in x and z. */
function placeOn(obj: Object3D, target: Box3): void {
  obj.position.set(0, 0, 0);
  obj.updateMatrixWorld(true);
  const b = new Box3().setFromObject(obj);
  const c = b.getCenter(new Vector3());
  const tc = target.getCenter(new Vector3());
  obj.position.set(tc.x - c.x, target.min.y - b.min.y, tc.z - c.z);
}

/** Copies of a backdrop card side by side across the target width, alternately mirrored. */
function stripAcross(out: Group, real: Object3D, target: Box3, have: Vector3): void {
  const want = target.getSize(new Vector3());
  const s = want.y / have.y;
  const width = have.x * s;
  const count = Math.max(1, Math.ceil(want.x / (width * 0.8)));
  const step = count > 1 ? (want.x - width) / (count - 1) : 0;
  // Keep the cards thin: the backdrop stands on the back edge of the page.
  const depth = Math.min(s, Math.max(want.z, 0.012) / have.z);
  const heights = [1, 0.86, 0.95, 0.8, 0.92, 0.84];
  const mid = target.getCenter(new Vector3()).x;
  for (let i = 0; i < count; i++) {
    const copy = i === 0 ? real : real.clone();
    const h = heights[i % heights.length];
    copy.scale.set(s * h * (i % 2 ? -1 : 1), s * h, depth);
    placeOn(copy, target);
    copy.position.x += (count > 1 ? target.min.x + width / 2 + step * i : mid) - mid;
    copy.position.z -= i * 0.002; // avoid coplanar overlaps
    out.add(copy);
  }
}
