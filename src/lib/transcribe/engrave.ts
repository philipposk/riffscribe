/**
 * Parts to an engraved score.
 *
 * Pulled out of the studio so that a shared chart engraves through exactly the
 * same path: the person opening a link must see the notes their sender saw,
 * not a second implementation that drifts away from it.
 */
import { keyToken, sheetsToAlphaTex } from "./alphatex";
import { quantize, type Sheet } from "./quantize";
import { assignFrets } from "./tab";
import { INSTRUMENTS, type Instrument, type Part, type TranscriptionSettings } from "../types";

export interface PartSheet {
  part: Part;
  sheet: Sheet;
  instrument: Instrument;
}

export function engraveParts(parts: Part[], settings: TranscriptionSettings): PartSheet[] {
  return parts.map((part) => {
    const sheet = quantize(part.notes, { ...settings, instrument: part.instrument });
    const instrument = INSTRUMENTS[part.instrument];
    if (instrument.tuning) {
      assignFrets(sheet, { tuning: instrument.tuning, maxFret: instrument.frets ?? 22, capo: settings.capo });
    }
    return { part, sheet, instrument };
  });
}

export function partsToTex(
  partSheets: PartSheet[],
  settings: TranscriptionSettings,
  title: string
): string {
  if (!partSheets.length) return "";
  return sheetsToAlphaTex(
    partSheets.map(({ part, sheet, instrument }) => ({
      sheet,
      options: {
        instrument,
        capo: settings.capo,
        keySignature: keyToken(part.fifths, part.keyMode),
        trackName: instrument.label,
      },
    })),
    { title, bpm: settings.bpm }
  );
}
