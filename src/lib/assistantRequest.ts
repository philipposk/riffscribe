/**
 * Turns one assistant round from the widget into the payload sent to OpenRouter,
 * with every part of it capped: message text, tool-call arguments, tool schemas,
 * names and ids. Kept free of server imports so scripts/verify-assistant-route.mjs
 * can check it without a server.
 */

export const LIMITS = {
  maxBodyChars: 256_000,
  maxOutputTokens: 700,
  maxMessages: 24,
  maxCharsPerMessage: 6000,
  maxTotalChars: 40_000,
  maxTools: 40,
  maxDescriptionChars: 600,
  maxSchemaChars: 2000,
  maxToolChars: 32_000,
  maxArgsChars: 2000,
  maxIdChars: 64,
  maxPayloadChars: 120_000,
};

/** What OpenAI-style providers accept as a function name. */
const NAME = /^[a-zA-Z0-9_-]{1,64}$/;
const EMPTY_SCHEMA = { type: "object", properties: {} };

/** Shown as the assistant's reply when the month's requests are used up mid-question. */
export const QUOTA_USED_UP_TEXT =
  "This month's assistant requests are used up. [See the plans](/pricing) for more — one question can take several requests when it presses buttons for you.";

type Role = "user" | "assistant" | "system" | "tool";
interface ChatMessage {
  role: Role;
  content: string;
  toolName?: string;
  toolCallId?: string;
  toolCalls?: { id?: string; name: string; args?: Record<string, unknown> }[];
}
interface Body {
  system?: string;
  messages?: ChatMessage[];
  tools?: { name: string; description: string; parameters: unknown }[];
  forceTool?: string;
  temperature?: number;
}

export type Built =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; status: number; error: string };

const clip = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : "");
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A history name or id: clipped, with characters providers reject replaced, never empty. */
function safeName(s: unknown, fallback: string) {
  const v = clip(s, LIMITS.maxIdChars).replace(/[^a-zA-Z0-9_-]/g, "_");
  return v || fallback;
}

/** Parse and cap one round. `raw` is the request body as text, checked for size before parsing. */
export function buildCompletion(raw: string, model: string): Built {
  if (raw.length > LIMITS.maxBodyChars) return { ok: false, status: 413, error: "request too large" };
  let body: Body;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, status: 400, error: "invalid JSON" };
  }
  if (!isObject(body)) return { ok: false, status: 400, error: "invalid JSON" };

  const history = (Array.isArray(body.messages) ? body.messages : []).slice(-LIMITS.maxMessages);
  let budget = LIMITS.maxTotalChars;
  const messages: Record<string, unknown>[] = [
    { role: "system", content: clip(body.system, LIMITS.maxCharsPerMessage) },
  ];

  for (const m of history) {
    if (!isObject(m)) continue;
    const content = clip(m.content, Math.min(LIMITS.maxCharsPerMessage, Math.max(0, budget)));
    budget -= content.length;
    if (m.role === "tool") {
      const id = safeName(m.toolCallId ?? m.toolName, "tool");
      budget -= id.length;
      messages.push({ role: "tool", tool_call_id: id, content });
    } else if (m.role === "assistant" && Array.isArray(m.toolCalls) && m.toolCalls.length) {
      messages.push({
        role: "assistant",
        content: content || null,
        tool_calls: m.toolCalls.slice(0, LIMITS.maxTools).map((c, i) => {
          const id = safeName(c?.id, `call_${i}`);
          const name = safeName(c?.name, "tool");
          let args = isObject(c?.args) ? JSON.stringify(c.args) : "{}";
          if (args.length > Math.min(LIMITS.maxArgsChars, Math.max(0, budget))) args = "{}";
          budget -= id.length + name.length + args.length;
          return { id, type: "function", function: { name, arguments: args } };
        }),
      });
    } else if (m.role === "user" || m.role === "assistant") {
      messages.push({ role: m.role, content });
    }
  }

  let toolChars = 0;
  const tools: { type: "function"; function: { name: string; description: string; parameters: unknown } }[] = [];
  for (const t of (Array.isArray(body.tools) ? body.tools : []).slice(0, LIMITS.maxTools)) {
    if (!isObject(t) || typeof t.name !== "string" || !NAME.test(t.name)) continue;
    const description = clip(t.description, LIMITS.maxDescriptionChars);
    const schema = isObject(t.parameters) ? JSON.stringify(t.parameters) : "";
    const parameters = schema && schema.length <= LIMITS.maxSchemaChars ? t.parameters : EMPTY_SCHEMA;
    const size = t.name.length + description.length + (parameters === EMPTY_SCHEMA ? 30 : schema.length);
    if (toolChars + size > LIMITS.maxToolChars) break;
    toolChars += size;
    tools.push({ type: "function", function: { name: t.name, description, parameters } });
  }

  const payload: Record<string, unknown> = {
    // the model is fixed server-side; a client cannot upgrade itself to a pricier one
    model,
    messages,
    max_tokens: LIMITS.maxOutputTokens,
    temperature: typeof body.temperature === "number" ? Math.max(0, Math.min(1, body.temperature)) : 0.2,
  };
  if (tools.length) {
    payload.tools = tools;
    // Forcing a tool that was dropped above would fail the round upstream.
    const forced = tools.some((t) => t.function.name === body.forceTool);
    payload.tool_choice = forced ? { type: "function", function: { name: body.forceTool } } : "auto";
  }

  if (JSON.stringify(payload).length > LIMITS.maxPayloadChars) {
    return { ok: false, status: 413, error: "conversation too long — start a new chat" };
  }
  return { ok: true, payload };
}

/** The 'YYYY-MM' (UTC) period riffscribe_usage counts in, as riffscribe_period() computes it. */
export function usagePeriod(now = new Date()) {
  return now.toISOString().slice(0, 7);
}
