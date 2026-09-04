/**
 * What the browser remembers between visits.
 *
 * Separating a song takes minutes and transcribing it blocks the page, and
 * until now both were thrown away the moment you reloaded. They are kept here
 * instead, on the machine that made them.
 *
 * Nothing is uploaded. Audio stays where the player put it — which is also why
 * this is IndexedDB and not a server: the stems are derived from a recording we
 * have no right to host, and a round trip would be slower than re-splitting.
 *
 * Stems are stored as Opus, which is about thirty times smaller than the raw
 * samples — roughly 12 MB for the four stems of a four-minute song rather than
 * 340 MB. Opus always works at 48 kHz internally, so what comes back out is at
 * 48 kHz whatever went in; `decodeTrack` resamples it to the rate the studio
 * asked for. Where WebCodecs is missing we fall back to 16-bit PCM, which is
 * four times bigger than Opus but still a quarter of the raw floats.
 */

const DB_NAME = "riffscribe";
const DB_VERSION = 1;
const STEMS = "stems";
const SONGS = "songs";
const SCORES = "transcriptions";

/** Keep the cache to a size a laptop will not notice. Oldest songs go first. */
const MAX_SONGS = 8;
const MAX_BYTES = 600 * 1024 * 1024;

const OPUS_FRAME_MS = 20;
const OPUS_RATE = 48000;
const OPUS_BITRATE = 96000;

export interface Track {
  left: Float32Array;
  right: Float32Array;
}

interface EncodedTrack {
  codec: "opus" | "pcm16" | "silence";
  /** Frames at `rate` — what the caller originally handed us. */
  frames: number;
  rate: number;
  data: Uint8Array;
  /** Opus only: packet boundaries and their presentation times. */
  sizes?: Uint32Array;
  times?: Float64Array;
}

/* ---------------------------------------------------------------- IndexedDB */

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      return resolve(null); // private mode, or storage disabled
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SONGS)) db.createObjectStore(SONGS, { keyPath: "key" });
      if (!db.objectStoreNames.contains(STEMS)) db.createObjectStore(STEMS);
      if (!db.objectStoreNames.contains(SCORES)) db.createObjectStore(SCORES);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        let t: IDBTransaction;
        try {
          t = db.transaction(store, mode);
        } catch {
          return resolve(null);
        }
        const req = run(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        t.onabort = () => resolve(null); // quota exceeded lands here
      })
  );
}

/* --------------------------------------------------------------- Identity */

/**
 * Name a song by its contents, so the same file dropped again finds its stems
 * even if it has been renamed or moved.
 */
export async function songKey(file: Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Ask the browser not to evict us when disk runs low. Best effort. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------- Encoding */

async function opusSupported(rate: number): Promise<boolean> {
  if (typeof AudioEncoder === "undefined" || typeof AudioDecoder === "undefined") return false;
  try {
    const enc = await AudioEncoder.isConfigSupported({
      codec: "opus", sampleRate: rate, numberOfChannels: 2, bitrate: OPUS_BITRATE,
    });
    const dec = await AudioDecoder.isConfigSupported({
      codec: "opus", sampleRate: rate, numberOfChannels: 2,
    });
    return !!enc.supported && !!dec.supported;
  } catch {
    return false;
  }
}

function encodePcm16(track: Track, rate: number): EncodedTrack {
  const n = track.left.length;
  const out = new Int16Array(n * 2);
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, track.left[i]));
    const r = Math.max(-1, Math.min(1, track.right[i] ?? l));
    out[i * 2] = l < 0 ? l * 0x8000 : l * 0x7fff;
    out[i * 2 + 1] = r < 0 ? r * 0x8000 : r * 0x7fff;
  }
  return { codec: "pcm16", frames: n, rate, data: new Uint8Array(out.buffer) };
}

function decodePcm16(enc: EncodedTrack): Track {
  const pcm = new Int16Array(enc.data.buffer, enc.data.byteOffset, enc.data.byteLength / 2);
  const n = enc.frames;
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    left[i] = pcm[i * 2] / 0x8000;
    right[i] = pcm[i * 2 + 1] / 0x8000;
  }
  return { left, right };
}

