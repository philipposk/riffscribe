export type VoiceErrorReason = "no-speech" | "not-allowed"
/** No microphone device. */
 | "no-mic"
/**
 * The speech SERVICE failed, as distinct from the microphone being refused: the
 * recogniser's network backend is unreachable, or the engine itself is unavailable
 * ("service-not-allowed"). This is the everyday iOS symptom — webkitSpeechRecognition
 * exists inside an installed PWA / WKWebView but does not work — and it is the one
 * failure worth retrying through server STT, because the mic itself is fine.
 */
 | "service" | "other";
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
     * BCP-47 language for speech recognition and speech synthesis, e.g. "el-GR", "en-GB".
     *
     * Resolution order, evaluated on every mic tap / every utterance (never cached at
     * module load, so a host that flips its `<html lang>` when the user switches language
     * is picked up on the next tap without a reload):
     *   1. this option, when the host sets it — ALWAYS wins;
     *   2. `document.documentElement.lang`;
     *   3. `navigator.language`;
     *   4. "en-US".
     *
     * Set it explicitly if you know the language. `<html lang>` is only a last resort: a
     * host can render a fully translated UI while its root element still says "en", and
     * then the recogniser is told the wrong language and returns nothing.
     */
    lang?: string;
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
    /** Fired once when the browser recogniser is unusable and we fall back to server STT. */
    onBrowserFallback?: () => void;
}
/**
 * Resolve the BCP-47 language to use for speech I/O. Called per utterance, never cached:
 * a host that swaps `<html lang>` on a language switch is honoured on the next mic tap.
 * An explicit value always wins — `<html lang>` can lie (a translated UI whose root
 * element still says "en"), so it is only consulted when the host said nothing.
 */
export declare function resolveVoiceLang(explicit?: string): string;
/** "el-GR" → "el". Whisper and ElevenLabs want the bare ISO-639-1 code. */
export declare function baseLang(lang: string): string;
/**
 * True when a mic tap could actually produce a transcript: the browser has
 * SpeechRecognition, or there is a server to send recorded audio to AND the browser can
 * record. Used to avoid rendering a mic button that can only ever do nothing.
 */
export declare function voiceInputAvailable(serverUrl?: string): boolean;
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
    /** The language for this utterance/listen. Resolved now, not at construction. */
    private lang;
    speak(text: string, onWord?: (t: string) => void): Promise<void>;
    private speakBrowser;
    /**
     * Choose a synthesis voice for `lang`. Language beats the host's `browserVoice` name
     * hint, because a name like "Samantha" is an en-US voice and reading Greek with it is
     * unintelligible. The name still wins inside the same base language, so an app that
     * asked for "Daniel" keeps Daniel while the page is in English.
     */
    private pickBrowserVoice;
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
    /** True when recorded audio can actually be sent somewhere for transcription. */
    private canServerStt;
    /** Browser SpeechRecognition path (free, instant). Extracted so server STT can fall back to it. */
    private listenBrowser;
    /** Cancel an in-flight listen (second mic tap). Resolves the pending listenOnce with "". */
    cancelListen(): void;
    private listenServer;
}
