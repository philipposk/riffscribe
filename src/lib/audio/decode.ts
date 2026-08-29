/** File → AudioBuffer → the exact rate/channel layout each model expects. */

let sharedCtx: AudioContext | null = null;
export function audioContext() {
  if (!sharedCtx) sharedCtx = new AudioContext();
  return sharedCtx;
}

export async function fileToAudioBuffer(file: File | Blob): Promise<AudioBuffer> {
  const bytes = await file.arrayBuffer();
  return audioContext().decodeAudioData(bytes);
}

/** Resample + force stereo. Uses the browser's own resampler, which is good. */
export async function toStereo(
  buffer: AudioBuffer,
  targetRate: number
): Promise<{ left: Float32Array; right: Float32Array; sampleRate: number }> {
  const frames = Math.max(1, Math.round(buffer.duration * targetRate));
  const ctx = new OfflineAudioContext(2, frames, targetRate);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const splitter = ctx.createChannelSplitter(2);
  const merger = ctx.createChannelMerger(2);
  src.connect(splitter);
  if (buffer.numberOfChannels === 1) {
    splitter.connect(merger, 0, 0);
    splitter.connect(merger, 0, 1);
  } else {
    splitter.connect(merger, 0, 0);
    splitter.connect(merger, 1, 1);
  }
  merger.connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  return {
    left: out.getChannelData(0).slice(),
    right: out.getChannelData(1).slice(),
    sampleRate: targetRate,
  };
}

export function toMono(left: Float32Array, right: Float32Array) {
  const out = new Float32Array(left.length);
  for (let i = 0; i < left.length; i++) out[i] = (left[i] + (right[i] ?? left[i])) / 2;
  return out;
}

/** Peak envelope for waveform drawing. */
export function peaks(mono: Float32Array, buckets: number) {
  const out = new Float32Array(buckets);
  const step = Math.max(1, Math.floor(mono.length / buckets));
  for (let b = 0; b < buckets; b++) {
    let peak = 0;
    const start = b * step;
    for (let i = start; i < start + step && i < mono.length; i++) {
      const v = Math.abs(mono[i]);
      if (v > peak) peak = v;
    }
    out[b] = peak;
  }
  return out;
}
