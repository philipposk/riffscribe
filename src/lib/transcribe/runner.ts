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
import type { BasicPitch as BasicPitchModel } from "@spotify/basic-pitch";
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

const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/**
 * The frequency limits to hand Basic Pitch for an inclusive MIDI range.
 *
 * It turns a limit back into a pitch-bin index and zeroes with Array.fill,
 * which truncates the index: from the max index up, and below the min index.
 * Passing the range's own top note zeroed that note, so the top of every
 * instrument was never heard. Half a step inside each next bin keeps both
 * ends and is safe from float round-off.
 */
export function detectionLimits(minMidi?: number, maxMidi?: number): { maxHz: number | null; minHz: number | null } {
  return {
    maxHz: maxMidi != null ? midiToHz(maxMidi + 1.5) : null,
    minHz: minMidi != null ? midiToHz(minMidi + 0.5) : null,
  };
}

const models = new Map<string, BasicPitchModel>();

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

  // One model per URL for the life of the page. A fresh one per run left a
  // whole copy of the weights behind each time on the page fallback.
  let model = models.get(modelUrl);
  if (!model) {
    model = new BasicPitch(modelUrl);
    models.set(modelUrl, model);
  }
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

  // Tensors are freed by hand: no tf.tidy without importing TensorFlow, and
  // on the main-thread fallback nothing else ever frees them, so every run
  // would leave its whole output behind in memory.
  const free = (...ts: ({ dispose?: () => void } | null | undefined)[]) => {
    for (const t of ts) t?.dispose?.();
  };
  try {
    for (let i = 0; i < windows; i++) {
      onProgress?.(i / windows);
      const [f, o, c] = await model.evaluateSingleFrame(reshapedInput, i);
      const uf = model.unwrapOutput(f);
      const uo = model.unwrapOutput(o);
      const uc = model.unwrapOutput(c);
      const cut: { dispose?: () => void }[] = [];
      try {
        const got = uf.shape[0];
        if (calculated < nOutputFramesOriginal) {
          let [sf, so, sc] = [uf, uo, uc];
          if (got + calculated >= nOutputFramesOriginal) {
            const keep = nOutputFramesOriginal - calculated;
            sf = uf.slice([0, 0], [keep, -1]);
            so = uo.slice([0, 0], [keep, -1]);
            sc = uc.slice([0, 0], [keep, -1]);
            cut.push(sf, so, sc);
          }
          frames.push(...(await sf.array()));
          onsets.push(...(await so.array()));
          contours.push(...(await sc.array()));
        }
        calculated += got;
      } finally {
        free(f, o, c, uf, uo, uc, ...cut);
      }
      await breathe();
    }
  } catch (e) {
    models.delete(modelUrl); // a model that failed to load must not be kept for the next run
    throw e;
  } finally {
    free(reshapedInput);
  }
  onProgress?.(1);

  const limits = detectionLimits(opts.minMidi, opts.maxMidi);
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
        limits.maxHz,
        limits.minHz,
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
