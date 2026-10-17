import type { Object3D } from 'three';
import { CONFIG } from '../../config';
import type { AssetLibrary } from '../../core/assets';

/**
 * Model files delivered by the 3D team. Add an entry when a GLB lands in
 * public/assets/models/ — the matching placeholder is replaced automatically.
 * Keys are used by the scene code; see README.md for node-naming conventions.
 */
export const MODEL_FILES: Record<string, string> = {
  villager: 'villager.glb',
  // cherryTree: 'cherry_tree.glb',
  // clockTower: 'clock_tower.glb',
  // house_0: 'house_a.glb',
};

export function modelUrls(): Record<string, string> {
  return Object.fromEntries(Object.entries(MODEL_FILES).map(([k, f]) => [k, CONFIG.modelsUrl + f]));
}

export class Models {
  constructor(private readonly lib: AssetLibrary | null) {}

  /** Real model if loaded, otherwise the procedural placeholder. */
  get(key: string, placeholder: () => Object3D): Object3D {
    const obj = this.lib?.instance(key) ?? placeholder();
    obj.userData.assetKey = key;
    return obj;
  }
}
