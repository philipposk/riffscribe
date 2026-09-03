/**
 * The guide instrument.
 *
 * Plays the transcribed part back as the instrument you are learning it on, so
 * you can hear the line on its own — or against the backing track — before you
 * try to play it. It is synthesised rather than sampled: no download, and it is
 * rendered into a plain buffer so it stays sample-locked with everything else.
 *
 * It is built from the raw detected notes, not the quantised score, so it lines
 * up with the recording exactly. Think "the part, cleaned up", not "the sheet
 * music played by a robot".
 */
import type { NoteEvent, Timbre } from "../types";

interface Voice {
  /** Relative amplitude of harmonic 1, 2, 3 … */
  harmonics: number[];
  attack: number;
  decay: number;
  /** 0 = dies away (plucked), 1 = holds while the note lasts (bowed). */
  sustain: number;
  release: number;
  /** Exponential fade over the note, per second. 0 for sustained voices. */
  damping: number;
  vibratoHz: number;
  vibratoDepth: number;
  vibratoOnset: number;
  /** Breath/bow noise blended in. */
  noise: number;
  gain: number;
}

const VOICES: Record<Timbre, Voice> = {
  bowed: {
    harmonics: [1, 0.62, 0.44, 0.3, 0.2, 0.13, 0.09, 0.05],
    attack: 0.07, decay: 0.06, sustain: 0.82, release: 0.14, damping: 0.15,
    vibratoHz: 5.4, vibratoDepth: 0.004, vibratoOnset: 0.18, noise: 0.012, gain: 0.5,
  },
  plucked: {
    harmonics: [1, 0.5, 0.3, 0.17, 0.09, 0.05],
    attack: 0.004, decay: 0.03, sustain: 0.7, release: 0.06, damping: 3.0,
    vibratoHz: 0, vibratoDepth: 0, vibratoOnset: 0, noise: 0.004, gain: 0.62,
  },
  struck: {
    harmonics: [1, 0.46, 0.26, 0.13, 0.08, 0.045, 0.03],
    attack: 0.006, decay: 0.05, sustain: 0.6, release: 0.09, damping: 1.5,
    vibratoHz: 0, vibratoDepth: 0, vibratoOnset: 0, noise: 0, gain: 0.58,
  },
  breath: {
    // mostly fundamental with a soft second — reads as flute/whistle
    harmonics: [1, 0.3, 0.12, 0.06, 0.03],
    attack: 0.05, decay: 0.05, sustain: 0.85, release: 0.1, damping: 0.1,
    vibratoHz: 5, vibratoDepth: 0.005, vibratoOnset: 0.22, noise: 0.05, gain: 0.5,
  },
  reed: {
    // strong odd harmonics — clarinet/sax family
    harmonics: [1, 0.12, 0.6, 0.1, 0.38, 0.08, 0.22, 0.05, 0.12],
    attack: 0.035, decay: 0.05, sustain: 0.8, release: 0.09, damping: 0.12,
    vibratoHz: 5.2, vibratoDepth: 0.004, vibratoOnset: 0.2, noise: 0.03, gain: 0.42,
  },
  brass: {
    harmonics: [1, 0.75, 0.55, 0.4, 0.3, 0.2, 0.13, 0.08],
    attack: 0.045, decay: 0.06, sustain: 0.85, release: 0.1, damping: 0.1,
    vibratoHz: 5.6, vibratoDepth: 0.003, vibratoOnset: 0.25, noise: 0.02, gain: 0.38,
  },
  voice: {
    harmonics: [1, 0.55, 0.35, 0.5, 0.22, 0.12, 0.07],
    attack: 0.06, decay: 0.07, sustain: 0.8, release: 0.13, damping: 0.2,
    vibratoHz: 5.8, vibratoDepth: 0.007, vibratoOnset: 0.2, noise: 0.02, gain: 0.44,
  },
};

const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export interface GuideOptions {
  timbre: Timbre;
  sampleRate: number;
  /** Pad/trim the result to this many samples so it lines up with the song. */
  lengthSamples: number;
  transposeSemitones?: number;
  /** Shortest note to bother rendering, in seconds. */
  minDuration?: number;
}

export function synthesizeGuide(notes: NoteEvent[], o: GuideOptions): [Float32Array, Float32Array] {
  const v = VOICES[o.timbre] ?? VOICES.plucked;
  const sr = o.sampleRate;
  const out = new Float32Array(o.lengthSamples);
  const minDur = o.minDuration ?? 0.04;
  const shift = o.transposeSemitones ?? 0;

  for (const note of notes) {
    const dur = Math.max(minDur, note.durationSeconds);
    const start = Math.floor(note.startTimeSeconds * sr);
    if (start >= out.length) continue;

    const freq = midiToHz(note.pitchMidi + shift);
    if (freq <= 0 || freq > sr / 2.2) continue;

    // stop harmonics that would alias above Nyquist
    const partials = v.harmonics.filter((_, i) => freq * (i + 1) < sr * 0.45);
    const norm = partials.reduce((a, b) => a + b, 0) || 1;
    const amp = (v.gain * Math.max(0.25, Math.min(1, note.amplitude * 1.6))) / norm;

    const total = Math.min(Math.floor((dur + v.release) * sr), out.length - start);
    const twoPiOverSr = (2 * Math.PI) / sr;

    for (let i = 0; i < total; i++) {
      const t = i / sr;

      // ADSR, with an exponential fade for instruments that die away
      let env: number;
      if (t < v.attack) env = t / v.attack;
      else if (t < v.attack + v.decay) env = 1 - (1 - v.sustain) * ((t - v.attack) / v.decay);
      else if (t < dur) env = v.sustain;
      else env = v.sustain * Math.max(0, 1 - (t - dur) / v.release);
      if (v.damping) env *= Math.exp(-v.damping * t);
      if (env <= 1e-4) continue;

      // vibrato only after the note has settled — a stab should not wobble
      let f = freq;
      if (v.vibratoHz && t > v.vibratoOnset) {
        const ramp = Math.min(1, (t - v.vibratoOnset) / 0.25);
        f = freq * (1 + v.vibratoDepth * ramp * Math.sin(2 * Math.PI * v.vibratoHz * t));
      }

      let s = 0;
      const phase = twoPiOverSr * f * i;
      for (let h = 0; h < partials.length; h++) s += partials[h] * Math.sin(phase * (h + 1));
      if (v.noise) s += v.noise * (Math.random() * 2 - 1);

      out[start + i] += s * env * amp;
    }
  }

  // gentle limiter — stacked notes can otherwise clip
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0.9) {
    const g = 0.9 / peak;
    for (let i = 0; i < out.length; i++) out[i] *= g;
  }

  return [out, Float32Array.from(out)];
}
