/// <reference lib="webworker" />
/**
 * Renders a guide track off the page. A four-minute bowed line with its room takes most of a
 * second, which the studio would otherwise spend frozen every time a part changes.
 *
 * Imports only the guide synth: nothing here may pull in Basic Pitch or TensorFlow (gotcha 3).
 */
import { synthesizeGuide, type GuideOptions } from "../audio/guide";
import type { NoteEvent } from "../types";

interface In {
  id: number;
  notes: NoteEvent[];
  options: GuideOptions;
}

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (e: MessageEvent<In>) => {
  const { id, notes, options } = e.data;
  try {
    const [left, right] = synthesizeGuide(notes, options);
    // A mono render hands back one array twice; transfer it once and let the page reuse it.
    const same = left === right;
    scope.postMessage(
      { id, left, right: same ? null : right },
      same ? [left.buffer] : [left.buffer, right.buffer]
    );
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
