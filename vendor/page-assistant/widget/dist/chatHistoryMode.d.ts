import { ChatHistoryStore } from "./chatHistory.js";
import { type ChatHistoryAdapter } from "./chatHistoryAccount.js";
/**
 * - `account`: saved to the user's account through the host's adapter; follows them across devices.
 * - `device`: saved in this browser only (localStorage). What every earlier version did.
 * - `off`: kept in memory for this page only; nothing is saved.
 */
export type ChatHistoryMode = "account" | "device" | "off";
export declare const CHAT_HISTORY_MODES: readonly ChatHistoryMode[];
export declare const CHAT_HISTORY_MODE_STORAGE_KEY = "page_assistant_history_mode";
/** Why "account" cannot be used right now. */
export type AccountUnavailableReason = "no-adapter" | "signed-out";
export declare function isChatHistoryMode(v: unknown): v is ChatHistoryMode;
/**
 * Which device chats to move: `"mine"` — the signed-in user's own; `"signed-out"` — chats
 * made on this device while nobody was signed in (anyone using the browser may have made them).
 */
export type DeviceChatSource = "mine" | "signed-out";
/**
 * Where this browser keeps a person's "device" chats. A known user gets their own key; nobody
 * signed in (null), or a user the adapter can't name (""), uses `storageKey` itself — the
 * signed-out slot, which is also where every earlier version kept chats.
 */
export declare function deviceStorageKey(storageKey: string, userId: string | null | undefined): string;
export interface ResolveChatHistoryModeInput {
    /** What the user chose, or the host default when they have not. */
    chosen: ChatHistoryMode;
    /** `disableChatHistory`: always "off". */
    locked?: boolean;
    hasAdapter: boolean;
    /** `undefined` while not known yet; treated as signed in until told otherwise. */
    signedIn?: boolean;
    /** Used instead of "account" when account is not possible. Default "device". */
    fallback?: "device" | "off";
}
/** The mode actually in effect, and why "account" is unavailable if it is. */
export declare function resolveChatHistoryMode(i: ResolveChatHistoryModeInput): {
    mode: ChatHistoryMode;
    unavailable?: AccountUnavailableReason;
};
/** The mode this user picked in this browser, if they picked one. `null` = signed out. */
export declare function getStoredChatHistoryMode(userId: string | null, key?: string): ChatHistoryMode | undefined;
export declare function setStoredChatHistoryMode(mode: ChatHistoryMode, userId: string | null, key?: string): void;
export interface ChatHistoryState {
    /** In effect now. */
    mode: ChatHistoryMode;
    /** What the user chose, or the host default. Differs from `mode` while account is unavailable. */
    chosen: ChatHistoryMode;
    /** The host turned history off (`disableChatHistory`); there is nothing to choose. */
    locked: boolean;
    accountUnavailable?: AccountUnavailableReason;
    status: "idle" | "loading" | "saving" | "error";
    /** What failed, while `status` is "error". */
    error?: "load" | "save";
    /**
     * The current user's own chats with messages saved in this browser. 0 while the widget
     * can't tell who that is (an adapter without `currentUserId`, or not checked yet).
     */
    deviceChatCount: number;
    /**
     * Chats made in this browser while signed out, when the current view doesn't show them:
     * a signed-in user may choose to move them, told plainly whose they may be.
     */
    signedOutDeviceChatCount: number;
    /** An adapter exists and someone is signed in, so their saved chats can be deleted. */
    canDeleteAccountChats: boolean;
    retentionMonths?: number;
}
/** What the settings panel drives. */
export interface ChatHistoryControls {
    getState(): ChatHistoryState;
    subscribe(listener: () => void): () => void;
    /** Re-check who is signed in and apply the mode that follows. */
    refresh(): Promise<void>;
    /** Choose a mode. `moveDeviceChats` also moves the user's own device chats into the account. */
    setMode(mode: ChatHistoryMode, opts?: {
        moveDeviceChats?: boolean;
    }): Promise<void>;
    /**
     * Move device chats, then remove them from where they were. In account mode, into the
     * account: `from: "mine"` (default) the user's own, `"signed-out"` the signed-out slot.
     * In device mode, `"signed-out"` moves the signed-out slot into the user's own. A move
     * counts as activity: each moved chat's `updatedAt` becomes now, so account retention
     * starts from the move rather than deleting old chats straight after they arrive.
     */
    moveDeviceChats(opts?: {
        from?: DeviceChatSource;
    }): Promise<{
        moved: number;
        failed: number;
    }>;
    /** Delete every chat: in this browser, in memory, and in the account when one is reachable. */
    deleteAll(): Promise<{
        ok: boolean;
    }>;
    /** Retry a failed load or save. */
    retry(): Promise<void>;
}
export interface ChatHistoryManagerOptions {
    storageKey?: string;
    modeStorageKey?: string;
    /** Mode until the user picks one. Default "device". */
    defaultMode?: ChatHistoryMode;
    /** Used when "account" is chosen but cannot be used. Default "device". */
    fallbackMode?: "device" | "off";
    /** `disableChatHistory`: always "off", nothing to choose. */
    disabled?: boolean;
    adapter?: ChatHistoryAdapter;
    debounceMs?: number;
    retryDelaysMs?: number[];
    onError?: (error: unknown) => void;
}
/**
 * Owns the chat store and moves it between modes. The UI keeps reading the same store
 * object; only where it keeps chats changes. Call `start()` once after construction.
 */
