import type { VoiceOptions } from "./voice.js";
export type TtsMode = "browser" | "server";
export type TtsProvider = "elevenlabs" | "openai";
export type SttMode = "browser" | "server";
export type VoiceSettings = {
    /** When true, assistant reads replies aloud. Off by default (text only, free). */
    autoSpeak: boolean;
    ttsMode: TtsMode;
    ttsProvider: TtsProvider;
    elevenLabsVoiceId: string;
    openaiVoice: string;
    /** Mic input: browser SpeechRecognition (free) or server Whisper (paid). */
    sttMode: SttMode;
};
export declare const VOICE_SETTINGS_STORAGE_KEY = "page_assistant_voice_settings";
export declare const VOICE_SETTINGS_CHANGE_EVENT = "pa-voice-settings-change";
/**
 * What the server can actually do, reported by `GET {serverUrl}/v1/voice/capabilities`.
 * Lets the settings UI grey out options the server has no key for, so the user never
 * picks "Rachel" and silently hears the robotic browser voice.
 */
export type VoiceCapabilities = {
    tts: {
        server: boolean;
        providers: TtsProvider[];
    };
    stt: {
        server: boolean;
    };
};
/** Assume browser-only when the endpoint is missing or unreachable — never crash. */
export declare const BROWSER_ONLY_CAPABILITIES: VoiceCapabilities;
/**
 * Fetch server voice capabilities. Degrades gracefully: any failure (404, network,
 * bad JSON) resolves to browser-only rather than rejecting, so callers never need a
 * try/catch and the UI still renders.
 */
export declare function fetchVoiceCapabilities(serverUrl: string | undefined, signal?: AbortSignal, authToken?: string): Promise<VoiceCapabilities>;
/** Curated ElevenLabs voices — same API cost per character; voice id only changes sound. */
export declare const ELEVENLABS_VOICES: {
    id: string;
    label: string;
}[];
export declare const OPENAI_VOICES: {
    id: string;
    label: string;
}[];
export declare function getVoiceSettings(storageKey?: string): VoiceSettings;
export declare function setVoiceSettings(patch: Partial<VoiceSettings>, storageKey?: string): VoiceSettings;
/** Map stored settings to VoiceOptions for the widget Voice class. */
export declare function voiceOptionsFromSettings(serverUrl: string, settings?: VoiceSettings): VoiceOptions;
