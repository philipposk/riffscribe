#!/usr/bin/env node
/**
 * Checks the notes-to-score path on inputs whose right answer is known: the
 * single-line clean-up, quantising, clef choice and the MusicXML writer.
 *
 * Run with: node --experimental-strip-types scripts/verify-transcribe.mjs
 */
import { createRequire, registerHooks } from "node:module";
import * as alphaTab from "@coderline/alphatab";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !/\.[cm]?[jt]s$/.test(spec) && ctx.parentURL?.includes("/src/")) spec += ".ts";
    return next(spec, ctx);
  },
});

const load = (p) => import(p).catch((e) => { console.log(e.message); return null; });
const quantizeMod = await load("../src/lib/transcribe/quantize.ts");
const voices = await load("../src/lib/transcribe/voices.ts");
const cleanup = await load("../src/lib/transcribe/cleanup.ts");
const engrave = await load("../src/lib/transcribe/engrave.ts");
const xml = await load("../src/lib/transcribe/musicxml.ts");
const runner = await load("../src/lib/transcribe/runner.ts");
const types = await load("../src/lib/types.ts");
if (!quantizeMod || !voices || !cleanup || !engrave || !xml || !runner || !types) {
  console.log("run with: node --experimental-strip-types scripts/verify-transcribe.mjs");
  process.exit(1);
}
const { quantize, slotTimeline } = quantizeMod;
const { extractMelody } = voices;
const { consolidateMonophonic } = cleanup;
const { engraveParts, partsToTex } = engrave;
const { sheetToMusicXml } = xml;
const { DEFAULT_SETTINGS, INSTRUMENTS } = types;

