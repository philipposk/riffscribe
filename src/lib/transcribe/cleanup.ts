/**
 * Putting held notes back together.
 *
 * Basic Pitch infers extra onsets from swings in loudness, so a sung note held
 * through vibrato or a swell comes out as the same pitch started three times,
 * often with a short semitone-neighbour blip where the vibrato peaked. Written
 * out, that is three re-articulated notes the singer never sang.
 *
 * This is for a single line only (voice, bowed strings, winds, brass): in a
 * chord part two same-pitch notes back to back can be two real strikes.
 */
import type { NoteEvent } from "../types";

/** Same-pitch notes closer than this are one note that was re-triggered. */
const MERGE_GAP = 0.06;
/** A semitone neighbour shorter than this, inside a longer note, is a wobble. */
const BLIP = 0.09;

const endOf = (n: NoteEvent) => n.startTimeSeconds + n.durationSeconds;

export function consolidateMonophonic(notes: NoteEvent[]): NoteEvent[] {
  const sorted = [...notes].sort((a, b) => a.startTimeSeconds - b.startTimeSeconds || a.pitchMidi - b.pitchMidi);

  // 1. drop vibrato blips: a very short note a semitone from a longer one it
  //    touches or overlaps
  const kept = sorted.filter(
    (n) =>
      n.durationSeconds >= BLIP ||
      !sorted.some(
        (m) =>
          m !== n &&
          m.durationSeconds > n.durationSeconds &&
          Math.abs(m.pitchMidi - n.pitchMidi) === 1 &&
          m.startTimeSeconds - endOf(n) < MERGE_GAP &&
          n.startTimeSeconds - endOf(m) < MERGE_GAP
      )
  );

  // 2. join a note onto the previous one of the same pitch when it starts
  //    (nearly) as that one ends
  const out: NoteEvent[] = [];
  const lastOf = new Map<number, NoteEvent>();
  for (const n of kept) {
    const prev = lastOf.get(n.pitchMidi);
    if (prev && n.startTimeSeconds - endOf(prev) < MERGE_GAP) {
      prev.durationSeconds = Math.max(endOf(prev), endOf(n)) - prev.startTimeSeconds;
      prev.amplitude = Math.max(prev.amplitude, n.amplitude);
      if (prev.pitchBends || n.pitchBends) prev.pitchBends = [...(prev.pitchBends ?? []), ...(n.pitchBends ?? [])];
      continue;
    }
    const copy = { ...n };
    out.push(copy);
    lastOf.set(n.pitchMidi, copy);
  }
  return out;
}