export declare class ChatHistoryManager implements ChatHistoryControls {
    private opts;
    readonly store: ChatHistoryStore;
    private storageKey;
    private modeKey;
    private defaultMode;
    private fallback;
    private locked;
    private adapter?;
    private mode;
    private unavailable?;
    /** `undefined` until checked; `null` = nobody signed in (or no adapter). */
    private userId;
    private hintUserId;
    private sync?;
    private status;
    private error?;
    private listeners;
    private replacedListeners;
    private queue;
    private onPageHide?;
    constructor(opts?: ChatHistoryManagerOptions);
    /** Check who is signed in and load the account's chats if that is the mode. */
    start(): Promise<void>;
    refresh(): Promise<void>;
    setMode(mode: ChatHistoryMode, opts?: {
        moveDeviceChats?: boolean;
    }): Promise<void>;
    moveDeviceChats(opts?: {
        from?: DeviceChatSource;
    }): Promise<{
        moved: number;
        failed: number;
    }>;
    deleteAll(): Promise<{
        ok: boolean;
    }>;
    retry(): Promise<void>;
    /** True when this chat's messages still have to be fetched from the account. */
    needsLoad(id: string): boolean;
    /** Make sure a chat's messages are here before it is opened or copied. False if it is gone. */
    ensureLoaded(id: string): Promise<boolean>;
    /** Send any waiting account writes now. */
    flush(): Promise<void>;
    getState(): ChatHistoryState;
    subscribe(listener: () => void): () => void;
    /** Told when the store's contents were swapped: the active chat may be gone. */
    onReplaced(listener: () => void): () => void;
    dispose(): void;
    private chosen;
    private enqueue;
    private readUserId;
    private apply;
    /** Like readUserId, but lets an error through so a failed check is retried, not taken as sign-out. */
    private readUserIdStrict;
    /**
     * Where this person's own device chats are: their slot when the adapter names them, the
     * signed-out slot while nobody is signed in (or there is no adapter). null when the widget
     * can't tell whose chats are whose: not checked yet, or an adapter without `currentUserId`.
     */
    private ownDeviceKey;
    /** The slot device mode shows. Without a named user there is only the signed-out slot. */
    private deviceKey;
    private moveNow;
    private rememberLastUser;
    private onSyncStatus;
    private setStatus;
    private report;
    private emitState;
    private emitReplaced;
}
