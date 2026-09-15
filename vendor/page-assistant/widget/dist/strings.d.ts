export interface WidgetStrings {
    /** Launcher aria-label. `{title}` is the appName. */
    launcherOpen: string;
    close: string;
    settings: string;
    exportChat: string;
    historyToggle: string;
    attach: string;
    /** `{name}` is the attachment filename. */
    removeAttachment: string;
    inputPlaceholder: string;
    inputLabel: string;
    send: string;
    mic: string;
    micStop: string;
    /** Shown on a mic button that is rendered disabled because nothing can back it. */
    micUnavailable: string;
    readAloud: string;
    readAloudOn: string;
    readAloudOff: string;
    thinking: string;
    confirm: string;
    cancel: string;
    retry: string;
    suggestionsLabel: string;
    copied: string;
    copyFailed: string;
    scanning: string;
    scanReady: string;
    voiceOff: string;
    voiceNoSpeech: string;
    voiceNotAllowed: string;
    voiceNoMic: string;
    voiceError: string;
    voiceServerFallback: string;
    voiceBrowserFallback: string;
    actionCancelled: string;
    pendingActionCancelled: string;
    knowledgeCrossOriginSkipped: string;
    sidebarSearch: string;
    sidebarCollapse: string;
    /** Visible text of the new-chat button. */
    sidebarNewChat: string;
    /** aria-label for the same button ("+ New chat" reads badly aloud). */
    sidebarNewChatLabel: string;
    /** `{count}` more collapsed chats. */
    sidebarShowMore: string;
    sidebarEmpty: string;
    sidebarPinned: string;
    sidebarRecent: string;
    sidebarArchived: string;
    /** aria-label of a chat's ⋯ button. `{title}` is the chat title. */
    sidebarChatActions: string;
    menuRename: string;
    menuFork: string;
    menuPin: string;
    menuUnpin: string;
    menuMarkUnread: string;
    menuShare: string;
    menuArchive: string;
    menuUnarchive: string;
    menuDelete: string;
    /** Native prompt() title when renaming. */
    renameChatPrompt: string;
    /** Native confirm() text before deleting. `{title}` is the chat title. */
    deleteChatConfirm: string;
    settingsTitle: string;
    settingsDone: string;
    settingsAllSettingsLink: string;
    settingsTabGeneral: string;
    settingsTabVoice: string;
    settingsTabData: string;
    settingsModel: string;
    /** The "let the server decide" option at the top of the model picker. */
    modelServerDefault: string;
    /** Shown INSTEAD of the picker when the model is not the user's to choose. */
    modelFixedNote: string;
    /** Shown under the picker when it IS shown. */
    modelProviderNote: string;
    settingsTheme: string;
    themeDark: string;
    themeLight: string;
    themeSystem: string;
    settingsSidebar: string;
    settingsSidebarDefaultOpen: string;
    settingsAnalytics: string;
    settingsAnalyticsOptIn: string;
    settingsVoiceHint: string;
    /** The standalone voice modal's longer opening hint. */
    settingsVoiceHintLong: string;
    settingsReadAloud: string;
    settingsReadAloudOn: string;
    settingsReadAloudOff: string;
    settingsSpeechEngine: string;
    settingsMicInput: string;
    settingsTtsProvider: string;
    settingsVoiceName: string;
    optionBrowserFree: string;
    optionBrowserRobotic: string;
    optionServerTts: string;
    optionServerTtsNamed: string;
    optionServerWhisper: string;
    optionServerWhisperNamed: string;
    providerElevenLabs: string;
    providerElevenLabsRecommended: string;
    providerOpenAiTts: string;
    /** Appended to an option the server has no key for. */
    suffixNotConfigured: string;
    suffixNoServerKey: string;
    voiceNoteNoServerKeys: string;
    voiceNoteSavedUnavailable: string;
    voiceNoteSomeGreyed: string;
    settingsDataHint: string;
    settingsExportChats: string;
    settingsImportChats: string;
    settingsImportOk: string;
    settingsImportFailed: string;
    settingsHistory: string;
    historyModeAccount: string;
    historyModeAccountHint: string;
    historyModeDevice: string;
    historyModeDeviceHint: string;
    historyModeOff: string;
    historyModeOffHint: string;
    /** `{months}` is the adapter's `retentionMonths`. Shown only when the adapter sets it. */
    historyRetention: string;
    historyAccountNoAdapter: string;
    historyAccountSignedOut: string;
    /** Native confirm() when switching to account with chats on this device. `{count}` chats. */
    historyMovePrompt: string;
    /** `{count}` of the signed-in user's own chats still only in this browser, while in account mode. */
    historyMoveOffer: string;
    historyMoveButton: string;
    /** `{count}` chats moved. */
    historyMoveDone: string;
    historyMoveFailed: string;
    /**
     * `{count}` chats made in this browser while nobody was signed in, offered to a signed-in
     * user. Must say plainly that they may not be this user's.
     */
    historyMoveSignedOutOffer: string;
    /** Device mode: take the signed-out chats into the user's own chats on this device. */
    historyMoveSignedOutToDeviceButton: string;
    /** `{count}` signed-out chats added to the user's own device chats. */
    historyMoveSignedOutToDeviceDone: string;
    historyAccountKept: string;
    historyDeleteAll: string;
    historyDeleteAllConfirm: string;
    /** Used instead of historyDeleteAllConfirm when the account's chats go too. */
    historyDeleteAllConfirmAccount: string;
    historyDeleteDone: string;
    historyDeleteFailed: string;
    historyLoading: string;
    historyLoadFailed: string;
    historySaveFailed: string;
    historyRetry: string;
    /** Toast when a saved chat could not be fetched to open it. */
    historyChatUnavailable: string;
    /**
     * Toast when a reply arrives after the chat it was for was left: another chat opened, or
     * someone signed out or in. The reply is not shown or saved. Seen by whoever is at the page
     * now, so it says nothing about the question.
     */
    historyReplyDiscarded: string;
}
export declare const DEFAULT_STRINGS: WidgetStrings;
/**
 * Merge host overrides over the English defaults.
 *
 * Every key is optional in both directions, deliberately: a host written against an older
 * SDK has never heard of the keys added since, and those simply keep their English default
 * rather than rendering `undefined`. A host that passes a key this version has dropped is
 * ignored rather than throwing. Blank and non-string values are ignored too, so a
 * half-finished translation file cannot blank out a button.
 */
export declare function resolveStrings(overrides?: Partial<WidgetStrings>): WidgetStrings;
/** Substitute `{token}` placeholders. Unknown tokens are left alone. */
export declare function fmt(template: string, vars: Record<string, string>): string;
