/**
 * The one server route the assistant needs: a single tool-calling round.
 *
 * The API key stays here. The grounding loop itself runs in the browser, so the
 * assistant's capabilities execute against the real studio and their results are
 * never round-tripped through the model.
 *
 * Riffscribe has no accounts, so this endpoint is spend-limited rather than
 * auth-gated: a small model, a hard token ceiling, a cap on how much context a
 * caller can push, and a per-IP request budget. If it is ever opened up further,
 * put it behind a session first.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = process.env.ASSISTANT_MODEL || "google/gemini-2.0-flash-001";

// Spend guards. These are deliberately tight — this route is unauthenticated.
const MAX_OUTPUT_TOKENS = 700;
const MAX_MESSAGES = 24;
const MAX_CHARS_PER_MESSAGE = 6000;
const MAX_TOTAL_CHARS = 40000;
const MAX_TOOLS = 40;
const WINDOW_MS = 60 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 60;

type Role = "user" | "assistant" | "system" | "tool";
interface ChatMessage {
  role: Role;
  content: string;
  toolName?: string;
  toolCallId?: string;
  toolCalls?: { id?: string; name: string; args?: Record<string, unknown> }[];
}

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

const clip = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : "");

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

  let body: {
    system?: string;
    messages?: ChatMessage[];
    tools?: { name: string; description: string; parameters: unknown }[];
    forceTool?: string;
    temperature?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const history = (body.messages ?? []).slice(-MAX_MESSAGES);
  let budget = MAX_TOTAL_CHARS;
  const messages: Record<string, unknown>[] = [
    { role: "system", content: clip(body.system, MAX_CHARS_PER_MESSAGE) },
  ];

  for (const m of history) {
    const content = clip(m.content, Math.min(MAX_CHARS_PER_MESSAGE, Math.max(0, budget)));
    budget -= content.length;
    if (m.role === "tool") {
      messages.push({ role: "tool", tool_call_id: m.toolCallId ?? m.toolName ?? "tool", content });
    } else if (m.role === "assistant" && m.toolCalls?.length) {
      messages.push({
        role: "assistant",
        content: content || null,
        tool_calls: m.toolCalls.slice(0, MAX_TOOLS).map((c, i) => ({
          id: c.id ?? `call_${i}`,
          type: "function",
          function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
        })),
      });
    } else if (m.role === "user" || m.role === "assistant") {
      messages.push({ role: m.role, content });
    }
  }

  const tools = (body.tools ?? []).slice(0, MAX_TOOLS).map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: clip(t.description, 600),
      parameters: t.parameters ?? { type: "object", properties: {} },
    },
  }));

  const payload: Record<string, unknown> = {
    // the model is fixed server-side; a client cannot upgrade itself to a pricier one
    model: DEFAULT_MODEL,
    messages,
    max_tokens: MAX_OUTPUT_TOKENS,
    temperature: typeof body.temperature === "number" ? Math.max(0, Math.min(1, body.temperature)) : 0.2,
  };
  if (tools.length) {
    payload.tools = tools;
    payload.tool_choice = body.forceTool
      ? { type: "function", function: { name: body.forceTool } }
      : "auto";
  }

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
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    return NextResponse.json({ error: "assistant backend unreachable" }, { status: 502 });
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: `assistant backend ${upstream.status}`, detail: detail.slice(0, 400) },
      { status: upstream.status === 429 ? 429 : 502 }
    );
  }

  const json = await upstream.json().catch(() => null);
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
