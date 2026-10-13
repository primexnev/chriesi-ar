import { Group, SRGBColorSpace, type Camera, type Scene, type WebGLRenderer } from 'three';
import { CONFIG, type Quality } from '../config';
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

export class MindARTracker implements Tracker {
  readonly kind = 'ar' as const;
  readonly anchor = new Group();
  private mindar: MindARThree | null = null;
  private found = false;
  private foundCbs: Array<() => void> = [];
  private lostCbs: Array<() => void> = [];

  constructor(
    private readonly container: HTMLElement,
    private readonly quality: Quality,
  ) {
    // MindAR's anchor has the page in its XY plane with z out of the paper.
    // Rotate so our content can be authored y-up with the page in XZ.
    this.anchor.rotation.x = Math.PI / 2;
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
    anchor.group.add(this.anchor);
    anchor.onTargetFound = () => {
      this.found = true;
      this.foundCbs.forEach((cb) => cb());
    };
    anchor.onTargetLost = () => {
      this.found = false;
      this.lostCbs.forEach((cb) => cb());
    };

    try {
      await withTimeout(mindar.start(), CONFIG.arStartTimeoutMs);
    } catch (e) {
      this.stop();
      throw e instanceof TrackerError ? e : new TrackerError('camera-unavailable', e);
    }
  }

  stop(): void {
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
