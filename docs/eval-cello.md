# Cello eval harness

An objective, local check of the three things the voice-to-cello work depends on: splitting the
voice from the band, turning a voice into notes, and rendering those notes as sound. It prints
numbers, compares them with the numbers the code produced last time it was blessed (the
baseline), and fails when something got worse.

Nothing here is downloaded or run by the app. It lives in `scripts/eval-cello/` and needs only Node
(24 or newer) for the built-in stages.

## Run it

```
node --experimental-strip-types scripts/eval-cello/run.mjs
```

| Flag | What it does |
|---|---|
| `--only=<stage>` | Run one stage, for example `--only=instant-split`. |
| `--ci` | Skip stages marked slow unless their inputs are already cached. |
| `--update-baseline` | Write today's numbers as the new baseline for every stage that ran. |
| `--update-baseline=<stage>` | Same, for one stage. |

Each run writes `scripts/eval-cello/out/results.md` (a table per stage: metric, value, baseline,
change, verdict) and `results.json`. The exit code is 1 when a gate fails or a metric is worse
than its baseline by more than its tolerance, so it can sit in CI.

The first run of a slow stage runs Basic Pitch in plain JavaScript, about one second per second of
audio. The model output is cached in `scripts/eval-cello/.cache/`, so later runs take a few seconds.
`out/` and `.cache/` are git-ignored; never commit them.

## The stages

**`guide-baseline`** renders one held A3 on the guide instrument and listens to it with an
independent pitch tracker (YIN).

- `maxCents_N_Ms`: the furthest the heard pitch strays from 220 Hz in that second of the note, in
  cents (100 cents is one semitone). Vibrato makes a small number normal; a large one means the
  note drifts.
- `deterministic`: 1 if two renders of the same part are bit-identical, 0 if not. Today it is 0,
  because the guide mixes in unseeded random noise.
- `renderMs4min`: how long a 4-minute, 598-note part takes to render (median of three). Recorded
  for reference, never compared, because machines differ.

**`instant-split`** builds a mix with a known answer (a sung line dead centre over a wide pad, a
centred bass and a centred snare), runs the app's instant split on it, and scores the result.
"Wet" means the voice sits in a room, with a different reverb on each side, so it is less centred.

- `vocalSdr_*`: how close the extracted vocal is to the true vocal, in dB. Higher is better; 0 dB
  means the error is as loud as the signal.
- `backingSdr_*`: the same for the backing track.
- `vocalLeakDb_*`: how much of the singer is left in the backing, in dB relative to the singer.
  Lower (more negative) is better.
- `centreOfBackingDb`: the same band with nobody singing; how much of it the split wrongly files
  under "vocal", in dB relative to the band. Lower is better.

**`notes-raw`** (slow) feeds a synthetic sung line, at three vibrato depths (1, 40 and 80 cents),
through Basic Pitch and the app's default note settings, then compares the notes with the melody
that was written.

- `fragmentation_vibN`: notes found divided by notes sung. 1 is perfect; 3.75 means each sung
  note came out as nearly four.
- `f1_vibN`: a 0-to-1 score for finding the right notes: a found note counts only if it starts
  within 50 ms of a real one and is within 50 cents of its pitch. 1 is perfect.
- `lateMs_vibN`: how late, on average, the matched notes start (milliseconds).
- `offPitch_vibN`: notes whose pitch is not in the sung melody at all.

Where a written note "starts" in the synthetic line: every note after the first is reached by an
80 ms glide from the one before, and its written start is the **middle of that glide**, not its
beginning. Until the midpoint the voice is still nearer the old pitch (it is the old note bending);
from there on it is nearer the new one, which is where a listener hears the change and where any
nearest-semitone transcription switches. It also matches how real singing is annotated: on
vocadito, Basic Pitch's onsets land 6-8 ms after the human-marked ones, and on this fixture they
land about 4 ms after the glide midpoint, but 40-60 ms after the glide's start. Until 2026-11 the
truth used the glide's start, which made a correct transcription look 40-60 ms late and failed
notes that were right (note F1 0.75 on a plain line). Changing it moved these baselines: `notes-raw`
and `monoline` F1 and lateness (better: the same notes, measured against the right times),
`contour` (better: the per-note tracking windows now split each glide at its midpoint), and
`guide-line` `pitchP95Cents` (worse, 11.6 to 27.8 cents: the guide now gets notes that start 40 ms
after the singer's loudness dip, the way transcribed notes really arrive, and its re-attack at
each join is briefly off pitch: a guide issue, left for the guide work). `roundtrip-score` builds its own sung melody and
still uses the glide's start.

