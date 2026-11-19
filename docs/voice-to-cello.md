# Voice to cello

"Replace the voice with..." takes a song with a singer, writes the sung line out for an instrument
(cello by default; viola, violin, double bass and the winds work the same way) and plays that
instrument in the singer's place, against the rest of the band. This page follows one song through
the pipeline, says which file does each step, and gives the measured numbers.

Everything runs in the browser. No audio is uploaded and nothing here calls a server.

## The flow in one paragraph

Split the song, find the notes in the vocal stem, tidy them into one line of single notes, follow
the singer's real pitch curve through that line, read how loud the singer is, move the whole line to
the octave where the instrument sings, and render a continuous bowed line that glides and swells
with the singer. The score shows the notes; the sound follows the curve.

## Stage by stage

The orchestration is `replaceVoice` and `transcribeFrom` in `src/components/Studio.tsx`.

| # | Stage | What it does | Code |
|---|---|---|---|
| 1 | Split | **Quick**: phase-based centre extraction, about a second. **Clean**: the 4-stem AI split (Demucs), minutes per song and a one-time 180 MB model download, behind a confirmation that offers "trim to the loop first". | `src/lib/audio/karaoke.ts`, `src/lib/audio/stems.ts`, `src/lib/workers/` |
| 2 | Find notes | Basic Pitch over the vocal stem, over the voice's own range (MIDI 36 to 96), with a short minimum note length (7 frames) and the "melodia" smoothing off, keeping the model's pitch-salience peaks. Runs in a worker. | `src/lib/transcribe/basicPitch.ts`, `runner.ts`, `src/lib/workers/transcribe.worker.ts` |
| 3 | One line | `cleanMonoLine` turns the notes into one note at a time: it chooses the strongest of notes that start together, removes octave ghosts and blips, joins the pieces a vibrato is broken into, drops the short note a slide passes through, and re-reads each note's pitch from the notes' own pitch bends. | `src/lib/transcribe/monoline.ts` |
| 4 | Pitch curve | `trackContour` follows the line through the kept pitch peaks and writes a continuous curve on a 100-per-second grid, in fractional MIDI, 0 where unvoiced. Slides, scoops and vibrato come out as the singer did them. | `src/lib/transcribe/contour.ts` |
| 5 | Loudness | `loudnessCurve` reads the singer's level on the same grid (20 ms windows, fast attack, slow release). The voiced level also sets the guide's target loudness. | `src/lib/audio/envelope.ts` |
| 6 | Register | `placeInRegister` moves the whole line by octaves so its middle sits in the instrument's singing range (cello 48 to 69), then moves any note still off the instrument by an octave on its own. The curve moves with the notes. | `src/lib/transcribe/register.ts` |
| 7 | Sound | `renderLine` plays the line as one slurred bow stroke where notes join and a new stroke where the singer's loudness dips. Source is a band-limited sawtooth, brighter when louder, with bow noise, through fixed cello-body resonances, levelled and given a small room. Offline render in a worker; deterministic for a given seed. | `src/lib/audio/guide.ts`, `guideLine.ts`, `body.ts`, `room.ts`, `guideClient.ts`, `src/lib/workers/guide.worker.ts` |
| 8 | Mix | The vocal stem is muted, the instrument row is added at 0.85 gain. "Hear the singer" swaps the two. | `Studio.tsx` |

Order inside stages 3 and 4, as measured: clean once (from bends), track the contour through that
line, and optionally clean again reading pitch from the contour. The app stops after the first clean.
On real singing the bends-only clean scores best (see the numbers below), so the contour is used for
the sound and for the register, not to re-pitch the notes.

### Rules this relies on

- **The guide plays at sounding pitch.** "Write it in" changes the written key of the score and
  nothing else. The key never reaches the guide, so the instrument stays in tune with the backing
  stems. This is HANDOFF gotcha 12.
