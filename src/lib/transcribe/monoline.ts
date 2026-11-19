/**
 * One playable line out of Basic Pitch's notes.
 *
 * A sung (or any single-voice) line comes out of the model in pieces: a held
 * note with vibrato becomes a string of short neighbouring notes, an octave
 * ghost sits on top of the real pitch, and tiny blips fall between notes. A
 * cellist cannot play that. This turns it into one note at a time, with held
 * notes held.
 *
 * Basic Pitch also names some notes a semitone off (a held A labelled B flat
 * for a moment) and catches short passing notes as the voice slides between
 * two notes. So each kept note's pitch is read again from the continuous pitch
 * of the line: the `contour` when the caller has one (`trackContour`), or else
 * the notes' own pitch bends.
 *
 * Pure and deterministic: returns new note objects and never touches the
 * input. Pitch bends are dropped, because the notes they described no longer
 * exist.
 */
import type { NoteEvent, PitchContour } from "../types";
import { CONTOUR_BIN_OFFSET } from "./contour";

export interface MonoLineOptions {
  /**
   * How to choose between notes that start together.
   * "strongest": the loudest, preferring small leaps and avoiding octave ghosts.
   * "highest": the top note (the old melody rule).
   */
  strategy?: "strongest" | "highest";
  /**
   * The line's continuous pitch, from `trackContour`. When given, every kept
   * note takes its pitch from it. Without it, the notes' own `pitchBends` are
   * used when they have them; notes with neither keep Basic Pitch's pitch.
   *
   * `trackContour` needs a line to follow, so a caller with model peaks runs
   * this twice: `cleanMonoLine(found)`, then `trackContour(peaks, thatLine)`,
   * then `cleanMonoLine(found, { contour })`, and tracks the final contour
   * from the result.
   */
  contour?: PitchContour | null;
}

/** Notes starting within this of a group's first note start together. */
const ONSET_GROUP = 0.03;
/** A note louder than this share of the previous one cuts it short instead of being dropped. */
const OVERLAP_KEEP_AMP = 0.5;
/** ...unless it is also shorter than this. */
const OVERLAP_KEEP_DUR = 0.12;
/** Per-semitone penalty on leaps when choosing the strongest note. */
const LEAP_PENALTY = 0.02;
/** Penalty for a note that has a strong note an octave, twelfth or two octaves below it. */
const GHOST_PENALTY = 0.15;
const GHOST_INTERVALS = [12, 19, 24];
const GHOST_AMP_SHARE = 0.6;
/**
 * Same-pitch neighbours this close are one note. Wide vibrato makes the model
 * start the same note again every cycle with a gap of up to ~70 ms.
 */
const MERGE_GAP = 0.08;
/** Vibrato runs: gaps, pitch span, interior length, and direction changes. */
const VIB_GAP = 0.04;
const VIB_SPAN = 2;
const VIB_INTERIOR = 0.2;
const VIB_TURNS = 2;
/** Notes shorter than this are blips. */
const MIN_NOTE = 0.08;
/** A blip this close to both neighbours leaves no hole: the previous note runs on. */
const BLIP_GAP = 0.04;
/**
 * Re-pitching. A note's pitch is the median of the line's pitch over the
 * middle REPITCH_SHARE of the note, widened to at least REPITCH_WINDOW around
 * its middle so a short piece of a held note sees one and a half vibrato
 * cycles or more (5-7 Hz: 140-200 ms each) and lands on the centre, not the
 * crest. 0.3 s was the best of 0.14-0.36 s on both the synthetic line and the
 * vocadito excerpts (eval stage `monoline`); 0.2 s already beats no re-pitch.
 */
const REPITCH_SHARE = 0.6;
const REPITCH_WINDOW = 0.3;
/**
 * Neighbours this many semitones away fence the wider window off. Not 2: the
 * crest and trough of an 80-cent vibrato come out labelled two apart.
 */
