/**
 * The guide for instruments that hold their notes (bowed strings, winds, brass, voice), played as
 * one continuous line rather than a string of separate beeps.
 *
 * What makes it sound played rather than typed:
 *  - Notes that follow each other closely are slurred: one bow stroke, no new attack, the pitch
 *    gliding into the next note. A real re-articulation (a gap, or the singer's loudness dipping
 *    at the join) starts a new stroke. Long phrases get a bow change every few seconds.
 *  - When the part was written from a singer, the pitch follows the singer's own curve (slides,
 *    vibrato, scoops) and the loudness follows theirs.
 *  - Bowed parts are a band-limited sawtooth (what a bowed string produces), brightened when
 *    played louder, with filtered bow noise, through a cello-body filter (body.ts).
 *  - The whole line is levelled to a target loudness and given a small room (room.ts).
 *
 * Everything here is an offline render into plain buffers, deterministic for a given seed.
 */
import type { NoteEvent, PitchContour } from "../types";
import { createBody } from "./body";
import { mulberry32 } from "./prng";
import { applyRoom } from "./room";

/** One guide timbre's settings (the table lives in guide.ts). */
export interface Voice {
  /** Relative amplitude of harmonic 1, 2, 3 … */
  harmonics: number[];
  attack: number;
  decay: number;
  /** 0 = dies away (plucked), 1 = holds while the note lasts (bowed). */
  sustain: number;
  release: number;
  /** Exponential fade over the note, per second. 0 for sustained voices. */
  damping: number;
  vibratoHz: number;
  vibratoDepth: number;
  vibratoOnset: number;
  /** Breath/bow noise blended in. */
  noise: number;
  gain: number;
}

/** What `renderLine` reads from the guide options. */
export interface LineOptions {
  sampleRate: number;
  lengthSamples: number;
  transposeSemitones?: number;
  minDuration?: number;
  contour?: PitchContour | null;
  targetRms?: number;
  room?: boolean;
  seed?: number;
  bodyScale?: number;
  /** Bowed timbre: sawtooth through the body filter. Otherwise a harmonic wavetable. */
  bowed?: boolean;
}

/** Control rate for pitch, loudness and brightness. */
const FPS = 100;
/** Notes closer than this are candidates for a slur. */
const SLUR_GAP = 0.08;
/** A bow stroke lasts about this long before it has to change direction. */
const BOW_EVERY = 3.5;
/** A note held longer than this changes bow inside itself. */
const LONG_NOTE = 4.5;
/** A note may start this much before the previous one in its line ends and still follow it. */
const OVERLAP_TOL = 0.05;
/** Chords are split into at most this many simultaneous lines. */
const MAX_LINES = 8;
/** Contour values further than this from the written note are treated as tracking errors. */
const CONTOUR_TRUST_SEMITONES = 6;
const DEFAULT_RMS = 0.12;
const PEAK = 0.9;
const BOW_DIP = { depth: 0.55, width: 0.06 };
const SLUR_DIP = { depth: 0.85, width: 0.04 };
const TABLE_SIZE = 4096;
/** The envelope is sampled at 1 kHz: fine enough for a 40 ms dip, cheap to interpolate. */
const ENV_FPS = 1000;

const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A note as the line renderer sees it: transposed, with its (possibly shortened) end. */
export interface LineNote {
  start: number;
  end: number;
  pitch: number;
  amplitude: number;
  bends?: number[];
}

/** One bow stroke's worth of notes, or more: a slurred phrase with its bow changes. */
export interface SlurGroup {
  notes: LineNote[];
  start: number;
  end: number;
  /** Times of slurred joins that stay in the same bow stroke. */
  slurs: number[];
  /** Times where the bow changes direction inside the group. */
  bowChanges: number[];
}

/**
 * How a set of notes will be played: split into lines (one note at a time each), and each line
 * into slurred groups with their bow changes. Exported so the eval can check what happens at
 * each join.
 */
