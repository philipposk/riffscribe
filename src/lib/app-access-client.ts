/**
 * Client-side: records that the signed-in user used this app in the shared 6x7
 * table public.app_access (user_id, app, first_seen, last_seen; RLS = own rows).
 * first_seen of a user's earliest row = the app they signed up on.
 * Throttled per user via localStorage (once per 6h). Never throws.
 */
export async function trackAppAccessClient(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  user: { id: string } | null | undefined,
  app: string,
): Promise<void> {
  if (!supabase || !user || typeof window === "undefined") return;
  const key = `x6_seen_${app}_${user.id.slice(0, 8)}`;
  try {
    if (Date.now() - Number(window.localStorage.getItem(key) || 0) < 6 * 3600e3) return;
    const table = typeof supabase.schema === "function" ? supabase.schema("public").from("app_access") : supabase.from("app_access");
    const { error } = await table.upsert(
      { user_id: user.id, app, last_seen: new Date().toISOString() },
      { onConflict: "user_id,app" },
    );
    if (!error) window.localStorage.setItem(key, String(Date.now()));
  } catch {
    /* tracking must never break auth */
  }
}
