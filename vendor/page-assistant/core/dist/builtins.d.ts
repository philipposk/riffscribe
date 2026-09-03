import type { Capability } from "./types.js";
/**
 * Built-in capability: let the assistant remember a fact about the user. Writes go to
 * the configured MemoryStore (persistent in the widget via localStorage), and recall is
 * automatic — relevant facts are injected into the system prompt on every turn.
 */
export declare const rememberFactCapability: Capability<{
    topic: string;
    fact: string;
}, {
    saved: boolean;
    topic: string;
}>;
