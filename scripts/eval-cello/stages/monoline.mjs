/**
 * The single-line clean-up (cleanMonoLine) on the same sung lines as notes-raw.
 *
 * Detection uses the settings the vocal path will use: onset 0.5, frame 0.3, minimum length
 * 7 frames, melodia off, range MIDI 36..96. Then the clean-up the way the app runs it when it has
 * the model's pitch peaks: `cleanMonoLine(notes)`, `trackContour(peaks, thatLine)`, and
 * `cleanMonoLine(notes, { contour })`, so every note takes its pitch from the singer's curve. The
 * right answer is the written melody, one note per sung note (each starting at the middle of the
 * glide into it; see lib/fixtures.mjs).
 *
 * Gated: with vibrato of 40 cents a held note must come out as one note (fragmentation <= 1.15)
 * and no note may land off the melody; at 80 cents fragmentation <= 1.25 and at most one stray;
 * a plain line (1 cent) must still score note F1 >= 0.85. Recorded alongside, ungated: the same
 * clean-up without a contour (`_nocontour`, pitch read from the notes' own pitch bends) and the
 * "highest" strategy (`_highest`, with the contour).
 *
 * With RIFFSCRIBE_EVAL_DATA set (a folder holding vocadito/), the same detection and clean-up
 * also run on the 40 real sung excerpts and are scored against the human note annotations
 * (averaged over both annotators): note F1, notes per annotated note, the share of notes sitting
 * on an annotated note at a different pitch, and mean onset lateness, raw and after each
 * clean-up. Those numbers are guarded against the baseline but not gated. Without the variable
 * that part is left out; in --ci mode it is also left out unless the model output is already
 * cached.
 *
 * Slow on the first run (it shares notes-raw's and vocadito-notes' cached model output, so it
 * is quick after that). */
import { sungLine, MELODY_MIDI } from "../lib/fixtures.mjs";
import { noteF1, fragmentation } from "../lib/metrics.mjs";
import { vocaditoTracks } from "../lib/vocadito.mjs";
import { decode } from "../lib/media.mjs";
import { createRequire } from "node:module";

const bp = createRequire(import.meta.url)("../lib/bp-node.cjs");

export const name = "monoline";
export const slow = true;

const SR = 22050;
const VIBRATO = [1, 40, 80];
const DETECT = {
  onset: 0.5,
  frame: 0.3,
  minLen: 7,
  melodia: false,
  minHz: bp.midiToHz(36),
  maxHz: bp.midiToHz(96),
};

export async function ready() {
  return VIBRATO.every((v) => bp.hasCache(sungLine({ sr: SR, vibCents: v }).audio));
}

/** The clean-ups compared: key suffix -> (notes, raw model output, seconds) -> line. */
function cleanups(cleanMonoLine, pickPeaks, trackContour) {
  const withContour = (strategy) => (notes, raw, seconds) => {
    const first = cleanMonoLine(notes, { strategy });
    const contour = trackContour(pickPeaks(raw.contours), first, seconds);
    return cleanMonoLine(notes, { strategy, contour });
  };
  return {
    "": withContour("strongest"),
    _nocontour: (notes) => cleanMonoLine(notes, { strategy: "strongest" }),
    _highest: withContour("highest"),
  };
}

