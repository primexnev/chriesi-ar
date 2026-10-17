import './style.css';
import { CONFIG } from './config';
import { AudioEngine } from './audio/audio-engine';
import { Narrator } from './audio/narrator';
import { Sfx } from './audio/sfx';
import { AssetLibrary } from './core/assets';
import { chooseStartMode, detectCapabilities } from './core/capabilities';
import { mountPerfOverlay } from './core/perf-overlay';
import { Stage } from './core/stage';
import { runIntro } from './scenes/intro';
import { runScene1 } from './scenes/scene1';
import { Models, modelUrls } from './scenes/shared/models';
import type { StoryContext } from './story/context';
import { FallbackTracker } from './tracking/fallback-tracker';
import { requestOrientationPermission } from './tracking/device-orientation';
import { MindARTracker, prefetchAR } from './tracking/mindar-tracker';
import { TrackerError, type Tracker } from './tracking/types';
import { Hud } from './ui/hud';
import { Loading, notify, ScanHint, showFatal, showStartScreen } from './ui/overlays';
import { Subtitles } from './ui/subtitles';

const params = new URLSearchParams(location.search);
const caps = detectCapabilities(params);
const mode = chooseStartMode(caps, params);
const showPerf = import.meta.env.DEV || params.has('perf');

const stageEl = document.getElementById('stage')!;
const uiEl = document.getElementById('ui')!;

const audio = new AudioEngine();
const subtitles = new Subtitles(uiEl);

// Start fetching the AR bundle and target while the family looks at the start screen.
if (mode === 'ar') prefetchAR();

showStartScreen(uiEl, () => {
  performance.mark('start-tap');
  audio.unlock(); // must happen synchronously inside the tap (iOS)
  if (mode === 'ar') void requestOrientationPermission(); // gyro for the world-locked pose (iOS asks here)
  void (mode === '2d' ? start2D() : start3D());
});

// ---------------------------------------------------------------------------- 2D

async function start2D(): Promise<void> {
  const { run2D } = await import('./fallback2d/fallback2d');
  await run2D(uiEl, stageEl, audio, subtitles);
}

// ---------------------------------------------------------------------------- AR / 3D

const FAILURE_TEXT: Record<string, string> = {
  'camera-denied': 'Ohne Kamera geht es auch: Die Geschichte läuft jetzt in 3D.',
  'camera-unavailable': 'Die Kamera ist nicht verfügbar. Die Geschichte läuft in 3D.',
  'target-missing': 'AR ist noch nicht bereit. Die Geschichte läuft in 3D.',
  'load-failed': 'Langsame Verbindung: Die Geschichte läuft in 3D.',
  timeout: 'Das dauert zu lange. Die Geschichte läuft jetzt in 3D.',
};

