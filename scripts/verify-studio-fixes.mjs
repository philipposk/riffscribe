#!/usr/bin/env node
/**
 * Checks the November 2026 studio fixes that have pure logic behind them:
 *   - a single line keeps the top note unless the part was cleaned up as one voice
 *   - an audio export that fails says so (and clears its busy banner)
 *   - the assistant's "export as mp3/wav" uses the format it just picked, and waits for a job
 *   - the mixer save leaves the take's size alone; the take has its own entry
 *   - "split it again" drops the transcription passes but keeps the parts, settings, mixer and take
 *
 * Run with: node --experimental-strip-types scripts/verify-studio-fixes.mjs
 */
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/* Audio and browser-only modules the exports and assistant import, replaced by stand-ins. */
globalThis.__exportFail = null;
globalThis.__downloads = [];
const STUBS = {
  "@/lib/audio/mp3": `export function encodeMp3() { if (globalThis.__exportFail === "mp3") throw new Error("out of memory"); return new Blob(["mp3"]); }`,
  "@/lib/audio/recorder": `export async function stretchOffline(ch) { if (globalThis.__exportFail === "stretch") throw new Error("worklet failed"); return ch; }`,
  "@/lib/audio/wav": `export function encodeWav() { return new Blob(["wav"]); } export function downloadBlob(b, name) { globalThis.__downloads.push(name); }`,
  "@/lib/audio/stems": `export const DEMUCS_SAMPLE_RATE = 44100; export function mixStems(parts, keys) { return parts[keys[0]]; }`,
  "@/lib/transcribe/midi": `export function partsToMidi() { return new Uint8Array(0); }`,
  "@/lib/transcribe/musicxml": `export function sheetsToMusicXml() { return ""; }`,
  "@/lib/native": `export async function nativeDeviceMemoryGb() { return null; }`,
};
registerHooks({
  resolve(spec, ctx, next) {
    if (STUBS[spec] !== undefined) {
      return { url: `data:text/javascript,${encodeURIComponent(STUBS[spec])}`, shortCircuit: true };
    }
    if (spec.startsWith("@/")) spec = pathToFileURL(join(root, "src", spec.slice(2) + ".ts")).href;
    else if (spec.startsWith(".") && !/\.[cm]?[jt]s$/.test(spec) && ctx.parentURL?.includes("/src/")) spec += ".ts";
    return next(spec, ctx);
  },
});

/* A minimal in-memory IndexedDB: enough for cache.ts. */
class Range {
  constructor(lo, hi) { this.lo = lo; this.hi = hi; }
  includes(k) { return k >= this.lo && k <= this.hi; }
}
globalThis.IDBKeyRange = { bound: (lo, hi) => new Range(lo, hi) };
const stores = new Map();
function request(fn) {
  const req = {};
  setTimeout(() => { req.result = fn(); req.onsuccess?.(); });
  return req;
}
function storeApi(st) {
  return {
    get: (k) => request(() => st.rows.get(k)),
    getAll: () => request(() => [...st.rows.values()]),
    put: (v, k) => request(() => { st.rows.set(st.keyPath ? v[st.keyPath] : k, v); }),
    delete: (k) => request(() => {
      if (k instanceof Range) { for (const key of [...st.rows.keys()]) if (k.includes(key)) st.rows.delete(key); }
      else st.rows.delete(k);
    }),
  };
}
const db = {
  objectStoreNames: { contains: (n) => stores.has(n) },
  createObjectStore: (n, opts) => stores.set(n, { keyPath: opts?.keyPath, rows: new Map() }),
  transaction: (n) => ({ objectStore: () => storeApi(stores.get(n)) }),
};
globalThis.indexedDB = {
  open: () => {
    const req = {};
    setTimeout(() => { req.result = db; req.onupgradeneeded?.(); req.onsuccess?.(); });
    return req;
  },
};

const load = (p) => import(p).catch((e) => { console.log(e.message); return null; });
const quantizeMod = await load("../src/lib/transcribe/quantize.ts");
const engrave = await load("../src/lib/transcribe/engrave.ts");
const types = await load("../src/lib/types.ts");
const exportsMod = await load("../src/components/studio/exports.ts");
const errors = await load("../src/components/studio/errors.ts");
const assistant = await load("../src/components/studio/assistantActions.ts");
const cache = await load("../src/lib/store/cache.ts");
if (!quantizeMod || !engrave || !types || !exportsMod || !errors || !assistant || !cache) {
  console.log("run with: node --experimental-strip-types scripts/verify-studio-fixes.mjs");
  process.exit(1);
}
const { quantize } = quantizeMod;
const { DEFAULT_SETTINGS } = types;

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log("ok -", name); };
const settle = () => new Promise((r) => setTimeout(r, 20));

