/**
 * Reader for the vocadito set (CC BY 4.0, 40 short sung excerpts with note and pitch annotations).
 * Layout under `<RIFFSCRIBE_EVAL_DATA>/vocadito`: Audio/vocadito_N.wav, Annotations/Notes/vocadito_N_notesA1.csv
 * (start s, pitch Hz, duration s) and Annotations/F0/vocadito_N_f0.csv (time s, Hz; 0 = unvoiced).
 * Nothing from the set is ever copied into the repository.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const hzToMidi = (hz) => 69 + 12 * Math.log2(hz / 440);

const readCsv = (file) =>
  readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => l.split(",").map(Number));

export function vocaditoTracks(dataDir, limit = Infinity) {
  const root = path.join(dataDir, "vocadito");
  if (!existsSync(path.join(root, "Audio"))) return null;
  const tracks = [];
  for (let id = 1; id <= 40 && tracks.length < limit; id++) {
    const wav = path.join(root, "Audio", `vocadito_${id}.wav`);
    if (!existsSync(wav)) continue;
    const notes = (who) => {
      const f = path.join(root, "Annotations", "Notes", `vocadito_${id}_notes${who}.csv`);
      return existsSync(f)
        ? readCsv(f).map(([s, hz, d]) => ({ startTimeSeconds: s, durationSeconds: d, pitchMidi: hzToMidi(hz), amplitude: 0.8 }))
        : null;
    };
    tracks.push({ id, wav, notesA1: notes("A1"), notesA2: notes("A2") });
  }
  return tracks;
}
