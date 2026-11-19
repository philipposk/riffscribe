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
import { authRedirectTo, isNativePlatform, NATIVE_AUTH_REDIRECT } from "../native";
import { supabase } from "../supabase/client";
import type { Part, TranscriptionSettings } from "../types";
import { deleteOwnChart, listOwnCharts, readChart, setChartShared } from "./chartAccess";
import { writeChart } from "./chartSave";

export const CHART_VERSION = 1;

export interface Chart {
  version: number;
  title: string;
  settings: TranscriptionSettings;
  parts: Part[];
  sections: { name: string; from: number; to: number }[];
  loop: [number, number] | null;
  /**
   * Which recording this was written from: its content hash (see cache.ts)
   * and file name. The audio never travels, but on the machine that has it,
   * opening the chart brings the song and its stems straight back.
   */
  songKey?: string;
  fileName?: string;
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

export function db() {
  const s = supabase();
  if (!s) throw new NotConfigured();
  return s;
}

/* ------------------------------------------------------------------- auth */

/**
 * Who is signed in, from the session this browser holds — no network round
 * trip, so flaky Wi-Fi does not read as signed out. The server checks the
 * token itself on every call that matters (row-level security, api routes).
 */
export async function currentUser(): Promise<{ id: string; email?: string } | null> {
  const s = supabase();
  if (!s) return null;
  const { data } = await s.auth.getSession();
  const user = data.session?.user;
  return user ? { id: user.id, email: user.email ?? undefined } : null;
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
  // Website, and any build where Capacitor is absent: redirect this tab.
  // The email link below also comes back on the custom scheme in the shell.
  if (!(await isNativePlatform())) {
    const { error } = await db().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/studio` },
    });
    if (error) throw error;
    return;
  }

  // Phone shell: keep the PKCE verifier in the WebView, finish Google in the
  // system browser, and come back on the custom scheme. NativeShell then
  // opens /studio with the code so this WebView can exchange it.
  const { data, error } = await db().auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: NATIVE_AUTH_REDIRECT, skipBrowserRedirect: true },
  });
  if (error) throw error;
  const url = data?.url;
  if (!url) throw new Error("Google sign-in did not return a URL.");
  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url });
  } catch {
    window.open(url, "_system");
  }
}

/**
 * The address-only route, for anyone who would rather not use a Google account.
 * In the shell the link returns on the custom scheme (see authRedirectTo), so
 * it must be opened on the same phone.
 */
export async function signInWithEmail(email: string): Promise<void> {
  const emailRedirectTo = authRedirectTo(await isNativePlatform(), location.origin);
  const { error } = await db().auth.signInWithOtp({ email, options: { emailRedirectTo } });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  await db().auth.signOut({ scope: "local" });
}

/* ----------------------------------------------------------------- charts */

/** Your own charts. Shared charts are readable by id, never listed. */
export async function listCharts(): Promise<ChartRow[]> {
  const s = db();
  return listOwnCharts(s, (await currentUser())?.id ?? null);
}

export async function saveChart(chart: Chart, id?: string): Promise<string> {
  const s = db();
  const { data: userData } = await s.auth.getUser();
  const owner = userData.user?.id;
  if (!owner) throw new Error("Sign in first.");

  // The table caps a title at 300 characters and a chart at 5 MB (migrations/0003).
  try {
    return await writeChart(s, owner, { ...chart, title: chart.title?.slice(0, 300) }, id);
  } catch (e) {
    if (/riffscribe_charts_data_size/.test((e as Error)?.message ?? "")) {
      throw new Error("This chart is too large to save.");
    }
    throw e;
  }
}

/**
 * Read one chart: your own, or — for anyone, signed out too — one its owner
 * has shared (see chartAccess.ts).
 */
export async function loadChart(id: string): Promise<Chart | null> {
  return readChart(db(), id);
}

export async function deleteChart(id: string): Promise<void> {
  await deleteOwnChart(db(), id);
}

/** Turn the link on or off. Off means nobody but the owner can open it again. */
export async function setShared(id: string, shared: boolean): Promise<void> {
  await setChartShared(db(), id, shared);
}

export function shareLink(id: string): string {
  return `${location.origin}/c/${id}`;
}
