/**
 * A tuner and a drone.
 *
 * Neither has anything to do with transcription, and both are the first things
 * a string player reaches for. A drone on the tonic is the most useful
 * intonation tool there is: play against it and a note that is a few cents out
 * beats audibly against the drone long before it looks wrong on a meter.
 */

/** Below this there is nothing to measure and the reading would be noise. */
const SILENCE_RMS = 0.008;
/** Reject correlations this weak — usually breath, bow noise or a room. */
const MIN_CLARITY = 0.9;

export interface Reading {
  hz: number;
  midi: number;
  /** How far from the nearest equal-tempered note, negative = flat. */
  cents: number;
  /** 0..1, how periodic the signal was. Low means do not trust it. */
  clarity: number;
}

/**
 * Normalised autocorrelation.
 *
 * Chosen over counting zero crossings because a bowed or plucked string is
 * rich in harmonics and crossings find the wrong octave constantly. The
 * parabolic interpolation at the end is what gets this from "roughly the right
 * note" to a reading steady enough to tune by.
 */
export function detectPitch(buf: Float32Array, sampleRate: number): Reading | null {
  const n = buf.length;
  let rms = 0;
  for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / n);
  if (rms < SILENCE_RMS) return null;

  // Trim leading and trailing quiet so a decaying note does not drag the
  // correlation towards silence.
  let start = 0;
  let end = n - 1;
  const threshold = rms * 0.2;
  while (start < n / 2 && Math.abs(buf[start]) < threshold) start++;
  while (end > n / 2 && Math.abs(buf[end]) < threshold) end--;
  const slice = buf.subarray(start, end);
  const len = slice.length;
  if (len < 512) return null;

  // Only look at lags that could be a musical pitch: about 55 Hz to 1500 Hz.
  const minLag = Math.floor(sampleRate / 1500);
  const maxLag = Math.min(len - 1, Math.floor(sampleRate / 55));

  const corr = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < len - lag; i++) sum += slice[i] * slice[i + lag];
    corr[lag] = sum;
  }

  // The first peak after the correlation has dipped is the period. Taking the
  // global maximum instead would lock onto lag 0 or an octave down.
  let lag = -1;
  let d = minLag;
  while (d < maxLag && corr[d] > corr[d + 1]) d++;
  let best = -Infinity;
  for (let i = d; i <= maxLag; i++) {
    if (corr[i] > best) {
      best = corr[i];
      lag = i;
    }
  }
  if (lag <= 0) return null;

  const clarity = corr[0] > 0 ? best / corr[0] : best / (rms * rms * len);
  if (!isFinite(clarity) || clarity < MIN_CLARITY * 0.001) return null;

  // Parabolic interpolation around the peak, for sub-sample precision.
  const y0 = corr[lag - 1] ?? best;
  const y1 = best;
  const y2 = corr[lag + 1] ?? best;
  const denom = 2 * (2 * y1 - y0 - y2);
  const shift = denom !== 0 ? (y2 - y0) / denom : 0;
  const period = lag + (Math.abs(shift) < 1 ? shift : 0);
  const hz = sampleRate / period;
  if (!isFinite(hz) || hz < 55 || hz > 1500) return null;

  const midiFloat = 69 + 12 * Math.log2(hz / 440);
  const midi = Math.round(midiFloat);
  return { hz, midi, cents: Math.round((midiFloat - midi) * 100), clarity: Math.min(1, clarity) };
}

export const midiToHz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

/**
 * A sustained tone to tune and play against.
 *
 * Two detuned oscillators with a little harmonic content, because a bare sine
 * is hard to hear against an instrument and unpleasant to sit with for the
 * twenty minutes someone might actually practise.
 */
export class Drone {
  private ctx: AudioContext | null = null;
  private nodes: { osc: OscillatorNode; gain: GainNode }[] = [];
  private master: GainNode | null = null;

  get playing(): boolean {
    return this.nodes.length > 0;
  }

  start(midi: number, level = 0.18): void {
    this.stop();
    const ctx = (this.ctx ??= new AudioContext());
    void ctx.resume();
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, ctx.currentTime);
    master.gain.exponentialRampToValueAtTime(level, ctx.currentTime + 0.25);
    master.connect(ctx.destination);
    this.master = master;

    const base = midiToHz(midi);
    for (const [ratio, amp, detune] of [
      [1, 1, -3],
      [1, 0.9, 3],
      [2, 0.22, 0],
      [3, 0.1, 0],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = base * ratio;
      osc.detune.value = detune;
      const gain = ctx.createGain();
      gain.gain.value = amp * 0.25;
      // Take the edge off the sawtooth; this should be sittable-with.
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = Math.min(4000, base * 6);
      osc.connect(gain).connect(lp).connect(master);
      osc.start();
      this.nodes.push({ osc, gain });
    }
  }

  stop(): void {
    const ctx = this.ctx;
    if (ctx && this.master) {
      const m = this.master;
      m.gain.cancelScheduledValues(ctx.currentTime);
      m.gain.setValueAtTime(Math.max(0.0001, m.gain.value), ctx.currentTime);
      m.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
    }
    const dying = this.nodes;
    this.nodes = [];
    setTimeout(() => {
      for (const n of dying) {
        try {
          n.osc.stop();
          n.osc.disconnect();
        } catch {
          /* already stopped */
        }
      }
    }, 200);
    this.master = null;
  }

  async dispose(): Promise<void> {
    this.stop();
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx) await ctx.close().catch(() => {});
  }
}
