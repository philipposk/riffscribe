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

self.onmessage = async (e: MessageEvent<In>) => {
  if (e.data.type !== "transcribe") return;
  try {
    const notes = await transcribeAudio(e.data.mono22k, {
      ...e.data.options,
      onProgress: (p) => post({ type: "progress", value: p }),
    });
    const backend = (await transcriptionBackend()) ?? "";
    post({ type: "done", notes, backend });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
