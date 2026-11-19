/** Scoring helpers shared by the stages. All plain functions over arrays, no dependencies. */
import { createHash } from "node:crypto";

export const rms = (a) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, a.length));
};

const energy = (a) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return s;
};

/** Signal-to-distortion ratio in dB: how loud the truth is next to the error. Higher is better. */
export function sdr(ref, est) {
  const n = Math.min(ref.length, est.length);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += ref[i] * ref[i];
    const d = ref[i] - est[i];
    den += d * d;
  }
  return 10 * Math.log10((num + 1e-12) / (den + 1e-12));
}

/** Like `sdr`, but ignores whether the estimate is louder or quieter than the truth. */
export function siSdr(ref, est) {
  const n = Math.min(ref.length, est.length);
  let dot = 0, refE = 0;
  for (let i = 0; i < n; i++) { dot += ref[i] * est[i]; refE += ref[i] * ref[i]; }
  const a = dot / (refE + 1e-12);
  let target = 0, noise = 0;
  for (let i = 0; i < n; i++) {
    const t = a * ref[i];
    target += t * t;
    const e = est[i] - t;
    noise += e * e;
  }
  return 10 * Math.log10((target + 1e-12) / (noise + 1e-12));
}

export function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    sab += x * y; saa += x * x; sbb += y * y;
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
}

/** p in 0..100, linear interpolation between neighbours. */
export function percentile(values, p) {
  if (!values.length) return NaN;
  const s = Array.from(values).sort((a, b) => a - b);
  const pos = (Math.min(100, Math.max(0, p)) / 100) * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function sha256Float32(a) {
  return createHash("sha256").update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest("hex");
}

/** Distance from hz `a` to hz `b` in cents (100 cents = a semitone). */
export const centsBetween = (a, b) => 1200 * Math.log2(a / b);

/** Energy ratio in dB. */
export const dbRatio = (num, den) => 10 * Math.log10((energy(num) + 1e-12) / (energy(den) + 1e-12));

/**
 * Note accuracy by matching each true note to at most one found note: the closest unmatched one
 * that starts within `onsetTol` seconds and sits within `centsTol` cents of the true pitch.
 * A found note is never matched twice. Greedy by true-note start time.
 */
export function noteF1(found, truth, { onsetTol = 0.05, centsTol = 50 } = {}) {
  const used = new Array(found.length).fill(false);
  const matches = [];
  const order = truth.map((_, i) => i).sort((a, b) => truth[a].startTimeSeconds - truth[b].startTimeSeconds);
  for (const ti of order) {
    const t = truth[ti];
    let best = -1, bestDt = Infinity;
    for (let fi = 0; fi < found.length; fi++) {
      if (used[fi]) continue;
      const f = found[fi];
      const dt = Math.abs(f.startTimeSeconds - t.startTimeSeconds);
      if (dt > onsetTol) continue;
      if (Math.abs(f.pitchMidi - t.pitchMidi) * 100 > centsTol) continue;
      if (dt < bestDt) { bestDt = dt; best = fi; }
    }
    if (best >= 0) {
      used[best] = true;
      matches.push({ found: best, truth: ti, latenessSeconds: found[best].startTimeSeconds - t.startTimeSeconds });
    }
  }
  const tp = matches.length;
  const precision = found.length ? tp / found.length : 0;
  const recall = truth.length ? tp / truth.length : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const meanLatenessMs = tp ? (matches.reduce((a, m) => a + m.latenessSeconds, 0) / tp) * 1000 : 0;
  return { precision, recall, f1, matches, meanLatenessMs };
}

/** How many notes came out per note that was really sung. 1 is ideal; 3 means every note was chopped in three. */
export const fragmentation = (found, truth) => (truth.length ? found.length / truth.length : 0);

/**
 * Number of note starts in a recording: peaks of the spectral-flux curve from the app's own
 * `onsetEnvelope`, counted when they stand clearly above the local typical level (median of the
 * surrounding half second) and are at least `minGapSeconds` apart. Vibrato makes spectral flux flutter,
 * so wide vibrato inflates the count (that is worth knowing about a render). Needs the TypeScript loader
 * registered first.
 */
export async function onsetCount(audio, sr, { delta = 0.15, minGapSeconds = 0.1 } = {}) {
  const { onsetEnvelope } = await import("../../../src/lib/audio/analyze.ts");
  const { env, fps } = onsetEnvelope(audio, sr);
  const minGap = Math.max(1, Math.round(minGapSeconds * fps));
  const half = Math.max(1, Math.round(0.25 * fps));
  let count = 0, last = -Infinity;
  for (let i = 1; i < env.length - 1; i++) {
    if (!(env[i] > env[i - 1] && env[i] >= env[i + 1])) continue;
    const around = Array.from(env.subarray(Math.max(0, i - half), Math.min(env.length, i + half + 1)));
    if (env[i] < percentile(around, 50) + delta || i - last < minGap) continue;
    count++;
    last = i;
  }
  return count;
}
