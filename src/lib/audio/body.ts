/**
 * The resonances of a bowed instrument's wooden body, as a chain of fixed filters.
 *
 * A bowed string alone sounds buzzy and thin; the body is what makes it a cello. This is a
 * source–filter stand-in for a recorded body response: peaks near the air and wood resonances
 * (about 105, 225 and 500 Hz on a cello) and the bridge "presence" region near 2.5 kHz, a
 * low cut under the open strings and a gentle top roll-off. The other members of the family are
 * the same shape scaled up or down in frequency (`BODY_SCALE`).
 *
 * Filters are the RBJ "Audio EQ Cookbook" biquads, run in transposed direct form II.
 */

export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** Body sizes relative to a cello. */
export const BODY_SCALE = { cello: 1, viola: 2, violin: 2.75, "double-bass": 0.62 } as const;

const norm = (b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): Biquad => ({
  b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0,
});

/** Keeps a corner frequency safely below Nyquist so the maths stays stable at any sample rate. */
const safe = (f: number, sr: number) => Math.min(Math.max(1, f), 0.45 * sr);

export function peaking(sr: number, f: number, gainDb: number, q: number): Biquad {
  const A = Math.pow(10, gainDb / 40);
  const w = (2 * Math.PI * safe(f, sr)) / sr;
  const alpha = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  return norm(1 + alpha * A, -2 * c, 1 - alpha * A, 1 + alpha / A, -2 * c, 1 - alpha / A);
}

export function lowpass(sr: number, f: number, q: number): Biquad {
  const w = (2 * Math.PI * safe(f, sr)) / sr;
  const alpha = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  return norm((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + alpha, -2 * c, 1 - alpha);
}

export function highpass(sr: number, f: number, q: number): Biquad {
  const w = (2 * Math.PI * safe(f, sr)) / sr;
  const alpha = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  return norm((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + alpha, -2 * c, 1 - alpha);
}

/**
 * A stateful body filter: feed it one sample at a time, in order. `scale` multiplies every
 * resonance frequency (1 = cello, see `BODY_SCALE`).
 */
export function createBody(sr: number, scale = 1): { process(x: number): number; processBlock(buf: Float32Array): void } {
  const stages: Biquad[] = [
    highpass(sr, 55 * scale, 0.707),
    peaking(sr, 105 * scale, 6, 2.5),
    peaking(sr, 225 * scale, 8, 2.5),
    peaking(sr, 500 * scale, 6, 1.6),
    peaking(sr, 2500 * scale, 5, 1.2),
    lowpass(sr, Math.min(5500 * scale, 0.45 * sr), 0.707),
  ];
  const n = stages.length;
  // transposed direct form II: two state values per stage
  const s1 = new Float64Array(n), s2 = new Float64Array(n);
  const step = (k: number, x: number) => {
    const c = stages[k];
    const y = c.b0 * x + s1[k];
    s1[k] = c.b1 * x - c.a1 * y + s2[k];
    s2[k] = c.b2 * x - c.a2 * y;
    return y;
  };
  return {
    process(x: number): number {
      let v = x;
      for (let k = 0; k < n; k++) v = step(k, v);
      return v;
    },
    /** The same as calling `process` on every sample in turn, in place, but two stages per pass (faster). */
    processBlock(buf: Float32Array): void {
      for (let k = 0; k < n; k += 2) {
        if (k + 1 >= n) {
          for (let i = 0; i < buf.length; i++) buf[i] = step(k, buf[i]);
          break;
        }
        const c = stages[k], d = stages[k + 1];
        let p1 = s1[k], p2 = s2[k], q1 = s1[k + 1], q2 = s2[k + 1];
        for (let i = 0; i < buf.length; i++) {
          const x = buf[i];
          const y = c.b0 * x + p1;
          p1 = c.b1 * x - c.a1 * y + p2;
          p2 = c.b2 * x - c.a2 * y;
          const z = d.b0 * y + q1;
          q1 = d.b1 * y - d.a1 * z + q2;
          q2 = d.b2 * y - d.a2 * z;
          buf[i] = z;
        }
        s1[k] = p1; s2[k] = p2; s1[k + 1] = q1; s2[k + 1] = q2;
      }
    },
  };
}
