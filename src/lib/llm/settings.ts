/**
 * The admin's model settings, read on the server with the service role and
 * kept for a minute per server instance.
 *
 * Any failure (no service key, migration 0007 not run, a bad row) means the
 * defaults from models.ts, so the assistant keeps working either way.
 */
import "server-only";

import { serviceClient } from "@/lib/supabase/server";
import { defaultLlmSettings, parseLlmSettings, type LlmSettings } from "./models";

const TTL_MS = 60_000;
let cache: { value: LlmSettings; at: number } | null = null;

export async function getLlmSettings(): Promise<LlmSettings> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.value;
  let value = defaultLlmSettings();
  if (process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    try {
      const { data, error } = await serviceClient()
        .from("riffscribe_settings")
        .select("value")
        .eq("key", "llm")
        .maybeSingle();
      if (!error && data) value = parseLlmSettings(data.value);
    } catch {
      /* defaults */
    }
  }
  cache = { value, at: now };
  return value;
}

/** Forget the cached settings on this instance, after an admin saves new ones. */
export function invalidateLlmSettings() {
  cache = null;
}