/* ------------------------------------------------- single-line strategies */
const note = (start, dur, midi, amp = 0.6) => ({ startTimeSeconds: start, durationSeconds: dur, pitchMidi: midi, amplitude: amp });
const S = { ...DEFAULT_SETTINGS, bpm: 120, offsetSeconds: 0, timeSignature: [4, 4], quantizeDivision: 16, monophonic: true };
const firstNotes = (sh) => sh.bars[0].slots[0].notes.map((x) => x.midi);
const heldUnits = (sh, midi) =>
  sh.bars.flatMap((b) => b.slots).filter((x) => x.notes.some((y) => y.midi === midi)).reduce((s, x) => s + x.lengthUnits, 0);

// a chord whose root is louder than the melody note on top
const chord = [note(0, 1, 48, 0.9), note(0, 1, 72, 0.4)];
await ok("by default a single line keeps the top note of a chord", () => {
  assert.deepEqual(firstNotes(quantize(chord, S)), [72]);
});
await ok("a voice line keeps the louder note (the octave ghost goes)", () => {
  const sung = [note(0, 1, 57, 0.6), note(0, 1, 69, 0.25)];
  assert.deepEqual(firstNotes(quantize(sung, { ...S, monoStrategy: "louder" })), [57]);
});
await ok("a voice line drops a short weak blip inside a held note", () => {
  const sh = quantize([note(0, 2, 60, 0.6), note(0.5, 0.05, 62, 0.2)], { ...S, monoStrategy: "louder" });
  assert.equal(heldUnits(sh, 60), 16);
});
await ok("a voice line keeps a long or not-much-weaker note inside a held one", () => {
  const long = quantize([note(0, 2, 60, 0.6), note(0.5, 0.5, 62, 0.2)], { ...S, monoStrategy: "louder" });
  assert.ok(heldUnits(long, 62) > 0, "long note kept");
  const close = quantize([note(0, 2, 60, 0.6), note(0.5, 0.05, 62, 0.5)], { ...S, monoStrategy: "louder" });
  assert.equal(heldUnits(close, 60), 4, "not-much-weaker note cuts the held one");
});
await ok("the top-note rule lets a later note cut a held one, as before", () => {
  const sh = quantize([note(0, 2, 60, 0.9), note(0.5, 0.25, 67, 0.3)], S);
  assert.equal(heldUnits(sh, 60), 4);
  assert.ok(heldUnits(sh, 67) > 0);
});
await ok("engraving: only a part cleaned up as one line keeps the louder note", () => {
  const base = { source: "other", instrument: "piano", notes: chord, keyName: "C", keyMode: "major" };
  const [legacy, cleaned] = engrave.engraveParts(
    [{ ...base, id: "a" }, { ...base, id: "b", monophonic: true }],
    { ...S, monophonic: true }
  );
  assert.deepEqual(firstNotes(legacy.sheet), [72]);
  assert.deepEqual(firstNotes(cleaned.sheet), [48]);
});

/* --------------------------------------------------------- audio exports */
const ch = { left: new Float32Array(100), right: new Float32Array(100) };
function exportCtx(over = {}) {
  const calls = { busy: [], error: [] };
  const x = {
    audio: ch, stems: null, stemMode: "none", overdub: null, guideTracks: [], clickTrack: null,
    trackList: [{ id: "original", label: "Original" }], mix: {}, activeSolo: null, loop: null, loopOnlyExport: false,
    transport: { rate: 0.5, semitones: 0 }, exportFormat: "wav", baseName: "song",
    setBusy: (b) => calls.busy.push(b), setError: (e) => calls.error.push(e), ...over,
  };
  return { x, calls };
}
await ok("a failed export says so and clears its busy banner", async () => {
  globalThis.__exportFail = "stretch";
  const { x, calls } = exportCtx();
  const done = await exportsMod.downloadChannels(x, ch, "mix");
  assert.equal(done, false);
  assert.equal(calls.busy.at(-1), null);
  assert.equal(calls.error.length, 1);
  assert.ok(calls.error[0].startsWith("The download could not be prepared."), calls.error[0]);
  assert.ok(calls.error[0].includes("worklet failed"));
});
await ok("an mp3 encode that throws is reported too, not left unhandled", async () => {
  globalThis.__exportFail = "mp3";
  const { x, calls } = exportCtx({ exportFormat: "mp3", transport: { rate: 1, semitones: 0 } });
  await exportsMod.exportTrack(x, "original");
  assert.ok(calls.error.at(-1)?.includes("out of memory"));
  globalThis.__exportFail = null;
});
await ok("a working export downloads in the format it was given", async () => {
  globalThis.__downloads.length = 0;
  const { x } = exportCtx({ exportFormat: "mp3" });
  assert.equal(await exportsMod.downloadChannels(x, ch, "mix"), true);
  assert.deepEqual(globalThis.__downloads, ["song-mix.mp3"]);
});
await ok("the export error has its own sentence", () => {
  assert.ok(errors.humanError(new Error("x"), "export").startsWith("The download could not be prepared."));
});