export async function run(ctx) {
  const { cleanMonoLine } = await import("../../../src/lib/transcribe/monoline.ts");
  const { pickPeaks, trackContour } = await import("../../../src/lib/transcribe/contour.ts");
  const variants = cleanups(cleanMonoLine, pickPeaks, trackContour);
  const metrics = {};
  const truthSet = new Set(MELODY_MIDI);
  for (const vib of VIBRATO) {
    const { audio, truthNotes } = sungLine({ sr: SR, vibCents: vib });
    const raw = await bp.getRaw(audio);
    const { notes } = bp.notesFrom(raw, DETECT);
    for (const [sfx, clean] of Object.entries(variants)) {
      const line = clean(notes, raw, audio.length / SR);
      const m = noteF1(line, truthNotes);
      metrics[`fragmentation_vib${vib}${sfx}`] = { value: round(fragmentation(line, truthNotes), 2), better: "lower", tol: 0.1 };
      metrics[`f1_vib${vib}${sfx}`] = { value: round(m.f1, 3), better: "higher", tol: 0.05 };
      metrics[`offPitch_vib${vib}${sfx}`] = {
        value: line.filter((n) => !truthSet.has(Math.round(n.pitchMidi))).length,
        better: "lower",
        tol: 0,
      };
    }
  }
  Object.assign(metrics, await realSinging(ctx, variants));
  return {
    metrics,
    gates: [
      { key: "fragmentation_vib40", op: "<=", value: 1.15 },
      { key: "fragmentation_vib80", op: "<=", value: 1.25 },
      { key: "offPitch_vib40", op: "==", value: 0 },
      { key: "offPitch_vib80", op: "<=", value: 1 },
      { key: "f1_vib1", op: ">=", value: 0.85 },
    ],
  };
}

/** Share of `found` notes that sit (by their middle) on an annotated note at a different pitch. */
function offPitchShare(found, truth) {
  if (!found.length) return 0;
  let off = 0;
  for (const f of found) {
    const mid = f.startTimeSeconds + f.durationSeconds / 2;
    const t = truth.find((n) => mid >= n.startTimeSeconds && mid < n.startTimeSeconds + n.durationSeconds);
    if (t && Math.abs(f.pitchMidi - t.pitchMidi) > 0.5) off++;
  }
  return off / found.length;
}

/** Note F1, notes per annotated note, off-pitch share and lateness on vocadito, raw and cleaned. Empty when the data is absent. */
async function realSinging(ctx, cleaned) {
  if (!ctx?.dataDir) return {};
  const tracks = vocaditoTracks(ctx.dataDir);
  if (!tracks?.length) return {};
  const audios = tracks.map((t) => decode(t.wav, { sr: SR, channels: 1 })[0]);
  if (ctx.ci && !audios.every((a) => bp.hasCache(a))) {
    ctx.log("vocadito part left out: model output not cached (--ci)");
    return {};
  }
  const variants = { raw: (n) => n };
  for (const [sfx, fn] of Object.entries(cleaned)) variants[`clean${sfx}`] = fn;
  const sums = Object.fromEntries(Object.keys(variants).map((k) => [k, { f1: [], frag: [], off: [], late: [] }]));
  for (let i = 0; i < tracks.length; i++) {
    const truths = [tracks[i].notesA1, tracks[i].notesA2].filter(Boolean);
    if (!truths.length) continue;
    const raw = await bp.getRaw(audios[i]);
    const { notes } = bp.notesFrom(raw, DETECT);
    for (const [k, fn] of Object.entries(variants)) {
      const line = fn(notes, raw, audios[i].length / SR);
      const scored = truths.map((t) => noteF1(line, t));
      sums[k].f1.push(mean(scored.map((m) => m.f1)));
      sums[k].late.push(mean(scored.map((m) => m.meanLatenessMs)));
      sums[k].frag.push(mean(truths.map((t) => fragmentation(line, t))));
      sums[k].off.push(mean(truths.map((t) => offPitchShare(line, t))));
    }
  }
  if (!sums.raw.f1.length) return {};
  const out = { vocadito_excerpts: { value: sums.raw.f1.length, better: "higher", tol: 0, info: true } };
  for (const [k, s] of Object.entries(sums)) {
    out[`vocadito_f1_${k}`] = { value: round(mean(s.f1), 3), better: "higher", tol: 0.02 };
    out[`vocadito_fragmentation_${k}`] = { value: round(mean(s.frag), 2), better: "lower", tol: 0.1, info: true };
    out[`vocadito_offPitch_${k}`] = { value: round(mean(s.off), 3), better: "lower", tol: 0.02 };
    out[`vocadito_lateMs_${k}`] = { value: round(mean(s.late), 1), better: "lower", tol: 5, info: true };
  }
  return out;
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
