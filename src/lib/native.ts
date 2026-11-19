/**
 * Capacitor is optional. The website never loads these modules unless the
 * native bridge is actually present, and a missing package leaves the web
 * sign-in and download paths unchanged.
 */
import { useEffect, useState } from "react";

/** Custom scheme the phone shell registers. Add this exact URL to the Supabase redirect allow-list. */
export const NATIVE_AUTH_REDIRECT = "gr.sixseven.riffscribe://auth/callback";

/**
 * Where a sign-in (Google or the email link) comes back to. In the shell it
 * is the custom scheme, so the OS reopens the app and the WebView holding the
 * PKCE verifier finishes it; an https link would open in Safari/Chrome, which
 * has no verifier.
 */
export function authRedirectTo(native: boolean, origin: string): string {
  return native ? NATIVE_AUTH_REDIRECT : `${origin}/studio`;
}

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

/** False on the server and first render, then whether this is the phone shell. */
export function useIsNative(): boolean {
  const [native, setNative] = useState(false);
  useEffect(() => {
    let live = true;
    void isNativePlatform().then((n) => { if (live) setNative(n); });
    return () => { live = false; };
  }, []);
  return native;
}
