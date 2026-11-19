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
  /**
   * How far the part is written above the chart's sounding pitch. The player
   * reads and plays the written part, so the chart is moved by the same amount
   * before it is compared.
   */
  transposeSemitones?: number;
}

const DEFAULTS = { windowMs: 350, timingToleranceMs: 90, tuningToleranceCents: 45 };

/**
 * Pair each written note with the closest thing the player actually produced.
 *
 * Every plausible pairing is scored and the best ones are taken first, across
 * the whole take. Taking them note by note in time order instead lets one
 * skipped note hand its neighbour's played note to the note before it, and in
 * a fast run every note after that is then judged against the wrong one.
 */
export function markTake(chart: NoteEvent[], played: NoteEvent[], opts: CompareOptions): TakeReport {
  const window = (opts.windowMs ?? DEFAULTS.windowMs) / 1000;
  const timeTol = (opts.timingToleranceMs ?? DEFAULTS.timingToleranceMs) / 1000;
  const centsTol = opts.tuningToleranceCents ?? DEFAULTS.tuningToleranceCents;
  const shift = opts.transposeSemitones ?? 0;

  const secondsPerBar = (60 / opts.bpm) * opts.beatsPerBar;
  const barOf = (t: number) => Math.max(0, Math.floor((t - opts.offsetSeconds) / secondsPerBar)) + 1;

  const expected = [...chart]
    .map((n) => (shift ? { ...n, pitchMidi: n.pitchMidi + shift } : n))
    .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
  const takes = [...played].sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
  const used = new Array(takes.length).fill(false);
  const judgements: Judgement[] = [];

  const pairs: { e: number; p: number; cost: number; dt: number }[] = [];
  let lo = 0;
  for (let e = 0; e < expected.length; e++) {
    const want = expected[e];
    while (lo < takes.length && takes[lo].startTimeSeconds < want.startTimeSeconds - window) lo++;
    for (let i = lo; i < takes.length; i++) {
      const dt = takes[i].startTimeSeconds - want.startTimeSeconds;
      if (dt > window) break;
      const semis = Math.abs(takes[i].pitchMidi - want.pitchMidi);
      if (semis > 2) continue; // more than a tone away is a different note, not a flat one
      // Pitch matters more than timing: the right note late is closer to right
      // than the wrong note on the beat.
      pairs.push({ e, p: i, cost: semis * 2 + Math.abs(dt) / window, dt: Math.abs(dt) });
    }
  }
  pairs.sort((a, b) => a.cost - b.cost || a.dt - b.dt);
  const match = new Array<number>(expected.length).fill(-1);
  for (const { e, p } of pairs) {
    if (match[e] >= 0 || used[p]) continue;
    match[e] = p;
    used[p] = true;
  }

  for (let e = 0; e < expected.length; e++) {
    const want = expected[e];
    const best = match[e];
  if (best < 0) {
      judgements.push({
        verdict: "missed",
        atSeconds: want.startTimeSeconds,
        bar: barOf(want.startTimeSeconds),
        expectedMidi: want.pitchMidi,
      });
      continue;
    }

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

/**
 * Which of the weak bars to loop: the run of nearby bars around the worst one.
 *
 * The weakest bars are picked by score, not position, so they can sit far
 * apart. Looping from the first to the last of them would play everything in
 * between; this keeps the loop on one trouble spot. Bars up to one bar apart
 * count as the same spot.
 */
export function barsToLoop(bars: BarScore[]): number[] {
  if (!bars.length) return [];
  const worst = bars.reduce((w, b) => (b.accuracy < w.accuracy ? b : w)).bar;
  const numbers = [...new Set(bars.map((b) => b.bar))].sort((a, b) => a - b);
  let from = numbers.indexOf(worst);
  let to = from;
  while (from > 0 && numbers[from] - numbers[from - 1] <= 2) from--;
  while (to < numbers.length - 1 && numbers[to + 1] - numbers[to] <= 2) to++;
  return numbers.slice(from, to + 1);
}

/** The bars to loop, expressed in seconds so the transport can take them. */
export function barsToRange(bars: BarScore[], opts: CompareOptions): [number, number] | null {
  const numbers = barsToLoop(bars);
  if (!numbers.length) return null;
  const secondsPerBar = (60 / opts.bpm) * opts.beatsPerBar;
  const from = numbers[0];
  const to = numbers[numbers.length - 1];
  return [opts.offsetSeconds + (from - 1) * secondsPerBar, opts.offsetSeconds + to * secondsPerBar];
}

/**
 * The written notes a take could have played: those that start inside it.
 *
 * A take is recorded over a few bars of a long song. Marking it against the
 * whole chart calls every bar it never reached "missed", and those untouched
 * bars then come out as the weakest. A note on the take's first instant is
 * in — a take over a loop starts exactly on its downbeat — but one starting in
 * its last `tail` seconds is out, as there was no time left to play it.
 */
export function chartInWindow(notes: NoteEvent[], startSeconds: number, endSeconds: number, tail = 0.15): NoteEvent[] {
  return notes.filter((n) => n.startTimeSeconds >= startSeconds - 0.05 && n.startTimeSeconds <= endSeconds - tail);
}

/**
 * Where the recording sits in a take laid out on the full song.
 *
 * The take is padded with exact silence before and after it, so the first and
 * last non-zero samples bound what was recorded. Null for a silent buffer.
 */
export function takeSpan(left: Float32Array, right: Float32Array, sampleRate: number): [number, number] | null {
  const n = Math.max(left.length, right.length);
  const at = (i: number) => (left[i] ?? 0) !== 0 || (right[i] ?? 0) !== 0;
  let a = 0;
  while (a < n && !at(a)) a++;
  if (a === n) return null;
  let b = n - 1;
  while (b > a && !at(b)) b--;
  return [a / sampleRate, (b + 1) / sampleRate];
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
