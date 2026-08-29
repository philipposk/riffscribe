/**
 * Audio → notes, using Spotify's Basic Pitch model (Apache-2.0) running
 * entirely in the browser via TensorFlow.js. Nothing is uploaded anywhere.
 *
 * The model wants mono 22.05 kHz, so we resample with an OfflineAudioContext
 * (the browser's own high-quality resampler) before handing it over.
 */
import type { NoteEvent } from "../types";

const MODEL_URL = "/models/basic-pitch/model.json";

export const BASIC_PITCH_SAMPLE_RATE = 22050;

let cached: Promise<typeof import("@spotify/basic-pitch")> | null = null;
function lib() {
  if (!cached) cached = import("@spotify/basic-pitch");
  return cached;
}

let backendReady: Promise<string> | null = null;

/**
 * Pick a TensorFlow.js backend.
 *
 * WebGL is the fastest on Chrome, but on WebKit/Safari reading results back off
 * the GPU can stall indefinitely for this model — the run just stops mid-way
 * with no error. So Safari goes straight to WASM, and everyone else falls back
 * to WASM (then plain CPU) if WebGL cannot be initialised.
 */
async function ensureBackend(): Promise<string> {
  if (backendReady) return backendReady;
  backendReady = (async () => {
    const tf = await import("@tensorflow/tfjs");
    const { setWasmPaths } = await import("@tensorflow/tfjs-backend-wasm");
    setWasmPaths("/tfjs-wasm/");

    const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
    const isWebKit = /safari/i.test(ua) && !/chrome|chromium|edg|android/i.test(ua);
    const order = isWebKit ? ["wasm", "cpu"] : ["webgl", "wasm", "cpu"];

    for (const backend of order) {
      try {
        if (await tf.setBackend(backend)) {
          await tf.ready();
          return backend;
        }
      } catch {
        /* try the next one */
      }
    }
    await tf.ready();
    return tf.getBackend();
  })();
  return backendReady;
}

export function transcriptionBackend() {
  return backendReady;
}

/** Down-mix + resample any AudioBuffer to the mono 22.05 kHz the model expects. */
export async function toModelInput(buffer: AudioBuffer): Promise<Float32Array> {
  const frames = Math.max(1, Math.round((buffer.duration * BASIC_PITCH_SAMPLE_RATE)));
  const ctx = new OfflineAudioContext(1, frames, BASIC_PITCH_SAMPLE_RATE);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  return out.getChannelData(0).slice();
}

export function channelsToAudioBuffer(
  channels: Float32Array[],
  sampleRate: number
): AudioBuffer {
  const Ctor: typeof AudioContext =
    (window as unknown as { AudioContext: typeof AudioContext }).AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctor({ sampleRate });
  const buf = ctx.createBuffer(channels.length, channels[0].length, sampleRate);
  // copyToChannel's type wants a non-shared backing buffer; ours always is one
  channels.forEach((c, i) => buf.copyToChannel(c as Float32Array<ArrayBuffer>, i));
  void ctx.close();
  return buf;
}

export interface TranscribeOptions {
  onsetThreshold: number;
  frameThreshold: number;
  minNoteLength: number;
  /** Restrict detection to an instrument's playable range (fewer ghost notes). */
  minMidi?: number;
  maxMidi?: number;
  onProgress?: (pct: number) => void;
}

export async function transcribeAudio(
  mono22k: Float32Array,
  opts: TranscribeOptions
): Promise<NoteEvent[]> {
  await ensureBackend();
  const {
    BasicPitch,
    noteFramesToTime,
    addPitchBendsToNoteEvents,
    outputToNotesPoly,
  } = await lib();

  const model = new BasicPitch(MODEL_URL);
  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];

  await model.evaluateModel(
    mono22k,
    (f, o, c) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    (p) => opts.onProgress?.(p)
  );

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
