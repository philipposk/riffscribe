/**
 * Saving and sharing a chart.
 *
 * A chart is what you worked out about a song: the parts you transcribed, the
 * tempo and key you settled on, the sections you named, the loop you kept
 * coming back to. It is a few kilobytes of JSON.
 *
 * The audio is deliberately not part of it. A four-minute song is around 85 MB
 * of samples and four times that again as stems; uploading it would be slower
 * than re-splitting it locally, it would cost real money to store, and it would
 * mean hosting recordings we have no right to host. Stems stay on the machine
 * that made them (see cache.ts) and only the chart travels.
 *
 * That also makes sharing work the way a musician would want: send the link to
 * the other three players and each of them opens the same parts, tempo and
 * markings against their own copy of the song.
 */
import { supabase } from "../supabase/client";
import type { Part, TranscriptionSettings } from "../types";

export const CHART_VERSION = 1;

export interface Chart {
  version: number;
  title: string;
  settings: TranscriptionSettings;
  parts: Part[];
  sections: { name: string; from: number; to: number }[];
  loop: [number, number] | null;
}

export interface ChartRow {
  id: string;
  title: string;
  shared: boolean;
  updated_at: string;
  data?: Chart;
}

export class NotConfigured extends Error {
  constructor() {
    super("Saving is not set up on this deployment.");
  }
}

function db() {
  const s = supabase();
  if (!s) throw new NotConfigured();
  return s;
}

/* ------------------------------------------------------------------- auth */

export async function currentUser(): Promise<{ id: string; email?: string } | null> {
  const s = supabase();
  if (!s) return null;
  const { data } = await s.auth.getUser();
  return data.user ? { id: data.user.id, email: data.user.email ?? undefined } : null;
}

export function onAuthChange(fn: (user: { id: string; email?: string } | null) => void): () => void {
  const s = supabase();
  if (!s) return () => {};
  const { data } = s.auth.onAuthStateChange((_e, session) => {
    fn(session?.user ? { id: session.user.id, email: session.user.email ?? undefined } : null);
  });
  return () => data.subscription.unsubscribe();
}

export async function signInWithGoogle(): Promise<void> {
  const { error } = await db().auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${location.origin}/studio` },
  });
  if (error) throw error;
}

/** The address-only route, for anyone who would rather not use a Google account. */
export async function signInWithEmail(email: string): Promise<void> {
  const { error } = await db().auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${location.origin}/studio` },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  await db().auth.signOut();
}

/* ----------------------------------------------------------------- charts */

export async function listCharts(): Promise<ChartRow[]> {
  const { data, error } = await db()
    .from("charts")
    .select("id, title, shared, updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ChartRow[];
}

export async function saveChart(chart: Chart, id?: string): Promise<string> {
  const s = db();
  const { data: userData } = await s.auth.getUser();
  const owner = userData.user?.id;
  if (!owner) throw new Error("Sign in first.");

  if (id) {
    const { error } = await s
      .from("charts")
      .update({ title: chart.title, data: chart, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
    return id;
  }
  const { data, error } = await s
    .from("charts")
    .insert({ owner, title: chart.title, data: chart })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

/**
 * Read one chart. This works for a signed-out visitor too when the owner has
 * shared it — the row-level policy allows that and nothing else.
 */
export async function loadChart(id: string): Promise<Chart | null> {
  const { data, error } = await db().from("charts").select("data").eq("id", id).maybeSingle();
  if (error) throw error;
  const row = data as { data: Chart } | null;
  return row?.data ?? null;
}

export async function deleteChart(id: string): Promise<void> {
  const { error } = await db().from("charts").delete().eq("id", id);
  if (error) throw error;
}

/** Turn the link on or off. Off means nobody but the owner can open it again. */
export async function setShared(id: string, shared: boolean): Promise<void> {
  const { error } = await db().from("charts").update({ shared }).eq("id", id);
  if (error) throw error;
}

export function shareLink(id: string): string {
  return `${location.origin}/c/${id}`;
}
