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
}
export declare const DEFAULT_STRINGS: WidgetStrings;
/** Merge host overrides over the English defaults. Empty/blank overrides are ignored. */
export declare function resolveStrings(overrides?: Partial<WidgetStrings>): WidgetStrings;
/** Substitute `{token}` placeholders. Unknown tokens are left alone. */
export declare function fmt(template: string, vars: Record<string, string>): string;
