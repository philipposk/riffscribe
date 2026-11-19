/**
 * Which language models Riffscribe may call, what they cost, and what each
 * task is allowed to use.
 *
 * The model is always chosen here, on the server: from the admin's saved
 * settings, checked against this allowlist. Nothing a browser sends and no
 * environment variable can name a model. Kept free of imports so
 * scripts/verify-llm-adapter.mjs can load it directly.
 */

export type Provider = "anthropic" | "openrouter";

export interface ModelInfo {
  label: string;
  provider: Provider;
  /** The id the provider's API expects. */
  id: string;
  /** US dollars per million input tokens (uncached). */
  input: number;
  /** US dollars per million output tokens. */
  output: number;
  /** False when the price above is a placeholder. */
  priceKnown: boolean;
}

export const MODELS = {
  "anthropic/claude-haiku-5-5": {
    label: "Claude Haiku 5.5",
    provider: "anthropic",
    id: "claude-haiku-5-5",
    input: 0.1,
    output: 0.5,
    priceKnown: true,
  },
  "anthropic/claude-sonnet-5-5": {
    label: "Claude Sonnet 5.5",
    provider: "anthropic",
    id: "claude-sonnet-5-5",
    input: 2,
    output: 10,
    priceKnown: true,
  },
  "anthropic/claude-opus-5-5": {
    label: "Claude Opus 5.5",
    provider: "anthropic",
    id: "claude-opus-5-5",
    input: 4,
    output: 20,
    priceKnown: true,
  },
  "openrouter/openai/gpt-oss-20b": {
    label: "gpt-oss-20b (OpenRouter)",
    provider: "openrouter",
    id: "openai/gpt-oss-20b",
    input: 0,
    output: 0,
    priceKnown: false,
  },
} as const satisfies Record<string, ModelInfo>;

export type ModelKey = keyof typeof MODELS;

export const EFFORTS = ["low", "medium", "high"] as const;
export type Effort = (typeof EFFORTS)[number];

export interface TaskSpec {
  label: string;
  default: ModelKey;
  allowed: readonly ModelKey[];
  /** Used when the chosen Claude model is unavailable, or no Anthropic key is set. */
  fallback: ModelKey;
  maxOutput: number;
  effort: Effort;
}

export const TASKS = {
  assistant: {
    label: "Studio assistant",
    default: "anthropic/claude-haiku-5-5",
    allowed: [
      "anthropic/claude-haiku-5-5",
      "anthropic/claude-sonnet-5-5",
      "anthropic/claude-opus-5-5",
      "openrouter/openai/gpt-oss-20b",
    ],
    fallback: "openrouter/openai/gpt-oss-20b",
    maxOutput: 2048,
    effort: "low",
  },
} as const satisfies Record<string, TaskSpec>;

export type TaskId = keyof typeof TASKS;
export const TASK_IDS = Object.keys(TASKS) as TaskId[];

export interface TaskSettings {
  model: ModelKey;
  effort: Effort;
  enabled: boolean;
}
export type LlmSettings = Record<TaskId, TaskSettings>;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function isModelKey(v: unknown): v is ModelKey {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(MODELS, v);
}

export function defaultLlmSettings(): LlmSettings {
  const out = {} as LlmSettings;
  for (const id of TASK_IDS) out[id] = { model: TASKS[id].default, effort: TASKS[id].effort, enabled: true };
  return out;
}

/**
 * Stored or submitted settings, made safe: any model outside the task's
 * allowlist, any unknown effort and any non-boolean `enabled` becomes the
 * default. Unknown tasks and fields are dropped.
 */
export function parseLlmSettings(json: unknown): LlmSettings {
  const out = defaultLlmSettings();
  if (!isObject(json)) return out;
  for (const id of TASK_IDS) {
    const t = json[id];
    if (!isObject(t)) continue;
    const allowed = TASKS[id].allowed as readonly string[];
    if (typeof t.model === "string" && allowed.includes(t.model) && isModelKey(t.model)) out[id].model = t.model;
    if (typeof t.effort === "string" && (EFFORTS as readonly string[]).includes(t.effort)) out[id].effort = t.effort as Effort;
    if (typeof t.enabled === "boolean") out[id].enabled = t.enabled;
  }
  return out;
}

