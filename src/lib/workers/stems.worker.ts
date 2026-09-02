/// <reference lib="webworker" />
/**
 * Demucs stem separation in a Web Worker.
 *
 * Runs Meta's HTDemucs (the same model the "AI stem splitter" sites charge for)
 * through ONNX Runtime Web. WebGPU when the browser has it, multi-threaded WASM
 * otherwise. The ~180MB model is cached by the browser after the first run, and
 * the audio itself never leaves the machine.
 */
import * as ort from "onnxruntime-web";
import { DemucsProcessor } from "demucs-web";

type In =
  | { type: "separate"; left: Float32Array; right: Float32Array; modelUrl: string }
  | { type: "warm"; modelUrl: string };

type Out =
  | { type: "download"; loaded: number; total: number }
  | { type: "progress"; progress: number; segment: number; segments: number }
  | { type: "log"; phase: string; message: string }
  | { type: "preparing" }
  | { type: "ready" }
  | { type: "error"; message: string }
  | {
      type: "done";
      stems: Record<string, { left: Float32Array; right: Float32Array }>;
    };

const post = (m: Out, transfer?: Transferable[]) =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer ?? []);

ort.env.wasm.wasmPaths = "/ort/";
ort.env.wasm.numThreads =
  typeof SharedArrayBuffer !== "undefined"
    ? Math.min(4, (navigator.hardwareConcurrency || 4))
    : 1;

const MODEL_CACHE = "riffscribe-models-v1";

async function fetchModel(url: string): Promise<ArrayBuffer> {
  try {
    const cache = await caches.open(MODEL_CACHE);
    const hit = await cache.match(url);
    if (hit) {
      post({ type: "log", phase: "model", message: "using cached model" });
      return await hit.arrayBuffer();
    }
  } catch {
    /* Cache API unavailable — fall through to a plain fetch */
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`model download failed (${res.status})`);
  const total = Number(res.headers.get("content-length") || 0);

  if (!res.body) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    post({ type: "download", loaded, total });
  }
  const buf = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.byteLength; }

  try {
    const cache = await caches.open(MODEL_CACHE);
    await cache.put(url, new Response(buf.slice(0), { headers: { "content-type": "application/octet-stream" } }));
  } catch {
    /* over quota — still fine, just slower next time */
  }
  return buf.buffer;
}

let processor: DemucsProcessor | null = null;
let loadedFor = "";

async function getProcessor(modelUrl: string) {
  if (processor && loadedFor === modelUrl) return processor;
  const p = new DemucsProcessor({
    ort,
    onProgress: (i) =>
      post({ type: "progress", progress: i.progress, segment: i.currentSegment, segments: i.totalSegments }),
    onLog: (phase, message) => post({ type: "log", phase, message }),
  });
  const buffer = await fetchModel(modelUrl);
  post({ type: "preparing" });
  await p.loadModel(buffer);
  processor = p;
  loadedFor = modelUrl;
  return p;
}

self.onmessage = async (e: MessageEvent<In>) => {
  try {
    if (e.data.type === "warm") {
      await getProcessor(e.data.modelUrl);
      post({ type: "ready" });
      return;
    }
    const { left, right, modelUrl } = e.data;
    const p = await getProcessor(modelUrl);
    const result = await p.separate(left, right);
    const stems = {
      vocals: result.vocals,
      drums: result.drums,
      bass: result.bass,
      other: result.other,
    };
    const transfer: Transferable[] = [];
    for (const s of Object.values(stems)) {
      transfer.push(s.left.buffer as ArrayBuffer, s.right.buffer as ArrayBuffer);
    }
    post({ type: "done", stems }, transfer);
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
