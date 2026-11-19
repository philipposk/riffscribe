"use client";
/**
 * The whole app. Five steps, top to bottom:
 *   1. load a song           4. practise (speed / key / loop)
 *   2. split it into stems   5. record yourself over it
 *   3. transcribe to score + tab
 * Every step runs locally in the browser — no upload, no account, no queue.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Music2 } from "lucide-react";

import { useSearchParams } from "next/navigation";
import type { AssistantActions } from "./Assistant";
import { lendStudio } from "@/lib/assistantBridge";
import type { MixTrack } from "./Mixer";
import SaveBar from "./SaveBar";
import Tuner from "./Tuner";
import { HANDOFF_ID_KEY, HANDOFF_KEY } from "./SharedChart";
import AccountMenu from "./AccountMenu";
import { useAccount } from "@/lib/store/account";
import { findSong, lastSong, rememberSong } from "@/lib/store/lastSong";
import { buildAssistantActions } from "./studio/assistantActions";
import {
  ENSEMBLES, STEM_LABEL, barsLabel, type Busy, type Channels, type GuideTrack, type Source, type StemMode,
} from "./studio/constants";
import * as exp from "./studio/exports";
import LoadPanel from "./studio/LoadPanel";
import PartsPanel from "./studio/PartsPanel";
import PlayerBar from "./studio/PlayerBar";
import PracticePanel from "./studio/PracticePanel";
import RecordPanel from "./studio/RecordPanel";
import SplitPanel from "./studio/SplitPanel";
import Recipes from "./studio/Recipes";
import StatusBanners from "./studio/StatusBanners";

import { fileToAudioBuffer, peaks as peaksOf, toMono, toStereo } from "@/lib/audio/decode";
import {
  estimateKey, estimateTempo, chromaFromNotes, PITCH_NAMES,
} from "@/lib/audio/analyze";
import { PracticeEngine, makeClickTrack, type EngineTrack } from "@/lib/audio/engine";
import { countIn } from "@/lib/audio/countin";
import { MicRecorder, estimateLatency, foldLoopTake, placeTake, stretchOffline } from "@/lib/audio/recorder";
import {
  DEMUCS_SAMPLE_RATE, SPLIT_PAUSED, partialKey, separateInstantAsync, separateResumable, type StemSet,
} from "@/lib/audio/stems";
import { BODY_SCALE } from "@/lib/audio/body";
import { loudnessCurve } from "@/lib/audio/envelope";
import { renderGuide } from "@/lib/audio/guideClient";
import {
  forget, getScore, getSession, getStems, packTrack, putScore, putSession, putStems, requestPersistence,
  songKey, unpackTrack,
} from "@/lib/store/cache";
import { clearBlocks, doneBlocks, getBlock, putBlock } from "@/lib/store/partialSplit";
import {
  channelsToAudioBuffer, lastTranscriptionRanIn, toModelInput, transcribeAudio, transcribeAudioFull,
  type TranscribeFullOptions,
} from "@/lib/transcribe/basicPitch";
import { trackContour } from "@/lib/transcribe/contour";
import { cleanMonoLine } from "@/lib/transcribe/monoline";
import { placeInRegister } from "@/lib/transcribe/register";
import { slotTimeline, type Sheet } from "@/lib/transcribe/quantize";
import { barsToLoop, barsToRange, chartInWindow, markTake, summarise, takeSpan, type TakeReport } from "@/lib/transcribe/compare";
import { consolidateMonophonic } from "@/lib/transcribe/cleanup";
import { engraveParts, partsToTex } from "@/lib/transcribe/engrave";
import { isNativePlatform, nativeDeviceMemoryGb } from "@/lib/native";
import {
  keepChartLink, liveSolo, readSavedSettings, settingsOnLoad, trainerStep,
} from "@/lib/studioState";
import { CHART_VERSION, loadChart, type Chart } from "@/lib/store/charts";
import { extractMelody, fitToRange, playsSingleLine, splitVoices, spreadSeats } from "@/lib/transcribe/voices";
import {
  DEFAULT_SETTINGS, INSTRUMENTS, STEM_NAMES, type ContourPeaks, type InstrumentId, type NoteEvent, type Part,
  type PitchContour, type TranscriptionSettings,
} from "@/lib/types";

/** Instruments that hold their notes (not plucked or struck): they play one line, and vocals are their first choice. */
const melodic = (id: InstrumentId) => {
  const t = INSTRUMENTS[id].timbre;
  return t !== "plucked" && t !== "struck";
};

/** What a guide render depends on: the same key means the same audio. */
function guideKey(part: Part, length: number): string {
  let sum = 0;
  for (const n of part.notes) sum += n.startTimeSeconds + n.pitchMidi + n.durationSeconds;
  return `${part.id}|${part.instrument}|${part.notes.length}|${sum.toFixed(4)}|${part.contour?.midi.length ?? 0}|${length}`;
}

/** RMS of a recording over the frames where the singer's curve is voiced. */
function voicedRms(mono: Float32Array, contour: PitchContour, sampleRate: number): number | null {
  const hop = sampleRate / contour.fps;
  let acc = 0, count = 0;
  for (let j = 0; j < contour.midi.length; j++) {
    if (!(contour.midi[j] > 0)) continue;
    const a = Math.floor(j * hop), b = Math.min(mono.length, Math.floor((j + 1) * hop));
    for (let i = a; i < b; i++) acc += mono[i] * mono[i];
    count += Math.max(0, b - a);
  }
  return count ? Math.sqrt(acc / count) : null;
}

