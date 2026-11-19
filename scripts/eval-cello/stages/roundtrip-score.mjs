/**
 * Score in, singing out, notes back: does the app recover a tune it was never told about?
 *
 * Each fixture is a short traditional melody written as MusicXML (fixtures/*.musicxml). The
 * extractor in lib/musicxml-notes.mjs turns it into notes and beats (repeats, endings and ties
 * written out), the notes are sung with the same synthetic voice the other stages use, Basic
 * Pitch transcribes the result, and the transcription is scored against the score.
 *
 * The idea of scoring a rendering against its own source and watching the numbers over time is
 * borrowed from chimera-vocal-synth; the extractor is ported from it (see the file header there).
 *
 * Slow: model time on the first run, cached after that. No gates, only the committed baseline.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { musicXmlToNotes } from "../lib/musicxml-notes.mjs";
import { noteF1, fragmentation } from "../lib/metrics.mjs";

const bp = createRequire(import.meta.url)("../lib/bp-node.cjs");
const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

export const name = "roundtrip-score";
export const slow = true;

const SR = 22050;
/** Both tunes are written in a treble-clef range; singing them an octave lower puts them where the other stages sing. */
const SING_TRANSPOSE = -12;
const VIBRATO_CENTS = 30;
/** Detection settings for this stage: onset 0.5, frame 0.3, minimum 7 frames, no melodia pass. */
const DETECT = { onset: 0.5, frame: 0.3, minLen: 7, melodia: false, minHz: null, maxHz: null };

/** name, file, and what the extractor must return (entries include rests; `sung` excludes them). */
export const FIXTURES = [
  { id: "greensleeves", file: "greensleeves.musicxml", entries: 30, sung: 29, bpm: 100 },
  { id: "parting-glass", file: "parting-glass.musicxml", entries: 27, sung: 26, bpm: 84 },
];

const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

/**
 * A voice-like line sung from a list of notes. Same voice as `sungLine` in lib/fixtures.mjs
 * (copied from it, since that one sings one fixed melody): harmonics shaped by three formant
 * bumps, a glide from the previous note, vibrato that fades in, a slow loudness swell.
 *
 * `notes` is `[{ midi, seconds }]` with midi 0 for a rest. Returns `{ audio, truthNotes }`
 * where truthNotes are `NoteEvent`s (rests are silence and have none).
 */
export function sungMelody({ sr, notes, vibCents = VIBRATO_CENTS, vibHz = 5.5, glide = 0.08, transpose = 0, firstAt = 0.25, tail = 0.5 }) {
  const segs = [];
  let t0 = firstAt;
  for (const n of notes) {
    segs.push({ midi: n.midi > 0 ? n.midi + transpose : 0, start: t0, seconds: n.seconds });
    t0 += n.seconds;
  }
  const end = t0;
  const total = Math.ceil((end + tail) * sr);
  const audio = new Float32Array(total);

  const segAt = (t) => {
    if (t < firstAt || t >= end) return -1;
    let k = segs.length - 1;
    while (k > 0 && t < segs[k].start) k--;
    return segs[k].midi > 0 ? k : -1;
  };
  const midiAt = (t, k) => {
    const cur = segs[k].midi;
    const tn = t - segs[k].start;
    let base = cur;
    if (k > 0 && segs[k - 1].midi > 0 && tn < glide) {
      const prev = segs[k - 1].midi;
      base = prev + (cur - prev) * (tn / glide);
    }
    const ramp = tn > 0.25 ? Math.min(1, (tn - 0.25) / 0.3) : 0;
    return base + (vibCents / 100) * Math.sin(2 * Math.PI * vibHz * tn) * ramp;
  };
  const levelAt = (t, k) => {
    const tn = t - segs[k].start;
    const d = segs[k].seconds;
    const env = Math.min(1, tn / 0.04) * Math.min(1, (d - tn) / 0.05);
    return Math.max(0, env) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 0.7 * t)) * 0.3;
  };

  const nyq = sr / 2.2;
  let ph = 0;
  for (let i = 0; i < total; i++) {
    const t = i / sr;
    const k = segAt(t);
    if (k < 0) continue;
    const f = midiToHz(midiAt(t, k));
    ph += (2 * Math.PI * f) / sr;
    let s = 0;
    for (let h = 1; h * f < nyq && h <= 20; h++) {
      const hf = h * f;
      const w =
        (Math.exp(-(((hf - 700) / 300) ** 2)) +
          0.6 * Math.exp(-(((hf - 1200) / 350) ** 2)) +
          0.3 * Math.exp(-(((hf - 2600) / 500) ** 2)) +
          0.05) / h;
      s += w * Math.sin(h * ph);
    }
    audio[i] = s * levelAt(t, k);
  }
  const truthNotes = segs
    .filter((s) => s.midi > 0)
    .map((s) => ({ pitchMidi: s.midi, startTimeSeconds: s.start, durationSeconds: s.seconds, amplitude: 0.8 }));
  return { audio, truthNotes };
}

/** Notes at a pitch an exact number of octaves from a note that starts at the same moment (50 ms, 50 cents). */
function octaveErrors(found, truth) {
  let n = 0;
  for (const t of truth) {
    const f = found
      .filter((x) => Math.abs(x.startTimeSeconds - t.startTimeSeconds) <= 0.05)
      .sort((a, b) => Math.abs(a.startTimeSeconds - t.startTimeSeconds) - Math.abs(b.startTimeSeconds - t.startTimeSeconds))[0];
    if (!f) continue;
    const d = f.pitchMidi - t.pitchMidi;
    const k = Math.round(d / 12);
    if (k !== 0 && Math.abs(d - 12 * k) <= 0.5) n++;
  }
  return n;
}

/** The fixture as sung notes, after checking the extractor got it right. */
function load(fx) {
  const { bpm, notes } = musicXmlToNotes(readFileSync(path.join(fixturesDir, fx.file), "utf8"));
  const sung = notes.filter((n) => n[0] > 0).length;
  if (notes.length !== fx.entries || sung !== fx.sung || bpm !== fx.bpm) {
    throw new Error(`${fx.file}: extractor gave ${notes.length} entries / ${sung} sung notes at ${bpm} bpm; expected ${fx.entries} / ${fx.sung} at ${fx.bpm}`);
  }
  return notes.map(([midi, beats]) => ({ midi, seconds: (beats * 60) / bpm }));
}

const sing = (fx) => sungMelody({ sr: SR, notes: load(fx), transpose: SING_TRANSPOSE });

export async function ready() {
  return FIXTURES.every((fx) => bp.hasCache(sing(fx).audio));
}

export async function run() {
  const metrics = {};
  for (const fx of FIXTURES) {
    const { audio, truthNotes } = sing(fx);
    const raw = await bp.getRaw(audio);
    const { notes } = bp.notesFrom(raw, DETECT);
    const m = noteF1(notes, truthNotes);
    metrics[`f1_${fx.id}`] = { value: round(m.f1, 3), better: "higher", tol: 0.05 };
    metrics[`fragmentation_${fx.id}`] = { value: round(fragmentation(notes, truthNotes), 2), better: "lower", tol: 0.25 };
    metrics[`octaveErrors_${fx.id}`] = { value: octaveErrors(notes, truthNotes), better: "lower", tol: 1 };
    metrics[`lateMs_${fx.id}`] = { value: round(m.meanLatenessMs, 1), better: "lower", tol: 5 };
  }
  return { metrics, gates: [] };
}

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
