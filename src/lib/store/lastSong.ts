/**
 * The recordings themselves, kept so the studio can bring them back.
 *
 * Leaving the studio tears the page down, and the decoded audio goes with it.
 * A saved chart knows which recording it was written from (its song key), but
 * the recording never leaves this machine. So the original files are kept
 * here — the last few, keyed by song — and reloaded when the player comes back
 * or opens a saved song. Stems then come back from the stem cache as usual.
 *
 * A database of its own, so it never touches the stem cache's versioning.
 * Nothing is uploaded.
 */
const DB = "riffscribe-last";
const STORE = "song";
const LAST = "last";
/** Songs kept. Oldest go first; a compressed song is a few MB. */
const MAX = 8;

interface Entry { name: string; type: string; blob: Blob; at: number }

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

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve) => { tx.oncomplete = tx.onerror = tx.onabort = () => resolve(); });
}

/** Keep this recording under its song key, and mark it as the one last open. */
export async function rememberSong(key: string, file: File): Promise<void> {
  const db = await open();
  if (!db) return;
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  store.put({ name: file.name, type: file.type, blob: file, at: Date.now() } satisfies Entry, key);
  store.put(key, LAST);
  const all = store.getAll();
  const keys = store.getAllKeys();
  keys.onsuccess = () => {
    const rows = keys.result
      .map((k, i) => ({ k, v: all.result?.[i] as Entry | string }))
      .filter((r): r is { k: IDBValidKey; v: Entry } => r.k !== LAST && typeof r.v === "object");
    rows.sort((a, b) => b.v.at - a.v.at).slice(MAX).forEach((r) => store.delete(r.k));
  };
  await done(tx);
}

function get<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => resolve(undefined);
  });
}

/** The recording for a song key, if this device still has it. */
export async function songFile(key: string): Promise<File | null> {
  const db = await open();
  if (!db) return null;
  const v = await get<Entry | { name: string; type: string; blob: Blob }>(db, key);
  return v && typeof v === "object" ? new File([v.blob], v.name, { type: v.type }) : null;
}

/**
 * The recording for a chart: by song key, or — for charts saved before they
 * carried one — by the file name the title was made from.
 */
export async function findSong(key: string | undefined, title: string): Promise<File | null> {
  if (key) {
    const f = await songFile(key);
    if (f) return f;
  }
  const db = await open();
  if (!db) return null;
  const all = await new Promise<unknown[]>((resolve) => {
    const req = db.transaction(STORE).objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve([]);
  });
  const hit = all.find(
    (v): v is Entry => typeof v === "object" && v !== null && (v as Entry).name?.replace(/\.[^.]+$/, "") === title
  );
  return hit ? new File([hit.blob], hit.name, { type: hit.type }) : null;
}

/** The recording that was open last time. */
export async function lastSong(): Promise<File | null> {
  const db = await open();
  if (!db) return null;
  const pointer = await get<string | Entry>(db, LAST);
  // Before songs were keyed, "last" held the file itself.
  if (pointer && typeof pointer === "object") return new File([pointer.blob], pointer.name, { type: pointer.type });
  return pointer ? songFile(pointer) : null;
}
