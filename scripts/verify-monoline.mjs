#!/usr/bin/env node
/**
 * Checks the single-line clean-up (cleanMonoLine) and the octave placement
 * (placeInRegister) on hand-built inputs whose right answer is known. No model.
 *
 * Run with: node --experimental-strip-types scripts/verify-monoline.mjs
 */
import { registerHooks } from "node:module";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !/\.[cm]?[jt]s$/.test(spec) && ctx.parentURL?.includes("/src/")) spec += ".ts";
    return next(spec, ctx);
  },
});

const load = (p) => import(p).catch((e) => { console.log(e.message); return null; });
const mono = await load("../src/lib/transcribe/monoline.ts");
const reg = await load("../src/lib/transcribe/register.ts");
const types = await load("../src/lib/types.ts");
if (!mono || !reg || !types) {
  console.log("run with: node --experimental-strip-types scripts/verify-monoline.mjs");
  process.exit(1);
}
const { cleanMonoLine } = mono;
const { placeInRegister } = reg;
const { INSTRUMENTS } = types;

let failed = 0;
const check = (label, ok, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail !== undefined ? `: ${detail}` : ""}`);
};
const note = (start, dur, pitch, amp = 0.8, extra = {}) => ({ startTimeSeconds: start, durationSeconds: dur, pitchMidi: pitch, amplitude: amp, ...extra });
const show = (ns) => ns.map((n) => `${n.pitchMidi}@${n.startTimeSeconds.toFixed(2)}+${n.durationSeconds.toFixed(2)}`).join(" ");
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// 1. a held note chopped up by vibrato: 62/63/62/61 pieces of 0.15 s with 0.01 s gaps over 2 s
{
  const cycle = [62, 63, 62, 61];
  const pieces = [];
  for (let k = 0, t = 0; t + 0.15 <= 2.0 + 1e-9; k++, t += 0.16) pieces.push(note(t, 0.15, cycle[k % 4], 0.7, { pitchBends: [0, 1] }));
  const before = JSON.stringify(pieces);
  const out = cleanMonoLine(pieces);
  check("fragmented held note becomes one note", out.length === 1, show(out));
  check("  at the held pitch (62)", out[0]?.pitchMidi === 62, out[0]?.pitchMidi);
  check("  lasting at least 1.9 s", out[0]?.durationSeconds >= 1.9, out[0]?.durationSeconds.toFixed(3));
  check("  pitch bends dropped", out.every((n) => !("pitchBends" in n)));
  check("  input left untouched", JSON.stringify(pieces) === before);
}

// 2. same pitch: 0.05 s apart merges, 0.1 s apart does not
{
  const merged = cleanMonoLine([note(0, 0.5, 60, 0.8), note(0.55, 0.5, 60, 0.4)]);
  check("same pitch 0.05 s apart merges", merged.length === 1 && near(merged[0].durationSeconds, 1.05), show(merged));
  check("  amplitude is the duration-weighted mean", near(merged[0]?.amplitude ?? 0, 0.6), merged[0]?.amplitude);
  const apart = cleanMonoLine([note(0, 0.5, 60), note(0.6, 0.5, 60)]);
  check("same pitch 0.1 s apart stays two notes", apart.length === 2, show(apart));
}

// 3. a 0.05 s blip between two notes disappears and leaves no hole
{
  const out = cleanMonoLine([note(0, 0.5, 60), note(0.51, 0.05, 67), note(0.57, 0.5, 62)]);
  check("0.05 s blip removed", out.length === 2 && !out.some((n) => n.pitchMidi === 67), show(out));
  check("  previous note runs on to the next", near(out[0].startTimeSeconds + out[0].durationSeconds, 0.57), show(out));
  const lone = cleanMonoLine([note(0, 0.05, 60)]);
  check("a lone blip is removed too", lone.length === 0, show(lone));
}

// 4. an octave ghost (74 at 0.5 over 62 at 0.6) is not chosen under "strongest"
{
  const out = cleanMonoLine([note(0, 0.5, 62, 0.6), note(0.01, 0.5, 74, 0.5)]);
  check("octave ghost not chosen (strongest)", out.length === 1 && out[0].pitchMidi === 62, show(out));
  // even a slightly louder ghost loses to the real note once the ghost penalty applies
  const louder = cleanMonoLine([note(0, 0.5, 62, 0.6), note(0.01, 0.5, 74, 0.7)]);
  check("  louder ghost (0.7 over 0.6) still not chosen", louder[0]?.pitchMidi === 62, show(louder));
  const high = cleanMonoLine([note(0, 0.5, 62, 0.6), note(0.01, 0.5, 74, 0.5)], { strategy: "highest" });
  check("  'highest' takes the top note", high[0]?.pitchMidi === 74, show(high));
}

// 5. overlaps: a loud next note cuts the previous short; a quiet short one is dropped
{
  const cut = cleanMonoLine([note(0, 1.0, 60, 0.8), note(0.5, 0.5, 64, 0.7)]);
  check("overlap: previous ends where the next starts", cut.length === 2 && near(cut[0].durationSeconds, 0.5), show(cut));
  const dropped = cleanMonoLine([note(0, 1.0, 60, 0.8), note(0.5, 0.1, 64, 0.3)]);
  check("overlap: a quiet short note is dropped", dropped.length === 1 && near(dropped[0].durationSeconds, 1.0), show(dropped));
}

// 6. a real stepwise melody of 0.3 s notes comes back unchanged
{
  const melody = [60, 62, 64, 65, 67, 65, 64, 62, 60].map((p, k) => note(k * 0.3, 0.3, p, 0.8));
  const out = cleanMonoLine(melody);
  const same = out.length === melody.length && out.every((n, k) =>
    n.pitchMidi === melody[k].pitchMidi && near(n.startTimeSeconds, melody[k].startTimeSeconds) &&
    near(n.durationSeconds, melody[k].durationSeconds) && near(n.amplitude, melody[k].amplitude));
  check("stepwise melody of 0.3 s notes unchanged", same, show(out));
}

// 7. output is sorted with no overlaps, whatever comes in
{
  const messy = [];
  let s = 7;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let k = 0; k < 200; k++) messy.push(note(rnd() * 20, 0.02 + rnd() * 0.8, 48 + Math.floor(rnd() * 24), 0.2 + rnd() * 0.8));
  for (const strategy of ["strongest", "highest"]) {
    const out = cleanMonoLine(messy, { strategy });
    let ok = out.every((n) => n.durationSeconds > 0);
    for (let k = 1; k < out.length; k++) {
      if (out[k].startTimeSeconds < out[k - 1].startTimeSeconds) ok = false;
      if (out[k - 1].startTimeSeconds + out[k - 1].durationSeconds > out[k].startTimeSeconds + 1e-9) ok = false;
    }
    check(`random input (${strategy}): sorted, no overlaps`, ok, `${out.length} notes`);
  }
  check("empty input gives empty output", cleanMonoLine([]).length === 0);
}

// 8. re-pitching from the line's continuous pitch, and what it lets the clean-up join or drop
/** A 100 fps contour from a function of time (0 = unvoiced) over [0, seconds). */
const curve = (seconds, fn) => ({ fps: 100, midi: Array.from({ length: Math.round(seconds * 100) }, (_, j) => Math.round(fn(j / 100) * 100) / 100), level: [] });
{
  // a note labelled a semitone sharp: the singer sits at 57.1 throughout
  const flat57 = curve(1.2, (t) => (t < 1.0 ? 57.1 : 0));
  const out = cleanMonoLine([note(0, 1.0, 58)], { contour: flat57 });
  check("re-pitch: a 58 sung at 57.1 becomes 57", out.length === 1 && out[0].pitchMidi === 57, show(out));
  const far = cleanMonoLine([note(0, 1.0, 60)], { contour: flat57 });
  check("  never moved more than a semitone (60 over a 57 curve stays 60)", far[0]?.pitchMidi === 60, show(far));
  const deaf = cleanMonoLine([note(0, 1.0, 58)], { contour: curve(1.2, () => 0) });
  check("  an unvoiced contour leaves the model's pitch", deaf[0]?.pitchMidi === 58, show(deaf));
  // pitch bends, when there is no contour: one bin = a third of a semitone, one bin sharp of true
  const bent = cleanMonoLine([note(0, 0.5, 58, 0.8, { pitchBends: new Array(43).fill(-2) })]);
  check("re-pitch from bends: 58 bent two bins down (minus the one-bin bias) becomes 57", bent[0]?.pitchMidi === 57, show(bent));
  const level = cleanMonoLine([note(0, 0.5, 58, 0.8, { pitchBends: new Array(43).fill(1) })]);
  check("  bends of +1 bin (the bias alone) keep 58", level[0]?.pitchMidi === 58, show(level));
  const a = [note(0, 0.5, 58, 0.8, { pitchBends: new Array(43).fill(-2) }), note(0.6, 0.4, 60)];
  check("  deterministic", JSON.stringify(cleanMonoLine(a, { contour: flat57 })) === JSON.stringify(cleanMonoLine(a, { contour: flat57 })));
}
{
  // a held 57 that the model split, the second piece labelled 58, with a 0.07 s re-onset gap
  const held = curve(1.2, (t) => (t < 0.97 ? 57 + 0.3 * Math.sin(2 * Math.PI * 5.5 * t) : 0));
  const out = cleanMonoLine([note(0, 0.5, 57), note(0.57, 0.4, 58)], { contour: held });
  check("merge: a mislabelled second piece of a held note joins it", out.length === 1 && out[0].pitchMidi === 57 && near(out[0].durationSeconds, 0.97), show(out));
  const plain = cleanMonoLine([note(0, 0.5, 60), note(0.57, 0.5, 60)]);
  check("  same pitch 0.07 s apart merges (vibrato re-onset)", plain.length === 1, show(plain));
}
{
  // the crest of an 80-cent vibrato on a held 62, caught as a 0.12 s note at 63 before the next note
  const vib = curve(2.0, (t) => (t < 1.12 ? 62 + 0.8 * Math.sin(2 * Math.PI * 5.5 * t) : t < 1.6 ? 60 : 0));
  const notes = [note(0, 1.0, 62), note(1.0, 0.12, 63), note(1.12, 0.48, 60)];
  const out = cleanMonoLine(notes, { contour: curve(2.0, (t) => (t >= 1.0 && t < 1.12 ? 62.6 : vib.midi[Math.round(t * 100)] || 0)) });
  check("vibrato edge: a crest caught as its own note joins the held note", out.length === 2 && out[0].pitchMidi === 62 && near(out[0].durationSeconds, 1.12), show(out));
  const steady = curve(2.0, (t) => (t < 1.0 ? 62 : t < 1.12 ? 63 : t < 1.6 ? 60 : 0));
  const kept = cleanMonoLine(notes, { contour: steady });
  check("  a really sung 0.12 s note after a held note without vibrato stays", kept.length === 3 && kept[1].pitchMidi === 63, show(kept));
}
{
  // a 0.12 s note at 58 while the voice slides 57 -> 59
  const slide = curve(1.3, (t) => (t < 0.5 ? 57 : t < 0.62 ? 57 + (2 * (t - 0.5)) / 0.12 : t < 1.12 ? 59 : 0));
  const notes = [note(0, 0.5, 57), note(0.5, 0.12, 58), note(0.62, 0.5, 59)];
  const out = cleanMonoLine(notes, { contour: slide });
  check("glide: the passing note of a slide is dropped", out.length === 2 && out[0].pitchMidi === 57 && out[1].pitchMidi === 59, show(out));
  check("  and leaves no hole", out.length === 2 && near(out[0].startTimeSeconds + out[0].durationSeconds, 0.62), show(out));
  const sung = curve(1.3, (t) => (t < 0.5 ? 57 : t < 0.62 ? 58 : t < 1.12 ? 59 : 0));
  const run = cleanMonoLine(notes, { contour: sung });
  check("  a held 0.12 s passing note (a fast run) stays", run.length === 3 && run[1].pitchMidi === 58, show(run));
}

// 9. register placement
const [cLo, cHi] = INSTRUMENTS.cello.range;
const line = (pitches, dur = 0.5) => pitches.map((p, k) => note(k * dur, dur, p));
const contourFor = (notes) => {
  const end = Math.max(...notes.map((n) => n.startTimeSeconds + n.durationSeconds));
  const midi = new Array(Math.round(end * 100) + 10).fill(0);
  for (const n of notes) {
    for (let f = Math.round(n.startTimeSeconds * 100); f < Math.round((n.startTimeSeconds + n.durationSeconds) * 100); f++) midi[f] = n.pitchMidi + 0.25;
  }
  return { fps: 100, midi, level: midi.map((v) => (v ? 0.1 : 0)) };
};
{
  // a soprano tune, 57-76, mostly around A4-C5
  const female = line([69, 71, 72, 74, 76, 74, 72, 71, 72, 69, 67, 64, 62, 60, 57, 69, 72, 74, 72, 71]);
  const contour = contourFor(female);
  const before = JSON.stringify({ female, contour });
  const r = placeInRegister(female, contour, "cello");
  check("female line on cello moves down an octave", r.octaves === -1, r.octaves);
  check("  all notes inside the cello range", r.notes.every((n) => n.pitchMidi >= cLo && n.pitchMidi <= cHi), show(r.notes));
  check("  every note moved by the same octave", r.notes.every((n, k) => n.pitchMidi === female[k].pitchMidi - 12));
  const f = Math.round(female[4].startTimeSeconds * 100) + 5;
  check("  contour moves with the notes", near(r.contour.midi[f], female[4].pitchMidi - 12 + 0.25, 1e-6), `${r.contour.midi[f]}`);
  check("  unvoiced contour frames stay 0", r.contour.midi[r.contour.midi.length - 1] === 0);
  check("  level curve untouched", JSON.stringify(r.contour.level) === JSON.stringify(contour.level));
  check("  input left untouched", JSON.stringify({ female, contour }) === before);

  const male = line([43, 45, 48, 50, 52, 55, 57, 55, 53, 52, 50, 55, 59, 60, 62, 64, 67, 62, 55, 48]);
  const rm = placeInRegister(male, contourFor(male), "cello");
  check("male line (43-67) stays put on cello", rm.octaves === 0, rm.octaves);
  check("  notes unchanged", rm.notes.every((n, k) => n.pitchMidi === male[k].pitchMidi));

  // a single stray note off the instrument moves by itself, and its stretch of the curve with it
  const stray = line([60, 62, 64, 62, 34, 62, 60, 62]);
  const cs = contourFor(stray);
  const rs = placeInRegister(stray, cs, "cello");
  check("stray low note moved up into range alone", rs.octaves === 0 && rs.notes[4].pitchMidi === 46, `${rs.octaves} ${show(rs.notes)}`);
  const fs = Math.round(stray[4].startTimeSeconds * 100) + 3;
  const fo = Math.round(stray[3].startTimeSeconds * 100) + 3;
  check("  its contour stretch moved, its neighbour's did not", near(rs.contour.midi[fs], 46.25, 1e-6) && near(rs.contour.midi[fo], 62.25, 1e-6), `${rs.contour.midi[fs]} ${rs.contour.midi[fo]}`);

  const none = placeInRegister([], null, "cello");
  check("empty input: unchanged, octaves 0", none.notes.length === 0 && none.contour === null && none.octaves === 0);
  const noCurve = placeInRegister(female, null, "violin");
  check("works without a contour", noCurve.contour === null && noCurve.notes.length === female.length, noCurve.octaves);
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall monoline checks passed");
process.exit(failed ? 1 : 0);
