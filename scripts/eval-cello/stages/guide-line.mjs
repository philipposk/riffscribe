/**
 * The guide as a continuous line that follows the singer (src/lib/audio/guideLine.ts).
 *
 * The synthetic sung line (lib/fixtures.mjs) is played back on the bowed timbre with the
 * fixture's own pitch curve and loudness as the contour, the way the app does once a part is
 * written from a vocal stem. Then:
 *  - pitch: an independent tracker (YIN) on the render against the singer's true pitch
 *  - loudness: the render's 50 ms RMS against the singer's loudness
 *  - level: the sounding RMS against the requested target
 *  - legato: with no loudness data every join is slurred, and no re-attack may be heard inside
 *    (while the same detector does hear the re-attacks when the singer re-articulates)
 *  - determinism, peak, the cello tone (spectral centroid and harmonic count of a held A2)
 *  - speed: a four-minute, 598-note part with the room
 *
 * Fast (no downloads); runs in CI.
 */
import { sungLine } from "../lib/fixtures.mjs";
import { yin } from "../lib/yin.mjs";
import { sha256Float32, centsBetween, percentile, pearson } from "../lib/metrics.mjs";

export const name = "guide-line";

const SR = 44100;
const VIB_CENTS = 40;
const TARGET_RMS = 0.1;
const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * Re-attacks heard in a render: moments where the loudness (10 ms RMS) jumps by 6 dB or more
 * within 50 ms, ignoring anything 30 dB below the loudest moment. Spectral-flux onsets are no
 * use here: they fire on every change of note, slurred or not, because the harmonics move.
 * A slur changes the note without a new attack, so it must not show up as a loudness jump.
 */
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

/** Magnitude spectrum of a Hann-windowed slice. */
async function spectrum(audio, start, size) {
  const { fft, hann } = await import("../../../src/lib/audio/fft.ts");
  const w = hann(size);
  const re = new Float32Array(size), im = new Float32Array(size);
  for (let i = 0; i < size; i++) re[i] = (audio[start + i] ?? 0) * w[i];
  fft(re, im);
  const mag = new Float64Array(size / 2 + 1);
  for (let b = 0; b < mag.length; b++) mag[b] = Math.hypot(re[b], im[b]);
  return mag;
}

