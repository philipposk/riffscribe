import { type Capability } from "@page-assistant/core";
import { type VoiceOptions } from "./voice.js";
import { openVoiceSettingsModal, mountVoiceSettingsPanel, closeVoiceSettingsModal } from "./settings-ui.js";
import { openAssistantSettingsModal, closeAssistantSettingsModal, mountAssistantSettingsPanel } from "./assistant-settings-ui.js";
export interface PageAssistantConfig {
    serverUrl: string;
    appName?: string;
    persona?: string;
    capabilities: Capability[];
    getPageState?: () => Record<string, unknown>;
    voice?: boolean | VoiceOptions;
    autoScan?: boolean;
    greeting?: string;
    knowledge?: string;
    knowledgeUrl?: string;
    suggestions?: string[];
    autoSpeak?: boolean;
    /** Use extended settings modal (model, theme, chat export). Default true. */
    useExtendedSettings?: boolean;
    onSettings?: () => void;
    settingsPageUrl?: string;
    settingsStorageKey?: string;
    assistantSettingsStorageKey?: string;
    chatHistoryStorageKey?: string;
    useVoiceSettings?: boolean;
    authToken?: string;
    memory?: "persistent" | "session";
    /** Disable chat history sidebar. Default false (enabled). */
    disableChatHistory?: boolean;
    /**
     * Enable image attachments. OFF by default: core has no vision plumbing, so accepting
     * images without a vision-capable backend would be a placebo (the model never sees them).
     * Only set true if your backend can actually process image content parts.
     */
    imagesEnabled?: boolean;
    /** Per-request LLM timeout in ms (default 30000). */
    requestTimeoutMs?: number;
}
export { capability } from "./capability.js";
export type { Capability } from "@page-assistant/core";
export { scanPage, fullScan } from "./scanner.js";
export { LocalMemoryStore } from "./localMemory.js";
export { pageActionCapabilities } from "./pageActions.js";
export { ChatHistoryStore, CHAT_HISTORY_STORAGE_KEY } from "./chatHistory.js";
export { getAssistantSettings, setAssistantSettings, DEFAULT_MODELS, ASSISTANT_SETTINGS_STORAGE_KEY, type AssistantSettings, type ThemeMode, } from "./assistant-settings.js";
export { getVoiceSettings, setVoiceSettings, voiceOptionsFromSettings, ELEVENLABS_VOICES, OPENAI_VOICES, VOICE_SETTINGS_STORAGE_KEY, VOICE_SETTINGS_CHANGE_EVENT, type VoiceSettings, type TtsMode, type TtsProvider, type SttMode, } from "./settings.js";
export { mountVoiceSettingsPanel, openVoiceSettingsModal, closeVoiceSettingsModal, type VoiceSettingsUIOptions, } from "./settings-ui.js";
export { mountAssistantSettingsPanel, openAssistantSettingsModal, closeAssistantSettingsModal, type AssistantSettingsUIOptions, } from "./assistant-settings-ui.js";
export { trackEvent, getLocalAnalytics, exportAnalyticsMarkdown } from "./analytics.js";
export { readFileAttachment, formatAttachmentsForPrompt, type FileAttachment } from "./fileUpload.js";
declare class PageAssistantController {
    private cfg;
    private assistant;
    private ui;
    private voice?;
    private history;
    private chatStore;
    private activeChatId;
    private scanned;
    private listening;
    private ttsEnabled;
    private pending?;
    private map?;
    private settingsKey;
    private assistantSettingsKey;
    private onSettingsChange;
    private onAssistantSettingsChange;
    private lastTurn?;
    private greetedChatId;
    private notedSttFallback;
    private destroyed;
    constructor(cfg: PageAssistantConfig);
    dispose(): void;
    /** Full teardown for SPA/React strict-mode remounts: listeners, timers, voice, DOM. */
    destroy(): void;
    updateConfig(patch: Partial<Pick<PageAssistantConfig, "autoSpeak" | "voice">>): void;
    private newChat;
    /** Show greeting + suggestions once per empty chat (also fires on New chat). */
    private showGreeting;
    private clearPending;
    private deleteChat;
    private archiveChat;
    private switchChat;
    private persistCurrentChat;
    /** History mapped for display: collapse the raw attachment dump back to a "📎 name" line. */
    private displayHistory;
    private exportCurrentChat;
    private analyticsUrl;
    private track;
    private handleToggle;
    private pageContext;
    private handleUser;
    private retryLastTurn;
    /** Map any error to a plain-English message + retry affordance. */
    private showFriendlyError;
    /** Highlight the on-page control a confirm-gated action will operate. Defensive. */
    private showActionPreview;
    /** Resolve a scanner selector for the control an action targets (undefined if none). */
    private resolveActionSelector;
    private handleConfirm;
    private say;
    private toggleMic;
}
export declare const PageAssistant: {
    init(cfg: PageAssistantConfig): PageAssistantController;
    configure(patch: Partial<Pick<PageAssistantConfig, "autoSpeak" | "voice">>): void;
    /** Tear down the widget entirely (listeners, timers, shadow host, injected nodes). */
    destroy(): void;
    openVoiceSettings: typeof openVoiceSettingsModal;
    closeVoiceSettings: typeof closeVoiceSettingsModal;
    mountVoiceSettingsPanel: typeof mountVoiceSettingsPanel;
    openAssistantSettings: typeof openAssistantSettingsModal;
    closeAssistantSettings: typeof closeAssistantSettingsModal;
    mountAssistantSettingsPanel: typeof mountAssistantSettingsPanel;
};
