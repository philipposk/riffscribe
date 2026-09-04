"use client";
/**
 * Signing in, saving a chart, and handing someone the link.
 *
 * Only the chart travels — parts, tempo, key, sections, loop. The recording
 * stays on the machine it came from. That is what makes sharing worth having:
 * an arranger sends one link to three players and each opens the same parts
 * against their own copy of the song.
 *
 * Everything here is optional. With no Supabase project configured, this
 * renders nothing and the studio works exactly as it did before.
 */
import { useCallback, useEffect, useState } from "react";
import { Check, Link2, Loader2, LogOut, Save, Share2, Trash2, User } from "lucide-react";

import { savingConfigured } from "@/lib/supabase/client";
import {
  currentUser, deleteChart, listCharts, loadChart, onAuthChange, saveChart, setShared,
  shareLink, signInWithEmail, signInWithGoogle, signOut, type Chart, type ChartRow,
} from "@/lib/store/charts";

interface Props {
  /** Built lazily — no point serialising the parts on every render. */
  buildChart: () => Chart | null;
  onOpen: (chart: Chart) => void;
  /** Set once a chart has been saved, so Save updates rather than duplicating. */
  chartId: string | null;
  onChartId: (id: string | null) => void;
}

export default function SaveBar({ buildChart, onOpen, chartId, onChartId }: Props) {
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ChartRow[] | null>(null);
  const [email, setEmail] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!savingConfigured) return;
    void currentUser().then((u) => { setUser(u); setReady(true); });
    return onAuthChange(setUser);
  }, []);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      setRows(await listCharts());
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not list your charts");
    }
  }, [user]);

  useEffect(() => { void refresh(); }, [refresh]);

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
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn" disabled={!ready || !!busy} onClick={() => void run("google", signInWithGoogle)}>
            {busy === "google" ? <Loader2 className="animate-spin" size={15} /> : <User size={15} />}
            Continue with Google
          </button>
          <span className="text-xs text-white/30">or</span>
          <input
            type="email"
            className="min-w-0 flex-1 text-sm"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button
            className="btn"
            disabled={!email.includes("@") || !!busy}
            onClick={() =>
              void run("email", async () => {
                await signInWithEmail(email.trim());
                setNote("Check your email — the link signs you in.");
              })
            }
          >
            {busy === "email" ? <Loader2 className="animate-spin" size={15} /> : null}
            Email me a link
          </button>
        </div>
        {note && <p className="mt-3 text-xs text-emerald-300/80">{note}</p>}
        {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
      </section>
    );
  }

  const saved = rows?.find((r) => r.id === chartId) ?? null;

  return (
    <section className="panel no-print mb-5 p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-base font-medium">Your charts</h2>
        <span className="text-xs text-white/35">{user.email}</span>
        <button
          className="ml-auto text-xs text-white/40 hover:text-white/80"
          onClick={() => void run("out", async () => { await signOut(); setRows(null); onChartId(null); })}
        >
          <LogOut size={12} className="mr-1 inline" /> Sign out
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          className="btn btn-primary"
          disabled={!!busy}
          onClick={() =>
            void run("save", async () => {
              const chart = buildChart();
              if (!chart) throw new Error("There is nothing to save yet — transcribe a part first.");
              const id = await saveChart(chart, chartId ?? undefined);
              onChartId(id);
              setNote(chartId ? "Saved." : "Saved. It will be here next time.");
              await refresh();
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
      </div>

      {rows && rows.length > 0 && (
        <ul className="divide-y divide-white/5 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-2 py-2">
              <button
                className={`flex-1 truncate text-left hover:text-white ${r.id === chartId ? "text-white" : "text-white/60"}`}
                onClick={() =>
                  void run("open", async () => {
                    const chart = await loadChart(r.id);
                    if (!chart) throw new Error("that chart has gone");
                    onOpen(chart);
                    onChartId(r.id);
                    setNote(`Opened "${r.title}". Load the song itself to hear it.`);
                  })
                }
              >
                {r.title}
              </button>
              {r.shared && <span className="text-[10px] uppercase tracking-wide text-emerald-300/70">shared</span>}
              <span className="text-xs text-white/25">{new Date(r.updated_at).toLocaleDateString()}</span>
              <button
                className="text-white/25 hover:text-red-300"
                aria-label={`Delete ${r.title}`}
                onClick={() =>
                  void run("delete", async () => {
                    await deleteChart(r.id);
                    if (chartId === r.id) onChartId(null);
                    await refresh();
                  })
                }
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {rows && rows.length === 0 && (
        <p className="text-xs text-white/35">Nothing saved yet.</p>
      )}
      {note && <p className="mt-3 text-xs text-emerald-300/80">{note}</p>}
      {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
    </section>
  );
}
