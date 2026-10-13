import type { Vector3 } from 'three';
import type { Quality } from '../config';
import type { Stage } from '../core/stage';
import type { Narrator } from '../audio/narrator';
import type { Sfx } from '../audio/sfx';
import type { Models } from '../scenes/shared/models';

/** Everything a scene script needs. Passed in, never imported globally. */
export interface StoryContext {
  stage: Stage;
  narrator: Narrator;
  sfx: Sfx;
  models: Models;
  quality: Quality;
  /** Ask the camera to look at a point in page space (3D view only; AR ignores it). */
  focus(target: Vector3 | null, distance?: number): void;
}
