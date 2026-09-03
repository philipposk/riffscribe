import type { MemoryFact, MemoryStore } from "@page-assistant/core";
/**
 * localStorage-backed memory so the assistant remembers users ACROSS visits (the in-memory
 * store forgets on every page load). Same keyword recall as core's InMemoryStore.
 */
export declare class LocalMemoryStore implements MemoryStore {
    private load;
    private persist;
    remember(fact: MemoryFact): void;
    recall(query: string, limit?: number): MemoryFact[];
}
