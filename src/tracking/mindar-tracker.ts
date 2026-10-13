import { Group, Matrix4, Quaternion, SRGBColorSpace, Vector3, type Camera, type Scene, type WebGLRenderer } from 'three';
import { CONFIG, type Quality } from '../config';
import { DeviceOrientationSource } from './device-orientation';
import { TrackerError, withTimeout, type Tracker } from './types';

type MindARModule = typeof import('mind-ar/dist/mindar-image-three.prod.js');
type MindARThree = InstanceType<MindARModule['MindARThree']>;

let modulePromise: Promise<MindARModule> | null = null;
let targetPromise: Promise<string> | null = null;

/** Lazy-load the MindAR bundle (~2 MB incl. TensorFlow.js). Only the AR path pays for it. */
function loadMindAR(): Promise<MindARModule> {
  modulePromise ??= import('mind-ar/dist/mindar-image-three.prod.js').catch((e) => {
    modulePromise = null;
    throw new TrackerError('load-failed', e);
  });
  return modulePromise;
}

/**
 * Fetch the compiled target ourselves: MindAR swallows fetch errors inside an async
 * Promise executor and would hang forever on a 404. We hand it a blob URL instead.
 */
function loadTarget(): Promise<string> {
  targetPromise ??= fetch(CONFIG.targetUrl)
    .then(async (res) => {
      const type = res.headers.get('content-type') ?? '';
      // Vite's dev server answers unknown paths with index.html.
      if (!res.ok || type.includes('text/html')) throw new TrackerError('target-missing');
      return URL.createObjectURL(await res.blob());
    })
    .catch((e) => {
      targetPromise = null;
      throw e instanceof TrackerError ? e : new TrackerError('load-failed', e);
    });
  return targetPromise;
}

/** Start downloading AR code + target in the background (call on page load, before the tap). */
export function prefetchAR(): void {
  loadMindAR().catch(() => {});
  loadTarget().catch(() => {});
}

async function requestCamera(): Promise<void> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
    stream.getTracks().forEach((t) => t.stop());
  } catch (e) {
    const name = (e as DOMException)?.name;
    const denied = name === 'NotAllowedError' || name === 'SecurityError';
    throw new TrackerError(denied ? 'camera-denied' : 'camera-unavailable', e);
  }
}

/** Smoothing per 60 fps frame: small differences = jitter (slow), large = real correction (fast). */
const SMOOTH_JITTER = 0.06;
const SMOOTH_CORRECT = 0.3;
const JITTER_POS = 0.03; // in spread widths
const JITTER_ANGLE = 0.06; // radians (~3.5°)

/**
 * Image tracking with a world-locked pose.
 *
 * MindAR measures the page relative to the camera. We combine that with the gyroscope
 * into a pose in a fixed "world" frame, smooth it there, and keep it when the page is lost.
 * Turning the phone is compensated by the gyro; moving the phone sideways is only
 * corrected when the page is visible again (the browser has no world tracking on iOS).
 * `hold: false` restores the plain behaviour (content only while the page is visible).
 */
export class MindARTracker implements Tracker {
  readonly kind = 'ar' as const;
  readonly anchor = new Group();
  private readonly root = new Group();
  private readonly orientation = new DeviceOrientationSource();
  private mindar: MindARThree | null = null;
  private target: Group | null = null;
  private found = false;
  private locked = false;
  private foundCbs: Array<() => void> = [];
  private lostCbs: Array<() => void> = [];
  private lastUpdate = 0;

  // world pose of the page
  private readonly worldPos = new Vector3();
  private readonly worldQuat = new Quaternion();
  private readonly worldScale = new Vector3(1, 1, 1);
  // scratch
  private readonly camQuat = new Quaternion();
  private readonly camRot = new Matrix4();
  private readonly measured = new Matrix4();
  private readonly mPos = new Vector3();
  private readonly mQuat = new Quaternion();
  private readonly mScale = new Vector3();

  constructor(
    private readonly container: HTMLElement,
    private readonly quality: Quality,
    private readonly hold = true,
  ) {
    // MindAR's anchor has the page in its XY plane with z out of the paper.
    // Rotate so our content can be authored y-up with the page in XZ.
    this.anchor.rotation.x = Math.PI / 2;
    this.root.matrixAutoUpdate = false;
    this.root.visible = false;
    this.root.add(this.anchor);
  }

