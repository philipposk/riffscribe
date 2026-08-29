export interface NoteEvent {
  startTimeSeconds: number;
  durationSeconds: number;
  pitchMidi: number;
  amplitude: number;
  pitchBends?: number[];
}

export type StemName = "vocals" | "drums" | "bass" | "other";
export const STEM_NAMES: StemName[] = ["vocals", "drums", "bass", "other"];

export interface Stem {
  name: StemName | "instrumental" | "original" | "overdub";
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
}

export type InstrumentId =
  | "guitar"
  | "guitar-7"
  | "bass"
  | "bass-5"
  | "ukulele"
  | "mandolin"
  | "banjo"
  | "piano"
  | "voice";

export interface Instrument {
  id: InstrumentId;
  label: string;
  /** Open-string MIDI notes, high string first (alphaTab tuning order). */
  tuning?: number[];
  frets?: number;
  /** Clef used when there is no tablature staff. */
  clef: "treble" | "bass" | "grand";
  /** Written pitch = sounding pitch + this (guitar/bass are transposing). */
  transposeOctaves: number;
  /** Sensible MIDI range for the transcriber to clamp to. */
  range: [number, number];
}

// tunings listed high→low, matching alphaTex `\tuning`
export const INSTRUMENTS: Record<InstrumentId, Instrument> = {
  guitar: {
    id: "guitar", label: "Guitar (6-string)", clef: "treble", transposeOctaves: 1,
    tuning: [64, 59, 55, 50, 45, 40], frets: 24, range: [40, 88],
  },
  "guitar-7": {
    id: "guitar-7", label: "Guitar (7-string)", clef: "treble", transposeOctaves: 1,
    tuning: [64, 59, 55, 50, 45, 40, 35], frets: 24, range: [35, 88],
  },
  bass: {
    id: "bass", label: "Bass (4-string)", clef: "bass", transposeOctaves: 1,
    tuning: [43, 38, 33, 28], frets: 24, range: [28, 67],
  },
  "bass-5": {
    id: "bass-5", label: "Bass (5-string)", clef: "bass", transposeOctaves: 1,
    tuning: [43, 38, 33, 28, 23], frets: 24, range: [23, 67],
  },
  ukulele: {
    id: "ukulele", label: "Ukulele", clef: "treble", transposeOctaves: 0,
    tuning: [69, 64, 60, 67], frets: 18, range: [60, 88],
  },
  mandolin: {
    id: "mandolin", label: "Mandolin", clef: "treble", transposeOctaves: 0,
    tuning: [76, 69, 62, 55], frets: 20, range: [55, 96],
  },
  banjo: {
    id: "banjo", label: "Banjo (5-string)", clef: "treble", transposeOctaves: 0,
    tuning: [62, 59, 55, 50, 67], frets: 22, range: [50, 90],
  },
  piano: {
    id: "piano", label: "Piano / keys", clef: "grand", transposeOctaves: 0,
    range: [21, 108],
  },
  voice: {
    id: "voice", label: "Voice / melody", clef: "treble", transposeOctaves: 0,
    range: [36, 96],
  },
};

export interface TranscriptionSettings {
  instrument: InstrumentId;
  /** Basic Pitch note-onset sensitivity, 0..1 (lower = more notes). */
  onsetThreshold: number;
  /** Basic Pitch frame/sustain threshold, 0..1. */
  frameThreshold: number;
  /** Reject notes shorter than this many model frames. */
  minNoteLength: number;
  /** Collapse simultaneous notes to the highest one (melody / single line). */
  monophonic: boolean;
  /** Snap to this note grid: 4 = quarter, 8 = eighth, 16 = sixteenth. */
  quantizeDivision: 4 | 8 | 16 | 32 | 0;
  bpm: number;
  offsetSeconds: number;
  timeSignature: [number, number];
  capo: number;
  transposeSemitones: number;
}

export const DEFAULT_SETTINGS: TranscriptionSettings = {
  instrument: "guitar",
  onsetThreshold: 0.5,
  frameThreshold: 0.3,
  minNoteLength: 11,
  monophonic: false,
  quantizeDivision: 16,
  bpm: 120,
  offsetSeconds: 0,
  timeSignature: [4, 4],
  capo: 0,
  transposeSemitones: 0,
};
