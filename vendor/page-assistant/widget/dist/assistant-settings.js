// Conversation + appearance preferences (localStorage).
export const ASSISTANT_SETTINGS_STORAGE_KEY = "page_assistant_settings";
export const ASSISTANT_SETTINGS_CHANGE_EVENT = "page-assistant-settings-change";
export const DEFAULT_MODELS = [
    { id: "gpt-4o-mini", label: "GPT-4o Mini (fast)", provider: "openai" },
    { id: "gpt-4o", label: "GPT-4o (smart)", provider: "openai" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (fast)", provider: "anthropic" },
    { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4 (smart)", provider: "anthropic" },
    { id: "anthropic/claude-3.5-haiku", label: "Claude 3.5 Haiku (OpenRouter)", provider: "openrouter" },
];
const DEFAULTS = {
    model: "gpt-4o-mini",
    theme: "dark",
    sidebarOpen: true,
    analyticsEnabled: false,
};
export function getAssistantSettings(storageKey = ASSISTANT_SETTINGS_STORAGE_KEY) {
    if (typeof localStorage === "undefined")
        return { ...DEFAULTS };
    try {
        return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(storageKey) || "{}") };
    }
    catch {
        return { ...DEFAULTS };
    }
}
export function setAssistantSettings(patch, storageKey = ASSISTANT_SETTINGS_STORAGE_KEY) {
    const next = { ...getAssistantSettings(storageKey), ...patch };
    if (typeof localStorage !== "undefined") {
        localStorage.setItem(storageKey, JSON.stringify(next));
        window.dispatchEvent(new CustomEvent(ASSISTANT_SETTINGS_CHANGE_EVENT, { detail: next }));
    }
    return next;
}
