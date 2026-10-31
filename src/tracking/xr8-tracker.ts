import {
  Group,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { CONFIG, type Quality } from '../config';
import { TrackerError, withTimeout, type Tracker } from './types';

/**
 * 8th Wall engine (distributed binary, self-hosted in public/vendor/8thwall/, see LICENSE there).
 * It tracks the image *and* the room (SLAM): once the page was seen, the content stays fixed
 * on the table even when the camera moves away or the page is covered by a hand.
 */
const ENGINE_URL = `${import.meta.env.BASE_URL}vendor/8thwall/xr.js`;
const TARGET_URL = `${import.meta.env.BASE_URL}assets/targets/8thwall/spread.json`;

interface XYZ {
  x: number;
  y: number;
  z: number;
}
interface ImageDetail {
  name: string;
  position: XYZ;
  rotation: XYZ & { w: number };
  scale: number;
  scaledWidth: number;
  scaledHeight: number;
}
interface RealityResult {
  position: XYZ;
  rotation: XYZ & { w: number };
  intrinsics: number[];
}
interface PipelineModule {
  name: string;
  onStart?(a: { canvas: HTMLCanvasElement; GLctx: WebGLRenderingContext; canvasWidth: number; canvasHeight: number }): void;
  onUpdate?(a: { processCpuResult: { reality?: RealityResult } }): void;
  onRender?(): void;
  onCanvasSizeChange?(a: { canvasWidth: number; canvasHeight: number }): void;
  onCameraStatusChange?(a: { status: 'requesting' | 'hasStream' | 'hasVideo' | 'failed' }): void;
  onException?(e: unknown): void;
  listeners?: Array<{ event: string; process: (e: { detail: ImageDetail }) => void }>;
}
interface XR8Api {
  addCameraPipelineModules(m: unknown[]): void;
  clearCameraPipelineModules(): void;
  run(o: { canvas: HTMLCanvasElement; allowedDevices?: unknown }): void;
  stop(): void;
  GlTextureRenderer: { pipelineModule(): unknown };
  XrController: {
    pipelineModule(): unknown;
    configure(o: { imageTargetData?: unknown[]; disableWorldTracking?: boolean }): void;
    updateCameraProjectionMatrix(o: { origin: XYZ; facing: XYZ & { w: number } }): void;
  };
  XrConfig: { device(): { ANY: unknown } };
}
interface TargetData {
  imagePath: string;
  properties: { width: number; height: number; isRotated: boolean; originalWidth: number; originalHeight: number };
}

declare global {
  interface Window {
    XR8?: XR8Api;
  }
}

let enginePromise: Promise<XR8Api> | null = null;
let targetPromise: Promise<TargetData> | null = null;

/** Classic script tag: the engine finds its SLAM chunk next to itself (`data-preload-chunks`). */
function loadEngine(): Promise<XR8Api> {
  enginePromise ??= new Promise<XR8Api>((resolve, reject) => {
    if (window.XR8) return resolve(window.XR8);
    const s = document.createElement('script');
    s.src = ENGINE_URL;
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.dataset.preloadChunks = 'slam';
    s.onerror = (e) => reject(new TrackerError('load-failed', e));
    window.addEventListener('xrloaded', () => resolve(window.XR8!), { once: true });
    document.head.appendChild(s);
  }).catch((e) => {
    enginePromise = null;
    throw e;
  });
  return enginePromise;
}

function loadTarget(): Promise<TargetData> {
  targetPromise ??= fetch(TARGET_URL)
    .then(async (res) => {
      if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) throw new TrackerError('target-missing');
      const data = (await res.json()) as TargetData;
      // The JSON names the luminance image relative to itself; the engine wants a URL.
      return { ...data, imagePath: new URL(data.imagePath, new URL(TARGET_URL, location.href)).href };
    })
    .catch((e) => {
      targetPromise = null;
      throw e instanceof TrackerError ? e : new TrackerError('load-failed', e);
    });
  return targetPromise;
}

export function prefetchXR8(): void {
  loadEngine().catch(() => {});
  loadTarget().catch(() => {});
}

