#!/usr/bin/env node
/**
 * Checks the guide instrument (src/lib/audio/guide.ts and guideLine.ts):
 *  - a long held bowed A3 stays in tune, vibrato included (vibrato used to drift further off
 *    the longer a note was held), and so does every other sustained timbre
 *  - two renders are byte-identical (the noise is seeded)
 *  - plucked notes still come out no louder than 0.9
 *  - no output sample is NaN, and the output is exactly the requested length
 *  - two slurred notes do not dip in loudness at the join (one bow stroke, no re-attack)
 *
 * Carries its own small pitch tracker so it does not depend on the eval folder.
 *
 * Run with: node --experimental-strip-types scripts/verify-guide.mjs
 */
import { registerHooks } from "node:module";

// src/ files import their siblings without an extension, the way the bundler resolves them
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !/\.[cm]?[jt]s$/.test(spec) && ctx.parentURL?.includes("/src/")) spec += ".ts";
    return next(spec, ctx);
  },
});

const guide = await import("../src/lib/audio/guide.ts").catch((e) => {
  console.error(e);
  return null;
});
if (!guide) {
  console.log("run with: node --experimental-strip-types scripts/verify-guide.mjs");
  process.exit(1);
}
const { synthesizeGuide } = guide;

const SR = 44100;
let failed = 0;
const check = (label, ok, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? `: ${detail}` : ""}`);
};

/**
 * Pitch of one window by normalised autocorrelation (McLeod's NSDF): the first peak that comes
 * within 10% of the highest one, refined with a parabola. Null when nothing periodic is there.
 */
function pitchOf(x, sr, minHz = 60, maxHz = 1000) {
  const n = x.length;
  const lo = Math.floor(sr / maxHz);
  const hi = Math.min(n - 1, Math.ceil(sr / minHz));
  const nsdf = new Float64Array(hi + 2);
  for (let tau = 0; tau <= hi + 1; tau++) {
    let acf = 0, m = 0;
    for (let i = 0; i + tau < n; i++) {
      acf += x[i] * x[i + tau];
      m += x[i] * x[i] + x[i + tau] * x[i + tau];
    }
    nsdf[tau] = m > 0 ? (2 * acf) / m : 0;
  }
  let best = 0;
  for (let t = lo; t <= hi; t++) best = Math.max(best, nsdf[t]);
  if (best < 0.5) return null;
  for (let t = Math.max(lo, 1); t <= hi; t++) {
    if (nsdf[t] >= 0.9 * best && nsdf[t] >= nsdf[t - 1] && nsdf[t] >= nsdf[t + 1]) {
      const a = nsdf[t - 1], b = nsdf[t], c = nsdf[t + 1];
      const d = a - 2 * b + c;
      const shift = d !== 0 ? (a - c) / (2 * d) : 0;
      return sr / (t + Math.max(-1, Math.min(1, shift)));
    }
  }
  return null;
}

const cents = (hz, ref) => 1200 * Math.log2(hz / ref);
const hasNaN = (a) => a.some((v) => Number.isNaN(v));
const peakOf = (...chans) => chans.reduce((p, a) => a.reduce((q, v) => Math.max(q, Math.abs(v)), p), 0);

/** Worst distance from `hz` in cents over 50 ms steps from `from` to `to` seconds; misses are windows with no pitch. */
function tuning(audio, hz, from, to, win = 2048) {
  let worst = 0, misses = 0;
  for (let t = from; t + win / SR <= to; t += 0.05) {
    const s = Math.floor(t * SR);
    const p = pitchOf(audio.subarray(s, s + win), SR);
    if (!p) { misses++; continue; }
    worst = Math.max(worst, Math.abs(cents(p, hz)));
  }
  return { worst, misses };
}

const A3 = { pitchMidi: 57, startTimeSeconds: 0, durationSeconds: 4, amplitude: 0.6, pitchBends: [] };
const A3_HZ = 220;

// 1. a 4 s bowed A3, no room: every 50 ms window after 0.3 s within ±15 cents
{
  const [left] = synthesizeGuide([A3], { timbre: "bowed", sampleRate: SR, lengthSamples: Math.floor(4.5 * SR), room: false });
  const { worst, misses } = tuning(left, A3_HZ, 0.3, 4);
  check("bowed: held A3 stays within 15 cents for 4 s", misses === 0 && worst <= 15, `worst ${worst.toFixed(1)} cents, ${misses} unreadable windows`);
}

// the other sustained timbres (deeper vibrato on some, so a little more slack)
for (const timbre of ["breath", "reed", "brass", "voice"]) {
  const [left, right] = synthesizeGuide([{ ...A3, durationSeconds: 3 }], { timbre, sampleRate: SR, lengthSamples: SR * 4, room: false });
  const { worst, misses } = tuning(left, A3_HZ, 0.5, 2.9);
  check(`${timbre}: held A3 stays in tune for 3 s`, misses === 0 && worst < 25, `worst ${worst.toFixed(1)} cents, ${misses} unreadable windows`);
  check(`${timbre}: without the room both channels are the same signal`, left === right);
}

// 2. determinism, with the room and the noise
for (const timbre of ["bowed", "voice", "plucked"]) {
  const notes = [A3, { ...A3, pitchMidi: 60, startTimeSeconds: 1.5, durationSeconds: 1 }];
  const o = { timbre, sampleRate: SR, lengthSamples: 3 * SR };
  const [l1, r1] = synthesizeGuide(notes, o);
  const [l2, r2] = synthesizeGuide(notes, o);
  const same = Buffer.compare(Buffer.from(l1.buffer), Buffer.from(l2.buffer)) === 0 && Buffer.compare(Buffer.from(r1.buffer), Buffer.from(r2.buffer)) === 0;
  check(`${timbre}: two renders are byte-identical`, same);
}

// 3. plucked notes stacked into a loud chord still peak at 0.9 or less
{
  const chord = [40, 45, 50, 55, 59, 64].map((m) => ({ pitchMidi: m, startTimeSeconds: 0.1, durationSeconds: 1, amplitude: 1, pitchBends: [] }));
  const [l, r] = synthesizeGuide(chord, { timbre: "plucked", sampleRate: SR, lengthSamples: 2 * SR });
  const peak = peakOf(l, r);
  check("plucked: a loud chord peaks at 0.9 or less", peak <= 0.9 && peak > 0.1, `peak ${peak.toFixed(3)}`);
}

// 4. no NaN, exact length, every timbre, with and without a contour and the room
{
  const contour = { fps: 100, midi: Array.from({ length: 300 }, (_, j) => (j > 20 && j < 250 ? 57 + 0.3 * Math.sin(j / 5) : 0)), level: Array.from({ length: 300 }, (_, j) => (j > 20 && j < 250 ? 0.2 : 0)) };
  const notes = [A3, { ...A3, pitchMidi: 59, startTimeSeconds: 1, durationSeconds: 0.01 }, { ...A3, pitchMidi: 200, startTimeSeconds: 1 }];
  let bad = [];
  for (const timbre of ["bowed", "plucked", "struck", "breath", "reed", "brass", "voice"]) {
    for (const o of [{}, { contour }, { room: false }, { contour: { fps: 100, midi: [], level: [] } }, { targetRms: 0.3, seed: 7, bodyScale: 2.75 }]) {
      const len = 2 * SR + 17;
      const [l, r] = synthesizeGuide(notes, { timbre, sampleRate: SR, lengthSamples: len, ...o });
      if (l.length !== len || r.length !== len) bad.push(`${timbre} length`);
      if (hasNaN(l) || hasNaN(r)) bad.push(`${timbre} NaN ${JSON.stringify(Object.keys(o))}`);
      if (peakOf(l, r) > 0.9 + 1e-6) bad.push(`${timbre} peak`);
    }
  }
  const [el, er] = synthesizeGuide([], { timbre: "bowed", sampleRate: SR, lengthSamples: 1000 });
  if (el.length !== 1000 || er.length !== 1000 || peakOf(el, er) !== 0) bad.push("empty part");
  check("every timbre: exact length, no NaN, peak ≤ 0.9", bad.length === 0, bad.slice(0, 5).join(", "));
}

// 5. two notes slurred 0.02 s apart: no loudness drop below half the mean at the join
{
  const notes = [
    { pitchMidi: 57, startTimeSeconds: 0.2, durationSeconds: 1, amplitude: 0.6, pitchBends: [] },
    { pitchMidi: 60, startTimeSeconds: 1.22, durationSeconds: 1, amplitude: 0.6, pitchBends: [] },
  ];
  const [l] = synthesizeGuide(notes, { timbre: "bowed", sampleRate: SR, lengthSamples: 3 * SR, room: false });
  const hop = Math.round(0.01 * SR);
  const frame = (t) => {
    const s = Math.floor(t * SR);
    let acc = 0;
    for (let i = s; i < s + hop; i++) acc += l[i] * l[i];
    return Math.sqrt(acc / hop);
  };
  let mean = 0, n = 0;
  for (let t = 0.5; t < 2.1; t += 0.01) { mean += frame(t); n++; }
  mean /= n;
  let low = Infinity;
  for (let t = 1.11; t < 1.31; t += 0.01) low = Math.min(low, frame(t));
  check("bowed: a slur keeps the sound going through the join", low >= 0.5 * mean, `lowest ${(low / mean).toFixed(2)}× the mean`);
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall guide checks passed");
