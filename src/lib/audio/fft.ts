/**
 * Small iterative radix-2 FFT plus Hann-windowed STFT/ISTFT.
 * Used by the instant "karaoke" centre-channel remover and by onset detection.
 * Kept dependency-free so it can run inside a Web Worker without bundler help.
 */

export function nextPow2(n: number) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** In-place complex FFT. `re`/`im` length must be a power of two. */
export function fft(re: Float32Array, im: Float32Array, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k], ai = im[i + k];
        const br = re[i + k + len / 2], bi = im[i + k + len / 2];
        const tr = br * cr - bi * ci;
        const ti = br * ci + bi * cr;
        re[i + k] = ar + tr; im[i + k] = ai + ti;
        re[i + k + len / 2] = ar - tr; im[i + k + len / 2] = ai - ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
}

export function hann(size: number) {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  return w;
}

export interface Stft {
  re: Float32Array[]; // frames x (fftSize/2+1)
  im: Float32Array[];
  frames: number;
  bins: number;
  fftSize: number;
  hop: number;
}

export function stft(signal: Float32Array, fftSize = 2048, hop = fftSize / 4): Stft {
  const w = hann(fftSize);
  const bins = fftSize / 2 + 1;
  const frames = Math.max(1, Math.ceil((signal.length + fftSize) / hop));
  const re: Float32Array[] = [];
  const im: Float32Array[] = [];
  const br = new Float32Array(fftSize);
  const bi = new Float32Array(fftSize);
  for (let f = 0; f < frames; f++) {
    const start = f * hop - fftSize / 2;
    br.fill(0); bi.fill(0);
    for (let i = 0; i < fftSize; i++) {
      const s = start + i;
      br[i] = s >= 0 && s < signal.length ? signal[s] * w[i] : 0;
    }
    fft(br, bi);
    const fr = new Float32Array(bins);
    const fi = new Float32Array(bins);
    fr.set(br.subarray(0, bins));
    fi.set(bi.subarray(0, bins));
    re.push(fr); im.push(fi);
  }
  return { re, im, frames, bins, fftSize, hop };
}

/** Weighted overlap-add inverse of `stft` (Hann analysis + Hann synthesis). */
export function istft(s: Stft, length: number): Float32Array {
  const { fftSize, hop, frames, bins } = s;
  const w = hann(fftSize);
  const out = new Float32Array(length);
  const norm = new Float32Array(length);
  const br = new Float32Array(fftSize);
  const bi = new Float32Array(fftSize);
  for (let f = 0; f < frames; f++) {
    br.fill(0); bi.fill(0);
    for (let b = 0; b < bins; b++) { br[b] = s.re[f][b]; bi[b] = s.im[f][b]; }
    // rebuild the conjugate-symmetric upper half
    for (let b = 1; b < bins - 1; b++) {
      br[fftSize - b] = s.re[f][b];
      bi[fftSize - b] = -s.im[f][b];
    }
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
