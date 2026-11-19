/**
 * Builds the demo clip that "Try the demo song" opens in the studio: public/demo/riffscribe-demo.mp3.
 *
 * It is synthesised from nothing (the sung-line and backing-band fixtures the cello evaluation
 * uses), so there is no recording and no licence to worry about. The clip is released CC0.
 *
 *   node scripts/make-demo.mjs
 *
 * Twenty seconds, stereo, 44.1 kHz: a voice-like line sings an eight-note melody, then the same
 * melody five semitones higher, over a pad, a bass and a snare. The voice has vibrato and a room
 * on it, so the "take the singer out" step has something real to chew on. Deterministic: the same
 * script always writes the same file.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The ESM fork of lamejs (the same one the app uses); plain `lamejs` needs the lame.min.js trick.
import { Mp3Encoder } from "@breezystack/lamejs";

import { sungLine, mixWithBacking } from "./eval-cello/lib/fixtures.mjs";

const SR = 44100;
const SECONDS = 20;
const SEED = 7;
const PEAK = 0.89;
const KBPS = 128;
/** Where each pass of the melody starts, in seconds. A pass is 8.25 s long. */
const PASSES = [{ at: 1.0, transpose: 0 }, { at: 10.5, transpose: 5 }];

const vocal = new Float32Array(SECONDS * SR);
for (const { at, transpose } of PASSES) {
  const { audio } = sungLine({ sr: SR, vibCents: 35, transpose, seed: SEED });
  const offset = Math.round(at * SR);
  for (let i = 0; i < audio.length && offset + i < vocal.length; i++) vocal[offset + i] += audio[i];
}

const { left, right } = mixWithBacking({ vocal, sr: SR, wetDb: -14, seed: SEED });

let peak = 0;
for (let i = 0; i < left.length; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
const gain = peak > 0 ? PEAK / peak : 1;

const toInt16 = (x) => {
  const out = new Int16Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const s = Math.max(-1, Math.min(1, x[i] * gain));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
};
const l = toInt16(left);
const r = toInt16(right);

const encoder = new Mp3Encoder(2, SR, KBPS);
const chunks = [];
for (let i = 0; i < l.length; i += 1152) {
  const buf = encoder.encodeBuffer(l.subarray(i, i + 1152), r.subarray(i, i + 1152));
  if (buf.length) chunks.push(Buffer.from(buf));
}
const tail = encoder.flush();
if (tail.length) chunks.push(Buffer.from(tail));

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "demo", "riffscribe-demo.mp3");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat(chunks));
console.log(`wrote ${out} (${Buffer.concat(chunks).length} bytes, peak before normalising ${peak.toFixed(3)})`);
