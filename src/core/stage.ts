import { Group, Raycaster, Vector2, type Object3D, type Vector3 } from 'three';
import { StoryClock } from './clock';
import type { Tracker } from '../tracking/types';

/** `point` is the hit position in world space. */
type TapHandler = (target: Object3D, point: Vector3) => void;
type FrameHook = (dt: number) => void;

const TAP_MAX_MOVE_PX = 12;
const TAP_MAX_MS = 450;

/**
 * The stage glues a tracker (AR or 3D view) to the story content.
 * Content lives in `content` (page space, y-up) and survives tracker swaps,
 * so the story can continue when we switch from AR to the 3D view mid-scene.
 */
export class Stage {
  readonly content = new Group();
  readonly clock = new StoryClock();
  tracker: Tracker | null = null;

  private taps = new Map<Object3D, TapHandler>();
  private frameHooks = new Set<FrameHook>();
  private poseHooks = new Set<() => void>();
  private raycaster = new Raycaster();
  private pointer = new Vector2();
  private lastFrame = 0;
  private down: { x: number; y: number; t: number } | null = null;
  private unbindInput: (() => void) | null = null;
  private firstFrameCb: (() => void) | null = null;

  constructor() {
    this.content.name = 'content';
  }

  /** Swap trackers; the content group moves to the new anchor. */
  attach(tracker: Tracker): void {
    if (this.tracker && this.tracker !== tracker) this.detach();
    this.tracker = tracker;
    tracker.anchor.add(this.content);
    this.lastFrame = performance.now();
    tracker.renderer.setAnimationLoop(this.frame);
    this.bindInput(tracker.inputElement);
  }

  detach(): void {
    const t = this.tracker;
    if (!t) return;
    t.renderer.setAnimationLoop(null);
    this.unbindInput?.();
    this.unbindInput = null;
    t.anchor.remove(this.content);
    t.stop();
    this.tracker = null;
  }

  onFirstFrame(cb: () => void): void {
    this.firstFrameCb = cb;
  }

  onFrame(hook: FrameHook): () => void {
    this.frameHooks.add(hook);
    return () => this.frameHooks.delete(hook);
  }

  /** Final pose pass after tracker and story transforms, before drawing. */
  onBeforeRender(hook: () => void): () => void {
    this.poseHooks.add(hook);
    return () => this.poseHooks.delete(hook);
  }

  /** Make an object (and its children) tappable. Returns an unregister function. */
  addTapTarget(object: Object3D, handler: TapHandler): () => void {
    this.taps.set(object, handler);
    return () => this.taps.delete(object);
  }

  private frame = (): void => {
    const now = performance.now();
    const dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    const t = this.tracker;
    if (!t) return;
    this.clock.tick(dt);
    t.update?.();
    for (const hook of this.poseHooks) hook();
    t.renderer.render(t.scene, t.camera);
    if (this.firstFrameCb) {
      this.firstFrameCb();
      this.firstFrameCb = null;
    }
    for (const hook of this.frameHooks) hook(dt);
  };

  private bindInput(el: HTMLElement): void {
    const onDown = (e: PointerEvent) => {
      this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
    };
    const onUp = (e: PointerEvent) => {
      const d = this.down;
      this.down = null;
      if (!d) return;
      const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
      if (moved > TAP_MAX_MOVE_PX || performance.now() - d.t > TAP_MAX_MS) return;
      this.handleTap(e.clientX, e.clientY, el);
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    this.unbindInput = () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
    };
  }

  private handleTap(x: number, y: number, el: HTMLElement): void {
    const t = this.tracker;
    if (!t || !t.isFound || this.clock.isPaused || this.taps.size === 0) return;
    const rect = el.getBoundingClientRect();
    this.pointer.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, t.camera);
    const hits = this.raycaster.intersectObjects([...this.taps.keys()], true);
    for (const hit of hits) {
      // Walk up to the registered ancestor.
      let o: Object3D | null = hit.object;
      while (o && !this.taps.has(o)) o = o.parent;
      if (o) {
        this.taps.get(o)!(o, hit.point);
        return;
      }
    }
  }
}
