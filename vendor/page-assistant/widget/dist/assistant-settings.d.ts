export declare const ASSISTANT_SETTINGS_STORAGE_KEY = "page_assistant_settings";
export declare const ASSISTANT_SETTINGS_CHANGE_EVENT = "page-assistant-settings-change";
export type ThemeMode = "dark" | "light" | "system";
export interface AssistantSettings {
    /**
     * LLM model id passed to the server proxy, or "" to send no override at all and let the
     * server use whatever it is configured with. "" is the default: the widget has no way to
     * know which provider keys a server holds, and naming a model it cannot serve is a hard
     * error at send time.
     */
    model: string;
    theme: ThemeMode;
    /** Show chat sidebar by default when panel opens. */
    sidebarOpen: boolean;
    /** Send anonymous usage events to host analytics endpoint. */
    analyticsEnabled: boolean;
}
/**
 * Models offered in the picker, newest and most capable first.
 *
 * Model ids are exact and carry NO date suffix — `claude-haiku-4-5`, not
 * `claude-haiku-4-5-20251001`. The previous list had drifted: Claude Sonnet 4 and Claude
 * 3.5 Haiku are superseded, and the whole Claude 5 family was missing.
 *
 * A server only serves a model it has the matching key for, so this list is a fallback:
 * `GET /v1/models` reports what the server can actually do and the picker prefers that.
 */
export declare const DEFAULT_MODELS: readonly [{
    readonly id: "claude-opus-5";
    readonly label: "Claude Opus 5 (most capable)";
    readonly provider: "anthropic";
}, {
    readonly id: "claude-sonnet-5";
    readonly label: "Claude Sonnet 5 (balanced)";
    readonly provider: "anthropic";
}, {
    readonly id: "claude-haiku-4-5";
    readonly label: "Claude Haiku 4.5 (fast)";
    readonly provider: "anthropic";
}, {
    readonly id: "claude-fable-5-1";
    readonly label: "Claude Fable 5.1 (deep reasoning)";
    readonly provider: "anthropic";
}, {
    readonly id: "gpt-4o-mini";
    readonly label: "GPT-4o Mini (fast)";
    readonly provider: "openai";
}, {
    readonly id: "gpt-4o";
    readonly label: "GPT-4o";
    readonly provider: "openai";
}, {
    readonly id: "anthropic/claude-sonnet-5";
    readonly label: "Claude Sonnet 5 (OpenRouter)";
    readonly provider: "openrouter";
}];
export declare function getAssistantSettings(storageKey?: string): AssistantSettings;
export declare function setAssistantSettings(patch: Partial<AssistantSettings>, storageKey?: string): AssistantSettings;
