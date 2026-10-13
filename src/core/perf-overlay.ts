import type { Stage } from './stage';

/**
 * Dev overlay: fps, frame time, draw calls, triangles, time to first frame and
 * bytes downloaded so far. On in `npm run dev`, or with `?perf` on any build.
 */
export function mountPerfOverlay(parent: HTMLElement, stage: Stage, info: () => string): void {
  const el = document.createElement('pre');
  el.className = 'perf';
  el.setAttribute('aria-hidden', 'true');
  parent.appendChild(el);

  let frames = 0;
  let acc = 0;
  let worst = 0;
  let firstFrameMs: number | null = null;
  const tapMs = performance.getEntriesByName('start-tap')[0]?.startTime;

  stage.onFrame((dt) => {
    if (firstFrameMs === null) firstFrameMs = performance.now();
    frames++;
    acc += dt;
    worst = Math.max(worst, dt);
    if (acc < 0.5) return;
    const fps = frames / acc;
    const r = stage.tracker?.renderer.info.render;
    const kb = downloadedBytes() / 1024;
    const tap = performance.getEntriesByName('start-tap')[0]?.startTime ?? tapMs;
    el.textContent = [
      `${fps.toFixed(0)} fps  worst ${(worst * 1000).toFixed(0)} ms`,
      `draws ${r?.calls ?? '-'}  tris ${r?.triangles ?? '-'}`,
      `1st frame ${(firstFrameMs / 1000).toFixed(2)} s${tap ? `  (tap→ ${((firstFrameMs - tap) / 1000).toFixed(2)} s)` : ''}`,
      `loaded ${kb > 1024 ? `${(kb / 1024).toFixed(2)} MB` : `${kb.toFixed(0)} KB`}`,
      info(),
    ].join('\n');
    el.classList.toggle('is-bad', fps < 30);
    frames = 0;
    acc = 0;
    worst = 0;
  });
}

function downloadedBytes(): number {
  const entries = [
    ...performance.getEntriesByType('navigation'),
    ...performance.getEntriesByType('resource'),
  ] as PerformanceResourceTiming[];
  // transferSize is 0 for cache hits and cross-origin; fall back to the body size.
  return entries.reduce((n, e) => n + (e.transferSize || e.encodedBodySize || 0), 0);
}
