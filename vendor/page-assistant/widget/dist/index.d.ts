import { type Capability, type ForcedRouter, type ScrubRule, type VocabularyOption } from "@page-assistant/core";
import { type VoiceOptions } from "./voice.js";
import { type VoiceSettings } from "./settings.js";
import { openVoiceSettingsModal, mountVoiceSettingsPanel, closeVoiceSettingsModal } from "./settings-ui.js";
import { openAssistantSettingsModal, closeAssistantSettingsModal, mountAssistantSettingsPanel } from "./assistant-settings-ui.js";
import { type ChatHistoryMode } from "./chatHistoryMode.js";
import type { ChatHistoryAdapter } from "./chatHistoryAccount.js";
import { type WidgetStrings } from "./strings.js";
export interface PageAssistantConfig {
    serverUrl: string;
    appName?: string;
    /**
     * The mark on the launcher button. One of the names in LAUNCHER_ICONS —
     * "chat" (default), "sparkle", "mic", "book", "help", "phone" — or your own
     * SVG string, or a single character such as an emoji.
     *
     * It used to be a telephone with no way to change it, which reads as "call
     * support" rather than "ask something and get an answer now".
     */
    launcherIcon?: string;
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
    /**
     * Whether the user may choose the LLM model in the settings panel.
     *
     * `"auto"` (the default) asks the server: `GET /v1/models` reports whether the model is
     * fixed server-side and which models it actually holds keys for, and the picker is
     * hidden unless there is a real choice to make.
     *
     * `false` hides it outright — use it when your own server pins the model and ignores
     * what the client asks (so a visitor cannot upgrade themselves onto a costlier one).
     * A dropdown that silently changes nothing is worse than none.
     *
     * `true` always shows it. Was `boolean` before 0.5.1; `true`/`false` mean what they did.
     */
    showModelPicker?: boolean | "auto";
    /** What to say instead, when the picker is hidden. */
    modelFixedNote?: string;
    onSettings?: () => void;
    settingsPageUrl?: string;
    settingsStorageKey?: string;
    assistantSettingsStorageKey?: string;
    chatHistoryStorageKey?: string;
    useVoiceSettings?: boolean;
    authToken?: string;
    memory?: "persistent" | "session";
    /**
     * Turn chat history off entirely: no sidebar, nothing saved, and no choice in settings.
     * Wins over `chatHistoryMode`. Default false.
     */
    disableChatHistory?: boolean;
    /**
     * Where chats are kept until the user picks otherwise in settings (their pick is
     * remembered in this browser, per signed-in user):
     * - `"device"` (default): this browser only — what every earlier version did;
     * - `"account"`: the user's account, through `chatHistoryAdapter`, so chats follow them
     *   to other devices;
     * - `"off"`: this page only; nothing is saved.
     */
    chatHistoryMode?: ChatHistoryMode;
    /**
     * Your backend for "account" mode: list, get, save, delete and delete-all for the signed-in
     * user. The widget never talks to a database itself. `supabaseChatHistoryAdapter()` is a
     * reference implementation.
     */
    chatHistoryAdapter?: ChatHistoryAdapter;
    /**
     * Used while "account" is chosen but can't be used — no adapter, or nobody signed in.
     * Default "device". Settings says why.
     */
    chatHistoryFallbackMode?: "device" | "off";
    /**
     * Offer a signed-in user the chats made in this browser while nobody was signed in, so
     * they can move them into their account or their own device chats. Default true.
     *
     * Set `false` for apps used on shared computers (a kiosk, a front desk, a family laptop):
     * whoever used the browser signed out may not be the person signed in now, so those chats
     * are never offered, counted or moved. They stay where they are, for the next signed-out
     * visitor. Only matters with an adapter that has `currentUserId()`.
     */
    offerSignedOutChats?: boolean;
    /** Failed account loads and saves, for your logs. The user sees a short note in settings. */
    onChatHistoryError?: (error: unknown) => void;
    /**
     * Enable image attachments. OFF by default: core has no vision plumbing, so accepting
     * images without a vision-capable backend would be a placebo (the model never sees them).
     * Only set true if your backend can actually process image content parts.
     */
    imagesEnabled?: boolean;
    /** Per-request LLM timeout in ms (default 30000). */
    requestTimeoutMs?: number;
    /**
     * BCP-47 language for speech recognition and speech synthesis, e.g. "el-GR".
     *
     * Resolved on every mic tap and every spoken reply, in this order:
     *   1. this option — ALWAYS wins when set;
     *   2. `document.documentElement.lang`;
     *   3. `navigator.language`;
     *   4. "en-US".
     *
     * Set it explicitly if you know the language. `<html lang>` is only a last resort: a
     * host can render a fully translated UI while its root element still says "en", and a
     * recogniser told the wrong language returns nothing at all.
     *
     * Also passed to the server for Whisper STT and ElevenLabs TTS, and set on the widget's
     * host element so assistive tech pronounces the chrome correctly.
     */
    lang?: string;
    /**
     * Override any of the widget's chrome strings (placeholder, buttons, aria-labels,
     * toasts, voice errors). Anything omitted keeps its English default — see
     * `DEFAULT_STRINGS` for the full key set.
     */
    strings?: Partial<WidgetStrings>;
    /**
     * This app's starting voice preferences, e.g. `{ sttMode: "server" }`.
     *
     * Layered `shipped defaults < voiceDefaults < the user's stored settings`, so a host can
     * say "start with server transcription here" while a user who picks something else in
     * the settings panel still wins. Unlike passing a full `VoiceOptions` object to `voice`,
     * this keeps the settings UI and its change listener working.
     */
    voiceDefaults?: Partial<VoiceSettings>;
    /**
     * The assistant's own name ("Ada"). It introduces itself by it, answers "who are you"
     * with it, and it replaces `appName` as the panel title. `appName` stays the product.
     */
    assistantName?: string;
    /**
     * The real values in the user's workspace (tags, statuses, projects) and what their
     * words mean here. Fixed, or `{ load, ttlMs, timeoutMs }`; see `AssistantOptions.vocabulary`.
     */
    vocabulary?: VocabularyOption;
    /**
     * Rewrites applied to every reply. Default: `DEFAULT_SCRUB_RULES` plus
     * `PLAIN_TEXT_SCRUB_RULES` — replies render as plain text here, so markdown `**` would
     * show literally. A list replaces the default (spread both in to extend it); `false`
     * turns scrubbing off.
     */
    scrub?: ScrubRule[] | false;
    /** `false` turns keyword-forced routing off; a function replaces it. */
    forcedRouting?: false | ForcedRouter;
}
export { capability } from "./capability.js";
export type { Capability, ScrubRule, Vocabulary, VocabularyOption } from "@page-assistant/core";
export { DEFAULT_SCRUB_RULES, PLAIN_TEXT_SCRUB_RULES } from "@page-assistant/core";
export { scanPage, fullScan } from "./scanner.js";
export { LocalMemoryStore } from "./localMemory.js";
export { pageActionCapabilities } from "./pageActions.js";
export { ChatHistoryStore, CHAT_HISTORY_STORAGE_KEY, CHAT_HISTORY_CHANGE_EVENT, type ChatSession, type ChatGroup, type ChatStoreChange, } from "./chatHistory.js";
export { ChatHistoryManager, resolveChatHistoryMode, getStoredChatHistoryMode, setStoredChatHistoryMode, deviceStorageKey, CHAT_HISTORY_MODES, CHAT_HISTORY_MODE_STORAGE_KEY, type ChatHistoryMode, type DeviceChatSource, type ChatHistoryState, type ChatHistoryControls, type AccountUnavailableReason, } from "./chatHistoryMode.js";
export { AccountHistorySync, toAccountChat, fromAccountChat, type AccountChat, type AccountChatSummary, type ChatHistoryAdapter, } from "./chatHistoryAccount.js";
export { supabaseChatHistoryAdapter, type SupabaseChatHistoryOptions, type SupabaseClientLike, } from "./adapters/supabase.js";
export { getAssistantSettings, setAssistantSettings, DEFAULT_MODELS, ASSISTANT_SETTINGS_STORAGE_KEY, type AssistantSettings, type ThemeMode, } from "./assistant-settings.js";
export { getVoiceSettings, setVoiceSettings, voiceOptionsFromSettings, ELEVENLABS_VOICES, OPENAI_VOICES, VOICE_SETTINGS_STORAGE_KEY, VOICE_SETTINGS_CHANGE_EVENT, type VoiceSettings, type TtsMode, type TtsProvider, type SttMode, } from "./settings.js";
export { mountVoiceSettingsPanel, openVoiceSettingsModal, closeVoiceSettingsModal, type VoiceSettingsUIOptions, } from "./settings-ui.js";
export { mountAssistantSettingsPanel, openAssistantSettingsModal, closeAssistantSettingsModal, historyMoveOffers, type AssistantSettingsUIOptions, type HistoryMoveOffer, } from "./assistant-settings-ui.js";
export { trackEvent, getLocalAnalytics, exportAnalyticsMarkdown } from "./analytics.js";
export { readFileAttachment, formatAttachmentsForPrompt, type FileAttachment } from "./fileUpload.js";
export { DEFAULT_STRINGS, resolveStrings, type WidgetStrings } from "./strings.js";
export { setVoiceDefaults, getVoiceDefaults } from "./settings.js";
export { fetchModelCatalog, type ModelCatalog, type ModelChoice } from "./models.js";
export { resolveVoiceLang, voiceInputAvailable } from "./voice.js";
declare class PageAssistantController {
    private cfg;
    private assistant;
    private ui;
    private voice?;
    private history;
    private chatStore;
    private historyMgr;
    private activeChatId;
    /**
     * Goes up whenever the conversation on screen is replaced by another one: a chat opened,
     * a new chat, or the store swapped under it. With the manager's `userGeneration` it tells a
     * reply that was still loading whether it may land (see `turn()`).
     */
    private chatGen;
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
    private notedBrowserFallback;
    private destroyed;
    /** English defaults merged with whatever the host translated. */
    private strings;
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
    /** Re-check who is signed in. Call it after your app signs a user in or out. */
    refreshChatHistory(): Promise<void>;
    /** An account chat listed without its messages is fetched first. False if it can't be. */
    private loadChat;
    private forkChat;
    /**
     * The store's contents were swapped. Keep the open conversation if the new contents still
     * have it (carried into "off", or moved into the account); otherwise open what the new
     * mode has, or a fresh chat.
     */
    private reanchorChat;
    private switchChat;
    /**
     * Where a reply now being requested belongs: this chat, for the person signed in now.
     * Taken before the request; `stillCurrent()` checks it when the reply comes back.
     */
    private turn;
    /**
     * False once the user left the chat the reply was for — opened another, started a new one —
     * or once someone signed out or another account signed in. Such a reply must not be pushed,
     * saved or shown: it would land in another conversation or in the next person's chats.
     */
    private stillCurrent;
    /** A reply (or its error) that is no longer wanted: nothing saved, nothing rendered. */
    private discardReply;
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
    /**
     * Re-check who is signed in and apply the chat-history mode that follows. Call it after
     * your app signs a user in or out; signing out drops account chats from the page.
     */
    refreshChatHistory(): Promise<void>;
    /** Tear down the widget entirely (listeners, timers, shadow host, injected nodes). */
    destroy(): void;
    openVoiceSettings: typeof openVoiceSettingsModal;
    closeVoiceSettings: typeof closeVoiceSettingsModal;
    mountVoiceSettingsPanel: typeof mountVoiceSettingsPanel;
    openAssistantSettings: typeof openAssistantSettingsModal;
    closeAssistantSettings: typeof closeAssistantSettingsModal;
    mountAssistantSettingsPanel: typeof mountAssistantSettingsPanel;
};
