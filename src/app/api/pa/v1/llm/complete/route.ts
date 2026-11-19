/**
 * The one server route the assistant needs: a single tool-calling round.
 *
 * The API key stays here. The grounding loop itself runs in the browser, so the
 * assistant's capabilities execute against the real studio and their results are
 * never round-tripped through the model.
 *
 * The caller must be signed in, and each round spends one request from their
 * plan's monthly allowance (riffscribe_use_assistant, enforced in the
 * database) — only once the request is valid, and handed back when the model
 * gives no answer. The spend guards stay too: a small model, a hard token
 * ceiling, a cap on everything a caller can push (lib/assistantRequest.ts), and
 * a per-IP request budget.
 */
import { NextResponse } from "next/server";

import { LIMITS, QUOTA_USED_UP_TEXT, buildCompletion, usagePeriod } from "@/lib/assistantRequest";
import { caller, serviceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
// Small, cheap and reliable at tool calling — checked against this key.
const DEFAULT_MODEL = process.env.ASSISTANT_MODEL || "openai/gpt-oss-20b";

const WINDOW_MS = 60 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 60;

// Per-IP budget. In-memory, so it resets when the lambda recycles — enough to
// stop casual abuse, not a substitute for auth.
const hits = new Map<string, { count: number; resetAt: number }>();

function overBudget(ip: string) {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now > entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    if (hits.size > 5000) for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k);
    return false;
  }
  entry.count++;
  return entry.count > MAX_REQUESTS_PER_WINDOW;
}

/**
 * Hand back a request the model never answered. Service role only, so no browser
 * can call it; without the key or supabase/migrations/0003_review_fixes.sql the
 * request simply stays spent, as it always did.
 */
async function refund(userId: string | null, period: string) {
  if (!userId || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    await serviceClient().rpc("riffscribe_refund_assistant", { uid: userId, p: period });
  } catch {
    /* a refund must never turn into an error for the player */
  }
}

export async function POST(req: Request) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "assistant is not configured on this deployment" }, { status: 503 });
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  if (overBudget(ip)) {
    return NextResponse.json(
      { error: "too many assistant requests from this address — try again later" },
      { status: 429 }
    );
  }

  // Deployments without Supabase have no accounts; they keep only the IP budget.
  const who = process.env.NEXT_PUBLIC_SUPABASE_URL ? await caller(req) : null;
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && !who) {
    return NextResponse.json({ error: "sign in to use the assistant" }, { status: 401 });
  }

  // Size and shape first, so a request that cannot be sent costs nothing.
  if (Number(req.headers.get("content-length") ?? 0) > LIMITS.maxBodyChars * 4) {
    return NextResponse.json({ error: "request too large" }, { status: 413 });
  }
  const built = buildCompletion(await req.text().catch(() => ""), DEFAULT_MODEL);
  if (!built.ok) return NextResponse.json({ error: built.error }, { status: built.status });

  const period = usagePeriod();
  if (who) {
    const { data: allowed, error } = await who.db.rpc("riffscribe_use_assistant");
    if (error) return NextResponse.json({ error: "could not check your plan" }, { status: 502 });
    if (!allowed) {
      // An answer, not an error: the widget shows any rate-limit status as "busy, try again",
      // which can never succeed this month and hides the way to more requests.
      return NextResponse.json({ toolCalls: [], text: QUOTA_USED_UP_TEXT, provider: DEFAULT_MODEL });
    }
  }
  const userId = who?.user.id ?? null;

  let upstream: Response;
  try {
    upstream = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        "http-referer": "https://riffscribe.6x7.gr",
        "x-title": "Riffscribe",
      },
      body: JSON.stringify(built.payload),
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    await refund(userId, period);
    return NextResponse.json({ error: "assistant backend unreachable" }, { status: 502 });
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    await refund(userId, period);
    return NextResponse.json(
      { error: `assistant backend ${upstream.status}`, detail: detail.slice(0, 400) },
      { status: upstream.status === 429 ? 429 : 502 }
    );
  }

  const json = await upstream.json().catch(() => null);
  if (!json) await refund(userId, period);
  const choice = json?.choices?.[0]?.message;
  const toolCalls = (choice?.tool_calls ?? []).map(
    (c: { id?: string; function?: { name?: string; arguments?: string } }) => {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(c.function?.arguments || "{}");
      } catch {
        /* the model produced malformed JSON — grounding will ask it again */
      }
      return { id: c.id, name: c.function?.name ?? "", args };
    }
  );

  return NextResponse.json({
    toolCalls,
    text: typeof choice?.content === "string" ? choice.content : "",
    usage: {
      promptTokens: json?.usage?.prompt_tokens,
      completionTokens: json?.usage?.completion_tokens,
    },
    provider: DEFAULT_MODEL,
  });
}
