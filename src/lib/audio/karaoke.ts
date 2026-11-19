/**
 * Instant vocal removal — no model download, runs in ~1s per minute of audio.
 *
 * Lead vocals are almost always panned dead centre, so they appear identically
 * in both channels. Per STFT bin we measure how correlated L and R are; bins
 * that are strongly correlated get pulled out as "centre" (≈ the vocal), and the
 * rest stays as the backing track. Doing it per frequency bin rather than as a
 * plain L−R subtraction keeps the bass and the stereo image intact, which is why
 * this sounds far better than the classic karaoke trick.
 *
 * Quality still loses to Demucs, so this is offered as the zero-wait option.
 */
import { fft, hann } from "./fft";

export interface CenterSplit {
  /** Everything that is NOT centre — the backing track / instrumental. */
  instrumental: [Float32Array, Float32Array];
  /** The extracted centre channel — roughly the lead vocal. */
  center: [Float32Array, Float32Array];
}

export interface CenterOptions {
  fftSize?: number;
  /** Higher = only very-centred content is removed (less damage, more bleed). */
  strength?: number;
  /** Below this frequency the centre is kept (protects kick + bass). */
  lowKeepHz?: number;
  /** Above this frequency the centre is kept (protects cymbals + air). */
  highKeepHz?: number;
}

/** Side energy at least ~30 dB under the mid: a mono file, or a "stereo" copy of one. */
export function isEffectivelyMono(left: Float32Array, right: Float32Array): boolean {
  let side = 0;
  let total = 0;
  const n = Math.min(left.length, right.length);
  for (let i = 0; i < n; i++) {
    const d = left[i] - right[i];
    side += d * d;
    total += left[i] * left[i] + right[i] * right[i];
  }
  return total > 0 && side / total < 1e-3;
}

export const MONO_SPLIT_ERROR = "This recording is mono, so the instant split cannot separate it. Use the AI split.";

/**
 * Streams frame by frame (analyse, mask, resynthesise, overlap-add), so memory is a few
 * song-length arrays rather than six whole-song spectrograms.
 */
export function splitCenter(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  opts: CenterOptions = {}
): CenterSplit {
  // With L == R every bin looks centred, and the "backing track" would be nearly silent.
  if (isEffectivelyMono(left, right)) throw new Error(MONO_SPLIT_ERROR);

  const fftSize = opts.fftSize ?? 4096;
  const strength = opts.strength ?? 2;
  const lowKeepHz = opts.lowKeepHz ?? 120;
  const highKeepHz = opts.highKeepHz ?? 14000;
  const hop = fftSize / 4;

  const binHz = sampleRate / fftSize;
  const loBin = Math.floor(lowKeepHz / binHz);
  const hiBin = Math.ceil(highKeepHz / binHz);

  const n = left.length;
  // centred frames, zero padded at both ends
  const frames = Math.max(1, Math.ceil((n + fftSize) / hop));
  const bins = fftSize / 2 + 1;
  const w = hann(fftSize);

  const outL = new Float32Array(n);
  const outR = new Float32Array(n);
  const outC = new Float32Array(n);
  const norm = new Float32Array(n);

  const lRe = new Float32Array(fftSize), lIm = new Float32Array(fftSize);
  const rRe = new Float32Array(fftSize), rIm = new Float32Array(fftSize);
  const cRe = new Float32Array(fftSize), cIm = new Float32Array(fftSize);
  const iLRe = new Float32Array(fftSize), iLIm = new Float32Array(fftSize);
  const iRRe = new Float32Array(fftSize), iRIm = new Float32Array(fftSize);

  /** Rebuild the conjugate-symmetric upper half, invert, and overlap-add into `out`. */
  const resynth = (re: Float32Array, im: Float32Array, out: Float32Array, start: number) => {
    for (let b = bins; b < fftSize; b++) { re[b] = 0; im[b] = 0; }
    for (let b = 1; b < bins - 1; b++) {
      re[fftSize - b] = re[b];
      im[fftSize - b] = -im[b];
    }
    fft(re, im, true);
    for (let i = 0; i < fftSize; i++) {
      const t = start + i;
      if (t < 0 || t >= n) continue;
      out[t] += re[i] * w[i];
    }
  };

  for (let f = 0; f < frames; f++) {
    const start = f * hop - fftSize / 2;
    for (let i = 0; i < fftSize; i++) {
      const s = start + i;
      const inside = s >= 0 && s < n;
      lRe[i] = inside ? left[s] * w[i] : 0;
      rRe[i] = inside ? right[s] * w[i] : 0;
      lIm[i] = 0;
      rIm[i] = 0;
    }
    fft(lRe, lIm);
    fft(rRe, rIm);

    for (let b = 0; b < bins; b++) {
      const lr = lRe[b], li = lIm[b];
      const rr = rRe[b], ri = rIm[b];

      let g = 0;
      if (b >= loBin && b <= hiBin) {
        // normalised cross-correlation of the two channels at this bin
        const dot = lr * rr + li * ri;
        const energy = lr * lr + li * li + rr * rr + ri * ri;
        const sim = energy > 1e-12 ? (2 * dot) / energy : 0;
        g = Math.pow(Math.max(0, Math.min(1, sim)), strength);
      }

      // centre estimate = shared part of both channels
      const mr = ((lr + rr) / 2) * g;
      const mi = ((li + ri) / 2) * g;

      cRe[b] = mr; cIm[b] = mi;
      iLRe[b] = lr - mr; iLIm[b] = li - mi;
      iRRe[b] = rr - mr; iRIm[b] = ri - mi;
    }

    resynth(iLRe, iLIm, outL, start);
    resynth(iRRe, iRIm, outR, start);
    resynth(cRe, cIm, outC, start);
    for (let i = 0; i < fftSize; i++) {
      const t = start + i;
      if (t >= 0 && t < n) norm[t] += w[i] * w[i];
    }
  }

  for (let i = 0; i < n; i++) {
    if (norm[i] > 1e-8) {
      outL[i] /= norm[i];
      outR[i] /= norm[i];
      outC[i] /= norm[i];
    }
  }

  // The centre is the same on both sides; two arrays so each can be handed over on its own.
  return {
    instrumental: [outL, outR],
    center: [outC, Float32Array.from(outC)],
  };
}
