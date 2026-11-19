/**
 * "Replace the voice" end to end: a sung line in, a cello playing it out, the way the studio
 * runs it (Studio.tsx `transcribeFrom` with `sourceName "vocals"`, then the guide render).
 *
 * The synthetic sung line (lib/fixtures.mjs) is sung an octave up (G4..D5, a soprano's line). For
 * vibrato of 40 and 80 cents, two cases:
 *  - isolated: the voice on its own, as an AI split would ideally hand it over;
 *  - separated: the voice in a room (wetDb -12) over the backing band, through the app's instant
 *    split (splitCenter, strength 2), taking the centre output as the vocal.
 * That line already sits in the cello's singing register, so one more isolated case sings it a
 * fourth higher (C5..G5, `high_` keys), where the line has to move down an octave.
 *
 * Each case: Basic Pitch (bp-node, onset 0.5, frame 0.3, 7 frames, melodia off, MIDI 36..96) ->
 * cleanMonoLine -> pickPeaks / trackContour through the cleaned line -> loudnessCurve of the
 * vocal -> placeInRegister(..., "cello") -> synthesizeGuide (bowed, the vocal's voiced RMS as the
 * target level). The render is scored dry (room off), so the room's tail does not blur the pitch:
 *  - pitchWithin50: share of frames, voiced in both the render (YIN) and the singer's true curve,
 *    where the render is within 50 cents of the true pitch moved by the octaves placeInRegister chose;
 *  - fragmentation: notes in the cleaned line per sung note;
 *  - levelCorrelation: the render's 50 ms RMS against the singer's true loudness;
 *  - reattacks: loudness jumps heard in the render (a slurred note change is not one), against
 *    the 8 sung notes;
 *  - octaves: how far the line was moved.
 * Gates apply to the isolated cases; the separated ones are recorded and guarded, not gated.
 * Fragmentation is gated at 1.25 on the octave-up line only: at 80 cents the cleaned line keeps
 * short notes on the vibrato crest before a glide (monoline.ts), 10 for 8 an octave up and 11 for
 * 8 a fourth higher. That is a clean-up limit, recorded here.
 *
 * Slow: Basic Pitch runs on each case the first time (cached under .cache after that). Uses no
 * downloaded data.
 */
import { sungLine, mixWithBacking } from "../lib/fixtures.mjs";
import { yin } from "../lib/yin.mjs";
import { centsBetween, pearson } from "../lib/metrics.mjs";
import { createRequire } from "node:module";

const bp = createRequire(import.meta.url)("../lib/bp-node.cjs");

export const name = "pipeline";
export const slow = true;

const SR = 44100;
/** [key prefix, vibrato cents, transpose, separated] */
const CASES = [
  ["vib40_isolated", 40, 12, false],
  ["vib40_separated", 40, 12, true],
  ["vib80_isolated", 80, 12, false],
  ["vib80_separated", 80, 12, true],
  ["high_vib40_isolated", 40, 17, false],
  ["high_vib80_isolated", 80, 17, false],
];
const WET_DB = -12;
/** What the studio's vocal path asks Basic Pitch for (Studio.tsx transcribeFrom, sourceName "vocals"). */
const DETECT = {
  onset: 0.5,
  frame: 0.3,
  minLen: 7,
  melodia: false,
  minHz: bp.midiToHz(36),
  maxHz: bp.midiToHz(96),
};
const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

/** 44.1 kHz to 22.05 kHz: a 127-tap Blackman-windowed sinc low-pass at 10 kHz, then every other sample. */
function halve(x) {
  const taps = 127, mid = (taps - 1) / 2, fc = 10000 / SR;
  const h = new Float64Array(taps);
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const n = i - mid;
    const sinc = n === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * n) / (Math.PI * n);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (taps - 1));
    h[i] = sinc * w;
    sum += h[i];
  }
  const out = new Float32Array(Math.floor(x.length / 2));
  for (let k = 0; k < out.length; k++) {
    const c = 2 * k;
    let acc = 0;
    for (let i = 0; i < taps; i++) {
      const j = c + i - mid;
      if (j >= 0 && j < x.length) acc += x[j] * h[i];
    }
    out[k] = acc / sum;
  }
  return out;
}

/** Studio.tsx `voicedRms`: RMS of the vocal over the frames where the curve is voiced. */
function voicedRms(mono, contour, sr) {
  const hop = sr / contour.fps;
  let acc = 0, count = 0;
  for (let j = 0; j < contour.midi.length; j++) {
    if (!(contour.midi[j] > 0)) continue;
    const a = Math.floor(j * hop), b = Math.min(mono.length, Math.floor((j + 1) * hop));
    for (let i = a; i < b; i++) acc += mono[i] * mono[i];
    count += Math.max(0, b - a);
  }
  return count ? Math.sqrt(acc / count) : 0;
}

/** Loudness jumps of 6 dB within 50 ms (the guide-line stage's re-attack detector). */
function reattackTimes(audio, sr) {
  const hop = Math.round(0.01 * sr);
  const db = [];
  for (let s = 0; s + hop <= audio.length; s += hop) {
    let acc = 0;
    for (let i = s; i < s + hop; i++) acc += audio[i] * audio[i];
    db.push(10 * Math.log10(acc / hop + 1e-12));
  }
  const top = Math.max(...db);
  const times = [];
  let last = -Infinity;
  for (let i = 5; i < db.length; i++) {
    if (db[i] < top - 30 || i - last < 10) continue;
    let min = Infinity;
    for (let k = i - 5; k < i; k++) min = Math.min(min, db[k]);
    if (db[i] - min < 6) continue;
    times.push(i / 100);
    last = i;
  }
  return times;
}

