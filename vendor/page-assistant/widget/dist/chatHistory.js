export const CHAT_HISTORY_STORAGE_KEY = "page_assistant_chat_history";
export const CHAT_HISTORY_CHANGE_EVENT = "page-assistant-chat-history-change";
const MAX_SESSIONS = 200;
const MAX_MESSAGES_PER_SESSION = 100;
function uid() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}
function titleFromMessage(text) {
    const t = text.trim().replace(/\s+/g, " ");
    return t.length > 48 ? t.slice(0, 46) + "…" : t || "New chat";
}
/** localStorage-backed multi-chat store (client-only; host can sync via export/import). */
export class ChatHistoryStore {
    storageKey;
    data;
    constructor(storageKey = CHAT_HISTORY_STORAGE_KEY) {
        this.storageKey = storageKey;
        this.data = this.load();
    }
    load() {
        if (typeof localStorage === "undefined") {
            return { version: 1, activeId: null, sessions: [], groups: [] };
        }
        try {
            const raw = localStorage.getItem(this.storageKey);
            if (!raw)
                return { version: 1, activeId: null, sessions: [], groups: [] };
            const parsed = JSON.parse(raw);
            if (parsed.version !== 1 || !Array.isArray(parsed.sessions)) {
                return { version: 1, activeId: null, sessions: [], groups: [] };
            }
            return { version: 1, activeId: parsed.activeId ?? null, sessions: parsed.sessions, groups: parsed.groups ?? [] };
        }
        catch {
            return { version: 1, activeId: null, sessions: [], groups: [] };
        }
    }
    persist() {
        if (typeof localStorage === "undefined")
            return;
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.data));
            window.dispatchEvent(new CustomEvent(CHAT_HISTORY_CHANGE_EVENT));
        }
        catch {
            /* quota exceeded — trim oldest archived */
            const archived = this.data.sessions.filter((s) => s.archived).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
            for (const s of archived.slice(0, 5))
                this.data.sessions = this.data.sessions.filter((x) => x.id !== s.id);
            try {
                localStorage.setItem(this.storageKey, JSON.stringify(this.data));
            }
            catch {
                /* give up */
            }
        }
    }
    getActiveId() {
        return this.data.activeId;
    }
    getActive() {
        if (!this.data.activeId)
            return null;
        return this.data.sessions.find((s) => s.id === this.data.activeId) ?? null;
    }
    list(includeArchived = false) {
        const sessions = includeArchived ? [...this.data.sessions] : this.data.sessions.filter((s) => !s.archived);
        return sessions.sort((a, b) => {
            if (a.pinned && !b.pinned)
                return -1;
            if (!a.pinned && b.pinned)
                return 1;
            const ao = a.order ?? 0;
            const bo = b.order ?? 0;
            if (ao !== bo)
                return bo - ao;
            return b.updatedAt.localeCompare(a.updatedAt);
        });
    }
    listGroups() {
        return [...this.data.groups].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }
    get(id) {
        return this.data.sessions.find((s) => s.id === id);
    }
    create(opts) {
        const now = new Date().toISOString();
        const session = {
            id: uid(),
            title: opts?.title ?? "New chat",
            messages: [],
            createdAt: now,
            updatedAt: now,
            model: opts?.model,
        };
        this.data.sessions.unshift(session);
        this.data.activeId = session.id;
        this.trimSessions();
        this.persist();
        return session;
    }
    setActive(id) {
        this.data.activeId = id;
        if (id) {
            const s = this.get(id);
            if (s) {
                s.unread = false;
            }
        }
        this.persist();
    }
    saveMessages(id, messages, opts) {
        const s = this.get(id);
        if (!s)
            return;
        s.messages = messages.slice(-MAX_MESSAGES_PER_SESSION);
        s.updatedAt = new Date().toISOString();
        if (opts?.model)
            s.model = opts.model;
        const firstUser = s.messages.find((m) => m.role === "user");
        if (firstUser && (s.title === "New chat" || !s.title)) {
            s.title = titleFromMessage(firstUser.content);
        }
        this.persist();
    }
    rename(id, title) {
        const s = this.get(id);
        if (!s)
            return;
        s.title = title.trim() || s.title;
        s.updatedAt = new Date().toISOString();
        this.persist();
    }
    delete(id) {
        this.data.sessions = this.data.sessions.filter((s) => s.id !== id);
        if (this.data.activeId === id) {
            this.data.activeId = this.data.sessions.find((s) => !s.archived)?.id ?? null;
        }
        this.persist();
    }
    archive(id, archived = true) {
        const s = this.get(id);
        if (!s)
            return;
        s.archived = archived;
        s.updatedAt = new Date().toISOString();
        if (archived && this.data.activeId === id) {
            this.data.activeId = this.data.sessions.find((x) => !x.archived && x.id !== id)?.id ?? null;
        }
        this.persist();
    }
    pin(id, pinned = true) {
        const s = this.get(id);
        if (!s)
            return;
        s.pinned = pinned;
        s.updatedAt = new Date().toISOString();
        this.persist();
    }
    markUnread(id, unread = true) {
        const s = this.get(id);
        if (!s)
            return;
        s.unread = unread;
        this.persist();
    }
    fork(id) {
        const src = this.get(id);
        if (!src)
            return null;
        const now = new Date().toISOString();
        const forked = {
            id: uid(),
            title: `${src.title} (fork)`,
            messages: [...src.messages],
            createdAt: now,
            updatedAt: now,
            model: src.model,
            groupId: src.groupId,
        };
        this.data.sessions.unshift(forked);
        this.data.activeId = forked.id;
        this.trimSessions();
        this.persist();
        return forked;
    }
    reorder(ids) {
        ids.forEach((id, i) => {
            const s = this.get(id);
            if (s)
                s.order = ids.length - i;
        });
        this.persist();
    }
    setGroup(sessionId, groupId) {
        const s = this.get(sessionId);
        if (!s)
            return;
        s.groupId = groupId;
        s.updatedAt = new Date().toISOString();
        this.persist();
    }
    createGroup(name) {
        const g = { id: uid(), name, order: this.data.groups.length };
        this.data.groups.push(g);
        this.persist();
        return g;
    }
    renameGroup(id, name) {
        const g = this.data.groups.find((x) => x.id === id);
        if (!g)
            return;
        g.name = name.trim() || g.name;
        this.persist();
    }
    deleteGroup(id) {
        this.data.groups = this.data.groups.filter((g) => g.id !== id);
        for (const s of this.data.sessions) {
            if (s.groupId === id)
                s.groupId = undefined;
        }
        this.persist();
    }
    /** Export session as shareable JSON (no secrets). */
    share(id) {
        const s = this.get(id);
        if (!s)
            return null;
        return JSON.stringify({ title: s.title, messages: s.messages, exportedAt: new Date().toISOString() }, null, 2);
    }
    /** Export all chats as JSON backup. */
    exportAll() {
        return JSON.stringify(this.data, null, 2);
    }
    importAll(json) {
        try {
            const parsed = JSON.parse(json);
            if (parsed.version !== 1 || !Array.isArray(parsed.sessions))
                return false;
            this.data = parsed;
            this.persist();
            return true;
        }
        catch {
            return false;
        }
    }
    search(query) {
        const q = query.toLowerCase().trim();
        if (!q)
            return this.list();
        return this.list(true).filter((s) => {
            if (s.title.toLowerCase().includes(q))
                return true;
            return s.messages.some((m) => m.content.toLowerCase().includes(q));
        });
    }
    trimSessions() {
        if (this.data.sessions.length <= MAX_SESSIONS)
            return;
        const sorted = [...this.data.sessions]
            .filter((s) => !s.pinned && s.archived)
            .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
        for (const s of sorted) {
            if (this.data.sessions.length <= MAX_SESSIONS)
                break;
            this.data.sessions = this.data.sessions.filter((x) => x.id !== s.id);
        }
    }
}
