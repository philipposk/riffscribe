"use client";
/**
 * Signing in, saving a chart, and handing someone the link.
 *
 * Only the chart travels — parts, tempo, key, sections, loop. The recording
 * stays on the machine it came from. That is what makes sharing worth having:
 * an arranger sends one link to three players and each opens the same parts
 * against their own copy of the song.
 *
 * The full list of saved songs lives at /songs, reached from the account menu.
 *
 * Everything here is optional. With no Supabase project configured, this
 * renders nothing and the studio works exactly as it did before.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Link2, Loader2, Save, Share2 } from "lucide-react";

import SignIn from "./SignIn";
import { savingConfigured } from "@/lib/supabase/client";
import { listCharts, saveChart, setShared, shareLink, type Chart, type ChartRow } from "@/lib/store/charts";
import { accountChanged, useAccount } from "@/lib/store/account";

interface Props {
  /** Built lazily — no point serialising the parts on every render. */
  buildChart: () => Chart | null;
  /** Set once a chart has been saved, so Save updates rather than duplicating. */
  chartId: string | null;
  onChartId: (id: string | null) => void;
}

export default function SaveBar({ buildChart, chartId, onChartId }: Props) {
  const { user } = useAccount();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ChartRow[] | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) { setRows(null); return; }
    try { setRows(await listCharts()); } catch { /* only used for the shared flag */ }
  }, [user]);

  useEffect(() => { void refresh(); }, [refresh]);
  // Signing out drops the link to the chart that was open.
  useEffect(() => { if (!user) onChartId(null); }, [user, onChartId]);

  if (!savingConfigured) return null;

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "that did not work");
    } finally {
      setBusy(null);
    }
  }

  if (!user) {
    return (
      <section className="panel no-print mb-5 p-5">
        <h2 className="mb-1 text-base font-medium">Keep this work</h2>
        <p className="mb-3 text-sm text-white/50">
          Sign in and the parts, tempo, key and named sections are saved — and you can send someone
          the link so they open the same chart. The audio stays on your machine either way; only the
          notes travel.
        </p>
        <SignIn />
      </section>
    );
  }

  const saved = rows?.find((r) => r.id === chartId) ?? null;

  return (
    <section className="panel no-print mb-5 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn btn-primary"
          disabled={!!busy}
          onClick={() =>
            void run("save", async () => {
              const chart = buildChart();
              if (!chart) throw new Error("There is nothing to save yet — transcribe a part first.");
              const id = await saveChart(chart, chartId ?? undefined);
              onChartId(id);
              setNote(chartId ? "Saved." : "Saved. It's in My songs.");
              await refresh();
              accountChanged();
            })
          }
        >
          {busy === "save" ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />}
          {chartId ? "Save changes" : "Save this chart"}
        </button>

        {chartId && (
          <>
            <button
              className="btn"
              disabled={!!busy}
              onClick={() =>
                void run("share", async () => {
                  await setShared(chartId, !saved?.shared);
                  await refresh();
                  setNote(saved?.shared ? "Link turned off." : "Anyone with the link can open this now.");
                })
              }
            >
              <Share2 size={15} />
              {saved?.shared ? "Stop sharing" : "Share with a link"}
            </button>
            {saved?.shared && (
              <button
                className="btn"
                onClick={async () => {
                  await navigator.clipboard.writeText(shareLink(chartId));
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? <Check size={15} className="text-emerald-300" /> : <Link2 size={15} />}
                {copied ? "Copied" : "Copy link"}
              </button>
            )}
          </>
        )}
        <Link className="ml-auto text-xs text-white/40 hover:text-white/80" href="/songs">
          My songs →
        </Link>
      </div>
      {note && <p className="mt-3 text-xs text-emerald-300/80">{note}</p>}
      {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
    </section>
  );
}
