import type { ChatHistoryStore } from "./chatHistory.js";
import { type ChatSidebarHandlers } from "./chatSidebar.js";
import type { FileAttachment } from "./fileUpload.js";
import type { ThemeMode } from "./assistant-settings.js";
export type MascotState = "idle" | "listening" | "thinking" | "talking" | "scanning";
export interface UIHandlers {
    onSend: (text: string, attachments?: FileAttachment[]) => void;
    onMic: () => void;
    onConfirm: (approved: boolean) => void;
    onToggle?: (open: boolean) => void;
    onSettings?: () => void;
    onTtsToggle?: (enabled: boolean) => void;
    onNewChat?: () => void;
    onSelectChat?: (id: string) => void;
    onExportChat?: () => void;
    /** Return true if the deleted/archived id was the active chat (so the store op ran). */
    onDeleteChat?: (id: string) => void;
    onArchiveChat?: (id: string) => void;
}
export interface UIOptions {
    chatStore?: ChatHistoryStore;
    theme?: ThemeMode;
    sidebarOpen?: boolean;
    imagesEnabled?: boolean;
    onSidebarHandlers?: (h: ChatSidebarHandlers) => void;
}
export declare class WidgetUI {
    private title;
    private handlers;
    private opts;
    private root;
    private host;
    private launcher;
    private panelWrap;
    private panel;
    private log;
    private input;
    private micBtn;
    private micCountdown;
    private ttsBtn;
    private sendBtn;
    private attachBtn;
    private scanline;
    private toastEl;
    private sidebar?;
    private sidebarEl?;
    private sidebarScrim?;
    private attachPreview;
    private fileInput;
    private pendingAttachments;
    private sidebarOpen;
    private theme;
    private styleEl;
    private typingEl?;
    private confirmRow?;
    private highlightEl?;
    private highlightTarget?;
    private highlightReanchor?;
    private busy;
    private lastFocused?;
    private keydownHandler?;
    private viewportHandler?;
    constructor(title: string, handlers: UIHandlers, opts?: UIOptions);
    private themeStyle;
    private render;
    private bindKeyboard;
    private bindViewport;
    private focusables;
    private trapFocus;
    private handleFiles;
    private refreshAttachPreview;
    setSidebarOpen(open: boolean): void;
    setTheme(theme: ThemeMode): void;
    setActiveChat(id: string | null): void;
    toast(text: string): void;
    private submit;
    /** Lock/unlock all input affordances while a request is in flight. */
    setBusy(busy: boolean): void;
    private showTyping;
    private hideTyping;
    toggle(open?: boolean): void;
    setMic(on: boolean): void;
    /** Show a remaining-seconds badge on the mic during the server-STT capture window. */
    setMicCountdown(seconds: number | null): void;
    setTtsEnabled(on: boolean): void;
    clearLog(): void;
    loadMessages(messages: Array<{
        role: string;
        content: string;
    }>): void;
    addMessage(role: "user" | "assistant" | "system", text: string): HTMLElement;
    /** Error bubble with readable styling and optional retry. */
    addError(text: string, onRetry?: () => void): HTMLDivElement;
    private clearConfirm;
    /** Remove any stale confirm row (called when the controller clears `pending`). */
    removeConfirm(): void;
    addConfirm(preview: string): void;
    /** Draw a highlight ring over a page element (in the shadow root). Defensive: no-op if gone. */
    highlightElement(selector: string): boolean;
    clearHighlight(): void;
    addSuggestions(items: string[], onPick: (t: string) => void): void;
    setState(s: MascotState): void;
    /** Tear down all DOM + listeners this UI created (for destroy()). */
    destroy(): void;
}
