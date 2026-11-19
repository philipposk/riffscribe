/**
 * Real music: the instant (centre-channel) split on the MUSDB18 7-second clips, scored against
 * the true vocal and backing stems. MUSDB18 is licensed for non-commercial use: the audio stays
 * on this machine and only the aggregate numbers are committed.
 *
 * Needs RIFFSCRIBE_EVAL_DATA (a folder holding musdb7/test/*.stem.mp4) and ffmpeg; skips cleanly
 * without them. The stem order in those files is mixture, drums, bass, other, vocals.
 * Optional RIFFSCRIBE_EVAL_LIMIT=N runs only the first N clips.
 *
 * "mixtureAsVocalSdr" is the floor: the score you would get by calling the whole mix "the vocal".
 */
import { readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { decode } from "../lib/media.mjs";
import { sdr, percentile } from "../lib/metrics.mjs";

export const name = "musdb-split";
export const slow = true;

const SR = 44100;
const STEM = { mixture: 0, drums: 1, bass: 2, other: 3, vocals: 4 };
const APP_OPTIONS = { strength: 2 };

export async function ready(ctx) {
  return !!ctx.dataDir && existsSync(path.join(ctx.dataDir, "musdb7", "test"));
}

const cat = (a, b) => {
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
};

export async function run(ctx) {
  if (!ctx.dataDir) return { skipped: "RIFFSCRIBE_EVAL_DATA is not set" };
  const dir = path.join(ctx.dataDir, "musdb7", "test");
  if (!existsSync(dir)) return { skipped: `no musdb7/test under ${ctx.dataDir}` };
  const { splitCenter } = await import("../../../src/lib/audio/karaoke.ts");

  const files = readdirSync(dir).filter((f) => f.endsWith(".stem.mp4")).sort().slice(0, Number(process.env.RIFFSCRIBE_EVAL_LIMIT) || Infinity);
  const vocal = [], backing = [], floor = [], leak = [];
  let mono = 0;
  for (const f of files) {
    const file = path.join(dir, f);
    const get = (s) => decode(file, { sr: SR, channels: 2, stream: STEM[s] });
    const mix = get("mixture");
    const voc = get("vocals");
    const [dr, ba, ot] = [get("drums"), get("bass"), get("other")];
    const n = Math.min(mix[0].length, voc[0].length, dr[0].length, ba[0].length, ot[0].length);
    const sum = (ch) => Float32Array.from({ length: n }, (_, i) => dr[ch][i] + ba[ch][i] + ot[ch][i]);
    let out;
    try {
      out = splitCenter(mix[0].subarray(0, n), mix[1].subarray(0, n), SR, APP_OPTIONS);
    } catch {
      mono++; // a mono clip cannot be split; the app says so too
      continue;
    }
    const tv = cat(voc[0].subarray(0, n), voc[1].subarray(0, n));
    const tb = cat(sum(0), sum(1));
    const ev = cat(out.center[0], out.center[1]);
    const eb = cat(out.instrumental[0], out.instrumental[1]);
    vocal.push(sdr(tv, ev));
    backing.push(sdr(tb, eb));
    floor.push(sdr(tv, cat(mix[0].subarray(0, n), mix[1].subarray(0, n))));
    let dot = 0, vv = 0;
    for (let i = 0; i < tv.length; i++) { dot += eb[i] * tv[i]; vv += tv[i] * tv[i]; }
    leak.push(20 * Math.log10(Math.abs(dot / (vv + 1e-12)) + 1e-6));
    ctx.log(`${f}: vocal ${vocal[vocal.length - 1].toFixed(1)} dB, backing ${backing[backing.length - 1].toFixed(1)} dB`);
  }
  if (!vocal.length) return { skipped: "no splittable clips found" };
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const r = (v) => Math.round(v * 100) / 100;
  return {
    metrics: {
      clips: { value: vocal.length, better: "higher", tol: 0, info: true },
      monoSkipped: { value: mono, better: "lower", tol: 0, info: true },
      meanVocalSdr: { value: r(mean(vocal)), better: "higher", tol: 0.3 },
      medianVocalSdr: { value: r(percentile(vocal, 50)), better: "higher", tol: 0.3 },
      meanBackingSdr: { value: r(mean(backing)), better: "higher", tol: 0.3 },
      meanVocalLeakDb: { value: r(mean(leak)), better: "lower", tol: 0.5 },
      mixtureAsVocalSdr: { value: r(mean(floor)), better: "higher", tol: 0.3, info: true },
    },
    gates: [],
  };
}
