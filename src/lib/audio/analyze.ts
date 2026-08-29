/**
 * Tempo, downbeat and key estimation.
 *
 * Tempo comes from an onset-strength curve (how much the spectrum brightens
 * frame to frame) run through an autocorrelation — the lag that repeats most
 * strongly is the beat. Key comes from comparing the song's pitch histogram
 * against the classic Krumhansl–Schmuckler major/minor templates.
 */
import { stft } from "./fft";

export interface TempoResult {
  bpm: number;
  /** Seconds before the first beat — used to line bar 1 up with the music. */
  offsetSeconds: number;
  confidence: number;
}

const FRAME_HOP = 512;

/** Spectral-flux onset strength, one value per `FRAME_HOP` samples. */
export function onsetEnvelope(mono: Float32Array, sampleRate: number) {
  const s = stft(mono, 2048, FRAME_HOP);
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
  // normalise
  let max = 0;
  for (const v of env) max = Math.max(max, v);
  if (max > 0) for (let i = 0; i < env.length; i++) env[i] /= max;
  return { env, fps: sampleRate / FRAME_HOP };
}

export function estimateTempo(mono: Float32Array, sampleRate: number): TempoResult {
  const { env, fps } = onsetEnvelope(mono, sampleRate);
  if (env.length < 16) return { bpm: 120, offsetSeconds: 0, confidence: 0 };

  // remove the DC/slow trend so autocorrelation reacts to pulses, not loudness
  const mean = env.reduce((a, b) => a + b, 0) / env.length;
  const x = Float32Array.from(env, (v) => v - mean);

  const minBpm = 55, maxBpm = 210;
  const minLag = Math.floor((60 / maxBpm) * fps);
  const maxLag = Math.ceil((60 / minBpm) * fps);
  let best = { lag: minLag, score: -Infinity };

  for (let lag = minLag; lag <= maxLag && lag < x.length; lag++) {
    let acc = 0;
    for (let i = 0; i + lag < x.length; i++) acc += x[i] * x[i + lag];
    acc /= x.length - lag;
    const bpm = (60 * fps) / lag;
    // humans hear tempo around 120 — bias against octave errors
    const bias = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    const score = acc * bias;
    if (score > best.score) best = { lag, score };
  }

  const bpm = (60 * fps) / best.lag;

  // beat phase: slide a comb of impulses at the found period, keep the best fit
  let bestPhase = 0, bestPhaseScore = -Infinity;
  for (let p = 0; p < best.lag; p++) {
    let acc = 0;
    for (let i = p; i < env.length; i += best.lag) acc += env[i];
    if (acc > bestPhaseScore) { bestPhaseScore = acc; bestPhase = p; }
  }

  const rms = Math.sqrt(x.reduce((a, b) => a + b * b, 0) / x.length) || 1e-9;
  const confidence = Math.max(0, Math.min(1, best.score / (rms * rms) / 3));

  return {
    bpm: Math.round(bpm * 10) / 10,
    offsetSeconds: bestPhase / fps,
    confidence,
  };
}

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
export const PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export interface KeyResult {
  tonic: number;
  mode: "major" | "minor";
  name: string;
  /** MusicXML/alphaTab key signature: -7..7 (flats..sharps). */
  fifths: number;
  confidence: number;
}

function corr(a: number[], b: number[]) {
  const ma = a.reduce((x, y) => x + y, 0) / a.length;
  const mb = b.reduce((x, y) => x + y, 0) / b.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / (Math.sqrt(da * db) || 1e-9);
}

/** Circle-of-fifths position for a major tonic (C=0). */
const MAJOR_FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];

export function estimateKey(chroma: number[]): KeyResult {
  let best: KeyResult = { tonic: 0, mode: "major", name: "C major", fifths: 0, confidence: 0 };
  for (let t = 0; t < 12; t++) {
    const rotated = chroma.map((_, i) => chroma[(i + t) % 12]);
    for (const mode of ["major", "minor"] as const) {
      const c = corr(rotated, mode === "major" ? MAJOR : MINOR);
      if (c > best.confidence) {
        // a minor key shares its signature with the major a minor-3rd up
        const relMajor = mode === "major" ? t : (t + 3) % 12;
        best = {
          tonic: t,
          mode,
          name: `${PITCH_NAMES[t]} ${mode}`,
          fifths: MAJOR_FIFTHS[relMajor],
          confidence: c,
        };
      }
    }
  }
  return best;
}

export function chromaFromNotes(notes: { pitchMidi: number; durationSeconds: number; amplitude: number }[]) {
  const chroma = new Array(12).fill(0);
  for (const n of notes) chroma[n.pitchMidi % 12] += n.durationSeconds * (0.5 + n.amplitude);
  return chroma;
}
