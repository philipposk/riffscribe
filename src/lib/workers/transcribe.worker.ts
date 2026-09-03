/// <reference lib="webworker" />
/**
 * Note detection in a Web Worker.
 *
 * Basic Pitch on the WASM backend pegs a core for as long as the song is long,
 * so running it on the page would freeze every control while it worked. Out
 * here the transport, the mixer and the score all stay live, and the progress
 * bar actually moves.
 */
import { transcribeAudio, transcriptionBackend } from "../transcribe/basicPitch";
import type { TranscribeOptions } from "../transcribe/basicPitch";

type In = {
  type: "transcribe";
  mono22k: Float32Array;
  options: Omit<TranscribeOptions, "onProgress">;
};

const post = (m: unknown, transfer?: Transferable[]) =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer ?? []);

/**
 * The samples do not always arrive as a Float32Array — depending on how the
 * bundler wires the worker up, the message can come through as a plain object of
 * numeric keys, which TensorFlow rejects with "Unknown dtype undefined". Rebuild
 * a real typed array whatever we were handed.
 */
function asSamples(raw: unknown): Float32Array {
  if (raw instanceof Float32Array) return raw;
  if (ArrayBuffer.isView(raw)) return new Float32Array((raw as ArrayBufferView).buffer);
  if (raw instanceof ArrayBuffer) return new Float32Array(raw);
  const values = Object.values(raw as Record<string, number>);
  return Float32Array.from(values);
}

self.onmessage = async (e: MessageEvent<In>) => {
  if (e.data.type !== "transcribe") return;
  try {
    const notes = await transcribeAudio(asSamples(e.data.mono22k), {
      ...e.data.options,
      onProgress: (p) => post({ type: "progress", value: p }),
    });
    const backend = (await transcriptionBackend()) ?? "";
    post({ type: "done", notes, backend });
  } catch (err) {
    const message =
      (err instanceof Error && (err.stack || err.message)) || String(err) || "unknown failure";
    post({ type: "error", message });
  }
};
