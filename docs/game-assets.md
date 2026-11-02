# Chriesisturm game: asset list

The game after the story (`src/game/`) is played **in AR on the printed spread** (or in the 3D view):
the course is a miniature diorama clipped to the page edges. While the child runs, about 27 m of street are visible on the page; the view zooms in on the tree and on each kitchen station.
Everything you see right now is a procedural placeholder. Generation prompts for every asset: `docs/game-asset-prompts.md`. To replace one, drop a GLB into `public/assets/models/`
and uncomment or add its key in `GAME_MODEL_FILES` (`src/game/models.ts`). The placeholder
disappears automatically.

To try it: `npm run dev`, then open `/?game&mode=3d`. Add `&autoplay` to let the game play itself, or `&speed=2` to run it faster.

## Conventions (different from the story!)

- **Units: metres.** The story works in page units (1 unit = 42 cm spread); the game works in real sizes.
- Y up. **Runners face −z.** Buildings face +z (the code rotates them towards the street).
- Origin at the base (feet / ground floor centre). Low poly, papercut look, one 512–1024 px texture atlas per model.
- GLB, Draco compression, KTX2 textures (same pipeline as the villager).

## Course layout (for scale and art direction)

| Distance `d` | Section | What is there |
|---|---|---|
| −40 … 235 m | Altstadt | houses on both sides, cheering crowd behind barriers, Zytturm at the start, fountain, white–blue bunting |
| 235 … 300 m | Orchard | 4 cherry trees per side, x = ±7 m |
| 300 … 505 m | Lake promenade | Zugersee on the left, houses on the right, crowd on both sides |
| 505 m | Finish | «Chriesi-Chuchi» house; the town folds away and the kitchen unfolds inside it |

Street 6.4 m wide, three lanes at x = −1.7 / 0 / +1.7 m. Backdrop: Zugerberg + Alps cards far ahead.

## Models

| Key | What | Size | Notes |
|---|---|---|---|
| `raceRunner` | the player | ≈ 1.6 m tall | **delivered** (Meshy, rigged by `scripts/prepare-race-runner.py`, procedural animation) |
| `raceRival` | rivals (4×) | ≈ 1.7 m | same rig as the runner |
| `raceHouse_0` … `raceHouse_3` | Altstadt houses | 5.5–7.7 m wide (along the street), 6.5 m deep, 8–11 m high | front facade on +z; kept low so the street stays visible from above |
| `raceTower` | Zytturm | ≈ 18 m | at the start, left side |
| `raceFountain` | town fountain | ≈ 3 m Ø | |
| `raceCherryTree` | orchard tree | ≈ 7 m high, crown bottom ≈ 2.6 m, crown Ø ≈ 5 m | the ladder leans into the crown at ≈ 4 m; fruit on the crown please |
| `raceFinishHouse` | «Chriesi-Chuchi» | ≈ 14 m wide, 10 m deep | the kitchen (11 × 8.5 m) must fit inside its footprint |

Connected now: the keys in the table above. Connected when they are delivered (prompts are ready, the code still draws them itself): obstacles (barrel/cherry crates ≈ 0.9 m high, a festival banner at 1.2–1.7 m height across the street, a Leiterwagen 1.3 × 2.4 m), the ladder (4.2 m), the basket, the crowd (instanced: one body plus one head mesh), the kitchen furniture (table, bowl, pitting press, cooktop and pot, jars with the «Zuger Chriesi» label, jug).

## Runner rig

Procedural animation drives these node names when there are no clips:
`hips` (pelvis, ≈ 0.92 m), `torso` (child of hips), `leg_L`, `leg_R` (hip joint), `arm_L`, `arm_R` (shoulder joint),
`carry` (empty on the right shoulder, the ladder gets attached here).

If the GLB contains **animation clips**, they are played instead (names are lowercase, loop unless stated):

| Clip | Used when |
|---|---|
| `run` | running (speed-scaled, 1.5 m stride) |
| `jump` | ↑ over a barrel (≈ 0.75 s, play once) |
| `slide` | ↓ under the banner (≈ 0.75 s) |
| `stumble` | hit an obstacle (≈ 1.1 s) |
| `idle` | start line, waiting |
| `climb` | climbing the ladder |
| `pick` | on the ladder or at the kitchen table |
| `cheer` | finish |

The run clip should carry the ladder with the right hand (or leave the right arm free and we keep it procedural).

## Sound (optional)

All effects are synthesized right now (`src/audio/sfx.ts`: bump, whoosh, beep, splash, pop, plop, fanfare). The synthesized crowd cheer (filtered noise) was removed because it sounded like a hiss; a recorded crowd ambience could be added back later. A short countdown jingle can replace the beeps without changing the call sites.