export function planLine(
  notes: NoteEvent[],
  o: Pick<LineOptions, "sampleRate" | "lengthSamples" | "transposeSemitones" | "minDuration" | "contour">
): SlurGroup[][] {
  const minDur = o.minDuration ?? 0.04;
  const shift = o.transposeSemitones ?? 0;
  const lengthSeconds = o.lengthSamples / o.sampleRate;
  const usable: LineNote[] = [];
  for (const n of notes) {
    const f = midiToHz(n.pitchMidi + shift);
    if (!(f > 0) || f > o.sampleRate / 2.2) continue;
    if (!(n.startTimeSeconds < lengthSeconds) || !Number.isFinite(n.startTimeSeconds)) continue;
    const start = Math.max(0, n.startTimeSeconds);
    usable.push({
      start,
      end: start + Math.max(minDur, n.durationSeconds || 0),
      pitch: n.pitchMidi + shift,
      amplitude: n.amplitude,
      bends: n.pitchBends,
    });
  }
  // by start, then the highest note first so the top line carries the melody
  usable.sort((a, b) => a.start - b.start || b.pitch - a.pitch);

  const lines: LineNote[][] = [];
  for (const n of usable) {
    let target = lines.find((l) => n.start >= l[l.length - 1].end - OVERLAP_TOL);
    if (!target) {
      if (lines.length < MAX_LINES) {
        target = [];
        lines.push(target);
      } else {
        target = lines.reduce((a, b) => (a[a.length - 1].end <= b[b.length - 1].end ? a : b));
      }
    }
    const prev = target[target.length - 1];
    if (prev && prev.end > n.start) prev.end = Math.max(prev.start + 0.01, n.start);
    target.push(n);
  }

  const level = o.contour?.level?.length ? o.contour.level : null;
  const cfps = o.contour?.fps || FPS;

  return lines.map((line) => {
    const groups: SlurGroup[] = [];
    let g: SlurGroup | null = null;
    for (let i = 0; i < line.length; i++) {
      const n = line[i];
      let slur = false;
      if (g && i > 0) {
        const prev = line[i - 1];
        const gap = n.start - prev.end;
        if (gap <= SLUR_GAP) {
          slur = true;
          if (level) {
            const b = n.start;
            let min = Infinity;
            for (let j = Math.round((b - 0.03) * cfps); j <= Math.round((b + 0.03) * cfps); j++) min = Math.min(min, level[j] ?? 0);
            let sum = 0, count = 0;
            const from = Math.round(prev.start * cfps);
            for (let j = from; j < Math.max(from + 1, Math.round(prev.end * cfps)); j++) {
              sum += level[j] ?? 0;
              count++;
            }
            const mean = count ? sum / count : 0;
            slur = min >= 0.5 * mean;
          }
        }
      }
      if (g && slur) {
        g.notes.push(n);
        g.end = n.end;
      } else {
        if (g) groups.push(g);
        g = { notes: [n], start: n.start, end: n.end, slurs: [], bowChanges: [] };
      }
    }
    if (g) groups.push(g);

    for (const grp of groups) {
      const joins: number[] = [];
      for (let i = 1; i < grp.notes.length; i++) joins.push((grp.notes[i - 1].end + grp.notes[i].start) / 2);
      const candidates = [...joins];
      for (const n of grp.notes) {
        if (n.end - n.start <= LONG_NOTE) continue;
        for (let t = n.start + BOW_EVERY; t < n.end - 0.5; t += BOW_EVERY) candidates.push(t);
      }
      candidates.sort((a, b) => a - b);
      const chosen = new Set<number>();
      for (let mark = grp.start + BOW_EVERY; mark < grp.end - 0.5; mark += BOW_EVERY) {
        let best = -1, bestD = Infinity;
        for (const c of candidates) {
          const d = Math.abs(c - mark);
          if (d < bestD) { bestD = d; best = c; }
        }
        if (best >= 0) chosen.add(best);
      }
      grp.bowChanges = [...chosen].sort((a, b) => a - b);
      grp.slurs = joins.filter((t) => !chosen.has(t));
    }
    return groups;
  });
}

interface Controls {
  group: SlurGroup;
  /** First control frame (absolute index at FPS). */
  j0: number;
  hz: Float64Array;
  dyn: Float64Array;
  /** One-pole lowpass coefficient per frame (bowed). */
  lp: Float64Array;
  /** Bow-noise gain per frame (bowed). */
  noise: Float64Array;
  /** First envelope point (absolute index at ENV_FPS). */
  e0: number;
  /** The attack, release and dips, sampled finely enough to interpolate per sample. */
  env: Float32Array;
}

