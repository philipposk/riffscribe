/**
 * Raw model notes → readable rhythm.
 *
 * The model gives note start/stop in seconds, which is unreadable as sheet
 * music. Here we snap everything to a musical grid (16ths by default), merge
 * notes that start together into chords, fill the gaps with rests, cut
 * everything at bar lines, and express each duration as real note values
 * (quarter, dotted eighth, …) tied together when needed.
 */
import type { NoteEvent, TranscriptionSettings } from "../types";

export interface SheetNote {
  midi: number;
  /** True when this note is the continuation of a tie from the previous slot. */
  tied: boolean;
  /** Filled in later by the tab fretter. */
  string?: number;
  fret?: number;
}

export interface SheetSlot {
  /** 1, 2, 4, 8, 16, 32 — a whole note is 1. */
  value: number;
  dots: 0 | 1;
  notes: SheetNote[]; // empty = rest
  /** Position from the start of the piece, in grid units. */
  startUnits: number;
  lengthUnits: number;
}

export interface SheetBar {
  index: number;
  slots: SheetSlot[];
}

export interface Sheet {
  bars: SheetBar[];
  bpm: number;
  timeSignature: [number, number];
  unitsPerBar: number;
  /** Units per whole note (= quantize division). */
  division: number;
}

/** Durations expressible as one notehead, in grid units, largest first. */
function representable(division: number) {
  const out: { units: number; value: number; dots: 0 | 1 }[] = [];
  for (const value of [1, 2, 4, 8, 16, 32]) {
    const base = division / value;
    if (!Number.isInteger(base) || base < 1) continue;
    out.push({ units: base, value, dots: 0 });
    if (base * 1.5 >= 1 && Number.isInteger(base * 1.5)) {
      out.push({ units: base * 1.5, value, dots: 1 });
    }
  }
  return out.sort((a, b) => b.units - a.units);
}

/** Split `units` into the fewest tied note values. */
function decompose(units: number, table: ReturnType<typeof representable>) {
  const parts: { value: number; dots: 0 | 1; units: number }[] = [];
  let left = units;
  let guard = 0;
  while (left > 0 && guard++ < 64) {
    const pick = table.find((t) => t.units <= left);
    if (!pick) break;
    parts.push(pick);
    left -= pick.units;
  }
  return parts;
}

export function quantize(notes: NoteEvent[], s: TranscriptionSettings): Sheet {
  const division = s.quantizeDivision || 16;
  const [beatsPerBar, beatValue] = s.timeSignature;
  const unitsPerBeat = division / beatValue;
  const unitsPerBar = Math.round(beatsPerBar * unitsPerBeat);
  const secondsPerBeat = 60 / s.bpm;
  const secondsPerUnit = secondsPerBeat / unitsPerBeat;
  const table = representable(division);

  // 1. snap to the grid
  type Ev = { start: number; end: number; midi: number };
  let events: Ev[] = notes.map((n) => {
    const start = Math.max(0, Math.round((n.startTimeSeconds - s.offsetSeconds) / secondsPerUnit));
    const end = Math.max(start + 1, Math.round((n.startTimeSeconds - s.offsetSeconds + n.durationSeconds) / secondsPerUnit));
    return { start, end, midi: n.pitchMidi + s.transposeSemitones };
  });

  if (s.monophonic) {
    // keep the top line only — one note at a time, later notes cut earlier ones
    events.sort((a, b) => a.start - b.start || b.midi - a.midi);
    const mono: Ev[] = [];
    for (const e of events) {
      const prev = mono[mono.length - 1];
      if (prev && e.start === prev.start) continue; // already have the higher note
      if (prev && e.start < prev.end) prev.end = e.start;
      if (!prev || e.end > e.start) mono.push(e);
    }
    events = mono.filter((e) => e.end > e.start);
  }

  if (events.length === 0) {
    return { bars: [{ index: 0, slots: [{ value: beatValue, dots: 0, notes: [], startUnits: 0, lengthUnits: unitsPerBar }] }], bpm: s.bpm, timeSignature: s.timeSignature, unitsPerBar, division };
  }

  // 2. build slot boundaries wherever anything starts or stops, plus bar lines
  const totalUnits = Math.ceil(Math.max(...events.map((e) => e.end)) / unitsPerBar) * unitsPerBar;
  const boundaries = new Set<number>([0, totalUnits]);
  for (const e of events) { boundaries.add(e.start); boundaries.add(e.end); }
  for (let u = 0; u <= totalUnits; u += unitsPerBar) boundaries.add(u);
  const points = [...boundaries].filter((u) => u >= 0 && u <= totalUnits).sort((a, b) => a - b);

  // 3. one slot per gap between boundaries, carrying whatever sounds there
  const raw: { start: number; length: number; notes: SheetNote[] }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const length = points[i + 1] - start;
    if (length <= 0) continue;
    const sounding = events.filter((e) => e.start <= start && e.end > start);
    raw.push({
      start,
      length,
      notes: sounding
        .sort((a, b) => a.midi - b.midi)
        .map((e) => ({ midi: e.midi, tied: e.start < start })),
    });
  }

  // 4. break every slot into real note values, split at bar lines
  const bars: SheetBar[] = [];
  for (const slot of raw) {
    let cursor = slot.start;
    let remaining = slot.length;
    let first = true;
    while (remaining > 0) {
      const barIndex = Math.floor(cursor / unitsPerBar);
      const barEnd = (barIndex + 1) * unitsPerBar;
      const chunk = Math.min(remaining, barEnd - cursor);
      for (const part of decompose(chunk, table)) {
        while (bars.length <= barIndex) bars.push({ index: bars.length, slots: [] });
        bars[barIndex].slots.push({
          value: part.value,
          dots: part.dots,
          startUnits: cursor,
          lengthUnits: part.units,
          notes: slot.notes.map((n) => ({ ...n, tied: n.tied || !first })),
        });
        cursor += part.units;
        first = false;
      }
      remaining -= chunk;
    }
  }

  return { bars, bpm: s.bpm, timeSignature: s.timeSignature, unitsPerBar, division };
}
