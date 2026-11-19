/**
 * Parts to an engraved score.
 *
 * Pulled out of the studio so that a shared chart engraves through exactly the
 * same path: the person opening a link must see the notes their sender saw,
 * not a second implementation that drifts away from it.
 */
import { keyToken, sheetsToAlphaTex } from "./alphatex";
import { fifthsFor } from "./spelling";
import { effectiveOffset, quantize, type Sheet } from "./quantize";
import { assignFrets } from "./tab";
import { INSTRUMENTS, type Instrument, type InstrumentId, type NoteEvent, type Part, type TranscriptionSettings } from "../types";

export interface PartSheet {
  part: Part;
  sheet: Sheet;
  instrument: Instrument;
  /** Key signature this staff is written in, once transposition is accounted for. */
  fifths: number;
  /** The clef this staff is written in: the instrument's own, or a higher one for a high line. */
  clef: Instrument["clef"];
}

const mod = (n: number, m: number) => ((n % m) + m) % m;

/**
 * The tonic a part was heard in.
 *
 * Charts saved before this existed carry only a name like "D minor", so fall
 * back to reading the letter rather than losing the key on an old file.
 */
function tonicOf(part: Part): number {
  if (typeof part.tonicPc === "number") return mod(part.tonicPc, 12);
  const letter = (part.keyName || "").trim().charAt(0).toUpperCase();
  const accidental = (part.keyName || "").charAt(1);
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let pc = base[letter] ?? 0;
  if (accidental === "#") pc += 1;
  if (accidental === "b") pc -= 1;
  return mod(pc, 12);
}

/**
 * How far this staff is written above what it sounds: what the player asked
 * for, plus whatever the instrument itself transposes by.
 */
export function writtenShift(settings: TranscriptionSettings, instrument: Instrument): number {
  return settings.transposeSemitones + (instrument.writtenSemitones ?? 0);
}

/**
 * Instruments that change clef for high passages, and where. Each entry is a
 * clef and the median written pitch it is used below; the last one has no
 * ceiling. A cellist reads tenor clef for the middle of the instrument and
 * treble above it — a sung melody given to the cello in bass clef is a stack
 * of ledger lines no cello part looks like.
 */
const CLEF_STEPS: Partial<Record<InstrumentId, { clef: Instrument["clef"]; below: number }[]>> = {
  cello: [
    { clef: "bass", below: 59 }, // up to about B3
    { clef: "tenor", below: 67 }, // up to about G4
    { clef: "treble", below: Infinity },
  ],
  trombone: [
    { clef: "bass", below: 62 },
    { clef: "tenor", below: Infinity },
  ],
};

export function clefFor(instrument: Instrument, notes: NoteEvent[], shift: number): Instrument["clef"] {
  const steps = CLEF_STEPS[instrument.id];
  if (!steps || !notes.length) return instrument.clef;
  const pitches = notes.map((n) => n.pitchMidi + shift).sort((a, b) => a - b);
  const mid = pitches.length >> 1;
  const median = pitches.length % 2 ? pitches[mid] : (pitches[mid - 1] + pitches[mid]) / 2;
  return steps.find((s) => median < s.below)?.clef ?? instrument.clef;
}

export function engraveParts(parts: Part[], settings: TranscriptionSettings): PartSheet[] {
  // One bar line for every staff: if any part starts before the offset, all of
  // them gain the same pickup bar, or the staves would be a bar apart.
  const offsetSeconds = effectiveOffset(parts.flatMap((p) => p.notes), settings);
  return parts.map((part) => {
    const instrument = INSTRUMENTS[part.instrument];
    const shift = writtenShift(settings, instrument);
    // The notes and the key signature have to move together. Shifting the
    // notes alone — which is what happened before — leaves the part written in
    // the old key, so every accidental fights the signature.
    const sheet = quantize(part.notes, {
      ...settings,
      offsetSeconds,
      instrument: part.instrument,
      transposeSemitones: shift,
    });
    if (instrument.tuning) {
      assignFrets(sheet, { tuning: instrument.tuning, maxFret: instrument.frets ?? 22, capo: settings.capo });
    }
    const fifths = fifthsFor(mod(tonicOf(part) + shift, 12), part.keyMode);
    return { part, sheet, instrument, fifths, clef: clefFor(instrument, part.notes, shift) };
  });
}

export function partsToTex(
  partSheets: PartSheet[],
  settings: TranscriptionSettings,
  title: string
): string {
  if (!partSheets.length) return "";
  return sheetsToAlphaTex(
    partSheets.map(({ part, sheet, instrument, fifths, clef }) => ({
      sheet,
      options: {
        instrument,
        clef,
        capo: settings.capo,
        keySignature: keyToken(fifths, part.keyMode),
        fifths,
        trackName: instrument.label,
      },
    })),
    { title, bpm: settings.bpm }
  );
}
