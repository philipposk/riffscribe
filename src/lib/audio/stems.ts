/** Main-thread client for the Demucs worker + the instant karaoke fallback. */
import { splitCenter } from "./karaoke";
import type { StemName } from "../types";

export const DEMUCS_SAMPLE_RATE = 44100;

export const MODEL_URL =
  process.env.NEXT_PUBLIC_DEMUCS_MODEL_URL ||
  "https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx";

export interface SeparateProgress {
  phase: "download" | "separate" | "log";
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
  include: string[]
): { left: Float32Array; right: Float32Array } {
  const first = include.map((k) => stems[k]).find(Boolean);
  const n = first ? first.left.length : 0;
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (const key of include) {
    const s = stems[key];
    if (!s) continue;
    for (let i = 0; i < n; i++) {
      left[i] += s.left[i] ?? 0;
      right[i] += s.right[i] ?? 0;
    }
  }
  return { left, right };
}
