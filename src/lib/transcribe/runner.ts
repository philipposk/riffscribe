/**
 * The transcription loop itself, in one place so the worker and the main
 * thread run identical code.
 *
 * Basic Pitch's own `evaluateModel` awaits once per analysis window, which
 * looks like it should keep the page alive — but those awaits resolve as
 * microtasks, and microtasks all drain before the browser gets to paint or run
 * a timer. So the loop is really one long block of compute and the tab freezes
 * for the whole of it.
 *
 * `prepareData`, `evaluateSingleFrame` and `unwrapOutput` are all public, so we
 * drive the same loop ourselves and hand the event loop a real macrotask
 * between windows. In a worker that costs nothing and changes nothing; on the
 * main thread it is the difference between a frozen tab and a moving progress
 * bar.
 *
 * As everywhere else in this project: do not import TensorFlow.js here. Basic
 * Pitch carries its own copy and a second instance kills every run with
 * "Unknown dtype undefined".
 */
import type { NoteEvent } from "../types";

export const BASIC_PITCH_SAMPLE_RATE = 22050;
export const MODEL_PATH = "/models/basic-pitch/model.json";
/** Basic Pitch's STFT hop, needed for the same frame arithmetic it does. */
const FFT_HOP = 256;

export interface RunOptions {
  onsetThreshold: number;
  frameThreshold: number;
  minNoteLength: number;
  minMidi?: number;
  maxMidi?: number;
}

/** Hand control back to the browser properly, not just to the microtask queue. */
const breathe = (): Promise<void> =>
  new Promise((resolve) => {
    // A message channel posts a real task and, unlike setTimeout, is not
    // clamped to 4ms once the page has been busy for a while.
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(null);
  });

export async function runTranscription(
  mono22k: Float32Array,
  opts: RunOptions,
  onProgress?: (pct: number) => void,
  modelUrl: string = MODEL_PATH
): Promise<NoteEvent[]> {
  const {
    BasicPitch,
    noteFramesToTime,
    addPitchBendsToNoteEvents,
    outputToNotesPoly,
  } = await import("@spotify/basic-pitch");

  const model = new BasicPitch(modelUrl);
  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];

  // Mirrors BasicPitch.evaluateModel, with a yield added between windows.
  const [reshapedInput, audioOriginalLength] = await model.prepareData(mono22k);
  const windows = reshapedInput.shape[0];
  // Basic Pitch's own arithmetic, copied exactly. ANNOTATIONS_FPS is
  // floor(22050 / 256) = 86, and that floor matters: deriving the rate as
  // 22050/256 = 86.13 instead drifts by a few frames over a long track and
  // trims the tail in a different place than the library would.
  const ANNOTATIONS_FPS = Math.floor(BASIC_PITCH_SAMPLE_RATE / FFT_HOP);
  const nOutputFramesOriginal = Math.floor(
    audioOriginalLength * (ANNOTATIONS_FPS / BASIC_PITCH_SAMPLE_RATE)
  );
  let calculated = 0;

  for (let i = 0; i < windows; i++) {
    onProgress?.(i / windows);
    const [f, o, c] = await model.evaluateSingleFrame(reshapedInput, i);
    let uf = model.unwrapOutput(f);
    let uo = model.unwrapOutput(o);
    let uc = model.unwrapOutput(c);
    const got = uf.shape[0];
    if (calculated < nOutputFramesOriginal) {
      if (got + calculated >= nOutputFramesOriginal) {
        const keep = nOutputFramesOriginal - calculated;
        uf = uf.slice([0, 0], [keep, -1]);
        uo = uo.slice([0, 0], [keep, -1]);
        uc = uc.slice([0, 0], [keep, -1]);
      }
      frames.push(...(await uf.array()));
      onsets.push(...(await uo.array()));
      contours.push(...(await uc.array()));
    }
    calculated += got;
    await breathe();
  }
  onProgress?.(1);

  const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
  const notes = noteFramesToTime(
    addPitchBendsToNoteEvents(
      contours,
      outputToNotesPoly(
        frames,
        onsets,
        opts.onsetThreshold,
        opts.frameThreshold,
        opts.minNoteLength,
        true,
        opts.maxMidi != null ? midiToHz(opts.maxMidi) : null,
        opts.minMidi != null ? midiToHz(opts.minMidi) : null,
        true
      )
    )
  );

  return notes
    .map((n) => ({
      startTimeSeconds: n.startTimeSeconds,
      durationSeconds: n.durationSeconds,
      pitchMidi: n.pitchMidi,
      amplitude: n.amplitude,
      pitchBends: n.pitchBends,
    }))
    .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds || a.pitchMidi - b.pitchMidi);
}
