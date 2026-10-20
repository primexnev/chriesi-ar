import type { Camera, Group, Scene, Vector3, WebGLRenderer } from 'three';

export type TrackerKind = 'ar' | '3d';

/**
 * A tracker owns the renderer, camera and an `anchor` the story content is attached to.
 * Swapping the tracking technology (MindAR image target, QR + marker, WebXR later …)
 * only means writing a new implementation of this interface.
 *
 * Page space convention for `anchor` (y-up):
 *  - the printed double page lies in the XZ plane, centred at the origin
 *  - width (x) = 1 unit, depth (z) = 1 / spreadAspect ≈ 0.707
 *  - +z points to the bottom edge of the page (towards the reader), +y out of the paper
 */
export interface Tracker {
  readonly kind: TrackerKind;
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: Camera;
  readonly anchor: Group;
  /** Element that receives pointer input on top of the canvas. */
  readonly inputElement: HTMLElement;
  readonly isFound: boolean;
  start(): Promise<void>;
  stop(): void;
  onFound(cb: () => void): void;
  onLost(cb: () => void): void;
  /** Optional per-frame hook (e.g. orbit controls). */
  update?(): void;
  /** Optional camera guidance in page space (only meaningful without AR). */
  focus?(target: Vector3 | null, distance?: number): void;
  /** Optional: stop one-finger camera orbiting while a drag gesture belongs to the story. */
  lockView?(locked: boolean): void;
}

export type TrackerFailure =
  | 'camera-denied'
  | 'camera-unavailable'
  | 'target-missing'
  | 'load-failed'
  | 'timeout';

export class TrackerError extends Error {
  constructor(
    readonly reason: TrackerFailure,
    readonly cause?: unknown,
  ) {
    super(`Tracker failed: ${reason}`);
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new TrackerError('timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      },
    );
  });
}
