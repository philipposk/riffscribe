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
}
export declare function mountAssistantSettingsPanel(container: HTMLElement, opts?: AssistantSettingsUIOptions): () => void;
export declare function openAssistantSettingsModal(opts?: AssistantSettingsUIOptions): void;
export declare function closeAssistantSettingsModal(): void;
