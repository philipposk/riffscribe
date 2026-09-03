import type { Capability, ChatRequest, ChatResponse, JSONSchema, LLMProvider, MemoryStore, PageContext, ToolInvocation } from "./types.js";
export interface AssistantOptions {
    capabilities: Capability[];
    llm: LLMProvider;
    memory: MemoryStore;
    /** Extra lines appended to the system prompt (host persona / app description). */
    persona?: string;
    /** App name used in the system prompt. */
    appName?: string;
    /**
     * Free-text knowledge about the app — README, docs, "what this is for". Injected into the
     * system prompt so the assistant understands the product, not just its buttons.
     */
    knowledge?: string;
    /** Suggested things the user can ask. The assistant offers these proactively. */
    suggestions?: string[];
}
/**
 * The grounded assistant. Mirrors the strive page-assistant safety model:
 *  1. The model may ONLY call registered capabilities (no free-form actions).
 *  2. Factual answers come from each capability's render(), not model prose.
 *  3. A validator strips/replaces model text that asserts numbers the tools
 *     never returned, so the assistant cannot hallucinate results.
 */
export declare class Assistant {
    private opts;
    private caps;
    constructor(opts: AssistantOptions);
    get capabilities(): Capability[];
    /** Fold in extra knowledge discovered at runtime (e.g. fetched README / llm.txt). */
    setKnowledge(text: string): void;
    private systemPrompt;
    private toolSpecs;
    chat(req: ChatRequest): Promise<ChatResponse>;
    /** Execute a confirmed capability (called after user approves a pendingConfirmation). */
    confirmAndRun(name: string, args: Record<string, unknown>, page: PageContext): Promise<ChatResponse>;
    private execute;
}
/**
 * Coerce numeric strings to numbers for number/integer-typed params BEFORE run(). Models
 * often stringify numbers ("5"); validateArgs already ACCEPTS a numeric string, but without
 * this the host function would receive "5" (a string) and e.g. "5" * 2 or comparisons break.
 * Only touches params the schema types as number/integer and whose value is a clean numeric
 * string; everything else passes through untouched.
 */
export declare function coerceArgTypes(args: Record<string, unknown>, schema: JSONSchema): Record<string, unknown>;
/** Drop keys the schema didn't declare — mirrors strive's additionalProperties:false hardening. */
export declare function stripUnknownKeys(args: Record<string, unknown>, schema: {
    properties?: Record<string, unknown>;
}): Record<string, unknown>;
/**
 * Check a model's tool args against the schema's `required` fields and declared types
 * BEFORE run() is called. Returns an actionable message (fed back to the model so it can
 * retry) or null when the args are acceptable. Without this a call missing a required arg
 * passes undefined into the host function and surfaces as a raw exception.
 */
export declare function validateArgs(args: Record<string, unknown>, schema: JSONSchema): string | null;
/**
 * Forced-factual tool selection. For unambiguous "give me a number / do X now"
 * intents we force the matching capability so the model can't answer from memory.
 * Heuristic and conservative: only fires on a confident keyword + a single
 * obviously-matching capability.
 */
export declare function forcedFactualTool(message: string, caps: Capability[]): string | undefined;
/**
 * Factual text validator. If the model's prose contains numbers that do NOT appear
 * anywhere in the trusted rendered tool output, we don't trust the prose — we fall
 * back to concatenating the trusted renders. This is the "validator replaces LLM text
 * when it invents a count" guarantee from strive, generalized.
 */
export declare function validateFactualText(text: string, invocations: ToolInvocation[]): {
    text: string;
    wasCorrected: boolean;
};
