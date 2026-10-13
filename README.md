# Vom Chriesibaum ins Glas — Web AR

Web-AR story for the children's section of Stadtmagazin Zug (spring 2027, «Ausgegraben»).
Scan one code on the printed double page → the spread comes alive. No app, no accounts, no tracking.

## Run

```bash
npm install
npm run dev          # desktop: http://localhost:5173 (3D view)
npm run dev:phone    # phone on same Wi-Fi: prints a QR code (HTTPS, accept the certificate warning once)
npm run build        # typecheck + build + size report (fails above 6 MB)
```

URL flags: `?mode=ar|3d|2d` force a mode · `?lite` / `?full` force quality · `?perf` perf overlay in builds.

## Test AR without the print

1. `npm run dev`, open `/tools/compile-target.html`
2. Generate test spread (or load the real spread image) → Compile → Save → writes `public/assets/targets/spread.mind`
3. Show `public/assets/targets/test-spread.png` full-screen on a monitor or print A3 landscape, scan it with the phone.

## Structure

```
src/core        clock (pausable story time), stage (render loop, tap picking), assets (GLB/Draco/KTX2 + size report), perf overlay
src/tracking    Tracker interface, MindAR tracker, 3D fallback tracker
src/audio       audio engine (iOS unlock), narrator + subtitles sync, synthesized sfx
src/scenes      scene1 (world, story script, picking game), shared placeholders/palette/models
src/story       narration text (de-CH) + story context
src/ui          start screen, HUD, subtitles, scan hint, notices (icon-only)
src/fallback2d  2D SVG version for devices without WebGL
tools/          dev-only target compiler
scripts/        size report, placeholder narration, phone QR
```

## Delivering models (3D team)

- GLB, Draco mesh compression, KTX2 textures; hero ≤ 5k tris, props < 1k.
- Units: page space, the whole double page is **1 unit wide** (≈ 42 cm). Y up, front = +Z (bottom edge of the page).
- Drop the file into `public/assets/models/` and add it to `MODEL_FILES` in `src/scenes/shared/models.ts`. The placeholder is replaced automatically.
- Node names the code looks for: clock tower → `bell` (pivot at the top of the bell); cherry tree → optional empties `cherry_slot_*`; starling → `wing_L`, `wing_R`.

## Narration

Text: `src/story/narration.de.json` (placeholder until SW04 approval). Audio: `public/assets/audio/narration/<id>.m4a`
(mono AAC). Missing audio → subtitles still play with estimated timing.
