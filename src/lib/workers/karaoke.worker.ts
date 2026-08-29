/// <reference lib="webworker" />
/** Phase-based centre extraction off the main thread so the UI keeps painting. */
import { splitCenter } from "../audio/karaoke";

interface In {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  strength: number;
}

self.onmessage = (e: MessageEvent<In>) => {
  const { left, right, sampleRate, strength } = e.data;
  try {
    const { instrumental, center } = splitCenter(left, right, sampleRate, { strength });
    const payload = { instrumental, center };
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ type: "done", ...payload }, [
      instrumental[0].buffer,
      instrumental[1].buffer,
      center[0].buffer,
      center[1].buffer,
    ]);
  } catch (err) {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