/** Fills NaN entries by straight lines between their neighbours; ends take the nearest value. */
function fillGaps(a: Float64Array, fallback: number) {
  let last = -1;
  for (let i = 0; i < a.length; i++) {
    if (Number.isNaN(a[i])) continue;
    if (last < 0) for (let k = 0; k < i; k++) a[k] = a[i];
    else for (let k = last + 1; k < i; k++) a[k] = a[last] + ((a[i] - a[last]) * (k - last)) / (i - last);
    last = i;
  }
  if (last < 0) a.fill(fallback);
  else for (let k = last + 1; k < a.length; k++) a[k] = a[last];
}

function smoothBends(bends: number[]): number[] | null {
  if (!bends || bends.length < 2) return null;
  let lo = Infinity, hi = -Infinity;
  for (const b of bends) { lo = Math.min(lo, b); hi = Math.max(hi, b); }
  if (hi - lo < 2) return null;
  return bends.map((_, i) => {
    let s = 0, c = 0;
    for (let k = i - 2; k <= i + 2; k++) if (k >= 0 && k < bends.length) { s += bends[k]; c++; }
    return s / c;
  });
}

function makeEnvelope(group: SlurGroup, v: Voice) {
  const dips = [
    ...group.bowChanges.map((t) => ({ t, ...BOW_DIP })),
    ...group.slurs.map((t) => ({ t, ...SLUR_DIP })),
  ].sort((a, b) => a.t - b.t);
  const attack = Math.max(1e-3, v.attack);
  const release = Math.max(1e-3, v.release);
  const reach = Math.max(BOW_DIP.width, SLUR_DIP.width) / 2;
  // called with rising times almost always: a cursor keeps the dip lookup constant-time
  let from = 0, lastT = -Infinity;
  return (t: number) => {
    const a = t - group.start;
    if (a < 0) return 0;
    let env = a < attack ? 0.5 - 0.5 * Math.cos((Math.PI * a) / attack) : 1;
    if (t > group.end) env *= Math.max(0, 1 - (t - group.end) / release);
    if (t < lastT) from = 0;
    lastT = t;
    while (from < dips.length && dips[from].t + reach < t) from++;
    for (let i = from; i < dips.length && dips[i].t - reach <= t; i++) {
      const d = dips[i];
      const half = d.width / 2;
      if (Math.abs(t - d.t) >= half) continue;
      env *= 1 - (1 - d.depth) * 0.5 * (1 + Math.cos((Math.PI * (t - d.t)) / half));
    }
    return env;
  };
}

