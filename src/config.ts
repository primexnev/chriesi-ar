/** Central tunables. Everything that is a "magic number" for UX timing lives here. */

const base = import.meta.env.BASE_URL;

export const CONFIG = {
  /** Compiled MindAR target for the printed double page (see tools/compile-target.html). */
  targetUrl: `${base}assets/targets/spread.mind`,
  modelsUrl: `${base}assets/models/`,
  narrationUrl: `${base}assets/audio/narration/`,
  musicUrl: `${base}assets/audio/music/`,

  /** Printed double page: two A4 portrait pages side by side (420 × 297 mm). */
  spreadAspect: 420 / 297,

  /** If the camera/AR pipeline is not running after this, fall back to the 3D view. */
  arStartTimeoutMs: 20_000,
  /** Show the "switch to 3D view" escape button if the page was not found / lost for this long. */
  scanHelpAfterMs: 10_000,
  /** Grace period before a short tracking drop pauses the story (avoids flicker). */
  lostGraceMs: 600,

  /** Interaction pacing — the child can never fail; the story always moves on. */
  bellHintAfterMs: 9_000,
  bellAutoRingAfterMs: 20_000,
  pickIdleHintAfterMs: 12_000,
  pickAutoFinishAfterMs: 40_000,
} as const;

export type Quality = 'full' | 'lite';

/**
 * Render resolution: phones get at most 1.5× (a 3× screen at 2× drew four times the pixels of 1×
 * for little visible gain, and the AR camera tracking already needs the processor); desktops 2×.
 */
export function maxPixelRatio(quality: Quality): number {
  if (quality === 'lite') return 1;
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return Math.min(window.devicePixelRatio, touch ? 1.5 : 2);
}
