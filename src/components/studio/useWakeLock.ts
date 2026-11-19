import { useEffect } from "react";

/**
 * Keep the screen on while `active` (a player reading a score while the song
 * plays should not have the phone dim). Browsers drop the lock when the tab is
 * hidden, so it is asked for again when the tab comes back. Does nothing where
 * the Screen Wake Lock API is missing.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (cancelled || lock) return;
      try {
        const l = await navigator.wakeLock.request("screen");
        if (cancelled) { void l.release().catch(() => {}); return; }
        lock = l;
        l.addEventListener("release", () => { if (lock === l) lock = null; });
      } catch {
        /* denied (low battery, no permission): the screen just dims as usual */
      }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void acquire(); };

    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      const l = lock;
      lock = null;
      if (l) void l.release().catch(() => {});
    };
  }, [active]);
}
