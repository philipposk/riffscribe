/**
 * One playable line out of Basic Pitch's notes.
 *
 * A sung (or any single-voice) line comes out of the model in pieces: a held
 * note with vibrato becomes a string of short neighbouring notes, an octave
 * ghost sits on top of the real pitch, and tiny blips fall between notes. A
 * cellist cannot play that. This turns it into one note at a time, with held
 * notes held.
 *
 * Pure: returns new note objects and never touches the input. Pitch bends are
 * dropped, because the notes they described no longer exist.
 */
import type { NoteEvent } from "../types";

export interface MonoLineOptions {
  /**
   * How to choose between notes that start together.
   * "strongest": the loudest, preferring small leaps and avoiding octave ghosts.
   * "highest": the top note (the old melody rule).
   */
  strategy?: "strongest" | "highest";
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
/** Same-pitch neighbours this close are one note. */
const MERGE_GAP = 0.06;
/** Vibrato runs: gaps, pitch span, interior length, and direction changes. */
const VIB_GAP = 0.04;
const VIB_SPAN = 2;
const VIB_INTERIOR = 0.2;
const VIB_TURNS = 2;
/** Notes shorter than this are blips. */
const MIN_NOTE = 0.08;
/** A blip this close to both neighbours leaves no hole: the previous note runs on. */
const BLIP_GAP = 0.04;

/** Working copy: a note plus the summed sounding time behind it, for weighted means. */
interface Work {
  start: number;
  end: number;
  pitch: number;
  amp: number;
  /** Sum of the original durations folded into this note (gaps excluded). */
  weight: number;
}

const toWork = (n: NoteEvent): Work => ({
  start: n.startTimeSeconds,
  end: n.startTimeSeconds + n.durationSeconds,
  pitch: n.pitchMidi,
  amp: n.amplitude,
  weight: Math.max(0, n.durationSeconds),
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
 * Basic Pitch notes to a single clean line: one note at a time, same-pitch
 * pieces joined, vibrato folded into the note it decorates, blips removed.
 * Sorted by start with no overlaps.
 */
export function cleanMonoLine(notes: NoteEvent[], o: MonoLineOptions = {}): NoteEvent[] {
  const strategy = o.strategy ?? "strongest";
  let line = pickOneAtATime(notes, strategy);
  line = mergeSamePitch(line);
  line = foldVibrato(line);
  line = mergeSamePitch(line);
  line = dropBlips(line);

  // step 8: sorted, nothing overlapping, nothing empty
  line.sort((a, b) => a.start - b.start);
  for (let k = 0; k + 1 < line.length; k++) {
    if (line[k].end > line[k + 1].start) line[k].end = line[k + 1].start;
  }
  return line.filter((w) => w.end > w.start).map(toNote);
}
