/**
 * A small room around the guide, so it sits in the same space as the backing track instead of
 * sounding as if it were played straight into the listener's ear.
 *
 * Freeverb topology (Jezar at Dreampoint, public domain): per channel, eight feedback comb
 * filters with damping in parallel, then four allpass filters in series. The right channel uses
 * slightly longer delays than the left, which is what makes the room sound wide. Rendered
 * offline into plain buffers; no AudioContext. At 32 kHz and above the room part runs at half
 * the sample rate.
 */

const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASSES = [556, 441, 341, 225];
const STEREO_SPREAD = 23;
const FEEDBACK = 0.84;
const DAMPING = 0.2;
const ALLPASS_GAIN = 0.5;
const PRE_DELAY_SECONDS = 0.02;

export interface RoomOptions {
  /** Level of the room sound relative to the dry signal, in dB (by RMS). */
  wetDb?: number;
  /**
   * Accepted so every render takes the same options; the room itself has no randomness, so the
   * result is the same for every seed.
   */
  seed?: number;
}

function reverbChannel(input: Float32Array, sr: number, extra: number): Float64Array {
  const n = input.length;
  const scale = sr / 44100;
  const sum = new Float64Array(n);
  // all eight combs in one pass over the signal
  const lens = COMBS.map((d) => Math.max(1, Math.round((d + extra) * scale)));
  const bufs = lens.map((l) => new Float64Array(l));
  const [b0, b1, b2, b3, b4, b5, b6, b7] = bufs;
  const [l0, l1, l2, l3, l4, l5, l6, l7] = lens;
  let i0 = 0, i1 = 0, i2 = 0, i3 = 0, i4 = 0, i5 = 0, i6 = 0, i7 = 0;
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, s5 = 0, s6 = 0, s7 = 0;
  const keep = 1 - DAMPING;
  for (let i = 0; i < n; i++) {
    const x = input[i];
    let y: number, acc = 0;
    y = b0[i0]; s0 = y * keep + s0 * DAMPING; b0[i0] = x + s0 * FEEDBACK; if (++i0 === l0) i0 = 0; acc += y;
    y = b1[i1]; s1 = y * keep + s1 * DAMPING; b1[i1] = x + s1 * FEEDBACK; if (++i1 === l1) i1 = 0; acc += y;
    y = b2[i2]; s2 = y * keep + s2 * DAMPING; b2[i2] = x + s2 * FEEDBACK; if (++i2 === l2) i2 = 0; acc += y;
    y = b3[i3]; s3 = y * keep + s3 * DAMPING; b3[i3] = x + s3 * FEEDBACK; if (++i3 === l3) i3 = 0; acc += y;
    y = b4[i4]; s4 = y * keep + s4 * DAMPING; b4[i4] = x + s4 * FEEDBACK; if (++i4 === l4) i4 = 0; acc += y;
    y = b5[i5]; s5 = y * keep + s5 * DAMPING; b5[i5] = x + s5 * FEEDBACK; if (++i5 === l5) i5 = 0; acc += y;
    y = b6[i6]; s6 = y * keep + s6 * DAMPING; b6[i6] = x + s6 * FEEDBACK; if (++i6 === l6) i6 = 0; acc += y;
    y = b7[i7]; s7 = y * keep + s7 * DAMPING; b7[i7] = x + s7 * FEEDBACK; if (++i7 === l7) i7 = 0; acc += y;
    sum[i] = acc;
  }
  for (const d of ALLPASSES) {
    const len = Math.max(1, Math.round((d + extra) * scale));
    const buf = new Float64Array(len);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const b = buf[j];
      const x = sum[i];
      buf[j] = x + b * ALLPASS_GAIN;
      sum[i] = b - x;
      if (++j === len) j = 0;
    }
  }
  return sum;
}

const rmsOf = (a: ArrayLike<number>) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, a.length));
};

/**
 * Dry signal in both channels plus the room, the room `wetDb` below the dry signal (by RMS) and
 * starting 20 ms after it. Output is the same length as the input; the tail past the end is cut.
 */
export function applyRoom(mono: Float32Array, sr: number, o: RoomOptions = {}): [Float32Array, Float32Array] {
  const wetDb = o.wetDb ?? -14;
  const left = Float32Array.from(mono);
  const right = Float32Array.from(mono);
  const dry = rmsOf(mono);
  if (!(dry > 0)) return [left, right];

  // The room runs at half rate when that is still above 16 kHz: half the work, and a real
  // room soaks up the top octave anyway. The dry signal keeps its full bandwidth.
  const half = sr >= 32000;
  const rate = half ? sr / 2 : sr;
  let input = mono;
  if (half) {
    input = new Float32Array(Math.ceil(mono.length / 2));
    for (let i = 0; i < input.length; i++) {
      const a = mono[2 * i], b = mono[2 * i + 1] ?? a, p = mono[2 * i - 1] ?? a;
      input[i] = 0.25 * p + 0.5 * a + 0.25 * b;
    }
  }

  const pre = Math.round(PRE_DELAY_SECONDS * sr);
  const target = dry * Math.pow(10, wetDb / 20);
  const sides: [Float32Array, number][] = [[left, 0], [right, STEREO_SPREAD]];
  for (const [out, extra] of sides) {
    const wet = reverbChannel(input, rate, extra);
    const level = rmsOf(wet);
    if (!(level > 0)) continue;
    const g = target / level;
    if (half) {
      // back to full rate: even samples land on the wet samples, odd ones halfway between
      for (let k = 0, i = pre; i < out.length; k++, i += 2) {
        const a = wet[k] * g;
        const b = (k + 1 < wet.length ? wet[k + 1] : wet[k]) * g;
        out[i] += a;
        if (i + 1 < out.length) out[i + 1] += 0.5 * (a + b);
      }
    } else {
      for (let i = pre; i < out.length; i++) out[i] += wet[i - pre] * g;
    }
  }
  return [left, right];
}
