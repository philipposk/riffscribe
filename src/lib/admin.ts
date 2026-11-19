/**
 * Who may change the app's settings.
 *
 * An admin is a row in riffscribe_admins (migration 0007), checked through
 * riffscribe_is_admin() as the caller. The one user whose id is
 * RIFFSCRIBE_ADMIN_BOOTSTRAP is also let in, for as long as it is set, whether
 * or not the table has rows, so the first admin can set things up. Delete the
 * variable once an admin row exists.
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { caller } from "@/lib/supabase/server";

export interface Admin {
  db: SupabaseClient;
  user: { id: string; email?: string };
  /** Let in by RIFFSCRIBE_ADMIN_BOOTSTRAP, not by a riffscribe_admins row. */
  bootstrap: boolean;
}

export async function requireAdmin(req: Request): Promise<Admin | null> {
  const who = await caller(req);
  if (!who) return null;
  try {
    const { data, error } = await who.db.rpc("riffscribe_is_admin");
    if (!error && data === true) return { ...who, bootstrap: false };
  } catch {
    /* not admin */
  }
  const seed = process.env.RIFFSCRIBE_ADMIN_BOOTSTRAP?.trim();
  if (seed && seed === who.user.id) return { ...who, bootstrap: true };
  return null;
}
