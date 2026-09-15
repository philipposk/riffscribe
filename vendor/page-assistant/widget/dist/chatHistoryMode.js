// Where chat history is kept — "account", "device" or "off" — and the switch between them.
//
// The host picks the default and may supply an adapter for "account". The user can change
// the mode in settings; that choice is remembered in this browser, per signed-in user.
//
// "device" chats are kept per person too. When the adapter says who is signed in
// (`currentUserId()`), their device chats live under `${storageKey}:user:${id}`. The plain
// `storageKey` — what every earlier version wrote — is the signed-out slot: chats made while
// nobody was signed in, by whoever used this browser. Nobody is shown another person's slot,
// and signed-out chats are only ever offered to a signed-in user as exactly that.
import { ChatHistoryStore, CHAT_HISTORY_STORAGE_KEY } from "./chatHistory.js";
import { AccountHistorySync } from "./chatHistoryAccount.js";
export const CHAT_HISTORY_MODES = ["account", "device", "off"];
export const CHAT_HISTORY_MODE_STORAGE_KEY = "page_assistant_history_mode";
export function isChatHistoryMode(v) {
    return v === "account" || v === "device" || v === "off";
}
/**
 * Where this browser keeps a person's "device" chats. A known user gets their own key; nobody
 * signed in (null), or a user the adapter can't name (""), uses `storageKey` itself — the
 * signed-out slot, which is also where every earlier version kept chats.
 */
export function deviceStorageKey(storageKey, userId) {
    return userId ? `${storageKey}:user:${userId}` : storageKey;
}
function countLocal(key) {
    return ChatHistoryStore.readLocal(key).sessions.filter((s) => s.messages?.length).length;
}
/** The mode actually in effect, and why "account" is unavailable if it is. */
export function resolveChatHistoryMode(i) {
    if (i.locked)
        return { mode: "off" };
    const unavailable = !i.hasAdapter
        ? "no-adapter"
        : i.signedIn === false
            ? "signed-out"
            : undefined;
    const chosen = isChatHistoryMode(i.chosen) ? i.chosen : "device";
    if (chosen !== "account")
        return { mode: chosen, unavailable };
    if (!unavailable)
        return { mode: "account" };
    return { mode: i.fallback === "off" ? "off" : "device", unavailable };
}
const slot = (userId) => (userId === null ? "anon" : `user:${userId}`);
function readPrefs(key) {
    if (typeof localStorage === "undefined")
        return { v: 1, modes: {} };
    try {
        const parsed = JSON.parse(localStorage.getItem(key) || "null");
        if (parsed && parsed.v === 1 && parsed.modes && typeof parsed.modes === "object")
            return parsed;
    }
    catch {
        /* unreadable: start over */
    }
    return { v: 1, modes: {} };
}
function writePrefs(key, prefs) {
    if (typeof localStorage === "undefined")
        return;
    try {
        localStorage.setItem(key, JSON.stringify(prefs));
    }
    catch {
        /* storage blocked: the choice lasts for this page only */
    }
}
/** The mode this user picked in this browser, if they picked one. `null` = signed out. */
export function getStoredChatHistoryMode(userId, key = CHAT_HISTORY_MODE_STORAGE_KEY) {
    const m = readPrefs(key).modes[slot(userId)];
    return isChatHistoryMode(m) ? m : undefined;
}
export function setStoredChatHistoryMode(mode, userId, key = CHAT_HISTORY_MODE_STORAGE_KEY) {
    const prefs = readPrefs(key);
    prefs.modes[slot(userId)] = mode;
    writePrefs(key, prefs);
}
/**
 * Owns the chat store and moves it between modes. The UI keeps reading the same store
 * object; only where it keeps chats changes. Call `start()` once after construction.
 */