/* -------------------------------------------------- assistant exportFile */
function actions(over = {}) {
  const calls = { format: [], audio: [], track: [] };
  const noop = () => {};
  const a = assistant.buildAssistantActions({
    audio: ch, file: null, signedIn: null, transport: { playing: false, time: 0, duration: 1, rate: 1, semitones: 0, rendering: null },
    settings: DEFAULT_SETTINGS, stems: null, stemMode: "none", parts: [], loop: null, busy: null,
    trackList: [{ id: "vocals", label: "Vocals" }], mix: {}, activeSolo: null, overdub: null, report: null,
    engineRef: { current: null }, patch: noop, runInstant: async () => true, runDemucs: async () => true,
    runTranscribe: async () => true, checkTake: async () => null, loopWorstBars: noop, arrangeForEnsemble: noop,
    setAiSplitCautionGb: noop, setSource: noop, setLoop: noop, setSoloed: noop, setMix: noop,
    setExportFormat: (f) => calls.format.push(f), setEnsembleSize: noop, setPlayAlong: noop,
    exportMidi: noop, exportMusicXml: noop, exportTex: noop,
    exportAudio: async (kind, fmt) => { calls.audio.push([kind, fmt]); },
    exportTrack: async (id, fmt) => { calls.track.push([id, fmt]); },
    ...over,
  });
  return { a, calls };
}
await ok("'the mix as mp3' downloads an mp3, not the format still in state", () => {
  const { a, calls } = actions();
  a.exportFile("the mix as mp3");
  assert.deepEqual(calls.format, ["mp3"]);
  assert.deepEqual(calls.audio, [["mix", "mp3"]]);
});
await ok("'vocals as wav' and 'backing' pass their format along (or none)", () => {
  const { a, calls } = actions();
  a.exportFile("vocals as wav");
  a.exportFile("backing track");
  assert.deepEqual(calls.track, [["vocals", "wav"]]);
  assert.deepEqual(calls.audio, [["backing", undefined]]);
});
await ok("no audio export while a job runs, and the assistant says so", () => {
  const { a, calls } = actions({ busy: { label: "Separating stems" } });
  const said = a.exportFile("the mix");
  assert.equal(calls.audio.length, 0);
  assert.ok(said.includes("Separating stems"), said);
});

/* ------------------------------------------------------------- the cache */
const A = "a".repeat(64);
const take = { codec: "pcm16", frames: 250, rate: 44100, data: new Uint8Array(1000) };
const silent = { left: new Float32Array(10), right: new Float32Array(10) };
const row = (k) => stores.get("songs").rows.get(k);
const scoreKeys = () => [...stores.get("transcriptions").rows.keys()].sort();

await cache.putStems(A, "song a", { vocals: silent }, 44100, "instant");
await cache.putOverdub(A, take);
await settle();
await ok("the take has its own entry and counts toward the budget", async () => {
  assert.equal((await cache.getOverdub(A)).data.byteLength, 1000);
  assert.equal(row(A).sessionBytes, 1000);
});
await ok("a mixer-only save leaves the take's size alone", async () => {
  await cache.putSession(A, { mix: { vocals: { gain: 0.5, muted: false } }, soloed: null });
  await settle();
  assert.equal(row(A).sessionBytes, 1000);
});
await ok("clearing the take drops its entry and its size", async () => {
  await cache.putOverdub(A, null);
  await settle();
  assert.equal(await cache.getOverdub(A), null);
  assert.equal(row(A).sessionBytes, 0);
  await cache.putOverdub(A, take);
});
await ok("'split it again' drops the passes and the stems, keeps the user's work", async () => {
  await cache.putScore(A, "parts", [{ id: "p" }]);
  await cache.putScore(A, "settings", { bpm: 100 });
  await cache.putScore(A, "instant:vocals:cello:0.5:0.3:11:v2:voice", [1]);
  await cache.putScore(A, "instant:vocals:cello:0.5:0.3:11:v2:voice:peaks", [2]);
  await cache.putScore(A, "trim:0-100:instant:vocals:cello:0.5:0.3:11:v2:voice", [3]);
  await cache.forgetSplit(A);
  await settle();
  assert.deepEqual(scoreKeys(), [`${A}:overdub`, `${A}:parts`, `${A}:session`, `${A}:settings`]);
  assert.equal(stores.get("stems").rows.has(A), false);
  assert.deepEqual(await cache.getScore(A, "parts"), [{ id: "p" }]);
});

console.log(`\n${n} checks passed`);
