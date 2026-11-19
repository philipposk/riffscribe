"use client";
/**
 * The admin page: which model each task uses, how hard it thinks, whether it
 * is on, and the last 30 days of model usage with an estimated cost.
 * Everyone who is not an admin sees "Not available."
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { supabase } from "@/lib/supabase/client";

type Effort = "low" | "medium" | "high";
interface TaskSettings { model: string; effort: Effort; enabled: boolean }
interface ModelRow { label: string; provider: string; input: number; output: number; priceKnown: boolean }
interface TaskRow { label: string; default: string; fallback: string; allowed: string[] }
interface UsageRow {
  day: string;
  task: string;
  model: string;
  requests: number;
  input_tokens: number;
  cached_tokens: number;
  output_tokens: number;
  fallbacks: number;
  cost: number | null;
}
interface AdminData {
  settings: Record<string, TaskSettings>;
  stored: boolean;
  models: Record<string, ModelRow>;
  tasks: Record<string, TaskRow>;
  efforts: Effort[];
  usage: UsageRow[];
  usageAvailable: boolean;
  keys: { anthropic: boolean; openrouter: boolean };
}

async function call(method: "GET" | "PUT", body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const token = (await supabase()?.auth.getSession())?.data.session?.access_token;
  if (!token) return { status: 401, json: {} };
  const res = await fetch("/api/admin/settings", {
    method,
    cache: "no-store",
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
}

/** The admin data, or null when this person is not an admin (or signed out). */
async function fetchAdmin(): Promise<AdminData | null> {
  try {
    const { status, json } = await call("GET");
    return status === 200 ? (json as unknown as AdminData) : null;
  } catch {
    return null;
  }
}

const price = (m: ModelRow) => (m.priceKnown ? `$${m.input} in / $${m.output} out per MTok` : "price unknown");
const usd = (n: number | null) => (n === null ? "—" : n < 0.01 && n > 0 ? "<$0.01" : `$${n.toFixed(2)}`);
const num = (n: number) => Number(n).toLocaleString("en");

export default function AdminSettings() {
  const [state, setState] = useState<"loading" | "denied" | "ready">("loading");
  const [data, setData] = useState<AdminData | null>(null);
  const [draft, setDraft] = useState<Record<string, TaskSettings>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((d: AdminData | null) => {
    if (!d) { setState("denied"); return; }
    setData(d);
    setDraft(d.settings);
    setState("ready");
  }, []);

  useEffect(() => { void fetchAdmin().then(apply); }, [apply]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(data?.settings ?? {}), [draft, data]);

  async function save() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const { status, json } = await call("PUT", draft);
      if (status !== 200) {
        setError(typeof json.error === "string" ? json.error : "could not save");
      } else {
        setNote("Saved. Other server instances pick it up within a minute.");
        apply(await fetchAdmin());
      }
    } catch {
      setError("could not save");
    }
    setBusy(false);
  }

  if (state === "loading") {
    return (
      <div className="panel flex max-w-xl items-center gap-2 p-5 text-sm text-white/60" aria-busy="true">
        <Loader2 size={14} className="animate-spin" /> Loading…
      </div>
    );
  }
  if (state === "denied" || !data) return <p className="text-sm text-white/60">Not available.</p>;

  const totals = data.usage.reduce(
    (t, r) => ({ requests: t.requests + Number(r.requests), cost: t.cost + (r.cost ?? 0) }),
    { requests: 0, cost: 0 }
  );

  return (
    <div className="space-y-6">
      {!data.keys.anthropic && (
        <p className="text-sm text-amber-300">
          ANTHROPIC_API_KEY is not set on this deployment: every round goes to the OpenRouter fallback.
        </p>
      )}
      {!data.stored && (
        <p className="text-sm text-white/50">No settings saved yet; the defaults below are in use.</p>
      )}

      {Object.entries(data.tasks).map(([id, task]) => {
        const s = draft[id];
        if (!s) return null;
        const set = (patch: Partial<TaskSettings>) => setDraft((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
        return (
          <section key={id} className="panel max-w-xl space-y-4 p-5" aria-labelledby={`task-${id}`}>
            <h2 id={`task-${id}`} className="font-medium">{task.label}</h2>
            <div>
              <label htmlFor={`model-${id}`} className="mb-1 block text-xs text-white/55">Model</label>
              <select
                id={`model-${id}`}
                className="w-full"
                value={s.model}
                onChange={(e) => set({ model: e.target.value })}
              >
                {task.allowed.map((key) => {
                  const m = data.models[key];
                  return (
                    <option key={key} value={key}>
                      {m ? `${m.label} — ${price(m)}` : key}{key === task.default ? " (default)" : ""}
                    </option>
                  );
                })}
              </select>
              <p className="mt-1 text-xs text-white/40">
                Fallback when Claude is unavailable: {data.models[task.fallback]?.label ?? task.fallback}
              </p>
            </div>
            <div>
              <label htmlFor={`effort-${id}`} className="mb-1 block text-xs text-white/55">Effort</label>
              <select
                id={`effort-${id}`}
                value={s.effort}
                onChange={(e) => set({ effort: e.target.value as Effort })}
              >
                {data.efforts.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
              Enabled
            </label>
          </section>
        );
      })}

      <div className="flex items-center gap-3">
        <button className="btn btn-primary" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </button>
        {note && <span className="text-sm text-white/60" role="status">{note}</span>}
        {error && <span className="text-sm text-[var(--color-danger)]" role="alert">{error}</span>}
      </div>

      <section className="panel p-5" aria-labelledby="usage-heading">
        <h2 id="usage-heading" className="mb-1 font-medium">Usage, last 30 days</h2>
        <p className="mb-3 text-xs text-white/45">
          {data.usageAvailable
            ? `${num(totals.requests)} requests, about ${usd(totals.cost)} at list prices.`
            : "No usage table yet (run supabase/migrations/0007_admin.sql)."}
        </p>
        {data.usage.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-xs tabular-nums">
              <thead className="text-white/45">
                <tr>
                  <th scope="col" className="py-1 pr-3 font-normal">Day</th>
                  <th scope="col" className="py-1 pr-3 font-normal">Task</th>
                  <th scope="col" className="py-1 pr-3 font-normal">Model</th>
                  <th scope="col" className="py-1 pr-3 text-right font-normal">Requests</th>
                  <th scope="col" className="py-1 pr-3 text-right font-normal">Input</th>
                  <th scope="col" className="py-1 pr-3 text-right font-normal">Cached</th>
                  <th scope="col" className="py-1 pr-3 text-right font-normal">Output</th>
                  <th scope="col" className="py-1 pr-3 text-right font-normal">Fallbacks</th>
                  <th scope="col" className="py-1 text-right font-normal">Cost</th>
                </tr>
              </thead>
              <tbody>
                {data.usage.map((r) => (
                  <tr key={`${r.day}-${r.task}-${r.model}`} className="border-t border-[var(--color-line)]">
                    <td className="py-1 pr-3">{r.day}</td>
                    <td className="py-1 pr-3">{r.task}</td>
                    <td className="py-1 pr-3">{data.models[r.model]?.label ?? r.model}</td>
                    <td className="py-1 pr-3 text-right">{num(r.requests)}</td>
                    <td className="py-1 pr-3 text-right">{num(r.input_tokens)}</td>
                    <td className="py-1 pr-3 text-right">{num(r.cached_tokens)}</td>
                    <td className="py-1 pr-3 text-right">{num(r.output_tokens)}</td>
                    <td className="py-1 pr-3 text-right">{num(r.fallbacks)}</td>
                    <td className="py-1 text-right">{usd(r.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
