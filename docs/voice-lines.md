# Spoken lines: what is recorded, what is still a placeholder

The game plays one audio file per line from `public/assets/audio/narration/<ID>.<ext>`.
Right now every line below is a **placeholder** made with macOS text-to-speech (`npm run narration`).

## How to drop in our own recordings

1. Name the file exactly like the ID, e.g. `SC3_C01.wav` or `SC3_C01.mp3` (`.m4a` works too).
2. Put it in `public/assets/audio/narration/`.
3. That's it: a `.wav` or `.mp3` with the same ID is played instead of the placeholder `.m4a`.
   (To keep the download small, `.m4a` is best. Convert with
   `afconvert -f m4af -d aac -b 48000 -c 1 SC3_C01.wav SC3_C01.m4a` and overwrite the placeholder.)
4. Tick the line below as recorded.

Mono, 44.1 or 48 kHz, short silence trimmed at both ends, about −16 LUFS so all lines are equally loud.

## Harvest game (script paper, «Harvest game»)

| Status | ID | When it plays in the game | German | How to say it |
|---|---|---|---|---|
| ☐ placeholder | SC3_C01 | Right after the bell rings at the start | Chriesisturm! Hilf mir pflücken! | Energetic, a clear call to play |
| ☐ placeholder | SC3_O01 | At the cherry tree, and again when the help button appears | Tippe auf die Chriesi. | Calm and clear |
| ☐ placeholder | R01 | A tap on a cherry (one of R01–R06 at random, every 2nd or 3rd tap) | Plopp! | Playful |
| ☐ placeholder | R02 | 〃 | Super! | Happy |
| ☐ placeholder | R03 | 〃 | Noch eine! | Eager |
| ☐ placeholder | R04 | 〃 | Juhui! | Cheering |
| ☐ placeholder | R05 | 〃 | Gut gemacht! | Proud of the child |
| ☐ placeholder | R06 | 〃 | Mmh, lecker! | Tasting, delighted |
| ☐ placeholder | SC3_C02 | The basket is full (last cherry picked) | Die Hutte ist voll! Juhui! | Proud and happy |

The text of each line lives in `src/story/narration.de.json`; change it there and run
`npm run narration -- --force` to regenerate the placeholders.

## Not in the paper yet (only on screen, no voice)

The other steps of the journey (crate, log, garland, gate, cart, cat, wash, stir, fill) show their
instruction as text and a moving hand, without a voice. Children who cannot read yet need these spoken
too; they should get IDs in the next version of the script paper.
