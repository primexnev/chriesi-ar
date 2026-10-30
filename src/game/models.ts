import { CONFIG } from '../config';

/**
 * Models for the Chriesisturm game. Units are metres, Y up, the front faces −z for runners
 * and +z for buildings (towards the street after placement). Drop the GLB into
 * public/assets/models/ and add it here — the placeholder is replaced automatically.
 * See docs/game-assets.md for sizes, node names and animation clip names.
 */
export const GAME_MODEL_FILES: Record<string, string> = {
  raceRunner: 'race_runner.glb',
  // raceRival: 'race_rival.glb',
  // raceHouse_0: 'race_house_a.glb',
  // raceHouse_1: 'race_house_b.glb',
  // raceHouse_2: 'race_house_c.glb',
  // raceHouse_3: 'race_house_d.glb',
  // raceTower: 'race_zytturm.glb',
  // raceFountain: 'race_fountain.glb',
  // raceCherryTree: 'race_cherry_tree.glb',
  // raceFinishHouse: 'race_chriesi_chuchi.glb',
};

export function gameModelUrls(): Record<string, string> {
  return Object.fromEntries(Object.entries(GAME_MODEL_FILES).map(([k, f]) => [k, CONFIG.modelsUrl + f]));
}