async function encodeTrack(track: Track, rate: number): Promise<EncodedTrack> {
  if (!(await opusSupported(rate))) return encodePcm16(track, rate);

  const packets: Uint8Array[] = [];
  const times: number[] = [];
  let failed: string | null = null;

  const encoder = new AudioEncoder({
    output: (chunk) => {
      const bytes = new Uint8Array(chunk.byteLength);
      chunk.copyTo(bytes);
      packets.push(bytes);
      times.push(chunk.timestamp);
    },
    error: (e) => {
      failed = e.message;
    },
  });

  try {
    encoder.configure({ codec: "opus", sampleRate: rate, numberOfChannels: 2, bitrate: OPUS_BITRATE });
    const frame = Math.round((rate * OPUS_FRAME_MS) / 1000);
    const n = track.left.length;
    for (let off = 0; off < n; off += frame) {
      const count = Math.min(frame, n - off);
      // AudioData wants both channels in one planar buffer, left then right.
      const planar = new Float32Array(count * 2);
      planar.set(track.left.subarray(off, off + count), 0);
      planar.set(track.right.subarray(off, off + count), count);
      encoder.encode(
        new AudioData({
          format: "f32-planar",
          sampleRate: rate,
          numberOfFrames: count,
          numberOfChannels: 2,
          timestamp: Math.round((off / rate) * 1e6),
          data: planar,
        })
      );
    }
    await encoder.flush();
    encoder.close();
  } catch (e) {
    failed = e instanceof Error ? e.message : "encode failed";
  }

  if (failed || !packets.length) return encodePcm16(track, rate);

  const total = packets.reduce((s, p) => s + p.length, 0);
  const data = new Uint8Array(total);
  const sizes = new Uint32Array(packets.length);
  let at = 0;
  packets.forEach((p, i) => {
    data.set(p, at);
    at += p.length;
    sizes[i] = p.length;
  });
  return { codec: "opus", frames: track.left.length, rate, data, sizes, times: Float64Array.from(times) };
}

/** Resample through the audio engine, which does it properly. */
async function resample(left: Float32Array, right: Float32Array, from: number, to: number, frames: number): Promise<Track> {
  if (from === to) return { left: left.subarray(0, frames), right: right.subarray(0, frames) };
  const ctx = new OfflineAudioContext(2, frames, to);
  const buf = ctx.createBuffer(2, left.length, from);
  buf.copyToChannel(left as Float32Array<ArrayBuffer>, 0);
  buf.copyToChannel(right as Float32Array<ArrayBuffer>, 1);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  return { left: out.getChannelData(0), right: out.getChannelData(1) };
}

async function decodeTrack(enc: EncodedTrack, wantRate: number): Promise<Track> {
  if (enc.codec === "silence") {
    const n = Math.round((enc.frames * wantRate) / enc.rate);
    return { left: new Float32Array(n), right: new Float32Array(n) };
  }
  if (enc.codec === "pcm16") {
    const t = decodePcm16(enc);
    return enc.rate === wantRate ? t : resample(t.left, t.right, enc.rate, wantRate, Math.round((enc.frames * wantRate) / enc.rate));
  }

  const chunks: { left: Float32Array; right: Float32Array }[] = [];
  let rate = OPUS_RATE;
  let failed: string | null = null;

  const decoder = new AudioDecoder({
    output: (data) => {
      rate = data.sampleRate;
      const n = data.numberOfFrames;
      // Each channel is its own plane, and copyTo fetches one plane per call.
      // Asking for plane 0 and slicing does not get you the right channel; it
      // gets you the left one twice, and then silence.
      const left = new Float32Array(n);
      data.copyTo(left, { planeIndex: 0, format: "f32-planar" });
      let right = left;
      if (data.numberOfChannels > 1) {
        right = new Float32Array(n);
        data.copyTo(right, { planeIndex: 1, format: "f32-planar" });
      }
      chunks.push({ left, right });
      data.close();
    },
    error: (e) => {
      failed = e.message;
    },
  });

  decoder.configure({ codec: "opus", sampleRate: enc.rate, numberOfChannels: 2 });
  let at = 0;
  const sizes = enc.sizes!;
  for (let i = 0; i < sizes.length; i++) {
    const bytes = enc.data.subarray(at, at + sizes[i]);
    at += sizes[i];
    decoder.decode(
      new EncodedAudioChunk({
        type: "key",
        timestamp: enc.times ? enc.times[i] : Math.round((i * OPUS_FRAME_MS * 1000)),
        duration: OPUS_FRAME_MS * 1000,
        data: bytes,
      })
    );
  }
  await decoder.flush();
  decoder.close();
  if (failed) throw new Error(`could not read the cached stems: ${failed}`);

  const total = chunks.reduce((s, c) => s + c.left.length, 0);
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  let o = 0;
  for (const c of chunks) {
    left.set(c.left, o);
    right.set(c.right, o);
    o += c.left.length;
  }
  // Opus hands everything back at 48 kHz; put it back where the studio wants it.
  return resample(left, right, rate, wantRate, enc.frames);
}

