/**
 * Decoding for the real-data stages, through ffmpeg (so WAV, MP3 and the MUSDB `.stem.mp4`
 * multi-track files all come out the same way). Only the optional real-data stages use this;
 * the synthetic stages need no tools beyond Node.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

export function ffmpegPath() {
  if (process.env.RIFFSCRIBE_FFMPEG) return process.env.RIFFSCRIBE_FFMPEG;
  const probe = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  if (!probe.error && probe.status === 0) return "ffmpeg";
  if (existsSync("/opt/homebrew/bin/ffmpeg")) return "/opt/homebrew/bin/ffmpeg";
  throw new Error("ffmpeg not found: install it or set RIFFSCRIBE_FFMPEG");
}

/**
 * Decode one audio stream to float32 PCM at `sr` with `channels` channels.
 * Returns one Float32Array per channel. `stream` picks the Nth audio stream of the file.
 */
export function decode(file, { sr, channels = 1, stream = 0 }) {
  const r = spawnSync(
    ffmpegPath(),
    ["-v", "error", "-i", file, "-map", `0:a:${stream}`, "-ac", String(channels), "-ar", String(sr), "-f", "f32le", "-"],
    { maxBuffer: 1 << 30 }
  );
  if (r.status !== 0) throw new Error(`ffmpeg failed on ${file}: ${r.stderr?.toString().slice(0, 300)}`);
  const buf = r.stdout;
  const all = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength - (buf.byteLength % 4)));
  const n = Math.floor(all.length / channels);
  const out = Array.from({ length: channels }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < channels; c++) out[c][i] = all[i * channels + c];
  return out;
}
