/**
 * Fretting: decide which string + fret each note is played on.
 *
 * The same pitch can sit on up to four different strings, so a naive choice
 * gives tablature that leaps all over the neck. We score every plausible hand
 * position per chord (how far the fingers stretch, how much the hand had to
 * move since the last chord, how low on the neck it sits) and then pick the
 * cheapest path through the whole song with dynamic programming.
 */
import type { Sheet, SheetSlot } from "./quantize";

export interface FretOptions {
  /** Open-string MIDI notes, string 1 (highest) first. */
  tuning: number[];
  maxFret: number;
  capo: number;
}

interface Placement { string: number; fret: number }

/**
 * Best placement of one chord assuming the hand sits around `anchor`.
 * Returns one entry per note in descending-pitch order; `null` means that
 * pitch cannot be reached on this instrument (too low, or above the last fret)
 * and it gets dropped from the tab rather than faking a position.
 */
function placeChord(midis: number[], anchor: number, o: FretOptions) {
  const used = new Set<number>();
  const out: (Placement | null)[] = [];
  let cost = 0;
  let placed = 0;

  // highest notes get the thin strings first — that is how people actually play
  const sorted = [...midis].sort((a, b) => b - a);
  for (const midi of sorted) {
    let best: { p: Placement; c: number } | null = null;
    for (let s = 0; s < o.tuning.length; s++) {
      if (used.has(s)) continue;
      const fret = midi - (o.tuning[s] + o.capo);
      if (fret < 0 || fret > o.maxFret) continue;
      // open strings are free; otherwise pay for stretching away from the anchor
      const stretch = fret === 0 ? 0 : Math.abs(fret - anchor);
      const c = stretch * 1.0 + (fret === 0 ? -0.4 : 0) + fret * 0.02;
      if (!best || c < best.c) best = { p: { string: s + 1, fret }, c };
    }
    if (!best) {
      out.push(null);
      cost += 6; // prefer positions where nothing has to be dropped
      continue;
    }
    used.add(best.p.string - 1);
    out.push(best.p);
    placed++;
    cost += best.c;
  }

  if (placed === 0) return null;

  const fretted = out.filter((p): p is Placement => !!p && p.fret > 0).map((p) => p.fret);
  if (fretted.length > 1) {
    const spread = Math.max(...fretted) - Math.min(...fretted);
    cost += spread > 4 ? (spread - 4) * 3 : 0; // hands do not stretch past ~5 frets
  }
  return { placements: out, cost };
}

export function assignFrets(sheet: Sheet, o: FretOptions) {
  const anchors: number[] = [];
  for (let a = 0; a <= Math.min(o.maxFret, 17); a++) anchors.push(a);

  const slots: SheetSlot[] = [];
  for (const bar of sheet.bars) for (const s of bar.slots) if (s.notes.length) slots.push(s);
  if (!slots.length) return { unplayable: 0 };

  // per-slot cost of each anchor position
  const table = slots.map((slot) =>
    anchors.map((a) => placeChord(slot.notes.map((n) => n.midi), a, o))
  );

  const n = slots.length;
  const A = anchors.length;
  const INF = 1e9;
  const dp: number[][] = Array.from({ length: n }, () => new Array(A).fill(INF));
  const back: number[][] = Array.from({ length: n }, () => new Array(A).fill(0));

  for (let a = 0; a < A; a++) dp[0][a] = table[0][a]?.cost ?? INF;
  for (let i = 1; i < n; i++) {
    for (let a = 0; a < A; a++) {
      const here = table[i][a];
      if (!here) continue;
      let best = INF, from = 0;
      for (let b = 0; b < A; b++) {
        if (dp[i - 1][b] >= INF) continue;
        const move = Math.abs(anchors[a] - anchors[b]) * 0.6;
        const c = dp[i - 1][b] + move;
        if (c < best) { best = c; from = b; }
      }
      dp[i][a] = best + here.cost;
      back[i][a] = from;
    }
  }

  let last = 0;
  for (let a = 1; a < A; a++) if (dp[n - 1][a] < dp[n - 1][last]) last = a;

  const path = new Array<number>(n);
  path[n - 1] = last;
  for (let i = n - 1; i > 0; i--) path[i - 1] = back[i][path[i]];

  let unplayable = 0;
  for (let i = 0; i < n; i++) {
    const res = table[i][path[i]] ?? anchors.map((_, a) => table[i][a]).find(Boolean);
    if (!res) { unplayable++; continue; }
    // placeChord sorted notes high→low; map back onto the slot's own order
    const order = slots[i].notes
      .map((note, idx) => ({ idx, midi: note.midi }))
      .sort((x, y) => y.midi - x.midi);
    order.forEach((entry, k) => {
      const p = res.placements[k];
      if (!p) return;
      slots[i].notes[entry.idx].string = p.string;
      slots[i].notes[entry.idx].fret = p.fret;
    });
  }
  return { unplayable };
}

/** Drop notes the instrument physically cannot reach, so the tab stays honest. */
export function clampToInstrument(midis: number[], o: FretOptions) {
  const lowest = Math.min(...o.tuning) + o.capo;
  const highest = Math.max(...o.tuning) + o.capo + o.maxFret;
  return midis.filter((m) => m >= lowest && m <= highest);
}
