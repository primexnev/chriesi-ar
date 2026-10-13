/** Central tunables. Everything that is a "magic number" for UX timing lives here. */

const base = import.meta.env.BASE_URL;

export const CONFIG = {
  /** Compiled MindAR target for the printed double page (see tools/compile-target.html). */
  targetUrl: `${base}assets/targets/spread.mind`,
  modelsUrl: `${base}assets/models/`,
  narrationUrl: `${base}assets/audio/narration/`,

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