function controlsFor(group: SlurGroup, v: Voice, o: LineOptions, useContour: boolean, levelRef: number): Controls {
  const sr = o.sampleRate;
  const contour = o.contour ?? null;
  const shift = o.transposeSemitones ?? 0;
  const cfps = contour?.fps || FPS;
  const level = levelRef > 0 && contour?.level?.length ? contour.level : null;
  const j0 = Math.floor(group.start * FPS);
  const j1 = Math.ceil((group.end + v.release) * FPS) + 2;
  const L = j1 - j0 + 1;
  const pitch = new Float64Array(L).fill(NaN);
  const dyn = new Float64Array(L).fill(NaN);
  const notes = group.notes;
  const bends = useContour ? null : notes.map((n) => smoothBends(n.bends ?? []));

  let ni = 0;
  for (let k = 0; k < L; k++) {
    const t = (j0 + k) / FPS;
    while (ni < notes.length - 1 && t >= notes[ni + 1].start) ni++;
    const n = notes[ni];
    const inside = t >= n.start && t < n.end;
    if (inside || (ni === 0 && t < n.start)) {
      const tn = Math.max(0, t - n.start);
      let p = n.pitch;
      if (useContour && contour) {
        const c = contour.midi[Math.round(t * cfps)] ?? 0;
        if (c > 0 && Math.abs(c + shift - n.pitch) <= CONTOUR_TRUST_SEMITONES) p = c + shift;
      } else {
        const b = bends?.[ni];
        if (b) {
          const x = tn * 86;
          const i = Math.min(b.length - 1, Math.floor(x));
          const nxt = Math.min(b.length - 1, i + 1);
          p += (b[i] + (b[nxt] - b[i]) * (x - i)) / 3;
        }
        if (v.vibratoHz && n.end - n.start >= 0.35 && tn > v.vibratoOnset) {
          const ramp = Math.min(1, (tn - v.vibratoOnset) / 0.25);
          p += 12 * Math.log2(1 + v.vibratoDepth * ramp * Math.sin(2 * Math.PI * v.vibratoHz * tn));
        }
      }
      pitch[k] = p;
      dyn[k] = level ? NaN : 0.75 + 0.25 * clamp(n.amplitude * 1.6, 0.25, 1);
    }
    if (level && t <= group.end) {
      const lv = level[Math.round(t * cfps)] ?? 0;
      dyn[k] = clamp(Math.pow(lv / levelRef, 1 / 1.5), 0.15, 1.5);
    }
  }

  if (!useContour) {
    // a short glide across each slurred join
    for (let i = 1; i < notes.length; i++) {
      const a = notes[i - 1], b = notes[i];
      const c = (a.end + b.start) / 2;
      const h = Math.max(0.02, (b.start - a.end) / 2);
      for (let k = Math.max(0, Math.ceil((c - h) * FPS) - j0); k < L; k++) {
        const t = (j0 + k) / FPS;
        if (t > c + h) break;
        pitch[k] = a.pitch + ((b.pitch - a.pitch) * (t - (c - h))) / (2 * h);
      }
    }
  }
  fillGaps(pitch, notes[0].pitch);
  fillGaps(dyn, 1);
  if (level) {
    const raw = Float64Array.from(dyn);
    for (let k = 0; k < L; k++) dyn[k] = (raw[Math.max(0, k - 1)] + raw[k] + raw[Math.min(L - 1, k + 1)]) / 3;
  }

  const envAt = makeEnvelope(group, v);
  const hz = new Float64Array(L);
  const lp = new Float64Array(L);
  const noise = new Float64Array(L);
  for (let k = 0; k < L; k++) {
    const f = midiToHz(pitch[k]);
    hz[k] = f;
    const amp = envAt((j0 + k) / FPS) * dyn[k];
    const bright = clamp(0.35 + 0.65 * amp, 0.2, 1);
    const fc = Math.min(0.45 * sr, f * (3 + 22 * bright));
    lp[k] = 1 - Math.exp((-2 * Math.PI * fc) / sr);
    noise[k] = v.noise * 8 * (0.5 + 0.5 * bright);
  }
  const e0 = Math.floor(group.start * ENV_FPS);
  const env = new Float32Array(Math.ceil((group.end + v.release) * ENV_FPS) + 3 - e0);
  for (let k = 0; k < env.length; k++) env[k] = envAt((e0 + k) / ENV_FPS);
  return { group, j0, hz, dyn, lp, noise, e0, env };
}

/** Band-limited step correction for the sawtooth's jump (PolyBLEP). */
function blep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

function wavetable(v: Voice, maxHz: number, sr: number): Float32Array {
  const table = new Float32Array(TABLE_SIZE + 1);
  for (let h = 0; h < v.harmonics.length; h++) {
    if ((h + 1) * maxHz >= 0.45 * sr) break;
    const a = v.harmonics[h];
    for (let i = 0; i < TABLE_SIZE; i++) table[i] += a * Math.sin((2 * Math.PI * (h + 1) * i) / TABLE_SIZE);
  }
  let peak = 0;
  for (let i = 0; i < TABLE_SIZE; i++) peak = Math.max(peak, Math.abs(table[i]));
  if (peak > 0) for (let i = 0; i < TABLE_SIZE; i++) table[i] /= peak;
  table[TABLE_SIZE] = table[0];
  return table;
}

/**
 * Renders a sustained part as continuous line(s). Returns left and right; with `room: false`
 * both are the same array.
 */