let failed = 0;
const check = (label, ok, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail !== undefined ? `: ${detail}` : ""}`);
};
const note = (start, dur, midi, amp = 0.6) => ({ startTimeSeconds: start, durationSeconds: dur, pitchMidi: midi, amplitude: amp });
const S = { ...DEFAULT_SETTINGS, bpm: 120, offsetSeconds: 0, timeSignature: [4, 4], quantizeDivision: 16 };
const unitsIn = (sheet) => sheet.bars.map((b) => b.slots.reduce((s, x) => s + x.lengthUnits, 0));
const durOf = (slot, div) => (div / slot.value) * (slot.dots ? 1.5 : 1);

/* ----------------------------------------------------- an empty part */
{
  const a = quantize([], S);
  const b = quantize([], { ...S, timeSignature: [6, 8] });
  const aOk = unitsIn(a)[0] === a.unitsPerBar && a.bars[0].slots.reduce((s, x) => s + durOf(x, a.division), 0) === a.unitsPerBar;
  const bOk = unitsIn(b)[0] === b.unitsPerBar && b.bars[0].slots.reduce((s, x) => s + durOf(x, b.division), 0) === b.unitsPerBar;
  check("an empty 4/4 part is one full bar of rest", aOk && a.bars[0].slots[0].value === 1, a.bars[0].slots.map((x) => x.value).join(","));
  check("an empty 6/8 part fills its bar too", bOk, b.bars[0].slots.map((x) => `${x.value}${x.dots ? "." : ""}`).join(","));
}

/* ------------------------------------------------------ pickup notes */
{
  // bar 1's downbeat at 2.0s; a three-note pickup before it
  const pick = [note(1.2, 0.25, 60), note(1.5, 0.25, 62), note(1.8, 0.2, 64), note(2.0, 0.5, 65)];
  const sh = quantize(pick, { ...S, offsetSeconds: 2.0 });
  const starts = sh.bars.flatMap((b) => b.slots.filter((x) => x.notes.length && !x.notes[0].tied).map((x) => x.startUnits));
  const chord = sh.bars.flatMap((b) => b.slots).some((x) => x.notes.length > 1);
  const tl = slotTimeline(sh, 2.0);
  const onTime = tl.length && sh.bars.flatMap((b) => b.slots).every((x, i) => Math.abs(tl[i].start - (sh.offsetSeconds + x.startUnits * 0.125)) < 1e-9);
  check("pickup notes keep their own slots, no chord on beat 1", !chord && new Set(starts).size === 4, starts.join(","));
  check("the score starts a bar earlier to hold the pickup", sh.offsetSeconds === 0 && sh.bars.length === 2, sh.offsetSeconds);
  check("the play-along timeline follows the moved bar line", !!onTime && tl[0].start === 0);
  const plain = quantize([note(2.0, 0.5, 60)], { ...S, offsetSeconds: 2.0 });
  check("no pickup leaves the bar line where it was", plain.offsetSeconds === 2.0);
  // two parts: only one has a pickup, both must start on the same bar
  const ps = engraveParts(
    [
      { id: "a", source: "vocals", instrument: "voice", notes: pick, keyName: "C", keyMode: "major" },
      { id: "b", source: "bass", instrument: "bass", notes: [note(2.0, 1, 40)], keyName: "C", keyMode: "major" },
    ],
    { ...S, offsetSeconds: 2.0 }
  );
  check("every staff shares the pickup bar", ps[0].sheet.offsetSeconds === ps[1].sheet.offsetSeconds && ps[1].sheet.bars.length === 2,
    `${ps[0].sheet.offsetSeconds} / ${ps[1].sheet.offsetSeconds}`);
}

/* -------------------------------------------------- single-line melody */
{
  // a sung A3 with Basic Pitch's octave ghost on the same onset
  const sung = [note(0, 1, 57, 0.6), note(0, 1, 69, 0.25)];
  const m = extractMelody(sung);
  check("the octave ghost is dropped, the sung note kept", m.length === 1 && m[0].pitchMidi === 57, m.map((n) => n.pitchMidi).join(","));
  const twelfth = extractMelody([note(0, 1, 57, 0.6), note(0.05, 0.9, 76, 0.2)]);
  check("a ghost a twelfth up is dropped too", twelfth.length === 1 && twelfth[0].pitchMidi === 57);
  const held = extractMelody([note(0, 2, 60, 0.6), note(0.5, 0.2, 62, 0.3)]);
  check("a short weak blip does not cut a held note", held.length === 1 && held[0].durationSeconds === 2, held.map((n) => `${n.pitchMidi}/${n.durationSeconds}`).join(","));
  const legato = extractMelody([note(0, 0.55, 60), note(0.5, 0.5, 62), note(1, 0.5, 64)]);
  check("a legato line keeps every note, the overlap trimmed",
    legato.map((n) => n.pitchMidi).join(",") === "60,62,64" && Math.abs(legato[0].durationSeconds - 0.5) < 1e-9);
  const loud = extractMelody([note(0, 1, 60, 0.3), note(0, 1, 55, 0.8)]);
  check("on one onset the louder note wins, not the higher", loud.length === 1 && loud[0].pitchMidi === 55);

  const sh = quantize(sung, { ...S, monophonic: true });
  const first = sh.bars[0].slots[0].notes.map((n) => n.midi);
  check("the single-line sheet keeps the louder note", first.length === 1 && first[0] === 57, first.join(","));
  const sh2 = quantize([note(0, 2, 60, 0.6), note(0.5, 0.25, 62, 0.3)], { ...S, monophonic: true });
  const heldUnits = sh2.bars[0].slots.filter((x) => x.notes.some((n) => n.midi === 60)).reduce((s, x) => s + x.lengthUnits, 0);
  check("the single-line sheet does not cut a held note for a weak blip", heldUnits === 16, heldUnits);
}

/* --------------------------------------------- held notes in one piece */
{
  // vibrato re-triggers one held note three times, with a semitone blip inside
  const frag = [note(0, 0.33, 60, 0.5), note(0.35, 0.3, 60, 0.7), note(0.66, 0.05, 61, 0.2), note(0.7, 0.3, 60, 0.6)];
  const c = consolidateMonophonic(frag);
  check("a vibrato-split held note comes back as one note",
    c.length === 1 && c[0].pitchMidi === 60 && Math.abs(c[0].durationSeconds - 1) < 1e-9 && c[0].amplitude === 0.7,
    c.map((n) => `${n.pitchMidi}@${n.startTimeSeconds}/${n.durationSeconds.toFixed(2)}`).join(" "));
  const sung = [note(0, 0.4, 60), note(0.6, 0.4, 60)];
  check("a note sung twice with a real gap stays two notes", consolidateMonophonic(sung).length === 2);
  const chord = [note(0, 1, 60), note(0, 1, 64), note(0, 1, 67)];
  const cc = consolidateMonophonic(chord);
  check("a chord is left alone", cc.length === 3 && cc.map((n) => n.pitchMidi).join(",") === "60,64,67");
  check("the input is not changed", frag.length === 4 && frag[0].durationSeconds === 0.33);
}

/* ------------------------------------------------------------- clefs */
{
  const parts = (instrument, midis) => [{
    id: "p", source: "vocals", instrument, keyName: "C", keyMode: "major",
    notes: midis.map((m, i) => note(i * 0.5, 0.45, m)),
  }];
  const soprano = engraveParts(parts("cello", [64, 67, 72, 76, 79, 81, 76, 72]), S)[0];
  const tenor = engraveParts(parts("cello", [60, 62, 64, 65, 62, 60]), S)[0];
  const low = engraveParts(parts("cello", [36, 43, 48, 50, 55, 48]), S)[0];
  const violin = engraveParts(parts("violin", [40 + 24, 67, 72]), S)[0];
  check("a soprano line for cello is written in treble clef", soprano.clef === "treble", soprano.clef);
  check("a middle-register cello line is in tenor clef", tenor.clef === "tenor", tenor.clef);
  check("a low cello line stays in bass clef", low.clef === "bass", low.clef);
  check("a violin keeps its treble clef", violin.clef === "treble", violin.clef);

  const tex = partsToTex([soprano], S, "t");
  check("the alphaTex staff carries the chosen clef", /\\clef Treble/.test(tex));
  try {
    const imp = new alphaTab.importer.AlphaTexImporter();
    imp.initFromString(partsToTex([tenor], S, "t"), new alphaTab.Settings());
    const score = imp.readScore();
    const clef = score.tracks[0].staves[0].bars[0].clef;
    check("alphaTab reads the tenor clef", clef === alphaTab.model.Clef.C4, clef);
  } catch (e) {
    check("alphaTab reads the tenor clef", false, e.message);
  }
  const x = sheetToMusicXml(soprano.sheet, { instrument: soprano.instrument, fifths: soprano.fifths, clef: soprano.clef });
  check("the MusicXML carries the chosen clef", /<clef><sign>G<\/sign><line>2<\/line>/.test(x));
}

/* --------------------------------------------------------- MusicXML */
{
  const tied = quantize([note(1.5, 1.0, 60)], S); // crosses the bar line at 2.0s
  const x = sheetToMusicXml(tied, { instrument: INSTRUMENTS.cello });
  const bad = [...x.matchAll(/<note>(.*?)<\/note>/g)].some((m) => /<tie [^>]*>.*<duration>/.test(m[1]));
  check("<tie> comes after <duration>, as the schema wants", !bad && /<\/duration><tie type="start"\/>/.test(x));

  const tsx = sheetToMusicXml(tied, { instrument: INSTRUMENTS["tenor-sax"] });
  check("a tenor sax part says it sounds a major ninth down",
    /<transpose><diatonic>-1<\/diatonic><chromatic>-2<\/chromatic><octave-change>-1<\/octave-change><\/transpose>/.test(tsx));
  const cl = sheetToMusicXml(tied, { instrument: INSTRUMENTS.clarinet });
  check("a clarinet part says it sounds a tone down",
    /<transpose><diatonic>-1<\/diatonic><chromatic>-2<\/chromatic><\/transpose>/.test(cl));
  const alto = sheetToMusicXml(tied, { instrument: INSTRUMENTS["alto-sax"] });
  check("an alto sax part says it sounds a major sixth down", /<transpose><diatonic>-5<\/diatonic><chromatic>-9<\/chromatic><\/transpose>/.test(alto));
  check("a concert-pitch part has no <transpose>", !/<transpose>/.test(x));
  const order = tsx.match(/<attributes>(.*?)<\/attributes>/)[1].replace(/<(\w[\w-]*)[^>]*>.*?<\/\1>/g, "$1 ").trim();
  check("<transpose> follows <clef> in <attributes>", /clef transpose$/.test(order), order);
}

/* -------------------------------------------------- detection range */
{
  // the library's own note extraction, so the check is against its real bound arithmetic
  const toMidi = createRequire(import.meta.url)("@spotify/basic-pitch/cjs/toMidi.js");
  const { detectionLimits } = runner;
  const found = (midi, lo, hi) => {
    const frames = Array.from({ length: 40 }, () => new Array(88).fill(0));
    const onsets = Array.from({ length: 40 }, () => new Array(88).fill(0));
    for (let f = 2; f < 30; f++) frames[f][midi - 21] = 0.9;
    onsets[2][midi - 21] = 0.9;
    const { maxHz, minHz } = detectionLimits(lo, hi);
    return toMidi.outputToNotesPoly(frames, onsets, 0.5, 0.3, 5, true, maxHz, minHz, true).some((n) => n.pitchMidi === midi);
  };
  check("the range's top note is detected", found(84, 36, 84));
  check("a note above the range is not", !found(85, 36, 84));
  check("the range's bottom note is detected", found(36, 36, 84));
  check("a note below the range is not", !found(35, 36, 84));
}

process.exit(failed ? 1 : 0);
