#!/usr/bin/env node
/**
 * Sanity-checks the alphaTex we generate by parsing it with alphaTab itself.
 * Run with `node scripts/verify-tex.mjs` after changing the tex writer.
 */
import * as alphaTab from "@coderline/alphatab";

const cases = {
  "stringed, chords + ties + dots + rests": `\\title "Test"
\\tempo 96
.
\\track "Guitar"
\\instrument 25
\\staff{score tabs}
\\tuning (E4 B3 G3 D3 A2 E2)
\\capo 2
\\ts 4 4 \\ks C (3.5).4 (0.6 2.5 2.4).8 r.8 (5.4{t}).4 |
(7.3).4{d} (0.1).8 r.2`,

  "pitched (no strings)": `\\title "Test2"
\\tempo 120
.
\\track "Voice"
\\instrument 52
\\staff{score}
\\tuning voice
\\clef Treble
\\ts 3 4 \\ks Aminor (A4).4 (C5 E5).4 r.4 |
(G4{t}).2 (F4).4`,
};

let failed = 0;
for (const [name, tex] of Object.entries(cases)) {
  try {
    const importer = new alphaTab.importer.AlphaTexImporter();
    importer.initFromString(tex, new alphaTab.Settings());
    const score = importer.readScore();
    const track = score.tracks[0];
    const staff = track.staves[0];
    const bars = staff.bars.length;
    let beats = 0;
    let notes = 0;
    for (const bar of staff.bars) {
      for (const voice of bar.voices) {
        beats += voice.beats.length;
        for (const beat of voice.beats) notes += beat.notes.length;
      }
    }
    console.log(
      `PASS  ${name}\n      bars=${bars} beats=${beats} notes=${notes} ` +
        `tuning=${staff.stringTuning?.tunings?.join(",") || "none"} ` +
        `tabs=${staff.showTablature} score=${staff.showStandardNotation} ` +
        `tempo=${score.tempo}`
    );
  } catch (e) {
    failed++;
    console.error(`FAIL  ${name}\n      ${e?.message ?? e}`);
  }
}
process.exit(failed ? 1 : 0);