async function start3D(): Promise<void> {
  const loading = new Loading(uiEl);
  loading.show();
  const stage = new Stage();
  const clock = stage.clock;
  const hud = new Hud(uiEl);

  // ---- pausing: several independent reasons can hold the story
  const holds = new Set<string>();
  const hold = (reason: string, on: boolean) => {
    if (on) holds.add(reason);
    else holds.delete(reason);
    if (holds.size) {
      clock.pause();
      audio.suspend();
    } else {
      clock.resume();
      audio.resume();
    }
  };
  document.addEventListener('visibilitychange', () => hold('hidden', document.hidden));

  // ---- tracker
  let tracker: Tracker;
  if (mode === 'ar') {
    const ar = new MindARTracker(stageEl, caps.quality, !params.has('nohold'));
    try {
      await ar.start();
      tracker = ar;
    } catch (e) {
      const reason = e instanceof TrackerError ? e.reason : 'camera-unavailable';
      console.warn('[ar] falling back to 3D view:', reason, e);
      notify(uiEl, reason === 'camera-denied' ? 'camera' : 'cube', FAILURE_TEXT[reason] ?? FAILURE_TEXT.timeout, 6000);
      tracker = await startFallback();
    }
  } else {
    tracker = await startFallback();
  }

  async function startFallback(): Promise<Tracker> {
    const t = new FallbackTracker(stageEl, caps.quality);
    await t.start();
    return t;
  }

  // ---- models (placeholders when nothing is delivered yet)
  const library = new AssetLibrary(tracker.renderer);
  await library.loadAll(modelUrls());
  if (showPerf) library.printReport();

  stage.attach(tracker);
  watchContextLoss(tracker);
  loading.hide();

  // ---- AR tracking found / lost
  const scanHint = new ScanHint(uiEl);
  let escapeBtn: HTMLButtonElement | null = null;
  let escapeTimer = 0;
  let lostTimer = 0;
  const offerEscape = () => {
    clearTimeout(escapeTimer);
    escapeTimer = window.setTimeout(() => {
      escapeBtn ??= hud.showAction({ icon: 'cube', label: 'Ohne Kamera in 3D ansehen', onClick: switchTo3D });
    }, CONFIG.scanHelpAfterMs);
  };
  const removeEscape = () => {
    clearTimeout(escapeTimer);
    escapeBtn?.remove();
    escapeBtn = null;
  };

  function wireTracking(t: Tracker): void {
    if (t.kind !== 'ar') return;
    hold('tracking', !t.isFound);
    if (!t.isFound) {
      scanHint.show();
      offerEscape();
    }
    t.onFound(() => {
      clearTimeout(lostTimer);
      hold('tracking', false);
      scanHint.hide();
      removeEscape();
    });
    t.onLost(() => {
      clearTimeout(lostTimer);
      lostTimer = window.setTimeout(() => {
        hold('tracking', true);
        scanHint.show();
        offerEscape();
      }, CONFIG.lostGraceMs);
    });
  }

  async function switchTo3D(): Promise<void> {
    removeEscape();
    clearTimeout(lostTimer);
    scanHint.hide();
    stage.detach();
    const t = await startFallback();
    stage.attach(t);
    watchContextLoss(t);
    hold('tracking', false);
  }

  wireTracking(tracker);

  // ---- HUD
  const soundBtn = hud.addCorner({
    icon: 'soundOn',
    label: 'Ton aus',
    onClick: () => {
      audio.setMuted(!audio.isMuted);
      Hud.setIcon(soundBtn, audio.isMuted ? 'soundOff' : 'soundOn', audio.isMuted ? 'Ton an' : 'Ton aus');
    },
  });
  const subBtn = hud.addCorner({
    icon: 'subtitles',
    label: 'Untertitel aus',
    onClick: () => {
      subtitles.setEnabled(!subtitles.isEnabled);
      subBtn.classList.toggle('is-off', !subtitles.isEnabled);
      subBtn.setAttribute('aria-label', subtitles.isEnabled ? 'Untertitel aus' : 'Untertitel an');
    },
  });

  if (showPerf) {
    mountPerfOverlay(uiEl, stage, () => `${stage.tracker?.kind ?? '-'} · ${caps.quality}${caps.isIOS ? ' · iOS' : ''}`);
  }

  // ---- story
  const ctx: StoryContext = {
    stage,
    narrator: new Narrator(audio, clock, subtitles),
    sfx: new Sfx(audio),
    models: new Models(library),
    quality: caps.quality,
    focus: (target, distance) => stage.tracker?.focus?.(target, distance),
  };

  for (;;) {
    const world = await (params.get('story') === 'harvest' ? runScene1(ctx) : runIntro(ctx));
    // TODO(SW06): continue into Scene 2 («ins Glas») here instead of offering a replay.
    await new Promise<void>((resolve) => {
      const btn = hud.showAction({
        icon: 'replay',
        label: 'Nochmals abspielen',
        onClick: () => {
          btn.remove();
          resolve();
        },
      });
    });
    world.dispose();
  }
}

function watchContextLoss(t: Tracker): void {
  t.renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    showFatal(uiEl, 'Die Grafik wurde unterbrochen.', 'Neu laden', () => location.reload());
  });
}
