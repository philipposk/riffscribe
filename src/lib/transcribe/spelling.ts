/**
 * How a note is written down.
 *
 * A pitch is a number; a *note* is a letter with an accidental, and which one
 * is correct depends on the key. The same sound is D sharp in E major and E
 * flat in F minor, and a player reading the wrong one has to stop and work it
 * out. Riffscribe used to spell everything with sharps, which made every flat
 * key — E flat, B flat, F minor, most of the string repertoire — read wrong.
 *
 * Spelling is chosen on the line of fifths: every letter-and-accidental sits at
 * a position, each position sounds a known pitch, and the right spelling for a
 * key is the candidate nearest that key's own position. That handles sharps,
 * flats and the awkward middle of the circle without a table of special cases.
 *
 *   … Fb  Cb  Gb  Db  Ab  Eb  Bb  F  C  G  D  A  E  B  F#  C#  G#  D#  A#  …
 *     -8  -7  -6  -5  -4  -3  -2 -1  0  1  2  3  4  5   6   7   8   9  10
 */

/** Letters in fifths order, starting at position -1 so that position 0 is C. */
const LETTERS = "FCGDAEB";

const mod = (n: number, m: number) => ((n % m) + m) % m;

export interface Spelled {
  /** A–G. */
  step: string;
  /** -2..2 — negative is flat, as MusicXML expects. */
  alter: number;
  octave: number;
}

/** The pitch class a line-of-fifths position sounds. */
const pitchClassAt = (pos: number) => mod(pos * 7, 12);

/**
 * Spell a MIDI note for a key.
 *
 * @param midi   sounding or written pitch, whichever is being engraved
 * @param fifths key signature position, -7..7 (negative = flats)
 */
export function spell(midi: number, fifths: number): Spelled {
  const pc = mod(midi, 12);

  // Candidates within a sensible window: far enough to reach Cb and B#,
  // never so far as to invent a double accidental.
  let best = 0;
  let bestCost = Infinity;
  for (let pos = -8; pos <= 10; pos++) {
    if (pitchClassAt(pos) !== pc) continue;
    // Distance from the key's own position on the line. Ties go to the
    // sharper spelling, which matches what people write in C major.
    const cost = Math.abs(pos - fifths) * 2 + (pos < 0 ? 1 : 0);
    if (cost < bestCost) {
      bestCost = cost;
      best = pos;
    }
  }

  const step = LETTERS[mod(best + 1, 7)];
  const alter = Math.floor((best + 1) / 7);

  // The octave number follows the *letter*, not the pitch: B#3 sounds the same
  // as C4 but is written in octave 3, and Cb4 sounds as B3 but is written 4.
  const naturalPc = [0, 2, 4, 5, 7, 9, 11]["CDEFGAB".indexOf(step)];
  let octave = Math.floor(midi / 12) - 1;
  const sounded = mod(naturalPc + alter, 12);
  if (sounded !== pc) {
    // shouldn't happen, but never return a contradiction
    octave = Math.floor(midi / 12) - 1;
  } else if (naturalPc + alter > 11) {
    octave -= 1; // e.g. B# written below the C it sounds with
  } else if (naturalPc + alter < 0) {
    octave += 1; // e.g. Cb written above the B it sounds with
  }

  return { step, alter, octave };
}

/** "Eb4", "F#3" — the form alphaTex wants. */
export function spellScientific(midi: number, fifths: number): string {
  const { step, alter, octave } = spell(midi, fifths);
  const mark = alter > 0 ? "#".repeat(alter) : alter < 0 ? "b".repeat(-alter) : "";
  return `${step}${mark}${octave}`;
}

/* ------------------------------------------------------------------ keys */

/** Fifths for each major tonic, C = 0. */
const MAJOR_FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];

/** The key signature for a tonic pitch class and mode. */
export function fifthsFor(tonicPc: number, mode: "major" | "minor"): number {
  // A minor key carries the signature of the major a minor third above it.
  const relativeMajor = mode === "major" ? mod(tonicPc, 12) : mod(tonicPc + 3, 12);
  return MAJOR_FIFTHS[relativeMajor];
}

/** How a key is named, spelled the way that key is actually written. */
export function keyName(tonicPc: number, mode: "major" | "minor"): string {
  const fifths = fifthsFor(tonicPc, mode);
  const { step, alter } = spell(60 + mod(tonicPc, 12), fifths);
  const mark = alter > 0 ? "#".repeat(alter) : alter < 0 ? "b".repeat(-alter) : "";
  return `${step}${mark} ${mode}`;
}

/**
 * Every key a player might reasonably ask for, in circle-of-fifths order so the
 * list reads the way a musician thinks rather than chromatically.
 */
export function keyChoices(mode: "major" | "minor"): { tonicPc: number; label: string }[] {
  const order = mode === "major"
    ? [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5]
    : [9, 4, 11, 6, 1, 8, 3, 10, 5, 0, 7, 2];
  return order.map((pc) => ({ tonicPc: pc, label: keyName(pc, mode) }));
}

/**
 * The smallest transposition that lands on a target tonic.
 *
 * Down a fourth beats up a fifth: it is the same key and easier to play, and a
 * part that jumps an octave for no reason is a part nobody trusts.
 */
export function shortestShift(fromPc: number, toPc: number): number {
  const up = mod(toPc - fromPc, 12);
  return up > 6 ? up - 12 : up;
}
