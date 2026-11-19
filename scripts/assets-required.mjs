// What the app cannot run without, relative to /public. copy-assets.mjs checks these
// after copying so a renamed or moved dependency file fails the build instead of
// shipping a site with a missing Demucs runtime or transcription model.
import { existsSync } from "node:fs";
import { join } from "node:path";

export const REQUIRED_ASSETS = [
  "models/basic-pitch/model.json",
  "models/basic-pitch/group1-shard1of1.bin",
  "ort/ort-wasm-simd-threaded.jsep.wasm",
  "ort/ort-wasm-simd-threaded.jsep.mjs",
  "vendor/SignalsmithStretch.mjs",
  "alphatab/font",
  "alphatab/alphaTab.mjs",
];

/** The required files that are absent under `pub`. */
export function missingAssets(pub) {
  return REQUIRED_ASSETS.filter((rel) => !existsSync(join(pub, rel)));
}
