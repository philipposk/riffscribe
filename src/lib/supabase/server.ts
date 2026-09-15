/**
 * Who is calling a server route.
 *
 * The session lives in the browser (see client.ts), so a route learns who is
 * asking from the access token — sent as a bearer header by our own fetches,
 * or as the `rs_at` cookie, which is how the assistant widget's requests carry
 * it (the widget sets its own headers and has no hook for ours).
 *
 * The token is checked with Supabase on every call, never just decoded.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const AUTH_COOKIE = "rs_at";

function tokenFrom(req: Request): string | null {
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) return bearer;
  const cookie = req.headers.get("cookie") ?? "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${AUTH_COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

/** A client acting as the caller, so row-level security applies, plus their id. */
export async function caller(
  req: Request
): Promise<{ db: SupabaseClient; user: { id: string; email?: string } } | null> {
  if (!URL || !ANON) return null;
  const token = tokenFrom(req);
  if (!token) return null;
  const db = createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data } = await db.auth.getUser(token);
  if (!data.user) return null;
  return { db, user: { id: data.user.id, email: data.user.email ?? undefined } };
}

/** Service role — only for the Stripe webhook, which has no user session. */
export function serviceClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(URL, key, { auth: { persistSession: false } });
}
