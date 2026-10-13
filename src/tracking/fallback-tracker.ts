import {
  Color,
  Group,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CONFIG, type Quality } from '../config';
import { PALETTE } from '../scenes/shared/palette';
import type { Tracker } from './types';

/**
 * Non-AR 3D view: the double page lies on a virtual table, the family can turn it
 * with one finger. Used when the camera is denied/unavailable, on desktop, or on request.
 */
export class FallbackTracker implements Tracker {
  readonly kind = '3d' as const;
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(38, 1, 0.01, 20);
  readonly anchor = new Group();
  readonly isFound = true;
  private controls: OrbitControls;
  private resizeObserver: ResizeObserver;
  private foundCbs: Array<() => void> = [];
  private readonly home = new Vector3(0, 0.06, 0);
  private readonly homeDistance: number;
  private focusTarget: Vector3 | null = null;
  private focusDistance = 0;

  constructor(
    private readonly container: HTMLElement,
    quality: Quality,
  ) {
    this.renderer = new WebGLRenderer({ antialias: quality === 'full', powerPreference: 'default' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'lite' ? 1 : 2));
    this.renderer.domElement.className = 'stage-canvas';
    this.scene.background = new Color(PALETTE.sky);

    // The printed spread as a sheet of paper under the scene.
    const depth = 1 / CONFIG.spreadAspect;
    const paper = new Mesh(
      new PlaneGeometry(1.04, depth + 0.04),
      new MeshLambertMaterial({ color: PALETTE.paper }),
    );
    paper.rotation.x = -Math.PI / 2;
    paper.position.y = -0.002;
    const table = new Mesh(new PlaneGeometry(6, 6), new MeshLambertMaterial({ color: PALETTE.table }));
    table.rotation.x = -Math.PI / 2;
    table.position.y = -0.004;
    this.scene.add(table, paper, this.anchor);

    this.camera.position.set(0, 0.62, 0.92);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(this.home);
    this.homeDistance = this.camera.position.distanceTo(this.home);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.minDistance = 0.55;
    this.controls.maxDistance = 1.8;
    this.controls.minPolarAngle = 0.35;
    this.controls.maxPolarAngle = 1.35;
    this.controls.minAzimuthAngle = -0.9;
    this.controls.maxAzimuthAngle = 0.9;
    this.controls.update();

    this.resizeObserver = new ResizeObserver(() => this.resize());
  }

  get inputElement(): HTMLElement {
    return this.renderer.domElement;
  }

  onFound(cb: () => void): void {
    this.foundCbs.push(cb);
  }
  onLost(): void {
    /* never loses the page */
  }

  async start(): Promise<void> {
    this.container.appendChild(this.renderer.domElement);
    this.resizeObserver.observe(this.container);
    this.resize();
    this.renderer.setAnimationLoop(null);
    queueMicrotask(() => this.foundCbs.forEach((cb) => cb()));
  }

  /** Called by the stage each frame. */
  update(): void {
    const target = this.focusTarget;
    if (target) {
      // Glide towards the focus point, keeping the current viewing direction.
      const t = this.controls.target;
      const delta = target.clone().sub(t).multiplyScalar(0.04);
      t.add(delta);
      this.camera.position.add(delta);
      const offset = this.camera.position.clone().sub(t);
      const len = offset.length();
      offset.setLength(len + (this.focusDistance - len) * 0.04);
      this.camera.position.copy(t).add(offset);
      if (delta.length() < 1e-4 && Math.abs(len - this.focusDistance) < 1e-3) this.focusTarget = null;
    }
    this.controls.update();
  }

  focus(target: Vector3 | null, distance?: number): void {
    this.focusTarget = (target ?? this.home).clone();
    this.focusDistance = target ? (distance ?? 0.6) : this.homeDistance;
  }

  stop(): void {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    // Keep the whole spread in view in portrait: pull back on narrow screens.
    const portrait = h > w;
    this.camera.fov = portrait ? 52 : 38;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }
}
