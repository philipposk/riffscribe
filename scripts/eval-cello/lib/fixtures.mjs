/**
 * Synthetic test material whose right answer is known exactly: a sung line with a written-down
 * melody, and a stereo mix of that line over a backing band. Everything is deterministic, so a
 * change in a metric is a change in the code under test and never in the fixture.
 */
import { mulberry32, gaussian } from "./prng.mjs";

export const MELODY_MIDI = [55, 57, 59, 62, 60, 59, 57, 55];
export const MELODY_SECONDS = [0.6, 0.6, 0.6, 2.0, 0.5, 0.5, 1.2, 1.5];
const FIRST_NOTE_AT = 0.25;
const TAIL = 0.5;
const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

/**
 * A voice-like line: harmonics shaped by three formant bumps, a glide between notes, vibrato
 * that fades in, a slow loudness swell.
 *
 * Returns the audio, the notes as written (each starting at the middle of the glide into it), the
 * true pitch per 10 ms (fractional MIDI, 0 where
 * nothing sounds) and the true loudness per 10 ms.
 *
 * `seed` is accepted so every fixture takes the same options; the voice itself has no noise.
 */
export function sungLine({ sr, vibCents, vibHz = 5.5, glide = 0.08, transpose = 0, seed = 1 }) {
  void seed;
  const starts = [];
  let t0 = FIRST_NOTE_AT;
  for (const d of MELODY_SECONDS) { starts.push(t0); t0 += d; }
  const end = t0;
  const n = Math.ceil((end + TAIL) * sr);
  const audio = new Float32Array(n);

  /** Which note is sounding at time t, or -1. */
  const noteAt = (t) => {
    if (t < FIRST_NOTE_AT || t >= end) return -1;
    let k = starts.length - 1;
    while (k > 0 && t < starts[k]) k--;
    return k;
  };
  const midiAt = (t, k) => {
    const cur = MELODY_MIDI[k] + transpose;
    const tn = t - starts[k];
    let base = cur;
    if (k > 0 && tn < glide) {
      const prev = MELODY_MIDI[k - 1] + transpose;
      base = prev + (cur - prev) * (tn / glide);
    }
    const ramp = tn > 0.25 ? Math.min(1, (tn - 0.25) / 0.3) : 0;
    return base + (vibCents / 100) * Math.sin(2 * Math.PI * vibHz * tn) * ramp;
  };
  const levelAt = (t, k) => {
    const tn = t - starts[k];
    const d = MELODY_SECONDS[k];
    const env = Math.min(1, tn / 0.04) * Math.min(1, (d - tn) / 0.05);
    return Math.max(0, env) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 0.7 * t)) * 0.3;
  };

  const nyq = sr / 2.2;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const k = noteAt(t);
    if (k < 0) continue;
    const f = midiToHz(midiAt(t, k));
    ph += (2 * Math.PI * f) / sr;
    let s = 0;
    for (let h = 1; h * f < nyq && h <= 20; h++) {
      const hf = h * f;
      const w =
        (Math.exp(-(((hf - 700) / 300) ** 2)) +
          0.6 * Math.exp(-(((hf - 1200) / 350) ** 2)) +
          0.3 * Math.exp(-(((hf - 2600) / 500) ** 2)) +
          0.05) / h;
      s += w * Math.sin(h * ph);
    }
    audio[i] = s * levelAt(t, k);
  }
  // A note after the first is reached by a glide from the previous one. Its written start is the
  // middle of that glide: the moment the voice is nearer the new pitch than the old one, which is
  // where a listener (and the vocadito annotators, whose onsets Basic Pitch lands within ~8 ms of)
  // hears the change. The glide's own start is still the old note bending. Each note ends where
  // the next one starts, so the line stays gapless.
  const onsets = starts.map((s, k) => (k > 0 ? s + glide / 2 : s));
  const truthNotes = onsets.map((s, k) => ({
    pitchMidi: MELODY_MIDI[k] + transpose,
    startTimeSeconds: s,
    durationSeconds: (k + 1 < onsets.length ? onsets[k + 1] : end) - s,
    amplitude: 0.8,
  }));

  const frames = Math.floor((end + TAIL) * 100);
  const midi = new Array(frames).fill(0);
  const level = new Array(frames).fill(0);
  for (let j = 0; j < frames; j++) {
    const t = j / 100;
    const k = noteAt(t);
    if (k < 0) continue;
    midi[j] = Math.round(midiAt(t, k) * 100) / 100;
    level[j] = Math.round(levelAt(t, k) * 1000) / 1000;
  }
  return { audio, truthNotes, f0: { fps: 100, midi }, level };
}

