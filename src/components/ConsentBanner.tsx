"use client";
/**
 * Analytics consent. PostHog starts opted out (Providers); nothing is stored
 * or sent until "Accept analytics". The choice itself lives in localStorage
 * under CONSENT_KEY, which is the banner's own strictly necessary storage.
 * Reject and Accept are the same size on purpose. The footer's "Cookie
 * settings" button reopens the banner by firing CONSENT_OPEN_EVENT.
 *
 * Rendered by Providers only when NEXT_PUBLIC_POSTHOG_KEY is set, so a build
 * without analytics shows no banner at all.
 */
import { useSyncExternalStore } from "react";
import Link from "next/link";
import posthog from "posthog-js";

export const CONSENT_KEY = "riffscribe:consent";
export const CONSENT_OPEN_EVENT = "riffscribe:consent-open";

type Choice = "yes" | "no";

export function readConsent(): Choice | null {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === "yes" || v === "no" ? v : null;
  } catch {
    return null;
  }
}

/** Footer link that reopens the banner. Safe to render without a banner mounted. */
export function CookieSettingsButton({ className }: { className?: string }) {
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new Event(CONSENT_OPEN_EVENT))}>
      Cookie settings
    </button>
  );
}

// Whether the banner is showing, kept outside React so reading the stored choice
// (browser-only) never needs a setState in an effect.
let forced = false; // the footer asked to reopen it
let dismissed = false; // a button was pressed this page load (covers storage being blocked)
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const snapshot = () => !dismissed && (forced || readConsent() === null);
const subscribe = (l: () => void) => {
  listeners.add(l);
  const reopen = () => {
    forced = true;
    dismissed = false;
    notify();
  };
  window.addEventListener(CONSENT_OPEN_EVENT, reopen);
  return () => {
    listeners.delete(l);
    window.removeEventListener(CONSENT_OPEN_EVENT, reopen);
  };
};

export default function ConsentBanner({ onChoice }: { onChoice?: (accepted: boolean) => void }) {
  const open = useSyncExternalStore(subscribe, snapshot, () => false);

  const choose = (c: Choice) => {
    try {
      localStorage.setItem(CONSENT_KEY, c);
    } catch {
      /* private mode: the choice just lasts until reload */
    }
    if (c === "yes") posthog.opt_in_capturing();
    else {
      posthog.opt_out_capturing();
      posthog.reset(); // drop any id from an earlier "accept"
    }
    forced = false;
    dismissed = true;
    notify();
    onChoice?.(c === "yes");
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Analytics consent"
      className="no-print panel fixed bottom-4 left-4 z-30 max-w-sm p-4 text-sm text-white/70 shadow-xl"
    >
      <p>
        We would like to count page visits with PostHog (EU servers, no session recording). Nothing is sent unless you
        accept. <Link className="underline" href="/privacy">Privacy</Link>
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" className="btn" onClick={() => choose("no")}>Reject</button>
        <button type="button" className="btn" onClick={() => choose("yes")}>Accept analytics</button>
      </div>
    </div>
  );
}
