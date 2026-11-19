import { Group, MathUtils, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, Quaternion, WebGLRenderer } from 'three';
import { CONFIG, type Quality } from '../config';
import { TrackerError, withTimeout, type Tracker } from './types';

/**
 * 8th Wall engine (distributed binary, self-hosted in public/vendor/8thwall/, see LICENSE there).
 *
 * Placement logic ported from the team's greybox (kinderkulturzug repo, branch Abdullah_Stage2,
 * web/greybox/engines/xr8.js), where it held well on the printed magazine:
 *  - The printed page PLACES the scene, SLAM HOLDS it. One image target per page (left, right).
 *  - The scene stands level: "up" comes from gravity (SLAM's world Y), never from the page, so a
 *    curved or tilted page cannot tilt it. The page only gives position, size and direction.
 *  - Sightings are ignored until SLAM is steady (NORMAL); before that, height and size are wrong.
 *  - The first placement is the average of many sightings, far-off ones left out.
 *  - While the magazine lies still, the scene does not move at all. It moves only when the page
 *    has really moved (more than MOVE_MM or MOVE_DEG for CONFIRM sightings in a row), and then
 *    glides to the average of those sightings.
 *  - The left and right page never agree exactly; their offset is learned whenever both are seen
 *    at the same moment and taken off the right page, so switching pages does not move the scene.
 *  - Odd-sized sightings are false detections; SLAM unsure for a while, a camera jump, or several
 *    agreeing new-size sightings mean SLAM restarted: the next matching sightings put it right.
 *  - The camera uses the engine's raw pose: filtering it lets the scene swim against the video.
 *
 * URL options: ?move=35 ?turn=8 (re-place thresholds in mm and degrees)
 */
const ENGINE_URL = `${import.meta.env.BASE_URL}vendor/8thwall/xr.js`;
const TARGET_DIR = `${import.meta.env.BASE_URL}assets/targets/8thwall/`;

/** The printed magazine: two 225 × 297 mm pages side by side. */
const SPREAD_MM = 450;
const PRINT_ASPECT = 297 / SPREAD_MM; // spread height / width
/** One target per page; cx = page centre on the spread (spread width = 1). */
const PAGES = [
  { name: 'page-left', cx: -0.25 },
  { name: 'page-right', cx: 0.25 },
] as const;

const PLACE_N = 20; // averaged sightings before the scene first appears
const OUTLIER_MM = 60; // while placing: sightings this far from the running mean are left out
const CONFIRM = 15; // sightings in a row beyond the threshold before the scene moves (~0.5 s)
const SETTLE = 10; // after each placement, average this many sightings into the pose
const GLIDE_S = 0.12; // time constant of the glide to a new place
const MAX_SCALE = 0.25; // a sighting whose size differs more than this is a false detection ...
const ODD_N = 8; // ... unless this many in a row agree: then SLAM changed its size
const REFIND_N = 6; // matching sightings that put the scene back after a SLAM restart
const LIMITED_MS = 500; // SLAM unsure for longer than this: re-find the magazine
const JUMP = 0.35; // camera moving more than this many spread widths in one frame: SLAM jumped
const PAIR_MS = 120; // two page sightings this close count as "seen at the same moment"
const PAIR_N = 60; // the left-right offset is the mean of up to this many pairs
const SLAM_WAIT_MS = 25_000; // after this, sightings count even if SLAM never reported NORMAL

/** Camera clip planes (engine units; the spread is a few tenths of a unit wide). */
const NEAR = 0.01;
const FAR = 100;
/** Lens intrinsics only change on resize; small changes are noise. */
const INTRINSICS_TOLERANCE = 0.02;

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
}
interface RealityResult {
  position?: XYZ;
  rotation?: XYZ & { w: number };
  intrinsics?: number[];
  trackingStatus?: 'NORMAL' | 'LIMITED' | 'NOT_AVAILABLE';
}
interface PipelineModule {
  name: string;
  onStart?(a: { canvas: HTMLCanvasElement; GLctx: WebGLRenderingContext; canvasWidth: number; canvasHeight: number }): void;
  onUpdate?(a: { processCpuResult: { reality?: RealityResult } }): void;
  onRender?(): void;
  onCanvasSizeChange?(a: { canvasWidth: number; canvasHeight: number }): void;
  onCameraStatusChange?(a: { status: 'requesting' | 'hasStream' | 'hasVideo' | 'failed' }): void;
  onException?(e: unknown): void;
  listeners?: Array<{ event: string; process: (e: { detail: never }) => void }>;
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
    updateCameraProjectionMatrix(o: {
      origin: XYZ;
      facing: XYZ & { w: number };
      cam?: { pixelRectWidth: number; pixelRectHeight: number; nearClipPlane: number; farClipPlane: number };
    }): void;
  };
  XrConfig: { device(): { ANY: unknown } };
}
interface Crop {
  left: number;
  top: number;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
}
interface TargetData {
  name: string;
  imagePath: string;
  properties: Crop;
  resources?: { luminanceImage?: string };
}
/** Where the spread centre is (room units), which way the page top points, how big the spread is. */
interface Pose {
  pos: Vector3;
  yaw: number;
  s: number;
}
type Sighting = Pose & { page: string };