const REPITCH_FENCE = 3;
/** Fewer voiced samples than this in the window: keep the model's pitch. */
const REPITCH_MIN_SAMPLES = 3;
/** Never move a note further than this (semitones): larger disagreements are a different note. */
const REPITCH_MAX = 1;
/** A note shorter than this whose pitch lies between its neighbours' is the slide between them. */
const GLIDE_NOTE = 0.09;
/** ...when it touches both of them within this. */
const GLIDE_GAP = 0.08;
/**
 * Up to this long, such a note is still the slide when the line's pitch
 * travels at least GLIDE_TRAVEL semitones across it, from the previous note
 * towards the next. A note that is really sung holds its pitch instead.
 */
const GLIDE_NOTE_LONG = 0.16;
const GLIDE_TRAVEL = 0.75;
/** Samples averaged at each end of a note when measuring that travel. */
const GLIDE_END_SAMPLES = 3;
/**
 * The crest or trough of a held note's vibrato, caught as a short note of its
 * own at either end. A note shorter than GLIDE_NOTE_LONG next to a held note
 * joins it when at least EDGE_INSIDE of its pitch samples lie within the range
 * the held note's pitch swings through over its nearest EDGE_REACH seconds,
 * and that swing is at least EDGE_MIN_SWING semitones (a held note without
 * vibrato never takes a neighbour this way).
 */
const EDGE_REACH = 0.3;
const EDGE_MIN_SWING = 0.6;
const EDGE_INSIDE = 0.6;

/** Working copy: a note plus the summed sounding time behind it, for weighted means. */
interface Work {
  start: number;
  end: number;
  pitch: number;
  amp: number;
  /** Sum of the original durations folded into this note (gaps excluded). */
  weight: number;
  /** The source note's start, duration and pitch bends, while it is still one source note. */
  src?: NoteEvent;
}

const toWork = (n: NoteEvent): Work => ({
  start: n.startTimeSeconds,
  end: n.startTimeSeconds + n.durationSeconds,
  pitch: n.pitchMidi,
  amp: n.amplitude,
  weight: Math.max(0, n.durationSeconds),
  src: n,
});

const toNote = (w: Work): NoteEvent => ({
  startTimeSeconds: w.start,
  durationSeconds: w.end - w.start,
  pitchMidi: w.pitch,
  amplitude: w.amp,
});

/** Duration-weighted mean amplitude of several notes. */
function weightedAmp(ws: Work[]): number {
  const total = ws.reduce((a, w) => a + w.weight, 0);
  if (total <= 0) return ws.reduce((a, w) => a + w.amp, 0) / ws.length;
  return ws.reduce((a, w) => a + w.amp * w.weight, 0) / total;
}

/** Step 4: same-pitch neighbours with a small gap become one note. */
function mergeSamePitch(line: Work[]): Work[] {
  const out: Work[] = [];
  for (const w of line) {
    const prev = out[out.length - 1];
    if (prev && prev.pitch === w.pitch && w.start - prev.end <= MERGE_GAP) {
      const amp = weightedAmp([prev, w]);
      prev.end = Math.max(prev.end, w.end);
      prev.weight += w.weight;
      prev.amp = amp;
    } else {
      out.push({ ...w });
    }
  }
  return out;
}

/** True when notes i..j (inclusive) could be one wobbling note, ignoring direction changes. */
function vibratoShape(line: Work[], i: number, j: number): boolean {
  let lo = Infinity, hi = -Infinity;
  for (let k = i; k <= j; k++) {
    lo = Math.min(lo, line[k].pitch);
    hi = Math.max(hi, line[k].pitch);
    if (k > i && line[k].start - line[k - 1].end > VIB_GAP) return false;
    if (k > i && k < j && line[k].end - line[k].start > VIB_INTERIOR) return false;
  }
  return hi - lo <= VIB_SPAN;
}

function turns(line: Work[], i: number, j: number): number {
  let count = 0, dir = 0;
  for (let k = i + 1; k <= j; k++) {
    const d = Math.sign(line[k].pitch - line[k - 1].pitch);
    if (d === 0) continue;
    if (dir !== 0 && d !== dir) count++;
    dir = d;
  }
  return count;
}

