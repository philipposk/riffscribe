// Account-synced chat history: the contract a host implements, and the mirror that keeps a
// ChatHistoryStore and the host's backend in step.
//
// The widget never talks to a database. The host hands over an adapter that reads and writes
// the signed-in user's chats with that user's own credentials, so the host's access rules
// (for example row-level security) decide what anyone can see.
export function toAccountChat(s) {
    return {
        id: s.id,
        title: s.title,
        messages: [...s.messages],
        pinned: !!s.pinned,
        archived: !!s.archived,
        groupId: s.groupId ?? null,
        model: s.model ?? null,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
    };
}
export function fromAccountChat(c) {
    const now = new Date().toISOString();
    return {
        id: String(c.id),
        title: typeof c.title === "string" && c.title.trim() ? c.title : "New chat",
        messages: Array.isArray(c.messages) ? c.messages : [],
        createdAt: c.createdAt || c.updatedAt || now,
        updatedAt: c.updatedAt || c.createdAt || now,
        pinned: c.pinned ? true : undefined,
        archived: c.archived ? true : undefined,
        groupId: c.groupId ?? undefined,
        model: c.model ?? undefined,
    };
}
/**
 * Mirrors one ChatHistoryStore into a ChatHistoryAdapter.
 *
 * Writes are queued per chat and sent after a short pause. A chat is never saved with no
 * messages (every page load starts an empty one), and a chat whose messages were left out of
 * `list()` is fetched before it is saved, so a rename cannot blank the saved copy.
 */
export class AccountHistorySync {
    store;
    adapter;
    opts;
    dirty = new Set();
    deleted = new Set();
    partial = new Set();
    timer;
    running;
    attempts = 0;
    active = false;
    unsubscribe;
    constructor(store, adapter, opts = {}) {
        this.store = store;
        this.adapter = adapter;
        this.opts = opts;
    }
    /** The account's chats as sessions. Remembers which arrived without their messages. */
    async fetch() {
        const rows = await this.adapter.list();
        const sessions = [];
        for (const row of Array.isArray(rows) ? rows : []) {
            if (!row || (typeof row.id !== "string" && typeof row.id !== "number"))
                continue;
            const s = fromAccountChat(row);
            if (Array.isArray(row.messages))
                this.partial.delete(s.id);
            else
                this.partial.add(s.id);
            sessions.push(s);
        }
        return sessions;
    }
    /** Start sending the store's changes. */
    start() {
        if (this.active)
            return;
        this.active = true;
        this.unsubscribe = this.store.onChange((c) => this.onChange(c));
    }
    /** Queue chats for saving that changed before `start()` (created while the list was loading). */
    markDirty(ids) {
        if (!this.active || !ids.length)
            return;
        for (const id of ids)
            this.dirty.add(id);
        this.schedule(this.opts.debounceMs ?? 800);
    }
    /** True when this chat's messages have not been fetched yet. */
    needsLoad(id) {
        return this.partial.has(id);
    }
    /** Fetch one chat's messages into the store. "gone" when the account no longer has it. */
    async load(id) {
        const full = await this.adapter.get(id);
        this.partial.delete(id);
        if (!full) {
            this.store.forget([id]);
            return "gone";
        }
        this.store.hydrate(id, Array.isArray(full.messages) ? full.messages : []);
        return "loaded";
    }
    /** Save these chats now. Returns the ids that were saved. */
    async saveChats(sessions) {
        const chats = sessions.map(toAccountChat);
        if (!chats.length)
            return [];
        if (this.adapter.saveMany) {
            try {
                await this.adapter.saveMany(chats);
                return chats.map((c) => c.id);
            }
            catch {
                /* fall back to one at a time, so one bad chat does not block the rest */
            }
        }
        const saved = [];
        for (const chat of chats) {
            try {
                await this.adapter.save(chat);
                saved.push(chat.id);
            }
            catch {
                /* reported by the caller as "not moved"; nothing retries it automatically */
            }
        }
        return saved;
    }
    get pending() {
        return this.dirty.size + this.deleted.size > 0;
    }
    /** Send everything waiting now. Resolves when the queue is empty or a send failed. */
    async flush() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        while (this.running)
            await this.running;
        if (!this.active || !this.pending)
            return;
        this.running = this.send().finally(() => {
            this.running = undefined;
        });
        return this.running;
    }
    /** Forget unsent writes and wait for one in flight to finish. */
    async settle() {
        this.dropPending();
        while (this.running)
            await this.running;
    }
    /**
     * Stop mirroring. `flush: true` sends what is waiting first — a deliberate switch by the
     * same user. `false` drops it: after a sign-out or a change of user it would be written
     * as the wrong person.
     */
    async stop(opts) {
        if (opts.flush)
            await this.flush();
        this.active = false;
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        await this.settle();
    }
    dropPending() {
        this.dirty.clear();
        this.deleted.clear();
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
    }
    onChange(c) {
        if (!this.active)
            return;
        if (c.kind === "upsert") {
            this.dirty.add(c.id);
            this.deleted.delete(c.id);
        }
        else if (c.kind === "delete") {
            this.dirty.delete(c.id);
            this.partial.delete(c.id);
            this.deleted.add(c.id);
        }
        else if (c.kind === "import") {
            for (const id of c.ids) {
                this.dirty.add(id);
                this.deleted.delete(id);
                this.partial.delete(id);
            }
        }
        else {
            return; // "replace": loaded from somewhere else, nothing to send
        }
        this.attempts = 0;
        this.schedule(this.opts.debounceMs ?? 800);
    }
    schedule(ms) {
        if (this.timer)
            clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = undefined;
            void this.flush();
        }, ms);
    }
    async send() {
        this.opts.onStatus?.("saving");
        let failed;
        let hasFailure = false;
        try {
            if (this.opts.sameUser && !(await this.opts.sameUser())) {
                this.dropPending();
                this.opts.onUserChanged?.();
                return;
            }
        }
        catch (e) {
            failed = e;
            hasFailure = true;
        }
        if (!hasFailure) {
            for (const id of [...this.deleted]) {
                if (!this.active)
                    return;
                this.deleted.delete(id);
                try {
                    await this.adapter.delete(id);
                }
                catch (e) {
                    this.deleted.add(id);
                    if (!hasFailure)
                        failed = e;
                    hasFailure = true;
                }
            }
            for (const id of [...this.dirty]) {
                if (!this.active)
                    return;
                this.dirty.delete(id);
                try {
                    if (this.partial.has(id) && (await this.load(id)) === "gone")
                        continue;
                    const s = this.store.get(id);
                    if (!s || !s.messages.length)
                        continue;
                    await this.adapter.save(toAccountChat(s));
                }
                catch (e) {
                    this.dirty.add(id);
                    if (!hasFailure)
                        failed = e;
                    hasFailure = true;
                }
            }
        }
        if (hasFailure) {
            this.opts.onStatus?.("error", failed);
            const delay = (this.opts.retryDelaysMs ?? [2000, 10000, 30000])[this.attempts++];
            if (delay !== undefined && this.active)
                this.schedule(delay);
            return;
        }
        this.attempts = 0;
        // Changes made while this pass ran have their own timer.
        this.opts.onStatus?.(this.pending ? "saving" : "idle");
    }
}
