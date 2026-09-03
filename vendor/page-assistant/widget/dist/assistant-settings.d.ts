export declare const ASSISTANT_SETTINGS_STORAGE_KEY = "page_assistant_settings";
export declare const ASSISTANT_SETTINGS_CHANGE_EVENT = "page-assistant-settings-change";
export type ThemeMode = "dark" | "light" | "system";
export interface AssistantSettings {
    /** LLM model id passed to the server proxy (e.g. gpt-4o-mini, claude-haiku-4-5-20251001). */
    model: string;
    theme: ThemeMode;
    /** Show chat sidebar by default when panel opens. */
    sidebarOpen: boolean;
    /** Send anonymous usage events to host analytics endpoint. */
    analyticsEnabled: boolean;
}
export declare const DEFAULT_MODELS: readonly [{
    readonly id: "gpt-4o-mini";
    readonly label: "GPT-4o Mini (fast)";
    readonly provider: "openai";
}, {
    readonly id: "gpt-4o";
    readonly label: "GPT-4o (smart)";
    readonly provider: "openai";
}, {
    readonly id: "claude-haiku-4-5-20251001";
    readonly label: "Claude Haiku 4.5 (fast)";
    readonly provider: "anthropic";
}, {
    readonly id: "claude-sonnet-4-20250514";
    readonly label: "Claude Sonnet 4 (smart)";
    readonly provider: "anthropic";
}, {
    readonly id: "anthropic/claude-3.5-haiku";
    readonly label: "Claude 3.5 Haiku (OpenRouter)";
    readonly provider: "openrouter";
}];
export declare function getAssistantSettings(storageKey?: string): AssistantSettings;
export declare function setAssistantSettings(patch: Partial<AssistantSettings>, storageKey?: string): AssistantSettings;
