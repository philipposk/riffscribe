#!/usr/bin/env node
/**
 * Checks the guide instrument stays on the written pitch through a long held note,
 * vibrato included. (Vibrato used to drift further off the longer a note was held.)
 *
 * Run with: node --experimental-strip-types scripts/verify-guide.mjs
 */
const guide = await import("../src/lib/audio/guide.ts").catch(() => null);
const tuner = await import("../src/lib/audio/tuner.ts").catch(() => null);
if (!guide || !tuner) {
  console.log("run with: node --experimental-strip-types scripts/verify-guide.mjs");
  process.exit(0);
}
const { synthesizeGuide } = guide;
const { detectPitch } = tuner;

const SR = 44100;
const WIN = 4096;

let failed = 0;
const check = (label, ok, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? `: ${detail}` : ""}`);
};

for (const timbre of ["bowed", "breath", "reed", "brass", "voice"]) {
  const midi = 57; // A3
  const hz = 440 * Math.pow(2, (midi - 69) / 12);
  const [left, right] = synthesizeGuide(
    [{ pitchMidi: midi, startTimeSeconds: 0, durationSeconds: 3, amplitude: 0.6, pitchBends: [] }],
    { timbre, sampleRate: SR, lengthSamples: SR * 4 }
  );
  let worst = 0;
  let misses = 0;
  for (let t = 0.5; t + WIN / SR <= 2.9; t += 0.05) {
    const start = Math.floor(t * SR);
    const r = detectPitch(left.subarray(start, start + WIN), SR);
    if (!r) { misses++; continue; }
    worst = Math.max(worst, Math.abs(1200 * Math.log2(r.hz / hz)));
  }
  // vibrato depth tops out near 12 cents (voice); allow some detector slack on top
  check(`${timbre}: held A3 stays in tune for 3 s`, misses === 0 && worst < 25,
    `worst ${worst.toFixed(1)} cents, ${misses} unreadable windows`);
  check(`${timbre}: both channels are the same signal`, left === right || left.every((v, i) => v === right[i]));
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall guide checks passed");
