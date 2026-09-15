import type { ChatMessage } from "@page-assistant/core";
/** A persisted conversation thread. */
export interface ChatSession {
    id: string;
    title: string;
    messages: ChatMessage[];
    createdAt: string;
    updatedAt: string;
    pinned?: boolean;
    archived?: boolean;
    unread?: boolean;
    groupId?: string;
    order?: number;
    model?: string;
}
export interface ChatGroup {
    id: string;
    name: string;
    order?: number;
}
export interface ChatHistoryData {
    version: 1;
    activeId: string | null;
    sessions: ChatSession[];
    groups: ChatGroup[];
}
export declare const CHAT_HISTORY_STORAGE_KEY = "page_assistant_chat_history";
export declare const CHAT_HISTORY_CHANGE_EVENT = "page-assistant-chat-history-change";
/**
 * What changed in a store, for anything mirroring it elsewhere (account sync).
 *
 * - `upsert`: a chat's content or its synced metadata (title, pinned, archived, group) changed.
 * - `delete`: a chat was removed.
 * - `import`: a backup was imported; `ids` are the chats it brought in.
 * - `replace`: the whole contents were swapped (a mode switch, a load). Not a user edit.
 *
 * Selecting a chat, marking it unread and reordering are local-only and not reported.
 */
export type ChatStoreChange = {
    kind: "upsert";
    id: string;
} | {
    kind: "delete";
    id: string;
} | {
    kind: "import";
    ids: string[];
} | {
    kind: "replace";
};
export interface ChatHistoryStoreOptions {
    /**
     * `true` (default): read and write localStorage, as every earlier version did.
     * `false`: memory only. Nothing is read from or written to the device.
     */
    persist?: boolean;
}
/**
 * Multi-chat store. The UI reads it synchronously; where it keeps chats is switchable:
 * localStorage (the default, and the only option before account history) or memory only.
 * Account sync mirrors it through `onChange` rather than living inside it.
 */
export declare class ChatHistoryStore {
    private storageKey;
    private data;
    private persistLocal;
    private listeners;
    constructor(storageKey?: string, opts?: ChatHistoryStoreOptions);
    /** What localStorage holds under `storageKey`, without touching any store. */
    static readLocal(storageKey?: string): ChatHistoryData;
    /** Remove every chat this device holds under `storageKey`. */
    static clearLocal(storageKey?: string): void;
    /** Remove the given chats from what localStorage holds under `storageKey`, leaving the rest. */
    static removeLocal(ids: string[], storageKey?: string): void;
    /** True while this store reads and writes localStorage. */
    get persistsLocally(): boolean;
    /** The localStorage key this store reads and writes while it persists. */
    get localKey(): string;
    /** Be told about every change that another copy would need to mirror. */
    onChange(listener: (change: ChatStoreChange) => void): () => void;
    /**
     * Switch to localStorage and show what it holds. `storageKey` moves the store to another
     * key (another person's slot); nothing is written to the key it leaves.
     */
    useLocalStorage(storageKey?: string): void;
    /** Switch to memory only, starting from `data` (empty by default). Writes nothing to the device. */
    useMemory(data?: Partial<ChatHistoryData>): void;
    /**
     * Add chats loaded from elsewhere. A chat already here that is newer than the incoming
     * copy is kept — it has edits the other copy has not seen yet. The active chat is kept.
     */
    merge(sessions: ChatSession[]): void;
    /** Drop chats from this store without reporting it: they are gone elsewhere already. */
    forget(ids: string[]): void;
    /** Empty the store (and localStorage, while persisting). Not reported as per-chat deletes. */
    clearAll(): void;
    /** Fill in a chat's messages without counting it as an edit. */
    hydrate(id: string, messages: ChatMessage[]): void;
    private commit;
    private writeLocal;
    getActiveId(): string | null;
    getActive(): ChatSession | null;
    list(includeArchived?: boolean): ChatSession[];
    listGroups(): ChatGroup[];
    get(id: string): ChatSession | undefined;
    create(opts?: {
        title?: string;
        model?: string;
    }): ChatSession;
    setActive(id: string | null): void;
    saveMessages(id: string, messages: ChatMessage[], opts?: {
        model?: string;
    }): void;
    rename(id: string, title: string): void;
    delete(id: string): void;
    archive(id: string, archived?: boolean): void;
    pin(id: string, pinned?: boolean): void;
    markUnread(id: string, unread?: boolean): void;
    fork(id: string): ChatSession | null;
    reorder(ids: string[]): void;
    setGroup(sessionId: string, groupId: string | undefined): void;
    createGroup(name: string): ChatGroup;
    renameGroup(id: string, name: string): void;
    deleteGroup(id: string): void;
    /** Export session as shareable JSON (no secrets). */
    share(id: string): string | null;
    /** Export all chats as JSON backup. */
    exportAll(): string;
    importAll(json: string): boolean;
    search(query: string): ChatSession[];
    private trimSessions;
}