/**
 * Page width in engine units per unit of `scale`. The engine reports the cropped target
 * (4:3, as the CLI cuts it) with its shorter side = 1; the crop is centred on the spread.
 */
function pageWidthFactor({ properties: p }: TargetData): number {
  const [cropW, cropH, fullW] = p.isRotated ? [p.height, p.width, p.originalHeight] : [p.width, p.height, p.originalWidth];
  return (cropW / Math.min(cropW, cropH)) * (fullW / cropW);
}

async function requestCamera(): Promise<void> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    stream.getTracks().forEach((t) => t.stop());
  } catch (e) {
    const name = (e as DOMException)?.name;
    throw new TrackerError(name === 'NotAllowedError' || name === 'SecurityError' ? 'camera-denied' : 'camera-unavailable', e);
  }
}

/** The page lies still on the table: tiny pose changes are noise, larger ones a real correction. */
const SMOOTH_JITTER = 0.05;
const SMOOTH_CORRECT = 0.25;
const JITTER_POS = 0.02; // in page widths
const JITTER_ANGLE = 0.05; // radians (~3°)

export class XR8Tracker implements Tracker {
  readonly kind = 'ar' as const;
  readonly anchor = new Group();
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, 1, 0.01, 1000);
  private readonly root = new Group();
  private readonly canvas = document.createElement('canvas');
  private xr: XR8Api | null = null;
  private renderer_: WebGLRenderer | null = null;
  private loop: ((t: number) => void) | null = null;
  private found = false;
  private foundCbs: Array<() => void> = [];
  private lostCbs: Array<() => void> = [];
  private lastUpdate = 0;

  // latest measurement and the smoothed pose (engine world space)
  private hasMeasure = false;
  private locked = false;
  private readonly mPos = new Vector3();
  private readonly mQuat = new Quaternion();
  private mScale = 1;
  private readonly pos = new Vector3();
  private readonly quat = new Quaternion();
  private scale = 1;
  private readonly scaleVec = new Vector3();

  constructor(
    private readonly container: HTMLElement,
    _quality: Quality,
    private readonly hold = true,
  ) {
    // Engine target frame: image in XY, +y = top of the page, z out of the paper.
    // Our content is authored y-up with the page in XZ (+z towards the reader).
    this.anchor.rotation.x = Math.PI / 2;
    this.root.matrixAutoUpdate = false;
    this.root.visible = false;
    this.root.add(this.anchor);
    this.scene.add(this.camera, this.root);
    this.canvas.className = 'stage-canvas';
  }

  get renderer(): WebGLRenderer {
    if (!this.renderer_) throw new Error('XR8Tracker not started');
    return this.renderer_;
  }
  get inputElement(): HTMLElement {
    return this.container;
  }
  get isFound(): boolean {
    return this.found;
  }

  onFound(cb: () => void): void {
    this.foundCbs.push(cb);
  }
  onLost(cb: () => void): void {
    this.lostCbs.push(cb);
  }

  async start(): Promise<void> {
    await requestCamera();
    const [xr, target] = await Promise.all([loadEngine(), loadTarget()]);
    this.xr = xr;
    this.anchor.scale.setScalar(pageWidthFactor(target));

    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = Math.round(this.container.clientWidth * dpr);
    this.canvas.height = Math.round(this.container.clientHeight * dpr);
    this.container.appendChild(this.canvas);

    const started = new Promise<void>((resolve, reject) => {
      const onImage = (e: { detail: ImageDetail }) => this.measure(e.detail);
      const module: PipelineModule = {
        name: 'chriesi',
        onStart: ({ canvas, GLctx, canvasWidth, canvasHeight }) => {
          const r = new WebGLRenderer({ canvas, context: GLctx, antialias: true, alpha: false });
          r.autoClear = false;
          r.outputColorSpace = SRGBColorSpace;
          r.setPixelRatio(1);
          r.setSize(canvasWidth, canvasHeight, false);
          // The engine owns the run loop: the stage's loop is called from onRender instead.
          r.setAnimationLoop = (cb) => void (this.loop = cb as ((t: number) => void) | null);
          this.renderer_ = r;
          xr.XrController.updateCameraProjectionMatrix({ origin: this.camera.position, facing: this.camera.quaternion });
          resolve();
        },
        onUpdate: ({ processCpuResult }) => {
          const reality = processCpuResult.reality;
          if (!reality?.intrinsics) return;
          const cam = this.camera;
          cam.projectionMatrix.fromArray(reality.intrinsics);
          cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
          cam.quaternion.set(reality.rotation.x, reality.rotation.y, reality.rotation.z, reality.rotation.w);
          cam.position.set(reality.position.x, reality.position.y, reality.position.z);
          this.place();
        },
        onRender: () => {
          const r = this.renderer_;
          if (!r || !this.loop) return;
          // The engine has just drawn the camera image with its own GL calls.
          r.resetState();
          r.clearDepth();
          this.loop(performance.now());
        },
        onCanvasSizeChange: ({ canvasWidth, canvasHeight }) => this.renderer_?.setSize(canvasWidth, canvasHeight, false),
        onCameraStatusChange: ({ status }) => {
          if (status === 'failed') reject(new TrackerError('camera-unavailable'));
        },
        onException: (e) => reject(new TrackerError('load-failed', e)),
        listeners: [
          { event: 'reality.imagefound', process: onImage },
          { event: 'reality.imageupdated', process: onImage },
          { event: 'reality.imagelost', process: () => this.lose() },
        ],
      };
      xr.XrController.configure({ imageTargetData: [target], disableWorldTracking: false });
      xr.addCameraPipelineModules([xr.GlTextureRenderer.pipelineModule(), xr.XrController.pipelineModule(), module]);
      xr.run({ canvas: this.canvas, allowedDevices: xr.XrConfig.device().ANY });
    });

    try {
      await withTimeout(started, CONFIG.arStartTimeoutMs);
    } catch (e) {
      this.stop();
      throw e instanceof TrackerError ? e : new TrackerError('camera-unavailable', e);
    }
  }

  private measure(d: ImageDetail): void {
    this.mPos.set(d.position.x, d.position.y, d.position.z);
    this.mQuat.set(d.rotation.x, d.rotation.y, d.rotation.z, d.rotation.w);
    this.mScale = d.scale;
    this.hasMeasure = true;
    if (!this.found) {
      this.found = true;
      this.foundCbs.forEach((cb) => cb());
    }
  }

  private lose(): void {
    this.hasMeasure = false;
    // With SLAM the page stays where it was on the table; the story keeps going.
    if (this.hold) return;
    this.found = false;
    this.locked = false;
    this.root.visible = false;
    this.lostCbs.forEach((cb) => cb());
  }

  /** Smooth the page pose in world space (the page does not move, only the measurement jitters). */
  private place(): void {
    const now = performance.now();
    const dt = this.lastUpdate ? Math.min((now - this.lastUpdate) / 1000, 0.1) : 1 / 60;
    this.lastUpdate = now;
    if (this.hasMeasure) {
      if (!this.locked) {
        this.pos.copy(this.mPos);
        this.quat.copy(this.mQuat);
        this.scale = this.mScale;
        this.locked = true;
      } else {
        const size = this.scale * this.anchor.scale.x || 1;
        const small = this.mPos.distanceTo(this.pos) / size < JITTER_POS && this.mQuat.angleTo(this.quat) < JITTER_ANGLE;
        const k = 1 - Math.pow(1 - (small ? SMOOTH_JITTER : SMOOTH_CORRECT), dt * 60);
        this.pos.lerp(this.mPos, k);
        this.quat.slerp(this.mQuat, k);
        this.scale += (this.mScale - this.scale) * k;
      }
    }
    if (!this.locked) return;
    this.root.matrix.compose(this.pos, this.quat, this.scaleVec.setScalar(this.scale));
    this.root.matrixWorldNeedsUpdate = true;
    this.root.visible = true;
  }

  stop(): void {
    const xr = this.xr;
    if (!xr) return;
    this.xr = null;
    try {
      xr.stop();
      xr.clearCameraPipelineModules();
    } catch {
      /* start() may have failed half-way */
    }
    this.renderer_?.dispose();
    this.canvas.remove();
  }
}
