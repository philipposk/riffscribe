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

  release() {
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
  rate: number
): Promise<Float32Array[]> {
  if (Math.abs(rate - 1) < 1e-4) return channels;
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
  await node.schedule({ output: 0, active: true, input: 0, rate, semitones: 0 });
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

/** Best guess at speaker→mic round-trip delay, in seconds. */
export function estimateLatency(ctx: AudioContext | null) {
  if (!ctx) return 0.12;
  const out = (ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0;
  return Math.max(0.02, (ctx.baseLatency || 0) + out + 0.02);
}
