/**
 * Splitting one polyphonic part into separate lines.
 *
 * Stem separation gives you "everything that is not drums, bass or voice" as a
 * single track — all the harmony instruments at once. Detecting notes in that
 * gives a chord soup, not four players. This walks the notes and hands each one
 * to a voice: the highest sounding note goes to voice 1, the next down to voice
 * 2, and so on, keeping a voice on the line it was already following so parts do
 * not swap places every chord.
 *
 * The honest framing: this is *arranging* the harmony for an ensemble, not
 * recovering the individual players from the recording. Nothing can do the
 * latter from a stereo mix.
 */
import type { NoteEvent } from "../types";

export interface VoiceSplit {
  index: number;
  notes: NoteEvent[];
}

const OVERLAP_TOLERANCE = 0.06;

export function splitVoices(notes: NoteEvent[], voiceCount: number): VoiceSplit[] {
  const voices: VoiceSplit[] = Array.from({ length: voiceCount }, (_, index) => ({ index, notes: [] }));
  if (!notes.length) return voices;

  const sorted = [...notes].sort(
    (a, b) => a.startTimeSeconds - b.startTimeSeconds || b.pitchMidi - a.pitchMidi
  );

  // group notes that begin at effectively the same moment
  const chords: NoteEvent[][] = [];
  for (const n of sorted) {
    const last = chords[chords.length - 1];
    if (last && Math.abs(n.startTimeSeconds - last[0].startTimeSeconds) <= OVERLAP_TOLERANCE) last.push(n);
    else chords.push([n]);
  }

  // what each voice played last, so a voice keeps following its own line
  const lastPitch = new Array<number | null>(voiceCount).fill(null);

  for (const chord of chords) {
    const byPitch = [...chord].sort((a, b) => b.pitchMidi - a.pitchMidi);

    if (byPitch.length >= voiceCount) {
      // enough notes to go round: top note to the top voice, straight down
      byPitch.slice(0, voiceCount).forEach((note, v) => {
        voices[v].notes.push(note);
        lastPitch[v] = note.pitchMidi;
      });
      // anything left over doubles into the nearest voice by pitch
      for (const extra of byPitch.slice(voiceCount)) {
        let best = voiceCount - 1;
        let bestGap = Infinity;
        for (let v = 0; v < voiceCount; v++) {
          const gap = Math.abs((lastPitch[v] ?? extra.pitchMidi) - extra.pitchMidi);
          if (gap < bestGap) { bestGap = gap; best = v; }
        }
        voices[best].notes.push(extra);
      }
      continue;
    }

    // fewer notes than voices: give each note to the voice whose line it
    // continues most naturally, so a voice does not jump octaves mid-phrase
    const taken = new Set<number>();
    for (const note of byPitch) {
      let best = -1;
      let bestGap = Infinity;
      for (let v = 0; v < voiceCount; v++) {
        if (taken.has(v)) continue;
        const gap = lastPitch[v] == null ? 24 + v : Math.abs(lastPitch[v]! - note.pitchMidi);
        if (gap < bestGap) { bestGap = gap; best = v; }
      }
      if (best < 0) best = voiceCount - 1;
      taken.add(best);
      voices[best].notes.push(note);
      lastPitch[best] = note.pitchMidi;
    }
  }

  for (const v of voices) v.notes.sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
  return voices;
}

/** Move a line into an instrument's range by whole octaves. */
export function fitToRange(notes: NoteEvent[], range: [number, number]): NoteEvent[] {
  if (!notes.length) return notes;
  const median = [...notes].sort((a, b) => a.pitchMidi - b.pitchMidi)[Math.floor(notes.length / 2)].pitchMidi;
  const centre = (range[0] + range[1]) / 2;
  const octaves = Math.round((centre - median) / 12);
  if (!octaves) return notes;
  return notes.map((n) => ({ ...n, pitchMidi: n.pitchMidi + octaves * 12 }));
}
