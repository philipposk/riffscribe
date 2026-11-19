/**
 * The instant (centre-channel) vocal split on a mix whose parts are known exactly.
 *
 * The singer is dead centre over a backing band (wide pad, centred bass and snare). We run the
 * same call the app's instant split makes and score what comes back against the real parts,
 * dry and with the voice in a room (a different reverb on each side, which makes it less centred).
 */
import { sungLine, mixWithBacking } from "../lib/fixtures.mjs";
import { sdr, dbRatio } from "../lib/metrics.mjs";

export const name = "instant-split";

const SR = 44100;
// separateInstantAsync (src/lib/audio/stems.ts) calls splitCenter with strength 2 and no other option
const APP_OPTIONS = { strength: 2 };

const cat = (a, b) => {
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
};

/** Share of the singer that ended up in the backing, in dB re the singer (more negative is better). */
function leakDb(backing, vocal) {
  let dot = 0, vv = 0;
  for (let i = 0; i < vocal.length; i++) { dot += backing[i] * vocal[i]; vv += vocal[i] * vocal[i]; }
  const a = dot / (vv + 1e-12);
  return 20 * Math.log10(Math.abs(a) + 1e-6);
}

export async function run() {
  const { splitCenter } = await import("../../../src/lib/audio/karaoke.ts");
  const metrics = {};
  const { audio } = sungLine({ sr: SR, vibCents: 40 });

  for (const [tag, wetDb] of [["dry", null], ["wet12", -12], ["wet6", -6]]) {
    const { left, right, truth } = mixWithBacking({ vocal: audio, sr: SR, wetDb });
    const out = splitCenter(left, right, SR, APP_OPTIONS);
    const tv = cat(truth.vocalL, truth.vocalR);
    const tb = cat(truth.backingL, truth.backingR);
    const ev = cat(out.center[0], out.center[1]);
    const eb = cat(out.instrumental[0], out.instrumental[1]);
    metrics[`vocalSdr_${tag}`] = { value: round(sdr(tv, ev)), better: "higher", tol: 0.5 };
    metrics[`backingSdr_${tag}`] = { value: round(sdr(tb, eb)), better: "higher", tol: 0.5 };
    metrics[`vocalLeakDb_${tag}`] = { value: round(leakDb(eb, tv)), better: "lower", tol: 0.5 };
  }

  // the same band with nobody singing: whatever lands in the centre output is wrongly taken for a voice
  const { left, right, truth } = mixWithBacking({ vocal: new Float32Array(audio.length), sr: SR });
  const out = splitCenter(left, right, SR, APP_OPTIONS);
  const centre = cat(out.center[0], out.center[1]);
  const backing = cat(truth.backingL, truth.backingR);
  metrics.centreOfBackingDb = { value: round(dbRatio(centre, backing)), better: "lower", tol: 0.5 };

  return { metrics, gates: [] };
}

const round = (v) => Math.round(v * 100) / 100;