/** Step 5: a run of short neighbouring notes that goes up and down is vibrato on one note. */
function foldVibrato(line: Work[]): Work[] {
  const out: Work[] = [];
  let i = 0;
  while (i < line.length) {
    let j = i;
    while (j + 1 < line.length && vibratoShape(line, i, j + 1)) j++;
    if (j - i + 1 >= 3 && turns(line, i, j) >= VIB_TURNS) {
      const run = line.slice(i, j + 1);
      const time = new Map<number, number>();
      for (const w of run) time.set(w.pitch, (time.get(w.pitch) ?? 0) + (w.end - w.start));
      const most = Math.max(...time.values());
      const tied = [...time.entries()].filter(([, t]) => t >= most - 1e-9).map(([p]) => p);
      const lo = Math.min(...run.map((w) => w.pitch));
      const hi = Math.max(...run.map((w) => w.pitch));
      const mid = (lo + hi) / 2;
      // tie: the pitch nearest the middle of the run's span (the lower one if two are equally near)
      const pitch = tied.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b)[0];
      out.push({
        start: run[0].start,
        end: run[run.length - 1].end,
        pitch,
        amp: weightedAmp(run),
        weight: run.reduce((a, w) => a + w.weight, 0),
      });
      i = j + 1;
    } else {
      out.push({ ...line[i] });
      i++;
    }
  }
  return out;
}

/** Step 7: drop blips; a blip tucked between two notes hands its time to the note before it. */
function dropBlips(line: Work[]): Work[] {
  const out: Work[] = [];
  for (let i = 0; i < line.length; i++) {
    const w = line[i];
    if (w.end - w.start >= MIN_NOTE) {
      out.push({ ...w });
      continue;
    }
    const prev = out[out.length - 1];
    const next = line[i + 1];
    if (prev && next && w.start - prev.end <= BLIP_GAP && next.start - w.end <= BLIP_GAP) {
      prev.end = Math.max(prev.end, next.start);
    }
  }
  return out;
}

/** The line's pitch as time-sorted samples (fractional MIDI). */
interface Samples {
  t: number[];
  v: number[];
}

function contourSamples(c: PitchContour): Samples {
  const t: number[] = [], v: number[] = [];
  const fps = c.fps > 0 ? c.fps : 100;
  for (let j = 0; j < c.midi.length; j++) {
    if (c.midi[j] > 0) { t.push(j / fps); v.push(c.midi[j]); }
  }
  return { t, v };
}

/**
 * The picked notes' own pitch bends as samples. Basic Pitch gives one bend per
 * model frame from the note's start, in contour bins (a third of a semitone)
 * from its pitch, carrying the same one-bin sharp bias the contour corrects.
 * Null when no note has bends.
 */
function bendSamples(line: Work[]): Samples | null {
  const pts: [number, number][] = [];
  for (const w of line) {
    const b = w.src?.pitchBends;
    if (!b?.length || !w.src) continue;
    const step = w.src.durationSeconds / b.length;
    for (let i = 0; i < b.length; i++) {
      const t = w.src.startTimeSeconds + i * step;
      if (t < w.start || t >= w.end || !Number.isFinite(b[i])) continue;
      pts.push([t, w.src.pitchMidi + b[i] / 3 + CONTOUR_BIN_OFFSET]);
    }
  }
  if (!pts.length) return null;
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { t: pts.map((p) => p[0]), v: pts.map((p) => p[1]) };
}

/** First index with t[i] >= x. */
function lowerBound(t: number[], x: number): number {
  let lo = 0, hi = t.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t[mid] < x) lo = mid + 1; else hi = mid;
  }
  return lo;
}

const medianOf = (sorted: number[]) => {
  const n = sorted.length;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
};

/**
 * Step 3b: each note's pitch read from the line's continuous pitch: the median
 * over the note's middle, widened to REPITCH_WINDOW so a piece of a vibrato
 * cycle lands on the cycle's centre. The wider window never reaches into a
 * neighbour REPITCH_FENCE or more semitones away: that is a different note,
 * not the other half of a wobble.
 */