/* ------------------------------------------------------------------ Stems */

export interface CachedSong {
  key: string;
  name: string;
  /** "instant" or "ai" — an instant split should not masquerade as a real one. */
  mode: string;
  rate: number;
  bytes: number;
  at: number;
}

export async function getStems(
  key: string,
  wantRate: number
): Promise<{ stems: Record<string, Track>; mode: string } | null> {
  const song = (await tx<CachedSong>(SONGS, "readonly", (s) => s.get(key) as IDBRequest<CachedSong>)) ?? null;
  if (!song) return null;
  const packed = await tx<Record<string, EncodedTrack>>(STEMS, "readonly", (s) => s.get(key) as IDBRequest<Record<string, EncodedTrack>>);
  if (!packed) return null;

  try {
    const stems: Record<string, Track> = {};
    for (const [name, enc] of Object.entries(packed)) stems[name] = await decodeTrack(enc, wantRate);
    void touch(key);
    return { stems, mode: song.mode };
  } catch {
    return null; // a broken entry should just mean "not cached", never a crash
  }
}

export async function putStems(
  key: string,
  name: string,
  stems: Record<string, Track>,
  rate: number,
  mode: string
): Promise<void> {
  const packed: Record<string, EncodedTrack> = {};
  let bytes = 0;
  for (const [stem, track] of Object.entries(stems)) {
    // The instant split leaves drums and bass empty; store those as a length.
    const enc: EncodedTrack = isSilent(track)
      ? { codec: "silence", frames: track.left.length, rate, data: new Uint8Array(0) }
      : await encodeTrack(track, rate);
    packed[stem] = enc;
    bytes += enc.data.byteLength;
  }
  await tx(STEMS, "readwrite", (s) => s.put(packed, key));
  await tx(SONGS, "readwrite", (s) => s.put({ key, name, mode, rate, bytes, at: Date.now() } satisfies CachedSong));
  void evict();
}

function isSilent(track: Track): boolean {
  for (let i = 0; i < track.left.length; i += 997) if (track.left[i] !== 0 || track.right[i] !== 0) return false;
  return true;
}

async function touch(key: string): Promise<void> {
  const song = await tx<CachedSong>(SONGS, "readonly", (s) => s.get(key) as IDBRequest<CachedSong>);
  if (song) await tx(SONGS, "readwrite", (s) => s.put({ ...song, at: Date.now() }));
}

/* ---------------------------------------------------------- Transcriptions */

/** Cheap enough to keep many of: a few KB of notes per part. */
export async function getScore<T>(key: string, variant: string): Promise<T | null> {
  return (await tx<T>(SCORES, "readonly", (s) => s.get(`${key}:${variant}`) as IDBRequest<T>)) ?? null;
}

export async function putScore<T>(key: string, variant: string, value: T): Promise<void> {
  await tx(SCORES, "readwrite", (s) => s.put(value, `${key}:${variant}`));
}

/* --------------------------------------------------------------- Eviction */

export async function listSongs(): Promise<CachedSong[]> {
  const all = await tx<CachedSong[]>(SONGS, "readonly", (s) => s.getAll() as IDBRequest<CachedSong[]>);
  return (all ?? []).sort((a, b) => b.at - a.at);
}

export async function forget(key: string): Promise<void> {
  await tx(STEMS, "readwrite", (s) => s.delete(key));
  await tx(SONGS, "readwrite", (s) => s.delete(key));
}

/** Drop the least recently opened songs once the cache outgrows its budget. */
async function evict(): Promise<void> {
  const songs = await listSongs(); // newest first
  let total = songs.reduce((s, x) => s + x.bytes, 0);
  for (let i = songs.length - 1; i >= 0; i--) {
    if (i < MAX_SONGS && total <= MAX_BYTES) break;
    await forget(songs[i].key);
    total -= songs[i].bytes;
  }
}

export async function cacheSize(): Promise<{ songs: number; bytes: number }> {
  const songs = await listSongs();
  return { songs: songs.length, bytes: songs.reduce((s, x) => s + x.bytes, 0) };
}
