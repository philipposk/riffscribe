/**
 * Transcription, off the page.
 *
 * This worker imports the runner and nothing else from the app, and the runner
 * imports Basic Pitch and nothing from here. That one-way arrangement matters:
 * an earlier attempt had the worker import the module that spawned the worker,
 * and `next build` sat in that cycle forever without ever printing an error.
 *
 * Whether Basic Pitch will actually start in a worker depends on the browser —
 * TensorFlow's WebGL backend wants a canvas, and gets an OffscreenCanvas here
 * if it gets one at all. So the caller treats a failure as ordinary and runs
 * the same code on the main thread instead.
 */
/*
 * Something in the TensorFlow stack reaches for `window` as a bare global while
 * it works out what environment it is in, and a worker has no `window` — that
 * is a ReferenceError at import time, which is why running this off the page
 * had never worked. In a worker `self` is the global object and serves the same
 * purpose, so point one at the other before Basic Pitch is loaded.
 *
 * This has to happen before the dynamic import inside the runner, which is why
 * it sits at the top of the module rather than inside the handler.
 */
const g = globalThis as unknown as { window?: unknown; document?: unknown };
if (typeof g.window === "undefined") g.window = globalThis;

import { runTranscription, type RunOptions } from "../transcribe/runner";

interface Request {
  audio: Float32Array;
  options: RunOptions;
  modelUrl: string;
}

self.onmessage = async (e: MessageEvent<Request>) => {
  const { audio, options, modelUrl } = e.data;
  try {
    const notes = await runTranscription(audio, options, (p) => {
      self.postMessage({ type: "progress", value: p });
    }, modelUrl);
    self.postMessage({ type: "done", notes });
  } catch (err) {
    self.postMessage({
      type: "error",
      message: err instanceof Error ? err.message : "transcription failed in the worker",
    });
  }
};
