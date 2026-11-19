import { isNativePlatform } from "./native";

/** Base64 payload for Filesystem.writeFile, which treats a string without an encoding as base64. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("could not read the export"));
    reader.readAsDataURL(blob);
  });
}

/**
 * On the phone, hand the export to the system share sheet (Save to Files,
 * AirDrop, and so on). Returns false on the website so the anchor download runs.
 * A dismissed sheet counts as handled.
 */
export async function shareFileIfNative(blob: Blob, filename: string): Promise<boolean> {
  if (!(await isNativePlatform())) return false;
  const safe = filename.replace(/[^\w.\-]+/g, "_") || "riffscribe-export";
  const { Directory, Filesystem } = await import("@capacitor/filesystem");
  const { Share } = await import("@capacitor/share");
  const written = await Filesystem.writeFile({
    path: safe,
    data: await blobToBase64(blob),
    directory: Directory.Cache,
  });
  try {
    await Share.share({
      title: filename,
      files: [written.uri],
      dialogTitle: "Save or share",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/cancel/i.test(msg)) return true;
    throw e;
  }
  return true;
}
