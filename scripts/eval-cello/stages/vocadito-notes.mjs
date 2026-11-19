/**
 * Real singing: raw Basic Pitch notes against the human-annotated notes of vocadito.
 *
 * Needs RIFFSCRIBE_EVAL_DATA (a folder holding vocadito/), skips cleanly without it. Slow on the
 * first run (about one second of model time per second of audio, 40 excerpts); the model output
 * is cached after that. Optional RIFFSCRIBE_EVAL_LIMIT=N runs only the first N excerpts.
 *
 * Scores are averaged over the two annotators and over the excerpts: note F1 (onset within 50 ms,
 * pitch within 50 cents), notes found per note annotated, and mean onset lateness.
 */
import { createRequire } from "node:module";
import { vocaditoTracks } from "../lib/vocadito.mjs";
import { decode } from "../lib/media.mjs";
import { noteF1, fragmentation } from "../lib/metrics.mjs";

const bp = createRequire(import.meta.url)("../lib/bp-node.cjs");

export const name = "vocadito-notes";
export const slow = true;

const APP_DEFAULTS = { onset: 0.5, frame: 0.3, minLen: 11, melodia: true, minHz: null, maxHz: null };
const limit = () => Number(process.env.RIFFSCRIBE_EVAL_LIMIT) || Infinity;
const load22k = (t) => decode(t.wav, { sr: 22050, channels: 1 })[0];

export async function ready(ctx) {
  if (!ctx.dataDir) return false;
  const tracks = vocaditoTracks(ctx.dataDir, limit());
  return !!tracks && tracks.length > 0 && tracks.every((t) => bp.hasCache(load22k(t)));
}

export async function run(ctx) {
  if (!ctx.dataDir) return { skipped: "RIFFSCRIBE_EVAL_DATA is not set" };
  const tracks = vocaditoTracks(ctx.dataDir, limit());
  if (!tracks) return { skipped: `no vocadito/Audio under ${ctx.dataDir}` };

  const f1 = [], frag = [], late = [];
  for (const t of tracks) {
    const audio = load22k(t);
    const cached = bp.hasCache(audio);
    const raw = await bp.getRaw(audio);
    const { notes } = bp.notesFrom(raw, APP_DEFAULTS);
    const scores = [t.notesA1, t.notesA2].filter(Boolean).map((truth) => ({ m: noteF1(notes, truth), truth }));
    if (!scores.length) continue;
    f1.push(mean(scores.map((s) => s.m.f1)));
    frag.push(mean(scores.map((s) => fragmentation(notes, s.truth))));
    late.push(mean(scores.map((s) => s.m.meanLatenessMs)));
    if (!cached) ctx.log(`vocadito_${t.id}: ${notes.length} notes, f1 ${f1[f1.length - 1].toFixed(3)}`);
  }
  if (!f1.length) return { skipped: "no annotated excerpts found" };
  const r = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
  return {
    metrics: {
      excerpts: { value: f1.length, better: "higher", tol: 0, info: true },
      meanNoteF1: { value: r(mean(f1), 3), better: "higher", tol: 0.02 },
      meanFragmentation: { value: r(mean(frag), 2), better: "lower", tol: 0.15 },
      meanLatenessMs: { value: r(mean(late), 1), better: "lower", tol: 5 },
    },
    gates: [],
  };
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
