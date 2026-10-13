import type { Quality } from '../config';

export interface Capabilities {
  webgl: boolean;
  camera: boolean;
  secureContext: boolean;
  isIOS: boolean;
  quality: Quality;
}

export type StartMode = 'ar' | '3d' | '2d';

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function detectQuality(params: URLSearchParams): Quality {
  if (params.has('lite')) return 'lite';
  if (params.has('full')) return 'full';
  const nav = navigator as Navigator & { deviceMemory?: number };
  const lowCores = (navigator.hardwareConcurrency ?? 8) <= 4;
  const lowMemory = (nav.deviceMemory ?? 8) <= 2;
  return lowCores || lowMemory ? 'lite' : 'full';
}

export function detectCapabilities(params = new URLSearchParams(location.search)): Capabilities {
  const isIOS =
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return {
    webgl: hasWebGL(),
    camera: !!navigator.mediaDevices?.getUserMedia,
    secureContext: window.isSecureContext,
    isIOS,
    quality: detectQuality(params),
  };
}

/**
 * Which experience to start. `?mode=ar|3d|2d` forces a mode for testing.
 * Desktop browsers without a touch screen default to the 3D view (no magazine in front of a laptop).
 */
export function chooseStartMode(caps: Capabilities, params = new URLSearchParams(location.search)): StartMode {
  const forced = params.get('mode');
  if (forced === '2d') return '2d';
  if (!caps.webgl) return '2d';
  if (forced === '3d') return '3d';
  if (forced === 'ar') return 'ar';
  if (!caps.camera || !caps.secureContext) return '3d';
  const isTouch = navigator.maxTouchPoints > 0;
  return isTouch ? 'ar' : '3d';
}
