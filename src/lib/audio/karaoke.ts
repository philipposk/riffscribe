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
import { istft, stft, type Stft } from "./fft";

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

function cloneStft(s: Stft): Stft {
  return {
    ...s,
    re: s.re.map((f) => Float32Array.from(f)),
    im: s.im.map((f) => Float32Array.from(f)),
  };
}

export function splitCenter(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  opts: CenterOptions = {}
): CenterSplit {
  const fftSize = opts.fftSize ?? 4096;
  const strength = opts.strength ?? 2;
  const lowKeepHz = opts.lowKeepHz ?? 120;
  const highKeepHz = opts.highKeepHz ?? 14000;
  const hop = fftSize / 4;

  const L = stft(left, fftSize, hop);
  const R = stft(right, fftSize, hop);
  const cL = cloneStft(L);
  const cR = cloneStft(R);
  const iL = cloneStft(L);
  const iR = cloneStft(R);

  const binHz = sampleRate / fftSize;
  const loBin = Math.floor(lowKeepHz / binHz);
  const hiBin = Math.ceil(highKeepHz / binHz);

  for (let f = 0; f < L.frames; f++) {
    for (let b = 0; b < L.bins; b++) {
      const lr = L.re[f][b], li = L.im[f][b];
      const rr = R.re[f][b], ri = R.im[f][b];

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

      cL.re[f][b] = mr; cL.im[f][b] = mi;
      cR.re[f][b] = mr; cR.im[f][b] = mi;
      iL.re[f][b] = lr - mr; iL.im[f][b] = li - mi;
      iR.re[f][b] = rr - mr; iR.im[f][b] = ri - mi;
    }
  }

  const n = left.length;
  return {
    instrumental: [istft(iL, n), istft(iR, n)],
    center: [istft(cL, n), istft(cR, n)],
  };
}
