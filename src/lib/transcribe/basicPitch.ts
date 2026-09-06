/**
 * Audio → notes, using Spotify's Basic Pitch model (Apache-2.0) running
 * entirely in the browser via TensorFlow.js. Nothing is uploaded anywhere.
 *
 * The model wants mono 22.05 kHz, so we resample with an OfflineAudioContext
 * (the browser's own high-quality resampler) before handing it over.
 */
import type { NoteEvent } from "../types";

import { MODEL_PATH, runTranscription, BASIC_PITCH_SAMPLE_RATE as SR } from "./runner";

export const BASIC_PITCH_SAMPLE_RATE = SR;

/**
 * We deliberately do NOT import TensorFlow.js ourselves.
 *
 * Basic Pitch brings its own copy and creates its tensors through it. Importing
 * tfjs here as well — to force a backend — produced a second instance, and
 * tensors made by one were then written through the other's backend registry,
 * which fails outright with "Unknown dtype undefined". Letting Basic Pitch pick
 * its own backend is both simpler and the only arrangement that works.
 */
export async function transcriptionBackend(): Promise<string> {
  return "";
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

/** Where the work happened, so the UI can say something honest about it. */
export type TranscribeWhere = "worker" | "page";
let lastWhere: TranscribeWhere = "page";
export function lastTranscriptionRanIn(): TranscribeWhere {
  return lastWhere;
}

/** Set once a worker has failed, so we stop paying to find out again. */
let workerBroken = false;

function inWorker(
  mono22k: Float32Array,
  opts: TranscribeOptions
): Promise<NoteEvent[]> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("../workers/transcribe.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch (e) {
      return reject(e instanceof Error ? e : new Error("worker could not start"));
    }
    // Basic Pitch can take a while to say whether it works at all in here.
    // Nothing should hang the studio forever if it never answers.
    const giveUp = setTimeout(() => {
      worker.terminate();
      reject(new Error("the worker did not start in time"));
    }, 20000);
    let started = false;

    worker.onerror = (e) => {
      clearTimeout(giveUp);
      worker.terminate();
      reject(new Error(e.message || "worker crashed"));
    };
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === "progress") {
        if (!started) {
          started = true;
          clearTimeout(giveUp); // it is alive; let it take as long as it needs
        }
        opts.onProgress?.(m.value);
      } else if (m.type === "done") {
        worker.terminate();
        resolve(m.notes as NoteEvent[]);
      } else if (m.type === "error") {
        worker.terminate();
        reject(new Error(m.message));
      }
    };

    const copy = Float32Array.from(mono22k);
    worker.postMessage(
      {
        audio: copy,
        options: {
          onsetThreshold: opts.onsetThreshold,
          frameThreshold: opts.frameThreshold,
          minNoteLength: opts.minNoteLength,
          minMidi: opts.minMidi,
          maxMidi: opts.maxMidi,
        },
        modelUrl: new URL(MODEL_PATH, location.origin).href,
      },
      [copy.buffer]
    );
  });
}

/**
 * Transcribe, off the page where the browser allows it.
 *
 * A worker keeps the studio usable while a four-minute song is analysed. Where
 * one cannot run — TensorFlow needs a canvas for its WebGL backend and does not
 * always get a usable one in a worker — the identical loop runs on the page,
 * yielding a real task between analysis windows so the tab still responds.
 */
export async function transcribeAudio(
  mono22k: Float32Array,
  opts: TranscribeOptions
): Promise<NoteEvent[]> {
  if (!workerBroken && typeof Worker !== "undefined") {
    try {
      const notes = await inWorker(mono22k, opts);
      lastWhere = "worker";
      return notes;
    } catch (e) {
      workerBroken = true;
      console.info(
        "[riffscribe] transcription worker unavailable, running on the page instead:",
        e instanceof Error ? e.message : e
      );
    }
  }
  lastWhere = "page";
  return runTranscription(
    mono22k,
    {
      onsetThreshold: opts.onsetThreshold,
      frameThreshold: opts.frameThreshold,
      minNoteLength: opts.minNoteLength,
      minMidi: opts.minMidi,
      maxMidi: opts.maxMidi,
    },
    opts.onProgress
  );
}
