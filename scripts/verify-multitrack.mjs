import * as alphaTab from "@coderline/alphatab";
const tex = `\\title "Quartet test"
\\tempo 96
.
\\track "Violin"
\\instrument 40
\\staff{score}
\\tuning voice
\\clef Treble
\\ts 4 4 \\ks C (A4).4 (B4).4 (C5).2 |
(D5).2 (B4).2
\\track "Violoncello"
\\instrument 42
\\staff{score}
\\tuning voice
\\clef Bass
\\ts 4 4 \\ks C (C3).4 (E3).4 (G3).2 |
(F3).2 (G2).2`;
const importer = new alphaTab.importer.AlphaTexImporter();
importer.initFromString(tex, new alphaTab.Settings());
const score = importer.readScore();
console.log("tracks:", score.tracks.length);
for (const t of score.tracks) {
  const st = t.staves[0];
  let beats = 0, notes = 0;
  for (const bar of st.bars) for (const v of bar.voices) { beats += v.beats.length; for (const b of v.beats) notes += b.notes.length; }
  console.log(` - ${t.name}: bars=${st.bars.length} beats=${beats} notes=${notes} program=${t.playbackInfo.program}`);
}