/**
 * Settings an admin submitted, accepted only if parsing changed nothing: a
 * bad model or effort is an error to show, not something to quietly replace.
 */
export function validateLlmSettings(json: unknown): { ok: true; value: LlmSettings } | { ok: false; error: string } {
  if (!isObject(json)) return { ok: false, error: "settings must be an object" };
  const value = parseLlmSettings(json);
  for (const key of Object.keys(json)) {
    if (!(TASK_IDS as string[]).includes(key)) return { ok: false, error: `unknown task: ${key.slice(0, 40)}` };
  }
  for (const id of TASK_IDS) {
    const t = json[id];
    if (!isObject(t)) return { ok: false, error: `${id}: missing` };
    for (const k of Object.keys(t)) {
      if (k !== "model" && k !== "effort" && k !== "enabled") return { ok: false, error: `${id}: unknown field ${k.slice(0, 40)}` };
    }
    if (t.model !== value[id].model) return { ok: false, error: `${id}: model is not allowed` };
    if (t.effort !== value[id].effort) return { ok: false, error: `${id}: effort must be low, medium or high` };
    if (t.enabled !== value[id].enabled) return { ok: false, error: `${id}: enabled must be true or false` };
  }
  return { ok: true, value };
}

/** Cache reads bill at a tenth of the input price on Claude models. */
const CACHE_READ_FACTOR = 0.1;

/** Estimated US dollars for a number of tokens, or null when the model's price is unknown. */
export function estimateCost(model: string, input: number, cached: number, output: number): number | null {
  if (!isModelKey(model)) return null;
  const m: ModelInfo = MODELS[model];
  if (!m.priceKnown) return null;
  const usd = (input * m.input + cached * m.input * CACHE_READ_FACTOR + output * m.output) / 1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/* ------------------------------------------------------------------------ */
/* One round of the assistant, as lib/assistantRequest.ts builds it (already  */
/* capped). Both providers start from this shape.                             */
/* ------------------------------------------------------------------------ */

export interface ChatToolCall {
  id: string;
  type?: "function";
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ChatTool {
  type?: "function";
  function: { name: string; description: string; parameters: unknown };
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ChatTool[];
  tool_choice?: "auto" | { type: "function"; function: { name: string } };
  max_tokens?: number;
}

export interface LlmToolCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface LlmUsage {
  /** Input tokens billed at the full rate (cache writes included). */
  input: number;
  /** Input tokens read from the prompt cache. */
  cached: number;
  output: number;
}

export interface LlmResult {
  text: string;
  toolCalls: LlmToolCall[];
  usage: LlmUsage;
  stop: string | null;
}

/**
 * The models to try for one round, in order. A Claude model needs the
 * Anthropic key; the task's fallback (on OpenRouter) follows it when that key
 * exists. With no Anthropic key the round goes straight to the fallback. An
 * OpenRouter model with no OpenRouter key uses the task's default instead.
 */
export function modelChain(task: TaskId, chosen: ModelKey, keys: { anthropic: boolean; openrouter: boolean }): ModelKey[] {
  const spec: TaskSpec = TASKS[task];
  const usable = (k: ModelKey) => (MODELS[k].provider === "anthropic" ? keys.anthropic : keys.openrouter);
  const chain: ModelKey[] = [];
  const add = (k: ModelKey) => {
    if (usable(k) && !chain.includes(k)) chain.push(k);
  };
  add(chosen);
  if (MODELS[chosen].provider === "anthropic") add(spec.fallback);
  else if (!chain.length) add(spec.default);
  if (!chain.length) add(spec.fallback);
  return chain;
}
