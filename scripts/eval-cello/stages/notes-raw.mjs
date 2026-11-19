/**
 * What Basic Pitch plus the app's default note settings make of a sung line, today.
 *
 * The line is synthetic (see lib/fixtures.mjs) at three vibrato depths, so the right answer is
 * the written melody. Wide vibrato is where the raw notes fall apart: one sung note comes out as
 * several. This stage records that, so a fix has something to beat.
 *
 * Slow (about 8 s of model time per vibrato depth on the first run); the model output is cached.
 */
import { sungLine, MELODY_MIDI } from "../lib/fixtures.mjs";
import { noteF1, fragmentation } from "../lib/metrics.mjs";
import { createRequire } from "node:module";

const bp = createRequire(import.meta.url)("../lib/bp-node.cjs");

export const name = "notes-raw";
export const slow = true;

const SR = 22050;
const VIBRATO = [1, 40, 80];
// the app's defaults: onset 0.5, frame 0.3, min length 11 frames, melodia on, no range limit
const APP_DEFAULTS = { onset: 0.5, frame: 0.3, minLen: 11, melodia: true, minHz: null, maxHz: null };

export async function ready() {
  return VIBRATO.every((v) => bp.hasCache(sungLine({ sr: SR, vibCents: v }).audio));
}

export async function run() {
  const metrics = {};
  const truthSet = new Set(MELODY_MIDI);
  for (const vib of VIBRATO) {
    const { audio, truthNotes } = sungLine({ sr: SR, vibCents: vib });
    const raw = await bp.getRaw(audio);
    const { notes } = bp.notesFrom(raw, APP_DEFAULTS);
    const m = noteF1(notes, truthNotes);
    metrics[`fragmentation_vib${vib}`] = { value: round(fragmentation(notes, truthNotes), 2), better: "lower", tol: 0.25 };
    metrics[`f1_vib${vib}`] = { value: round(m.f1, 3), better: "higher", tol: 0.05 };
    metrics[`lateMs_vib${vib}`] = { value: round(m.meanLatenessMs, 1), better: "lower", tol: 5 };
    metrics[`offPitch_vib${vib}`] = {
      value: notes.filter((n) => !truthSet.has(Math.round(n.pitchMidi))).length,
      better: "lower",
      tol: 1,
    };
  }
  return { metrics, gates: [] };
}

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
