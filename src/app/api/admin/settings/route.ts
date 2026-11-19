/**
 * The admin's model settings.
 *
 * GET: the saved settings, the allowlist with prices, and the last 30 days of
 * model usage with an estimated cost per row. PUT: save new settings, only if
 * every value is on the allowlist. Admins only (lib/admin.ts); everyone else
 * gets 403. Writes go through the admin's own client, so row-level security
 * applies; only the bootstrap admin (no riffscribe_admins row yet) writes with
 * the service role.
 */
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireAdmin, type Admin } from "@/lib/admin";
import { invalidateLlmSettings } from "@/lib/llm/settings";
import {
  EFFORTS,
  MODELS,
  TASKS,
  TASK_IDS,
  defaultLlmSettings,
  estimateCost,
  parseLlmSettings,
  validateLlmSettings,
  type ModelInfo,
} from "@/lib/llm/models";
import { serviceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 20_000;
const USAGE_DAYS = 30;
const NO_STORE = { "Cache-Control": "no-store" };

const forbidden = () => NextResponse.json({ error: "not available" }, { status: 403, headers: NO_STORE });

function dbFor(who: Admin): SupabaseClient {
  return who.bootstrap && process.env.SUPABASE_SERVICE_ROLE_KEY ? serviceClient() : who.db;
}

interface UsageRow {
  day: string;
  task: string;
  model: string;
  requests: number;
  input_tokens: number;
  cached_tokens: number;
  output_tokens: number;
  fallbacks: number;
}

export async function GET(req: Request) {
  const who = await requireAdmin(req);
  if (!who) return forbidden();
  const db = dbFor(who);

  let settings = defaultLlmSettings();
  let stored = false;
  try {
    const { data, error } = await db.from("riffscribe_settings").select("value").eq("key", "llm").maybeSingle();
    if (!error && data) {
      settings = parseLlmSettings(data.value);
      stored = true;
    }
  } catch {
    /* defaults */
  }

  let usage: (UsageRow & { cost: number | null })[] = [];
  let usageAvailable = false;
  try {
    const since = new Date(Date.now() - USAGE_DAYS * 86_400_000).toISOString().slice(0, 10);
    const { data, error } = await db
      .from("riffscribe_llm_usage")
      .select("day, task, model, requests, input_tokens, cached_tokens, output_tokens, fallbacks")
      .gte("day", since)
      .order("day", { ascending: false })
      .limit(2000);
    if (!error && Array.isArray(data)) {
      usageAvailable = true;
      usage = (data as UsageRow[]).map((r) => ({
        ...r,
        cost: estimateCost(r.model, Number(r.input_tokens), Number(r.cached_tokens), Number(r.output_tokens)),
      }));
    }
  } catch {
    /* no usage table yet */
  }

  const models = Object.fromEntries(
    Object.entries(MODELS as Record<string, ModelInfo>).map(([key, m]) => [
      key,
      { label: m.label, provider: m.provider, input: m.input, output: m.output, priceKnown: m.priceKnown },
    ])
  );
  const tasks = Object.fromEntries(
    TASK_IDS.map((id) => [
      id,
      { label: TASKS[id].label, default: TASKS[id].default, fallback: TASKS[id].fallback, allowed: TASKS[id].allowed },
    ])
  );

  return NextResponse.json(
    {
      settings,
      stored,
      models,
      tasks,
      efforts: EFFORTS,
      usage,
      usageAvailable,
      keys: { anthropic: Boolean(process.env.ANTHROPIC_API_KEY), openrouter: Boolean(process.env.OPENROUTER_API_KEY) },
    },
    { headers: NO_STORE }
  );
}

export async function PUT(req: Request) {
  const who = await requireAdmin(req);
  if (!who) return forbidden();

  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "request too large" }, { status: 413 });
  }
  const raw = await req.text().catch(() => "");
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "request too large" }, { status: 413 });
  }
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const checked = validateLlmSettings(input);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

  const { error } = await dbFor(who)
    .from("riffscribe_settings")
    .upsert(
      { key: "llm", value: checked.value, updated_at: new Date().toISOString(), updated_by: who.user.id },
      { onConflict: "key" }
    );
  if (error) {
    return NextResponse.json(
      { error: "could not save the settings (has supabase/migrations/0007_admin.sql run?)" },
      { status: 502 }
    );
  }
  invalidateLlmSettings();
  return NextResponse.json({ settings: checked.value }, { headers: NO_STORE });
}
