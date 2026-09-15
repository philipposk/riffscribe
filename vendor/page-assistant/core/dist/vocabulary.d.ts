import type { PageContext } from "./types.js";
/**
 * What the model must know about THIS user's workspace to understand them: the real
 * values they have created (tags, folders, statuses, project names) and what their own
 * words mean here. Without it, "the Q3 shortlist" or "the review column" cannot be mapped
 * onto a real value and the assistant asks the user to spell it out.
 */
export interface Vocabulary {
    /** Real values by kind, most used first — e.g. `{ Tags: ["Q3 shortlist"], Statuses: ["Open", "Won"] }`. */
    values?: Record<string, string[]>;
    /** The user's words → what they mean here — e.g. `{ shortlist: "a tag", board: "the Projects view" }`. */
    glossary?: Record<string, string>;
}
export interface VocabularyContext {
    page: PageContext;
    caller: "user" | "agent";
}
export type VocabularyLoader = (ctx: VocabularyContext) => Vocabulary | Promise<Vocabulary>;
export interface VocabularySource {
    load: VocabularyLoader;
    /** Reuse a loaded vocabulary this long. Default 60000; 0 loads on every turn. A failed load is never cached. */
    ttlMs?: number;
    /** Answer without the vocabulary if loading takes longer than this. Default 3000. */
    timeoutMs?: number;
    /**
     * Cache key. The cache belongs to one Assistant instance, which in the widget is one
     * user. If one instance serves several workspaces, return the workspace id here, or
     * one workspace's values will be shown to another for up to `ttlMs`.
     */
    key?: (ctx: VocabularyContext) => string;
}
/** A fixed vocabulary, a loader called per turn (cached), or a loader with cache settings. */
export type VocabularyOption = Vocabulary | VocabularyLoader | VocabularySource;
/** The prompt block for a vocabulary, or "" when it has nothing to say. Bounded in size. */
export declare function renderVocabulary(vocabulary: Vocabulary | null | undefined): string;
/**
 * Turns a VocabularyOption into the prompt block for one turn. Best-effort by design: a
 * loader that throws or is slow yields "" (the chat answers without it) and is not
 * cached, so it is tried again next turn.
 */
export declare class VocabularyResolver {
    private option;
    private now;
    private cache;
    constructor(option: VocabularyOption, now?: () => number);
    resolve(ctx: VocabularyContext): Promise<string>;
    private load;
}
