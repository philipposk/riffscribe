#!/usr/bin/env node
/** Checks the voice splitter on a passage whose two lines are known. */
const TOP = [72, 74, 76, 77, 76, 74, 72];
const LOW = [55, 57, 59, 60, 59, 57, 55];
const notes = [];
TOP.forEach((m, i) => {
  notes.push({ startTimeSeconds: i * 0.5, durationSeconds: 0.45, pitchMidi: m, amplitude: 0.8 });
  notes.push({ startTimeSeconds: i * 0.5, durationSeconds: 0.45, pitchMidi: LOW[i], amplitude: 0.7 });
});

const src = await import("../src/lib/transcribe/voices.ts").catch(() => null);
if (!src) {
  console.log("run with: node --experimental-strip-types scripts/verify-voices.mjs");
  process.exit(0);
}
const { splitVoices, spreadSeats, fitToRange } = src;
const voices = splitVoices(notes, 4).filter((v) => v.notes.length);
console.log("voices found:", voices.length);
voices.forEach((v, i) =>
  console.log(`  voice ${i}: ${v.notes.map((n) => n.pitchMidi).join(",")}`)
);
const quartet = ["violin", "violin", "viola", "cello"];
console.log("seats for", voices.length, "voices:", spreadSeats(quartet, voices.length));
console.log("cello range fit of low line:",
  fitToRange(voices[voices.length - 1].notes, [36, 84]).map((n) => n.pitchMidi).slice(0, 4));
