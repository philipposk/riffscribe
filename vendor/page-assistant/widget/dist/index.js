import { Assistant, InMemoryStore, rememberFactCapability, } from "@page-assistant/core";
import { proxyProvider, ProxyError } from "./llmProxy.js";
import { Voice, VoiceError } from "./voice.js";
import { WidgetUI } from "./ui.js";
import { fullScan, scanPage } from "./scanner.js";
import { LocalMemoryStore } from "./localMemory.js";
import { pageActionCapabilities } from "./pageActions.js";
import { VOICE_SETTINGS_CHANGE_EVENT, VOICE_SETTINGS_STORAGE_KEY, getVoiceSettings, voiceOptionsFromSettings, } from "./settings.js";
import { openVoiceSettingsModal, mountVoiceSettingsPanel, closeVoiceSettingsModal } from "./settings-ui.js";
import { ASSISTANT_SETTINGS_CHANGE_EVENT, ASSISTANT_SETTINGS_STORAGE_KEY, getAssistantSettings, } from "./assistant-settings.js";
import { openAssistantSettingsModal, closeAssistantSettingsModal, mountAssistantSettingsPanel, } from "./assistant-settings-ui.js";
import { ChatHistoryStore } from "./chatHistory.js";
import { formatAttachmentsForPrompt } from "./fileUpload.js";
import { trackEvent } from "./analytics.js";
export { capability } from "./capability.js";
export { scanPage, fullScan } from "./scanner.js";
export { LocalMemoryStore } from "./localMemory.js";
export { pageActionCapabilities } from "./pageActions.js";
export { ChatHistoryStore, CHAT_HISTORY_STORAGE_KEY } from "./chatHistory.js";
export { getAssistantSettings, setAssistantSettings, DEFAULT_MODELS, ASSISTANT_SETTINGS_STORAGE_KEY, } from "./assistant-settings.js";
export { getVoiceSettings, setVoiceSettings, voiceOptionsFromSettings, ELEVENLABS_VOICES, OPENAI_VOICES, VOICE_SETTINGS_STORAGE_KEY, VOICE_SETTINGS_CHANGE_EVENT, } from "./settings.js";
export { mountVoiceSettingsPanel, openVoiceSettingsModal, closeVoiceSettingsModal, } from "./settings-ui.js";
export { mountAssistantSettingsPanel, openAssistantSettingsModal, closeAssistantSettingsModal, } from "./assistant-settings-ui.js";
export { trackEvent, getLocalAnalytics, exportAnalyticsMarkdown } from "./analytics.js";
export { readFileAttachment, formatAttachmentsForPrompt } from "./fileUpload.js";
class PageAssistantController {
    cfg;
    assistant;
    ui;
    voice;
    history = [];
    chatStore;
    activeChatId = null;
    scanned = false;
    listening = false;
    ttsEnabled;
    pending;
    map;
    settingsKey;
    assistantSettingsKey;
    onSettingsChange;
    onAssistantSettingsChange;
    lastTurn;
    greetedChatId = null;
    notedSttFallback = false;
    destroyed = false;
    constructor(cfg) {
        this.cfg = cfg;
        this.settingsKey = cfg.settingsStorageKey ?? VOICE_SETTINGS_STORAGE_KEY;
        this.assistantSettingsKey = cfg.assistantSettingsStorageKey ?? ASSISTANT_SETTINGS_STORAGE_KEY;
        const assistantSettings = getAssistantSettings(this.assistantSettingsKey);
        const stored = getVoiceSettings(this.settingsKey);
        const useStored = cfg.useVoiceSettings !== false;
        this.ttsEnabled = cfg.autoSpeak ?? (useStored ? stored.autoSpeak : false);
        this.chatStore = new ChatHistoryStore(cfg.chatHistoryStorageKey);
        if (!cfg.disableChatHistory) {
            const active = this.chatStore.getActive();
            if (active) {
                this.activeChatId = active.id;
                this.history = [...active.messages];
            }
            else {
                const created = this.chatStore.create({ model: assistantSettings.model });
                this.activeChatId = created.id;
            }
        }
        const memory = cfg.memory === "session" ? new InMemoryStore() : new LocalMemoryStore();
        const builtins = [
            rememberFactCapability,
            ...pageActionCapabilities(() => this.map, async () => {
                this.map = await fullScan();
                return this.map;
            }),
        ].filter((b) => !cfg.capabilities.some((c) => c.name === b.name));
        this.assistant = new Assistant({
            capabilities: [...cfg.capabilities, ...builtins],
            llm: proxyProvider(cfg.serverUrl, cfg.authToken, () => getAssistantSettings(this.assistantSettingsKey).model, cfg.requestTimeoutMs),
            memory,
            appName: cfg.appName,
            persona: cfg.persona,
            knowledge: cfg.knowledge,
            suggestions: cfg.suggestions,
        });
        if (cfg.voice !== false) {
            let vo;
            if (cfg.voice === true || cfg.voice === undefined) {
                vo = useStored ? voiceOptionsFromSettings(cfg.serverUrl, stored) : { serverUrl: cfg.serverUrl };
            }
            else {
                vo = { serverUrl: cfg.serverUrl, ...cfg.voice };
            }
            if (cfg.authToken)
                vo = { ...vo, authToken: cfg.authToken };
            this.voice = new Voice(vo);
        }
        const settingsUiOpts = {
            storageKey: this.settingsKey,
            settingsPageUrl: cfg.settingsPageUrl,
            title: cfg.appName ? `${cfg.appName} assistant` : "Page assistant",
            chatStore: cfg.disableChatHistory ? undefined : this.chatStore,
            serverUrl: cfg.serverUrl,
            authToken: cfg.authToken,
        };
        this.ui = new WidgetUI(cfg.appName ?? "Assistant", {
            onSend: (t, attachments) => this.handleUser(t, attachments),
            onMic: () => this.toggleMic(),
            onConfirm: (ok) => this.handleConfirm(ok),
            onToggle: (open) => this.handleToggle(open),
            onSettings: () => cfg.onSettings?.() ??
                (cfg.useExtendedSettings !== false
                    ? openAssistantSettingsModal(settingsUiOpts)
                    : openVoiceSettingsModal(settingsUiOpts)),
            onTtsToggle: (on) => {
                this.ttsEnabled = on;
            },
            onNewChat: () => this.newChat(),
            onSelectChat: (id) => this.switchChat(id),
            onExportChat: () => this.exportCurrentChat(),
            onDeleteChat: (id) => this.deleteChat(id),
            onArchiveChat: (id) => this.archiveChat(id),
        }, {
            launcherIcon: cfg.launcherIcon,
            chatStore: cfg.disableChatHistory ? undefined : this.chatStore,
            theme: assistantSettings.theme,
            sidebarOpen: assistantSettings.sidebarOpen,
            imagesEnabled: cfg.imagesEnabled,
        });
        if (this.activeChatId && this.history.length) {
            this.ui.loadMessages(this.displayHistory());
            this.ui.setActiveChat(this.activeChatId);
            this.greetedChatId = this.activeChatId; // don't greet over a restored conversation
        }
        this.ui.setTtsEnabled(this.ttsEnabled);
        this.onSettingsChange = () => {
            if (cfg.useVoiceSettings === false || cfg.voice === false)
                return;
            const s = getVoiceSettings(this.settingsKey);
            this.updateConfig({
                autoSpeak: cfg.autoSpeak ?? s.autoSpeak,
                voice: voiceOptionsFromSettings(cfg.serverUrl, s),
            });
        };
        this.onAssistantSettingsChange = () => {
            const s = getAssistantSettings(this.assistantSettingsKey);
            this.ui.setTheme(s.theme);
            this.ui.setSidebarOpen(s.sidebarOpen);
        };
        window.addEventListener(VOICE_SETTINGS_CHANGE_EVENT, this.onSettingsChange);
        window.addEventListener(ASSISTANT_SETTINGS_CHANGE_EVENT, this.onAssistantSettingsChange);
        // Guard the async HEAD probe: if the widget is destroyed before it resolves, don't
        // append <link>/<meta> to a torn-down page.
        injectDiscoveryHint(cfg.serverUrl, cfg.knowledgeUrl, () => !this.destroyed);
    }
    dispose() {
        window.removeEventListener(VOICE_SETTINGS_CHANGE_EVENT, this.onSettingsChange);
        window.removeEventListener(ASSISTANT_SETTINGS_CHANGE_EVENT, this.onAssistantSettingsChange);
    }
    /** Full teardown for SPA/React strict-mode remounts: listeners, timers, voice, DOM. */
    destroy() {
        this.destroyed = true;
        this.dispose();
        this.voice?.cancelListen(); // stop a hot mic (in-flight listen) before dropping the ref
        this.voice?.stop();
        this.voice = undefined;
        this.pending = undefined;
        // Close any settings modal we may have opened so its shadow host + listeners don't leak.
        closeAssistantSettingsModal();
        closeVoiceSettingsModal();
        this.ui.destroy();
        removeDiscoveryHint();
    }
    updateConfig(patch) {
        if (patch.autoSpeak !== undefined) {
            this.ttsEnabled = patch.autoSpeak;
            this.ui.setTtsEnabled(this.ttsEnabled);
        }
        if (patch.voice !== undefined) {
            if (patch.voice === false) {
                this.voice = undefined;
            }
            else {
                const vo = patch.voice === true
                    ? { serverUrl: this.cfg.serverUrl, authToken: this.cfg.authToken }
                    : { serverUrl: this.cfg.serverUrl, authToken: this.cfg.authToken, ...patch.voice };
                this.voice = new Voice(vo);
            }
        }
    }
    newChat() {
        const model = getAssistantSettings(this.assistantSettingsKey).model;
        const session = this.chatStore.create({ model });
        this.activeChatId = session.id;
        this.history = [];
        this.clearPending();
        this.ui.clearLog();
        this.ui.setActiveChat(session.id);
        this.showGreeting();
        this.track("chat_new", { id: session.id });
    }
    /** Show greeting + suggestions once per empty chat (also fires on New chat). */
    showGreeting() {
        if (this.history.length)
            return;
        if (this.greetedChatId === this.activeChatId)
            return;
        this.greetedChatId = this.activeChatId;
        if (this.cfg.greeting)
            this.ui.addMessage("assistant", this.cfg.greeting);
        if (this.cfg.suggestions?.length) {
            this.ui.addSuggestions(this.cfg.suggestions, (t) => this.handleUser(t));
        }
    }
    clearPending() {
        this.pending = undefined;
        this.ui.removeConfirm();
        this.ui.clearHighlight();
    }
    deleteChat(id) {
        const wasActive = id === this.activeChatId;
        this.chatStore.delete(id);
        if (wasActive) {
            // The active conversation is gone — adopt whatever the store made active, or
            // start fresh, so persistCurrentChat resumes saving instead of no-op'ing forever.
            const next = this.chatStore.getActive();
            if (next) {
                this.activeChatId = next.id;
                this.history = [...next.messages];
                this.clearPending();
                this.ui.clearLog();
                // Use displayHistory() so restored user turns show the collapsed "📎 name" line
                // instead of the raw "--- File: … ---" attachment dump.
                this.ui.loadMessages(this.displayHistory());
                this.ui.setActiveChat(next.id);
            }
            else {
                this.newChat();
            }
        }
    }
    archiveChat(id) {
        const session = this.chatStore.get(id);
        const willArchive = !session?.archived;
        this.chatStore.archive(id, willArchive);
        if (willArchive && id === this.activeChatId) {
            // Archiving the active chat detaches it from `activeId`; re-anchor so saves resume.
            const next = this.chatStore.getActive();
            if (next && next.id !== id) {
                this.switchChat(next.id);
            }
            else {
                this.newChat();
            }
        }
    }
    switchChat(id) {
        const session = this.chatStore.get(id);
        if (!session)
            return;
        this.persistCurrentChat();
        this.activeChatId = id;
        this.chatStore.setActive(id);
        this.history = [...session.messages];
        this.clearPending();
        this.ui.clearLog();
        this.ui.loadMessages(this.displayHistory());
        this.ui.setActiveChat(id);
        this.track("chat_switch", { id });
    }
    persistCurrentChat() {
        if (!this.activeChatId || this.cfg.disableChatHistory)
            return;
        const model = getAssistantSettings(this.assistantSettingsKey).model;
        this.chatStore.saveMessages(this.activeChatId, this.history, { model });
    }
    /** History mapped for display: collapse the raw attachment dump back to a "📎 name" line. */
    displayHistory() {
        return this.history
            .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "system")
            .map((m) => (m.role === "user" ? { ...m, content: stripAttachmentDump(m.content) } : m));
    }
    exportCurrentChat() {
        if (!this.activeChatId)
            return;
        const json = this.chatStore.share(this.activeChatId);
        if (!json)
            return;
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "chat-export.json";
        a.click();
        URL.revokeObjectURL(url);
        this.track("chat_export", { id: this.activeChatId });
    }
    analyticsUrl() {
        const s = getAssistantSettings(this.assistantSettingsKey);
        return s.analyticsEnabled ? this.cfg.serverUrl : undefined;
    }
    track(type, meta) {
        // Forward the bearer token so analytics survive on servers that guard /v1/analytics.
        trackEvent(type, meta, this.analyticsUrl(), this.cfg.authToken);
    }
    async handleToggle(open) {
        if (!open) {
            this.voice?.stop();
            this.persistCurrentChat();
            return;
        }
        if (this.scanned)
            return;
        this.scanned = true;
        this.track("widget_open", {});
        this.showGreeting();
        if (this.cfg.knowledgeUrl) {
            try {
                const url = new URL(this.cfg.knowledgeUrl, location.href);
                if (url.origin !== location.origin) {
                    this.ui.addMessage("system", "Skipped knowledge fetch: cross-origin URLs are not allowed.");
                }
                else {
                    const res = await fetch(url.href);
                    if (res.ok)
                        this.assistant.setKnowledge((await res.text()).slice(0, 6000));
                }
            }
            catch {
                /* best-effort */
            }
        }
        if (this.cfg.autoScan !== false) {
            this.ui.setState("scanning");
            this.ui.addMessage("system", "Reading this app…");
            try {
                this.map = await fullScan();
            }
            catch {
                this.map = { scannedAt: new Date().toISOString(), pages: [], controls: scanPage() };
            }
            this.ui.setState("idle");
            this.ui.addMessage("system", `Ready — mapped ${this.map?.pages.length ?? 0} pages, ${this.map?.controls.length ?? 0} controls.`);
        }
    }
    pageContext() {
        return {
            url: location.href,
            path: location.pathname,
            title: document.title,
            state: this.cfg.getPageState?.(),
            map: this.map,
        };
    }
    async handleUser(text, attachments) {
        if (this.pending) {
            // A new message supersedes a stale pending confirmation — clear its live buttons.
            this.clearPending();
            this.ui.addMessage("system", "Previous pending action cancelled.");
        }
        const message = formatAttachmentsForPrompt(text, attachments ?? []);
        if (!message.trim())
            return;
        this.lastTurn = { text, attachments };
        this.ui.addMessage("user", text + (attachments?.length ? `\n📎 ${attachments.map((a) => a.name).join(", ")}` : ""));
        this.ui.setState("thinking");
        this.ui.setBusy(true);
        try {
            const res = await this.assistant.chat({ message, page: this.pageContext(), history: this.history });
            this.history.push({ role: "user", content: message }, { role: "assistant", content: res.message });
            this.persistCurrentChat();
            if (res.pendingConfirmation) {
                this.pending = { name: res.pendingConfirmation.name, args: res.pendingConfirmation.args };
                // Prefer the readable assistant message; the visual highlight ring is the real
                // "show me before you do it" arg disclosure. Only fall back to a HUMAN-READABLE
                // arg summary (e.g. "Pricing"), never the raw `open_page_link({"label":"Pricing"})`.
                const previewText = res.message ||
                    readableArgs(res.pendingConfirmation.args) ||
                    res.pendingConfirmation.preview ||
                    res.pendingConfirmation.name;
                this.showActionPreview(res.pendingConfirmation.name, res.pendingConfirmation.args);
                this.ui.addConfirm(previewText);
                this.ui.setState("idle");
                this.ui.setBusy(false);
                return;
            }
            this.ui.setBusy(false);
            this.ui.addMessage("assistant", res.message);
            await this.say(res.message);
            this.track("message_sent", { len: message.length });
        }
        catch (e) {
            this.ui.setBusy(false);
            this.ui.setState("idle");
            this.showFriendlyError(e, () => this.retryLastTurn());
        }
    }
    retryLastTurn() {
        if (!this.lastTurn)
            return;
        const { text, attachments } = this.lastTurn;
        this.handleUser(text, attachments);
    }
    /** Map any error to a plain-English message + retry affordance. */
    showFriendlyError(e, onRetry) {
        let msg = "Something went wrong, please try again.";
        if (e instanceof ProxyError) {
            switch (true) {
                case e.status === 0:
                    msg = "Can't reach the assistant — check your connection and try again.";
                    break;
                case e.status === 401 || e.status === 403:
                    msg = "The assistant isn't configured correctly.";
                    break;
                case e.status === 429:
                    msg = "The assistant is busy — try again in a moment.";
                    break;
                case e.status >= 500:
                    msg = "The assistant had a problem — try again.";
                    break;
            }
        }
        else if (e instanceof TypeError) {
            msg = "Can't reach the assistant — check your connection and try again.";
        }
        this.ui.addError(msg, onRetry);
    }
    /** Highlight the on-page control a confirm-gated action will operate. Defensive. */
    showActionPreview(name, args) {
        this.ui.clearHighlight();
        const selector = this.resolveActionSelector(name, args);
        if (selector)
            this.ui.highlightElement(selector);
    }
    /** Resolve a scanner selector for the control an action targets (undefined if none). */
    resolveActionSelector(name, args) {
        if (typeof args.selector === "string")
            return args.selector;
        // open_page_link targets a control by its visible label — reuse the scan map's selector.
        const label = typeof args.label === "string" ? args.label.trim().toLowerCase() : undefined;
        if (label && this.map) {
            const hit = this.map.controls.find((c) => c.label.trim().toLowerCase() === label);
            if (hit)
                return hit.selector;
        }
        return undefined;
    }
    async handleConfirm(approved) {
        this.ui.clearHighlight();
        if (!approved || !this.pending) {
            this.pending = undefined;
            this.ui.addMessage("system", "Cancelled.");
            return;
        }
        const pending = this.pending;
        this.ui.setState("thinking");
        this.ui.setBusy(true);
        try {
            const res = await this.assistant.confirmAndRun(pending.name, pending.args, this.pageContext());
            this.history.push({ role: "assistant", content: res.message });
            this.persistCurrentChat();
            this.ui.setBusy(false);
            this.ui.addMessage("assistant", res.message);
            await this.say(res.message);
        }
        catch (e) {
            this.ui.setBusy(false);
            this.ui.setState("idle");
            this.showFriendlyError(e, () => {
                this.pending = pending;
                this.handleConfirm(true);
            });
        }
        finally {
            this.pending = undefined;
        }
    }
    async say(text) {
        if (!this.voice || !this.ttsEnabled) {
            this.ui.setState("idle");
            return;
        }
        this.ui.setState("talking");
        try {
            await this.voice.speak(text);
        }
        catch {
            /* TTS failure must not freeze mascot */
        }
        this.ui.setState("idle");
    }
    async toggleMic() {
        if (!this.voice) {
            this.ui.addMessage("system", "Voice is off for this app.");
            return;
        }
        // Second tap cancels an in-flight listen instead of being a no-op (was stuck up to 12s).
        if (this.listening) {
            this.voice.cancelListen();
            return;
        }
        this.listening = true;
        this.ui.setMic(true);
        this.ui.setState("listening");
        let text = "";
        try {
            text = await this.voice.listenOnce({
                onCaptureStart: () => this.ui.setMicCountdown(4),
                onCountdown: (msRemaining) => this.ui.setMicCountdown(msRemaining / 1000),
                onServerFallback: () => {
                    if (this.notedSttFallback)
                        return;
                    this.notedSttFallback = true;
                    this.ui.addMessage("system", "Server voice isn't available here — using your browser's microphone instead.");
                },
            });
        }
        catch (e) {
            if (e instanceof VoiceError) {
                const map = {
                    "no-speech": "I didn't catch that — tap the mic and try again.",
                    "not-allowed": "Microphone permission denied. Allow mic access in your browser to use voice.",
                    "no-mic": "No microphone was found.",
                    other: "I couldn't access the microphone.",
                };
                this.ui.addMessage("system", map[e.reason] ?? map.other);
            }
            else {
                this.ui.addMessage("system", "I couldn't access the microphone.");
            }
        }
        finally {
            this.listening = false;
            this.ui.setMic(false);
            this.ui.setMicCountdown(null);
            this.ui.setState("idle");
        }
        if (text.trim())
            this.handleUser(text.trim());
    }
}
let instance;
export const PageAssistant = {
    init(cfg) {
        if (instance)
            return instance;
        instance = new PageAssistantController(cfg);
        return instance;
    },
    configure(patch) {
        instance?.updateConfig(patch);
    },
    /** Tear down the widget entirely (listeners, timers, shadow host, injected nodes). */
    destroy() {
        instance?.destroy();
        instance = undefined;
    },
    openVoiceSettings: openVoiceSettingsModal,
    closeVoiceSettings: closeVoiceSettingsModal,
    mountVoiceSettingsPanel,
    openAssistantSettings: openAssistantSettingsModal,
    closeAssistantSettings: closeAssistantSettingsModal,
    mountAssistantSettingsPanel,
};
async function injectDiscoveryHint(serverUrl, knowledgeUrl, isAlive = () => true) {
    if (typeof document === "undefined" || document.querySelector('link[rel="llm"]'))
        return;
    const base = (serverUrl || "").replace(/\/$/, "");
    const href = knowledgeUrl || `${base}/llm.txt`;
    // Only advertise the discovery hint when the resource actually exists — a widget-only
    // deployment (no server) would otherwise publish a <link>/<meta> pointing at a 404.
    try {
        const res = await fetch(href, { method: "HEAD" });
        if (!res.ok)
            return;
    }
    catch {
        return; // unreachable → don't advertise
    }
    // The HEAD round-trip is async — bail if the widget was destroyed while it was in flight.
    if (!isAlive())
        return;
    const link = document.createElement("link");
    link.rel = "llm";
    link.href = href;
    link.dataset.paDiscovery = "1";
    document.head.appendChild(link);
    const meta = document.createElement("meta");
    meta.name = "llm-actions";
    meta.content = `${base}/.well-known/llm-actions.json`;
    meta.dataset.paDiscovery = "1";
    document.head.appendChild(meta);
}
function removeDiscoveryHint() {
    if (typeof document === "undefined")
        return;
    document.querySelectorAll('[data-pa-discovery="1"]').forEach((n) => n.remove());
}
/** Turn action args into a readable one-liner (e.g. "Pricing") — never raw JSON. */
function readableArgs(args) {
    const preferred = ["label", "name", "title", "text", "query", "value"];
    for (const k of preferred) {
        const v = args[k];
        if (typeof v === "string" && v.trim())
            return v.trim();
    }
    const first = Object.values(args).find((v) => typeof v === "string" && v.trim());
    return typeof first === "string" ? first.trim() : "";
}
/** Collapse the raw "--- File: … ---" / image data-URL dump back to a compact "📎 name" line. */
function stripAttachmentDump(content) {
    const fileIdx = content.indexOf("\n\n--- File: ");
    const imgIdx = content.indexOf('\n\n[Attached image');
    const idx = [fileIdx, imgIdx].filter((i) => i >= 0).sort((a, b) => a - b)[0];
    if (idx === undefined)
        return content;
    const head = content.slice(0, idx);
    const names = [];
    const re = /--- File: (.+?) ---|\[Attached image "(.+?)"/g;
    let m;
    while ((m = re.exec(content)))
        names.push(m[1] ?? m[2]);
    return head + (names.length ? `\n📎 ${names.join(", ")}` : "");
}
if (typeof window !== "undefined")
    window.PageAssistant = PageAssistant;
