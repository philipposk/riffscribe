/**
 * The database half of saving a chart, kept free of the browser-only imports in
 * charts.ts so it can be checked on its own (scripts/verify-studio-state.mjs).
 */
import type { Chart } from "./charts";

/** The slice of the Supabase client saving needs. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ChartsClient { from: (table: string) => any }

/**
 * Update the chart `id`, or insert a new one.
 *
 * An update that matches no row (deleted in another tab or on another device,
 * or not ours to change) is not an error to PostgREST — it answers with no rows —
 * so the row is read back. When nothing came back the work is saved as a new
 * chart instead of being reported as saved and lost. The returned id differs
 * from `id` in that case.
 */
export async function writeChart(s: ChartsClient, owner: string, chart: Chart, id?: string): Promise<string> {
  if (id) {
    const { data, error } = await s
      .from("riffscribe_charts")
      .update({ title: chart.title, data: chart, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (data) return id;
  }
  const { data, error } = await s
    .from("riffscribe_charts")
    .insert({ owner, title: chart.title, data: chart })
    .select("id")
    .single();
  if (error?.message?.includes("riffscribe_song_limit")) {
    throw new Error("Your plan's song limit is reached — delete an old song or upgrade to Pro.");
  }
  if (error) throw error;
  return (data as { id: string }).id;
}
