/**
 * Capacitor is optional. The website never loads these modules unless the
 * native bridge is actually present, and a missing package leaves the web
 * sign-in and download paths unchanged.
 */

export async function isNativePlatform(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const bridge = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (!bridge?.isNativePlatform) return false;
  try {
    const { Capacitor } = await import("@capacitor/core");
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * Reported device memory in GB, and only inside the native shell.
 * `navigator.deviceMemory` is absent on iOS WebKit; callers must treat null
 * as "no warning", not as a small device.
 */
export async function nativeDeviceMemoryGb(): Promise<number | null> {
  if (!(await isNativePlatform())) return null;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof mem === "number" && Number.isFinite(mem) ? mem : null;
}
