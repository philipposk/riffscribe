/**
 * The Claude API adapter: one round of the assistant through the Messages API.
 *
 * `toAnthropic` (pure, no client) turns the capped OpenAI-style round from
 * lib/assistantRequest.ts into Messages API parameters, so
 * scripts/verify-llm-adapter.mjs can check it without a key. `callAnthropic`
 * sends it. Sampling parameters, `thinking` and `tool_choice` are never sent:
 * current Claude models reject the first, think adaptively by default, and
 * refuse a forced tool choice, so a forced tool becomes a sentence instead.
 * Thinking blocks are never replayed; history without them is valid.
 */
import Anthropic from "@anthropic-ai/sdk";

import type { ChatMessage, ChatRequest, Effort, LlmResult, LlmToolCall } from "./models";

/** The provider could not answer this round; the caller may try another one. */
export class LlmUnavailable extends Error {
  readonly reason: string;
  constructor(reason: string, message?: string) {
    super(message ?? reason);
    this.name = "LlmUnavailable";
    this.reason = reason;
  }
}

const TIMEOUT_MS = 30_000;
/** Models that take the server-side refusal fallback. */
const SERVER_FALLBACK = new Set(["claude-sonnet-5-5", "claude-opus-5-5"]);

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function parseArgs(raw: unknown): Record<string, unknown> {
  if (isObject(raw)) return raw;
  if (typeof raw !== "string" || !raw) return {};
  try {
    const v = JSON.parse(raw);
    return isObject(v) ? v : {};
  } catch {
    return {};
  }
}

type Block = Anthropic.ContentBlockParam;

/**
 * Convert one capped round to Messages API parameters.
 *
 * - System messages become the top-level system prompt.
 * - An assistant message with tool calls becomes its text (if any) plus
 *   `tool_use` blocks.
 * - Consecutive tool results merge into one user message of `tool_result`
 *   blocks; a result whose call is not in the assistant turn just before it
 *   is dropped, and a call with no result gets an error result, since the
 *   API refuses either mismatch (history clipping can cut a pair in half).
 * - Leading and trailing assistant messages and empty text are dropped.
 * - `forceTool` (from tool_choice) adds "Use the X tool now." to the last
 *   user message, only when X is a declared tool.
 */
export function toAnthropic(req: ChatRequest): {
  system: string;
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
  forceTool: string | null;
} {
  const tools: Anthropic.Tool[] = [];
  for (const t of req.tools ?? []) {
    const f = t?.function;
    if (!f || typeof f.name !== "string" || !f.name) continue;
    const schema = isObject(f.parameters) ? { ...f.parameters } : {};
    tools.push({
      name: f.name,
      description: typeof f.description === "string" ? f.description : "",
      input_schema: { ...schema, type: "object" } as Anthropic.Tool.InputSchema,
    });
  }
  const declared = new Set(tools.map((t) => t.name));
  const wanted = isObject(req.tool_choice) ? req.tool_choice.function?.name : undefined;
  const forceTool = typeof wanted === "string" && declared.has(wanted) ? wanted : null;

  const system: string[] = [];
  const out: { role: "user" | "assistant"; content: Block[] }[] = [];
  const push = (role: "user" | "assistant", blocks: Block[]) => {
    if (!blocks.length) return;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  };

  for (const m of (req.messages ?? []) as ChatMessage[]) {
    if (!isObject(m)) continue;
    const text = typeof m.content === "string" ? m.content : "";
    if (m.role === "system") {
      if (text.trim()) system.push(text);
    } else if (m.role === "user") {
      if (text.trim()) push("user", [{ type: "text", text }]);
    } else if (m.role === "assistant") {
      const blocks: Block[] = text.trim() ? [{ type: "text", text }] : [];
      for (const c of Array.isArray(m.tool_calls) ? m.tool_calls : []) {
        const name = c?.function?.name;
        if (typeof name !== "string" || !name || typeof c.id !== "string" || !c.id) continue;
        blocks.push({ type: "tool_use", id: c.id, name, input: parseArgs(c.function.arguments) });
      }
      push("assistant", blocks);
    } else if (m.role === "tool") {
      if (typeof m.tool_call_id !== "string" || !m.tool_call_id) continue;
      const block: Anthropic.ToolResultBlockParam = { type: "tool_result", tool_use_id: m.tool_call_id };
      if (text) block.content = text;
      push("user", [block]);
    }
  }

  // Pair every tool_use with a tool_result in the very next user message.
  const paired: { role: "user" | "assistant"; content: Block[] }[] = [];
  for (let i = 0; i < out.length; i++) {
    const msg = out[i];
    if (msg.role === "assistant") {
      paired.push(msg);
      continue;
    }
    const prev = paired[paired.length - 1];
    const calls = prev?.role === "assistant" ? prev.content.filter((b) => b.type === "tool_use") : [];
    const ids = new Set(calls.map((b) => (b as Anthropic.ToolUseBlockParam).id));
    const results = msg.content.filter(
      (b) => b.type === "tool_result" && ids.has((b as Anthropic.ToolResultBlockParam).tool_use_id)
    );
    const answered = new Set(results.map((b) => (b as Anthropic.ToolResultBlockParam).tool_use_id));
    const missing: Block[] = [...ids]
      .filter((id) => !answered.has(id))
      .map((id) => ({ type: "tool_result", tool_use_id: id, content: "No result.", is_error: true }));
    const rest = msg.content.filter((b) => b.type !== "tool_result");
    const content = [...results, ...missing, ...rest];
    if (content.length) paired.push({ role: "user", content });
  }
  // An assistant turn with calls and no user turn after it still needs results.
  const tail = paired[paired.length - 1];
  if (tail?.role === "assistant") {
    const ids = tail.content.filter((b) => b.type === "tool_use").map((b) => (b as Anthropic.ToolUseBlockParam).id);
    if (ids.length) {
      paired.push({
        role: "user",
        content: ids.map((id) => ({ type: "tool_result", tool_use_id: id, content: "No result.", is_error: true })),
      });
    }
  }

  // The conversation must start with the user and must not end with the
  // assistant (that would be a prefill, which current models refuse).
  // Dropping a leading assistant turn orphans the results that answered it.
  for (;;) {
    while (paired.length && paired[0].role !== "user") paired.shift();
    if (!paired.length) break;
    paired[0].content = paired[0].content.filter((b) => b.type !== "tool_result");
    if (paired[0].content.length) break;
    paired.shift();
  }
  while (paired.length && paired[paired.length - 1].role === "assistant") paired.pop();
  if (!paired.length) paired.push({ role: "user", content: [{ type: "text", text: "Hello." }] });

  // History with tool blocks needs declared tools; without any, keep it as text.
  if (!tools.length) {
    for (const m of paired) {
      m.content = m.content.map((b): Block => {
        if (b.type === "tool_use") return { type: "text", text: `[used ${b.name}]` };
        if (b.type === "tool_result") return { type: "text", text: `[result: ${typeof b.content === "string" && b.content ? b.content : "none"}]` };
        return b;
      });
    }
  }

  if (forceTool) paired[paired.length - 1].content.push({ type: "text", text: `Use the ${forceTool} tool now.` });

  return { system: system.join("\n\n"), messages: paired, tools, forceTool };
}

