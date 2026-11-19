/**
 * Guide renders, off the page.
 *
 * One long-lived worker (guide.worker.ts) renders every guide track; requests are matched to
 * answers by id, so several parts can be in flight at once. Where a worker cannot be created,
 * or it fails, the same synth runs on the page instead: slower to feel, same result.
 */
import type { NoteEvent } from "../types";
import { synthesizeGuide, type GuideOptions } from "./guide";

type Pending = {
  resolve: (v: [Float32Array, Float32Array]) => void;
  reject: (e: Error) => void;
  notes: NoteEvent[];
  options: GuideOptions;
};

let worker: Worker | null = null;
/** Set once the worker has failed, so later renders go straight to the page. */
let broken = false;
let nextId = 1;
const pending = new Map<number, Pending>();

const onPage = (notes: NoteEvent[], options: GuideOptions) => synthesizeGuide(notes, options);

/** The worker died: every request still waiting is rendered on the page instead. */
function fail(why: unknown) {
  broken = true;
  console.info("[riffscribe] guide worker unavailable, rendering on the page:", why instanceof Error ? why.message : why);
  worker?.terminate();
  worker = null;
  const waiting = [...pending.values()];
  pending.clear();
  for (const p of waiting) {
    try {
      p.resolve(onPage(p.notes, p.options));
    } catch (e) {
      p.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }
}

function getWorker(): Worker | null {
  if (worker || broken) return worker;
  if (typeof Worker === "undefined") {
    broken = true;
    return null;
  }
  try {
    const w = new Worker(new URL("../workers/guide.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<{ id: number; left?: Float32Array; right?: Float32Array | null; error?: string }>) => {
      const m = e.data;
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.error || !m.left) {
        // a render that throws in the worker would throw on the page too
        p.reject(new Error(m.error || "guide render failed"));
        return;
      }
      p.resolve([m.left, m.right ?? m.left]);
    };
    w.onerror = (e) => {
      e.preventDefault?.();
      fail(new Error(e.message || "guide worker crashed"));
    };
    worker = w;
    return w;
  } catch (e) {
    fail(e);
    return null;
  }
}

/**
 * Renders a guide track. Resolves with left and right (the same array twice for a mono render).
 * The notes and options are copied into the worker; nothing passed in is changed.
 */
export function renderGuide(notes: NoteEvent[], options: GuideOptions): Promise<[Float32Array, Float32Array]> {
  const w = getWorker();
  if (!w) {
    try {
      return Promise.resolve(onPage(notes, options));
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, notes, options });
    try {
      w.postMessage({ id, notes, options });
    } catch {
      // e.g. something in the request cannot be cloned: render this one here
      pending.delete(id);
      try {
        resolve(onPage(notes, options));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    }
  });
}
