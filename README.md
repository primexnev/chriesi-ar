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

URL flags: `?mode=ar|3d|2d` force a mode · `?lite` / `?full` force quality · `?perf` perf overlay in builds · `?era=1…7` jump to a chronicle page · `?speed=2` faster story time for reviewing · `?story=harvest` the original harvest scene.

## AR target (the printed spread)

The current target is compiled from **Variante F «Chriesiland»** (page 1 of the print PDF, 420 × 297 mm).
Design files live in `design/` (git-ignored — the repo is public, drafts stay local).

To recompile after a design change:
1. Render the spread to `design/spread.png` (~1600 px wide).
2. `npm run dev`, open `/tools/compile-target.html?src=/design/spread.png` → Compile → Save.
3. Commit `public/assets/targets/spread.mind` and push — GitHub Pages redeploys.

Without the print: open the spread on a monitor full-screen and scan that, or use "Generate test spread" in the tool.

## Structure

```
src/core        clock (pausable story time), stage (render loop, tap picking), assets (GLB/Draco/KTX2 + size report), perf overlay
src/tracking    Tracker interface, MindAR tracker, 3D fallback tracker
src/audio       audio engine (iOS unlock), narrator + subtitles sync, synthesized sfx
src/scenes      intro (meadow, villager, dig), chronicle (pop-up book history), scene1 (harvest + picking game), shared placeholders/palette/models
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

## Excavation intro prototype

The default 3D/AR story now uses the supplied villager: meadow arrival, search for a shovel, tap to help, pickup, digging and a chest revealing a book and cherry stone. Audio remains German placeholder narration. The shovel icon is a keyboard-accessible alternative to the 3D hit target; after 35 seconds without input the story continues automatically. `?story=harvest` opens the original harvest scene; the existing no-WebGL SVG fallback still tells that harvest story.

`assets-source/` keeps original FBX/textures local. `scripts/prepare-villager.py` imports the unrigged Meshy model in Blender, adds a 21-bone rig whose joints were measured on the mesh (hips, spine, chest, neck, head, collarbones, arms, legs, toes) and exports `public/assets/models/villager.glb`.

Character animation is procedural (`src/scenes/intro/motion.ts`): the walk cycle is driven by the distance actually travelled (planted feet do not slide, heel-toe roll, pelvis bob/sway, counter-rotating chest, arm swing), turns step on the spot, walks ease in and out, the shovel is picked up with a bend and swung onto the shoulder, and digging is a keyed cycle (lift, thrust, press, lever, toss) with both hands kept on the shaft by IK. `node tests/intro-motion.mjs` checks grip and foot sliding.

## Chronicle: «Die Geschichte der Zuger Chriesi»

After the intro, the book from the chest flies to the middle of the meadow, grows into a pop-up book and opens. Each page folds up out of the paper and back down before the leaf turns; the villager watches from the side and the cherry stone hovers next to the year sign as the thread through time. Everything happens in Canton Zug (facts: `docs/research-zuger-chriesi.md`, script and lines: `docs/storyboard-narration.md`):

| Page | Sign | Interaction |
|---|---|---|
| 1 | um 1000 v. Chr. · pile dwellings at Zug-Sumpf, wild cherries | — |
| 2 | um 200 n. Chr. · Roman mill at Cham-Hagendorn, flood → 1944 excavation | tap the water wheel |
| 3 | 1627 · Chriesimärt | — |
| 4 | 1711 · Allmend at night with the cherry guard, then the Chriesigloggä | tap the bell, choose a tree, pick cherries |
| 5 | 1915 · Heinrich Höhn's first Zuger Kirschtorte | stir with circles (or taps) |
| 6 | 1950 → 2000 · trees give way to houses | — |
| 7 | 2008 / heute · 1000 new trees, Chriesisturm in the old town | — |
| Finale | the book closes, the stone is planted where the chest was and grows into a tree | tap the stone |

Every interaction has an on-screen button as an accessible alternative and continues by itself after 20 s. Watching time (placeholder voice, child taps at once): intro 52 s + chronicle 158 s ≈ 3:30; the real, slower recording is expected around 4:15. In dev builds the console prints the split between watching time and time spent waiting for the child. Code: `src/scenes/chronicle/` (`popup.ts` book, pages and sign · `eras.ts` the seven pages · `prompt.ts` taps, stirring and pacing · `index.ts` the script).
