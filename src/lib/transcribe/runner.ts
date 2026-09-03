/**
 * Starts the transcription worker.
 *
 * Kept apart from basicPitch.ts on purpose: the worker imports that module, so
 * if the code that spawns the worker lived there too the two would import each
 * other and the bundler would sit there forever trying to resolve the cycle.
 */
import type { NoteEvent } from "../types";
import { transcribeAudio, transcriptionBackend, type TranscribeOptions } from "./basicPitch";

export function transcribeInWorker(
  mono22k: Float32Array,
  opts: TranscribeOptions
): { promise: Promise<{ notes: NoteEvent[]; backend: string }>; cancel: () => void } {
  let worker: Worker;
  try {
    worker = new Worker(new URL("../workers/transcribe.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    // no worker available — run it inline rather than failing outright
    const promise = transcribeAudio(mono22k, opts).then(async (notes) => ({
      notes,
      backend: (await transcriptionBackend()) ?? "",
    }));
    return { promise, cancel: () => {} };
  }

  const promise = new Promise<{ notes: NoteEvent[]; backend: string }>((resolve, reject) => {
    worker.onerror = (e) => reject(new Error(e.message || "transcription worker crashed"));
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === "progress") opts.onProgress?.(m.value);
      else if (m.type === "done") {
        resolve({ notes: m.notes as NoteEvent[], backend: m.backend as string });
        worker.terminate();
      } else if (m.type === "error") {
        reject(new Error(m.message));
        worker.terminate();
      }
    };
    const { onProgress: _ignored, ...options } = opts;
    worker.postMessage({ type: "transcribe", mono22k, options }, [mono22k.buffer]);
  });

  return { promise, cancel: () => worker.terminate() };
}
