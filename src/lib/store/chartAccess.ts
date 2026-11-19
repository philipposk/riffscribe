/**
 * Reading, listing, sharing and deleting charts, kept free of the browser-only
 * imports in charts.ts so scripts/verify-account-data.mjs can drive it.
 *
 * Row-level security lets a signed-in person read their own rows; someone
 * else's shared chart is read through riffscribe_shared_chart, one id at a
 * time, so the shared rows cannot be listed (supabase/migrations/0003).
 */
import type { Chart, ChartRow } from "./charts";

/** The slice of the Supabase client these need. */
export interface ChartsDb {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args?: Record<string, unknown>) => any;
}

export const NOT_YOURS = "That song is not yours or has gone.";

/** PostgREST / Postgres codes for "no such function" — a database without migrations/0003. */
const NO_FUNCTION = new Set(["PGRST202", "42883"]);

export async function listOwnCharts(s: ChartsDb, owner: string | null): Promise<ChartRow[]> {
  if (!owner) return [];
  const { data, error } = await s
    .from("riffscribe_charts")
    .select("id, title, shared, updated_at")
    .eq("owner", owner)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ChartRow[];
}

/** Your own chart, or anyone's chart they have shared. Null when neither. */
export async function readChart(s: ChartsDb, id: string): Promise<Chart | null> {
  const { data, error } = await s.from("riffscribe_charts").select("data").eq("id", id).maybeSingle();
  if (error) throw error;
  const row = data as { data: Chart } | null;
  if (row) return row.data ?? null;

  const shared = await s.rpc("riffscribe_shared_chart", { chart_id: id });
  if (shared.error) {
    if (NO_FUNCTION.has(shared.error.code)) return null;
    throw shared.error;
  }
  return (shared.data as Chart | null) ?? null;
}

/**
 * Row-level security makes a write to someone else's row match nothing, and
 * PostgREST answers that with success, so the rows are read back.
 */
export async function deleteOwnChart(s: ChartsDb, id: string): Promise<void> {
  const { data, error } = await s.from("riffscribe_charts").delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error(NOT_YOURS);
}

export async function setChartShared(s: ChartsDb, id: string, shared: boolean): Promise<void> {
  const { data, error } = await s.from("riffscribe_charts").update({ shared }).eq("id", id).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error(NOT_YOURS);
}
