import type { ChatHistoryStore } from "./chatHistory.js";
export interface AssistantSettingsUIOptions {
    storageKey?: string;
    voiceStorageKey?: string;
    settingsPageUrl?: string;
    title?: string;
    chatStore?: ChatHistoryStore;
    serverUrl?: string;
    /** Bearer token forwarded to the capabilities probe if the deployment guards it. */
    authToken?: string;
    /**
     * Hide the model picker.
     *
     * Some deployments fix the model on the server — an unauthenticated proxy has
     * to, or a visitor could upgrade themselves to a costlier one. On those, a
     * dropdown that silently does nothing is worse than no dropdown, so say what
     * is actually happening instead.
     */
    showModel?: boolean;
    /** What to say in place of the picker when `showModel` is false. */
    modelFixedNote?: string;
}
export declare function mountAssistantSettingsPanel(container: HTMLElement, opts?: AssistantSettingsUIOptions): () => void;
export declare function openAssistantSettingsModal(opts?: AssistantSettingsUIOptions): void;
export declare function closeAssistantSettingsModal(): void;
