// Every user-facing string the widget chrome renders, in one flat map so a host running a
// non-English app can hand over translations. Deliberately NOT an i18n framework: no
// locale negotiation, no plural rules, no message files. The host already knows what
// language it is in — it passes the strings it wants and keeps the English default for
// the rest.
//
// Two keys take a placeholder: {title} (the app name) and {name} (an attachment filename).
export const DEFAULT_STRINGS = {
    launcherOpen: "Open {title}",
    close: "Close assistant",
    settings: "Assistant settings",
    exportChat: "Export chat",
    historyToggle: "Toggle chat history",
    attach: "Attach file",
    removeAttachment: "Remove attachment {name}",
    inputPlaceholder: "Ask or tell me to do something…",
    inputLabel: "Message the assistant",
    send: "Send message",
    mic: "Speak to the assistant",
    micStop: "Stop listening",
    micUnavailable: "Voice input isn't available in this browser.",
    readAloud: "Read replies aloud",
    readAloudOn: "Read replies aloud (on)",
    readAloudOff: "Read replies aloud (off)",
    thinking: "Assistant is thinking",
    confirm: "Confirm",
    cancel: "Cancel",
    retry: "Retry",
    suggestionsLabel: "Try:",
    copied: "Chat JSON copied to clipboard",
    copyFailed: "Couldn't copy to clipboard",
    scanning: "Reading this app…",
    scanReady: "Ready.",
    voiceOff: "Voice is off for this app.",
    voiceNoSpeech: "I didn't catch that — tap the mic and try again.",
    voiceNotAllowed: "Microphone permission denied. Allow mic access in your browser to use voice.",
    voiceNoMic: "No microphone was found.",
    voiceError: "I couldn't access the microphone.",
    voiceServerFallback: "Server voice isn't available here — using your browser's microphone instead.",
    voiceBrowserFallback: "Your browser's speech recognition isn't working here — using server transcription instead.",
};
/** Merge host overrides over the English defaults. Empty/blank overrides are ignored. */
export function resolveStrings(overrides) {
    if (!overrides)
        return { ...DEFAULT_STRINGS };
    const out = { ...DEFAULT_STRINGS };
    for (const [k, v] of Object.entries(overrides)) {
        if (typeof v === "string" && v.trim())
            out[k] = v;
    }
    return out;
}
/** Substitute `{token}` placeholders. Unknown tokens are left alone. */
export function fmt(template, vars) {
    return template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}
