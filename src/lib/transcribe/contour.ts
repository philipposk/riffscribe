/**
 * A continuous pitch curve for a single sung or played line.
 *
 * Basic Pitch already works out a pitch-salience map for every model frame
 * (264 bins, three per semitone, from A0 up) and then throws it away once it
 * has rounded each note to a whole semitone plus a few coarse bends. This file
 * keeps the useful part of that map — the top few peaks per frame, refined
 * between bins — and then follows the line through it, so slides and vibrato
 * come out as the singer did them rather than as a staircase.
 *
 * Pure arithmetic over arrays. Nothing here may import TensorFlow.js or Basic
 * Pitch (HANDOFF gotcha 3): the worker, the page fallback and the Node eval all
 * call these same functions on plain numbers.
 */
import type { ContourPeaks, NoteEvent, PitchContour } from "../types";

// ---- Basic Pitch's own frame arithmetic, rebuilt from the same integers ----
//
// These mirror the constants in @spotify/basic-pitch's toMidi.js exactly
// (HANDOFF gotcha 10: never re-derive the frame rate as 22050/256 = 86.13).
const SAMPLE_RATE = 22050;
const FFT_HOP = 256;
const WINDOW_SECONDS = 2;
/** floor(22050 / 256) = 86: the floor is what the library uses. */
const ANNOTATIONS_FPS = Math.floor(SAMPLE_RATE / FFT_HOP);
/** Model frames per 2-second analysis window: 172. */
const ANNOT_N_FRAMES = ANNOTATIONS_FPS * WINDOW_SECONDS;
/** Samples per window the model actually sees: 44100 − 256 = 43844. */
const AUDIO_N_SAMPLES = SAMPLE_RATE * WINDOW_SECONDS - FFT_HOP;
/**
 * How far each window's frames sit behind a plain `f·hop/sr` clock, exactly as
 * Basic Pitch defines WINDOW_OFFSET:
 *
 *   (256/22050)·(172 − 43844/256) + 0.0018 = (256/22050)·0.734375 + 0.0018 ≈ 0.010326 s
 *
 * The 0.0018 is the library's own empirical correction and is copied as is.
 */
const WINDOW_OFFSET = (FFT_HOP / SAMPLE_RATE) * (ANNOT_N_FRAMES - AUDIO_N_SAMPLES / FFT_HOP) + 0.0018;

/** Seconds at which model frame `frame` sits; the same as Basic Pitch's `modelFrameToTime`. */
export function frameTime(frame: number): number {
  return (frame * FFT_HOP) / SAMPLE_RATE - WINDOW_OFFSET * Math.floor(frame / ANNOT_N_FRAMES);
}

// ---- peaks ----

/** Pitch-contour bins per frame (88 semitones × 3). */
const CONTOUR_BINS = 264;
/** Bins per semitone in the contour map. */
const BINS_PER_SEMITONE = 3;
/** Bin 0 is A0 = 27.5 Hz = MIDI 21. */
const MIDI_OFFSET = 21;
/** Peaks kept per frame. */
const PEAKS_PER_FRAME = 3;
/** Salience below this is not a peak. */
const MIN_SALIENCE = 0.1;

/**
 * Semitones added to every refined peak, to cancel a fixed bias in where the
 * model puts its salience.
 *
 * Measured by the `contour` eval stage on the synthetic sung line with this set
 * to 0: the median signed error was +33 / +34 / +34 cents at 1 / 40 / 80 cents
 * of vibrato — the same sign and within a cent at every depth, i.e. the peaks
 * sit one whole contour bin (1/3 semitone = 33.3 cents) sharp of `21 + i/3`.
 * So one bin is taken off. Checked on real singing too: with the bin taken off,
 * the median signed error against vocadito's annotated f0 (first 12 excerpts,
 * about 29k voiced frames) is −1.0 cents. Change it only together with a re-run of
 * `npm run eval:cello -- --only=contour`.
 */
export const CONTOUR_BIN_OFFSET = -1 / 3;

