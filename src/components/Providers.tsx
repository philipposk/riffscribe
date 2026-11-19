"use client";
/**
 * App-wide wiring: the auth cookie the server routes read, analytics, and the
 * page assistant (mounted here so it outlives a change of page — AssistantHost).
 *
 * Analytics is PostHog with the privacy switches on — no session recording
 * (it would capture the score and the song title), no autocapture, profiles
 * only for signed-in people, keyed by id rather than email. It starts opted
 * out: nothing is stored or sent until the person accepts in ConsentBanner.
 * Without NEXT_PUBLIC_POSTHOG_KEY it does nothing and no banner shows.
 */
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import posthog from "posthog-js";

import AssistantHost from "./AssistantHost";
import ConsentBanner, { readConsent } from "./ConsentBanner";
import { syncAuthCookie } from "@/lib/store/account";
import { onAuthChange } from "@/lib/store/charts";

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
let started = false;

type Analytics = Pick<typeof posthog, "has_opted_in_capturing" | "identify" | "reset" | "opt_in_capturing">;

// analyticsOnAuth:start (scripts/verify-analytics-auth.mjs tests this block)
/**
 * What PostHog does when the signed-in person changes; returns the new id.
 * Supabase sends a null session to every new subscriber (INITIAL_SESSION), so
 * null -> null must do nothing: reset() also wipes PostHog's stored opt-in and,
 * with opt_out_capturing_by_default, switches capturing off for the page.
 * Only a real sign-out or account switch resets, and only when capturing is
 * on; our own consent record then switches it back on.
 */
export function analyticsOnAuth(ph: Analytics, prev: string | null, next: string | null, consented: boolean): string | null {
  if (prev && prev !== next && ph.has_opted_in_capturing()) {
    ph.reset();
    if (consented) ph.opt_in_capturing({ captureEventName: false });
  }
  if (next && ph.has_opted_in_capturing()) ph.identify(next);
  return next;
}
// analyticsOnAuth:end

export default function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const userId = useRef<string | null>(null);

  useEffect(() => syncAuthCookie(), []);

  useEffect(() => {
    if (!KEY) return;
    if (!started) {
      posthog.init(KEY, {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com",
        person_profiles: "identified_only",
        autocapture: false,
        capture_pageview: false,
        disable_session_recording: true,
        opt_out_capturing_by_default: true,
        // Without this PostHog still writes its id cookie/localStorage while opted out.
        opt_out_persistence_by_default: true,
        persistence: "localStorage+cookie",
      });
      started = true;
      // A returning visitor who already accepted: switch capturing back on.
      if (readConsent() === "yes") posthog.opt_in_capturing();
    }
    return onAuthChange((u) => {
      userId.current = analyticsOnAuth(posthog, userId.current, u?.id ?? null, readConsent() === "yes");
    });
  }, []);

  useEffect(() => {
    if (started && pathname && posthog.has_opted_in_capturing()) {
      posthog.capture("$pageview", { $current_url: location.origin + pathname });
    }
  }, [pathname]);

  // Just accepted: identify the signed-in person and count the page they are on.
  const onConsent = (accepted: boolean) => {
    if (!accepted) return;
    if (userId.current) posthog.identify(userId.current);
    posthog.capture("$pageview", { $current_url: location.origin + location.pathname });
  };

  return (
    <>
      {children}
      <AssistantHost />
      {KEY && <ConsentBanner onChoice={onConsent} />}
    </>
  );
}
