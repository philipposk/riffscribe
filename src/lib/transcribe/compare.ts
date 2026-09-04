/**
 * Marking a take against the chart.
 *
 * Everything up to here tells a player what to play. This tells them whether
 * they played it — which note was flat, which entry was late, which bar keeps
 * falling apart. That is the difference between a transcription tool and
 * something you practise with.
 *
 * The take has already been stretched back to full tempo and slid to account
 * for the delay between the speakers and the microphone, so both sides are in
 * song time and can be compared directly.
 */
import type { NoteEvent } from "../types";

export type Verdict = "clean" | "flat" | "sharp" | "early" | "late" | "missed" | "extra";

export interface Judgement {
  verdict: Verdict;
  /** Where this sits in the song, for highlighting. */
  atSeconds: number;
  bar: number;
  /** What the chart asked for, absent when the player added a note. */
  expectedMidi?: number;
  /** What actually came out, absent when the note was missed. */
  playedMidi?: number;
  /** Signed: positive means sharp. */
  centsOff?: number;
  /** Signed: positive means late. */
  msOff?: number;
}

export interface BarScore {
  bar: number;
  notes: number;
  clean: number;
  /** 0..1. A bar with nothing written in it does not count against you. */
  accuracy: number;
}

export interface TakeReport {
  judgements: Judgement[];
  bars: BarScore[];
  clean: number;
  missed: number;
  extra: number;
  /** Off in pitch but in the right place. */
  outOfTune: number;
  /** In tune but in the wrong place. */
  outOfTime: number;
  accuracy: number;
  /** Signed mean timing error in ms — a steady sign means you rush or drag. */
  meanMsOff: number;
  /** The bars worth looping, worst first. */
  worstBars: BarScore[];
}

export interface CompareOptions {
  bpm: number;
  beatsPerBar: number;
  offsetSeconds: number;
  /** How far out of time a note may be and still count as that note. */
  windowMs?: number;
  /** Past this, a note is called late or early rather than clean. */
  timingToleranceMs?: number;
  /** Past this, a note is called flat or sharp. Half a semitone is 50 cents. */
  tuningToleranceCents?: number;
}

const DEFAULTS = { windowMs: 350, timingToleranceMs: 90, tuningToleranceCents: 45 };

/**
 * Pair each written note with the closest thing the player actually produced.
 *
 * Greedy nearest-match rather than a full alignment: a player working on four
 * bars is not reordering the music, they are hitting or missing what is in
 * front of them, and a simple pairing says exactly that without inventing
 * clever excuses for a wrong note.
 */
