#!/usr/bin/env node
/**
 * Checks the take marker against a performance whose faults are known.
 *
 * Run with: node --experimental-strip-types scripts/verify-marking.mjs
 */
const src = await import("../src/lib/transcribe/compare.ts").catch(() => null);
if (!src) {
  console.log("run with: node --experimental-strip-types scripts/verify-marking.mjs");
  process.exit(0);
}
const { markTake, summarise, barsToRange } = src;

const BPM = 120;
const OPTS = { bpm: BPM, beatsPerBar: 4, offsetSeconds: 0 };
const beat = 60 / BPM; // 0.5s

// Eight quarter notes: two bars of four.
const CHART = [60, 62, 64, 65, 67, 65, 64, 62].map((m, i) => ({
  startTimeSeconds: i * beat,
  durationSeconds: beat * 0.9,
  pitchMidi: m,
  amplitude: 0.8,
}));

// A take with deliberate, countable faults:
//   note 0  played exactly            -> clean
//   note 1  a semitone flat           -> flat
//   note 2  200 ms late               -> late
//   note 3  not played at all         -> missed
//   note 4  clean
//   note 5  clean
//   note 6  clean
//   note 7  clean, plus one note that is not in the chart at all -> extra
const PLAYED = [
  { i: 0, midi: 60, dt: 0 },
  { i: 1, midi: 61, dt: 0 },
  { i: 2, midi: 64, dt: 0.2 },
  { i: 4, midi: 67, dt: 0 },
  { i: 5, midi: 65, dt: 0 },
  { i: 6, midi: 64, dt: 0 },
  { i: 7, midi: 62, dt: 0 },
].map((p) => ({
  startTimeSeconds: p.i * beat + p.dt,
  durationSeconds: beat * 0.9,
  pitchMidi: p.midi,
  amplitude: 0.8,
}));
PLAYED.push({ startTimeSeconds: 3.6, durationSeconds: 0.2, pitchMidi: 71, amplitude: 0.5 });

const r = markTake(CHART, PLAYED, OPTS);
const by = (v) => r.judgements.filter((j) => j.verdict === v).length;

const checks = [
  ["clean notes", by("clean"), 5],
  ["flat", by("flat"), 1],
  ["late", by("late"), 1],
  ["missed", by("missed"), 1],
  ["extra", by("extra"), 1],
  ["the flat note is note 1 (D)", r.judgements.find((j) => j.verdict === "flat")?.expectedMidi, 62],
  ["the late note is 200 ms late", r.judgements.find((j) => j.verdict === "late")?.msOff, 200],
  ["the missed note is F (65)", r.judgements.find((j) => j.verdict === "missed")?.expectedMidi, 65],
  ["accuracy is 5 of 8", Math.round(r.accuracy * 1000) / 1000, 0.625],
  ["bar 1 holds four notes", r.bars.find((b) => b.bar === 1)?.notes, 4],
  ["bar 2 holds four notes", r.bars.find((b) => b.bar === 2)?.notes, 4],
  // Bar 1 is notes 0-3: clean, flat, late, missed. Only the first is clean.
  ["bar 1 has one clean note of four", r.bars.find((b) => b.bar === 1)?.clean, 1],
  // Bar 2 is notes 4-7, all played correctly. The stray extra note sits in
  // this bar too but does not count against it — an added note is noise,
  // not a requirement the player failed to meet.
  ["bar 2 is entirely clean", r.bars.find((b) => b.bar === 2)?.clean, 4],
];

let failed = 0;
for (const [what, got, want] of checks) {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}: ${got}${ok ? "" : ` (expected ${want})`}`);
}

console.log("\nsummary:", summarise(r));
console.log("worst bars:", r.worstBars.map((b) => `bar ${b.bar} (${Math.round(b.accuracy * 100)}%)`).join(", ") || "none");
console.log("loop range:", barsToRange(r.worstBars, OPTS));

// A perfect take must come back perfect, and an empty one must not divide by zero.
const perfect = markTake(CHART, CHART, OPTS);
console.log(`\n${perfect.accuracy === 1 ? "ok  " : "FAIL"}  an identical take scores 100%: ${Math.round(perfect.accuracy * 100)}%`);
if (perfect.accuracy !== 1) failed++;

const silent = markTake(CHART, [], OPTS);
console.log(`${silent.missed === 8 && silent.accuracy === 0 ? "ok  " : "FAIL"}  playing nothing misses all 8`);
if (!(silent.missed === 8 && silent.accuracy === 0)) failed++;

const nothingWritten = markTake([], PLAYED, OPTS);
console.log(`${nothingWritten.extra === 8 ? "ok  " : "FAIL"}  with no chart, everything played is extra: ${nothingWritten.extra}`);
if (nothingWritten.extra !== 8) failed++;

process.exit(failed ? 1 : 0);