/**
 * The strongest few pitch-salience peaks in each frame of Basic Pitch's contour
 * output, each refined between bins with a parabola through its neighbours.
 *
 * Peaks are stored strongest first; unused slots are 0 in both arrays.
 */
export function pickPeaks(contours: ArrayLike<number>[]): ContourPeaks {
  const frames = contours.length;
  const k = PEAKS_PER_FRAME;
  const midi = new Float32Array(frames * k);
  const strength = new Float32Array(frames * k);
  const topV = new Array<number>(k);
  const topI = new Array<number>(k);

  for (let f = 0; f < frames; f++) {
    const v = contours[f];
    const n = Math.min(v.length, CONTOUR_BINS);
    let found = 0;
    for (let i = 0; i < n; i++) {
      const b = v[i];
      if (!(b >= MIN_SALIENCE)) continue;
      if (i > 0 && !(b >= v[i - 1])) continue;
      if (i < n - 1 && !(b > v[i + 1])) continue;
      // insert into the top-k list, kept in descending order
      let at = found;
      while (at > 0 && topV[at - 1] < b) at--;
      if (at >= k) continue;
      for (let j = Math.min(found, k - 1); j > at; j--) {
        topV[j] = topV[j - 1];
        topI[j] = topI[j - 1];
      }
      topV[at] = b;
      topI[at] = i;
      if (found < k) found++;
    }
    for (let j = 0; j < found; j++) {
      const i = topI[j];
      let delta = 0;
      if (i > 0 && i < n - 1) {
        const a = v[i - 1];
        const b = v[i];
        const c = v[i + 1];
        const den = a - 2 * b + c;
        if (den !== 0) delta = Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den));
      }
      midi[f * k + j] = MIDI_OFFSET + (i + delta) / BINS_PER_SEMITONE + CONTOUR_BIN_OFFSET;
      strength[f * k + j] = Math.max(0, Math.min(1, topV[j]));
    }
  }
  return { frames, k, midi, strength };
}

// ---- tracking ----

/** A peak further than this from the note's own pitch is someone else's. */
const MAX_DEVIATION = 1.5;
/** Gaps between consecutive notes up to this long are sung through, not breaths. */
const BRIDGE_SECONDS = 0.08;
/** Output grid. */
const OUT_FPS = 100;
/** A voiced model frame this close to an output frame may stand in for it. */
const NEAREST_SECONDS = 0.015;

/** First model frame whose time is at or after `t` (frame times only ever increase). */
function firstFrameAtOrAfter(times: Float64Array, t: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const median3 = (a: number, b: number, c: number) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));

/**
 * Follow one line through the peaks, guided by its notes.
 *
 * Inside each note the curve takes, frame by frame, the peak closest to the
 * note's pitch (within 1.5 semitones), fills what it cannot find by straight
 * lines, and takes out single-frame spikes with a 3-frame median. Short gaps
 * between notes are joined, then everything is put on a 100 fps grid from 0 s.
 *
 * `level` is left empty; the caller fills it from the audio if it wants one.
 */
