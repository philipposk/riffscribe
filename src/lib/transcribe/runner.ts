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
import type { ContourPeaks, NoteEvent } from "../types";
import { pickPeaks } from "./contour";

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
  /** Basic Pitch's "melodia trick" (drop weak notes that only echo stronger ones). Default true. */
  melodiaTrick?: boolean;
  /** Also keep the top pitch-salience peaks per frame, for a continuous pitch curve. */
  wantPeaks?: boolean;
}

export interface TranscriptionResult {
  notes: NoteEvent[];
  /** Only when `wantPeaks` was asked for; null otherwise. */
  peaks: ContourPeaks | null;
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
/** A model output as Basic Pitch types it, named without importing TensorFlow. */
type Unwrappable = Parameters<BasicPitchModel["unwrapOutput"]>[0];

/**
 * The scope half of TensorFlow's engine: what `tf.tidy` is built on.
 *
 * Basic Pitch makes plenty of tensors we never see (the slice inside
 * `unwrapOutput`, the batch slice the model runs on, every step of
 * `prepareData`), and with no scope open the engine tracks none of them, so
 * disposing what we are handed leaves most of each run behind. We cannot
 * import TensorFlow for `tf.tidy` (see above), but the copy Basic Pitch loaded
 * registers its engine on the global object, and that is enough.
 */
export interface ScopeEngine {
  startScope(name?: string): void;
  endScope(result?: unknown): void;
  keep<T>(t: T): T;
}

/** Basic Pitch's TensorFlow engine, or null if none is loaded (then nothing is scoped). */
export function tensorEngine(ns: object = globalThis): ScopeEngine | null {
  const e = (ns as { _tfengine?: Partial<ScopeEngine> })._tfengine;
  return e && typeof e.startScope === "function" && typeof e.endScope === "function" && typeof e.keep === "function"
    ? (e as ScopeEngine)
    : null;
}

/**
 * `tf.tidy` without TensorFlow: run `fn` in a scope and dispose every tensor it
 * made except the ones it returns. Those are kept, so no other scope can take
 * them, and the caller disposes them. `fn` must be synchronous: an await inside
 * an open scope would let other code's tensors land in it.
 */
export function scoped<T extends readonly object[]>(eng: ScopeEngine | null, fn: () => T): T {
  if (!eng) return fn();
  eng.startScope();
  try {
    const out = fn();
    for (const t of out) eng.keep(t);
    return out;
  } finally {
    eng.endScope();
  }
}

let scopeQueue: Promise<unknown> = Promise.resolve();

/**
 * `scoped` for `prepareData`, which is async in name only: its work is done
 * by the time it returns, but its result is only reachable through an await,
 * so its scope stays open for a few microtasks. One at a time, so that two
 * runs on the page cannot end each other's scope.
 */
export function scopedAsync<T>(
  eng: ScopeEngine | null,
  fn: () => Promise<T>,
  survivors: (r: T) => readonly object[]
): Promise<T> {
  if (!eng) return fn();
  const run = scopeQueue.then(async () => {
    eng.startScope();
    try {
      const out = await fn();
      for (const t of survivors(out)) eng.keep(t);
      return out;
    } finally {
      eng.endScope();
    }
  });
  scopeQueue = run.catch(() => undefined);
  return run;
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

/** The notes alone; see `runTranscriptionFull` for the pitch-salience peaks as well. */
export async function runTranscription(
  mono22k: Float32Array,
  opts: RunOptions,
  onProgress?: (pct: number) => void,
  modelUrl: string = MODEL_PATH
): Promise<NoteEvent[]> {
  return (await runTranscriptionFull(mono22k, opts, onProgress, modelUrl)).notes;
}

export async function runTranscriptionFull(
  mono22k: Float32Array,
  opts: RunOptions,
  onProgress?: (pct: number) => void,
  modelUrl: string = MODEL_PATH
): Promise<TranscriptionResult> {
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

  // Tensors are freed by hand: every step runs in an engine scope (see
  // `scoped`), which disposes the intermediates Basic Pitch makes and never
  // hands us, and we dispose the few tensors that come out. On the page
  // fallback nothing else ever frees them, so without this every run would
  // leave its framed input and all of its output behind in memory.
  const eng = tensorEngine();
  const free = (...ts: ({ dispose?: () => void } | null | undefined)[]) => {
    for (const t of ts) t?.dispose?.();
  };

  // Mirrors BasicPitch.evaluateModel, with a yield added between windows.
  const [reshapedInput, audioOriginalLength] = await scopedAsync(
    eng,
    () => model.prepareData(mono22k),
    ([input]) => [input]
  );
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

  try {
    const graph = await model.model;
    for (let i = 0; i < windows; i++) {
      onProgress?.(i / windows);
      // Past the end of the audio: Basic Pitch keeps nothing from these windows either.
      if (calculated >= nOutputFramesOriginal) continue;
      // BasicPitch.evaluateSingleFrame, inlined: it awaits the model inside,
      // and a scope must not stay open across an await. Output names are its own.
      let got = 0;
      const [sf, so, sc] = scoped(eng, () => {
        const batch = reshapedInput.slice(i, 1);
        const [f, o, c] = graph.execute(batch, ["Identity_1", "Identity_2", "Identity"]) as Unwrappable[];
        let [uf, uo, uc] = [model.unwrapOutput(f), model.unwrapOutput(o), model.unwrapOutput(c)];
        got = uf.shape[0];
        if (got + calculated >= nOutputFramesOriginal) {
          const keep = nOutputFramesOriginal - calculated;
          uf = uf.slice([0, 0], [keep, -1]);
          uo = uo.slice([0, 0], [keep, -1]);
          uc = uc.slice([0, 0], [keep, -1]);
        }
        return [uf, uo, uc] as const;
      });
      try {
        frames.push(...(await sf.array()));
        onsets.push(...(await so.array()));
        contours.push(...(await sc.array()));
      } finally {
        free(sf, so, sc);
      }
      calculated += got;
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
        opts.melodiaTrick ?? true
      )
    )
  );

  // addPitchBendsToNoteEvents only reads the contour rows, so they are intact here.
  const peaks = opts.wantPeaks ? pickPeaks(contours) : null;

  const out = notes
    .map((n) => ({
      startTimeSeconds: n.startTimeSeconds,
      durationSeconds: n.durationSeconds,
      pitchMidi: n.pitchMidi,
      amplitude: n.amplitude,
      pitchBends: n.pitchBends,
    }))
    .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds || a.pitchMidi - b.pitchMidi);
  return { notes: out, peaks };
}
