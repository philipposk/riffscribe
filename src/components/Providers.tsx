"use client";
/**
 * App-wide wiring: the auth cookie the server routes read, and analytics.
 *
 * Analytics is PostHog with the privacy switches on — no session recording
 * (it would capture the score and the song title), no autocapture, profiles
 * only for signed-in people, keyed by id rather than email. Without
 * NEXT_PUBLIC_POSTHOG_KEY it does nothing.
 */
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import posthog from "posthog-js";

import { syncAuthCookie } from "@/lib/store/account";
import { onAuthChange } from "@/lib/store/charts";

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
let started = false;

export default function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  useEffect(() => syncAuthCookie(), []);

  useEffect(() => {
    if (!KEY || started) return;
    posthog.init(KEY, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com",
      person_profiles: "identified_only",
      autocapture: false,
      capture_pageview: false,
      disable_session_recording: true,
    });
    started = true;
    return onAuthChange((u) => (u ? posthog.identify(u.id) : posthog.reset()));
  }, []);

  useEffect(() => {
    if (started && pathname) posthog.capture("$pageview", { $current_url: location.origin + pathname });
  }, [pathname]);

  return <>{children}</>;
}
