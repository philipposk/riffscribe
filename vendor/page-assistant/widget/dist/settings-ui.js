// Self-contained voice settings panel + modal (shadow DOM, no host CSS required).
import { ELEVENLABS_VOICES, OPENAI_VOICES, VOICE_SETTINGS_CHANGE_EVENT, VOICE_SETTINGS_STORAGE_KEY, getVoiceSettings, setVoiceSettings, } from "./settings.js";
import { DEFAULT_STRINGS, resolveStrings } from "./strings.js";
import { panelStyle } from "./settings-ui-shared.js";
import { ASSISTANT_SETTINGS_CHANGE_EVENT, ASSISTANT_SETTINGS_STORAGE_KEY, getAssistantSettings } from "./assistant-settings.js";
function renderForm(root, storageKey, s = DEFAULT_STRINGS) {
    root.innerHTML = "";
    const wrap = el("div", "wrap");
    const hint = el("p", "hint");
    hint.textContent = s.settingsVoiceHintLong;
    wrap.appendChild(hint);
    const addRow = (label, field) => {
        const row = el("div", "row");
        const lab = el("span", "label");
        lab.textContent = label;
        row.append(lab, field);
        wrap.appendChild(row);
    };
    const speakLabel = el("label", "check field");
    const speakCb = el("input");
    speakCb.type = "checkbox";
    const speakText = el("span");
    const refreshSpeak = () => {
        const vs = getVoiceSettings(storageKey);
        speakCb.checked = vs.autoSpeak;
        speakText.textContent = vs.autoSpeak ? s.settingsReadAloudOn : s.settingsReadAloudOff;
    };
    speakCb.onchange = () => {
        setVoiceSettings({ autoSpeak: speakCb.checked }, storageKey);
        refreshSpeak();
    };
    speakLabel.append(speakCb, speakText);
    refreshSpeak();
    addRow(s.settingsReadAloud, speakLabel);
    const ttsSel = el("select", "field");
    ttsSel.innerHTML =
        `<option value="browser">${escapeHtml(s.optionBrowserRobotic)}</option>` +
            `<option value="server">${escapeHtml(s.optionServerTtsNamed)}</option>`;
    addRow(s.settingsSpeechEngine, ttsSel);
    const serverBlock = el("div");
    wrap.appendChild(serverBlock);
    const renderServerRows = () => {
        const vs = getVoiceSettings(storageKey);
        ttsSel.value = vs.ttsMode;
        serverBlock.innerHTML = "";
        if (vs.ttsMode !== "server")
            return;
        const provRow = el("div", "row");
        provRow.innerHTML = `<span class="label">${escapeHtml(s.settingsTtsProvider)}</span>`;
        const provSel = el("select", "field");
        provSel.innerHTML =
            `<option value="elevenlabs">${escapeHtml(s.providerElevenLabsRecommended)}</option>` +
                `<option value="openai">${escapeHtml(s.providerOpenAiTts)}</option>`;
        provSel.value = vs.ttsProvider;
        provSel.onchange = () => {
            setVoiceSettings({ ttsProvider: provSel.value }, storageKey);
            renderServerRows();
        };
        provRow.appendChild(provSel);
        serverBlock.appendChild(provRow);
        const voiceRow = el("div", "row");
        voiceRow.innerHTML = `<span class="label">${escapeHtml(s.settingsVoiceName)}</span>`;
        const voiceSel = el("select", "field");
        const list = vs.ttsProvider === "elevenlabs" ? ELEVENLABS_VOICES : OPENAI_VOICES;
        voiceSel.innerHTML = list.map((v) => `<option value="${v.id}">${escapeHtml(v.label)}</option>`).join("");
        voiceSel.value = vs.ttsProvider === "elevenlabs" ? vs.elevenLabsVoiceId : vs.openaiVoice;
        voiceSel.onchange = () => {
            if (getVoiceSettings(storageKey).ttsProvider === "elevenlabs") {
                setVoiceSettings({ elevenLabsVoiceId: voiceSel.value }, storageKey);
            }
            else {
                setVoiceSettings({ openaiVoice: voiceSel.value }, storageKey);
            }
        };
        voiceRow.appendChild(voiceSel);
        serverBlock.appendChild(voiceRow);
    };
    ttsSel.onchange = () => {
        setVoiceSettings({ ttsMode: ttsSel.value }, storageKey);
        renderServerRows();
    };
    renderServerRows();
    const sttSel = el("select", "field");
    sttSel.innerHTML =
        `<option value="browser">${escapeHtml(s.optionBrowserFree)}</option>` +
            `<option value="server">${escapeHtml(s.optionServerWhisperNamed)}</option>`;
    sttSel.value = getVoiceSettings(storageKey).sttMode;
    sttSel.onchange = () => {
        setVoiceSettings({ sttMode: sttSel.value }, storageKey);
    };
    addRow(s.settingsMicInput, sttSel);
    root.appendChild(wrap);
    const onExternal = () => {
        refreshSpeak();
        renderServerRows();
        sttSel.value = getVoiceSettings(storageKey).sttMode;
    };
    window.addEventListener(VOICE_SETTINGS_CHANGE_EVENT, onExternal);
    return () => window.removeEventListener(VOICE_SETTINGS_CHANGE_EVENT, onExternal);
}
/** Embed the voice settings form in a host container (e.g. app settings page). Returns cleanup. */
export function mountVoiceSettingsPanel(container, opts = {}) {
    const storageKey = opts.storageKey ?? VOICE_SETTINGS_STORAGE_KEY;
    const strings = resolveStrings(opts.strings);
    const host = document.createElement("div");
    container.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    const applyTheme = () => {
        style.textContent = panelStyle(getAssistantSettings(ASSISTANT_SETTINGS_STORAGE_KEY).theme);
    };
    applyTheme();
    shadow.appendChild(style);
    // Follow the host's light/dark choice live, including a "system" flip.
    window.addEventListener(ASSISTANT_SETTINGS_CHANGE_EVENT, applyTheme);
    const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: light)") : undefined;
    media?.addEventListener?.("change", applyTheme);
    const formRoot = el("div");
    shadow.appendChild(formRoot);
    const cleanupForm = renderForm(formRoot, storageKey, strings);
    return () => {
        cleanupForm();
        window.removeEventListener(ASSISTANT_SETTINGS_CHANGE_EVENT, applyTheme);
        media?.removeEventListener?.("change", applyTheme);
        host.remove();
    };
}
let modalHost;
/** Open the built-in voice settings modal. */
export function openVoiceSettingsModal(opts = {}) {
    closeVoiceSettingsModal();
    const storageKey = opts.storageKey ?? VOICE_SETTINGS_STORAGE_KEY;
    const s = resolveStrings(opts.strings);
    const title = opts.title ?? "Page assistant";
    modalHost = document.createElement("div");
    document.body.appendChild(modalHost);
    const shadow = modalHost.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    const applyTheme = () => {
        style.textContent = panelStyle(getAssistantSettings(ASSISTANT_SETTINGS_STORAGE_KEY).theme);
    };
    applyTheme();
    shadow.appendChild(style);
    window.addEventListener(ASSISTANT_SETTINGS_CHANGE_EVENT, applyTheme);
    const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: light)") : undefined;
    media?.addEventListener?.("change", applyTheme);
    const backdrop = el("div", "modal-backdrop");
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-label", title);
    backdrop.onclick = (e) => {
        if (e.target === backdrop)
            closeVoiceSettingsModal();
    };
    const modal = el("div", "modal");
    modal.onclick = (e) => e.stopPropagation();
    const head = el("div", "modal-head");
    const h2 = el("h2");
    h2.textContent = title;
    const closeBtn = el("button", "btn btn-ghost");
    closeBtn.textContent = "×";
    closeBtn.setAttribute("aria-label", s.close);
    closeBtn.onclick = () => closeVoiceSettingsModal();
    head.append(h2, closeBtn);
    const formRoot = el("div");
    const cleanupForm = renderForm(formRoot, storageKey, s);
    const foot = el("div", "modal-foot");
    if (opts.settingsPageUrl) {
        const link = el("a", "link");
        link.href = opts.settingsPageUrl;
        link.textContent = s.settingsAllSettingsLink;
        link.onclick = () => closeVoiceSettingsModal();
        foot.appendChild(link);
    }
    const done = el("button", "btn btn-primary");
    done.textContent = s.settingsDone;
    done.onclick = () => closeVoiceSettingsModal();
    foot.appendChild(done);
    modal.append(head, formRoot, foot);
    backdrop.appendChild(modal);
    shadow.appendChild(backdrop);
    const prevCleanup = modalHost._cleanup;
    modalHost._cleanup = () => {
        cleanupForm();
        window.removeEventListener(ASSISTANT_SETTINGS_CHANGE_EVENT, applyTheme);
        media?.removeEventListener?.("change", applyTheme);
        prevCleanup?.();
    };
}
export function closeVoiceSettingsModal() {
    if (!modalHost)
        return;
    modalHost._cleanup?.();
    modalHost.remove();
    modalHost = undefined;
}
function el(tag, cls) {
    const e = document.createElement(tag);
    if (cls)
        e.className = cls;
    return e;
}
function escapeHtml(s) {
    return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
