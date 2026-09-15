/**
 * Parts to an engraved score.
 *
 * Pulled out of the studio so that a shared chart engraves through exactly the
 * same path: the person opening a link must see the notes their sender saw,
 * not a second implementation that drifts away from it.
 */
import { keyToken, sheetsToAlphaTex } from "./alphatex";
import { fifthsFor } from "./spelling";
import { quantize, type Sheet } from "./quantize";
import { assignFrets } from "./tab";
import { INSTRUMENTS, type Instrument, type Part, type TranscriptionSettings } from "../types";

export interface PartSheet {
  part: Part;
  sheet: Sheet;
  instrument: Instrument;
  /** Key signature this staff is written in, once transposition is accounted for. */
  fifths: number;
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

export function engraveParts(parts: Part[], settings: TranscriptionSettings): PartSheet[] {
  return parts.map((part) => {
    const instrument = INSTRUMENTS[part.instrument];
    const shift = writtenShift(settings, instrument);
    // The notes and the key signature have to move together. Shifting the
    // notes alone — which is what happened before — leaves the part written in
    // the old key, so every accidental fights the signature.
    const sheet = quantize(part.notes, {
      ...settings,
      instrument: part.instrument,
      transposeSemitones: shift,
    });
    if (instrument.tuning) {
      assignFrets(sheet, { tuning: instrument.tuning, maxFret: instrument.frets ?? 22, capo: settings.capo });
    }
    const fifths = fifthsFor(mod(tonicOf(part) + shift, 12), part.keyMode);
    return { part, sheet, instrument, fifths };
  });
}

export function partsToTex(
  partSheets: PartSheet[],
  settings: TranscriptionSettings,
  title: string
): string {
  if (!partSheets.length) return "";
  return sheetsToAlphaTex(
    partSheets.map(({ part, sheet, instrument, fifths }) => ({
      sheet,
      options: {
        instrument,
        capo: settings.capo,
        keySignature: keyToken(fifths, part.keyMode),
        fifths,
        trackName: instrument.label,
      },
    })),
    { title, bpm: settings.bpm }
  );
}
