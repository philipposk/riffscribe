import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Next inlines `process.env.NEXT_PUBLIC_*` by matching the text of the
// expression, so these have to be spelled out rather than looked up through a
// variable — `process.env[name]` would be undefined in the browser bundle.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Saving is optional. With no project configured the studio behaves exactly as
 * it did before — everything local, nothing to sign into — and the save and
 * share controls do not appear at all.
 */
export const savingConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let cached: SupabaseClient | null = null;

/**
 * The session lives in localStorage rather than cookies. Nothing here is
 * rendered on a server or guarded by middleware — the studio is a single
 * client-side page — so cookies would buy nothing and cost a callback route,
 * a server client and a middleware pass.
 */
export function supabase(): SupabaseClient | null {
  if (!savingConfigured) return null;
  if (!cached) {
    cached = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Finish an OAuth or magic-link redirect on the page it lands on.
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    });
  }
  return cached;
}