function repitch(line: Work[], s: Samples): Work[] {
  return line.map((w, i) => {
    const dur = w.end - w.start;
    const mid = (w.start + w.end) / 2;
    const half = Math.max((REPITCH_SHARE * dur) / 2, REPITCH_WINDOW / 2);
    const prev = line[i - 1], next = line[i + 1];
    let a = mid - half, b = mid + half;
    if (prev && Math.abs(prev.pitch - w.pitch) >= REPITCH_FENCE) a = Math.max(a, Math.min(w.start, mid - (REPITCH_SHARE * dur) / 2));
    if (next && Math.abs(next.pitch - w.pitch) >= REPITCH_FENCE) b = Math.min(b, Math.max(w.end, mid + (REPITCH_SHARE * dur) / 2));
    const vals = s.v.slice(lowerBound(s.t, a), lowerBound(s.t, b)).sort((x, y) => x - y);
    if (vals.length < REPITCH_MIN_SAMPLES) return { ...w };
    const p = Math.round(medianOf(vals));
    return Math.abs(p - w.pitch) <= REPITCH_MAX ? { ...w, pitch: p } : { ...w };
  });
}

/** Semitones the line's pitch moves across [a, b), end against start; 0 without enough samples. */
function travel(s: Samples, a: number, b: number): number {
  const i = lowerBound(s.t, a), j = lowerBound(s.t, b);
  const k = Math.min(GLIDE_END_SAMPLES, Math.floor((j - i) / 2));
  if (k < 1) return 0;
  let first = 0, last = 0;
  for (let x = 0; x < k; x++) { first += s.v[i + x]; last += s.v[j - 1 - x]; }
  return (last - first) / k;
}

/** Lowest and highest sample in [a, b), or null with too few samples. */
function rangeOf(s: Samples, a: number, b: number): [number, number] | null {
  const i = lowerBound(s.t, a), j = lowerBound(s.t, b);
  if (j - i < REPITCH_MIN_SAMPLES) return null;
  let lo = Infinity, hi = -Infinity;
  for (let x = i; x < j; x++) { lo = Math.min(lo, s.v[x]); hi = Math.max(hi, s.v[x]); }
  return [lo, hi];
}

/** Share of the samples in [a, b) that lie within [lo, hi]; 0 with too few samples. */
function shareInside(s: Samples, a: number, b: number, lo: number, hi: number): number {
  const i = lowerBound(s.t, a), j = lowerBound(s.t, b);
  if (j - i < REPITCH_MIN_SAMPLES) return 0;
  let n = 0;
  for (let x = i; x < j; x++) if (s.v[x] >= lo && s.v[x] <= hi) n++;
  return n / (j - i);
}

/** True when `w` sits inside the vibrato of `host` over host's stretch [a, b). */
function inVibrato(s: Samples, w: Work, host: Work, a: number, b: number): boolean {
  if (host.end - host.start <= w.end - w.start || Math.abs(host.pitch - w.pitch) > VIB_SPAN) return false;
  const r = rangeOf(s, a, b);
  return !!r && r[1] - r[0] >= EDGE_MIN_SWING && shareInside(s, w.start, w.end, r[0], r[1]) >= EDGE_INSIDE;
}

/** Step 6a: short notes that are only a held note's vibrato at its start or end join that note. */
function absorbVibratoEdges(input: Work[], s: Samples): Work[] {
  const line = input.map((w) => ({ ...w }));
  const out: Work[] = [];
  for (let i = 0; i < line.length; i++) {
    const w = line[i];
    if (w.end - w.start < GLIDE_NOTE_LONG) {
      const prev = out[out.length - 1];
      const next = line[i + 1];
      if (prev && w.start - prev.end <= GLIDE_GAP && inVibrato(s, w, prev, Math.max(prev.start, prev.end - EDGE_REACH), prev.end)) {
        prev.end = w.end;
        prev.weight += w.weight;
        continue;
      }
      if (next && next.start - w.end <= GLIDE_GAP && inVibrato(s, w, next, next.start, Math.min(next.end, next.start + EDGE_REACH))) {
        next.start = w.start;
        next.weight += w.weight;
        continue;
      }
    }
    out.push(w);
  }
  return out;
}

