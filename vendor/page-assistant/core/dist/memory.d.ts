import type { MemoryFact, MemoryStore } from "./types.js";
export declare class InMemoryStore implements MemoryStore {
    private maxFacts;
    private facts;
    private seq;
    constructor(maxFacts?: number);
    remember(fact: MemoryFact): void;
    recall(query: string, limit?: number): MemoryFact[];
}