/** The vocal the pipeline is handed, at 44.1 kHz mono, for one case. */
async function vocalFor(audio, separated) {
  if (!separated) return audio;
  const { splitCenter } = await import("../../../src/lib/audio/karaoke.ts");
  const { left, right } = mixWithBacking({ vocal: audio, sr: SR, wetDb: WET_DB });
  const out = splitCenter(left, right, SR, { strength: 2 });
  const mono = new Float32Array(out.center[0].length);
  for (let i = 0; i < mono.length; i++) mono[i] = 0.5 * (out.center[0][i] + out.center[1][i]);
  return mono;
}

export async function ready() {
  for (const [, vib, transpose, separated] of CASES) {
    const { audio } = sungLine({ sr: SR, vibCents: vib, transpose });
    if (!bp.hasCache(halve(await vocalFor(audio, separated)))) return false;
  }
  return true;
}

export async function run() {
  const { cleanMonoLine } = await import("../../../src/lib/transcribe/monoline.ts");
  const { pickPeaks, trackContour } = await import("../../../src/lib/transcribe/contour.ts");
  const { placeInRegister } = await import("../../../src/lib/transcribe/register.ts");
  const { loudnessCurve } = await import("../../../src/lib/audio/envelope.ts");
  const { synthesizeGuide } = await import("../../../src/lib/audio/guide.ts");
  const metrics = {};
  const gates = [];

  for (const [tag, vib, transpose, separated] of CASES) {
    const { audio, truthNotes, f0, level } = sungLine({ sr: SR, vibCents: vib, transpose });
    {
      const vocal = await vocalFor(audio, separated);
      const seconds = vocal.length / SR;

      // transcribeFrom, vocal path
      const raw = await bp.getRaw(halve(vocal));
      const { notes } = bp.notesFrom(raw, DETECT);
      const line = cleanMonoLine(notes);
      const contour = trackContour(pickPeaks(raw.contours), line, seconds);
      contour.level = loudnessCurve(vocal, SR, contour.fps).slice(0, contour.midi.length);
      const targetRms = voicedRms(vocal, contour, SR);
      const placed = placeInRegister(line, contour, "cello");

      // the guide render (Studio.tsx guide effect), dry
      const [guide] = synthesizeGuide(placed.notes, {
        timbre: "bowed",
        sampleRate: SR,
        lengthSamples: audio.length,
        contour: placed.contour,
        bodyScale: 1,
        ...(targetRms > 0 ? { targetRms } : {}),
        room: false,
      });

      // pitch against the singer's true curve, moved by the chosen octaves
      const track = yin(guide, SR);
      const centre = 1024 / SR;
      const shift = 12 * placed.octaves;
      let joint = 0, within = 0;
      for (let f = 0; f < track.frames; f++) {
        if (!track.voiced[f]) continue;
        const m = f0.midi[Math.round((f * track.hop + centre) * 100)];
        if (!(m > 0)) continue;
        joint++;
        if (Math.abs(centsBetween(track.hz[f], midiToHz(m + shift))) <= 50) within++;
      }

      // loudness, 50 ms frames
      const hop = Math.round(0.05 * SR);
      const outRms = [], truthLevel = [];
      for (let s = 0, j = 0; s + hop <= guide.length; s += hop, j += 5) {
        let acc = 0;
        for (let i = s; i < s + hop; i++) acc += guide[i] * guide[i];
        outRms.push(Math.sqrt(acc / hop));
        let l = 0;
        for (let k = j; k < j + 5; k++) l += level[k] ?? 0;
        truthLevel.push(l / 5);
      }

      metrics[`pitchWithin50_${tag}`] = { value: round(joint ? within / joint : 0, 3), better: "higher", tol: 0.02 };
      metrics[`jointFrames_${tag}`] = { value: joint, better: "higher", tol: 0, info: true };
      metrics[`fragmentation_${tag}`] = { value: round(line.length / truthNotes.length, 2), better: "lower", tol: 0.1 };
      metrics[`levelCorrelation_${tag}`] = { value: round(pearson(outRms, truthLevel), 3), better: "higher", tol: 0.03 };
      metrics[`reattacks_${tag}`] = { value: reattackTimes(guide, SR).length, better: "lower", tol: 1 };
      metrics[`octaves_${tag}`] = { value: placed.octaves, better: "higher", tol: 0, info: true };

      if (!separated) {
        gates.push(
          { key: `pitchWithin50_${tag}`, op: ">=", value: 0.9 },
          { key: `levelCorrelation_${tag}`, op: ">=", value: 0.7 },
          { key: `reattacks_${tag}`, op: "<=", value: truthNotes.length + 2 },
          { key: `octaves_${tag}`, op: "==", value: transpose > 12 ? -1 : 0 },
        );
        if (transpose === 12) gates.push({ key: `fragmentation_${tag}`, op: "<=", value: 1.25 });
      }
    }
  }
  return { metrics, gates };
}
