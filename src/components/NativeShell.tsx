"use client";

/**
 * Native-only bootstrap. Mounted from the root layout so an OAuth return is
 * caught even when the WebView cold-starts on the home page.
 *
 * Google sign-in (see charts.ts) opens the system browser and comes back on
 * gr.sixseven.riffscribe://auth/callback. The PKCE verifier lives in this WebView,
 * so the code has to land on the same origin the web app already uses:
 * {origin}/studio, which is https://riffscribe.6x7.gr/studio in this shell.
 */
import { useEffect } from "react";

const SCHEME = "gr.sixseven.riffscribe:";
const SEEN = "riffscribe.nativeAuthUrl";

function studioUrlFromCallback(incoming: string): string | null {
  let url: URL;
  try {
    url = new URL(incoming);
  } catch {
    return null;
  }
  if (url.protocol !== SCHEME) return null;
  if (url.hostname !== "auth" || !url.pathname.startsWith("/callback")) return null;
  const target = new URL("/studio", location.origin);
  url.searchParams.forEach((value, key) => target.searchParams.set(key, value));
  if (url.hash) target.hash = url.hash;
  return target.toString();
}

export default function NativeShell() {
  useEffect(() => {
    let remove: (() => void) | undefined;
    let cancelled = false;

    const go = async (incoming: string | undefined) => {
      if (!incoming || sessionStorage.getItem(SEEN) === incoming) return;
      const next = studioUrlFromCallback(incoming);
      if (!next) return;
      sessionStorage.setItem(SEEN, incoming);
      try {
        const { Browser } = await import("@capacitor/browser");
        await Browser.close();
      } catch {
        // The system browser may already have closed on the custom scheme.
      }
      if (cancelled || location.href === next) return;
      location.replace(next);
    };

    void (async () => {
      const bridge = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
      if (!bridge?.isNativePlatform?.()) return;
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform() || cancelled) return;
        const { StatusBar, Style } = await import("@capacitor/status-bar");
        await StatusBar.setStyle({ style: Style.Dark });
        await StatusBar.setBackgroundColor({ color: "#08090c" });
        await StatusBar.setOverlaysWebView({ overlay: false });
      } catch {
        // Status bar styling is cosmetic; auth return still has to run.
      }
      try {
        const { SplashScreen } = await import("@capacitor/splash-screen");
        await SplashScreen.hide();
      } catch {
        // launchAutoHide in the shell config covers this.
      }
      try {
        const { App } = await import("@capacitor/app");
        if (cancelled) return;
        const launch = await App.getLaunchUrl();
        if (launch?.url) await go(launch.url);
        const handle = await App.addListener("appUrlOpen", (event) => {
          void go(event.url);
        });
        remove = () => {
          void handle.remove();
        };
      } catch {
        // Website, or a shell that has not registered the App plugin yet.
      }
    })();

    return () => {
      cancelled = true;
      remove?.();
    };
  }, []);

  return null;
}
