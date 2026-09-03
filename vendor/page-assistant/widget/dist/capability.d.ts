import type { Capability } from "@page-assistant/core";
/** Identity helper that gives hosts type-checking + inference when declaring a capability. */
export declare function capability<A, R>(c: Capability<A, R>): Capability<A, R>;
