/** Notes → Standard MIDI File, straight from the un-quantized model output. */
import { Midi } from "@tonejs/midi";
import type { NoteEvent } from "../types";

export function notesToMidi(
  notes: NoteEvent[],
  opts: { bpm?: number; name?: string; program?: number } = {}
): Uint8Array {
  const midi = new Midi();
  midi.header.setTempo(opts.bpm ?? 120);
  midi.name = opts.name ?? "Riffscribe";
  const track = midi.addTrack();
  track.name = opts.name ?? "Transcription";
  if (opts.program != null) track.instrument.number = opts.program;
  for (const n of notes) {
    track.addNote({
      midi: n.pitchMidi,
      time: n.startTimeSeconds,
      duration: Math.max(0.02, n.durationSeconds),
      velocity: Math.max(0.05, Math.min(1, n.amplitude)),
    });
  }
  return midi.toArray();
}
