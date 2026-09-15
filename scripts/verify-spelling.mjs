#!/usr/bin/env node
/**
 * Checks that notes are written the way a player expects to read them.
 *
 * Run with: node --experimental-strip-types scripts/verify-spelling.mjs
 */
const src = await import("../src/lib/transcribe/spelling.ts").catch(() => null);
if (!src) {
  console.log("run with: node --experimental-strip-types scripts/verify-spelling.mjs");
  process.exit(0);
}
const { spell, spellScientific, fifthsFor, keyName, shortestShift } = src;

let failed = 0;
const check = (label, got, want) => {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}: ${got}${ok ? "" : `  (expected ${want})`}`);
};

// The complaint that started this: flat keys were being written with sharps.
console.log("— flat keys read as flats —");
check("Eb in F minor",      spellScientific(63, fifthsFor(5, "minor")), "Eb4");
check("Bb in F minor",      spellScientific(70, fifthsFor(5, "minor")), "Bb4");
check("Ab in F minor",      spellScientific(68, fifthsFor(5, "minor")), "Ab4");
check("Eb in Bb major",     spellScientific(63, fifthsFor(10, "major")), "Eb4");
check("Db in Ab major",     spellScientific(61, fifthsFor(8, "major")), "Db4");

console.log("— sharp keys still read as sharps —");
check("F# in G major",      spellScientific(66, fifthsFor(7, "major")), "F#4");
check("C# in D major",      spellScientific(61, fifthsFor(2, "major")), "C#4");
check("G# in A major",      spellScientific(68, fifthsFor(9, "major")), "G#4");
check("D# in E major",      spellScientific(63, fifthsFor(4, "major")), "D#4");

console.log("— naturals are never given an accidental —");
for (const [midi, name] of [[60, "C4"], [62, "D4"], [64, "E4"], [65, "F4"], [67, "G4"], [69, "A4"], [71, "B4"]]) {
  check(`${name} in C major`, spellScientific(midi, 0), name);
}

console.log("— key signatures —");
check("C major",  fifthsFor(0, "major"), 0);
check("G major",  fifthsFor(7, "major"), 1);
check("F major",  fifthsFor(5, "major"), -1);
check("Eb major", fifthsFor(3, "major"), -3);
check("A minor",  fifthsFor(9, "minor"), 0);
check("D minor",  fifthsFor(2, "minor"), -1);
check("F minor",  fifthsFor(5, "minor"), -4);
check("C# minor", fifthsFor(1, "minor"), 4);

console.log("— keys are named the way they are written —");
check("Eb major named", keyName(3, "major"), "Eb major");
check("Bb major named", keyName(10, "major"), "Bb major");
check("F# major named", keyName(6, "major"), "F# major");
check("F minor named",  keyName(5, "minor"), "F minor");
check("C# minor named", keyName(1, "minor"), "C# minor");

console.log("— every spelling still sounds the right note —");
let mismatches = 0;
for (let fifths = -7; fifths <= 7; fifths++) {
  for (let midi = 21; midi <= 108; midi++) {
    const { step, alter, octave } = spell(midi, fifths);
    const natural = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[step];
    const sounded = (octave + 1) * 12 + natural + alter;
    if (sounded !== midi) {
      mismatches++;
      if (mismatches <= 3) console.log(`      ${step}${alter}${octave} for midi ${midi} (key ${fifths}) sounds ${sounded}`);
    }
    if (Math.abs(alter) > 1) {
      mismatches++;
      if (mismatches <= 3) console.log(`      double accidental for midi ${midi} in key ${fifths}`);
    }
  }
}
check("all 88 keys × 15 signatures round-trip with no double accidentals", mismatches, 0);

console.log("— transposing takes the shortest way —");
check("C to D is up a tone",        shortestShift(0, 2), 2);
check("C to Bb is down a tone",     shortestShift(0, 10), -2);
check("C to G is down a fourth",    shortestShift(0, 7), -5);
check("C to F is up a fourth",      shortestShift(0, 5), 5);
check("no move when already there", shortestShift(4, 4), 0);

process.exit(failed ? 1 : 0);
