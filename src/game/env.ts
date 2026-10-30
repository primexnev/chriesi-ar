import type { Group, Vector3 } from 'three';
import type { Sfx } from '../audio/sfx';
import type { Quality } from '../config';
import type { StoryClock } from '../core/clock';
import type { ArrowPad } from './input';
import type { GameHud } from './ui';

export interface ViewShot {
  /** Point of the course (game metres) shown in the middle of the page. */
  center: Vector3;
  /** Page units per metre: small = wide view of the street, large = close-up (kitchen). */
  scale: number;
}

/**
 * The game is a diorama on the printed page: only a window of the course is visible,
 * clipped to the page edges. The view slides and zooms that window; the camera itself
 * belongs to the phone (AR) or the 3D view.
 */
export interface GameView {
  frame(center: Vector3, scale: number, ease?: number): void;
  follow(fn: () => ViewShot, ease?: number): void;
  /** Camera position in game coordinates (billboards face it). */
  cameraPosition(): Vector3;
}

/** Everything a game phase needs. `root` holds the course in game metres. */
export interface GameEnv {
  clock: StoryClock;
  pad: ArrowPad;
  hud: GameHud;
  sfx: Sfx;
  root: Group;
  view: GameView;
  quality: Quality;
}
