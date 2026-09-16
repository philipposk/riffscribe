"use client";
/**
 * Where the assistant appears: the studio and My songs.
 *
 * It sits above the pages rather than inside the studio, so moving between
 * those two — which is what a link in one of its replies does — keeps the same
 * widget and the conversation on screen. Leaving them for any other page takes
 * it down, as leaving the studio always did.
 *
 * It spends from the signed-in player's plan, so it waits for a sign-in. On a
 * deployment without accounts it is there for everyone.
 */
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import Assistant from "./Assistant";
import { currentUser, onAuthChange } from "@/lib/store/charts";
import { savingConfigured } from "@/lib/supabase/client";

const PAGES = new Set(["/studio", "/songs"]);

export default function AssistantHost() {
  const here = PAGES.has(usePathname() ?? "");
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    if (!here || !savingConfigured) return;
    let live = true;
    void currentUser().then((u) => { if (live) setSignedIn(!!u); });
    const stop = onAuthChange((u) => setSignedIn(!!u));
    return () => {
      live = false;
      stop();
    };
  }, [here]);

  if (!here || (savingConfigured && !signedIn)) return null;
  return <Assistant />;
}
