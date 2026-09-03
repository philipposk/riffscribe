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
/** localStorage-backed multi-chat store (client-only; host can sync via export/import). */
export declare class ChatHistoryStore {
    private storageKey;
    private data;
    constructor(storageKey?: string);
    private load;
    private persist;
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
