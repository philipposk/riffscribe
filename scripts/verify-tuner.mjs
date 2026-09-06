#!/usr/bin/env node
/**
 * Checks the pitch detector against tones of known frequency.
 *
 * Run with: node --experimental-strip-types scripts/verify-tuner.mjs
 */
const src = await import("../src/lib/audio/tuner.ts").catch(() => null);
if (!src) {
  console.log("run with: node --experimental-strip-types scripts/verify-tuner.mjs");
  process.exit(0);
}
const { detectPitch, midiToHz } = src;

const SR = 44100;
const N = 4096;

/** A note with harmonics, which is what a real instrument gives the detector. */
function tone(hz, { harmonics = [1, 0.5, 0.25], cents = 0, noise = 0 } = {}) {
  const f = hz * Math.pow(2, cents / 1200);
  const buf = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let s = 0;
    harmonics.forEach((amp, k) => { s += amp * Math.sin((2 * Math.PI * f * (k + 1) * i) / SR); });
    if (noise) s += (Math.random() * 2 - 1) * noise;
    buf[i] = s * 0.3;
  }
  return buf;
}

let failed = 0;
const check = (label, ok, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? `: ${detail}` : ""}`);
};

// Open strings a violinist and a cellist actually tune.
for (const [name, midi] of [["G3", 55], ["D4", 62], ["A4", 69], ["E5", 76], ["C2", 36], ["A2", 45]]) {
  const hz = midiToHz(midi);
  const r = detectPitch(tone(hz), SR);
  check(`${name} (${hz.toFixed(1)} Hz) is identified`, !!r && r.midi === midi,
        r ? `got ${r.midi}, ${r.hz.toFixed(1)} Hz, ${r.cents}c` : "no reading");
}

// Deliberately out of tune: the whole point of a tuner.
for (const off of [-30, -12, 12, 30]) {
  const r = detectPitch(tone(midiToHz(69), { cents: off }), SR);
  const ok = !!r && r.midi === 69 && Math.abs(r.cents - off) <= 6;
  check(`A4 ${off > 0 ? "+" : ""}${off} cents is measured`, ok, r ? `got ${r.cents}c` : "no reading");
}

// A quiet room must read nothing rather than inventing a note.
const silence = new Float32Array(N);
check("silence gives no reading", detectPitch(silence, SR) === null);
const veryQuiet = tone(midiToHz(69));
for (let i = 0; i < N; i++) veryQuiet[i] *= 0.001;
check("a nearly silent signal gives no reading", detectPitch(veryQuiet, SR) === null);

// Noise on top of a real note should not break it.
const noisy = detectPitch(tone(midiToHz(62), { noise: 0.08 }), SR);
check("D4 survives added noise", !!noisy && noisy.midi === 62,
      noisy ? `got ${noisy.midi} (${noisy.cents}c)` : "no reading");

// The classic failure: a strong second harmonic pulling the reading an octave up.
const rich = detectPitch(tone(midiToHz(55), { harmonics: [0.6, 1, 0.7, 0.4] }), SR);
check("a note whose 2nd harmonic is louder than its fundamental stays in the right octave",
      !!rich && rich.midi === 55, rich ? `got ${rich.midi}` : "no reading");

process.exit(failed ? 1 : 0);