declare global {
  interface Window {
    XR8?: XR8Api;
  }
}

let enginePromise: Promise<XR8Api> | null = null;
let targetPromise: Promise<TargetData[]> | null = null;

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

async function loadOneTarget(name: string): Promise<TargetData> {
  const url = new URL(`${TARGET_DIR}${name}.json`, location.href);
  const res = await fetch(url);
  if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) throw new TrackerError('target-missing');
  const data = (await res.json()) as TargetData;
  // The CLI's JSON names the luminance image in its own folder layout; point it at ours.
  const file = data.resources?.luminanceImage ?? `${name}_luminance.jpg`;
  return { ...data, imagePath: new URL(file, url).href };
}

function loadTargets(): Promise<TargetData[]> {
  targetPromise ??= Promise.all(PAGES.map((p) => loadOneTarget(p.name))).catch((e) => {
    targetPromise = null;
    throw e instanceof TrackerError ? e : new TrackerError('load-failed', e);
  });
  return targetPromise;
}

export function prefetchXR8(): void {
  loadEngine().catch(() => {});
  loadTargets().catch(() => {});
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

const angleDiff = (a: number, b: number): number => {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
};
const UP = new Vector3(0, 1, 0);

export class XR8Tracker implements Tracker {
  readonly kind = 'ar' as const;
  /** Page space (spread width = 1, y up, +z towards the reader); sits level in the room. */
  readonly anchor = new Group();
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, 1, NEAR, FAR);
  /** Level, yawed and scaled so that one unit = the spread width. */
  private readonly holder = new Group();
  private readonly canvas = document.createElement('canvas');
  private xr: XR8Api | null = null;
  private renderer_: WebGLRenderer | null = null;
  private loop: ((t: number) => void) | null = null;
  private foundCbs: Array<() => void> = [];
  private lostCbs: Array<() => void> = [];
  private intrinsics: number[] | null = null;
  private crops: Record<string, Crop> = {};
  private readonly moveMm: number;
  private readonly moveDeg: number;

  // SLAM
  private t0 = 0;
  private slamStatus = '';
  private limitedSince: number | null = null;
  private readonly lastCam = new Vector3();
  private hasLastCam = false;

  // pages in view
  private readonly visible = new Set<string>();
  private placed = false;

  // pose: target (where it should be) and current (where it is drawn)
  private target: Pose | null = null;
  private current: Pose | null = null;
  private placing: (Pose & { n: number }) | null = null;
  private settle = 0;
  private settleScale = true;
  private pending: Pose[] = [];
  private oddSize: Sighting[] = [];
  private refinding = false;
  private refindBuf: Pose[] = [];
  private readonly pair = { x: 0, z: 0, yaw: 0, n: 0 };
  private readonly lastRaw: Record<string, { pose: Sighting; at: number }> = {};
  private lastUpdate = 0;

  private readonly tmpQ = new Quaternion();
  private readonly topV = new Vector3();
  private readonly normV = new Vector3();

  constructor(
    private readonly container: HTMLElement,
    _quality: Quality,
    /** true: the scene stays in the room when the page leaves the picture (SLAM holds it). */
    private readonly hold = true,
  ) {
    const q = new URLSearchParams(location.search);
    this.moveMm = parseFloat(q.get('move') ?? '35');
    this.moveDeg = parseFloat(q.get('turn') ?? '8');
    this.holder.visible = false;
    this.holder.add(this.anchor);
    this.scene.add(this.camera, this.holder);
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
    return this.placed && (this.hold || this.visible.size > 0);
  }

  onFound(cb: () => void): void {
    this.foundCbs.push(cb);
  }
  onLost(cb: () => void): void {
    this.lostCbs.push(cb);
  }

  async start(): Promise<void> {
    await requestCamera();
    const [xr, targets] = await Promise.all([loadEngine(), loadTargets()]);
    this.xr = xr;
    this.crops = Object.fromEntries(targets.map((t) => [t.name, t.properties]));
    this.t0 = performance.now();

    // 1.5x pixels instead of 2x: less GPU work leaves more for SLAM on older phones
    const dpr = Math.min(window.devicePixelRatio, 1.5);
    this.canvas.width = Math.round(this.container.clientWidth * dpr);
    this.canvas.height = Math.round(this.container.clientHeight * dpr);
    this.container.appendChild(this.canvas);

    const started = new Promise<void>((resolve, reject) => {
      const onImage = (d: ImageDetail) => {
        this.pageIn(d.name);
        this.onSighting(d);
      };
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
          xr.XrController.updateCameraProjectionMatrix({
            origin: this.camera.position,
            facing: this.camera.quaternion,
            cam: { pixelRectWidth: canvasWidth, pixelRectHeight: canvasHeight, nearClipPlane: NEAR, farClipPlane: FAR },
          });
          resolve();
        },
        onUpdate: ({ processCpuResult }) => {
          const r = processCpuResult.reality;
          if (!r) return;
          if (r.trackingStatus) this.slamStatus = r.trackingStatus;
          if (r.intrinsics) this.setProjection(r.intrinsics);
          if (r.position && r.rotation) {
            this.camera.position.set(r.position.x, r.position.y, r.position.z);
            this.camera.quaternion.set(r.rotation.x, r.rotation.y, r.rotation.z, r.rotation.w);
          }
          const now = performance.now();
          this.watchSlam(r, now);
          this.glide(now);
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
          { event: 'reality.imagefound', process: (e: { detail: ImageDetail }) => onImage(e.detail) },
          { event: 'reality.imageupdated', process: (e: { detail: ImageDetail }) => onImage(e.detail) },
          { event: 'reality.imagelost', process: (e: { detail?: { name?: string } }) => this.pageOut(e.detail?.name) },
          {
            event: 'reality.trackingstatus',
            process: (e: { detail: { status: string } }) => void (this.slamStatus = e.detail.status),
          },
        ] as PipelineModule['listeners'],
      };
      xr.XrController.configure({ imageTargetData: targets, disableWorldTracking: false });
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

  private setProjection(m: number[]): void {
    const old = this.intrinsics;
    if (old && m.every((v, i) => Math.abs(v - old[i]) <= INTRINSICS_TOLERANCE * Math.max(Math.abs(old[i]), 1e-3))) return;
    this.intrinsics = m.slice();
    const cam = this.camera;
    cam.projectionMatrix.fromArray(m);
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  }

  // ---------- found / lost: the story hears "found" when the scene is placed and a page is in view

  private pageIn(name: string): void {
    const was = this.visible.size;
    this.visible.add(name);
    if (this.placed && was === 0 && !this.hold) this.foundCbs.forEach((cb) => cb());
  }

  private pageOut(name?: string): void {
    if (name) this.visible.delete(name);
    else this.visible.clear();
    // With SLAM the scene stays where it was on the table; the story keeps going.
    if (this.placed && this.visible.size === 0 && !this.hold) this.lostCbs.forEach((cb) => cb());
  }

  private slamSteady(): boolean {
    return this.slamStatus === 'NORMAL' || performance.now() - this.t0 > SLAM_WAIT_MS;
  }

  // ---------- a page sighting -> spread centre, direction of the page top, spread size

  private poseFromSighting(d: ImageDetail): Sighting | null {
    const crop = this.crops[d.name];
    const page = PAGES.find((p) => p.name === d.name);
    if (!crop || !page) return null;
    const q = this.tmpQ.set(d.rotation.x, d.rotation.y, d.rotation.z, d.rotation.w);
    // 8th Wall: a flat target lies in its local XY plane, +Y to the image top, +Z out of the image,
    // and the cropped area is 1 unit tall once d.scale is applied
    const cropH = crop.height;
    const pageHeight = (d.scale * crop.originalHeight) / cropH; // room units
    const s = pageHeight / PRINT_ASPECT; // room units per spread width
    const offX = -(crop.left + crop.width / 2 - crop.originalWidth / 2) / cropH;
    const offY = (crop.top + crop.height / 2 - crop.originalHeight / 2) / cropH;
    const pos = new Vector3(offX * d.scale, offY * d.scale, 0).applyQuaternion(q).add(new Vector3(d.position.x, d.position.y, d.position.z));
    // direction of the page top, flattened onto the floor; a page held upright uses its back instead
    const top = this.topV.set(0, 1, 0).applyQuaternion(q);
    top.y = 0;
    if (top.lengthSq() < 0.09) {
      this.normV.set(0, 0, -1).applyQuaternion(q);
      this.normV.y = 0;
      top.copy(this.normV);
    }
    top.normalize();
    const right = new Vector3().crossVectors(top, UP).normalize();
    pos.addScaledVector(right, -page.cx * s);
    return { pos, yaw: Math.atan2(-top.x, -top.z), s, page: d.name };
  }

  /** The right page's offset from the left one, in the spread's own frame (spread units). */
  private learnPair(raw: Sighting, now: number): void {
    const other = this.lastRaw[raw.page === 'page-left' ? 'page-right' : 'page-left'];
    if (!other || now - other.at > PAIR_MS) return;
    const left = raw.page === 'page-left' ? raw : other.pose;
    const right = raw.page === 'page-left' ? other.pose : raw;
    const local = right.pos.clone().sub(left.pos).applyAxisAngle(UP, -left.yaw).divideScalar(left.s);
    if (Math.hypot(local.x, local.z) > 0.2) return; // about 90 mm apart: one of them is wrong
    const p = this.pair;
    p.n = Math.min(p.n + 1, PAIR_N);
    p.x += (local.x - p.x) / p.n;
    p.z += (local.z - p.z) / p.n;
    p.yaw += angleDiff(angleDiff(right.yaw, left.yaw), p.yaw) / p.n;
  }

  /** A right-page sighting, expressed as if the left page had seen it. */
  private corrected(raw: Sighting): Pose {
    if (raw.page !== 'page-right') return { pos: raw.pos.clone(), yaw: raw.yaw, s: raw.s };
    const off = new Vector3(this.pair.x, 0, this.pair.z).multiplyScalar(raw.s).applyAxisAngle(UP, raw.yaw);
    return { pos: raw.pos.clone().sub(off), yaw: raw.yaw - this.pair.yaw, s: raw.s };
  }

  private onSighting(d: ImageDetail): void {
    const raw = this.poseFromSighting(d);
    if (!raw || !this.slamSteady()) return;
    const now = performance.now();
    if (this.placed && this.refinding) return this.collectRefind(raw);

    // The page cannot change its size: one odd-sized sighting is a false detection. Several that
    // agree with each other mean SLAM restarted with a new sense of size: re-find with them.
    const target = this.target;
    if (target && Math.abs(raw.s / target.s - 1) > MAX_SCALE) {
      this.oddSize.push(raw);
      const ss = this.oddSize.map((o) => o.s);
      if (this.placed && this.oddSize.length >= ODD_N && Math.max(...ss) / Math.min(...ss) < 1.1) {
        const odd = this.oddSize;
        this.startRefind();
        odd.forEach((o) => this.collectRefind(o));
      }
      if (this.oddSize.length > ODD_N) this.oddSize.shift();
      return;
    }
    this.oddSize = [];
    this.learnPair(raw, now);
    this.lastRaw[raw.page] = { pose: raw, at: now };
    const c = this.corrected(raw);

    if (!this.placed) return this.collectPlacing(c);

    const mmPerUnit = SPREAD_MM / target!.s;
    const dmm = c.pos.distanceTo(target!.pos) * mmPerUnit;
    const ddeg = Math.abs(MathUtils.radToDeg(angleDiff(c.yaw, target!.yaw)));
    if (dmm > this.moveMm || ddeg > this.moveDeg) {
      this.pending.push(c);
      if (this.pending.length >= CONFIRM) {
        // the magazine has moved: go to the average of these sightings, keeping the scene's size
        const pos = new Vector3();
        let yaw = 0;
        const first = this.pending[0];
        this.pending.forEach((p) => {
          pos.add(p.pos);
          yaw += angleDiff(p.yaw, first.yaw);
        });
        this.target = { pos: pos.divideScalar(this.pending.length), yaw: first.yaw + yaw / this.pending.length, s: target!.s };
        this.settle = 1;
        this.settleScale = false;
        this.pending = [];
      }
      return;
    }
    this.pending = [];
    if (this.settle > 0 && this.settle < SETTLE) {
      // right after a placement: average the next sightings in, for a calmer pose
      this.settle++;
      const k = 1 / this.settle;
      target!.pos.lerp(c.pos, k);
      target!.yaw += angleDiff(c.yaw, target!.yaw) * k;
      if (this.settleScale) target!.s += (c.s - target!.s) * k;
      return;
    }
    this.settle = 0; // still magazine: page detection noise is ignored
  }

  /** Before the scene appears: average every good sighting, then place it. */
  private collectPlacing(c: Pose): void {
    const p = this.placing;
    if (!p) {
      this.placing = { pos: c.pos.clone(), yaw: c.yaw, s: c.s, n: 1 };
    } else {
      if (p.n >= 10 && (c.pos.distanceTo(p.pos) * SPREAD_MM) / p.s > OUTLIER_MM) return;
      p.n++;
      const k = 1 / p.n;
      p.pos.lerp(c.pos, k);
      p.yaw += angleDiff(c.yaw, p.yaw) * k;
      p.s += (c.s - p.s) * k;
    }
    const pl = this.placing!;
    this.target = { pos: pl.pos.clone(), yaw: pl.yaw, s: pl.s };
    if (pl.n < PLACE_N) return;
    this.current = { pos: pl.pos.clone(), yaw: pl.yaw, s: pl.s };
    this.placing = null;
    this.placed = true;
    this.settle = 1;
    this.settleScale = true;
    this.holder.visible = true;
    this.applyCurrent();
    this.foundCbs.forEach((cb) => cb());
    if (!this.hold && this.visible.size === 0) this.lostCbs.forEach((cb) => cb());
  }

  // ---------- re-find: SLAM may have lost itself; the scene stays visible and glides back

  private startRefind(): void {
    if (!this.placed || this.refinding) return;
    this.refinding = true;
    this.refindBuf = [];
    this.pending = [];
    this.oddSize = [];
  }

  private collectRefind(raw: Sighting): void {
    if (!this.refinding) return;
    const buf = this.refindBuf;
    buf.push(this.corrected(raw));
    if (buf.length > REFIND_N) buf.shift();
    if (buf.length < REFIND_N) return;
    // do the last REFIND_N sightings agree (within 25 mm, 5°, 8 % size)?
    const pos = new Vector3();
    let yaw = 0;
    let s = 0;
    buf.forEach((p) => {
      pos.add(p.pos);
      yaw += angleDiff(p.yaw, buf[0].yaw);
      s += p.s;
    });
    pos.divideScalar(REFIND_N);
    yaw = buf[0].yaw + yaw / REFIND_N;
    s /= REFIND_N;
    const agree = buf.every(
      (p) =>
        (p.pos.distanceTo(pos) * SPREAD_MM) / s < 25 &&
        Math.abs(MathUtils.radToDeg(angleDiff(p.yaw, yaw))) < 5 &&
        Math.abs(p.s / s - 1) < 0.08,
    );
    if (!agree) return;
    this.target = { pos, yaw, s };
    this.settle = 1;
    this.settleScale = true;
    this.refinding = false;
  }

  private watchSlam(r: RealityResult, now: number): void {
    if (!this.placed || !this.target) return;
    if (r.trackingStatus === 'LIMITED') {
      this.limitedSince ??= now;
      if (now - this.limitedSince > LIMITED_MS) this.startRefind();
    } else this.limitedSince = null;
    if (r.position) {
      const p = new Vector3(r.position.x, r.position.y, r.position.z);
      if (this.hasLastCam && p.distanceTo(this.lastCam) / this.target.s > JUMP) this.startRefind();
      this.lastCam.copy(p);
      this.hasLastCam = true;
    }
  }

  // ---------- drawing: glide the drawn pose to the held one

  private glide(now: number): void {
    const dt = this.lastUpdate ? Math.min((now - this.lastUpdate) / 1000, 0.1) : 1 / 60;
    this.lastUpdate = now;
    const t = this.target;
    const c = this.current;
    if (!this.placed || !t || !c) return;
    const k = 1 - Math.exp(-dt / GLIDE_S);
    c.pos.lerp(t.pos, k);
    c.yaw += angleDiff(t.yaw, c.yaw) * k;
    c.s += (t.s - c.s) * k;
    this.applyCurrent();
  }

  private applyCurrent(): void {
    const c = this.current!;
    this.holder.position.copy(c.pos);
    this.holder.rotation.set(0, c.yaw, 0);
    this.holder.scale.setScalar(c.s);
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
