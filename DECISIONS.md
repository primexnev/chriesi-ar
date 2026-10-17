# Decision log

One line per decision: date · decision · reason.

- 2026-10-13 · Web stack: Vite + TypeScript + Three.js r186, no UI framework · small bundle, fully static build, brief §4.
- 2026-10-13 · Image tracking with MindAR 1.2.5 (lazy-loaded) · works on iOS Safari (WebXR AR does not), free, Three.js integration; ≈350 KB gzip only on the AR path.
- 2026-10-13 · MindAR `sRGBEncoding` import patched in vite.config.ts instead of pinning three to r161 · keeps current three (KTX2/Draco loaders, bug fixes).
- 2026-10-13 · Tracking behind a `Tracker` interface (`start`, `onFound`, `onLost`) with MindAR + 3D-fallback implementations · the QR vs. marker decision (SW03) stays open; content survives a tracker swap mid-story.
- 2026-10-13 · Content authored in "page space" (spread width = 1, y-up, page in XZ) · same scene works in AR and in the 3D view.
- 2026-10-13 · Failure paths never dead-end: camera denied / unavailable / target missing / timeout → 3D view with a notice; no WebGL → 2D SVG version; tracking lost → story pauses + scan hint, 3D escape button after 10 s.
- 2026-10-13 · One narration clip per line (AAC .m4a) + subtitle text in JSON (`|` splits chunks) · interactive story triggers lines by event; AAC decodes on iOS and Android.
- 2026-10-13 · All story timing runs on a pausable story clock · pausing (tracking lost, tab hidden) freezes narration, subtitles and animation together.
- 2026-10-13 · Sound effects synthesized with Web Audio · zero download bytes; replace later if sound design requires.
- 2026-10-13 · Placeholder narration via macOS `say` (`npm run narration`) · test timing before the real recording (SW10).
- 2026-10-13 · Picking game: tap anywhere on the crown picks the nearest cherry; idle hint at 12 s, auto-finish at 40 s · cannot fail, no score (brief §2); module behind `Minigame` interface, swappable after SW04 paper test.
- 2026-10-13 · Phone testing over LAN with self-signed HTTPS (`npm run dev:phone`, prints QR) · camera needs HTTPS; no external tunnel service needed.
- 2026-10-13 · Test target = generated busy test spread (925 KB .mind) · placeholder until the print design exists; the real spread must be re-compiled and should be smaller.
- 2026-10-13 · World-locked AR: MindAR pose fused with the gyroscope (DeviceOrientation) into a fixed world frame, smoothed there, and held when the page is lost · team feedback: the scene must stay in place once detected. Rotation is compensated by the gyro; sideways movement is only corrected when the page is visible again (no web world tracking on iOS). `?nohold` restores plain tracking for comparison.
- 2026-10-13 · AR target = print draft «Variante F – Chriesiland» (page 1, full spread, 1600 px → 957 KB .mind) · real design tracks far better than the test pattern; the source PDF/PNG stay out of the public repo (`design/` is git-ignored). Recompile whenever the print changes, incl. the final QR code.

- 2026-10-17 · Storybook interface: original paper-cut cover artwork, native accessible play control, unobstructed scan brackets and cream HUD; artwork included in download budget.

- 2026-10-17 · Excavation intro prototype with supplied Meshy character: 15-bone automatic rig, procedural walk/search/dig poses, tappable shovel and chest/book/cherry-stone reveal. Source FBX and textures stay local; optimized GLB exported with a 1024px texture. Original harvest remains at ?story=harvest.