  get renderer(): WebGLRenderer {
    return this.require().renderer;
  }
  get scene(): Scene {
    return this.require().scene;
  }
  get camera(): Camera {
    return this.require().camera;
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
    // Ask for the camera first so we can tell "denied" from other failures.
    await requestCamera();
    const [{ MindARThree }, targetUrl] = await Promise.all([loadMindAR(), loadTarget()]);

    const mindar = new MindARThree({
      container: this.container,
      imageTargetSrc: targetUrl,
      uiLoading: 'no',
      uiScanning: 'no',
      uiError: 'no',
      // Stronger smoothing: a magazine held by a child moves a lot.
      filterMinCF: 0.0001,
      filterBeta: 0.001,
      missTolerance: 8,
    });
    this.mindar = mindar;
    mindar.renderer.outputColorSpace = SRGBColorSpace;
    mindar.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality === 'lite' ? 1 : 2));

    const anchor = mindar.addAnchor(0);
    this.target = anchor.group;
    mindar.scene.add(this.root);
    anchor.onTargetFound = () => {
      if (this.found) return;
      this.found = true;
      this.foundCbs.forEach((cb) => cb());
    };
    anchor.onTargetLost = () => {
      // In hold mode the page stays where it was; the story keeps going.
      if (this.hold) return;
      this.found = false;
      this.locked = false;
      this.root.visible = false;
      this.lostCbs.forEach((cb) => cb());
    };
    void this.orientation.start();

    try {
      await withTimeout(mindar.start(), CONFIG.arStartTimeoutMs);
    } catch (e) {
      this.stop();
      throw e instanceof TrackerError ? e : new TrackerError('camera-unavailable', e);
    }
  }

  /** Per frame: fuse the latest page measurement with the gyro and place the content. */
  update(): void {
    const now = performance.now();
    const dt = this.lastUpdate ? Math.min((now - this.lastUpdate) / 1000, 0.1) : 1 / 60;
    this.lastUpdate = now;
    const target = this.target;
    if (!target) return;

    // Camera orientation in the world frame (identity without a gyro → camera frame = world).
    if (!this.orientation.read(this.camQuat)) this.camQuat.identity();
    this.camRot.makeRotationFromQuaternion(this.camQuat);

    if (target.visible) {
      // Page pose in world = camera rotation × camera-relative measurement.
      this.measured.multiplyMatrices(this.camRot, target.matrix);
      this.measured.decompose(this.mPos, this.mQuat, this.mScale);
      if (!this.locked) {
        this.worldPos.copy(this.mPos);
        this.worldQuat.copy(this.mQuat);
        this.worldScale.copy(this.mScale);
        this.locked = true;
      } else {
        const size = this.worldScale.x || 1;
        const small =
          this.mPos.distanceTo(this.worldPos) / size < JITTER_POS && this.mQuat.angleTo(this.worldQuat) < JITTER_ANGLE;
        const k = 1 - Math.pow(1 - (small ? SMOOTH_JITTER : SMOOTH_CORRECT), dt * 60);
        this.worldPos.lerp(this.mPos, k);
        this.worldQuat.slerp(this.mQuat, k);
        this.worldScale.lerp(this.mScale, k);
      }
    }
    if (!this.locked) return;

    // Back into camera space: inverse camera rotation × world pose.
    this.measured.compose(this.worldPos, this.worldQuat, this.worldScale);
    this.root.matrix.copy(this.camRot.transpose()).multiply(this.measured);
    this.root.matrixWorldNeedsUpdate = true;
    this.root.visible = true;
  }

  stop(): void {
    this.orientation.stop();
    const m = this.mindar;
    if (!m) return;
    this.mindar = null;
    try {
      m.renderer.setAnimationLoop(null);
      m.stop();
    } catch {
      /* start() may have failed half-way */
    }
    m.renderer.dispose();
    m.renderer.domElement.remove();
    (m as unknown as { cssRenderer?: { domElement: HTMLElement } }).cssRenderer?.domElement.remove();
  }

  private require(): MindARThree {
    if (!this.mindar) throw new Error('MindARTracker not started');
    return this.mindar;
  }
}