/** Step 6b: a short note between two neighbours, pitched between them, is the slide from one to the other. */
function dropGlides(line: Work[], s: Samples | null): Work[] {
  const out: Work[] = [];
  for (let i = 0; i < line.length; i++) {
    const w = line[i];
    const prev = out[out.length - 1];
    const next = line[i + 1];
    const dur = w.end - w.start;
    const between =
      prev && next &&
      w.start - prev.end <= GLIDE_GAP && next.start - w.end <= GLIDE_GAP &&
      w.pitch > Math.min(prev.pitch, next.pitch) && w.pitch < Math.max(prev.pitch, next.pitch);
    const sliding =
      dur < GLIDE_NOTE ||
      (s !== null && dur < GLIDE_NOTE_LONG && between &&
        travel(s, w.start, w.end) * Math.sign(next.pitch - prev.pitch) >= GLIDE_TRAVEL);
    if (between && sliding) {
      prev.end = Math.max(prev.end, next.start);
      continue;
    }
    out.push({ ...w });
  }
  return out;
}

/** Steps 1-3: one note per onset group, and no note sounding over the next one. */
function pickOneAtATime(notes: NoteEvent[], strategy: "strongest" | "highest"): Work[] {
  const sorted = notes
    .filter((n) => Number.isFinite(n.startTimeSeconds) && Number.isFinite(n.durationSeconds) && n.durationSeconds > 0)
    .map(toWork)
    .sort((a, b) => a.start - b.start || b.amp - a.amp);

  const line: Work[] = [];
  let i = 0;
  while (i < sorted.length) {
    const first = sorted[i].start;
    let j = i;
    while (j < sorted.length && sorted[j].start - first <= ONSET_GROUP) j++;
    const group = sorted.slice(i, j);
    i = j;

    const prevPitch = line.length ? line[line.length - 1].pitch : null;
    let chosen = group[0];
    if (strategy === "highest") {
      for (const w of group) if (w.pitch > chosen.pitch) chosen = w;
    } else {
      let best = -Infinity;
      for (const w of group) {
        let score = w.amp - (prevPitch == null ? 0 : LEAP_PENALTY * Math.abs(w.pitch - prevPitch));
        const ghost = group.some(
          (o) => o !== w && GHOST_INTERVALS.includes(w.pitch - o.pitch) && o.amp >= GHOST_AMP_SHARE * w.amp
        );
        if (ghost) score -= GHOST_PENALTY;
        if (score > best) { best = score; chosen = w; }
      }
    }

    const prev = line[line.length - 1];
    if (prev && prev.end > chosen.start) {
      const dur = chosen.end - chosen.start;
      if (chosen.amp < OVERLAP_KEEP_AMP * prev.amp && dur < OVERLAP_KEEP_DUR) continue;
      prev.end = chosen.start;
      prev.weight = Math.min(prev.weight, prev.end - prev.start);
    }
    line.push({ ...chosen });
  }
  return line;
}

/**
 * Basic Pitch notes to a single clean line: one note at a time, each note's
 * pitch read from the line's continuous pitch (contour, else pitch bends),
 * same-pitch pieces joined, vibrato folded into the note it decorates, slides
 * and blips removed. Sorted by start with no overlaps.
 */
export function cleanMonoLine(notes: NoteEvent[], o: MonoLineOptions = {}): NoteEvent[] {
  const strategy = o.strategy ?? "strongest";
  let line = pickOneAtATime(notes, strategy);
  const found = o.contour ? contourSamples(o.contour) : bendSamples(line);
  const samples = found && found.t.length ? found : null;
  if (samples) line = repitch(line, samples);
  line = mergeSamePitch(line);
  line = foldVibrato(line);
  line = mergeSamePitch(line);
  if (samples) line = absorbVibratoEdges(line, samples);
  line = dropGlides(line, samples);
  line = mergeSamePitch(line);
  line = dropBlips(line);

  // step 8: sorted, nothing overlapping, nothing empty
  line.sort((a, b) => a.start - b.start);
  for (let k = 0; k + 1 < line.length; k++) {
    if (line[k].end > line[k + 1].start) line[k].end = line[k + 1].start;
  }
  return line.filter((w) => w.end > w.start).map(toNote);
}
