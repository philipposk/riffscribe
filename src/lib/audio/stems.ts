/** Main-thread client for the Demucs worker + the instant karaoke fallback. */
import { splitCenter } from "./karaoke";
import type { StemName } from "../types";

export const DEMUCS_SAMPLE_RATE = 44100;

export const MODEL_URL =
  process.env.NEXT_PUBLIC_DEMUCS_MODEL_URL ||
  "https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx";

export interface SeparateProgress {
  phase: "download" | "prepare" | "separate" | "log";
  /** 0..1 where known. */
  value?: number;
  message?: string;
}

export type StemSet = Record<StemName, { left: Float32Array; right: Float32Array }>;

export function separateWithDemucs(
  left: Float32Array,
  right: Float32Array,
  onProgress: (p: SeparateProgress) => void
): { promise: Promise<StemSet>; cancel: () => void } {
  const worker = new Worker(new URL("../workers/stems.worker.ts", import.meta.url), {
    type: "module",
  });

  const promise = new Promise<StemSet>((resolve, reject) => {
    worker.onerror = (e) => reject(new Error(e.message || "stem worker crashed"));
    worker.onmessage = (e) => {
      const m = e.data;
      switch (m.type) {
        case "download":
          onProgress({ phase: "download", value: m.total ? m.loaded / m.total : undefined, message: `${(m.loaded / 1e6).toFixed(0)} MB` });
          break;
        case "preparing":
          onProgress({ phase: "prepare" });
          break;
        case "progress":
          onProgress({ phase: "separate", value: m.progress, message: `chunk ${m.segment}/${m.segments}` });
          break;
        case "log":
          onProgress({ phase: "log", message: `${m.phase}: ${m.message}` });
          break;
        case "done":
          resolve(m.stems as StemSet);
          worker.terminate();
          break;
        case "error":
          reject(new Error(m.message));
          worker.terminate();
          break;
      }
    };
    worker.postMessage({ type: "separate", left, right, modelUrl: MODEL_URL }, [
      left.buffer,
      right.buffer,
    ]);
  });

  return { promise, cancel: () => worker.terminate() };
}

/*
 * Resumable AI split.
 *
 * Demucs works through fixed windows (TRAINING_SAMPLES long, one every STRIDE
 * samples) and treats each window on its own — there is no whole-song
 * normalisation. So the song can be run in blocks of BLOCK_SEGMENTS windows
 * that sit exactly on Demucs's own grid, each block saved as it finishes. A
 * block overlaps the next by one window's overlap (~2 s), and they are joined
 * with a linear crossfade there — the same blend Demucs uses between its own
 * windows, so there is no seam to hear.
 */
const TRAINING_SAMPLES = 343980; // demucs-web constants
const STRIDE = Math.floor(TRAINING_SAMPLES * 0.75);
const BLOCK_SEGMENTS = 5; // ≈ 30 s of audio per saved block

/** The error a cancelled split rejects with — a pause, not a failure. */
export const SPLIT_PAUSED = "split paused";

/**
 * Saved blocks belong to this exact audio: the song, at this length. Trimming
 * to a loop keeps the song key but changes the audio, so the length is part of it.
 */
export const partialKey = (songKey: string, frames: number) => `${songKey}:${frames}`;

export interface BlockStore {
  done: (key: string) => Promise<Set<number>>;
  get: (key: string, block: number, rate: number) => Promise<Record<string, { left: Float32Array; right: Float32Array }> | null>;
  put: (key: string, block: number, stems: Record<string, { left: Float32Array; right: Float32Array }>, rate: number) => Promise<void>;
  clear: (key: string) => Promise<void>;
}

function blockPlan(total: number) {
  const segments = Math.max(1, Math.ceil(Math.max(0, total - TRAINING_SAMPLES) / STRIDE) + 1);
  const blocks = Math.ceil(segments / BLOCK_SEGMENTS);
  return Array.from({ length: blocks }, (_, b) => {
    const first = b * BLOCK_SEGMENTS;
    const count = Math.min(BLOCK_SEGMENTS, segments - first);
    const start = first * STRIDE;
    const end = Math.min(total, start + (count - 1) * STRIDE + TRAINING_SAMPLES);
    return { start, end };
  });
}

