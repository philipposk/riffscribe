/**
 * Put a line on an instrument by whole octaves.
 *
 * A soprano melody handed to a cello as sung sits at the very top of the
 * instrument; a bass line handed to a violin does not fit at all. Moving the
 * whole line by octaves keeps every interval and every note, and puts the
 * middle of the line where the instrument sings best. Notes that still fall
 * off the instrument are moved by an octave on their own, so nothing is lost.
 *
 * The pitch curve (when there is one) moves with the notes, so the guide
 * synth that follows the singer plays in the same octave as the score.
 */
import { INSTRUMENTS, type InstrumentId, type NoteEvent, type PitchContour } from "../types";

/** Where each instrument sounds best: the middle of the line should land here. */
const SINGING: Partial<Record<InstrumentId, [number, number]>> = {
  cello: [48, 69],
  viola: [55, 79],
  violin: [62, 88],
  "double-bass": [33, 55],
};

/** The singing register of an instrument: listed ones, else its range less a fifth at each end. */
export function singingRegister(instrument: InstrumentId): [number, number] {
  const listed = SINGING[instrument];
  if (listed) return listed;
  const [lo, hi] = INSTRUMENTS[instrument].range;
  return [lo + 7, hi - 7];
}

const outside = (p: number, [lo, hi]: [number, number]) => (p < lo ? lo - p : p > hi ? p - hi : 0);

/** Duration-weighted median pitch. */
function weightedMedian(notes: NoteEvent[]): number {
  const sorted = [...notes].sort((a, b) => a.pitchMidi - b.pitchMidi);
  const total = sorted.reduce((a, n) => a + Math.max(0, n.durationSeconds), 0);
  if (total <= 0) return sorted[sorted.length >> 1].pitchMidi;
  let acc = 0;
  for (const n of sorted) {
    acc += Math.max(0, n.durationSeconds);
    if (acc >= total / 2) return n.pitchMidi;
  }
  return sorted[sorted.length - 1].pitchMidi;
}

/** Add `semis` to the voiced frames of `midi` from `fromSec` (inclusive) to `toSec` (exclusive). */
function shiftFrames(midi: number[], fps: number, semis: number, fromSec = 0, toSec = Infinity) {
  const a = Math.max(0, Math.round(fromSec * fps));
  const b = Math.min(midi.length, toSec === Infinity ? midi.length : Math.round(toSec * fps));
  for (let f = a; f < b; f++) if (midi[f] > 0) midi[f] = Math.round((midi[f] + semis) * 100) / 100;
}

export interface Placement {
  notes: NoteEvent[];
  contour: PitchContour | null;
  /** Whole octaves the line was moved by (negative = down). Single notes moved to fit are not counted. */
  octaves: number;
}

/**
 * Move the line by the octave shift (−3…+3) that keeps notes on the
 * instrument, puts the middle of the line in the instrument's singing
 * register, and moves as little as possible; then move any note that still
 * does not fit by octaves on its own. Returns new notes and a new contour.
 */
export function placeInRegister(
  notes: NoteEvent[],
  contour: PitchContour | null,
  instrument: InstrumentId
): Placement {
  if (!notes.length) return { notes, contour, octaves: 0 };

  const range = INSTRUMENTS[instrument].range;
  const singing = singingRegister(instrument);
  const m = weightedMedian(notes);
  const totalDur = notes.reduce((a, n) => a + Math.max(0, n.durationSeconds), 0);

  const cost = (oct: number) => {
    let off = 0;
    for (const n of notes) off += Math.max(0, n.durationSeconds) * outside(n.pitchMidi + 12 * oct, range);
    return 10 * off + totalDur * outside(m + 12 * oct, singing) + 0.5 * totalDur * Math.abs(oct);
  };
  // smaller moves first, so a tie keeps the smaller move
  let oct = 0, best = cost(0);
  for (const o of [-1, 1, -2, 2, -3, 3]) {
    const c = cost(o);
    if (c < best) { best = c; oct = o; }
  }

  const shift = 12 * oct;
  const out: NoteEvent[] = notes.map((n) => {
    const { pitchBends, ...rest } = n;
    return { ...rest, pitchMidi: n.pitchMidi + shift, ...(pitchBends ? { pitchBends: [...pitchBends] } : {}) };
  });
  const curve: PitchContour | null = contour
    ? { fps: contour.fps, midi: [...contour.midi], level: [...contour.level] }
    : null;
  if (curve && shift) shiftFrames(curve.midi, curve.fps, shift);

  // anything still off the instrument moves by octaves on its own, its stretch of the curve with it
  const [lo, hi] = range;
  if (hi - lo >= 11) {
    for (const n of out) {
      let move = 0;
      while (n.pitchMidi + move < lo) move += 12;
      while (n.pitchMidi + move > hi) move -= 12;
      if (!move) continue;
      n.pitchMidi += move;
      if (curve) shiftFrames(curve.midi, curve.fps, move, n.startTimeSeconds, n.startTimeSeconds + n.durationSeconds);
    }
  }

  return { notes: out, contour: curve, octaves: oct };
}
