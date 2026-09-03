export interface VoiceSettingsUIOptions {
    storageKey?: string;
    /** Optional link shown in the modal footer (e.g. host app settings page). */
    settingsPageUrl?: string;
    title?: string;
}
/** Embed the voice settings form in a host container (e.g. app settings page). Returns cleanup. */
export declare function mountVoiceSettingsPanel(container: HTMLElement, opts?: VoiceSettingsUIOptions): () => void;
/** Open the built-in voice settings modal. */
export declare function openVoiceSettingsModal(opts?: VoiceSettingsUIOptions): void;
export declare function closeVoiceSettingsModal(): void;
