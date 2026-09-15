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
    actionCancelled: "Cancelled.",
    pendingActionCancelled: "Previous pending action cancelled.",
    knowledgeCrossOriginSkipped: "Skipped knowledge fetch: cross-origin URLs are not allowed.",
    sidebarSearch: "Search chats…",
    sidebarCollapse: "Collapse sidebar",
    sidebarNewChat: "+ New chat",
    sidebarNewChatLabel: "Start a new chat",
    sidebarShowMore: "Show {count} more…",
    sidebarEmpty: "No chats yet",
    sidebarPinned: "Pinned",
    sidebarRecent: "Recent",
    sidebarArchived: "Archived",
    sidebarChatActions: 'Actions for "{title}"',
    menuRename: "Rename",
    menuFork: "Fork",
    menuPin: "Pin",
    menuUnpin: "Unpin",
    menuMarkUnread: "Mark unread",
    menuShare: "Share (copy JSON)",
    menuArchive: "Archive",
    menuUnarchive: "Unarchive",
    menuDelete: "Delete",
    renameChatPrompt: "Rename chat:",
    deleteChatConfirm: 'Delete "{title}"? This can\'t be undone.',
    settingsTitle: "Assistant settings",
    settingsDone: "Done",
    settingsAllSettingsLink: "All settings →",
    settingsTabGeneral: "General",
    settingsTabVoice: "Voice",
    settingsTabData: "Data",
    settingsModel: "Model",
    modelServerDefault: "Server default (recommended)",
    modelFixedNote: "The model is chosen by this site and cannot be changed here.",
    modelProviderNote: "Models depend on the server's configured providers — an unsupported one will error when you send.",
    settingsTheme: "Theme",
    themeDark: "Dark",
    themeLight: "Light",
    themeSystem: "System",
    settingsSidebar: "Chat sidebar",
    settingsSidebarDefaultOpen: "Show history sidebar by default",
    settingsAnalytics: "Analytics",
    settingsAnalyticsOptIn: "Send anonymous usage events to server",
    settingsVoiceHint: "Voice settings apply to read-aloud and microphone input.",
    settingsVoiceHintLong: "Text replies are free. Read-aloud uses your browser or the server (ElevenLabs / OpenAI). Mic defaults to the free browser recognizer; server Whisper costs per minute.",
    settingsReadAloud: "Read aloud",
    settingsReadAloudOn: "On",
    settingsReadAloudOff: "Off — text only (default)",
    settingsSpeechEngine: "Speech engine",
    settingsMicInput: "Mic input",
    settingsTtsProvider: "TTS provider",
    settingsVoiceName: "Voice",
    optionBrowserFree: "Browser (free)",
    optionBrowserRobotic: "Browser (free, robotic)",
    optionServerTts: "Server TTS",
    optionServerTtsNamed: "Server — ElevenLabs / OpenAI",
    optionServerWhisper: "Server Whisper",
    optionServerWhisperNamed: "Server — Whisper",
    providerElevenLabs: "ElevenLabs",
    providerElevenLabsRecommended: "ElevenLabs (recommended)",
    providerOpenAiTts: "OpenAI TTS",
    suffixNotConfigured: " (not configured)",
    suffixNoServerKey: " (no server key)",
    voiceNoteNoServerKeys: "This server has no voice keys configured, so only the free browser voice and mic are available. Server TTS/STT (ElevenLabs · OpenAI · Whisper) are greyed out.",
    voiceNoteSavedUnavailable: "A saved option isn't available on this server and will fall back to the browser. Greyed-out choices need a server API key.",
    voiceNoteSomeGreyed: "Greyed-out server options aren't configured on this server; the browser handles them for free.",
    settingsDataHint: "Export your chats to a file, or import a backup.",
    settingsExportChats: "Export all chats (JSON)",
    settingsImportChats: "Import chats…",
    settingsImportOk: "Imported successfully",
    settingsImportFailed: "Invalid backup file",
    settingsHistory: "Chat history",
    historyModeAccount: "Save to my account",
    historyModeAccountHint: "Your chats are kept with your account, so they're there on any device you sign in on.",
    historyModeDevice: "Save on this device",
    historyModeDeviceHint: "Your chats stay in this browser only. They aren't saved to your account.",
    historyModeOff: "Don't save",
    historyModeOffHint: "Chats disappear when you reload or close the page.",
    historyRetention: "Saved chats are deleted after {months} months without activity.",
    historyAccountNoAdapter: "Saving to your account isn't available here.",
    historyAccountSignedOut: "Sign in to save chats to your account.",
    historyMovePrompt: "Your chats saved on this device: {count}. Move them to your account too?\n\nOK moves them. Cancel leaves them on this device only.",
    historyMoveOffer: "Your chats saved only on this device: {count}.",
    historyMoveButton: "Move them to my account",
    historyMoveDone: "Moved to your account: {count}.",
    historyMoveFailed: "Some chats couldn't be moved and are still on this device.",
    historyMoveSignedOutOffer: "Chats made while signed out on this device: {count}. Anyone using this browser could have made them, so move them only if they're yours.",
    historyMoveSignedOutToDeviceButton: "Add them to my chats",
    historyMoveSignedOutToDeviceDone: "Added to your chats: {count}.",
    historyAccountKept: "Chats already saved to your account stay there until you delete them.",
    historyDeleteAll: "Delete all my chats",
    historyDeleteAllConfirm: "Delete all your chats on this device? This can't be undone.",
    historyDeleteAllConfirmAccount: "Delete all your chats, on this device and in your account? This can't be undone.",
    historyDeleteDone: "All your chats were deleted.",
    historyDeleteFailed: "Couldn't delete the chats in your account. Please try again.",
    historyLoading: "Loading your saved chats…",
    historyLoadFailed: "Couldn't load your saved chats.",
    historySaveFailed: "Couldn't save to your account. It will try again.",
    historyRetry: "Try again",
    historyChatUnavailable: "Couldn't open that chat. Please try again.",
};
/**
 * Merge host overrides over the English defaults.
 *
 * Every key is optional in both directions, deliberately: a host written against an older
 * SDK has never heard of the keys added since, and those simply keep their English default
 * rather than rendering `undefined`. A host that passes a key this version has dropped is
 * ignored rather than throwing. Blank and non-string values are ignored too, so a
 * half-finished translation file cannot blank out a button.
 */
export function resolveStrings(overrides) {
    if (!overrides)
        return { ...DEFAULT_STRINGS };
    const out = { ...DEFAULT_STRINGS };
    for (const [k, v] of Object.entries(overrides)) {
        if (!(k in DEFAULT_STRINGS))
            continue; // unknown key: ignore, never throw
        if (typeof v === "string" && v.trim())
            out[k] = v;
    }
    return out;
}
/** Substitute `{token}` placeholders. Unknown tokens are left alone. */
export function fmt(template, vars) {
    return template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}
