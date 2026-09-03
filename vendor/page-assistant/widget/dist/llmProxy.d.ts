import type { LLMProvider } from "@page-assistant/core";
/** Carries the HTTP status (or 0 for network/timeout) so the UI can map to a friendly string. */
export declare class ProxyError extends Error {
    status: number;
    constructor(status: number, message: string);
}
/**
 * Client-side LLM provider that proxies each grounding round to the backend, so the
 * API key never reaches the browser. The grounding loop itself runs in the page, which
 * means capabilities (real host functions) execute locally — results are never round-tripped
 * through the model and so cannot be fabricated.
 */
export declare function proxyProvider(serverUrl: string, authToken?: string, getModel?: () => string | undefined, timeoutMs?: number): LLMProvider;
