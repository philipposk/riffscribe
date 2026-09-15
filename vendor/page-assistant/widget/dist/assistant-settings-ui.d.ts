import type { ChatHistoryStore } from "./chatHistory.js";
import type { ChatHistoryControls, ChatHistoryState, DeviceChatSource } from "./chatHistoryMode.js";
import { type WidgetStrings } from "./strings.js";
import { type ModelCatalog } from "./models.js";
export interface AssistantSettingsUIOptions {
    storageKey?: string;
    voiceStorageKey?: string;
    settingsPageUrl?: string;
    title?: string;
    chatStore?: ChatHistoryStore;
    /** Where chats are kept, and the controls to change it. Shown on the Data tab. */
    history?: ChatHistoryControls;
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
    /**
     * `true`  — always show the picker.
     * `false` — never show it (same as `showModel: false`).
     * `"auto"` (default) — ask the server: `GET /v1/models` reports whether the model is
     * fixed server-side and which models it can actually serve.
     */
    modelPicker?: boolean | "auto";
    /** Chrome strings; anything omitted keeps its English default. */
    strings?: Partial<WidgetStrings>;
}
export declare function mountAssistantSettingsPanel(container: HTMLElement, opts?: AssistantSettingsUIOptions): () => void;
/**
 * Should the model picker be rendered at all?
 *
 * A picker that changes nothing is worse than no picker: a host whose server pins its own
 * model (so a visitor cannot upgrade themselves onto a costlier one) was still shown a
 * dropdown that silently did nothing. `modelPicker` decides, and `"auto"` asks the server.
 */
export declare function modelPickerVisible(opts: AssistantSettingsUIOptions, catalog: ModelCatalog | undefined): boolean;
export interface HistoryMoveOffer {
    from: DeviceChatSource;
    text: string;
    button: string;
    /** Flash line after a full move; `{count}` is how many moved. */
    done: string;
}
/**
 * The "move chats" offers the Data tab shows. The user's own device chats are offered as
 * theirs; chats made while signed out are offered only with wording that says so.
 */
export declare function historyMoveOffers(st: ChatHistoryState, s?: WidgetStrings): HistoryMoveOffer[];
export declare function openAssistantSettingsModal(opts?: AssistantSettingsUIOptions): void;
export declare function closeAssistantSettingsModal(): void;
