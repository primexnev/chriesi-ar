import type { Object3D, WebGLRenderer } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';

export interface AssetReportRow {
  key: string;
  url: string;
  bytes: number;
  triangles: number;
  ms: number;
}

type Progress = (loadedBytes: number, totalBytes: number) => void;

/**
 * GLB loader with Draco mesh + KTX2 texture support and a per-asset size report.
 * The decoders (~0.3–0.8 MB) are only fetched when a model actually uses them.
 */
export class AssetLibrary {
  readonly report: AssetReportRow[] = [];
  private loader: GLTFLoader;
  private loaded = new Map<string, GLTF>();

  constructor(renderer: WebGLRenderer) {
    // three resolves its bundled decoders itself; Vite emits them as separate files.
    const draco = new DRACOLoader();
    const ktx2 = new KTX2Loader().detectSupport(renderer);
    this.loader = new GLTFLoader().setDRACOLoader(draco).setKTX2Loader(ktx2);
  }

  has(key: string): boolean {
    return this.loaded.has(key);
  }

  /** Load several models; failures are logged and skipped (placeholders take over). */
  async loadAll(entries: Record<string, string>, onProgress?: (fraction: number) => void): Promise<void> {
    const keys = Object.keys(entries);
    if (!keys.length) return;
    const progress = new Map<string, [number, number]>();
    const emit = () => {
      let loaded = 0;
      let total = 0;
      progress.forEach(([l, t]) => {
        loaded += l;
        total += t || l;
      });
      onProgress?.(total ? loaded / total : 0);
    };
    await Promise.all(
      keys.map((key) =>
        this.load(key, entries[key], (l, t) => {
          progress.set(key, [l, t]);
          emit();
        }).catch((e) => console.warn(`[assets] ${key} failed, using placeholder`, e)),
      ),
    );
  }

  async load(key: string, url: string, onProgress?: Progress): Promise<GLTF> {
    const t0 = performance.now();
    const buffer = await fetchWithProgress(url, onProgress);
    const gltf = await this.loader.parseAsync(buffer, url.replace(/[^/]*$/, ''));
    this.loaded.set(key, gltf);
    this.report.push({ key, url, bytes: buffer.byteLength, triangles: countTriangles(gltf.scene), ms: performance.now() - t0 });
    return gltf;
  }

  /** A fresh instance (rig-safe clone) of a loaded model, or null. */
  instance(key: string): Object3D | null {
    const gltf = this.loaded.get(key);
    return gltf ? skeletonClone(gltf.scene) : null;
  }

  animations(key: string): GLTF['animations'] {
    return this.loaded.get(key)?.animations ?? [];
  }

  printReport(): void {
    if (!this.report.length) {
      console.info('[assets] no GLB models loaded — all placeholders');
      return;
    }
    const total = this.report.reduce((n, r) => n + r.bytes, 0);
    console.table(
      this.report.map((r) => ({ key: r.key, KB: +(r.bytes / 1024).toFixed(1), tris: r.triangles, ms: Math.round(r.ms) })),
    );
    console.info(`[assets] total ${(total / 1024 / 1024).toFixed(2)} MB`);
  }
}

async function fetchWithProgress(url: string, onProgress?: Progress): Promise<ArrayBuffer> {
  const res = await fetch(url);
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || type.includes('text/html')) throw new Error(`HTTP ${res.status} for ${url}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  if (!res.body || !onProgress) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out.buffer;
}

export function countTriangles(root: Object3D): number {
  let tris = 0;
  root.traverse((o) => {
    const geo = (o as { geometry?: { index: { count: number } | null; attributes: { position?: { count: number } } } }).geometry;
    if (!geo) return;
    tris += (geo.index ? geo.index.count : (geo.attributes.position?.count ?? 0)) / 3;
  });
  return Math.round(tris);
}