export function markTake(chart: NoteEvent[], played: NoteEvent[], opts: CompareOptions): TakeReport {
  const window = (opts.windowMs ?? DEFAULTS.windowMs) / 1000;
  const timeTol = (opts.timingToleranceMs ?? DEFAULTS.timingToleranceMs) / 1000;
  const centsTol = opts.tuningToleranceCents ?? DEFAULTS.tuningToleranceCents;

  const secondsPerBar = (60 / opts.bpm) * opts.beatsPerBar;
  const barOf = (t: number) => Math.max(0, Math.floor((t - opts.offsetSeconds) / secondsPerBar)) + 1;

  const expected = [...chart].sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
  const takes = [...played].sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
  const used = new Array(takes.length).fill(false);
  const judgements: Judgement[] = [];

  for (const want of expected) {
    let best = -1;
    let bestCost = Infinity;
    for (let i = 0; i < takes.length; i++) {
      if (used[i]) continue;
      const dt = takes[i].startTimeSeconds - want.startTimeSeconds;
      if (Math.abs(dt) > window) continue;
      const semis = Math.abs(takes[i].pitchMidi - want.pitchMidi);
      if (semis > 2) continue; // more than a tone away is a different note, not a flat one
      // Pitch matters more than timing: the right note late is closer to right
      // than the wrong note on the beat.
      const cost = semis * 2 + Math.abs(dt) / window;
      if (cost < bestCost) {
        bestCost = cost;
        best = i;
      }
    }

    if (best < 0) {
      judgements.push({
        verdict: "missed",
        atSeconds: want.startTimeSeconds,
        bar: barOf(want.startTimeSeconds),
        expectedMidi: want.pitchMidi,
      });
      continue;
    }

    used[best] = true;
    const got = takes[best];
    const dtMs = (got.startTimeSeconds - want.startTimeSeconds) * 1000;
    const cents = (got.pitchMidi - want.pitchMidi) * 100 + centsFromBend(got);

    let verdict: Verdict = "clean";
    if (Math.abs(cents) > centsTol) verdict = cents > 0 ? "sharp" : "flat";
    else if (Math.abs(dtMs) > timeTol * 1000) verdict = dtMs > 0 ? "late" : "early";

    judgements.push({
      verdict,
      atSeconds: want.startTimeSeconds,
      bar: barOf(want.startTimeSeconds),
      expectedMidi: want.pitchMidi,
      playedMidi: got.pitchMidi,
      centsOff: Math.round(cents),
      msOff: Math.round(dtMs),
    });
  }

  for (let i = 0; i < takes.length; i++) {
    if (used[i]) continue;
    judgements.push({
      verdict: "extra",
      atSeconds: takes[i].startTimeSeconds,
      bar: barOf(takes[i].startTimeSeconds),
      playedMidi: takes[i].pitchMidi,
    });
  }
  judgements.sort((a, b) => a.atSeconds - b.atSeconds);

  const byBar = new Map<number, { notes: number; clean: number }>();
  for (const j of judgements) {
    if (j.verdict === "extra") continue; // an extra note is noise, not a missed requirement
    const b = byBar.get(j.bar) ?? { notes: 0, clean: 0 };
    b.notes++;
    if (j.verdict === "clean") b.clean++;
    byBar.set(j.bar, b);
  }
  const bars: BarScore[] = [...byBar.entries()]
    .map(([bar, v]) => ({ bar, notes: v.notes, clean: v.clean, accuracy: v.notes ? v.clean / v.notes : 1 }))
    .sort((a, b) => a.bar - b.bar);

  const count = (v: Verdict) => judgements.filter((j) => j.verdict === v).length;
  const clean = count("clean");
  const timed = judgements.filter((j) => j.msOff !== undefined);
  const meanMsOff = timed.length ? timed.reduce((s, j) => s + (j.msOff ?? 0), 0) / timed.length : 0;

  return {
    judgements,
    bars,
    clean,
    missed: count("missed"),
    extra: count("extra"),
    outOfTune: count("flat") + count("sharp"),
    outOfTime: count("early") + count("late"),
    accuracy: expected.length ? clean / expected.length : 0,
    meanMsOff: Math.round(meanMsOff),
    // Only bars with something in them, and only ones that actually went wrong.
    worstBars: bars.filter((b) => b.notes >= 2 && b.accuracy < 0.8).sort((a, b) => a.accuracy - b.accuracy).slice(0, 4),
  };
}

/** Basic Pitch reports bends per frame in cents; the average says how flat you sat. */
function centsFromBend(n: NoteEvent): number {
  if (!n.pitchBends || !n.pitchBends.length) return 0;
  const mean = n.pitchBends.reduce((s, b) => s + b, 0) / n.pitchBends.length;
  // Bend units are model bins of a third of a semitone; scale to cents and clamp.
  return Math.max(-100, Math.min(100, (mean / 3) * 100));
}

/** The bars to loop, expressed in seconds so the transport can take them. */
export function barsToRange(bars: BarScore[], opts: CompareOptions): [number, number] | null {
  if (!bars.length) return null;
  const secondsPerBar = (60 / opts.bpm) * opts.beatsPerBar;
  const numbers = bars.map((b) => b.bar);
  const from = Math.min(...numbers);
  const to = Math.max(...numbers);
  return [opts.offsetSeconds + (from - 1) * secondsPerBar, opts.offsetSeconds + to * secondsPerBar];
}

export function summarise(r: TakeReport): string {
  if (!r.judgements.length) return "Nothing to compare — transcribe the part first.";
  const pct = Math.round(r.accuracy * 100);
  const bits = [`${pct}% clean`];
  if (r.missed) bits.push(`${r.missed} missed`);
  if (r.outOfTune) bits.push(`${r.outOfTune} out of tune`);
  if (r.outOfTime) bits.push(`${r.outOfTime} out of time`);
  if (r.extra) bits.push(`${r.extra} extra`);
  const drift = Math.abs(r.meanMsOff) >= 25 ? ` You are ${r.meanMsOff > 0 ? "dragging" : "rushing"} by about ${Math.abs(r.meanMsOff)} ms.` : "";
  return `${bits.join(" · ")}.${drift}`;
}
