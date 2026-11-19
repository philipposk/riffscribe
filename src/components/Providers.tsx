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
        persistence: "localStorage+cookie",
      });
      started = true;
      // A returning visitor who already accepted: switch capturing back on.
      if (readConsent() === "yes") posthog.opt_in_capturing();
    }
    return onAuthChange((u) => {
      userId.current = u?.id ?? null;
      if (u && posthog.has_opted_in_capturing()) posthog.identify(u.id);
      else posthog.reset();
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
