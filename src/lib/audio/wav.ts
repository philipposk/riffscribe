/** Minimal 16-bit / 32-bit-float WAV encoding for exports and downloads. */

export type Channels = Float32Array[];

function interleave(channels: Channels): Float32Array {
  const ch = channels.length;
  const len = channels[0].length;
  if (ch === 1) return channels[0];
  const out = new Float32Array(len * ch);
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) out[i * ch + c] = channels[c][i];
  }
  return out;
}

/** 16-bit PCM WAV — universally openable (DAWs, phones, Finder preview). */
export function encodeWav(channels: Channels, sampleRate: number): Blob {
  const data = interleave(channels);
  const numChannels = channels.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + data.length * bytesPerSample);
  const view = new DataView(buffer);

  const str = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  str(0, "RIFF");
  view.setUint32(4, 36 + data.length * bytesPerSample, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  str(36, "data");
  view.setUint32(40, data.length * bytesPerSample, true);

  let off = 44;
  for (let i = 0; i < data.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, data[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export function audioBufferToWav(buf: AudioBuffer): Blob {
  const chans: Channels = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
  return encodeWav(chans, buf.sampleRate);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