export function renderLine(notes: NoteEvent[], v: Voice, o: LineOptions): [Float32Array, Float32Array] {
  const sr = o.sampleRate;
  const len = o.lengthSamples;
  const out = new Float32Array(len);
  const lines = planLine(notes, o);
  if (!lines.length || len === 0) return [out, out];

  // loudness reference: the singer's loud-but-not-loudest level while they sing
  let levelRef = 0;
  const level = o.contour?.level;
  if (level?.length) {
    const voiced: number[] = [];
    for (let j = 0; j < level.length; j++) if ((o.contour?.midi?.[j] ?? 0) > 0 || !o.contour?.midi?.length) voiced.push(level[j]);
    const pool = voiced.some((x) => x > 0) ? voiced : level.slice();
    pool.sort((a, b) => a - b);
    levelRef = pool.length ? pool[Math.min(pool.length - 1, Math.floor(0.9 * (pool.length - 1) + 0.5))] : 0;
  }

  const controls: Controls[] = [];
  let maxHz = 0;
  lines.forEach((groups, li) => {
    const useContour = li === 0 && !!o.contour?.midi?.length;
    for (const g of groups) {
      const c = controlsFor(g, v, o, useContour, levelRef);
      for (const f of c.hz) maxHz = Math.max(maxHz, f);
      controls.push(c);
    }
  });

  const rand = mulberry32(o.seed ?? 1);
  const bowed = !!o.bowed;
  const table = bowed ? null : wavetable(v, maxHz, sr);
  const mask = new Uint8Array(len);
  const hpA = 1 / (1 + (2 * Math.PI * 800) / sr);
  const nlA = 1 - Math.exp((-2 * Math.PI * Math.min(5000, 0.45 * sr)) / sr);

  for (const c of controls) {
    const g = c.group;
    const s0 = Math.max(0, Math.round(g.start * sr));
    const s1 = Math.min(len, Math.round((g.end + v.release) * sr));
    const last = c.hz.length - 2;
    const lastE = c.env.length - 2;
    let ph = 0, lp = 0, hp = 0, wPrev = 0, nl = 0;
    for (let n = s0; n < s1; n++) {
      const t = n / sr;
      const u = t * FPS - c.j0;
      const k = Math.min(last, Math.max(0, Math.floor(u)));
      const fr = u - k;
      const f = c.hz[k] + (c.hz[k + 1] - c.hz[k]) * fr;
      const ue = t * ENV_FPS - c.e0;
      const ke = Math.min(lastE, Math.max(0, Math.floor(ue)));
      const env = c.env[ke] + (c.env[ke + 1] - c.env[ke]) * (ue - ke);
      const amp = env * (c.dyn[k] + (c.dyn[k + 1] - c.dyn[k]) * fr);
      const dt = f / sr;
      let s: number;
      if (bowed) {
        const saw = 2 * ph - 1 - blep(ph, dt);
        lp += c.lp[k] * (saw - lp);
        const w = rand() * 2 - 1;
        hp = hpA * (hp + w - wPrev);
        wPrev = w;
        nl += nlA * (hp - nl);
        s = lp + c.noise[k] * nl;
      } else {
        const x = ph * TABLE_SIZE;
        const i = x | 0;
        s = table![i] + (table![i + 1] - table![i]) * (x - i) + v.noise * (rand() * 2 - 1);
      }
      ph += dt;
      if (ph >= 1) ph -= Math.floor(ph);
      out[n] += s * amp;
      if (amp > 0.05) mask[n] = 1;
    }
  }

  if (bowed) {
    createBody(sr, o.bodyScale ?? 1).processBlock(out);
  }

  // level: the sounding part at the target loudness, then never above the peak limit
  let sum = 0, count = 0;
  for (let n = 0; n < len; n++) if (mask[n]) { sum += out[n] * out[n]; count++; }
  const rms = count ? Math.sqrt(sum / count) : 0;
  if (rms > 0) {
    let g = (o.targetRms ?? DEFAULT_RMS) / rms;
    let peak = 0;
    for (let n = 0; n < len; n++) peak = Math.max(peak, Math.abs(out[n]));
    if (peak * g > PEAK) g = PEAK / peak;
    for (let n = 0; n < len; n++) out[n] *= g;
  }

  if (!(o.room ?? true)) return [out, out];
  const [left, right] = applyRoom(out, sr, { seed: o.seed ?? 1 });
  let peak = 0;
  for (let n = 0; n < len; n++) peak = Math.max(peak, Math.abs(left[n]), Math.abs(right[n]));
  if (peak > PEAK) {
    const g = PEAK / peak;
    for (let n = 0; n < len; n++) { left[n] *= g; right[n] *= g; }
  }
  return [left, right];
}
