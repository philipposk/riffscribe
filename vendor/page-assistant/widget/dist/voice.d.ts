export type VoiceErrorReason = "no-speech" | "not-allowed" | "no-mic" | "other";
export declare class VoiceError extends Error {
    reason: VoiceErrorReason;
    constructor(reason: VoiceErrorReason, message?: string);
}
export interface VoiceOptions {
    serverUrl?: string;
    /** Bearer token when the backend requires PA_AUTH_TOKEN. */
    authToken?: string;
    /** "browser" = SpeechSynthesis (free), "server" = ElevenLabs/OpenAI via backend. */
    ttsMode?: "browser" | "server";
    voiceId?: string;
    ttsProvider?: "elevenlabs" | "openai";
    /** "browser" = SpeechRecognition (free), "server" = Whisper via backend. */
    sttMode?: "browser" | "server";
    /** Preferred browser voice name substring, e.g. "Samantha". */
    browserVoice?: string;
    /**
     * Voice-activity detection engine for barge-in. "builtin" (default) uses a
     * zero-dependency AnalyserNode RMS meter. "silero" lazy-loads @ricky0123/vad-web
     * from a CDN at runtime (opt-in, not bundled — no bundle-size impact when unused).
     */
    vad?: "builtin" | "silero";
}
/** Progress callbacks for the server-STT capture window (visible countdown + cancel). */
export interface ListenHooks {
    /** Fired for the 4s server-capture window: ms remaining, updated ~4×/sec. */
    onCountdown?: (msRemaining: number, totalMs: number) => void;
    /** Fired once when capture actually starts. */
    onCaptureStart?: () => void;
    /** Fired once when server STT is unavailable and we transparently fall back to the browser. */
    onServerFallback?: () => void;
}
export declare class Voice {
    private opts;
    private speaking;
    private currentAudio?;
    private currentUtterance?;
    private activeRecognition?;
    private listenAbort?;
    private bargeCleanup?;
    constructor(opts?: VoiceOptions);
    get isSpeaking(): boolean;
    speak(text: string, onWord?: (t: string) => void): Promise<void>;
    private speakBrowser;
    private speakServer;
    stop(): void;
    /**
     * Start barge-in — BUT never open the mic just to speak. Opening getUserMedia on every
     * TTS reply prompted TTS-only users for mic access, lit the mic indicator during all
     * speech, and let speaker echo trip the RMS threshold (the assistant barged in on
     * itself). So we only run barge-in when the mic is already available:
     *   - a live listen stream already exists (reuse it), or
     *   - mic permission was ALREADY granted (Permissions API says "granted").
     * Otherwise barge-in is silently skipped; tapping the mic button still interrupts TTS.
     */
    private startBargeIn;
    /** Run `fn` only if the mic is already usable without a new permission prompt. */
    private ifMicAlreadyGranted;
    private startAnalyserBargeIn;
    /** Optional Silero VAD via lazy CDN import. Never bundled; opt-in via `vad:"silero"`. */
    private startSileroBargeIn;
    private stopBargeIn;
    /**
     * Listen for one utterance. Uses the browser SpeechRecognition API when available
     * (instant, free); falls back to MediaRecorder + backend Whisper. Distinguishes
     * no-speech / permission-denied / other errors so the caller can surface a message.
     */
    listenOnce(hooks?: ListenHooks): Promise<string>;
    /** Browser SpeechRecognition path (free, instant). Extracted so server STT can fall back to it. */
    private listenBrowser;
    /** Cancel an in-flight listen (second mic tap). Resolves the pending listenOnce with "". */
    cancelListen(): void;
    private listenServer;
}
