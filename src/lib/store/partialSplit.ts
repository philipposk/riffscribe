/**
 * Blocks of an AI split that have already finished, so an interrupted split
 * picks up where it stopped instead of starting over.
 *
 * Stored as 16-bit PCM — lossless enough to stitch, a quarter of the raw
 * floats. Only one song's blocks are kept at a time: starting another song's
 * split drops the rest. Everything is removed once the split completes (the
 * finished stems go to the stem cache, cache.ts).
 */
import { decodePcm16, encodePcm16, type EncodedTrack, type Track } from "./cache";

const DB = "riffscribe-partial";
const STORE = "blocks";

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

const id = (key: string, block: number) => `${key}:${block}`;

export async function getBlock(key: string, block: number, rate: number): Promise<Record<string, Track> | null> {
  const db = await open();
  if (!db) return null;
  const packed = await new Promise<Record<string, EncodedTrack> | undefined>((resolve) => {
    const req = db.transaction(STORE).objectStore(STORE).get(id(key, block));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
  });
  if (!packed) return null;
  const out: Record<string, Track> = {};
  for (const [name, enc] of Object.entries(packed)) {
    if (enc.rate !== rate) return null;
    out[name] = decodePcm16(enc);
  }
  return out;
}

export async function putBlock(key: string, block: number, stems: Record<string, Track>, rate: number): Promise<void> {
  const db = await open();
  if (!db) return;
  const packed: Record<string, EncodedTrack> = {};
  for (const [name, t] of Object.entries(stems)) packed[name] = encodePcm16(t, rate);
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    // One song at a time — clear any other song's leftovers.
    const keys = store.getAllKeys();
    keys.onsuccess = () => {
      for (const k of keys.result) if (!String(k).startsWith(`${key}:`)) store.delete(k);
      store.put(packed, id(key, block));
    };
    tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
  });
}

/** How many blocks of this song are already done (contiguous from the start is not assumed). */
export async function doneBlocks(key: string): Promise<Set<number>> {
  const db = await open();
  if (!db) return new Set();
  return new Promise((resolve) => {
    const req = db.transaction(STORE).objectStore(STORE).getAllKeys();
    req.onsuccess = () =>
      resolve(new Set(req.result.map(String).filter((k) => k.startsWith(`${key}:`)).map((k) => Number(k.split(":").pop()))));
    req.onerror = () => resolve(new Set());
  });
}

export async function clearBlocks(key: string): Promise<void> {
  const db = await open();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const keys = store.getAllKeys();
    keys.onsuccess = () => { for (const k of keys.result) if (String(k).startsWith(`${key}:`)) store.delete(k); };
    tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
  });
}
