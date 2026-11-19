#!/usr/bin/env node
/**
 * Checks the streaming instant split and onset envelope give the same answers as the
 * original whole-song STFT versions (kept below as the reference), and that a mono
 * recording is refused rather than "split" into nothing.
 *
 * Run with: node --experimental-strip-types scripts/verify-dsp.mjs
 */
import { registerHooks } from "node:module";

// src/ imports siblings without an extension, as the bundler allows.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !/\.[cm]?[jt]s$/.test(spec) && ctx.parentURL?.includes("/src/")) spec += ".ts";
    return next(spec, ctx);
  },
});

const karaoke = await import("../src/lib/audio/karaoke.ts").catch(() => null);
const analyze = await import("../src/lib/audio/analyze.ts").catch(() => null);
const fftMod = await import("../src/lib/audio/fft.ts").catch(() => null);
if (!karaoke || !analyze || !fftMod) {
  console.log("run with: node --experimental-strip-types scripts/verify-dsp.mjs");
  process.exit(1);
}
const { splitCenter, isEffectivelyMono } = karaoke;
const { onsetEnvelope } = analyze;
const { fft, hann } = fftMod;

let failed = 0;
const check = (label, ok, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? `: ${detail}` : ""}`);
};

/* ---------------------------------------------- reference: the old versions */

function stft(signal, fftSize = 2048, hop = fftSize / 4) {
  const w = hann(fftSize);
  const bins = fftSize / 2 + 1;
  const frames = Math.max(1, Math.ceil((signal.length + fftSize) / hop));
  const re = [], im = [];
  const br = new Float32Array(fftSize), bi = new Float32Array(fftSize);
  for (let f = 0; f < frames; f++) {
    const start = f * hop - fftSize / 2;
    br.fill(0); bi.fill(0);
    for (let i = 0; i < fftSize; i++) {
      const s = start + i;
      br[i] = s >= 0 && s < signal.length ? signal[s] * w[i] : 0;
    }
    fft(br, bi);
    const fr = new Float32Array(bins), fi = new Float32Array(bins);
    fr.set(br.subarray(0, bins)); fi.set(bi.subarray(0, bins));
    re.push(fr); im.push(fi);
  }
  return { re, im, frames, bins, fftSize, hop };
}

function istft(s, length) {
  const { fftSize, hop, frames, bins } = s;
  const w = hann(fftSize);
  const out = new Float32Array(length), norm = new Float32Array(length);
  const br = new Float32Array(fftSize), bi = new Float32Array(fftSize);
  for (let f = 0; f < frames; f++) {
    br.fill(0); bi.fill(0);
    for (let b = 0; b < bins; b++) { br[b] = s.re[f][b]; bi[b] = s.im[f][b]; }
    for (let b = 1; b < bins - 1; b++) { br[fftSize - b] = s.re[f][b]; bi[fftSize - b] = -s.im[f][b]; }
    fft(br, bi, true);
    const start = f * hop - fftSize / 2;
    for (let i = 0; i < fftSize; i++) {
      const t = start + i;
      if (t < 0 || t >= length) continue;
      out[t] += br[i] * w[i];
      norm[t] += w[i] * w[i];
    }
  }
  for (let i = 0; i < length; i++) if (norm[i] > 1e-8) out[i] /= norm[i];
  return out;
}

const clone = (s) => ({ ...s, re: s.re.map((f) => Float32Array.from(f)), im: s.im.map((f) => Float32Array.from(f)) });

function oldSplitCenter(left, right, sampleRate, opts = {}) {
  const fftSize = opts.fftSize ?? 4096, strength = opts.strength ?? 2;
  const lowKeepHz = opts.lowKeepHz ?? 120, highKeepHz = opts.highKeepHz ?? 14000;
  const hop = fftSize / 4;
  const L = stft(left, fftSize, hop), R = stft(right, fftSize, hop);
  const cL = clone(L), cR = clone(R), iL = clone(L), iR = clone(R);
  const binHz = sampleRate / fftSize;
  const loBin = Math.floor(lowKeepHz / binHz), hiBin = Math.ceil(highKeepHz / binHz);
  for (let f = 0; f < L.frames; f++) {
    for (let b = 0; b < L.bins; b++) {
      const lr = L.re[f][b], li = L.im[f][b], rr = R.re[f][b], ri = R.im[f][b];
      let g = 0;
      if (b >= loBin && b <= hiBin) {
        const dot = lr * rr + li * ri;
        const energy = lr * lr + li * li + rr * rr + ri * ri;
        const sim = energy > 1e-12 ? (2 * dot) / energy : 0;
        g = Math.pow(Math.max(0, Math.min(1, sim)), strength);
      }
      const mr = ((lr + rr) / 2) * g, mi = ((li + ri) / 2) * g;
      cL.re[f][b] = mr; cL.im[f][b] = mi; cR.re[f][b] = mr; cR.im[f][b] = mi;
      iL.re[f][b] = lr - mr; iL.im[f][b] = li - mi; iR.re[f][b] = rr - mr; iR.im[f][b] = ri - mi;
    }
  }
  const n = left.length;
  return { instrumental: [istft(iL, n), istft(iR, n)], center: [istft(cL, n), istft(cR, n)] };
}

function oldOnsetEnvelope(mono, sampleRate) {
  const s = stft(mono, 2048, 512);
  const env = new Float32Array(s.frames);
  let prev = new Float32Array(s.bins);
  for (let f = 0; f < s.frames; f++) {
    let sum = 0;
    const mag = new Float32Array(s.bins);
    for (let b = 0; b < s.bins; b++) {
      const m = Math.log1p(Math.hypot(s.re[f][b], s.im[f][b]) * 100);
      mag[b] = m;
      const d = m - prev[b];
      if (d > 0) sum += d;
    }
    env[f] = sum;
    prev = mag;
  }
  let max = 0;
  for (const v of env) max = Math.max(max, v);
  if (max > 0) for (let i = 0; i < env.length; i++) env[i] /= max;
  return { env, fps: sampleRate / 512 };
}

/* -------------------------------------------------------------------- data */

const SR = 44100;
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;

/** A stereo mix: a centred tone (the "vocal") plus noise that differs per side. */
function stereoMix(n) {
  const l = new Float32Array(n), r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = 0.4 * Math.sin((2 * Math.PI * 440 * i) / SR);
    l[i] = v + 0.2 * rand();
    r[i] = v + 0.2 * rand();
  }
  return [l, r];
}

const maxDiff = (a, b) => {
  if (a.length !== b.length) return Infinity;
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
};

/* ------------------------------------------------------------------ checks */

for (const n of [SR * 0.7 | 0, 5000, 4096]) {
  const [l, r] = stereoMix(n);
  const want = oldSplitCenter(l, r, SR);
  const got = splitCenter(l, r, SR);
  const d = Math.max(
    maxDiff(got.instrumental[0], want.instrumental[0]),
    maxDiff(got.instrumental[1], want.instrumental[1]),
    maxDiff(got.center[0], want.center[0]),
    maxDiff(got.center[1], want.center[1]),
  );
  check(`instant split matches the original on ${n} samples`, d <= 1e-6, `max difference ${d}`);
  check(`instant split returns separate centre arrays (${n})`, got.center[0] !== got.center[1]);
}

{
  const [l] = stereoMix(SR);
  check("identical channels count as mono", isEffectivelyMono(l, Float32Array.from(l)));
  let threw = null;
  try { splitCenter(l, Float32Array.from(l), SR); } catch (e) { threw = e; }
  check("instant split refuses a mono recording", threw instanceof Error && /mono/i.test(threw.message), threw?.message);
  const [sl, sr] = stereoMix(SR);
  check("a real stereo mix is not mono", !isEffectivelyMono(sl, sr));
  check("silence is not called mono", !isEffectivelyMono(new Float32Array(100), new Float32Array(100)));
}

{
  // a click track with some noise, the kind of thing tempo detection sees
  const n = SR * 3;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = 0.02 * rand();
  for (let t = 0.1; t < 3; t += 0.5) {
    const s = Math.floor(t * SR);
    for (let i = 0; i < 1500 && s + i < n; i++) mono[s + i] += Math.sin((2 * Math.PI * 1000 * i) / SR) * Math.exp(-i / 260);
  }
  const want = oldOnsetEnvelope(mono, SR);
  const got = onsetEnvelope(mono, SR);
  check("onset envelope matches the original", got.fps === want.fps && maxDiff(got.env, want.env) <= 1e-6,
    `max difference ${maxDiff(got.env, want.env)}`);
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall dsp checks passed");
