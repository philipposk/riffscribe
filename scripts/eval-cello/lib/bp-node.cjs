/**
 * Basic Pitch in Node, for the eval harness only.
 *
 * This is the ONE place outside the app that imports TensorFlow.js, and nothing under `src/` may
 * (HANDOFF gotcha 3: a second tfjs instance in the app breaks every run with "Unknown dtype
 * undefined"). Here the library and this file share the single copy in node_modules, run on the
 * plain-JS CPU backend, and load the same model files the app serves.
 *
 * The model's frame arithmetic is not re-derived here: `evaluateModel` and the library's own
 * note functions do all of it (gotcha 10).
 *
 * Raw model output is cached on disk (rounded to 3 decimals, which is what makes it small enough
 * to keep) so a stage that only changes thresholds does not pay for the model again.
 */
const { createRequire } = require("node:module");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const REPO = path.resolve(__dirname, "../../..");
const CACHE_DIR = path.join(__dirname, "..", ".cache");
const MODEL_DIR = path.join(REPO, "public", "models", "basic-pitch");
const requireFromRepo = createRequire(path.join(REPO, "package.json"));

const N_NOTE = 88;
const N_CONTOUR = 264;
const MAGIC = 0x31637062; // "bpc1"

let modelSizeCache = null;
function modelSize() {
  if (modelSizeCache == null) {
    modelSizeCache = 0;
    // no model folder (npm ci --ignore-scripts, failed copy-assets): no cache can match, say so cleanly
    if (!fs.existsSync(MODEL_DIR)) return 0;
    for (const f of fs.readdirSync(MODEL_DIR)) modelSizeCache += fs.statSync(path.join(MODEL_DIR, f)).size;
  }
  return modelSizeCache;
}

function cacheKey(audio22k) {
  const h = crypto.createHash("sha256");
  h.update(Buffer.from(audio22k.buffer, audio22k.byteOffset, audio22k.byteLength));
  h.update(String(modelSize()));
  return h.digest("hex").slice(0, 32);
}
const cacheFile = (audio22k) => path.join(CACHE_DIR, `${cacheKey(audio22k)}.bpc`);

/** Is this audio's model output already on disk? (Lets a CI run include a slow stage when it can.) */
function hasCache(audio22k) {
  return fs.existsSync(cacheFile(audio22k));
}

const round3 = (v) => Math.round(v * 1000) / 1000;

function pack(raw) {
  const frames = raw.frames.length;
  const out = Buffer.alloc(8 + 2 * frames * (N_NOTE + N_NOTE + N_CONTOUR));
  out.writeUInt32LE(MAGIC, 0);
  out.writeUInt32LE(frames, 4);
  let o = 8;
  const put = (rows, width) => {
    for (let f = 0; f < frames; f++) {
      const row = rows[f];
      for (let b = 0; b < width; b++) {
        out.writeUInt16LE(Math.max(0, Math.min(65535, Math.round(row[b] * 1000))), o);
        o += 2;
      }
    }
  };
  put(raw.frames, N_NOTE);
  put(raw.onsets, N_NOTE);
  put(raw.contours, N_CONTOUR);
  return out;
}

function unpack(buf) {
  if (buf.readUInt32LE(0) !== MAGIC) throw new Error("bad cache file");
  const frames = buf.readUInt32LE(4);
  let o = 8;
  const take = (width) => {
    const rows = new Array(frames);
    for (let f = 0; f < frames; f++) {
      const row = new Array(width);
      for (let b = 0; b < width; b++) { row[b] = buf.readUInt16LE(o) / 1000; o += 2; }
      rows[f] = row;
    }
    return rows;
  };
  return { frames: take(N_NOTE), onsets: take(N_NOTE), contours: take(N_CONTOUR) };
}

let modelPromise = null;
async function loadModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      // tfjs prints a "install our node backend" banner on load; it is just noise here
      const log = console.log;
      console.log = () => {};
      let tf;
      try {
        tf = requireFromRepo("@tensorflow/tfjs");
        await tf.setBackend("cpu");
        await tf.ready();
      } finally {
        console.log = log;
      }
      const json = JSON.parse(fs.readFileSync(path.join(MODEL_DIR, "model.json"), "utf8"));
      const shards = json.weightsManifest.flatMap((g) => g.paths).map((p) => fs.readFileSync(path.join(MODEL_DIR, p)));
      const joined = Buffer.concat(shards);
      const weightData = joined.buffer.slice(joined.byteOffset, joined.byteOffset + joined.byteLength);
      const artifacts = {
        modelTopology: json.modelTopology,
        weightSpecs: json.weightsManifest.flatMap((g) => g.weights),
        weightData,
        format: json.format,
        generatedBy: json.generatedBy,
        convertedBy: json.convertedBy,
        signature: json.signature,
      };
      const graph = await tf.loadGraphModel(tf.io.fromMemory(artifacts));
      const { BasicPitch } = requireFromRepo("@spotify/basic-pitch");
      return new BasicPitch(graph);
    })();
  }
  return modelPromise;
}

/**
 * Model output for mono 22.05 kHz audio: per model frame, 88 note-activation values, 88 onset
 * values and 264 pitch-contour values, all rounded to 3 decimals.
 */
async function getRaw(audio22k) {
  const file = cacheFile(audio22k);
  if (fs.existsSync(file)) return unpack(fs.readFileSync(file));
  const model = await loadModel();
  const frames = [], onsets = [], contours = [];
  await model.evaluateModel(
    audio22k,
    (f, o, c) => {
      for (const r of f) frames.push(r.map(round3));
      for (const r of o) onsets.push(r.map(round3));
      for (const r of c) contours.push(r.map(round3));
    },
    () => {}
  );
  const raw = { frames, onsets, contours };
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, pack(raw));
  fs.renameSync(tmp, file);
  return raw;
}

const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

/**
 * Raw output to notes, the way the app does it (`runTranscription`): outputToNotesPoly, then
 * pitch bends, then frames to seconds. Returns both the frame-domain notes and the notes in
 * seconds with the app's field names.
 *
 * `minMidi`/`maxMidi` are not offered; pass `minHz`/`maxHz` straight through if you need a range.
 */
function notesFrom(raw, { onset = 0.5, frame = 0.3, minLen = 11, melodia = true, minHz = null, maxHz = null } = {}) {
  const { outputToNotesPoly, addPitchBendsToNoteEvents, noteFramesToTime } = requireFromRepo("@spotify/basic-pitch");
  const frameNotes = addPitchBendsToNoteEvents(
    raw.contours,
    outputToNotesPoly(raw.frames, raw.onsets, onset, frame, minLen, true, maxHz, minHz, melodia)
  );
  const frameDomain = frameNotes.map((n) => ({ ...n }));
  const notes = noteFramesToTime(frameNotes)
    .map((n) => ({
      startTimeSeconds: n.startTimeSeconds,
      durationSeconds: n.durationSeconds,
      pitchMidi: n.pitchMidi,
      amplitude: n.amplitude,
      pitchBends: n.pitchBends,
    }))
    .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds || a.pitchMidi - b.pitchMidi);
  return { frameNotes: frameDomain, notes };
}

module.exports = { getRaw, hasCache, notesFrom, cacheFile, midiToHz };
