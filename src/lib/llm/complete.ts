/**
 * One model round for a task: the admin's chosen model (checked against the
 * allowlist), then the task's fallback when Claude is unavailable, then a
 * usage count in riffscribe_llm_usage. Callers never name a model.
 */
import "server-only";

import { after } from "next/server";

import { serviceClient } from "@/lib/supabase/server";
import { callAnthropic, LlmUnavailable } from "./anthropic";
import { callOpenRouter } from "./openrouter";
import { getLlmSettings } from "./settings";
import { MODELS, TASKS, modelChain, type ChatRequest, type LlmResult, type ModelKey, type TaskId } from "./models";

export type Completion =
  | ({ ok: true; provider: ModelKey; fallback: boolean } & Omit<LlmResult, "stop">)
  | { ok: false; status: 502 | 503; error: string };

/** Is any provider key set on this deployment? */
export function llmConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY);
}

/** Count one answered round. Runs after the response is sent; failures are ignored. */
function logUsage(task: TaskId, model: ModelKey, r: LlmResult, fallback: boolean) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) return;
  const write = async () => {
    try {
      await serviceClient().rpc("riffscribe_log_llm", {
        p_task: task,
        p_model: model,
        p_in: r.usage.input,
        p_cached: r.usage.cached,
        p_out: r.usage.output,
        p_fallback: fallback,
      });
    } catch {
      /* usage counts are for the admin page; never an error for the player */
    }
  };
  try {
    after(write);
  } catch {
    void write();
  }
}

export async function complete(task: TaskId, request: ChatRequest): Promise<Completion> {
  const settings = (await getLlmSettings())[task];
  if (!settings.enabled) return { ok: false, status: 503, error: "the assistant is switched off for now" };

  const spec = TASKS[task];
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const chain = modelChain(task, settings.model, { anthropic: Boolean(anthropicKey), openrouter: Boolean(openrouterKey) });
  if (!chain.length) return { ok: false, status: 503, error: "assistant is not configured on this deployment" };

  for (let i = 0; i < chain.length; i++) {
    const key = chain[i];
    const model = MODELS[key];
    try {
      const result =
        model.provider === "anthropic"
          ? await callAnthropic({ model: model.id, effort: settings.effort, maxOutput: spec.maxOutput, request })
          : await callOpenRouter({ key: openrouterKey!, model: model.id, request });
      logUsage(task, key, result, i > 0);
      return { ok: true, text: result.text, toolCalls: result.toolCalls, usage: result.usage, provider: key, fallback: i > 0 };
    } catch (e) {
      if (e instanceof LlmUnavailable && i < chain.length - 1) {
        console.warn(`[llm] ${key} unavailable (${e.reason}); trying ${chain[i + 1]}`);
        continue;
      }
      console.error(`[llm] ${key} failed: ${e instanceof Error ? `${e.name}: ${e.message.slice(0, 200)}` : "unknown error"}`);
      return { ok: false, status: 502, error: "assistant backend unavailable" };
    }
  }
  return { ok: false, status: 502, error: "assistant backend unavailable" };
}