**`monoline`** (slow) runs the vocal path's note settings and then the single-line clean-up the
way the app runs it: `cleanMonoLine` alone, each note taking its pitch from its own pitch bends
(the `_nocontour` keys; on real singing this beats reading pitch from the tracked curve). For
comparison it also runs the clean-up with the singer's curve: clean once, follow the curve through
that line (`trackContour`), clean again with that curve (the unsuffixed keys), and the same with
the "highest" strategy (`_highest`). Gated, on the `_nocontour` keys: fragmentation <= 1.15 and no
off-melody note at 40 cents of vibrato, fragmentation <= 1.25 and at most one off-melody note at
80 cents, F1 >= 0.85 on a plain line. The contour variants are only guarded against the baseline.
With real data it also scores vocadito: note F1, fragmentation, the share of notes sitting on an
annotated note at a different pitch (`offPitch`), and lateness, raw and after each clean-up.

**`musdb-split`** (slow, real data) and **`vocadito-notes`** (slow, real data) are described under
"Real data" below.

## Baseline and guard

A number on its own says little. The harness keeps each stage's numbers from a known state of the
code in `baselines/<stage>.json` and treats them as a guard:

1. Change the code.
2. Run the harness. Anything worse than its baseline by more than the tolerance fails the run.
3. When a change is meant to move a number (a better split, fewer fragments), check that the right
   metrics improved and nothing else got worse, then run `--update-baseline=<stage>` and commit the
   new baseline file with the change.

The baselines in git are the behaviour of the code at the commit that wrote them, not a target.
A stage with no baseline file passes and prints "no baseline". The method is adapted from the
scoring approach in chimera-vocal-synth's `docs/csd-comparison.md`.

Tolerances are absolute and set per metric inside the stage: wide enough to absorb floating-point
differences between machines, tight enough to catch a real change.

## Add a stage

Create `scripts/eval-cello/stages/<name>.mjs`. The runner finds it by itself.

```js
export const name = "my-stage";
export const slow = false;          // true if it needs the model or downloaded data
// export async function ready(ctx)  // slow stages only: true if its inputs are cached, so --ci can run it

export async function run(ctx) {
  const { somethingFromSrc } = await import("../../../src/lib/audio/whatever.ts");
  return {
    metrics: {
      myNumber: { value: 12.3, better: "higher", tol: 0.5 },   // `info: true` records without comparing
    },
    gates: [{ key: "myNumber", op: ">=", value: 10 }],           // hard limits, independent of the baseline
  };
}
// or: return { skipped: "why" };
```

Then `node --experimental-strip-types scripts/eval-cello/run.mjs --update-baseline=my-stage` and
commit `baselines/my-stage.json`. A stage owns its own baseline and never edits another stage.

Helpers in `lib/`:

- `ts-loader.mjs`: lets Node import `src/*.ts` files that import each other without an extension.
  The runner registers it before running any stage.
- `fixtures.mjs`: `sungLine` (a synthetic voice with known notes and pitch) and `mixWithBacking`.
- `metrics.mjs`: `sdr`, `siSdr`, `noteF1`, `fragmentation`, `onsetCount`, `centsBetween` and more.
- `yin.mjs`: pitch tracker.
- `bp-node.cjs`: Basic Pitch in Node, with a disk cache. This is the only file in the project besides
  the app's own runner allowed to touch TensorFlow.js (see HANDOFF gotcha 3); do not import tfjs
  anywhere under `src/`, and do not re-derive the model's frame arithmetic here. It exposes
  `getRaw(audio22k)` and `notesFrom(raw, options)`.
- `media.mjs`: decoding through ffmpeg for the real-data stages.

## Real data (optional, needs downloads)

Two public sets feed extra slow stages. They are never committed or copied into the repo, and the
stages skip cleanly when the folder is missing. Point the harness at a folder holding both:

```
export RIFFSCRIBE_EVAL_DATA=$HOME/riffscribe-eval/data
node --experimental-strip-types scripts/eval-cello/run.mjs --only=vocadito-notes
```

- **vocadito** (58.5 MB, CC BY 4.0): 40 short excerpts of real singing with human note and pitch
  annotations. Expected at `$RIFFSCRIBE_EVAL_DATA/vocadito/{Audio,Annotations}`. Stage
  `vocadito-notes` scores the raw Basic Pitch notes against both annotators (note F1,
  fragmentation, lateness). Citation: Rachel Bittner et al., "vocadito: A dataset of solo vocals
  with f0, note, and lyric annotations".
- **MUSDB18-7s** (147 MB, non-commercial use only, never commit or redistribute): 7-second clips of
  full songs with the stems separated. Expected at `$RIFFSCRIBE_EVAL_DATA/musdb7/test/*.stem.mp4`.
  Stage `musdb-split` runs the instant split on the real mixes and scores it against the true
  vocal and backing stems. Needs ffmpeg (`RIFFSCRIBE_FFMPEG` to point at a specific binary).

Only aggregate numbers go into `baselines/`, which is fine for both licences. Set
`RIFFSCRIBE_EVAL_LIMIT=N` to run only the first N excerpts while experimenting.

In `--ci` mode these stages are skipped unless the data is present (musdb) or fully cached
(vocadito), which on a clean CI machine means they are skipped.
