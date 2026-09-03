/**
 * Sheet → alphaTex, alphaTab's native text format.
 *
 * alphaTab renders standard notation and tablature from the same source and
 * gives us a playback cursor for free, so this is what drives the on-screen
 * score. MusicXML/MIDI exports are generated separately for other apps.
 */
import type { Instrument } from "../types";
import type { Sheet, SheetSlot } from "./quantize";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function midiToScientific(midi: number) {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

// alphaTex clef names: C3 is the alto clef, C4 the tenor clef.
const CLEF_TOKEN: Record<string, string> = {
  treble: "Treble",
  bass: "Bass",
  alto: "C3",
  tenor: "C4",
  grand: "Treble",
};

function escapeTex(s: string) {
  return s.replace(/"/g, "'");
}

function beatFor(slot: SheetSlot, stringed: boolean) {
  const dur = `${slot.value}${slot.dots ? "{d}" : ""}`;
  // on a fretted staff a note without a string/fret cannot be drawn — the
  // fretter already decided it is out of reach, so it becomes silence
  const usable = stringed ? slot.notes.filter((n) => n.string != null && n.fret != null) : slot.notes;
  if (!usable.length) return `r.${dur}`;

  const parts = usable.map((n) => {
    const tie = n.tied ? "{t}" : "";
    if (stringed) return `${n.fret}.${n.string}${tie}`;
    return `${midiToScientific(n.midi)}${tie}`;
  });
  return `(${parts.join(" ")}).${dur}`;
}

export interface TexOptions {
  title?: string;
  artist?: string;
  instrument: Instrument;
  capo?: number;
  /** e.g. "C" or "Aminor" */
  keySignature?: string;
  /** General MIDI program for playback. */
  midiProgram?: number;
  /** Staff name; defaults to the instrument's label. */
  trackName?: string;
}

/** One `\track` block — the staff header plus its bars. */
function trackBlock(sheet: Sheet, o: TexOptions, withMeta: boolean): string[] {
  const inst = o.instrument;
  const stringed = !!inst.tuning?.length;
  const lines: string[] = [];

  lines.push(`\\track "${escapeTex(o.trackName || inst.label)}"`);
  lines.push(`\\instrument ${o.midiProgram ?? inst.gm}`);
  if (stringed) {
    lines.push(`\\staff{score tabs}`);
    lines.push(`\\tuning (${inst.tuning!.map(midiToScientific).join(" ")})`);
    if (o.capo) lines.push(`\\capo ${o.capo}`);
  } else {
    lines.push(`\\staff{score}`);
    lines.push(inst.id === "piano" ? `\\tuning piano` : `\\tuning voice`);
    lines.push(`\\clef ${CLEF_TOKEN[inst.clef]}`);
  }

  const bars = sheet.bars.map((bar, i) => {
    const head: string[] = [];
    if (i === 0 && withMeta) {
      head.push(`\\ts ${sheet.timeSignature[0]} ${sheet.timeSignature[1]}`);
      if (o.keySignature) head.push(`\\ks ${o.keySignature}`);
    }
    const beats = bar.slots.map((s) => beatFor(s, stringed));
    if (!beats.length) beats.push(`r.${sheet.timeSignature[1]}`);
    return [...head, ...beats].join(" ");
  });

  lines.push(bars.join(" |\n"));
  return lines;
}

export interface ScoreOptions {
  title?: string;
  artist?: string;
  bpm: number;
}

/** A score with one staff per part, so an ensemble reads as one piece. */
export function sheetsToAlphaTex(
  parts: { sheet: Sheet; options: TexOptions }[],
  meta: ScoreOptions
): string {
  if (!parts.length) return "";
  const lines: string[] = [
    `\\title "${escapeTex(meta.title || "Riffscribe transcription")}"`,
  ];
  if (meta.artist) lines.push(`\\subtitle "${escapeTex(meta.artist)}"`);
  lines.push(`\\tempo ${Math.round(meta.bpm)}`);
  lines.push(".");
  for (const p of parts) lines.push(...trackBlock(p.sheet, p.options, true));
  return lines.join("\n");
}

/** Convenience for a single part. */
export function sheetToAlphaTex(sheet: Sheet, o: TexOptions): string {
  return sheetsToAlphaTex([{ sheet, options: o }], {
    title: o.title,
    artist: o.artist,
    bpm: sheet.bpm,
  });
}

// Real key-signature spellings, indexed by circle-of-fifths position -7..+7.
// Deriving the name from `fifths` avoids nonsense like "D# major".
const MAJOR_KEYS = ["Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#"];
const MINOR_KEYS = ["Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#", "G#", "D#", "A#"];

export function keyToken(fifths: number, mode: "major" | "minor") {
  const i = Math.max(0, Math.min(14, fifths + 7));
  return mode === "minor" ? `${MINOR_KEYS[i]}minor` : MAJOR_KEYS[i];
}
