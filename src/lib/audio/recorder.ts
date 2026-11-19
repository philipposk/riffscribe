/**
 * Overdub recording — sing or play along, then hear yourself against the mix.
 *
 * Two details make this actually usable:
 *  1. If you recorded while the song was slowed to 60%, the take is converted
 *     back to full speed *without* turning you into a chipmunk (offline
 *     time-stretch), so it lines up with the original tempo.
 *  2. Sound takes time to get out of the speakers and back through the mic, so
 *     the take is nudged earlier by the measured round-trip latency.
 */
import { loadStretch } from "./stretchLoader";

export interface Take {
  left: Float32Array;
  right: Float32Array;
  /** Position in the song (input-time seconds) where this take starts. */
  startSeconds: number;
  sampleRate: number;
}

export class MicRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private mimeType = "";

  async arm() {
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
  }

  get armed() {
    return !!this.stream;
  }

  start() {
    if (!this.stream) throw new Error("microphone not armed");
    this.chunks = [];
    this.mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "";
    this.recorder = new MediaRecorder(this.stream, this.mimeType ? { mimeType: this.mimeType } : undefined);
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start(200);
  }

  stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const rec = this.recorder;
      if (!rec) return reject(new Error("not recording"));
      rec.onstop = () => resolve(new Blob(this.chunks, { type: this.mimeType || "audio/webm" }));
      rec.stop();
      this.recorder = null;
    });
  }

  /** Close the microphone. Also ends a take that is still running, so nothing keeps the stream alive. */
  release() {
    const rec = this.recorder;
    if (rec && rec.state !== "inactive") {
      rec.onstop = null;
      try { rec.stop(); } catch { /* already stopped */ }
    }
    this.recorder = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}

/**
 * Offline time-stretch, pitch preserved. `rate` follows the Signalsmith
 * convention: output length = input length / rate.
 */
export async function stretchOffline(
  channels: Float32Array[],
  sampleRate: number,
  rate: number,
  semitones = 0
): Promise<Float32Array[]> {
  if (Math.abs(rate - 1) < 1e-4 && semitones === 0) return channels;
  const inputLength = channels[0].length;
  const outputLength = Math.ceil(inputLength / rate) + Math.ceil(sampleRate * 0.25);
  const ctx = new OfflineAudioContext(channels.length, outputLength, sampleRate);
  const SignalsmithStretch = await loadStretch();
  const node = await SignalsmithStretch(ctx, {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [channels.length],
  });
  await node.addBuffers(channels);
  node.connect(ctx.destination);
  await node.schedule({ output: 0, active: true, input: 0, rate, semitones });
  const rendered = await ctx.startRendering();
  const out: Float32Array[] = [];
  for (let c = 0; c < channels.length; c++) out.push(rendered.getChannelData(c).slice());
  return out;
}

/** Lay a take into a buffer of `totalSamples`, positioned at its start time. */
export function placeTake(take: Take, totalSamples: number): [Float32Array, Float32Array] {
  const left = new Float32Array(totalSamples);
  const right = new Float32Array(totalSamples);
  const offset = Math.round(take.startSeconds * take.sampleRate);
  for (let i = 0; i < take.left.length; i++) {
    const t = offset + i;
    if (t < 0 || t >= totalSamples) continue;
    left[t] += take.left[i];
    right[t] += take.right[i] ?? take.left[i];
  }
  return [left, right];
}

/**
 * A take recorded while a loop repeated. Playback jumped back to the loop start on every
 * pass but the recording ran straight on, so laid out as-is pass 2 would land on the bars
 * after the loop. Keep one pass at the place in the song it was played against: the last
 * complete one, or the longest if none completed. A take that never wrapped is unchanged.
 */
export function foldLoopTake(take: Take, loop: [number, number]): Take {
  const sr = take.sampleRate;
  const [a, b] = loop;
  const span = Math.round((b - a) * sr);
  const firstWrap = Math.round((b - take.startSeconds) * sr);
  const n = take.left.length;
  if (span <= 0 || firstWrap <= 0 || firstWrap >= n) return take;

  // Pass 0 runs from where recording started to the loop end; it is complete only if it
  // started at or before the loop start. Every later pass starts at the loop start.
  const passes = [{ from: 0, to: firstWrap, at: take.startSeconds, full: take.startSeconds <= a + 0.05 }];
  for (let from = firstWrap; from < n; from += span) {
    const to = Math.min(n, from + span);
    passes.push({ from, to, at: a, full: to - from >= span });
  }
  const full = passes.filter((p) => p.full);
  const pick = full.length
    ? full[full.length - 1]
    : passes.reduce((best, p) => (p.to - p.from > best.to - best.from ? p : best));
  return {
    left: take.left.slice(pick.from, pick.to),
    right: take.right.slice(pick.from, pick.to),
    startSeconds: pick.at,
    sampleRate: sr,
  };
}

/** Best guess at speaker→mic round-trip delay, in seconds. */
export function estimateLatency(ctx: AudioContext | null) {
  if (!ctx) return 0.12;
  const out = (ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0;
  return Math.max(0.02, (ctx.baseLatency || 0) + out + 0.02);
}
