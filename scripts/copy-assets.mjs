#!/usr/bin/env node
// Copies runtime assets that must be served from /public:
//   - Basic Pitch TFJS model (audio -> MIDI)
//   - alphaTab music fonts + its worker/worklet bundles (score + tab rendering)
//   - onnxruntime-web wasm binaries (Demucs stem separation)
// Everything ships from our own origin so the app keeps working with COEP set
// and without any CDN round-trips.
import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pub = join(root, "public");
const nm = join(root, "node_modules");

const jobs = [
  { from: join(nm, "@spotify/basic-pitch/model"), to: join(pub, "models/basic-pitch") },
  { from: join(nm, "@coderline/alphatab/dist/font"), to: join(pub, "alphatab/font") },
  { from: join(nm, "@coderline/alphatab/dist/soundfont"), to: join(pub, "alphatab/soundfont"), optional: true },
];


async function copyDir(from, to, optional) {
  if (!existsSync(from)) {
    if (optional) return;
    console.warn(`[assets] missing ${from} — run npm install first`);
    return;
  }
  await mkdir(dirname(to), { recursive: true });
  await rm(to, { recursive: true, force: true });
  await cp(from, to, { recursive: true });
  console.log(`[assets] ${from.replace(root + "/", "")} -> ${to.replace(root + "/", "")}`);
}

// alphaTab ships its worker as a standalone bundle; copy the browser build too.
async function copyAlphaTabScripts() {
  const dist = join(nm, "@coderline/alphatab/dist");
  if (!existsSync(dist)) return;
  const out = join(pub, "alphatab");
  await mkdir(out, { recursive: true });
  for (const f of await readdir(dist)) {
    if (!/^alphaTab(\.min)?\.(m?js)$/.test(f)) continue;
    await cp(join(dist, f), join(out, f));
    console.log(`[assets] alphatab/${f}`);
  }
}

// onnxruntime-web needs its .wasm/.mjs siblings next to the loader. Only the
// threaded SIMD builds are copied — the full dist folder is hundreds of MB and
// would blow past the deployment size limit.
// The default `import * as ort from "onnxruntime-web"` entry point resolves to
// the jsep build (WebGPU + threaded WASM), so that is the only pair we need.
const ORT_KEEP = /^ort-wasm-simd-threaded\.jsep\.(wasm|mjs)$/;

async function copyOrtWasm() {
  const dist = join(nm, "onnxruntime-web/dist");
  if (!existsSync(dist)) return;
  const out = join(pub, "ort");
  await mkdir(out, { recursive: true });
  let n = 0;
  let bytes = 0;
  for (const f of await readdir(dist)) {
    if (!ORT_KEEP.test(f)) continue;
    const s = await stat(join(dist, f));
    if (!s.isFile()) continue;
    await cp(join(dist, f), join(out, f));
    bytes += s.size;
    n++;
  }
  console.log(`[assets] ort wasm files: ${n} (${(bytes / 1e6).toFixed(1)} MB)`);
}

// Signalsmith Stretch builds its AudioWorklet by stringifying its own loader
// function, which no bundler survives — so it is imported untouched at runtime
// from /vendor rather than going through the build.
async function copySignalsmith() {
  const src = join(nm, "signalsmith-stretch/SignalsmithStretch.mjs");
  if (!existsSync(src)) return;
  const out = join(pub, "vendor");
  await mkdir(out, { recursive: true });
  await cp(src, join(out, "SignalsmithStretch.mjs"));
  console.log("[assets] vendor/SignalsmithStretch.mjs");
}

for (const j of jobs) await copyDir(j.from, j.to, j.optional);
await copyAlphaTabScripts();
await copyOrtWasm();
await copySignalsmith();
