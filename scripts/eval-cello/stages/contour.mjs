/**
 * How closely the continuous pitch curve (src/lib/transcribe/contour.ts) follows a sung line.
 *
 * Synthetic sung line (lib/fixtures.mjs) at three vibrato depths. Basic Pitch runs on it, the
 * contour peaks are picked, and the line is tracked through them using the written notes, so this
 * scores the curve alone and not the note detection. The answer is the fixture's own pitch per
 * 10 ms, compared on frames where both say something is sounding.
 *
 * On the 2-second note (the long D) the vibrato itself is measured: depth as half the peak-to-peak
 * of the curve with its straight-line trend removed, rate from the zero crossings of that.
 *
 * Slow: it needs the model output, which notes-raw already caches for the same three lines.
 * It uses no downloaded data, so it does not depend on RIFFSCRIBE_EVAL_DATA.
 */
import { sungLine } from "../lib/fixtures.mjs";
import { createRequire } from "node:module";
import { pickPeaks, trackContour } from "../../../src/lib/transcribe/contour.ts";

const bp = createRequire(import.meta.url)("../lib/bp-node.cjs");

export const name = "contour";
export const slow = true;

const SR = 22050;
const VIBRATO = [1, 40, 80];
/** Index of the 2-second note in MELODY_SECONDS. */
const LONG_NOTE = 3;

export async function ready() {
  return VIBRATO.every((v) => bp.hasCache(sungLine({ sr: SR, vibCents: v }).audio));
}

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

/** Detrended slice of a 100 fps curve between two times. */
function detrended(midi, t0, t1) {
  const ys = [];
  for (let j = Math.ceil(t0 * 100); j < Math.floor(t1 * 100); j++) ys.push(midi[j]);
  const n = ys.length;
  const xm = (n - 1) / 2;
  const ym = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0, sxx = 0;
  ys.forEach((y, i) => { sxy += (i - xm) * (y - ym); sxx += (i - xm) ** 2; });
  const slope = sxy / sxx;
  return ys.map((y, i) => y - (ym + slope * (i - xm)));
}

/** Depth in cents (half peak-to-peak) and rate in Hz (from zero crossings) of a detrended curve. */
function vibrato(d) {
  const depth = ((Math.max(...d) - Math.min(...d)) / 2) * 100;
  const crossings = [];
  for (let i = 1; i < d.length; i++) {
    if ((d[i - 1] < 0 && d[i] >= 0) || (d[i - 1] >= 0 && d[i] < 0)) {
      // linear interpolation of where it crossed, in frames
      crossings.push(i - 1 + d[i - 1] / (d[i - 1] - d[i]));
    }
  }
  const rate = crossings.length >= 2
    ? (crossings.length - 1) / 2 / ((crossings[crossings.length - 1] - crossings[0]) / 100)
    : 0;
  return { depth, rate };
}

export async function run() {
  const metrics = {};
  const gates = [];
  for (const vib of VIBRATO) {
    const { audio, truthNotes, f0 } = sungLine({ sr: SR, vibCents: vib });
    const raw = await bp.getRaw(audio);
    const peaks = pickPeaks(raw.contours);
    const curve = trackContour(peaks, truthNotes, audio.length / SR);

    const errs = [];
    const n = Math.min(curve.midi.length, f0.midi.length);
    for (let j = 0; j < n; j++) {
      if (curve.midi[j] > 0 && f0.midi[j] > 0) errs.push((curve.midi[j] - f0.midi[j]) * 100);
    }
    const within = errs.filter((e) => Math.abs(e) <= 50).length / Math.max(1, errs.length);
    const rmsErr = Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / Math.max(1, errs.length));
    const sorted = [...errs].sort((a, b) => a - b);
    const med = sorted.length ? (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2 : 0;

    metrics[`within50_vib${vib}`] = { value: round(within, 3), better: "higher", tol: 0.01 };
    metrics[`rmsCents_vib${vib}`] = { value: round(rmsErr, 1), better: "lower", tol: 2 };
    metrics[`medianCents_vib${vib}`] = { value: round(med, 1), better: "lower", tol: 3, info: true };
    metrics[`absMedianCents_vib${vib}`] = { value: round(Math.abs(med), 1), better: "lower", tol: 3 };
    metrics[`voicedFrames_vib${vib}`] = { value: errs.length, better: "higher", tol: 0, info: true };
    gates.push(
      { key: `within50_vib${vib}`, op: ">=", value: 0.95 },
      { key: `rmsCents_vib${vib}`, op: "<=", value: 25 },
      { key: `absMedianCents_vib${vib}`, op: "<=", value: 8 },
    );

    if (vib >= 40) {
      // the steady part of the long note: vibrato is fully in from 0.55 s, stop short of the end
      const note = truthNotes[LONG_NOTE];
      const t0 = note.startTimeSeconds + 0.6;
      const t1 = note.startTimeSeconds + note.durationSeconds - 0.1;
      const truth = vibrato(detrended(f0.midi, t0, t1));
      const got = vibrato(detrended(curve.midi, t0, t1));
      const depthErrPct = (Math.abs(got.depth - truth.depth) / truth.depth) * 100;
      const rateErrHz = Math.abs(got.rate - truth.rate);
      metrics[`vibDepthCents_vib${vib}`] = { value: round(got.depth, 1), better: "higher", tol: 0, info: true };
      metrics[`vibRateHz_vib${vib}`] = { value: round(got.rate, 2), better: "higher", tol: 0, info: true };
      metrics[`vibDepthErrPct_vib${vib}`] = { value: round(depthErrPct, 1), better: "lower", tol: 5 };
      metrics[`vibRateErrHz_vib${vib}`] = { value: round(rateErrHz, 2), better: "lower", tol: 0.1 };
      gates.push(
        { key: `vibDepthErrPct_vib${vib}`, op: "<=", value: 35 },
        { key: `vibRateErrHz_vib${vib}`, op: "<=", value: 0.6 },
      );
    }
  }
  return { metrics, gates };
}
