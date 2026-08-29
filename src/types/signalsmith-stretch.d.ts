declare module "signalsmith-stretch" {
  export interface StretchSchedule {
    output?: number;
    active?: boolean;
    input?: number;
    rate?: number;
    semitones?: number;
    tonalityHz?: number;
    formantSemitones?: number;
    formantCompensation?: boolean;
    formantBaseHz?: number;
    loopStart?: number;
    loopEnd?: number;
  }

  export interface StretchNode extends AudioNode {
    inputTime: number;
    schedule(s: StretchSchedule): Promise<unknown>;
    start(when?: number, offset?: number, duration?: number): Promise<unknown>;
    stop(when?: number): Promise<unknown>;
    addBuffers(buffers: Float32Array[]): Promise<number>;
    dropBuffers(toSeconds?: number): Promise<unknown>;
    latency(): Promise<number>;
    configure(opts: { blockMs?: number | null; intervalMs?: number; splitComputation?: boolean; preset?: string }): Promise<unknown>;
    setUpdateInterval(seconds: number, callback?: (time: number) => void): Promise<unknown>;
  }

  export default function SignalsmithStretch(
    ctx: BaseAudioContext,
    channelOptions?: AudioWorkletNodeOptions
  ): Promise<StretchNode>;
}

declare module "demucs-web" {
  export const CONSTANTS: {
    SAMPLE_RATE: number;
    TRACKS: string[];
    DEFAULT_MODEL_URL: string;
  };
  export interface SeparationResult {
    drums: { left: Float32Array; right: Float32Array };
    bass: { left: Float32Array; right: Float32Array };
    other: { left: Float32Array; right: Float32Array };
    vocals: { left: Float32Array; right: Float32Array };
  }
  export class DemucsProcessor {
    constructor(opts: {
      ort: unknown;
      modelPath?: string;
      sessionOptions?: unknown;
      onProgress?: (info: { progress: number; currentSegment: number; totalSegments: number }) => void;
      onLog?: (phase: string, message: string) => void;
      onDownloadProgress?: (loaded: number, total: number) => void;
    });
    loadModel(pathOrBuffer?: string | ArrayBuffer): Promise<void>;
    separate(left: Float32Array, right: Float32Array): Promise<SeparationResult>;
  }
}
