import type { ChatMessage } from "@page-assistant/core";
import type { ChatHistoryStore, ChatSession } from "./chatHistory.js";
/** One saved chat, as the host's backend keeps it. */
export interface AccountChat {
    /** Made by the widget. Not a UUID for chats created before account history existed. */
    id: string;
    title: string;
    messages: ChatMessage[];
    pinned?: boolean;
    archived?: boolean;
    groupId?: string | null;
    model?: string | null;
    /** ISO 8601. */
    createdAt: string;
    /** ISO 8601. The last time the user did something with this chat. */
    updatedAt: string;
}
/** A chat in `list()`. `messages` may be left out to keep the list light; `get` then fills it in. */
export type AccountChatSummary = Omit<AccountChat, "messages"> & {
    messages?: ChatMessage[];
};
/**
 * What a host implements for "account" mode. Every call acts as the signed-in user and only
 * ever sees that user's chats.
 */
export interface ChatHistoryAdapter {
    /**
     * The signed-in user's id, or null/undefined when nobody is signed in. While nobody is,
     * the widget falls back to its signed-out mode and says why in settings. Also keys the
     * user's saved choice of mode and their "device" chats, so two people sharing a browser
     * share neither. Without it the widget can't tell people apart: every device chat sits in
     * one signed-out slot and is never offered to anyone as their own.
     */
    currentUserId?(): string | null | undefined | Promise<string | null | undefined>;
    /** Every saved chat, newest first. Rows may leave out `messages`. */
    list(): Promise<AccountChatSummary[]>;
    /** One chat with its messages, or null if it no longer exists. */
    get(id: string): Promise<AccountChat | null>;
    /** Create or replace one chat. */
    save(chat: AccountChat): Promise<void>;
    /** Optional bulk form of `save`, used when moving this device's chats in one go. */
    saveMany?(chats: AccountChat[]): Promise<void>;
    delete(id: string): Promise<void>;
    /** Delete every chat this user has saved (in this app). */
    deleteAll(): Promise<void>;
    /** How long saved chats last without activity. Shown to the user when set. */
    retentionMonths?: number;
}
export declare function toAccountChat(s: ChatSession): AccountChat;
export declare function fromAccountChat(c: AccountChatSummary): ChatSession;
export type AccountSyncStatus = "idle" | "saving" | "error";
export interface AccountHistorySyncOptions {
    /** Wait this long after a change before sending, so a burst becomes one write. Default 800. */
    debounceMs?: number;
    /** Automatic retries after a failed send. Default [2000, 10000, 30000]; then the next change retries. */
    retryDelaysMs?: number[];
    /** Resolves false once the signed-in user is not the one this mirror started for. */
    sameUser?: () => Promise<boolean>;
    /** Called when `sameUser` said no. Pending writes have been dropped by then. */
    onUserChanged?: () => void;
    onStatus?: (status: AccountSyncStatus, error?: unknown) => void;
}
/**
 * Mirrors one ChatHistoryStore into a ChatHistoryAdapter.
 *
 * Writes are queued per chat and sent after a short pause. A chat is never saved with no
 * messages (every page load starts an empty one), and a chat whose messages were left out of
 * `list()` is fetched before it is saved, so a rename cannot blank the saved copy.
 */
export declare class AccountHistorySync {
    private store;
    private adapter;
    private opts;
    private dirty;
    private deleted;
    private partial;
    private timer?;
    private running?;
    private attempts;
    private active;
    private unsubscribe?;
    constructor(store: ChatHistoryStore, adapter: ChatHistoryAdapter, opts?: AccountHistorySyncOptions);
    /** The account's chats as sessions. Remembers which arrived without their messages. */
    fetch(): Promise<ChatSession[]>;
    /** Start sending the store's changes. */
    start(): void;
    /** Queue chats for saving that changed before `start()` (created while the list was loading). */
    markDirty(ids: string[]): void;
    /** True when this chat's messages have not been fetched yet. */
    needsLoad(id: string): boolean;
    /** Fetch one chat's messages into the store. "gone" when the account no longer has it. */
    load(id: string): Promise<"loaded" | "gone">;
    /** Save these chats now. Returns the ids that were saved. */
    saveChats(sessions: ChatSession[]): Promise<string[]>;
    get pending(): boolean;
    /** Send everything waiting now. Resolves when the queue is empty or a send failed. */
    flush(): Promise<void>;
    /** Forget unsent writes and wait for one in flight to finish. */
    settle(): Promise<void>;
    /**
     * Stop mirroring. `flush: true` sends what is waiting first — a deliberate switch by the
     * same user. `false` drops it: after a sign-out or a change of user it would be written
     * as the wrong person.
     */
    stop(opts: {
        flush: boolean;
    }): Promise<void>;
    private dropPending;
    private onChange;
    private schedule;
    private send;
}
