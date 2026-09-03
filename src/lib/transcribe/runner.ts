/**
 * Runs note detection, in a worker when the browser lets us.
 *
 * Detection pegs a core for as long as the song is long, so on the page it
 * freezes every control while it works. A worker fixes that — but TensorFlow's
 * browser bundle does not load in every worker environment, so a failure there
 * falls back to running inline rather than leaving the user with nothing.
 *
 * Kept apart from basicPitch.ts on purpose: the worker imports that module, so
 * spawning the worker from inside it would make the two import each other and
 * the bundler would sit forever resolving the cycle.
 */
import type { NoteEvent } from "../types";
import { transcribeAudio, transcriptionBackend, type TranscribeOptions } from "./basicPitch";

export interface TranscribeRun {
  promise: Promise<{ notes: NoteEvent[]; backend: string }>;
  cancel: () => void;
}

async function inline(mono22k: Float32Array, opts: TranscribeOptions) {
  const notes = await transcribeAudio(mono22k, opts);
  return { notes, backend: (await transcriptionBackend()) ?? "" };
}

export function transcribeInWorker(mono22k: Float32Array, opts: TranscribeOptions): TranscribeRun {
  let created: Worker;
  try {
    created = new Worker(new URL("../workers/transcribe.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    return { promise: inline(mono22k, opts), cancel: () => {} };
  }
  const worker = created;
  let alive = true;
  const kill = () => {
    if (!alive) return;
    alive = false;
    worker.terminate();
  };

  let cancelled = false;
  const promise = new Promise<{ notes: NoteEvent[]; backend: string }>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      kill();
      fn();
    };

    // The worker may fail at import time in browsers where TensorFlow's bundle
    // does not load there. The audio was NOT transferred, so we can just run it
    // here instead — slower and it blocks the page, but it finishes.
    const fallBack = () => {
      if (cancelled) return;
      inline(mono22k, opts).then(
        (r) => resolve(r),
        (e) => {
          console.error("[riffscribe] inline transcription failed:", e);
          reject(e instanceof Error && e.message ? e : new Error("the transcriber could not start"));
        }
      );
    };

    worker.onerror = (e) => {
      e.preventDefault?.();
      console.warn("[riffscribe] transcription worker failed, running inline:", e.message || e);
      finish(fallBack);
    };
    worker.onmessageerror = () => {
      console.warn("[riffscribe] transcription worker sent an unreadable message, running inline");
      finish(fallBack);
    };
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === "progress") opts.onProgress?.(m.value);
      else if (m.type === "done") finish(() => resolve({ notes: m.notes as NoteEvent[], backend: m.backend as string }));
      else if (m.type === "error") {
        console.error("[riffscribe] transcription failed:", m.message);
        finish(() => reject(new Error(m.message || "the transcriber stopped without saying why")));
      }
    };

    const { onProgress: _ignored, ...options } = opts;
    // deliberately not transferred — the fallback needs the samples
    worker.postMessage({ type: "transcribe", mono22k, options });
  });

  return {
    promise,
    cancel: () => {
      cancelled = true;
      kill();
    },
  };
}
