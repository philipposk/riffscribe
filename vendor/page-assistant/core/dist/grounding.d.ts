import type { Capability, ChatRequest, ChatResponse, JSONSchema, LLMProvider, MemoryStore, PageContext, ToolInvocation } from "./types.js";
import { type ScrubRule } from "./scrub.js";
import { type VocabularyOption } from "./vocabulary.js";
export interface AssistantOptions {
    capabilities: Capability[];
    llm: LLMProvider;
    memory: MemoryStore;
    /** Extra lines appended to the system prompt (host persona / app description). */
    persona?: string;
    /** App name used in the system prompt. */
    appName?: string;
    /**
     * The assistant's own name, if it has one ("Ada"). The model introduces itself by it and
     * answers "who are you" with it; `appName` stays the product. One line, 60 chars max.
     */
    assistantName?: string;
    /**
     * Free-text knowledge about the app — README, docs, "what this is for". Injected into the
     * system prompt so the assistant understands the product, not just its buttons.
     */
    knowledge?: string;
    /** Suggested things the user can ask. The assistant offers these proactively. */
    suggestions?: string[];
    /**
     * Forced routing: before the model's first round, a keyword heuristic may force one
     * capability for an unambiguous factual question. `false` turns it off; a function
     * replaces it (return a capability name, or undefined to let the model choose). A name
     * that is not a registered, enabled capability is ignored.
     */
    forcedRouting?: false | ForcedRouter;
    /**
     * Rewrites applied to every user-facing message (model prose, render() output, and the
     * error text of a failed run()) and to error text sent back to the model. Defaults to
     * DEFAULT_SCRUB_RULES: credentials, connection strings, environment variable names.
     * Extend it with your own internal terms — `[...DEFAULT_SCRUB_RULES, ["InternalDB",
     * "our records"]]` — or pass `false` to turn it off.
     */
    scrub?: ScrubRule[] | false;
    /**
     * The real values in the user's workspace (tags, statuses, projects) and what their
     * words mean here, so loose wording maps onto real values. A fixed Vocabulary, a loader
     * (cached 60 s), or `{ load, ttlMs, timeoutMs, key }`. Best-effort: a loader that throws
     * or is slow is skipped for that turn and never breaks the chat.
     */
    vocabulary?: VocabularyOption;
}
/** Picks a capability to force on the first round, or undefined to leave it to the model. */
export type ForcedRouter = (message: string, capabilities: Capability[]) => string | undefined;
/**
 * The grounded assistant. Safety model:
 *  1. The model may ONLY call registered capabilities (no free-form actions).
 *  2. Factual answers come from each capability's render(), not model prose.
 *  3. A validator strips/replaces model text that asserts numbers the tools
 *     never returned, so the assistant cannot hallucinate results.
 */
export declare class Assistant {
    private opts;
    private caps;
    private vocabulary?;
    constructor(opts: AssistantOptions);
    get capabilities(): Capability[];
    /** Fold in extra knowledge discovered at runtime (e.g. fetched README / llm.txt). */
    setKnowledge(text: string): void;
    private systemPrompt;
    /** Last step before text reaches the user (or goes back to the model as an error). */
    private say;
    /** Capabilities switched on right now — the only ones the model is told about. */
    private available;
    private route;
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
/** Drop keys the schema didn't declare — the same hardening as additionalProperties:false. */
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
 *
 * Never picks a confirm-gated capability: forcing exists to answer factual questions from
 * real data, and a question that happens to share words with a write ("how many orders
 * would archiving touch?") must not come back as a confirmation card for that write.
 */
export declare function forcedFactualTool(message: string, caps: Capability[]): string | undefined;
/**
 * Factual text validator. If the model's prose contains numbers that do NOT appear
 * anywhere in the trusted rendered tool output, we don't trust the prose — we fall
 * back to concatenating the trusted renders. This is the "validator replaces LLM text
 * when it invents a count" guarantee.
 */
export declare function validateFactualText(text: string, invocations: ToolInvocation[]): {
    text: string;
    wasCorrected: boolean;
};
