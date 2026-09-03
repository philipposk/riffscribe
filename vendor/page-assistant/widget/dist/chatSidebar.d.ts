import type { ChatHistoryStore } from "./chatHistory.js";
export interface ChatSidebarHandlers {
    onSelect: (id: string) => void;
    onNew: () => void;
    onDelete: (id: string) => void;
    onArchive: (id: string) => void;
    onPin: (id: string, pinned: boolean) => void;
    onRename: (id: string, title: string) => void;
    onFork: (id: string) => void;
    onMarkUnread: (id: string) => void;
    onShare: (id: string) => void;
    onSearch: (query: string) => void;
    onToggle: (open: boolean) => void;
}
export declare class ChatSidebar {
    private store;
    private handlers;
    private activeId;
    private el;
    private listEl;
    private searchInput;
    private ctxMenu?;
    private ctxMenuAnchor?;
    private showLimit;
    private query;
    private onHistoryChange;
    private outsideClickHandler?;
    constructor(store: ChatHistoryStore, handlers: ChatSidebarHandlers, activeId: string | null);
    render(): HTMLDivElement;
    /** Detach the history listener and any open menu (for widget teardown). */
    destroy(): void;
    setActive(id: string | null): void;
    setCollapsed(collapsed: boolean): void;
    refresh(): void;
    private addSection;
    private addItem;
    private openContextMenu;
    private closeContextMenu;
    /** Close the context menu if it's open; returns true if there was one to close (for Escape). */
    closeContextMenuIfOpen(): boolean;
    private promptRename;
}
