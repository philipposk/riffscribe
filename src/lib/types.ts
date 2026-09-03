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
  | "voice"
  | "violin"
  | "viola"
  | "cello"
  | "double-bass"
  | "flute"
  | "clarinet"
  | "alto-sax"
  | "tenor-sax"
  | "trumpet"
  | "trombone";

/** How the guide instrument should sound when it plays your part back. */
export type Timbre = "bowed" | "plucked" | "struck" | "breath" | "reed" | "brass" | "voice";

export interface Instrument {
  id: InstrumentId;
  label: string;
  /** Open-string MIDI notes, high string first (alphaTab tuning order). */
  tuning?: number[];
  frets?: number;
  /** Clef used when there is no tablature staff. */
  clef: "treble" | "bass" | "alto" | "tenor" | "grand";
  /** Voice used by the guide playback synth. */
  timbre: Timbre;
  /** General MIDI program, for the MIDI export. */
  gm: number;
  /** Written pitch = sounding pitch + this (guitar/bass are transposing). */
  transposeOctaves: number;
  /** Sensible MIDI range for the transcriber to clamp to. */
  range: [number, number];
}

// tunings listed high→low, matching alphaTex `\tuning`
export const INSTRUMENTS: Record<InstrumentId, Instrument> = {
  guitar: {
    id: "guitar", label: "Guitar (6-string)", clef: "treble", transposeOctaves: 1, timbre: "plucked", gm: 25,
    tuning: [64, 59, 55, 50, 45, 40], frets: 24, range: [40, 88],
  },
  "guitar-7": {
    id: "guitar-7", label: "Guitar (7-string)", clef: "treble", transposeOctaves: 1, timbre: "plucked", gm: 25,
    tuning: [64, 59, 55, 50, 45, 40, 35], frets: 24, range: [35, 88],
  },
  bass: {
    id: "bass", label: "Bass (4-string)", clef: "bass", transposeOctaves: 1, timbre: "plucked", gm: 33,
    tuning: [43, 38, 33, 28], frets: 24, range: [28, 67],
  },
  "bass-5": {
    id: "bass-5", label: "Bass (5-string)", clef: "bass", transposeOctaves: 1, timbre: "plucked", gm: 33,
    tuning: [43, 38, 33, 28, 23], frets: 24, range: [23, 67],
  },
  ukulele: {
    id: "ukulele", label: "Ukulele", clef: "treble", transposeOctaves: 0, timbre: "plucked", gm: 24,
    tuning: [69, 64, 60, 67], frets: 18, range: [60, 88],
  },
  mandolin: {
    id: "mandolin", label: "Mandolin", clef: "treble", transposeOctaves: 0, timbre: "plucked", gm: 25,
    tuning: [76, 69, 62, 55], frets: 20, range: [55, 96],
  },
  banjo: {
    id: "banjo", label: "Banjo (5-string)", clef: "treble", transposeOctaves: 0, timbre: "plucked", gm: 105,
    tuning: [62, 59, 55, 50, 67], frets: 22, range: [50, 90],
  },
  piano: {
    id: "piano", label: "Piano / keys", clef: "grand", transposeOctaves: 0, timbre: "struck", gm: 0,
    range: [21, 108],
  },
  voice: {
    id: "voice", label: "Voice / melody", clef: "treble", transposeOctaves: 0, timbre: "voice", gm: 52,
    range: [36, 96],
  },

  // Bowed strings. Tuning is listed high string first, like the fretted ones,
  // but these have no tablature staff so it is only used for range checks.
  violin: {
    id: "violin", label: "Violin", clef: "treble", transposeOctaves: 0, timbre: "bowed", gm: 40,
    range: [55, 100],
  },
  viola: {
    id: "viola", label: "Viola", clef: "alto", transposeOctaves: 0, timbre: "bowed", gm: 41,
    range: [48, 91],
  },
  cello: {
    id: "cello", label: "Violoncello", clef: "bass", transposeOctaves: 0, timbre: "bowed", gm: 42,
    range: [36, 84],
  },
  "double-bass": {
    id: "double-bass", label: "Double bass", clef: "bass", transposeOctaves: 1, timbre: "bowed", gm: 43,
    range: [28, 67],
  },

  // Winds and brass. Ranges are written pitch for a concert-pitch part.
  flute: {
    id: "flute", label: "Flute", clef: "treble", transposeOctaves: 0, timbre: "breath", gm: 73,
    range: [59, 96],
  },
  clarinet: {
    id: "clarinet", label: "Clarinet", clef: "treble", transposeOctaves: 0, timbre: "reed", gm: 71,
    range: [50, 91],
  },
  "alto-sax": {
    id: "alto-sax", label: "Alto sax", clef: "treble", transposeOctaves: 0, timbre: "reed", gm: 65,
    range: [49, 84],
  },
  "tenor-sax": {
    id: "tenor-sax", label: "Tenor sax", clef: "treble", transposeOctaves: 0, timbre: "reed", gm: 66,
    range: [44, 79],
  },
  trumpet: {
    id: "trumpet", label: "Trumpet", clef: "treble", transposeOctaves: 0, timbre: "brass", gm: 56,
    range: [52, 84],
  },
  trombone: {
    id: "trombone", label: "Trombone", clef: "bass", transposeOctaves: 0, timbre: "brass", gm: 57,
    range: [40, 72],
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


/**
 * One written-out line. A song can hold several — the bass from one stem, the
 * harmony from another, or four voices arranged out of a single stem — and they
 * are engraved together as one score.
 */
export interface Part {
  id: string;
  /** Which stem it was heard in. */
  source: string;
  instrument: InstrumentId;
  notes: NoteEvent[];
  /** Key signature position on the circle of fifths, -7..7. */
  fifths: number;
  keyName: string;
  keyMode: "major" | "minor";
}