export class ChatHistoryManager {
    opts;
    store;
    storageKey;
    modeKey;
    defaultMode;
    fallback;
    locked;
    adapter;
    offerSignedOut;
    mode;
    unavailable;
    /** `undefined` until checked; `null` = nobody signed in (or no adapter). */
    userId;
    hintUserId;
    userGen = 0;
    sync;
    status = "idle";
    error;
    listeners = new Set();
    replacedListeners = new Set();
    queue = Promise.resolve();
    onPageHide;
    constructor(opts = {}) {
        this.opts = opts;
        this.storageKey = opts.storageKey ?? CHAT_HISTORY_STORAGE_KEY;
        this.modeKey = opts.modeStorageKey ?? CHAT_HISTORY_MODE_STORAGE_KEY;
        this.defaultMode = isChatHistoryMode(opts.defaultMode) ? opts.defaultMode : "device";
        this.fallback = opts.fallbackMode === "off" ? "off" : "device";
        this.locked = !!opts.disabled;
        this.adapter = opts.adapter;
        this.offerSignedOut = opts.offerSignedOutChats !== false;
        // First guess, so the first render is usually already right: whoever was signed in
        // last time is usually who is here now. `start()` checks.
        if (!this.adapter) {
            this.userId = null;
        }
        else {
            const last = readPrefs(this.modeKey).last;
            this.hintUserId = last === undefined ? undefined : last;
        }
        const r = resolveChatHistoryMode({
            chosen: this.chosen(),
            locked: this.locked,
            hasAdapter: !!this.adapter,
            signedIn: this.adapter ? (this.hintUserId === null ? false : undefined) : false,
            fallback: this.fallback,
        });
        this.mode = r.mode;
        this.unavailable = r.unavailable;
        // Only "device" touches localStorage; account mode loads into memory. When the adapter
        // names users, even "device" waits for `start()`: the hint above may be the previous
        // person, and their chats must not flash up for whoever is here now.
        this.store = new ChatHistoryStore(this.storageKey, {
            persist: this.mode === "device" && !this.adapter?.currentUserId,
        });
        if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
            this.onPageHide = () => void this.sync?.flush();
            window.addEventListener("pagehide", this.onPageHide);
        }
    }
    /** Check who is signed in and load the account's chats if that is the mode. */
    start() {
        return this.enqueue(() => this.apply());
    }
    refresh() {
        return this.enqueue(() => this.apply());
    }
    setMode(mode, opts = {}) {
        if (this.locked || !isChatHistoryMode(mode))
            return Promise.resolve();
        return this.enqueue(() => this.apply({ choose: mode, move: !!opts.moveDeviceChats }));
    }
    moveDeviceChats(opts = {}) {
        return this.enqueue(async () => {
            const r = await this.moveNow(opts.from === "signed-out" ? "signed-out" : "mine");
            this.emitState();
            return r;
        });
    }
    deleteAll() {
        return this.enqueue(async () => {
            let ok = true;
            if (this.adapter && typeof this.userId === "string") {
                // A write still waiting would bring a chat back after the delete.
                await this.sync?.settle();
                try {
                    await this.adapter.deleteAll();
                }
                catch (e) {
                    ok = false;
                    this.report(e);
                }
            }
            // This person's device chats only: not another user's slot, and not the signed-out
            // slot while someone is signed in.
            if (this.userId !== undefined || !this.adapter?.currentUserId)
                ChatHistoryStore.clearLocal(this.deviceKey());
            // If the account could not be emptied, keep showing what it still holds.
            if (ok || this.mode !== "account")
                this.store.clearAll();
            this.emitReplaced();
            this.emitState();
            return { ok };
        });
    }
    retry() {
        if (this.error === "save" && this.sync)
            return this.sync.flush();
        return this.enqueue(() => this.apply({ reload: true }));
    }
    /** True when this chat's messages still have to be fetched from the account. */
    needsLoad(id) {
        return !!this.sync?.needsLoad(id);
    }
    /** Make sure a chat's messages are here before it is opened or copied. False if it is gone. */
    async ensureLoaded(id) {
        if (!this.sync?.needsLoad(id))
            return !!this.store.get(id);
        return (await this.sync.load(id)) === "loaded";
    }
    /**
     * Goes up each time the signed-in user changes (sign-out, sign-in, another account), as soon
     * as the change is noticed and before the store is swapped. Anything started for the
     * previous person — a reply still loading — compares it to know it must not be saved.
     */
    get userGeneration() {
        return this.userGen;
    }
    /** Send any waiting account writes now. */
    flush() {
        return this.sync?.flush() ?? Promise.resolve();
    }
    getState() {
        const own = this.ownDeviceKey();
        const shown = this.store.persistsLocally ? this.store.localKey : null;
        const signedOutHidden = this.offerSignedOut && this.userId !== undefined && own !== this.storageKey && shown !== this.storageKey;
        return {
            mode: this.mode,
            chosen: this.chosen(),
            locked: this.locked,
            accountUnavailable: this.locked ? undefined : this.unavailable,
            status: this.status,
            error: this.status === "error" ? this.error : undefined,
            deviceChatCount: this.locked || !own ? 0 : countLocal(own),
            signedOutDeviceChatCount: this.locked || !signedOutHidden ? 0 : countLocal(this.storageKey),
            canDeleteAccountChats: !!this.adapter && typeof this.userId === "string",
            retentionMonths: this.adapter?.retentionMonths,
        };
    }
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    /** Told when the store's contents were swapped: the active chat may be gone. */
    onReplaced(listener) {
        this.replacedListeners.add(listener);
        return () => this.replacedListeners.delete(listener);
    }
    dispose() {
        if (this.onPageHide && typeof window !== "undefined")
            window.removeEventListener("pagehide", this.onPageHide);
        const sync = this.sync;
        this.sync = undefined;
        void sync?.stop({ flush: true });
        this.listeners.clear();
        this.replacedListeners.clear();
    }
    // --- internals ---------------------------------------------------------------------------
    chosen() {
        if (this.locked)
            return "off";
        const who = this.userId !== undefined ? this.userId : this.hintUserId ?? null;
        return getStoredChatHistoryMode(this.adapter ? who : null, this.modeKey) ?? this.defaultMode;
    }
    enqueue(fn) {
        const run = this.queue.then(fn, fn);
        this.queue = run.catch(() => undefined);
        return run;
    }
    async readUserId() {
        if (!this.adapter)
            return null;
        if (!this.adapter.currentUserId)
            return "";
        try {
            const id = await this.adapter.currentUserId();
            return id ? String(id) : null;
        }
        catch (e) {
            this.report(e);
            return null;
        }
    }
    async apply(opts = {}) {
        if (this.locked)
            return;
        const userId = await this.readUserId();
        const first = this.userId === undefined;
        const userChanged = !first && userId !== this.userId;
        this.userId = userId;
        if (userChanged)
            this.userGen++;
        if (this.adapter)
            this.rememberLastUser(userId);
        if (opts.choose)
            setStoredChatHistoryMode(opts.choose, this.adapter ? userId : null, this.modeKey);
        const { mode: next, unavailable } = resolveChatHistoryMode({
            chosen: this.chosen(),
            hasAdapter: !!this.adapter,
            signedIn: userId !== null,
            fallback: this.fallback,
        });
        this.unavailable = unavailable;
        const prev = this.mode;
        const load = next === "account" && (prev !== "account" || first || userChanged || opts.reload || !this.sync);
        // Device mode shows exactly one slot: this person's. A new person means a new slot.
        const deviceKey = this.deviceKey();
        const openDevice = next === "device" && (!this.store.persistsLocally || this.store.localKey !== deviceKey);
        if (next === prev && !load && !openDevice) {
            this.emitState();
            return;
        }
        // Leave the old mode. The same person switching: send what is waiting. A different
        // person (or nobody): drop it, it would be saved as the wrong user.
        if (this.sync && (next !== "account" || userChanged)) {
            const old = this.sync;
            this.sync = undefined;
            await old.stop({ flush: !userChanged });
        }
        const activeBefore = this.store.getActiveId();
        if (next !== "account") {
            this.status = "idle";
            this.error = undefined;
        }
        if (next === "device") {
            // Chats typed on this page before the first check finished are this person's.
            const early = first && prev === "device" && !this.store.persistsLocally
                ? this.store.list(true).filter((s) => s.messages.length)
                : [];
            this.mode = "device";
            this.store.useLocalStorage(deviceKey);
            if (early.length)
                this.store.merge(early);
        }
        else if (next === "off") {
            // Keep the conversation on screen for this page; nothing is written anywhere.
            const carry = !userChanged && prev !== "off" ? this.store.getActive() : null;
            this.mode = "off";
            this.store.useMemory(carry ? { sessions: [carry], activeId: carry.id } : undefined);
        }
        else {
            this.mode = "account";
            // Loading keeps what is already here when it is this same page's account copy (first
            // load, or a retry); anything else is replaced so no other copy leaks into the account.
            const keep = prev === "account" && !userChanged;
            const sync = this.sync ??
                new AccountHistorySync(this.store, this.adapter, {
                    debounceMs: this.opts.debounceMs,
                    retryDelaysMs: this.opts.retryDelaysMs,
                    sameUser: async () => (await this.readUserIdStrict()) === this.userId,
                    onUserChanged: () => void this.refresh(),
                    onStatus: (s, e) => this.onSyncStatus(s, e),
                });
            this.sync = sync;
            if (keep)
                sync.start();
            this.setStatus("loading");
            let sessions;
            try {
                sessions = await sync.fetch();
                this.error = undefined;
                this.setStatus("idle");
            }
            catch (e) {
                this.report(e);
                this.error = "load";
                this.setStatus("error");
            }
            if (keep) {
                const loaded = new Set((sessions ?? []).map((s) => s.id));
                if (sessions)
                    this.store.merge(sessions);
                // Chats started here while the list was loading were never sent.
                sync.markDirty(this.store
                    .list(true)
                    .filter((s) => !loaded.has(s.id) && s.messages.length)
                    .map((s) => s.id));
            }
            else {
                this.store.useMemory({ sessions: sessions ?? [] });
                sync.start();
            }
            if (opts.move)
                await this.moveNow();
            if (activeBefore && this.store.get(activeBefore))
                this.store.setActive(activeBefore);
        }
        this.emitReplaced();
        this.emitState();
    }
    /** Like readUserId, but lets an error through so a failed check is retried, not taken as sign-out. */
    async readUserIdStrict() {
        if (!this.adapter)
            return null;
        if (!this.adapter.currentUserId)
            return "";
        const id = await this.adapter.currentUserId();
        return id ? String(id) : null;
    }
    /**
     * Where this person's own device chats are: their slot when the adapter names them, the
     * signed-out slot while nobody is signed in (or there is no adapter). null when the widget
     * can't tell whose chats are whose: not checked yet, or an adapter without `currentUserId`.
     */
    ownDeviceKey() {
        if (!this.adapter || this.userId === null)
            return this.storageKey;
        if (!this.userId)
            return null;
        return deviceStorageKey(this.storageKey, this.userId);
    }
    /** The slot device mode shows. Without a named user there is only the signed-out slot. */
    deviceKey() {
        return this.ownDeviceKey() ?? this.storageKey;
    }
    async moveNow(from = "mine") {
        const none = { moved: 0, failed: 0 };
        const own = this.ownDeviceKey();
        // "mine" is only ever the user's own slot; the signed-out slot only when it isn't theirs
        // and the host allows offering it at all.
        const source = from === "mine" ? own : own === this.storageKey || !this.offerSignedOut ? null : this.storageKey;
        if (!source)
            return none;
        const local = ChatHistoryStore.readLocal(source).sessions.filter((s) => s.messages?.length);
        if (!local.length)
            return none;
        if (this.mode === "account" && this.sync) {
            // A move is activity. Keeping the old updatedAt would let the account's retention
            // delete a chat right after the user was told it was moved (and its device copy went).
            const now = new Date().toISOString();
            const moving = local.map((s) => ({ ...s, updatedAt: now }));
            const saved = new Set(await this.sync.saveChats(moving));
            this.store.merge(moving.filter((s) => saved.has(s.id)));
            // Moved, not copied: the browser copy goes only once the account has it.
            ChatHistoryStore.removeLocal([...saved], source);
            return { moved: saved.size, failed: local.length - saved.size };
        }
        if (this.mode === "device" && from === "signed-out" && own && this.store.localKey === own) {
            this.store.merge(local);
            // Only what the user's own slot now really holds leaves the signed-out slot.
            const kept = new Set(ChatHistoryStore.readLocal(own).sessions.map((s) => s.id));
            const moved = local.filter((s) => kept.has(s.id)).map((s) => s.id);
            ChatHistoryStore.removeLocal(moved, source);
            return { moved: moved.length, failed: local.length - moved.length };
        }
        return none;
    }
    rememberLastUser(userId) {
        const prefs = readPrefs(this.modeKey);
        if (prefs.last === userId)
            return;
        prefs.last = userId;
        writePrefs(this.modeKey, prefs);
    }
    onSyncStatus(s, e) {
        if (s === "error") {
            this.report(e);
            this.error = "save";
            this.setStatus("error");
        }
        else {
            if (this.error === "save")
                this.error = undefined;
            // Don't let a background save paper over a failed load.
            if (this.error !== "load")
                this.setStatus(s);
        }
    }
    setStatus(s) {
        if (this.status === s)
            return;
        this.status = s;
        this.emitState();
    }
    report(e) {
        try {
            this.opts.onError?.(e);
        }
        catch {
            /* a host logger must not break history */
        }
    }
    emitState() {
        for (const l of this.listeners) {
            try {
                l();
            }
            catch {
                /* a listener must not break the manager */
            }
        }
    }
    emitReplaced() {
        for (const l of this.replacedListeners) {
            try {
                l();
            }
            catch {
                /* ditto */
            }
        }
    }
}