- **The sound is not a sampled cello.** The soundfont bundled with alphaTab turned out not to hold
  cello samples at all: its cello preset is six single-cycle wavetables, 12 to 35 ms long. The
  timbre is therefore a source-and-filter model. A real sampled cello is deferred until a sample
  licence is settled.
- **One thing at a time.** Parts made from the vocal stem are always a single line, bowed and wind
  parts default to a single line, and chords stay available through the part's "one note at a time"
  switch.
- **No second AudioContext and no alphaTab synth**; the guide is a plain buffer that stays locked to
  every other row (gotchas 2 and 5).
- **TensorFlow.js is never imported under `src/`.** The contour code is plain arithmetic on the peaks
  the worker returns (gotcha 13).

## Measured numbers

All from `npm run eval:cello`. The synthetic rows use a generated sung line with known notes, three
vibrato depths (1, 40 and 80 cents) and an 80 ms glide into each note. The real-data rows use the
vocadito and MUSDB18-7s sets described in `docs/eval-cello.md`; those never go in the repo and the
stages skip when `RIFFSCRIBE_EVAL_DATA` is unset. Numbers below are from the 2026-11-19 run on the
release branch.

### Notes: before and after the single-line clean-up

| Line | Measure | Raw Basic Pitch | After `cleanMonoLine` |
|---|---|---:|---:|
| Synthetic, 1 cent vibrato | note F1 | 1.00 | 1.00 |
| Synthetic, 40 cents | fragmentation (notes found per note sung) | 2.00 | 1.00 |
| Synthetic, 40 cents | note F1 | 0.667 | 1.00 |
| Synthetic, 80 cents | fragmentation | 3.75 | 1.00 |
| Synthetic, 80 cents | note F1 | 0.421 | 0.875 |
| Synthetic, 80 cents | notes not in the melody | 12 | 0 |
| Real singing (vocadito, 40 excerpts) | note F1 | 0.502 | 0.536 (bends only), 0.528 (re-pitched from the contour) |
| Real singing | notes on an annotated note at the wrong pitch | 0.247 | 0.175 |
| Real singing | fragmentation | 1.31 | 0.81 |

Note F1 counts a found note only if it starts within 50 ms of a real one and sits within 50 cents.
Fragmentation under 1 on real singing means the clean-up now merges slightly more than the human
annotators wrote; it is not a score by itself. The honest reading of the real-singing row: the clean
line is better, not good. About half of the notes still do not match an annotator's.

Note starts: Basic Pitch's onsets land 6 to 8 ms after the human-marked ones on vocadito, so lateness
is not the problem.

### Pitch curve

Against the true curve of the synthetic line: 98.1 to 99.7 percent of voiced frames within 50 cents,
RMS error 6.1 cents (plain), 8.5 (40 cents of vibrato) and 16.3 (80 cents), and the vibrato depth and
rate recovered to within 13 percent and 0.05 Hz.

### The guide

| Measure | Value | Gate |
|---|---:|---:|
| Pitch error, median, continuous guide on the synthetic line | 3.4 cents | 10 |
| Pitch error, 95th percentile | 10.9 cents | 30 |
| Loudness correlation with the singer | 0.92 | 0.8 |
| Re-attacks found at the singer's loudness dips | 8 of 8 | at least 7 |
| Onsets inside a slur | 0 | 0 |
| Held A3 on the guide, worst drift in any second | 5.8 to 6.7 cents | none |
| Two renders identical | yes | yes |
| Render time, 4 minutes and 598 notes | under 1 s on the development Mac | 5 s (info) |

Two bugs matter here. The first guide computed vibrato phase as `2π·f(t)·i/sr` instead of adding it
up sample by sample, so the swing grew with the length of the note: on a 4-second note the research
run measured up to about 1100 cents of swing in the last second. That was fixed in the first review
round and the baseline now records the fixed behaviour. The second: after the single-line work the
guide started each note about 40 ms after the singer's loudness dip and was 100 to 170 cents off
pitch for about 40 ms at every note change, which pushed the 95th percentile to 27.8 cents against a
gate of 30. Note changes now glide in from the curve and the number is back to 10.9.