export function separateResumable(
  key: string,
  left: Float32Array,
  right: Float32Array,
  store: BlockStore,
  onProgress: (p: SeparateProgress & { resumedFrom?: number }) => void
): { promise: Promise<StemSet>; cancel: () => void } {
  const worker = new Worker(new URL("../workers/stems.worker.ts", import.meta.url), { type: "module" });
  let cancelled = false;
  // Terminating the worker fires nothing, so cancel rejects the running block itself.
  let abort: ((e: Error) => void) | null = null;
  const total = left.length;
  const plan = blockPlan(total);

  const runBlock = (l: Float32Array, r: Float32Array, b: number) =>
    new Promise<StemSet>((resolve, reject) => {
      abort = reject;
      worker.onerror = (e) => reject(new Error(e.message || "stem worker crashed"));
      worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === "download") {
          onProgress({ phase: "download", value: m.total ? m.loaded / m.total : undefined, message: `${(m.loaded / 1e6).toFixed(0)} MB` });
        } else if (m.type === "preparing") {
          onProgress({ phase: "prepare" });
        } else if (m.type === "progress") {
          onProgress({
            phase: "separate",
            value: (b + m.progress) / plan.length,
            message: `part ${b + 1}/${plan.length} — finished parts are kept if you stop`,
          });
        } else if (m.type === "log") {
          onProgress({ phase: "log", message: `${m.phase}: ${m.message}` });
        } else if (m.type === "done") {
          resolve(m.stems as StemSet);
        } else if (m.type === "error") {
          reject(new Error(m.message));
        }
      };
      worker.postMessage({ type: "separate", left: l, right: r, modelUrl: MODEL_URL }, [l.buffer, r.buffer]);
    });

  const promise = (async () => {
    try {
      const have = await store.done(key);
      const resumed = plan.findIndex((_, b) => !have.has(b));
      if (resumed > 0) onProgress({ phase: "log", message: `resuming from part ${resumed + 1}`, resumedFrom: resumed });

      const results: StemSet[] = [];
      for (let b = 0; b < plan.length; b++) {
        if (cancelled) throw new Error(SPLIT_PAUSED);
        const { start, end } = plan[b];
        let res = have.has(b) ? ((await store.get(key, b, DEMUCS_SAMPLE_RATE)) as StemSet | null) : null;
        if (!res) {
          res = await runBlock(left.slice(start, end), right.slice(start, end), b);
          await store.put(key, b, res, DEMUCS_SAMPLE_RATE);
        }
        results.push(res);
      }

      // Stitch: every block weighted 1 except a linear ramp across each overlap.
      const names = Object.keys(results[0]) as (keyof StemSet)[];
      const out = Object.fromEntries(
        names.map((n) => [n, { left: new Float32Array(total), right: new Float32Array(total) }])
      ) as StemSet;
      const weight = new Float32Array(total);
      plan.forEach(({ start, end }, b) => {
        const fadeIn = b > 0 ? plan[b - 1].end - start : 0;
        const fadeOut = b < plan.length - 1 ? end - plan[b + 1].start : 0;
        for (let i = 0; i < end - start; i++) {
          let w = 1;
          if (fadeIn > 0 && i < fadeIn) w = Math.min(w, (i + 0.5) / fadeIn);
          if (fadeOut > 0 && i >= end - start - fadeOut) w = Math.min(w, (end - start - i - 0.5) / fadeOut);
          weight[start + i] += w;
          for (const n of names) {
            out[n].left[start + i] += results[b][n].left[i] * w;
            out[n].right[start + i] += results[b][n].right[i] * w;
          }
        }
      });
      for (let i = 0; i < total; i++) {
        const w = weight[i] || 1;
        if (w !== 1) for (const n of names) { out[n].left[i] /= w; out[n].right[i] /= w; }
      }
      await store.clear(key);
      return out;
    } finally {
      worker.terminate();
    }
  })();

  return {
    promise,
    cancel: () => {
      cancelled = true;
      worker.terminate();
      abort?.(new Error(SPLIT_PAUSED));
    },
  };
}

/** Zero-download alternative: pull the centred vocal out with phase maths. */
export function separateInstant(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  strength = 2
): StemSet {
  const { instrumental, center } = splitCenter(left, right, sampleRate, { strength });
  return packInstant(left.length, instrumental, center);
}

function packInstant(
  length: number,
  instrumental: [Float32Array, Float32Array],
  center: [Float32Array, Float32Array]
): StemSet {
  const silence = () => new Float32Array(length);
  return {
    vocals: { left: center[0], right: center[1] },
    // instant mode cannot tell drums from bass — everything else lands in "other"
    drums: { left: silence(), right: silence() },
    bass: { left: silence(), right: silence() },
    other: { left: instrumental[0], right: instrumental[1] },
  };
}

/** Same thing in a worker, so a five-minute track does not freeze the page. */
export function separateInstantAsync(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  strength = 2
): Promise<StemSet> {
  const length = left.length;
  const worker = new Worker(new URL("../workers/karaoke.worker.ts", import.meta.url), {
    type: "module",
  });
  return new Promise((resolve, reject) => {
    worker.onerror = (e) => reject(new Error(e.message || "karaoke worker crashed"));
    worker.onmessage = (e) => {
      worker.terminate();
      if (e.data.type === "error") reject(new Error(e.data.message));
      else resolve(packInstant(length, e.data.instrumental, e.data.center));
    };
    worker.postMessage({ left, right, sampleRate, strength }, [left.buffer, right.buffer]);
  });
}

export function mixStems(
  stems: Partial<Record<string, { left: Float32Array; right: Float32Array }>>,
  include: string[],
  opts: {
    /** Render this many samples, so a mix with nothing in it is still a valid file. */
    length?: number;
    /** Per-track fader positions, so an export matches what you hear. */
    gains?: Record<string, number>;
  } = {}
): { left: Float32Array; right: Float32Array } {
  const first = include.map((k) => stems[k]).find(Boolean);
  const n = opts.length ?? (first ? first.left.length : 0);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (const key of include) {
    const s = stems[key];
    if (!s) continue;
    const g = opts.gains?.[key] ?? 1;
    if (g === 0) continue;
    const len = Math.min(n, s.left.length);
    for (let i = 0; i < len; i++) {
      left[i] += s.left[i] * g;
      right[i] += (s.right[i] ?? s.left[i]) * g;
    }
  }
  return { left, right };
}