/** Iterative radix-2 FFT in double precision. */
function fftd(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

/** x convolved with h, cut to x's length. */
function convolve(x, h) {
  let size = 1;
  while (size < x.length + h.length) size <<= 1;
  const ar = new Float64Array(size), ai = new Float64Array(size);
  const br = new Float64Array(size), bi = new Float64Array(size);
  ar.set(x); br.set(h);
  fftd(ar, ai, false); fftd(br, bi, false);
  for (let i = 0; i < size; i++) {
    const r = ar[i] * br[i] - ai[i] * bi[i];
    ai[i] = ar[i] * bi[i] + ai[i] * br[i];
    ar[i] = r;
  }
  fftd(ar, ai, true);
  return Float32Array.from(ar.subarray(0, x.length));
}

const rmsOf = (a) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, a.length));
};

/** A noise burst that dies away exponentially, the cheap stand-in for a room. */
function roomResponse(sr, seconds, rand) {
  const n = Math.floor(seconds * sr);
  const out = new Float32Array(n);
  const tau = seconds / 6.9; // -60 dB at the end
  for (let i = 0; i < n; i++) out[i] = gaussian(rand) * Math.exp(-i / sr / tau);
  return out;
}

/**
 * The vocal in the middle of a backing band. Returns the stereo mix and each ingredient, so a
 * separator can be scored against the truth.
 *
 *  - pad: three saw-like tones, decorrelated between the channels (so it sits wide)
 *  - bass: centred, short notes every half second
 *  - snare: centred noise bursts, on 0.5 s and then every second
 *  - vocal: centred; with `wetDb` it gets a different room response on each side
 */
export function mixWithBacking({ vocal, sr = 44100, wetDb = null, seed = 1 }) {
  const n = vocal.length;
  const rand = mulberry32(seed * 7919 + 13);

  let vocalL = Float32Array.from(vocal);
  let vocalR = Float32Array.from(vocal);
  if (typeof wetDb === "number") {
    const dryRms = rmsOf(vocal);
    for (const side of ["L", "R"]) {
      const wet = convolve(vocal, roomResponse(sr, 0.8, rand));
      const g = dryRms > 0 && rmsOf(wet) > 0 ? (dryRms * Math.pow(10, wetDb / 20)) / rmsOf(wet) : 0;
      const out = side === "L" ? vocalL : vocalR;
      for (let i = 0; i < n; i++) out[i] += wet[i] * g;
    }
  }

  const pad = (phases) => {
    const out = new Float32Array(n);
    [48, 55, 64].forEach((m, tone) => {
      const f = midiToHz(m);
      for (let h = 1; h <= 6; h++) {
        const ph0 = phases[tone * 6 + h - 1];
        const w = (0.12 / h) / 3;
        const step = (2 * Math.PI * f * h) / sr;
        for (let i = 0; i < n; i++) out[i] += w * Math.sin(step * i + ph0);
      }
    });
    return out;
  };
  // independent start phases per channel: the pad is decorrelated left to right, so it sits wide
  const phases = () => Array.from({ length: 18 }, () => rand() * 2 * Math.PI);
  const padL = pad(phases());
  const padR = pad(phases());

  const bass = new Float32Array(n);
  const bassHz = midiToHz(36);
  const noteLen = Math.floor(0.25 * sr);
  for (let start = 0; start < n; start += Math.floor(0.5 * sr)) {
    for (let i = 0; i < noteLen && start + i < n; i++) {
      const t = i / sr;
      const env = Math.min(1, t / 0.01) * Math.min(1, (0.25 - t) / 0.03);
      let s = 0;
      for (let h = 1; h <= 4; h++) s += Math.sin(2 * Math.PI * bassHz * h * t) / h;
      bass[start + i] = 0.2 * 0.6 * s * env;
    }
  }

  const snare = new Float32Array(n);
  const burst = Math.floor(0.08 * sr);
  const snareAt = (s) => {
    for (let i = 0; i < burst && s + i < n; i++) snare[s + i] += 0.15 * (rand() * 2 - 1) * Math.exp(-(i / sr) / 0.02);
  };
  for (let s = Math.floor(0.5 * sr); s < n; s += sr) snareAt(s);

  const backingL = new Float32Array(n), backingR = new Float32Array(n);
  const left = new Float32Array(n), right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    backingL[i] = padL[i] + bass[i] + snare[i];
    backingR[i] = padR[i] + bass[i] + snare[i];
    left[i] = vocalL[i] + backingL[i];
    right[i] = vocalR[i] + backingR[i];
  }
  return { left, right, truth: { vocalL, vocalR, backingL, backingR } };
}
