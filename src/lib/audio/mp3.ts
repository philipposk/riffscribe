/** 128 kbps stereo MP3 — smaller than wav for phones and sharing. */
import lamejs from "lamejs";

import type { Channels } from "./wav";

function toInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/** Encode interleaved stereo float samples as MP3. */
export function encodeMp3(channels: Channels, sampleRate: number, kbps = 128): Blob {
  const left = toInt16(channels[0]);
  const right = toInt16(channels.length > 1 ? channels[1] : channels[0]);
  const encoder = new lamejs.Mp3Encoder(2, sampleRate, kbps);
  const block = 1152;
  const chunks: Int8Array[] = [];

  for (let i = 0; i < left.length; i += block) {
    const l = left.subarray(i, i + block);
    const r = right.subarray(i, i + block);
    const mp3buf = encoder.encodeBuffer(l, r);
    if (mp3buf.length) chunks.push(mp3buf);
  }
  const tail = encoder.flush();
  if (tail.length) chunks.push(tail);

  return new Blob(chunks as BlobPart[], { type: "audio/mpeg" });
}
