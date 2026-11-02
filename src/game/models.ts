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
  // Story models, fitted onto the placeholders' size (MODEL_FIT in scenes/shared/models.ts).
  raceHouse_0: 'house_0.glb',
  raceHouse_1: 'house_1.glb',
  raceHouse_2: 'house_2.glb',
  raceHouse_3: 'house_0.glb',
  raceTower: 'clock_tower.glb',
  raceFountain: 'fountain.glb',
  // Cheering spectators: rigged villagers + the cheer clip, baked into morph targets at load.
  cheerMan: 'cheer_man_rig.glb',
  cheerWoman: 'folk_woman_rig.glb',
  cheerFolkMan: 'folk_man_rig.glb',
  clipCheer: 'clip_cheer.glb',
  // The Chriesi-Chuchi: floor, back and left wall with stove, shelves and jars (the room only).
  kitchenRoom: 'kitchen_room.glb',
  // raceFinishHouse: 'race_chriesi_chuchi.glb',
};

export function gameModelUrls(): Record<string, string> {
  return Object.fromEntries(Object.entries(GAME_MODEL_FILES).map(([k, f]) => [k, CONFIG.modelsUrl + f]));
}