export default function Studio() {
  const [file, setFile] = useState<File | null>(null);
  const [audio, setAudio] = useState<{ left: Float32Array; right: Float32Array } | null>(null);
  const [wavePeaks, setWavePeaks] = useState<Float32Array | null>(null);
  const [stems, setStems] = useState<StemSet | null>(null);
  const [stemMode, setStemMode] = useState<StemMode>("none");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  /** Set when a native phone reports ≤4 GB and the user has not confirmed the AI split. */
  const [aiSplitCautionGb, setAiSplitCautionGb] = useState<number | null>(null);
  const [log, setLog] = useState<string>("");

  const [parts, setParts] = useState<Part[]>([]);
  const [settings, setSettings] = useState<TranscriptionSettings>(DEFAULT_SETTINGS);
  /** For callbacks that outlive a render (loadFile): the settings as they are now. */
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  const [ensembleSize, setEnsembleSize] = useState(4);
  /** The instrument "Replace the voice" writes for. */
  const [recipeInstrument, setRecipeInstrument] = useState<InstrumentId>("cello");
  const [source, setSource] = useState<Source>("mix");
  const [zoom, setZoom] = useState(1);

  const [mix, setMix] = useState<Record<string, { gain: number; muted: boolean }>>({});
  const [soloed, setSoloed] = useState<string | null>(null);
  const [transport, setTransport] = useState<{
    playing: boolean; time: number; duration: number; rate: number; semitones: number; rendering: number | null;
  }>({ playing: false, time: 0, duration: 0, rate: 1, semitones: 0, rendering: null });
  const [loop, setLoop] = useState<[number, number] | null>(null);

  const [recording, setRecording] = useState(false);
  const [overdub, setOverdub] = useState<{ left: Float32Array; right: Float32Array } | null>(null);
  const [nudgeMs, setNudgeMs] = useState(0);
  const [loopOnlyExport, setLoopOnlyExport] = useState(false);
  const [exportFormat, setExportFormat] = useState<"wav" | "mp3">("wav");
  const [playAlong, setPlayAlong] = useState(true);
  const [linkUrl, setLinkUrl] = useState("");
  const [helperUp, setHelperUp] = useState<boolean | null>(null);
  /** Content hash of the loaded file — the cache key for its stems and parts. */
  const [key, setKey] = useState<string | null>(null);
  /** A saved chart was opened but this device lacks its recording: the file to ask for. */
  const [wantedSong, setWantedSong] = useState<string | null>(null);
  const handedOff = useRef(false);
  /** The song whose parts are being kept on this device; null while loading or after a trim. */
  const partsFor = useRef<string | null>(null);
  const [restored, setRestored] = useState<string | null>(null);

  /** Bars of clicks before playback and before a take. 0 turns it off. */
  const [countInBars, setCountInBars] = useState(1);
  const [counting, setCounting] = useState(false);
  const countRef = useRef<{ cancel: () => void } | null>(null);
  /** Identifies the count-in that may go on to start playback; null once it is cancelled. */
  const countToken = useRef<object | null>(null);

  /**
   * The speed trainer: every time the loop comes round, nudge the tempo up a
   * little, until it reaches the target. This is how the thing is actually
   * practised — slow enough to play it right, then faster by degrees.
   */
  const [trainer, setTrainer] = useState<{ step: number; target: number } | null>(null);
  const [passes, setPasses] = useState(0);

  /** Named parts of the song, so you can practise "the solo" rather than 2:14. */
  const [sections, setSections] = useState<{ name: string; from: number; to: number }[]>([]);
  const [editingSection, setEditingSection] = useState<number | null>(null);

  /** How the last take measured up against the written part. */
  const [report, setReport] = useState<TakeReport | null>(null);

  /**
   * The beat being corrected. Transcription is a first draft, and until now the
   * only way to fix a wrong note was to export to MuseScore and never come back.
   */
  const [pickedBeat, setPickedBeat] = useState<number | null>(null);
  const [undoStack, setUndoStack] = useState<Part[][]>([]);
  const [checkPart, setCheckPart] = useState<string | null>(null);

  /** The saved chart this session is editing, once there is one. */
  const [chartId, setChartId] = useState<string | null>(null);
  /** The song that chart was written from. Loading any other song detaches the chart. */
  const chartSongRef = useRef<string | null>(null);
  // Signed in, there are saved songs the assistant can point to.
  const { user: signedIn } = useAccount();

  const engineRef = useRef<PracticeEngine | null>(null);
  const recorderRef = useRef<MicRecorder | null>(null);
  const recStartRef = useRef(0);
  const cancelSplitRef = useRef<(() => void) | null>(null);
  /** Bumped by every song load: work that finds it changed belongs to a song no longer open. */
  const loadSeq = useRef(0);
  /** The samples of the original song a trim kept, [start, end), or null when not trimmed. */
  const trimRef = useRef<[number, number] | null>(null);
  /** The loop that was repeating when the take started, so the take can be folded back onto it. */
  const recLoopRef = useRef<[number, number] | null>(null);
  /** The recording the engine's tracks were loaded from: a new one is a new song, not an edit. */
  const engineAudioRef = useRef<unknown>(null);
  /** Synthesised guide per part id, with what it was rendered from, so editing one part does not re-render the others. */
  const guideCache = useRef(new Map<string, { key: string; audio: unknown; track: GuideTrack }>());
  /** The source stem's loudness while the singer sings, per part written from a voice: the guide's level. */
  const targetRmsRef = useRef(new Map<string, number>());
  const partSeq = useRef(0);

  if (!engineRef.current && typeof window !== "undefined") engineRef.current = new PracticeEngine();
  if (!recorderRef.current && typeof window !== "undefined") recorderRef.current = new MicRecorder();

  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    e.onTime = (t) => setTransport((s) => ({ ...s, time: t }));
    e.onStateChange = (s) =>
      setTransport({ playing: s.playing, time: s.time, duration: s.duration, rate: s.rate, semitones: s.semitones, rendering: s.rendering });
    return () => { void e.dispose(); };
  }, []);

  // Leaving the studio: stop a count-in that would otherwise go on to start playback,
  // and close the microphone.
  useEffect(() => {
    const recorder = recorderRef.current;
    return () => {
      countToken.current = null;
      countRef.current?.cancel();
      recorder?.release();
    };
  }, []);

  /** Edits belong to the parts they were made on: new parts or a new song start with none. */
  const resetEdits = useCallback(() => {
    setUndoStack([]);
    setPickedBeat(null);
  }, []);

  /* ------------------------------------------------------------------ load */

  /** `restoring`: bringing back the last song on return — keep whatever chart is open. */
  const loadFile = useCallback(async (f: File, restoring = false) => {
    // A later load wins: every step below stops once another song has started loading.
    const my = ++loadSeq.current;
    const stale = () => my !== loadSeq.current;
    // A split still running belongs to the song being replaced.
    cancelSplitRef.current?.();
    cancelSplitRef.current = null;
    setError(null);
    setBusy({ label: `Decoding ${f.name}…` });
    try {
      const buf = await fileToAudioBuffer(f);
      const stereo = await toStereo(buf, DEMUCS_SAMPLE_RATE);
      if (stale()) return;
      trimRef.current = null;
      setFile(f);
      setAudio({ left: stereo.left, right: stereo.right });
      setWavePeaks(peaksOf(toMono(stereo.left, stereo.right), 2200));
      setStems(null);
      setStemMode("none");
      if (!restoring) setParts([]);
      resetEdits();
      setSource("mix");
      setRestored(null);
      partsFor.current = null;

      // Have we taken this song apart before? Separating costs minutes, so it
      // is worth a moment's hashing to find out.
      const id = await songKey(f);
      if (stale()) return;
      // A different song is a new chart: "Save changes" must not overwrite the one that was open.
      if (!restoring && !keepChartLink(chartSongRef.current, id)) {
        setChartId(null);
        chartSongRef.current = null;
      }
      setKey(id);
      setWantedSong(null);
      if (!restoring) void rememberSong(id, f);
      setBusy({ label: "Looking for work you have already done…" });
      const found = await getStems(id, DEMUCS_SAMPLE_RATE);
      if (stale()) return;
      // Stems of another length are not this recording's: older versions saved a trimmed
      // clip's split under the whole song's key. Treat those as not cached.
      const firstStem = found ? Object.values(found.stems)[0] : undefined;
      const cached = firstStem && Math.abs(firstStem.left.length - stereo.left.length) <= DEMUCS_SAMPLE_RATE * 0.05 ? found : null;
      if (cached) {
        setStems(cached.stems as StemSet);
        setStemMode(cached.mode as StemMode);
        setSource(melodic(settingsRef.current.instrument) ? "vocals" : "other");
        setRestored(cached.mode === "ai" ? "Stems restored from this device — no need to split again." : "Instant split restored from this device.");
      }
      // Transcribed parts come back too, unless a saved chart just brought its own.
      if (!restoring || !handedOff.current) {
        const saved = await getScore<Part[]>(id, "parts");
        if (stale()) return;
        if (saved?.length) {
          setParts(saved);
          setRestored((r) => `${r ? r + " " : ""}${saved.length} transcribed ${saved.length === 1 ? "part" : "parts"} restored.`);
        }
      }
      const savedSettings = readSavedSettings(await getScore<unknown>(id, "settings"));
      const session = await getSession(id);
      if (stale()) return;
      if (session) {
        setMix(session.mix);
        setSoloed(session.soloed);
        if (session.overdub) {
          const track = await unpackTrack(session.overdub, DEMUCS_SAMPLE_RATE);
          if (stale()) return;
          setOverdub(track);
          setRestored((r) => `${r ? r + " " : ""}Mixer and your last take restored.`);
        } else {
          setOverdub(null);
        }
      } else {
        setMix({});
        setSoloed(null);
        setOverdub(null);
      }
      partsFor.current = id;
      if (!cached) {
        const partial = await doneBlocks(partialKey(id, stereo.left.length));
        if (stale()) return;
        if (partial.size) {
          setRestored(
            `An AI split of this song stopped partway — ${partial.size} ${partial.size === 1 ? "part is" : "parts are"} kept. ` +
              "Press the AI split to carry on from there."
          );
        }
      }

      const mono = toMono(stereo.left, stereo.right);
      const tempo = estimateTempo(mono, DEMUCS_SAMPLE_RATE);
      // Tempo, offset, key choices, sections and loop are kept per song like the parts are —
      // the parts' notes are in seconds and only mean anything against the tempo they were written at.
      const onLoad = settingsOnLoad(savedSettings, restoring && handedOff.current, tempo);
      if (onLoad.kind === "saved") {
        setSettings({ ...DEFAULT_SETTINGS, ...(onLoad.value.settings as unknown as TranscriptionSettings) });
        setSections(onLoad.value.sections);
        setLoop(onLoad.value.loop);
        setLog(restoring ? `Brought back ${f.name} from last time.` : `Brought back your tempo and settings for ${f.name}.`);
      } else if (onLoad.kind === "detected") {
        setSettings((s) => ({ ...s, bpm: onLoad.bpm, offsetSeconds: onLoad.offsetSeconds }));
        setLog(restoring
          ? `Brought back ${f.name} from last time — tempo re-detected at ${tempo.bpm} BPM.`
          : `Detected ${tempo.bpm} BPM (confidence ${(tempo.confidence * 100).toFixed(0)}%)`);
      } else {
        setLog(`Brought back ${f.name} from last time.`);
      }
    } catch (e) {
      if (!stale()) setError(e instanceof Error ? e.message : "could not read that file");
    } finally {
      if (!stale()) setBusy(null);
    }
  }, [resetEdits]);

  /** Keep this song's parts on the device, so reopening it brings them back. */
  useEffect(() => {
    if (key && partsFor.current === key) void putScore(key, "parts", parts);
  }, [key, parts]);

  /** Tempo, offset, key choices, sections and loop — separate from the session so a BPM edit does not re-encode the take. */
  useEffect(() => {
    if (key && partsFor.current === key) void putScore(key, "settings", { settings, sections, loop });
  }, [key, settings, sections, loop]);

  /** Mixer faders and overdub take — same cache key as stems and parts. */
  useEffect(() => {
    if (!key || partsFor.current !== key) return;
    void (async () => {
      const packed = overdub ? await packTrack(overdub, DEMUCS_SAMPLE_RATE) : null;
      await putSession(key, { mix, soloed, overdub: packed });
    })();
  }, [key, mix, soloed, overdub]);

  /** Coming back to the studio: reopen the song that was loaded before. */
  useEffect(() => {
    let cancelled = false;
    // A chart handed over from My songs brings its own recording — don't race it.
    void lastSong().then((f) => { if (f && !cancelled && !handedOff.current) void loadFile(f, true); });
    return () => { cancelled = true; };
  }, [loadFile]);

  /** Leaving mid-job loses it — a split cannot resume halfway. Ask first. */
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  /**
   * Pull a song in from a link, via the little fetcher you run on your own
   * machine (see local/fetch-server.mjs). A page cannot do this itself — the
   * media is cross-origin and signed — and a hosted server doing it would get
   * blocked, so this stays on localhost where it also keeps the audio private.
   */
  const loadFromLink = useCallback(async (link: string) => {
    const base = process.env.NEXT_PUBLIC_FETCH_URL || "http://127.0.0.1:7749";
    setError(null);
    setBusy({ label: "Fetching the audio through your local helper…" });
    try {
      const res = await fetch(`${base}/fetch?url=${encodeURIComponent(link)}`, { mode: "cors" });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.error || `the helper answered ${res.status}`);
      }
      const blob = await res.blob();
      const name = decodeURIComponent(link.slice(0, 60)).replace(/[^\w.-]+/g, "-") + ".mp3";
      await loadFile(new File([blob], name, { type: blob.type || "audio/mpeg" }));
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      setError(
        /fetch|network|Failed/i.test(why)
          ? "Could not reach the local helper. Start it with: node local/fetch-server.mjs"
          : why
      );
      setBusy(null);
    }
  }, [loadFile]);

  // Is the link helper running on this machine? Checked once, quietly, so the
  // link box can say something useful instead of failing when it is pressed.
  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_FETCH_URL || "http://127.0.0.1:7749";
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), 1500);
    fetch(`${base}/health`, { mode: "cors", signal: stop.signal })
      .then((r) => setHelperUp(r.ok))
      .catch(() => setHelperUp(false))
      .finally(() => clearTimeout(timer));
    return () => stop.abort();
  }, []);

  /**
   * A drone note for the key of whatever is loaded. Around A3–G#4 so it sits
   * under a violin and over a cello without either having to reach.
   */
  const droneTonic = useMemo(() => {
    const name = parts[0]?.keyName?.split(" ")[0];
    const pc = name ? PITCH_NAMES.indexOf(name) : -1;
    if (pc < 0) return undefined;
    return 57 + ((pc - 9 + 12) % 12); // 57 is A3
  }, [parts]);

  /** SaveBar reports the chart it saved or dropped; remember which song it belongs to. */
  const linkChart = useCallback((id: string | null) => {
    setChartId(id);
    chartSongRef.current = id ? key ?? chartSongRef.current : null;
  }, [key]);

  /* ---------------------------------------------------------------- charts */

  /** Everything worth keeping about a song, and nothing that weighs anything. */
  const buildChart = useCallback((): Chart | null => {
    if (!parts.length) return null;
    return {
      version: CHART_VERSION,
      title: file?.name.replace(/\.[^.]+$/, "") || "Untitled",
      settings,
      // the singer's curve is device-only: heavy, and only meaningful next to the recording
      parts: parts.map(({ contour: _contour, ...rest }) => rest),
      sections,
      loop,
      songKey: key ?? undefined,
      fileName: file?.name,
    };
  }, [parts, settings, sections, loop, file, key]);

  const openChart = useCallback((chart: Chart) => {
    // Until the chart's own song is loaded, whatever is open belongs to another song:
    // its cache must not be overwritten with these parts, and its edits must not undo into them.
    partsFor.current = null;
    chartSongRef.current = chart.songKey ?? null;
    resetEdits();
    setSettings(chart.settings);
    setParts(chart.parts);
    setSections(chart.sections ?? []);
    setLoop(chart.loop ?? null);
    setReport(null);
    const title = `"${chart.title}" — ${chart.parts.length} ${chart.parts.length === 1 ? "part" : "parts"}`;
    // The recording stayed on the machine that made the chart. If that is this
    // one, bring it back — stems and all — rather than ask for the file again.
    void (async () => {
      const f = await findSong(chart.songKey, chart.title);
      if (f) {
        await loadFile(f, true);
        setLog(`Opened ${title}, with the song and its stems from this device.`);
      } else {
        // Whatever is loaded belongs to another song (a saved song opened from
        // a link while the studio was in use), so it must not play under these notes.
        void engineRef.current?.pause();
        setAudio(null);
        setFile(null);
        setWavePeaks(null);
        setStems(null);
        setStemMode("none");
        setOverdub(null);
        setKey(null);
        setWantedSong(chart.fileName ?? chart.title);
        setLog(`Opened ${title}.`);
      }
    })();
  }, [loadFile, resetEdits]);

  /** A chart arriving from a shared link, handed over through session storage. */
  useEffect(() => {
    let raw: string | null = null;
    let id: string | null = null;
    try {
      raw = sessionStorage.getItem(HANDOFF_KEY);
      id = sessionStorage.getItem(HANDOFF_ID_KEY);
      sessionStorage.removeItem(HANDOFF_KEY);
      sessionStorage.removeItem(HANDOFF_ID_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    handedOff.current = true;
    try {
      openChart(JSON.parse(raw) as Chart);
      if (id) setChartId(id);
    } catch {
      /* a chart we cannot read is not worth an error message */
    }
  }, [openChart]);

  /**
   * A saved song opened from its address, /studio?song=<id> — where the
   * assistant links each song it lists. Also works with the studio already
   * open: the address changes, the page stays.
   */
  const songParam = useSearchParams().get("song");
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useEffect(() => {
    if (!songParam) return;
    handedOff.current = true; // set before lastSong() resolves, so it does not load over this
    let cancelled = false;
    void (async () => {
      try {
        const job = busyRef.current;
        if (job) throw new Error(`Wait for “${job.label}” to finish, then open the song again.`);
        const chart = await loadChart(songParam);
        if (cancelled) return;
        if (!chart) throw new Error("That song has gone — it may have been deleted.");
        openChart(chart);
        setChartId(songParam);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "could not open that song");
      }
      // Consumed, like the handoff above: a reload must not reopen it over whatever came next.
      if (!cancelled) window.history.replaceState(null, "", "/studio");
    })();
    return () => { cancelled = true; };
  }, [songParam, openChart]);

  /* --------------------------------------------------------------- engine  */

  /**
   * One synthesised line per part, so each can be heard on its own. At sounding pitch: the
   * "write it in" transposition only changes the notation, and the engine's transpose moves
   * the guide together with the backing. Rendered off the page (guideClient); a part whose
   * notes, instrument and curve are unchanged reuses its earlier render (and the engine then
   * does not re-render it either).
   */
  const [rendered, setRendered] = useState<{ audio: unknown; tracks: GuideTrack[] }>({ audio: null, tracks: [] });
  // renders made for another recording are never handed to the engine
  const guideTracks = useMemo(
    () => (audio && rendered.audio === audio ? rendered.tracks : ([] as GuideTrack[])),
    [audio, rendered]
  );
  useEffect(() => {
    if (!audio) return;
    let superseded = false;
    const cache = guideCache.current;
    const live = new Set(parts.map((p) => p.id));
    for (const id of [...cache.keys()]) if (!live.has(id)) cache.delete(id);
    const length = audio.left.length;
    const jobs = parts.map(async (part): Promise<GuideTrack> => {
      const k = guideKey(part, length);
      const hit = cache.get(part.id);
      if (hit && hit.key === k && hit.audio === audio) return hit.track;
      let targetRms = part.contour ? targetRmsRef.current.get(part.id) : undefined;
      // a part brought back from this device: measure its source stem again, as when it was written
      const stem = stems && part.source !== "mix" ? stems[part.source as keyof StemSet] : null;
      if (part.contour && targetRms === undefined && stem && stem.left.length === length) {
        targetRms = voicedRms(toMono(stem.left, stem.right), part.contour, DEMUCS_SAMPLE_RATE) ?? undefined;
        if (targetRms) targetRmsRef.current.set(part.id, targetRms);
      }
      const [left, right] = await renderGuide(part.notes, {
        timbre: INSTRUMENTS[part.instrument].timbre,
        sampleRate: DEMUCS_SAMPLE_RATE,
        lengthSamples: length,
        contour: part.contour ?? null,
        bodyScale: (BODY_SCALE as Partial<Record<InstrumentId, number>>)[part.instrument] ?? 1,
        ...(targetRms ? { targetRms } : {}),
      });
      const track = { id: `guide:${part.id}`, left, right };
      // valid for its key whether or not this run is still current
      cache.set(part.id, { key: k, audio, track });
      return track;
    });
    Promise.all(jobs).then(
      (tracks) => { if (!superseded) setRendered({ audio, tracks }); },
      (e) => {
        if (superseded) return;
        console.error("[riffscribe] guide render failed", e);
        setError(e instanceof Error ? e.message : "could not play the part back");
      }
    );
    return () => { superseded = true; };
  }, [audio, parts, stems]);

  const trackList = useMemo<{ id: string; label: string; hint?: string }[]>(() => {
    const out: { id: string; label: string; hint?: string }[] = [];
    if (stems && stemMode === "ai") {
      for (const n of STEM_NAMES) out.push({ id: n, ...STEM_LABEL[n] });
    } else if (stems && stemMode === "instant") {
      out.push({ id: "vocals", label: "Centre / vocal", hint: "what was panned to the middle" });
      out.push({ id: "other", label: "Backing track", hint: "everything else" });
    } else if (audio) {
      out.push({ id: "original", ...STEM_LABEL.original });
    }
    const seen = new Map<InstrumentId, number>();
    for (const part of parts) {
      const nth = (seen.get(part.instrument) ?? 0) + 1;
      seen.set(part.instrument, nth);
      const line = part.source === "mix" ? "full mix" : STEM_LABEL[part.source]?.label.toLowerCase() ?? part.source;
      out.push({
        id: `guide:${part.id}`,
        label: `${INSTRUMENTS[part.instrument].label} · plays the ${line} line${nth > 1 ? ` (${nth})` : ""}`,
        hint: part.contour
          ? `follows the ${part.source === "vocals" ? "singer" : "recording"}'s pitch and loudness`
          : "the transcription, played back",
      });
    }
    if (audio) out.push({ id: "click", ...STEM_LABEL.click });
    if (overdub) out.push({ id: "overdub", ...STEM_LABEL.overdub });
    return out;
  }, [stems, stemMode, audio, overdub, parts]);

  /** The solo that still points at a track. A leftover id would silence every row with no solo button lit. */
  const activeSolo = useMemo(() => liveSolo(soloed, trackList.map((t) => t.id)), [soloed, trackList]);

  const clickTrack = useMemo(() => {
    if (!audio) return null;
    const [left, right] = makeClickTrack(
      audio.left.length / DEMUCS_SAMPLE_RATE,
      DEMUCS_SAMPLE_RATE,
      settings.bpm,
      settings.offsetSeconds,
      settings.timeSignature[0]
    );
    return { left, right };
  }, [audio, settings.bpm, settings.offsetSeconds, settings.timeSignature]);

  const rebuildEngine = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || !audio) return;
    const tracks: EngineTrack[] = [];
    const push = (id: string, left: Float32Array, right: Float32Array) => {
      const meta = trackList.find((t) => t.id === id);
      if (meta) tracks.push({ id, label: meta.label, left, right });
    };

    if (stems && stemMode !== "none") {
      for (const n of STEM_NAMES) if (trackList.some((t) => t.id === n)) push(n, stems[n].left, stems[n].right);
    } else {
      push("original", audio.left, audio.right);
    }

    for (const g of guideTracks) push(g.id, g.left, g.right);
    if (clickTrack) push("click", clickTrack.left, clickTrack.right);
    if (overdub) push("overdub", overdub.left, overdub.right);

    try {
      // A new recording starts over; anything else (a chart edit, a BPM change, a finished
      // split) only swaps the tracks that changed, so playback and slowed renders carry on.
      if (engineAudioRef.current !== audio) {
        engineAudioRef.current = audio;
        await engine.load(tracks, DEMUCS_SAMPLE_RATE);
      } else {
        await engine.updateTracks(tracks, DEMUCS_SAMPLE_RATE);
      }
    } catch (e) {
      console.error("[riffscribe] audio engine failed", e);
      setError(e instanceof Error ? e.message : "could not start the audio engine");
      return;
    }
    setMix((prev) => {
      const next = { ...prev };
      // the click starts muted but at a usable level, so un-muting it is not silence
      for (const t of tracks) {
        if (next[t.id]) continue;
        // the click starts muted but at a usable level, so un-muting it is not
        // silence; the guide starts audible, since hearing your part is the point
        if (t.id === "click") next[t.id] = { gain: 0.7, muted: true };
        else if (t.id.startsWith("guide:")) next[t.id] = { gain: 0.85, muted: false };
        else next[t.id] = { gain: 1, muted: false };
      }
      return next;
    });
  }, [audio, stems, stemMode, overdub, trackList, clickTrack, guideTracks]);

  // each rebuild re-renders the tracks that changed, so coalesce bursts (e.g. typing a BPM)
  useEffect(() => {
    const id = setTimeout(() => void rebuildEngine(), 350);
    return () => clearTimeout(id);
  }, [rebuildEngine]);

  // push fader values into the audio graph
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    for (const t of trackList) {
      const m = mix[t.id];
      if (!m) continue;
      const audible = !m.muted && (activeSolo === null || activeSolo === t.id);
      engine.setGain(t.id, audible ? m.gain : 0);
    }
  }, [mix, activeSolo, trackList]);

  useEffect(() => { void engineRef.current?.setLoop(loop); }, [loop]);

  /**
   * A loop pass ends when the clock jumps backwards inside the loop. That is
   * the only signal the engine gives us, and it is enough: count the pass, and
   * if the trainer is on, nudge the speed up a step.
   */
  const lastTime = useRef(0);
  useEffect(() => {
    const prev = lastTime.current;
    lastTime.current = transport.time;
    if (!loop || !transport.playing) return;
    const wrapped = prev > transport.time + 0.25 && prev <= loop[1] + 0.5 && transport.time >= loop[0] - 0.5;
    if (!wrapped) return;
    setPasses((n) => n + 1);
    if (!trainer) return;
    const step = trainerStep(transport.rate, trainer);
    if (step.kind === "up") {
      void engineRef.current?.setRate(step.rate); // already rendered by the effect below, so this does not stall
      setLog(`Pass done — up to ${Math.round(step.rate * 100)}%.`);
    } else if (step.kind === "done") {
      setTrainer(null);
      setLog(`You are up to ${Math.round(trainer.target * 100)}%. Trainer off.`);
    }
  }, [transport.time, transport.playing, transport.rate, loop, trainer]);

  // Rendering a speed stretches the whole song, which takes a while. Do the next step's
  // render in the background while this pass plays, so the wrap into it is instant.
  useEffect(() => {
    if (!trainer || !loop || !transport.playing) return;
    const step = trainerStep(transport.rate, trainer);
    if (step.kind === "up") void engineRef.current?.prepareRate(step.rate);
  }, [trainer, loop, transport.playing, transport.rate]);

  // The trainer works on a loop; without one it would ramp the speed on the next loop set.
  useEffect(() => {
    if (!loop && trainer) {
      setTrainer(null);
      setLog("Loop cleared. Trainer off.");
    }
  }, [loop, trainer]);

  /** Play, but count it in first so you can come in with it. */
  const startPlaying = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    // Pressed again during the count-in: that is "stop", not a second count-in.
    if (countRef.current) {
      countToken.current = null;
      countRef.current.cancel();
      countRef.current = null;
      setCounting(false);
      return;
    }
    if (transport.playing) {
      await engine.pause();
      return;
    }
    // Start the audio context now, inside the click: after a count-in the gesture has
    // expired and iOS Safari would leave it suspended.
    engine.warm();
    if (countInBars > 0) {
      const token = {};
      countToken.current = token;
      setCounting(true);
      const c = countIn(settings.bpm, transport.rate, settings.timeSignature[0], countInBars);
      countRef.current = c;
      await c.done;
      if (countToken.current !== token) return; // cancelled while counting
      countToken.current = null;
      countRef.current = null;
      setCounting(false);
    }
    await engine.play();
  }, [transport.playing, transport.rate, countInBars, settings.bpm, settings.timeSignature]);

  /**
   * Mark the section you are looping, so you can come back to it by name.
   * The name is edited in place rather than through a browser prompt, which
   * some browsers refuse to show and none of them make look like part of this.
   */
  function nameLoop() {
    if (!loop) return;
    const next = [...sections, { name: `Section ${sections.length + 1}`, from: loop[0], to: loop[1] }]
      .sort((a, b) => a.from - b.from);
    setSections(next);
    setEditingSection(next.findIndex((s) => s.from === loop[0] && s.to === loop[1]));
  }

  /* -------------------------------------------------------------- separate */

  /**
   * Where work on the audio as it is now is kept on this device. A clip trimmed to a loop
   * is not the song its key was hashed from, so it gets a key of its own.
   */
  function workKey(): string | null {
    const trim = trimRef.current;
    return key && trim ? `${key}:trim:${trim[0]}-${trim[1]}` : key;
  }

  /** Each job below answers whether it finished, so the assistant does not report success after a failure. */
  async function runInstant(): Promise<boolean> {
    return !!(await splitInstant());
  }

  async function runDemucs(): Promise<boolean> {
    return !!(await splitAi());
  }

  /** The instant split; resolves with the stems, or null when it failed or another song was loaded. */
  async function splitInstant(): Promise<StemSet | null> {
    if (!audio) return null;
    // Results are for this song as it is now: a song loaded meanwhile must not get them.
    const my = loadSeq.current;
    const trimmed = !!trimRef.current;
    setError(null);
    setBusy({ label: "Pulling the centre channel out…" });
    try {
      const result = await separateInstantAsync(
        Float32Array.from(audio.left),
        Float32Array.from(audio.right),
        DEMUCS_SAMPLE_RATE
      );
      // The stem cache is whole songs only: a trimmed clip's split would come back for the whole song.
      if (key && file && !trimmed) void putStems(key, file.name, result, DEMUCS_SAMPLE_RATE, "instant");
      if (my !== loadSeq.current) return null;
      setStems(result);
      setStemMode("instant");
      setSource(melodic(settings.instrument) ? "vocals" : "other");
      setLog("Instant split done. For a cleaner result, run the AI split.");
      return result;
    } catch (e) {
      if (my === loadSeq.current) setError(e instanceof Error ? e.message : "instant split failed");
      return null;
    } finally {
      if (my === loadSeq.current) setBusy(null);
    }
  }

  /** The AI split; resolves with the stems, or null when it failed, was paused or another song was loaded. */
  async function splitAi(): Promise<StemSet | null> {
    if (!audio) return null;
    const my = loadSeq.current;
    const trimmed = !!trimRef.current;
    const current = () => my === loadSeq.current;
    setError(null);
    setBusy({ label: "Loading the separation model…" });
    try {
      // Without a song key (should not happen once loaded) blocks are simply not reused.
      const pkey = partialKey(workKey() ?? `unsaved-${Date.now()}`, audio.left.length);
      const { promise, cancel } = separateResumable(
        pkey,
        audio.left,
        audio.right,
        { done: doneBlocks, get: getBlock, put: putBlock, clear: clearBlocks },
        (p) => {
          if (!current()) return;
          if (p.phase === "download") setBusy({ label: `Downloading model (one time, ~180 MB) ${p.message ?? ""}`, value: p.value });
          else if (p.phase === "prepare") setBusy({ label: "Preparing the model — this takes a moment…" });
          else if (p.phase === "separate") setBusy({ label: `Separating stems ${p.message ?? ""}`, value: p.value });
          else if (p.message) setLog(p.message);
        }
      );
      cancelSplitRef.current = cancel;
      const result = await promise;
      // Minutes of work — never make anyone wait for it twice. Whole songs only, as above.
      if (key && file && !trimmed) {
        void requestPersistence();
        void putStems(key, file.name, result, DEMUCS_SAMPLE_RATE, "ai");
      }
      if (!current()) return null;
      setStems(result);
      setStemMode("ai");
      setSource(melodic(settings.instrument) ? "vocals" : "other");
      setAiSplitCautionGb(null);
      setLog("Four stems ready. Mute what you don't want to hear.");
      return result;
    } catch (e) {
      if (!current()) return null;
      if (e instanceof Error && e.message === SPLIT_PAUSED) return null;
      const detail = e instanceof Error && e.message ? e.message : "stem separation failed";
      const native = await isNativePlatform();
      setError(
        native
          ? `This phone could not finish the AI stem split. The desktop site is the reliable place for it. Instant vocal removal still works on this phone. (${detail})`
          : detail,
      );
      return null;
    } finally {
      if (current()) {
        cancelSplitRef.current = null;
        setBusy(null);
      }
    }
  }

  /**
   * AI split only. Instant vocal removal is never gated.
   * A phone that reports 4 GB or less gets a warning and can still continue.
   */
  async function startAiSplit(): Promise<void> {
    await aiSplitChecked();
  }

  /** `startAiSplit`, resolving with the stems (null when the phone warning stopped it, or it failed). */
  async function aiSplitChecked(): Promise<StemSet | null> {
    const mem = await nativeDeviceMemoryGb();
    if (mem != null && mem <= 4) {
      setAiSplitCautionGb(mem);
      return null;
    }
    return splitAi();
  }

  function cancelJob() {
    cancelSplitRef.current?.();
    cancelSplitRef.current = null;
    setBusy(null);
    setLog("Separation paused. Finished parts are kept — press the AI split again to carry on from there.");
  }

  /** Cut the song down to the looped section — separation is slow, so this helps. */
  function trimToLoop() {
    if (!audio || !loop) return;
    const a = Math.max(0, Math.floor(loop[0] * DEMUCS_SAMPLE_RATE));
    const b = Math.min(audio.left.length, Math.floor(loop[1] * DEMUCS_SAMPLE_RATE));
    if (b - a < DEMUCS_SAMPLE_RATE) return;
    const base = trimRef.current?.[0] ?? 0;
    trimRef.current = [base + a, base + b];
    const left = audio.left.slice(a, b);
    const right = audio.right.slice(a, b);
    setAudio({ left, right });
    setWavePeaks(peaksOf(toMono(left, right), 2200));
    setStems(null);
    setStemMode("none");
    partsFor.current = null; // parts of a trimmed clip no longer line up with the song
    setParts([]);
    resetEdits();
    setOverdub(null);
    setSource("mix");
    setLoop(null);
    setSettings((s) => ({ ...s, offsetSeconds: 0 }));
    setLog(`Trimmed to ${Math.round((b - a) / DEMUCS_SAMPLE_RATE)}s. Separation and transcription will be much quicker.`);
  }

  /* ------------------------------------------------------------ transcribe */

  const sourceChannels = useCallback((s: Source = source): { left: Float32Array; right: Float32Array } | null => {
    if (!audio) return null;
    if (s === "mix" || !stems) return audio;
    return stems[s];
  }, [audio, stems, source]);

  /** Throw away what we remembered, for when a split went badly. */
  async function forgetSong() {
    if (!key) return;
    await forget(key);
    setStems(null);
    setStemMode("none");
    setSource("mix");
    setSoloed(null);
    setRestored(null);
    setLog("Forgotten. The next split will run from scratch.");
  }

  /**
   * Mark the take against the written part.
   *
   * The recording has already been stretched back to full tempo and slid to
   * account for the speaker-to-microphone delay, so it is in song time and can
   * be compared with the chart directly. We transcribe it with the same model
   * that produced the chart, which means both sides carry the same biases and
   * a disagreement is more likely to be the player than the machine.
   *
   * Only the stretch that was recorded is listened to and marked. The take sits
   * in a full-song buffer padded with silence; marking it against the whole
   * chart called every bar the player never reached "missed".
   *
   * Returns a sentence instead of a report when there is nothing to mark.
   */
  async function checkTake(): Promise<TakeReport | string | null> {
    const part = parts.find((x) => x.id === checkPart) ?? parts[0];
    if (!overdub || !part) return null;
    const inst = INSTRUMENTS[part.instrument];
    const span = takeSpan(overdub.left, overdub.right, DEMUCS_SAMPLE_RATE);
    const chart = span ? chartInWindow(part.notes, span[0], span[1]) : [];
    if (!span || !chart.length) {
      const why = !span
        ? "That take is silent — record it again."
        : "Nothing is written in the bars you played — record over a stretch the part plays in.";
      setReport(null);
      setLog(why);
      return why;
    }
    setError(null);
    setBusy({ label: "Listening to your take…", value: 0 });
    try {
      const pad = 0.5;
      const a = Math.max(0, Math.floor((span[0] - pad) * DEMUCS_SAMPLE_RATE));
      const b = Math.min(overdub.left.length, Math.ceil((span[1] + pad) * DEMUCS_SAMPLE_RATE));
      const buffer = channelsToAudioBuffer([overdub.left.slice(a, b), overdub.right.slice(a, b)], DEMUCS_SAMPLE_RATE);
      const mono22 = await toModelInput(buffer);
      // The player reads the written part, so a transposed part is played (and
      // must be listened for) that far from the chart's sounding pitch.
      const shift = settings.transposeSemitones;
      const midi = (m: number) => Math.max(0, Math.min(127, m + shift));
      const heard = await transcribeAudio(mono22, {
        onsetThreshold: settings.onsetThreshold,
        frameThreshold: settings.frameThreshold,
        minNoteLength: settings.minNoteLength,
        minMidi: midi(inst.range[0]),
        maxMidi: midi(inst.range[1]),
        onProgress: (p) => setBusy({ label: "Listening to your take…", value: p }),
      });
      const line = playsSingleLine(inst) ? consolidateMonophonic(extractMelody(heard)) : heard;
      const played = line.map((n) => ({ ...n, startTimeSeconds: n.startTimeSeconds + a / DEMUCS_SAMPLE_RATE }));
      const r = markTake(chart, played, {
        bpm: settings.bpm,
        beatsPerBar: settings.timeSignature[0],
        offsetSeconds: barLineSeconds,
        transposeSemitones: shift,
      });
      setReport(r);
      setLog(summarise(r));
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not mark that take");
      return null;
    } finally {
      setBusy(null);
    }
  }

  function loopWorstBars() {
    if (!report) return;
    const range = barsToRange(report.worstBars, {
      bpm: settings.bpm,
      beatsPerBar: settings.timeSignature[0],
      offsetSeconds: barLineSeconds,
    });
    if (!range) return;
    setLoop(range);
    void engineRef.current?.seek(range[0]);
    setLog(`Looping the bars that need it: ${barsLabel(barsToLoop(report.worstBars))}.`);
  }

  /** `from` is for callers that have just changed the source: state would still hold the old one. */
  async function runTranscribe(from?: Source): Promise<boolean> {
    const which = from ?? source;
    const src = sourceChannels(which);
    if (!src) return false;
    return !!(await transcribeFrom(src, which, settings.instrument));
  }

  /**
   * Write a part for `instrumentId` from one recording (a stem or the mix) and add it.
   *
   * Instruments that hold their notes get one note at a time (or whatever `monophonic` says).
   * A single line is cleaned up (cleanMonoLine), the singer's pitch curve is tracked through it
   * when there are model peaks, its loudness is read from the audio, and the whole line is moved
   * by octaves onto the instrument (placeInRegister). Resolves with the new part, or null.
   */
  async function transcribeFrom(
    channels: Channels,
    sourceName: Source,
    instrumentId: InstrumentId,
    opts: { monophonic?: boolean } = {}
  ): Promise<Part | null> {
    const inst = INSTRUMENTS[instrumentId];
    const my = loadSeq.current;
    const current = () => my === loadSeq.current;
    const mono = opts.monophonic ?? (melodic(instrumentId) || settings.monophonic);
    const voice = sourceName === "vocals";
    setError(null);
    setBusy({ label: "Listening for notes…", value: 0 });
    const startedAt = performance.now();
    const variant =
      `${sourceName}:${instrumentId}:${settings.onsetThreshold}:${settings.frameThreshold}:${settings.minNoteLength}` +
      `:v2:${voice ? "voice" : "inst"}`;
    const detect: TranscribeFullOptions = voice
      ? {
          // a voice is detected over its own range, keeping short notes and weak ones
          onsetThreshold: settings.onsetThreshold,
          frameThreshold: settings.frameThreshold,
          minNoteLength: Math.min(settings.minNoteLength, 7),
          minMidi: 36,
          maxMidi: 96,
          melodiaTrick: false,
          wantPeaks: true,
        }
      : {
          onsetThreshold: settings.onsetThreshold,
          frameThreshold: settings.frameThreshold,
          minNoteLength: settings.minNoteLength,
          minMidi: inst.range[0],
          maxMidi: inst.range[1],
          wantPeaks: mono,
        };
    try {
      const store = workKey();
      let found = store ? await getScore<NoteEvent[]>(store, variant) : null;
      let peaks = store && detect.wantPeaks ? await getScore<ContourPeaks>(store, `${variant}:peaks`) : null;
      const fromCache = !!found && (!detect.wantPeaks || !!peaks);
      if (!fromCache) {
        const buffer = channelsToAudioBuffer([channels.left, channels.right], DEMUCS_SAMPLE_RATE);
        const mono22 = await toModelInput(buffer);
        const result = await transcribeAudioFull(mono22, {
          ...detect,
          onProgress: (p) => { if (current()) setBusy({ label: "Listening for notes…", value: p }); },
        });
        found = result.notes;
        peaks = result.peaks;
        if (store) {
          void putScore(store, variant, found);
          if (peaks) void putScore(store, `${variant}:peaks`, peaks);
        }
      }
      if (!current() || !found) return null;

      let notes: NoteEvent[] = found;
      let contour: PitchContour | null = null;
      let octaves: number | undefined;
      let targetRms: number | null = null;
      if (mono) {
        // One note at a time, held notes held, each note's pitch read from its own bends.
        // That beats re-reading it from the tracked curve on real singing (docs/eval-cello.md).
        notes = cleanMonoLine(found);
        const duration = channels.left.length / DEMUCS_SAMPLE_RATE;
        contour = peaks && notes.length ? trackContour(peaks, notes, duration) : null;
        if (contour) {
          const down = toMono(channels.left, channels.right);
          const level = loudnessCurve(down, DEMUCS_SAMPLE_RATE, contour.fps);
          contour.level = level.slice(0, contour.midi.length);
          targetRms = voicedRms(down, contour, DEMUCS_SAMPLE_RATE);
        }
        const placed = placeInRegister(notes, contour, instrumentId);
        notes = placed.notes;
        contour = placed.contour;
        octaves = placed.octaves;
      }
      const k = estimateKey(chromaFromNotes(notes));
      const part = addPart({
        source: sourceName,
        instrument: instrumentId,
        notes,
        tonicPc: k.tonic,
        fifths: k.fifths,
        keyName: k.name,
        keyMode: k.mode,
        ...(mono ? { monophonic: true, octaves } : {}),
        ...(contour ? { contour } : {}),
      });
      if (targetRms && targetRms > 0) targetRmsRef.current.set(part.id, targetRms);
      const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1);
      const how = fromCache
        ? "reused an earlier pass"
        : `took ${elapsed}s${lastTranscriptionRanIn() === "worker" ? "" : " (on the page — this browser would not run it in the background)"}`;
      const moved = octaves ? ` • moved ${Math.abs(octaves)} ${Math.abs(octaves) === 1 ? "octave" : "octaves"} ${octaves > 0 ? "up" : "down"}` : "";
      setLog(`${notes.length} notes • ${k.name} • ${settings.bpm} BPM${moved} • ${how}`);
      return part;
    } catch (e) {
      if (current()) setError(e instanceof Error ? e.message : "transcription failed");
      return null;
    } finally {
      if (current()) setBusy(null);
    }
  }

  function addPart(p: Omit<Part, "id">): Part {
    resetEdits();
    const part: Part = { ...p, id: `${p.instrument}-${p.source}-${parts.length}-${partSeq.current++}` };
    setParts((list) => [...list, part]);
    return part;
  }

  function removePart(id: string) {
    resetEdits();
    if (soloed === `guide:${id}`) setSoloed(null);
    setParts((list) => list.filter((p) => p.id !== id));
  }

  /**
   * Re-targeting a part also moves it by octaves onto the new instrument, if it needs it. A
   * single line moves as a whole into the instrument's singing register, its curve with it.
   */
  function setPartInstrument(id: string, instrument: InstrumentId) {
    setParts((list) =>
      list.map((p) => {
        if (p.id !== id) return p;
        if (!p.monophonic) return { ...p, instrument, notes: fitToRange(p.notes, INSTRUMENTS[instrument].range) };
        const placed = placeInRegister(p.notes, p.contour ?? null, instrument);
        const { contour: _old, ...rest } = p;
        return {
          ...rest,
          instrument,
          notes: placed.notes,
          ...(placed.contour ? { contour: placed.contour } : {}),
          octaves: (p.octaves ?? 0) + placed.octaves,
        };
      })
    );
  }

  /** One note at a time for a part written with chords in it; undoable. */
  function makeSingleLine(id: string) {
    const part = parts.find((p) => p.id === id);
    if (!part || part.monophonic) return;
    rememberForUndo();
    const notes = cleanMonoLine(part.notes);
    setParts((list) => list.map((p) => (p.id === id ? { ...p, notes, monophonic: true } : p)));
    setLog(`${INSTRUMENTS[part.instrument].label} now plays one note at a time (${notes.length} notes). Undo puts the chords back.`);
  }

  /**
   * "Replace the voice": split the song (or use the split there is), write the vocal line for
   * `instrumentId`, mute the singer and play the instrument in their place.
   */
  async function replaceVoice(instrumentId: InstrumentId, quality: "quick" | "clean") {
    if (!audio || busy) return;
    const wanted: StemMode = quality === "quick" ? "instant" : "ai";
    const set = stems && (stemMode === wanted || stemMode === "ai")
      ? stems
      : quality === "quick" ? await splitInstant() : await aiSplitChecked();
    if (!set) return;
    const part = await transcribeFrom(set.vocals, "vocals", instrumentId, { monophonic: true });
    if (!part) return;
    const guide = `guide:${part.id}`;
    setMix((m) => ({
      ...m,
      vocals: { gain: m.vocals?.gain ?? 1, muted: true },
      [guide]: { gain: 0.85, muted: false },
    }));
    if (soloed) setSoloed(null);
    setSource("vocals");
    const label = INSTRUMENTS[instrumentId].label;
    setLog(`${label} now plays the vocal line. Use "Hear the singer" to compare.`);
  }

  /** The newest part written from the vocal as a single line: the one "Hear the singer" swaps with. */
  const voicePart = useMemo(
    () => [...parts].reverse().find((p) => p.source === "vocals" && p.monophonic) ?? null,
    [parts]
  );
  const singerAudible = !(mix.vocals?.muted ?? false);

  /** Swap between hearing the singer and hearing the instrument that replaced them. */
  function toggleSinger() {
    if (!voicePart) return;
    const guide = `guide:${voicePart.id}`;
    const singer = !singerAudible;
    setMix((m) => ({
      ...m,
      vocals: { gain: m.vocals?.gain ?? 1, muted: !singer },
      [guide]: { gain: m[guide]?.gain ?? 0.85, muted: singer },
    }));
  }

  /**
   * Turn one polyphonic line into an ensemble.
   *
   * Stem separation cannot hand you the individual players — "everything else"
   * is every harmony instrument at once. What it can do is split that harmony
   * into separate voices and give each one to an instrument, which is arranging
   * rather than un-mixing. Said plainly in the UI.
   */
  function arrangeForEnsemble(id: string, size: number) {
    const part = parts.find((p) => p.id === id);
    if (!part) return;
    const ensemble = ENSEMBLES[size] ?? ENSEMBLES[4];
    const voices = splitVoices(part.notes, ensemble.length).filter((v) => v.notes.length);
    // fewer lines than players: spread them across the group rather than
    // stacking everyone on the top seats
    const chosen = spreadSeats(ensemble, voices.length);
    const made: Part[] = [];
    voices.forEach((v, i) => {
      if (!v.notes.length) return;
      const instrument = chosen[i] ?? ensemble[ensemble.length - 1];
      made.push({
        id: `${instrument}-${part.source}-voice${i}-${partSeq.current++}`,
        source: part.source,
        instrument,
        notes: fitToRange(v.notes, INSTRUMENTS[instrument].range),
        fifths: part.fifths,
        keyName: part.keyName,
        keyMode: part.keyMode,
      });
    });
    if (!made.length) {
      setError("There was nothing to split into voices.");
      return;
    }
    resetEdits();
    setParts((list) => [...list.filter((p) => p.id !== id), ...made]);
    setLog(`Arranged into ${made.length} parts: ${made.map((m) => INSTRUMENTS[m.instrument].label).join(", ")}.`);
  }

  /** Every part, quantised and fretted, ready to engrave. */
  const partSheets = useMemo(() => engraveParts(parts, settings), [parts, settings]);

  const sheet: Sheet | null = partSheets[0]?.sheet ?? null;

  /**
   * Where bar 1 of the score starts. Earlier than the offset setting when the
   * music has a pickup, so take marks and loops count bars the way the score does.
   */
  const barLineSeconds = sheet?.offsetSeconds ?? settings.offsetSeconds;

  // when each written beat sounds, so the play-along highlight can follow the
  // top staff — the one a player is most likely reading
  const timeline = useMemo(
    () => (sheet ? slotTimeline(sheet, settings.offsetSeconds) : []),
    [sheet, settings.offsetSeconds]
  );

  const tex = useMemo(
    () =>
      partsToTex(
        partSheets,
        settings,
        file?.name.replace(/\.[^.]+$/, "") || "Riffscribe transcription"
      ),
    [partSheets, settings, file]
  );

  /**
   * The key as heard, and the key it is being written in.
   *
   * Lydia's ask: choose the key and have the parts come out in it. The two are
   * the same until someone transposes; keeping both means the picker can show
   * which one the recording actually is.
   */
  const soundingTonic = useMemo(() => {
    const p0 = parts[0];
    if (!p0) return 0;
    if (typeof p0.tonicPc === "number") return ((p0.tonicPc % 12) + 12) % 12;
    const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    const name = (p0.keyName || "C").trim();
    let pc = base[name.charAt(0).toUpperCase()] ?? 0;
    if (name.charAt(1) === "#") pc += 1;
    if (name.charAt(1) === "b") pc -= 1;
    return ((pc % 12) + 12) % 12;
  }, [parts]);

  const writtenTonic = useMemo(
    () => (parts.length ? (((soundingTonic + settings.transposeSemitones) % 12) + 12) % 12 : null),
    [parts.length, soundingTonic, settings.transposeSemitones]
  );

  /* ------------------------------------------------------- fixing the notes */

  /**
   * Which notes of the top part sound during the selected beat.
   *
   * The score, the play-along highlight and this all read the same first staff,
   * so a beat index means the same thing to all three.
   */
  const pickedNotes = useMemo(() => {
    if (pickedBeat == null || !timeline[pickedBeat] || !parts[0]) return [];
    const { start, end } = timeline[pickedBeat];
    return parts[0].notes.filter((n) => n.startTimeSeconds >= start - 1e-3 && n.startTimeSeconds < end - 1e-3);
  }, [pickedBeat, timeline, parts]);

  /** A way to choose a beat without the mouse: the score itself only answers clicks. */
  function stepBeat(dir: 1 | -1) {
    if (!timeline.length) return;
    setPickedBeat((b) => (b == null ? (dir > 0 ? 0 : timeline.length - 1) : Math.max(0, Math.min(timeline.length - 1, b + dir))));
  }

  function rememberForUndo() {
    setUndoStack((s) => [...s.slice(-19), parts.map((p) => ({ ...p, notes: [...p.notes] }))]);
  }

  function undoEdit() {
    const last = undoStack[undoStack.length - 1];
    if (!last) return;
    setParts(last);
    setUndoStack(undoStack.slice(0, -1));
    setLog("Put that back.");
  }

  /**
   * Move the selected notes by semitones. A note the move would take outside
   * the instrument stays where it is: landing it on the range edge instead
   * turned "octave up" into some other interval, or even a move down.
   */
  function nudgePicked(semitones: number) {
    if (!pickedNotes.length || !parts[0]) return;
    const inst = INSTRUMENTS[parts[0].instrument];
    const fits = (n: NoteEvent) => n.pitchMidi + semitones >= inst.range[0] && n.pitchMidi + semitones <= inst.range[1];
    const moving = new Set(pickedNotes.filter(fits));
    const stayed = pickedNotes.length - moving.size;
    if (!moving.size) {
      setLog(`That would take ${pickedNotes.length === 1 ? "it" : "them"} ${semitones > 0 ? "above" : "below"} the ${inst.label}'s range.`);
      return;
    }
    rememberForUndo();
    setParts((list) =>
      list.map((p, i) =>
        i !== 0
          ? p
          : { ...p, notes: p.notes.map((n) => (moving.has(n) ? { ...n, pitchMidi: n.pitchMidi + semitones } : n)) }
      )
    );
    const dir = semitones > 0 ? "up" : "down";
    setLog(
      stayed
        ? `Moved ${moving.size} ${moving.size === 1 ? "note" : "notes"} ${dir}; ${stayed} stayed because ${stayed === 1 ? "it" : "they"} would leave the range.`
        : `Moved ${moving.size === 1 ? "that note" : `those ${moving.size} notes`} ${dir}.`
    );
  }

  function deletePicked() {
    if (!pickedNotes.length || !parts[0]) return;
    const picked = new Set(pickedNotes);
    rememberForUndo();
    setParts((list) => list.map((p, i) => (i !== 0 ? p : { ...p, notes: p.notes.filter((n) => !picked.has(n)) })));
    setPickedBeat(null);
    setLog(`Removed ${picked.size === 1 ? "a note the model imagined" : `${picked.size} notes`}.`);
  }

  /* ----------------------------------------------------------------- record */

  /**
   * The microphone is open only while a take is being recorded: it is opened here, on the press,
   * and closed again in stopRecording, so the browser's recording light is not left on.
   */
  async function startRecording() {
    const engine = engineRef.current;
    if (!engine || !recorderRef.current) return;
    if (countRef.current) return; // a count-in is already running
    // Start the audio context inside the press: after the permission prompt and a count-in the
    // gesture has expired and iOS Safari would leave it suspended.
    engine.warm();
    try {
      await recorderRef.current.arm();
    } catch {
      setError("Microphone permission denied — allow it in the browser to record.");
      return;
    }
    setError(null);
    // The same count-in as playback, so the take can come in on the beat.
    if (countInBars > 0) {
      const token = {};
      countToken.current = token;
      setCounting(true);
      const c = countIn(settings.bpm, transport.rate, settings.timeSignature[0], countInBars);
      countRef.current = c;
      await c.done;
      if (countToken.current !== token) {
        // cancelled while counting: no take, and the microphone closes again
        recorderRef.current.release();
        return;
      }
      countToken.current = null;
      countRef.current = null;
      setCounting(false);
    }
    try {
      await engine.play();
      recorderRef.current.start();
    } catch (e) {
      recorderRef.current.release();
      setError(e instanceof Error ? e.message : "could not start recording");
      return;
    }
    recStartRef.current = engine.state().time;
    recLoopRef.current = engine.state().loop;
    setRecording(true);
  }

  async function stopRecording() {
    const engine = engineRef.current;
    if (!engine || !recorderRef.current) return;
    setRecording(false);
    let blob: Blob;
    try {
      blob = await recorderRef.current.stop();
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not stop the recording");
      return;
    } finally {
      recorderRef.current.release();
    }
    await engine.pause();
    setBusy({ label: "Lining your take up with the song…" });
    try {
      const buf = await fileToAudioBuffer(blob);
      const stereo = await toStereo(buf, DEMUCS_SAMPLE_RATE);
      const rate = engine.state().rate;
      // recorded in real time; convert to song time so it fits the timeline
      const [l, r] = await stretchOffline([stereo.left, stereo.right], DEMUCS_SAMPLE_RATE, 1 / rate);
      const latency = estimateLatency(engine.ctx) * rate;
      const start = Math.max(0, recStartRef.current - latency + nudgeMs / 1000);
      const total = audio ? audio.left.length : l.length;
      const take = { left: l, right: r, startSeconds: start, sampleRate: DEMUCS_SAMPLE_RATE };
      // Recorded over a repeating loop: keep one pass, on the loop, not every pass in a row.
      const loopAt = recLoopRef.current;
      const placed = loopAt ? foldLoopTake(take, loopAt) : take;
      const [pl, pr] = placeTake(placed, total);
      setOverdub({ left: pl, right: pr });
      setReport(null);
      setLog(
        placed !== take
          ? `Take captured at ${Math.round(rate * 100)}% speed. You played the loop more than once, so your last full pass was kept.`
          : `Take captured at ${Math.round(rate * 100)}% speed and mapped back to full tempo.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not process the recording");
    } finally {
      setBusy(null);
    }
  }

  /* ---------------------------------------------------------------- exports */

  const baseName = (file?.name.replace(/\.[^.]+$/, "") || "riffscribe").slice(0, 60);

  function exportMidi() {
    exp.exportMidi(parts, settings.bpm, baseName);
  }

  function exportMusicXml() {
    exp.exportMusicXml(partSheets, settings.capo, baseName);
  }

  function exportTex() {
    exp.exportTex(tex, baseName);
  }

  /** What the audio exports read, as it stands in this render. */
  const audioExport = (): exp.AudioExport => ({
    audio, stems, stemMode, overdub, guideTracks, clickTrack, trackList, mix, activeSolo,
    loop, loopOnlyExport, transport, exportFormat, baseName, setBusy, setError,
  });

  function exportAudio(kind: "backing" | "mix") {
    return exp.exportAudio(audioExport(), kind);
  }

  /** One track on its own — the stem, your part, your take, the click. */
  function exportTrack(id: string) {
    return exp.exportTrack(audioExport(), id);
  }

  /* -------------------------------------------------------------------- UI */

  const mixTracks: MixTrack[] = trackList.map((t) => ({
    id: t.id,
    label: t.label,
    hint: t.hint,
    gain: mix[t.id]?.gain ?? 1,
    muted: mix[t.id]?.muted ?? false,
  }));

  const patch = (p: Partial<TranscriptionSettings>) => setSettings((s) => ({ ...s, ...p }));

  /* --------------------------------------------------- the page assistant */

  // Rebuilt every render so the capabilities always act on current state; the
  // assistant component keeps a ref to the latest copy.
  const assistantActions: AssistantActions = buildAssistantActions({
    audio, file, signedIn, transport, settings, stems, stemMode, parts, loop, busy, trackList, mix, activeSolo,
    overdub, report, engineRef, patch, runInstant, runDemucs, runTranscribe, checkTake, loopWorstBars,
    arrangeForEnsemble, setAiSplitCautionGb, setSource, setLoop, setSoloed, setMix, setExportFormat,
    setEnsembleSize, setPlayAlong, exportMidi, exportMusicXml, exportTex, exportAudio, exportTrack,
  });

  // The assistant is mounted above the pages; it borrows these while the studio is open.
  const actionsRef = useRef(assistantActions);
  actionsRef.current = assistantActions;
  useEffect(() => lendStudio(() => actionsRef.current), []);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="no-print mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Music2 className="text-[var(--color-accent)]" size={22} /> Riffscribe
          </h1>
          <p className="mt-1 text-sm text-white/50">
            Song in, sheet music and tab out. Everything runs on this device.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {/* New tabs: leaving this page would drop the loaded song and any split in progress. */}
          <a className="btn" href="/" target="_blank" rel="noopener">About</a>
          <AccountMenu newTab />
        </div>
      </header>

      <StatusBanners {...{ error, setError, busy, cancelSplitRef, cancelJob }} />

      {/* 1 — load */}
      <LoadPanel {...{ busy, loadFile, file, wantedSong, audio, helperUp, linkUrl, setLinkUrl, loadFromLink, log }} />

      {audio && (
        <Recipes
          busy={busy}
          instrument={recipeInstrument}
          setInstrument={setRecipeInstrument}
          replaceVoice={replaceVoice}
          replacedBy={voicePart ? INSTRUMENTS[voicePart.instrument].label : null}
          singerAudible={singerAudible}
          toggleSinger={toggleSinger}
        />
      )}

      {/*
        With a song loaded, saving sits under the notes it saves (after step 4).
        Without one — a chart opened on a device that lacks the recording — it
        stays up here so the work is still reachable.
      */}
      {!audio && (
        <SaveBar buildChart={buildChart} chartId={chartId} onChartId={linkChart} />
      )}

      {/* Tuning up comes before everything, so this does not wait for a song. */}
      <Tuner suggestedTonic={droneTonic} />

      {audio && (
        <>
          {/* 2 — stems */}
          <SplitPanel {...{
            busy, runInstant, startAiSplit, aiSplitCautionGb, setAiSplitCautionGb, runDemucs, restored, forgetSong,
            mixTracks, activeSolo, setSoloed, exportTrack, setMix, exportAudio, stems, exportFormat, setExportFormat,
            loop, loopOnlyExport, setLoopOnlyExport,
          }} />

          {/* 3 — practise */}
          <PracticePanel {...{
            wavePeaks, transport, loop, engineRef, setLoop, trimToLoop, busy, nameLoop, sections, editingSection,
            setSections, setEditingSection, countInBars, setCountInBars, trainer, setTrainer, setPasses, passes,
          }} />

          {/* 4 — transcribe */}
          <PartsPanel {...{
            source, setSource, stems, stemMode, settings, patch, zoom, setZoom, writtenTonic, parts, soundingTonic,
            runTranscribe, busy, exportMidi, sheet, exportMusicXml, tex, exportTex, playAlong, setPlayAlong,
            setPartInstrument, arrangeForEnsemble, ensembleSize, removePart, setEnsembleSize, transport, timeline,
            setPickedBeat, pickedBeat, pickedNotes, nudgePicked, deletePicked, stepBeat, undoStack, undoEdit,
            makeSingleLine,
          }} />

          <SaveBar buildChart={buildChart} chartId={chartId} onChartId={linkChart} />

          {/* 5 — record */}
          <RecordPanel {...{
            recording, stopRecording, startRecording, busy, overdub, setOverdub, nudgeMs, setNudgeMs, parts,
            checkTake, checkPart, setCheckPart, report, loopWorstBars,
          }} />
        </>
      )}

      {/*
        The transport, always within reach. A player holding an instrument
        cannot go hunting up the page for the play button, and the score is
        long — so it follows you down the page instead.
      */}
      {audio && (
        <PlayerBar
          {...{ startPlaying, counting, transport, engineRef, loop, setLoop, trainer }}
          onRate={(r) => void engineRef.current?.setRate(r)}
          onSemitones={(s) => void engineRef.current?.setSemitones(s)}
        />
      )}
      {audio && <div className="no-print h-20" style={{ paddingBottom: "env(safe-area-inset-bottom)" }} aria-hidden />}

      <footer className="no-print pb-10 pt-4 text-center text-xs text-white/30">
        Basic Pitch (Spotify, Apache-2.0) · Demucs (Meta, MIT) · alphaTab (MPL-2.0) · Signalsmith Stretch (MIT)
      </footer>
    </div>
  );
}