### Through the whole path

The pipeline stage sends the synthetic line, at 40 and 80 cents of vibrato, through split, notes,
curve, register and guide.

| Measure | Isolated vocal | After the Quick split of a mix |
|---|---:|---:|
| Frames within 50 cents (40 cents of vibrato) | 0.993 | 0.905 |
| Frames within 50 cents (80 cents) | 0.985 | 0.894 |
| Fragmentation (40 cents) | 1.00 | 1.88 |
| Loudness correlation (40 cents) | 0.86 | 0.84 |

The line is sung as a soprano would (G4 to D5), which already sits in the cello's singing range. Sung
a fourth higher (C5 to G5) it is moved one octave down, as intended (`octaves` of -1, gated), and
still scores 1.00 and 0.996 on pitch. At 80 cents of vibrato the cleaned line keeps a few short notes
on a vibrato crest before a glide (fragmentation 1.25 and 1.38): a known limit of the clean-up.

### The Quick split is a preview

| Split | Vocal SDR | Backing SDR | Singer left in the backing |
|---|---:|---:|---:|
| Quick, synthetic mix, dry vocal | 7.4 dB | 8.0 dB | -22.9 dB |
| Quick, synthetic mix, wet vocal (-12 dB room) | 6.4 dB | 6.5 dB | -15.2 dB |
| Quick, synthetic mix, wet vocal (-6 dB room) | 4.7 dB | 4.0 dB | -8.9 dB |
| **Quick, real songs (MUSDB18-7s, 50 clips)** | **0.05 dB mean, 0.56 dB median** | 5.2 dB | -11.5 dB |

SDR is signal to distortion ratio: how close the extracted part is to the true one, higher is better,
0 dB means the error is as loud as the signal. On real mixes the centre trick is only slightly better
than leaving the mix as it is (the whole mix scored as the vocal gets -5.2 dB). It works when the
voice is dry and dead centre and the band is wide, and it pulls centred bass and snare into the vocal
stem. Use Clean (the AI split) for anything you care about. The Clean path has not been scored by the
harness, because running Demucs needs a browser; it is not in these numbers.

### The MusicXML round trip

`roundtrip-score` renders two public-domain tunes (Greensleeves, The Parting Glass) as a sung line,
transcribes them and compares with the score: note F1 0.50 and 0.25, no octave errors. The reported
lateness of about 35 ms is an artefact of the stage, which still marks the truth onset at the start of
the glide instead of its midpoint like the other stages. Aligning it is on the to-do list; the F1 will
move when it is.

## What is not solved

- **A sung line that goes through a consonant** is still broken into separate notes at times; the
  clean-up joins pieces of the same pitch up to 80 ms apart and no further.
- **Backing vocals and ghosts** from the split end up in the line when they are loud and centred.
- **Reverb and doubles** of the voice stay in the backing, so a faint ghost singer is audible behind
  the cello. Removing them needs a better separator (see `HANDOFF.md`, "Next").
- **Note onsets after a slide** come about 60 ms late in the raw output; no fix in this release.
- **Greek lyrics and "sing it on la"** are not built: see the Chimera conclusion in `HANDOFF.md`.

## How to change anything here safely

1. Change the code.
2. `npm run eval:cello` (with `RIFFSCRIBE_EVAL_DATA` set when you can, so the real-singing rows run).
3. A number that got worse fails the run. A number that is meant to move: check the others, then
   `npm run eval:cello -- --update-baseline=<stage>` and commit the baseline with the change.
4. Listen to it. The harness measures pitch, timing and loudness; it cannot tell you whether the
   cello sounds like one. Nobody has listened to the guide on a real song yet (see `HANDOFF.md`,
   "Not verified").
