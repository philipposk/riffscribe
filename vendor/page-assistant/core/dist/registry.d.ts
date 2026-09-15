import type { Capability } from "./types.js";
/**
 * Thrown when capabilities are registered with a schema the assistant cannot use.
 *
 * The whole tool list is sent on every chat turn, so one schema a provider rejects fails
 * every message, not just calls to that capability. Registration is the one place such a
 * mistake can be reported once, with the capability's name, instead of per turn.
 */
export declare class CapabilitySchemaError extends Error {
    readonly problems: string[];
    constructor(problems: string[]);
}
/** Every problem with a set of capabilities, as readable lines. Empty when all are usable. */
export declare function capabilitySchemaProblems(caps: Capability[]): string[];
/**
 * Whether a capability is available right now (see `Capability.enabled`). A flag that
 * throws counts as off: a broken check must not advertise a feature that may not work.
 */
export declare function isCapabilityEnabled(cap: Capability): boolean;
/** Throw a CapabilitySchemaError listing every problem, or return quietly. */
export declare function validateCapabilities(caps: Capability[]): void;
