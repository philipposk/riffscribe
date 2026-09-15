"use client";
/** Every chart you have saved: open it in the studio, share it, or delete it. */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Link2, Loader2, Share2, Trash2 } from "lucide-react";

import SignIn from "./SignIn";
import { Meter } from "./AccountMenu";
import { HANDOFF_ID_KEY, HANDOFF_KEY } from "./SharedChart";
import { deleteChart, listCharts, loadChart, setShared, shareLink, type ChartRow } from "@/lib/store/charts";
import { accountChanged, useAccount } from "@/lib/store/account";

export default function Songs() {
  const router = useRouter();
  const { user, account, ready } = useAccount();
  const [rows, setRows] = useState<ChartRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    try { setRows(await listCharts()); } catch (e) { setError(e instanceof Error ? e.message : "could not list your songs"); }
  }, [user]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function run(id: string, fn: () => Promise<void>) {
    setBusy(id);
    setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "that did not work"); } finally { setBusy(null); }
  }

  const open = (r: ChartRow) =>
    run(r.id, async () => {
      const chart = await loadChart(r.id);
      if (!chart) throw new Error("That song has gone.");
      sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(chart));
      sessionStorage.setItem(HANDOFF_ID_KEY, r.id);
      router.push("/studio");
    });

  if (!ready) return null;

  if (!user) {
    return (
      <section className="panel max-w-xl p-5">
        <p className="mb-4 text-sm text-white/55">Sign in to see the songs you have saved.</p>
        <SignIn />
      </section>
    );
  }

  return (
    <>
      {account && (
        <div className="mb-6 max-w-sm">
          <Meter label="Saved songs" used={account.songs} limit={account.songs_limit} />
        </div>
      )}
      {!rows ? (
        <p className="flex items-center gap-2 text-sm text-white/45"><Loader2 className="animate-spin" size={14} /> Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-white/45">
          Nothing saved yet. Transcribe a part in the <a className="underline" href="/studio">studio</a> and press Save.
        </p>
      ) : (
        <ul className="panel divide-y divide-white/5">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <button className="min-w-0 flex-1 truncate text-left hover:text-[var(--color-accent)]" onClick={() => void open(r)}>
                {r.title}
              </button>
              {r.shared && <span className="text-[10px] uppercase tracking-wide text-emerald-300/70">shared</span>}
              <span className="text-xs text-white/30">{new Date(r.updated_at).toLocaleDateString()}</span>
              {busy === r.id && <Loader2 className="animate-spin text-white/40" size={14} />}
              {r.shared && (
                <button
                  className="text-white/35 hover:text-white"
                  aria-label="Copy link"
                  onClick={async () => {
                    await navigator.clipboard.writeText(shareLink(r.id));
                    setCopied(r.id);
                    setTimeout(() => setCopied(null), 2000);
                  }}
                >
                  {copied === r.id ? <Check size={14} className="text-emerald-300" /> : <Link2 size={14} />}
                </button>
              )}
              <button
                className={r.shared ? "text-emerald-300/70 hover:text-white" : "text-white/35 hover:text-white"}
                aria-label={r.shared ? "Stop sharing" : "Share with a link"}
                title={r.shared ? "Stop sharing" : "Share with a link"}
                onClick={() => void run(r.id, async () => { await setShared(r.id, !r.shared); await refresh(); })}
              >
                <Share2 size={14} />
              </button>
              <button
                className="text-white/35 hover:text-red-300"
                aria-label={`Delete ${r.title}`}
                onClick={() => {
                  if (!confirm(`Delete "${r.title}"? This cannot be undone.`)) return;
                  void run(r.id, async () => { await deleteChart(r.id); await refresh(); accountChanged(); });
                }}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
    </>
  );
}
