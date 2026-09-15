/**
 * The song that was open, kept so the studio can bring it back.
 *
 * Leaving the studio — to the pricing page, say — tears the page down, and the
 * decoded audio goes with it. Rather than make the player find the file again,
 * the original file is kept here and reloaded when they come back. Stems are
 * restored from the stem cache as usual once it is loaded.
 *
 * A database of its own, one entry, so it never touches the stem cache's
 * versioning. Nothing is uploaded.
 */
const DB = "riffscribe-last";
const STORE = "song";
const KEY = "last";

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

export async function rememberSong(file: File): Promise<void> {
  const db = await open();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ name: file.name, type: file.type, blob: file }, KEY);
    tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
  });
}

export async function lastSong(): Promise<File | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    const req = db.transaction(STORE).objectStore(STORE).get(KEY);
    req.onsuccess = () => {
      const v = req.result as { name: string; type: string; blob: Blob } | undefined;
      resolve(v ? new File([v.blob], v.name, { type: v.type }) : null);
    };
    req.onerror = () => resolve(null);
  });
}