export function trackContour(
  peaks: ContourPeaks,
  monoNotes: NoteEvent[],
  durationSeconds: number
): PitchContour {
  const F = peaks.frames;
  const K = peaks.k;
  const times = new Float64Array(F);
  for (let f = 0; f < F; f++) times[f] = frameTime(f);

  /** Pitch per model frame; NaN = unvoiced. */
  const track = new Float64Array(F).fill(NaN);
  const notes = monoNotes
    .filter((n) => n.durationSeconds > 0 && Number.isFinite(n.pitchMidi))
    .slice()
    .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
  /** Model-frame span of each note, [first, last] inclusive; first > last when it has none. */
  const spans: [number, number][] = [];

  for (const note of notes) {
    const start = note.startTimeSeconds;
    const end = start + note.durationSeconds;
    const first = firstFrameAtOrAfter(times, start);
    const last = firstFrameAtOrAfter(times, end) - 1;
    spans.push([first, last]);
    if (first > last) continue;

    // 1. the nearest peak to the note's pitch in each frame
    const len = last - first + 1;
    const raw = new Float64Array(len).fill(NaN);
    let anyPeak = false;
    for (let f = first; f <= last; f++) {
      let best = NaN;
      let bestDist = Infinity;
      let bestStrength = -1;
      for (let j = 0; j < K; j++) {
        const m = peaks.midi[f * K + j];
        if (!(m > 0)) continue;
        const d = Math.abs(m - note.pitchMidi);
        if (d > MAX_DEVIATION) continue;
        const s = peaks.strength[f * K + j];
        if (d < bestDist || (d === bestDist && s > bestStrength)) {
          best = m;
          bestDist = d;
          bestStrength = s;
        }
      }
      raw[f - first] = best;
      if (!Number.isNaN(best)) anyPeak = true;
    }

    // 2. fill the holes: straight lines inside, held at the edges, the note itself if nothing
    if (!anyPeak) {
      raw.fill(note.pitchMidi);
    } else {
      let prev = -1;
      for (let i = 0; i < len; i++) {
        if (Number.isNaN(raw[i])) continue;
        if (prev < 0) {
          for (let x = 0; x < i; x++) raw[x] = raw[i];
        } else if (i - prev > 1) {
          for (let x = prev + 1; x < i; x++) raw[x] = raw[prev] + ((raw[i] - raw[prev]) * (x - prev)) / (i - prev);
        }
        prev = i;
      }
      for (let x = prev + 1; x < len; x++) raw[x] = raw[prev];
    }

    // 3. 3-frame median inside the note (the end frames keep their value)
    for (let i = 0; i < len; i++) {
      track[first + i] = i > 0 && i < len - 1 ? median3(raw[i - 1], raw[i], raw[i + 1]) : raw[i];
    }
  }

  // 4. sing through short gaps between consecutive notes
  for (let n = 1; n < notes.length; n++) {
    const a = notes[n - 1];
    const b = notes[n];
    const gap = b.startTimeSeconds - (a.startTimeSeconds + a.durationSeconds);
    if (gap > BRIDGE_SECONDS) continue;
    const [, aLast] = spans[n - 1];
    const [bFirst] = spans[n];
    if (aLast < 0 || bFirst >= F || bFirst - aLast < 2) continue;
    const pa = track[aLast];
    const pb = track[bFirst];
    if (Number.isNaN(pa) || Number.isNaN(pb)) continue;
    for (let f = aLast + 1; f < bFirst; f++) {
      if (!Number.isNaN(track[f])) continue;
      const u = (times[f] - times[aLast]) / (times[bFirst] - times[aLast]);
      track[f] = pa + (pb - pa) * u;
    }
  }

  // 5. onto a uniform 100 fps grid from 0 s
  const out = Math.max(0, Math.ceil(durationSeconds * OUT_FPS));
  const midi = new Array<number>(out).fill(0);
  for (let j = 0; j < out; j++) {
    const t = j / OUT_FPS;
    const b = firstFrameAtOrAfter(times, t); // times[b] >= t
    const a = b - 1; // times[a] < t
    let v = NaN;
    if (b < F && times[b] === t) v = track[b];
    else if (a >= 0 && b < F && !Number.isNaN(track[a]) && !Number.isNaN(track[b])) {
      v = track[a] + ((track[b] - track[a]) * (t - times[a])) / (times[b] - times[a]);
    }
    if (Number.isNaN(v)) {
      // the nearest voiced model frame within 15 ms, looking both ways
      let bestDist = NEAREST_SECONDS;
      for (let f = a; f >= 0 && t - times[f] <= NEAREST_SECONDS; f--) {
        if (!Number.isNaN(track[f]) && t - times[f] <= bestDist) {
          bestDist = t - times[f];
          v = track[f];
          break;
        }
      }
      for (let f = b; f < F && times[f] - t <= bestDist; f++) {
        if (!Number.isNaN(track[f])) {
          if (times[f] - t < bestDist || Number.isNaN(v)) v = track[f];
          break;
        }
      }
    }
    // 6. two decimals; 0 means unvoiced
    midi[j] = Number.isNaN(v) ? 0 : Math.round(v * 100) / 100;
  }

  return { fps: OUT_FPS, midi, level: [] };
}
