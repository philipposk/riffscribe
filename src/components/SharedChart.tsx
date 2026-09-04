"use client";
/**
 * A chart someone shared, engraved through exactly the same path the studio
 * uses — so what a player reads here is what the sender was looking at.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileMusic, Loader2, Printer } from "lucide-react";

import ScoreView from "./ScoreView";
import { savingConfigured } from "@/lib/supabase/client";
import { loadChart, type Chart } from "@/lib/store/charts";
import { engraveParts, partsToTex } from "@/lib/transcribe/engrave";
import { INSTRUMENTS } from "@/lib/types";

/** Where the studio looks for a chart handed over from this page. */
export const HANDOFF_KEY = "riffscribe:chart";

export default function SharedChart({ id }: { id: string }) {
  const router = useRouter();
  const [chart, setChart] = useState<Chart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!savingConfigured) {
      setError("Sharing is not set up on this deployment.");
      setLoading(false);
      return;
    }
    loadChart(id)
      .then((c) => {
        if (!c) setError("That link does not open anything — it may have been unshared or deleted.");
        else setChart(c);
      })
      .catch(() => setError("That link does not open anything — it may have been unshared or deleted."))
      .finally(() => setLoading(false));
  }, [id]);

  const tex = useMemo(() => {
    if (!chart) return "";
    return partsToTex(engraveParts(chart.parts, chart.settings), chart.settings, chart.title);
  }, [chart]);

  if (loading) {
    return (
      <main className="mx-auto max-w-5xl px-5 py-16">
        <p className="flex items-center gap-2 text-white/50">
          <Loader2 className="animate-spin" size={16} /> Opening the chart…
        </p>
      </main>
    );
  }

  if (error || !chart) {
    return (
      <main className="mx-auto max-w-5xl px-5 py-16">
        <h1 className="mb-3 text-2xl font-medium">Nothing here</h1>
        <p className="mb-6 text-white/55">{error}</p>
        <Link className="btn" href="/studio">Open the studio</Link>
      </main>
    );
  }

  const part = chart.parts[0];

  return (
    <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
      <p className="no-print mb-2 text-xs uppercase tracking-[0.2em] text-[var(--color-accent)]">
        A shared chart
      </p>
      <h1 className="text-3xl font-semibold tracking-tight">{chart.title}</h1>
      <p className="mt-2 text-sm text-white/50">
        {chart.settings.bpm} BPM
        {part && ` · ${part.keyName}`}
        {` · ${chart.parts.length} ${chart.parts.length === 1 ? "part" : "parts"}: `}
        {chart.parts.map((p) => INSTRUMENTS[p.instrument].label).join(", ")}
      </p>

      <div className="no-print mt-5 flex flex-wrap gap-2">
        <button
          className="btn btn-primary"
          onClick={() => {
            // Hand it to the studio through session storage rather than the URL:
            // a chart is kilobytes of notes, not something to put in a query string.
            try {
              sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(chart));
            } catch {
              /* private mode — the studio will simply open empty */
            }
            router.push("/studio");
          }}
        >
          <FileMusic size={15} /> Open in the studio
        </button>
        <button className="btn" onClick={() => window.print()}>
          <Printer size={15} /> Print the part
        </button>
      </div>

      <p className="no-print mt-3 text-xs text-white/40">
        The notes travelled; the recording did not. To play along, open this in the studio and load
        your own copy of the song — it never leaves your machine.
      </p>

      {chart.sections.length > 0 && (
        <p className="no-print mt-3 text-xs text-white/40">
          Sections: {chart.sections.map((s) => s.name).join(" · ")}
        </p>
      )}

      <div className="mt-6">
        <ScoreView tex={tex} zoom={1} playAlong={false} timeSeconds={0} timeline={[]} />
      </div>
    </main>
  );
}
