/**
 * The OpenRouter adapter, used as the fallback (and for the open model on the
 * allowlist). The request is the capped round from lib/assistantRequest.ts as
 * it always was, with only the fields below passed on: the model is set here,
 * no sampling settings are sent, and OpenRouter is told not to route to
 * providers that keep prompts for training.
 */
import type { ChatRequest, LlmResult, LlmToolCall } from "./models";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MS = 30_000;

/** OpenRouter failed or gave no usable answer. `status` is the upstream HTTP status, 0 when unreachable. */
export class OpenRouterError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "OpenRouterError";
    this.status = status;
  }
}

/** The request body sent upstream. Exported for scripts/verify-llm-adapter.mjs. */
export function openRouterBody(model: string, req: ChatRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: req.messages,
    provider: { data_collection: "deny" },
  };
  if (typeof req.max_tokens === "number") body.max_tokens = req.max_tokens;
  if (req.tools?.length) {
    body.tools = req.tools;
    body.tool_choice = req.tool_choice ?? "auto";
  }
  return body;
}

export async function callOpenRouter(o: { key: string; model: string; request: ChatRequest }): Promise<LlmResult> {
  let upstream: Response;
  try {
    upstream = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${o.key}`,
        "content-type": "application/json",
        "http-referer": "https://riffscribe.6x7.gr",
        "x-title": "Riffscribe",
      },
      body: JSON.stringify(openRouterBody(o.model, o.request)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new OpenRouterError(0, "assistant backend unreachable");
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    throw new OpenRouterError(upstream.status, `assistant backend ${upstream.status}: ${detail.slice(0, 400)}`);
  }

  const json = await upstream.json().catch(() => null);
  if (!json) throw new OpenRouterError(502, "assistant backend sent no answer");
  const choice = json?.choices?.[0]?.message;
  const toolCalls: LlmToolCall[] = (choice?.tool_calls ?? []).map(
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

  const prompt = Number(json?.usage?.prompt_tokens) || 0;
  const cached = Number(json?.usage?.prompt_tokens_details?.cached_tokens) || 0;
  return {
    toolCalls,
    text: typeof choice?.content === "string" ? choice.content : "",
    usage: {
      input: Math.max(0, prompt - cached),
      cached,
      output: Number(json?.usage?.completion_tokens) || 0,
    },
    stop: typeof json?.choices?.[0]?.finish_reason === "string" ? json.choices[0].finish_reason : null,
  };
}