/** Text and tool calls out of a response's content blocks. Thinking and other blocks are ignored. */
export function readContent(content: readonly { type: string }[]): { text: string; toolCalls: LlmToolCall[] } {
  let text = "";
  const toolCalls: LlmToolCall[] = [];
  for (const b of content) {
    if (b.type === "text") text += (b as Anthropic.TextBlock).text;
    else if (b.type === "tool_use") {
      const u = b as Anthropic.ToolUseBlock;
      toolCalls.push({ id: u.id, name: u.name, args: parseArgs(u.input) });
    }
  }
  return { text, toolCalls };
}

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  // Reads ANTHROPIC_API_KEY. One retry inside the SDK; after that the caller falls back.
  if (!client) client = new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 1 });
  return client;
}

/** A tool definition the API rejected: another provider may still accept it. */
const SCHEMA_ERROR = /input_schema|json schema|tools\.\d+/i;

/**
 * One round on a Claude model. `model` is the bare API id. Throws
 * LlmUnavailable when another provider should be tried; any other error is
 * final.
 */
export async function callAnthropic(o: {
  model: string;
  effort: Effort;
  maxOutput: number;
  request: ChatRequest;
}): Promise<LlmResult> {
  const { system, messages, tools } = toAnthropic(o.request);
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: o.model,
    max_tokens: o.maxOutput,
    output_config: { effort: o.effort },
    messages,
  };
  if (system) params.system = [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
  if (tools.length) params.tools = tools;

  let content: readonly { type: string }[];
  let stop: string | null;
  let usage: Anthropic.Usage | Anthropic.Beta.BetaUsage;
  try {
    if (SERVER_FALLBACK.has(o.model)) {
      const res = await anthropic().beta.messages.create(
        {
          ...(params as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming),
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        { timeout: TIMEOUT_MS }
      );
      content = res.content;
      stop = res.stop_reason;
      usage = res.usage;
    } else {
      const res = await anthropic().messages.create(params, { timeout: TIMEOUT_MS });
      content = res.content;
      stop = res.stop_reason;
      usage = res.usage;
    }
  } catch (e) {
    // Most specific first: a timeout is a connection error, and every
    // status error below is an APIError.
    if (e instanceof Anthropic.RateLimitError) throw new LlmUnavailable("rate_limited", e.message);
    if (e instanceof Anthropic.BadRequestError && SCHEMA_ERROR.test(e.message)) throw new LlmUnavailable("tool_schema", e.message);
    if (e instanceof Anthropic.APIConnectionError) throw new LlmUnavailable("unreachable", e.message);
    if (e instanceof Anthropic.APIError && typeof e.status === "number" && e.status >= 500) {
      throw new LlmUnavailable(`status_${e.status}`, e.message);
    }
    throw e;
  }
  if (stop === "refusal") throw new LlmUnavailable("refusal");

  const read = readContent(content);
  return {
    ...read,
    usage: {
      input: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
      cached: usage.cache_read_input_tokens ?? 0,
      output: usage.output_tokens ?? 0,
    },
    stop,
  };
}