export async function run(ctx) {
  const { synthesizeGuide } = await import("../../../src/lib/audio/guide.ts");
  const { planLine } = await import("../../../src/lib/audio/guideLine.ts");
  const metrics = {};
  const gates = [];

  const { truthNotes, f0, level } = sungLine({ sr: SR, vibCents: VIB_CENTS });
  const lengthSamples = Math.ceil((f0.midi.length / 100) * SR);
  const contour = { fps: 100, midi: f0.midi, level };
  const base = { timbre: "bowed", sampleRate: SR, lengthSamples, contour, targetRms: TARGET_RMS };

  // --- pitch against the singer's own curve
  const [dry] = synthesizeGuide(truthNotes, { ...base, room: false });
  const track = yin(dry, SR);
  const centre = 1024 / SR; // YIN's window is 2048 samples; compare at its middle
  const errs = [];
  for (let f = 0; f < track.frames; f++) {
    if (!track.voiced[f]) continue;
    const j = Math.round((f * track.hop + centre) * 100);
    const m = f0.midi[j];
    if (!(m > 0)) continue;
    errs.push(Math.abs(centsBetween(track.hz[f], midiToHz(m))));
  }
  metrics.pitchMedianCents = { value: round(percentile(errs, 50), 1), better: "lower", tol: 2 };
  metrics.pitchP95Cents = { value: round(percentile(errs, 95), 1), better: "lower", tol: 5 };
  metrics.pitchVoicedFrames = { value: errs.length, better: "higher", tol: 20, info: true };
  gates.push({ key: "pitchMedianCents", op: "<=", value: 10 }, { key: "pitchP95Cents", op: "<=", value: 30 });

  // --- loudness follows the singer (50 ms frames)
  const hop = Math.round(0.05 * SR);
  const outRms = [], truthLevel = [];
  for (let s = 0, j = 0; s + hop <= dry.length; s += hop, j += 5) {
    let acc = 0;
    for (let i = s; i < s + hop; i++) acc += dry[i] * dry[i];
    outRms.push(Math.sqrt(acc / hop));
    let l = 0;
    for (let k = j; k < j + 5; k++) l += level[k] ?? 0;
    truthLevel.push(l / 5);
  }
  metrics.levelCorrelation = { value: round(pearson(outRms, truthLevel), 3), better: "higher", tol: 0.03 };
  gates.push({ key: "levelCorrelation", op: ">=", value: 0.8 });

  // --- sounding level against the target
  let acc = 0, count = 0;
  for (let i = 0; i < dry.length; i++) {
    if (!(f0.midi[Math.floor((i / SR) * 100)] > 0)) continue;
    acc += dry[i] * dry[i];
    count++;
  }
  const levelDb = 20 * Math.log10(Math.sqrt(acc / Math.max(1, count)) / TARGET_RMS);
  metrics.levelErrorDb = { value: round(Math.abs(levelDb), 2), better: "lower", tol: 0.5 };
  gates.push({ key: "levelErrorDb", op: "<=", value: 2 });

  // --- legato: without loudness data every join is slurred; nothing may re-attack inside.
  // With the singer's loudness (which dips to silence at each of the fixture's joins) every note
  // is its own stroke, and the same detector must find those re-attacks, or its zero means nothing.
  const legatoOpts = { ...base, contour: { fps: 100, midi: f0.midi, level: [] }, room: false };
  const [legato] = synthesizeGuide(truthNotes, legatoOpts);
  const groups = planLine(truthNotes, legatoOpts)[0];
  let inside = 0;
  for (const t of reattackTimes(legato, SR)) {
    for (const g of groups) {
      if (t <= g.start + 0.15 || t >= g.end) continue;
      if (g.bowChanges.some((b) => Math.abs(t - b) < 0.1)) continue;
      inside++;
    }
  }
  metrics.slurGroups = { value: groups.length, better: "lower", tol: 0, info: true };
  metrics.onsetsInsideSlurs = { value: inside, better: "lower", tol: 0 };
  gates.push({ key: "onsetsInsideSlurs", op: "==", value: 0 });

  const strokes = planLine(truthNotes, { ...base, room: false })[0];
  const heard = reattackTimes(dry, SR);
  const found = strokes.filter((g) => heard.some((t) => Math.abs(t - g.start) <= 0.08)).length;
  metrics.reattacksFound = { value: found, better: "higher", tol: 1 };
  metrics.strokes = { value: strokes.length, better: "lower", tol: 0, info: true };
  gates.push({ key: "reattacksFound", op: ">=", value: strokes.length - 1 });

  // --- determinism and peak, with the room
  const [l1, r1] = synthesizeGuide(truthNotes, base);
  const [l2, r2] = synthesizeGuide(truthNotes, base);
  const same = sha256Float32(l1) === sha256Float32(l2) && sha256Float32(r1) === sha256Float32(r2);
  metrics.deterministic = { value: same ? 1 : 0, better: "higher", tol: 0 };
  gates.push({ key: "deterministic", op: "==", value: 1 });
  let peak = 0;
  for (let i = 0; i < l1.length; i++) peak = Math.max(peak, Math.abs(l1[i]), Math.abs(r1[i]));
  metrics.peak = { value: round(peak, 3), better: "lower", tol: 0.05 };
  gates.push({ key: "peak", op: "<=", value: 0.9 });

  // --- the cello tone: a held A2 at full level
  const a2 = synthesizeGuide(
    [{ pitchMidi: 45, startTimeSeconds: 0, durationSeconds: 2, amplitude: 1, pitchBends: [] }],
    { timbre: "bowed", sampleRate: SR, lengthSamples: Math.floor(2.5 * SR), room: false }
  )[0];
  const size = 32768;
  const mag = await spectrum(a2, Math.floor(1.1 * SR) - size / 2, size);
  const binHz = SR / size;
  let num = 0, den = 0;
  for (let b = 1; b < mag.length; b++) { num += b * binHz * mag[b]; den += mag[b]; }
  metrics.centroidHzA2 = { value: Math.round(num / den), better: "lower", tol: 150, info: true };
  gates.push({ key: "centroidHzA2", op: ">=", value: 600 }, { key: "centroidHzA2", op: "<=", value: 1800 });
  const harm = [];
  for (let h = 1; h * 110 < 0.45 * SR; h++) {
    const c = Math.round((h * 110) / binHz);
    let m = 0;
    for (let b = c - 3; b <= c + 3; b++) m = Math.max(m, mag[b] ?? 0);
    harm.push(m);
  }
  const strongest = Math.max(...harm);
  metrics.harmonicsWithin40dB = {
    value: harm.filter((m) => 20 * Math.log10(m / strongest) >= -40).length,
    better: "higher",
    tol: 2,
  };
  gates.push({ key: "harmonicsWithin40dB", op: ">=", value: 20 });

  // --- speed: 598 notes of 0.35 s over 240 s, with the room (the default)
  const notes = Array.from({ length: 598 }, (_, i) => ({
    pitchMidi: 48 + (i % 24),
    startTimeSeconds: (i * (240 - 0.35)) / 597,
    durationSeconds: 0.35,
    amplitude: 0.7,
    pitchBends: [],
  }));
  const times = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    synthesizeGuide(notes, { timbre: "bowed", sampleRate: SR, lengthSamples: 240 * SR });
    times.push(performance.now() - t0);
  }
  // wall-clock time differs between machines: recorded, never compared with the baseline
  metrics.renderMs4min = { value: Math.round(percentile(times, 50)), better: "lower", tol: 0, info: true };
  gates.push({ key: "renderMs4min", op: "<=", value: ctx?.ci ? 5000 : 1500 });

  return { metrics, gates };
}
