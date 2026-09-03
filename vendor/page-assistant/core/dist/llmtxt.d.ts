import type { Capability } from "./types.js";
export interface LlmTxtMeta {
    appName: string;
    appUrl: string;
    description: string;
    /** URL other agents POST to to drive the assistant, e.g. https://app/.well-known/assistant */
    agentEndpoint: string;
    /** Optional: where agents should POST improvement tickets after using the app. */
    feedbackEndpoint?: string;
}
/**
 * Generate an llm.txt describing the live assistant + every capability an external
 * agent may invoke. This is the machine-readable contract that lets OTHER agents
 * both understand the app and talk to the assistant living on it.
 */
export declare function generateLlmTxt(meta: LlmTxtMeta, caps: Capability[]): string;
/** Same data as a machine-first JSON manifest for /.well-known/llm-actions.json */
export declare function generateActionsJson(meta: LlmTxtMeta, caps: Capability[]): {
    schemaVersion: string;
    app: {
        name: string;
        url: string;
        description: string;
    };
    agentEndpoint: string;
    capabilities: {
        name: string;
        description: string;
        parameters: import("./types.js").JSONSchema;
        confirm: boolean;
    }[];
};
