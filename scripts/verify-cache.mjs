#!/usr/bin/env node
/**
 * Checks the browser cache's housekeeping: forgetting a song also drops its
 * saved session and other per-song rows, and the overdub counts toward the
 * cache budget. Runs against a small in-memory stand-in for IndexedDB.
 *
 * Run with: node --experimental-strip-types scripts/verify-cache.mjs
 */
import assert from "node:assert/strict";

/* ---- a minimal in-memory IndexedDB: enough for cache.ts */
class Range {
  constructor(lo, hi) { this.lo = lo; this.hi = hi; }
  includes(k) { return k >= this.lo && k <= this.hi; }
}
globalThis.IDBKeyRange = { bound: (lo, hi) => new Range(lo, hi) };

const stores = new Map(); // name -> { keyPath, rows: Map }
function request(fn) {
  const req = {};
  setTimeout(() => {
    req.result = fn();
    req.onsuccess?.();
  });
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
    setTimeout(() => {
      req.result = db;
      req.onupgradeneeded?.();
      req.onsuccess?.();
    });
    return req;
  },
};

const c = await import("../src/lib/store/cache.ts").catch(() => null);
if (!c) {
  console.log("run with: node --experimental-strip-types scripts/verify-cache.mjs");
  process.exit(1);
}
let n = 0;
const ok = (name, fn) => Promise.resolve(fn()).then(() => { n++; console.log("ok -", name); });
const settle = () => new Promise((r) => setTimeout(r, 20));

const A = "a".repeat(64);
const B = "b".repeat(64);

// ---- pure parts
await ok("the score range covers every per-song row", () => {
  const [lo, hi] = c.songScoreRange(A);
  const r = new Range(lo, hi);
  for (const v of ["session", "parts", "settings", "guitar", "guitar:peaks"]) assert.ok(r.includes(`${A}:${v}`), v);
});
await ok("and nothing of another song", () => {
  const r = new Range(...c.songScoreRange(A));
  assert.equal(r.includes(`${B}:session`), false);
  assert.equal(r.includes(A), false);
  assert.equal(r.includes(`${"a".repeat(63)}b:session`), false);
});
const song = (key, bytes, sessionBytes, at) => ({ key, name: key, mode: "ai", rate: 44100, bytes, sessionBytes, at });
await ok("an overdub counts toward the byte budget", () => {
  const songs = [song("new", 60, 0, 2), song("old", 30, 20, 1)]; // newest first
  assert.deepEqual(c.pickEvictions(songs, 8, 100), ["old"]);
  assert.deepEqual(c.pickEvictions(songs, 8, 110), []);
});
await ok("too many songs drops the oldest", () => {
  const songs = [song("c", 1, 0, 3), song("b", 1, 0, 2), song("a", 1, 0, 1)];
  assert.deepEqual(c.pickEvictions(songs, 2, 1e9), ["a"]);
});

// ---- against the stand-in store
const silent = { left: new Float32Array(10), right: new Float32Array(10) };
const overdub = { codec: "pcm16", frames: 250, rate: 44100, data: new Uint8Array(1000) };
await c.putStems(A, "song a", { vocals: silent }, 44100, "ai");
await c.putStems(B, "song b", { vocals: silent }, 44100, "ai");
await c.putScore(A, "parts", { x: 1 });
await c.putScore(A, "guitar:peaks", [1, 2]);
await c.putScore(B, "parts", { y: 2 });
await c.putSession(A, { mix: {}, soloed: null, overdub });
await settle();

const row = (k) => stores.get("songs").rows.get(k);
await ok("saving a session records the overdub's size", () => assert.equal(row(A).sessionBytes, 1000));
await ok("re-splitting keeps that size", async () => {
  await c.putStems(A, "song a", { vocals: silent }, 44100, "instant");
  await settle();
  assert.equal(row(A).sessionBytes, 1000);
  assert.equal(row(A).mode, "instant");
});
await ok("forgetting a song drops its session and scores", async () => {
  await c.forget(A);
  const scores = [...stores.get("transcriptions").rows.keys()];
  assert.deepEqual(scores, [`${B}:parts`]);
  assert.equal(stores.get("stems").rows.has(A), false);
  assert.equal(row(A), undefined);
  assert.ok(row(B));
});

console.log(`\n${n} checks passed`);
