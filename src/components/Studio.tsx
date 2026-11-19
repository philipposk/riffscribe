"use client";
/**
 * The whole app. Five steps, top to bottom:
 *   1. load a song           4. practise (speed / key / loop)
 *   2. split it into stems   5. record yourself over it
 *   3. transcribe to score + tab
 * Every step runs locally in the browser — no upload, no account, no queue.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bookmark, Check, ChevronDown, ChevronUp, Download, FileMusic, Link as LinkIcon, Loader2, Mic,
  Music2, Pause, Play, Printer, Repeat, RotateCcw, Scissors, Square, Target,
  Trash2, Undo2,
  Upload, Users, Wand2,
} from "lucide-react";

import { useSearchParams } from "next/navigation";
import type { AssistantActions } from "./Assistant";
import { lendStudio } from "@/lib/assistantBridge";
import Mixer, { type MixTrack } from "./Mixer";
import SaveBar from "./SaveBar";
import Tuner from "./Tuner";
import { HANDOFF_ID_KEY, HANDOFF_KEY } from "./SharedChart";
import AccountMenu from "./AccountMenu";
import { useAccount } from "@/lib/store/account";
import { findSong, lastSong, rememberSong } from "@/lib/store/lastSong";
import ScoreView from "./ScoreView";
import Transport from "./Transport";
import Waveform from "./Waveform";

import { fileToAudioBuffer, peaks as peaksOf, toMono, toStereo } from "@/lib/audio/decode";
import {
  estimateKey, estimateTempo, chromaFromNotes, noteName, PITCH_NAMES,
} from "@/lib/audio/analyze";
import { PracticeEngine, makeClickTrack, type EngineTrack } from "@/lib/audio/engine";
import { countIn, countInSeconds } from "@/lib/audio/countin";
import { MicRecorder, estimateLatency, foldLoopTake, placeTake, stretchOffline } from "@/lib/audio/recorder";
import {
  DEMUCS_SAMPLE_RATE, SPLIT_PAUSED, mixStems, partialKey, separateInstantAsync, separateResumable, type StemSet,
} from "@/lib/audio/stems";
import { synthesizeGuide } from "@/lib/audio/guide";
import {
  forget, getScore, getSession, getStems, packTrack, putScore, putSession, putStems, requestPersistence,
  songKey, unpackTrack,
} from "@/lib/store/cache";
import { clearBlocks, doneBlocks, getBlock, putBlock } from "@/lib/store/partialSplit";
import { encodeMp3 } from "@/lib/audio/mp3";
import { downloadBlob, encodeWav } from "@/lib/audio/wav";
import {
  channelsToAudioBuffer, lastTranscriptionRanIn, toModelInput, transcribeAudio,
} from "@/lib/transcribe/basicPitch";
import { partsToMidi } from "@/lib/transcribe/midi";
import { sheetsToMusicXml } from "@/lib/transcribe/musicxml";
import { slotTimeline, type Sheet } from "@/lib/transcribe/quantize";
import { barsToLoop, barsToRange, chartInWindow, markTake, summarise, takeSpan, type TakeReport } from "@/lib/transcribe/compare";
import { consolidateMonophonic } from "@/lib/transcribe/cleanup";
import { engraveParts, partsToTex } from "@/lib/transcribe/engrave";
import { keyChoices, keyName, shortestShift } from "@/lib/transcribe/spelling";
import { isNativePlatform, nativeDeviceMemoryGb } from "@/lib/native";
import {
  keepChartLink, liveSolo, readSavedSettings, settingsOnLoad, trainerStep,
} from "@/lib/studioState";
import { CHART_VERSION, loadChart, type Chart } from "@/lib/store/charts";
import { extractMelody, fitToRange, playsSingleLine, splitVoices, spreadSeats } from "@/lib/transcribe/voices";
import {
  DEFAULT_SETTINGS, INSTRUMENTS, STEM_NAMES, type InstrumentId, type NoteEvent, type Part,
  type TranscriptionSettings,
} from "@/lib/types";

type Busy = { label: string; value?: number } | null;
type StemMode = "none" | "instant" | "ai";
type Source = "mix" | "vocals" | "drums" | "bass" | "other";

const STEM_LABEL: Record<string, { label: string; hint: string }> = {
  vocals: { label: "Vocals", hint: "lead + backing voices" },
  drums: { label: "Drums", hint: "kit and percussion" },
  bass: { label: "Bass", hint: "bass guitar / synth bass" },
  other: { label: "Everything else", hint: "guitars, keys, strings" },
  original: { label: "Song", hint: "the original mix" },
  click: { label: "Click", hint: "metronome, follows the speed" },
  overdub: { label: "Your take", hint: "what you recorded" },
  guide: { label: "Your part", hint: "the transcription, played back" },
};

/** Which instruments a voice split is handed to, top line first. */
const ENSEMBLES: Record<number, InstrumentId[]> = {
  2: ["violin", "cello"],
  3: ["violin", "viola", "cello"],
  4: ["violin", "violin", "viola", "cello"],
  5: ["violin", "violin", "viola", "cello", "double-bass"],
};

/** "bar 4" or "bars 3–5", for a run of bar numbers in order. */
const barsLabel = (bars: number[]) =>
  bars.length === 1 ? `bar ${bars[0]}` : `bars ${bars[0]}–${bars[bars.length - 1]}`;

/** Picking an instrument also picks its usual single-line setting, which can still be changed. */
const instrumentPatch = (id: InstrumentId): Partial<TranscriptionSettings> => ({
  instrument: id,
  monophonic: playsSingleLine(INSTRUMENTS[id]),
});

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
  const [ensembleSize, setEnsembleSize] = useState(4);
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
  /** Synthesised guide per part object, so editing one part does not re-synthesise the others. */
  const guideCache = useRef(new WeakMap<Part, { audio: unknown; track: { id: string; left: Float32Array; right: Float32Array } }>());
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
        setSource("other");
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
      parts,
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
   * the guide together with the backing. Parts are immutable, so an unchanged part object
   * reuses its earlier synthesis (and the engine then does not re-render it either).
   */
  const guideTracks = useMemo(() => {
    if (!audio) return [] as { id: string; left: Float32Array; right: Float32Array }[];
    return parts.map((part) => {
      const hit = guideCache.current.get(part);
      if (hit && hit.audio === audio) return hit.track;
      const [left, right] = synthesizeGuide(part.notes, {
        timbre: INSTRUMENTS[part.instrument].timbre,
        sampleRate: DEMUCS_SAMPLE_RATE,
        lengthSamples: audio.left.length,
      });
      const track = { id: `guide:${part.id}`, left, right };
      guideCache.current.set(part, { audio, track });
      return track;
    });
  }, [audio, parts]);

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
    for (const part of parts) {
      out.push({
        id: `guide:${part.id}`,
        label: `${INSTRUMENTS[part.instrument].label}`,
        hint: `written from ${part.source === "mix" ? "the full mix" : part.source}`,
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
    if (!audio) return false;
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
      if (my !== loadSeq.current) return false;
      setStems(result);
      setStemMode("instant");
      setSource("other");
      setLog("Instant split done. For a cleaner result, run the AI split.");
      return true;
    } catch (e) {
      if (my === loadSeq.current) setError(e instanceof Error ? e.message : "instant split failed");
      return false;
    } finally {
      if (my === loadSeq.current) setBusy(null);
    }
  }

  async function runDemucs(): Promise<boolean> {
    if (!audio) return false;
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
      if (!current()) return false;
      setStems(result);
      setStemMode("ai");
      setSource("other");
      setAiSplitCautionGb(null);
      setLog("Four stems ready. Mute what you don't want to hear.");
      return true;
    } catch (e) {
      if (!current()) return false;
      if (e instanceof Error && e.message === SPLIT_PAUSED) return false;
      const detail = e instanceof Error && e.message ? e.message : "stem separation failed";
      const native = await isNativePlatform();
      setError(
        native
          ? `This phone could not finish the AI stem split. The desktop site is the reliable place for it. Instant vocal removal still works on this phone. (${detail})`
          : detail,
      );
      return false;
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
  async function startAiSplit() {
    const mem = await nativeDeviceMemoryGb();
    if (mem != null && mem <= 4) {
      setAiSplitCautionGb(mem);
      return;
    }
    await runDemucs();
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
    const inst = INSTRUMENTS[settings.instrument];
    setError(null);
    setBusy({ label: "Listening for notes…", value: 0 });
    const startedAt = performance.now();
    const variant = `${which}:${settings.instrument}:${settings.onsetThreshold}:${settings.frameThreshold}:${settings.minNoteLength}`;
    try {
      const store = workKey();
      let found = store ? await getScore<NoteEvent[]>(store, variant) : null;
      const fromCache = !!found;
      if (!found) {
        const buffer = channelsToAudioBuffer([src.left, src.right], DEMUCS_SAMPLE_RATE);
        const mono22 = await toModelInput(buffer);
        found = await transcribeAudio(mono22, {
          onsetThreshold: settings.onsetThreshold,
          frameThreshold: settings.frameThreshold,
          minNoteLength: settings.minNoteLength,
          minMidi: inst.range[0],
          maxMidi: inst.range[1],
          onProgress: (p) => setBusy({ label: "Listening for notes…", value: p }),
        });
        if (store) void putScore(store, variant, found);
      }
      // A single line keeps one note at a time, chosen by loudness rather than
      // height, with re-triggered held notes joined back up — done here so the
      // sheet, the guide and the take marker all read the same notes.
      const notes = settings.monophonic ? consolidateMonophonic(extractMelody(found)) : found;
      const k = estimateKey(chromaFromNotes(notes));
      addPart({
        source: which,
        instrument: settings.instrument,
        notes,
        tonicPc: k.tonic,
        fifths: k.fifths,
        keyName: k.name,
        keyMode: k.mode,
      });
      const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1);
      const how = fromCache
        ? "reused an earlier pass"
        : `took ${elapsed}s${lastTranscriptionRanIn() === "worker" ? "" : " (on the page — this browser would not run it in the background)"}`;
      setLog(`${notes.length} notes • ${k.name} • ${settings.bpm} BPM • ${how}`);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "transcription failed");
      return false;
    } finally {
      setBusy(null);
    }
  }

  function addPart(p: Omit<Part, "id">) {
    resetEdits();
    setParts((list) => [
      ...list,
      { ...p, id: `${p.instrument}-${p.source}-${list.length}-${partSeq.current++}` },
    ]);
  }

  function removePart(id: string) {
    resetEdits();
    if (soloed === `guide:${id}`) setSoloed(null);
    setParts((list) => list.filter((p) => p.id !== id));
  }

  /** Re-targeting a part also moves it by octaves into the new instrument's range, if it needs it. */
  function setPartInstrument(id: string, instrument: InstrumentId) {
    setParts((list) =>
      list.map((p) => (p.id === id ? { ...p, instrument, notes: fitToRange(p.notes, INSTRUMENTS[instrument].range) } : p))
    );
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
    try {
      await recorderRef.current.arm();
    } catch {
      setError("Microphone permission denied — allow it in the browser to record.");
      return;
    }
    setError(null);
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
    if (!parts.length) return;
    const bytes = partsToMidi(
      parts.map((p) => ({
        notes: p.notes,
        name: INSTRUMENTS[p.instrument].label,
        program: INSTRUMENTS[p.instrument].gm,
      })),
      { bpm: settings.bpm, name: baseName }
    );
    downloadBlob(new Blob([bytes as unknown as BlobPart], { type: "audio/midi" }), `${baseName}.mid`);
  }

  function exportMusicXml() {
    if (!partSheets.length) return;
    const xml = sheetsToMusicXml(
      partSheets.map(({ sheet: sh, instrument, fifths, clef }) => ({
        sheet: sh,
        options: {
          instrument,
          fifths,
          clef,
          capo: settings.capo,
          partName: instrument.label,
        },
      })),
      { title: baseName }
    );
    downloadBlob(new Blob([xml], { type: "application/vnd.recordare.musicxml+xml" }), `${baseName}.musicxml`);
  }

  function exportTex() {
    if (!tex) return;
    downloadBlob(new Blob([tex], { type: "text/plain" }), `${baseName}.alphatex`);
  }

  /** Every track that currently exists, keyed the same way as the mixer. */
  function allParts(): Record<string, { left: Float32Array; right: Float32Array }> {
    const mixParts: Record<string, { left: Float32Array; right: Float32Array }> = stems
      ? { ...stems }
      : audio
        ? { original: audio }
        : {};
    if (overdub) mixParts.overdub = overdub;
    for (const g of guideTracks) mixParts[g.id] = { left: g.left, right: g.right };
    if (clickTrack) mixParts.click = clickTrack;
    return mixParts;
  }

  /** Whole song, or just the looped section when the user asked for that. */
  function exportWindow() {
    const total = audio ? audio.left.length : 0;
    if (!loopOnlyExport || !loop) return { from: 0, to: total, suffix: "" };
    const from = Math.max(0, Math.floor(loop[0] * DEMUCS_SAMPLE_RATE));
    const to = Math.min(total, Math.floor(loop[1] * DEMUCS_SAMPLE_RATE));
    return { from, to, suffix: `-${Math.round(loop[0])}s-${Math.round(loop[1])}s` };
  }

  /** Slice the loop if asked, then bake the current practice speed and key. */
  async function prepareExport(channels: { left: Float32Array; right: Float32Array }) {
    const { from, to } = exportWindow();
    const left = from || to < channels.left.length ? channels.left.slice(from, to) : channels.left;
    const right = from || to < channels.right.length ? channels.right.slice(from, to) : channels.right;
    const { rate, semitones } = transport;
    if (Math.abs(rate - 1) < 1e-4 && semitones === 0) return { left, right };
    const [l, r] = await stretchOffline([left, right], DEMUCS_SAMPLE_RATE, rate, semitones);
    return { left: l, right: r };
  }

  async function downloadChannels(channels: { left: Float32Array; right: Float32Array }, name: string) {
    const { suffix } = exportWindow();
    const needsBake = Math.abs(transport.rate - 1) >= 1e-4 || transport.semitones !== 0;
    if (needsBake) setBusy({ label: "Rendering export at your practice speed and key…" });
    try {
      const baked = await prepareExport(channels);
      const blob =
        exportFormat === "mp3"
          ? encodeMp3([baked.left, baked.right], DEMUCS_SAMPLE_RATE)
          : encodeWav([baked.left, baked.right], DEMUCS_SAMPLE_RATE);
      downloadBlob(blob, `${baseName}-${name}${suffix}.${exportFormat}`);
    } finally {
      if (needsBake) setBusy(null);
    }
  }

  async function exportAudio(kind: "backing" | "mix") {
    if (!audio) return;
    const length = audio.left.length;

    if (kind === "backing" && stems) {
      // everything except the vocals, at full level, whatever the faders say
      const keys = stemMode === "instant" ? ["other"] : ["drums", "bass", "other"];
      setError(null);
      await downloadChannels(mixStems(stems, keys, { length }), "backing");
      return;
    }

    const parts = allParts();
    const gains: Record<string, number> = {};
    const audible = trackList
      .map((t) => t.id)
      .filter((id) => {
        if (!parts[id]) return false;
        const m = mix[id] ?? { gain: 1, muted: false };
        if (m.muted || (activeSolo !== null && activeSolo !== id)) return false;
        gains[id] = m.gain;
        return true;
      });

    if (!audible.length) {
      setError("Everything is muted or soloed out — nothing to export.");
      return;
    }
    setError(null);
    await downloadChannels(mixStems(parts, audible, { length, gains }), "mix");
  }

  /** One track on its own — the stem, your part, your take, the click. */
  async function exportTrack(id: string) {
    const part = allParts()[id];
    if (!part) return;
    setError(null);
    await downloadChannels(part, id);
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

  const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

  // Rebuilt every render so the capabilities always act on current state; the
  // assistant component keeps a ref to the latest copy.
  const assistantActions: AssistantActions = {
    describe: () => {
      if (!audio) {
        return "No song is loaded yet — drop a file into step 1 first." +
          (signedIn ? " Or open one of [your saved songs](/songs)." : "");
      }
      const lines: string[] = [
        `${file?.name ?? "A song"}, ${fmtTime(transport.duration)} long, at ${settings.bpm} BPM.`,
        stems
          ? stemMode === "ai"
            ? "It has been split into four stems."
            : "The centre channel has been pulled out."
          : "It has not been split into stems.",
        parts.length
          ? `${parts.length} part${parts.length > 1 ? "s are" : " is"} written out: ${parts
              .map((p) => `${INSTRUMENTS[p.instrument].label} (${p.notes.length} notes, ${p.keyName})`)
              .join(", ")}.`
          : "Nothing has been transcribed yet.",
        `Playing at ${Math.round(transport.rate * 100)}%${transport.semitones ? `, transposed ${transport.semitones > 0 ? "+" : ""}${transport.semitones}` : ""}.`,
        loop ? `Looping ${fmtTime(loop[0])} to ${fmtTime(loop[1])}.` : "No loop is set.",
      ];
      return lines.join(" ");
    },

    setInstrument: (id) => {
      if (!(id in INSTRUMENTS)) return `I do not know an instrument called "${id}".`;
      patch(instrumentPatch(id as InstrumentId));
      return `The part is now written for ${INSTRUMENTS[id as InstrumentId].label}.`;
    },

    splitStems: async (mode) => {
      if (!audio) return "Load a song first.";
      if (busy) return "Something else is already running.";
      if (mode === "instant") {
        return (await runInstant())
          ? "Instant split done — vocal and backing are separate rows in the mixer."
          : "The instant split did not work — the reason is shown on the page.";
      }
      const mem = await nativeDeviceMemoryGb();
      if (mem != null && mem <= 4) {
        setAiSplitCautionGb(mem);
        return `This phone reports about ${mem} GB of memory. AI stem split may fail here — the warning on the page can continue anyway. Instant vocal removal still works. The desktop site is the reliable place for the AI split.`;
      }
      return (await runDemucs())
        ? "The AI split finished — vocals, drums, bass and everything else are separate rows now."
        : "The AI split did not finish — it was paused or failed; the page says which. Finished parts are kept.";
    },

    transcribe: async (src) => {
      if (!audio) return "Load a song first.";
      if (busy) return "Something else is already running.";
      let from: Source | undefined;
      if (src) {
        const wanted = src.toLowerCase().trim();
        const have: string[] = !stems ? [] : stemMode === "ai" ? [...STEM_NAMES] : ["vocals", "other"];
        if (wanted !== "mix" && !have.includes(wanted)) {
          return stems
            ? `There is no "${src}" source here. Available: mix${have.length ? `, ${have.join(", ")}` : ""}.`
            : `There is no "${src}" source yet — split the song into stems first, or transcribe the full mix.`;
        }
        from = wanted as Source;
        setSource(from);
      }
      return (await runTranscribe(from))
        ? `Written out for ${INSTRUMENTS[settings.instrument].label}.`
        : "That did not work — the reason is shown on the page.";
    },

    setTempo: (bpm) => { patch({ bpm: Math.max(30, Math.min(300, bpm)) }); return `Tempo set to ${Math.round(bpm)} BPM.`; },
    setGrid: (d) => { patch({ quantizeDivision: d as 4 | 8 | 16 | 32 }); return `Notes now snap to a 1/${d} grid.`; },
    setCapo: (fret) => { patch({ capo: Math.max(0, Math.min(9, Math.round(fret))) }); return `Capo at fret ${Math.round(fret)}.`; },
    setWrittenTranspose: (st) => { patch({ transposeSemitones: Math.max(-12, Math.min(12, Math.round(st))) }); return `Written part transposed by ${Math.round(st)} semitones.`; },

    play: async () => { await engineRef.current?.play(); return "Playing."; },
    pause: async () => { await engineRef.current?.pause(); return "Paused."; },
    seek: async (sec) => { await engineRef.current?.seek(sec); return `Jumped to ${fmtTime(sec)}.`; },

    setSpeed: async (percent) => {
      const rate = Math.max(0.25, Math.min(1.5, percent / 100));
      await engineRef.current?.setRate(rate);
      return `Speed set to ${Math.round(rate * 100)}% — the key is unchanged.`;
    },
    setKeyShift: async (st) => {
      await engineRef.current?.setSemitones(st);
      return `Everything shifted by ${Math.round(st)} semitones — the tempo is unchanged.`;
    },

    setLoop: async (from, to) => {
      const a = Math.max(0, Math.min(from, to));
      const b = Math.min(transport.duration, Math.max(from, to));
      setLoop([a, b]);
      return `Looping ${fmtTime(a)} to ${fmtTime(b)}.`;
    },
    clearLoop: async () => { setLoop(null); return "Loop cleared."; },

    setTrack: (track, change) => {
      const id = trackList.find((t) => t.id === track || t.label.toLowerCase().includes(track.toLowerCase()))?.id;
      if (!id) return `There is no track called "${track}". The mixer has: ${trackList.map((t) => t.id).join(", ")}.`;
      const done: string[] = [];
      if (change.solo != null) { setSoloed(change.solo ? id : null); done.push(change.solo ? "soloed" : "un-soloed"); }
      if (change.muted != null || change.level != null) {
        setMix((m) => ({
          ...m,
          [id]: {
            gain: change.level != null ? Math.max(0, Math.min(1.5, change.level / 100)) : (m[id]?.gain ?? 1),
            muted: change.muted != null ? change.muted : (m[id]?.muted ?? false),
          },
        }));
        if (change.muted != null) done.push(change.muted ? "muted" : "un-muted");
        if (change.level != null) done.push(`set to ${Math.round(change.level)}`);
      }
      return `${trackList.find((t) => t.id === id)!.label} ${done.join(" and ") || "unchanged"}.`;
    },

    exportFile: (what) => {
      const w = what.toLowerCase();
      if (w.includes("mp3")) setExportFormat("mp3");
      else if (w.includes("wav")) setExportFormat("wav");
      if (w.includes("midi")) { exportMidi(); return "MIDI downloaded."; }
      if (w.includes("xml")) { exportMusicXml(); return "MusicXML downloaded."; }
      if (w.includes("tex")) { exportTex(); return "alphaTex downloaded."; }
      if (w.includes("pdf") || w.includes("print")) { window.print(); return "Opened the print dialog."; }
      if (w.includes("backing")) { void exportAudio("backing"); return "Backing track download started — at your current speed and key."; }
      if (w.includes("mix")) { void exportAudio("mix"); return "Mix download started — at your current speed and key."; }
      const track = trackList.find((t) => w.includes(t.id) || w.includes(t.label.toLowerCase()));
      if (track) { void exportTrack(track.id); return `${track.label} download started.`; }
      return `I can export midi, musicxml, alphatex, pdf, wav or mp3 (backing track, current mix, or one of: ${trackList.map((t) => t.id).join(", ")}). Audio exports match your practice speed and key.`;
    },

    checkTake: async () => {
      if (!overdub) return "There is no take to mark yet — record one first.";
      if (!parts.length) return "Nothing to mark it against — transcribe the part first.";
      const r = await checkTake();
      if (typeof r === "string") return r;
      if (!r) return "That take could not be marked.";
      return summarise(r) + (r.worstBars.length ? ` Weakest: ${r.worstBars.map((b) => `bar ${b.bar}`).join(", ")}.` : "");
    },
    loopWeakest: () => {
      if (!report) return "Mark a take first and I will know which bars need the work.";
      if (!report.worstBars.length) return "No bar stands out as weak — take the speed up instead.";
      loopWorstBars();
      return `Looping ${barsLabel(barsToLoop(report.worstBars))}.`;
    },
    arrange: (size) => {
      const target = parts.find((p) => p.source === "other") ?? parts[parts.length - 1];
      if (!target) return "Transcribe a part first — there is nothing to split.";
      setEnsembleSize(size);
      arrangeForEnsemble(target.id, size);
      return `Splitting ${INSTRUMENTS[target.instrument].label} into ${size} voices.`;
    },

    setPlayAlong: (on) => { setPlayAlong(on); return on ? "The score will follow the music." : "The score will stay put."; },

    pageState: () => ({
      songLoaded: !!audio,
      fileName: file?.name ?? null,
      durationSeconds: Math.round(transport.duration),
      stems: stems ? (stemMode === "ai" ? ["vocals", "drums", "bass", "other"] : ["vocals", "other"]) : [],
      transcribed: parts.length > 0,
      parts: parts.map((p) => ({
        id: p.id,
        instrument: p.instrument,
        source: p.source,
        noteCount: p.notes.length,
        key: p.keyName,
      })),
      nextInstrument: settings.instrument,
      bpm: settings.bpm,
      playing: transport.playing,
      positionSeconds: Math.round(transport.time),
      speedPercent: Math.round(transport.rate * 100),
      transposeSemitones: transport.semitones,
      loop: loop ? { from: Math.round(loop[0]), to: Math.round(loop[1]) } : null,
      mixerTracks: trackList.map((t) => ({
        id: t.id,
        label: t.label,
        level: Math.round((mix[t.id]?.gain ?? 1) * 100),
        muted: mix[t.id]?.muted ?? false,
        soloed: activeSolo === t.id,
      })),
      busy: busy?.label ?? null,
    }),
  };

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

      {error && (
        <p
          role="alert"
          className="no-print sticky top-2 z-30 mb-5 flex items-start gap-3 rounded-xl border border-red-500/40 bg-red-950/90 px-4 py-3 text-sm text-red-200 backdrop-blur"
        >
          <span className="min-w-0 flex-1">{error}</span>
          <button className="btn shrink-0 py-0.5 text-xs" onClick={() => setError(null)} aria-label="Dismiss this message">
            Dismiss
          </button>
        </p>
      )}
      {busy && (
        <div
          role="status"
          aria-live="polite"
          className="no-print sticky top-2 z-30 mb-5 rounded-xl border border-[var(--color-accent)]/40 bg-[#1a1608]/95 px-4 py-3 text-sm shadow-lg backdrop-blur">
          <p className="flex items-center gap-2 text-[var(--color-accent)]">
            <Loader2 className="animate-spin" size={16} /> {busy.label}
            {cancelSplitRef.current && (
              <button className="btn ml-auto py-1 text-xs" onClick={cancelJob}>
                Cancel
              </button>
            )}
          </p>
          {busy.value != null && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-white/10">
              <div className="h-full bg-[var(--color-accent)] transition-[width]" style={{ width: `${Math.round(busy.value * 100)}%` }} />
            </div>
          )}
        </div>
      )}

      {/* 1 — load */}
      <section className="panel no-print mb-5 p-5">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-medium">
          <span className="step-badge">1</span> Load a song
        </h2>
        <label
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--color-line)] px-4 py-8 text-center hover:border-white/30 focus-within:border-[var(--color-accent)] focus-within:outline focus-within:outline-2 focus-within:outline-[var(--color-accent)]"
          aria-disabled={!!busy || undefined}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            // A split or transcription still running would land on the new song.
            const f = e.dataTransfer.files?.[0];
            if (f && !busy) void loadFile(f);
          }}
        >
          <Upload size={20} className="text-white/50" />
          <span className="text-sm">
            {file ? <b>{file.name}</b> : "Drop an mp3, wav, m4a, flac or ogg here — or click to pick one"}
          </span>
          <span className="text-xs text-white/40">Nothing is uploaded. The file never leaves your browser.</span>
          <input
            type="file" accept=".mp3,.wav,.m4a,.flac,.ogg,.aac,audio/*" className="sr-only"
            disabled={!!busy}
            onChange={(e) => { const f = e.target.files?.[0]; if (f && !busy) void loadFile(f); }}
          />
        </label>
        {wantedSong && !audio && (
          <p className="mt-4 rounded-lg border border-[var(--color-accent)]/40 bg-[#1a1608] px-4 py-3 text-sm">
            Your notes are open. Drop <b>{wantedSong}</b> above to hear it with its stems — the recording
            isn&rsquo;t on this device, and it never leaves the one it was made on.
          </p>
        )}
        {helperUp && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              type="text"
              className="min-w-0 flex-1"
              placeholder="…or paste a link (YouTube, SoundCloud, a direct mp3)"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && linkUrl.trim()) void loadFromLink(linkUrl.trim()); }}
            />
            <button
              className="btn"
              disabled={!linkUrl.trim() || !!busy}
              onClick={() => void loadFromLink(linkUrl.trim())}
            >
              <LinkIcon size={15} /> Fetch
            </button>
          </div>
        )}
        {log && <p className="mt-3 text-xs text-white/45">{log}</p>}
      </section>

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
          <section className="panel no-print mb-5 p-5">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-medium">
              <span className="step-badge">2</span> Split it up / remove the vocals
            </h2>
            <div className="mb-4 flex flex-wrap gap-2">
              <button className="btn" onClick={runInstant} disabled={!!busy}>
                {busy?.label.startsWith("Pulling") ? <Loader2 className="animate-spin" size={15} /> : <Scissors size={15} />}
                Instant vocal removal
              </button>
              <button className="btn btn-primary" onClick={() => void startAiSplit()} disabled={!!busy}>
                {busy && /model|Separating/i.test(busy.label) ? <Loader2 className="animate-spin" size={15} /> : <Wand2 size={15} />}
                {busy && /model|Separating/i.test(busy.label) ? "Separating…" : "AI split into 4 stems"}
              </button>
            </div>
            {aiSplitCautionGb != null && (
              <div className="mb-4 rounded-md border border-amber-400/40 bg-amber-950/40 px-3 py-2 text-xs text-amber-100">
                <p>
                  This phone reports about {aiSplitCautionGb} GB of memory. AI stem split may fail here.
                  The desktop site is the reliable place for it. Instant vocal removal is unaffected.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn py-1 text-xs"
                    disabled={!!busy}
                    onClick={() => { setAiSplitCautionGb(null); void runDemucs(); }}
                  >
                    Continue anyway
                  </button>
                  <button type="button" className="btn py-1 text-xs" onClick={() => setAiSplitCautionGb(null)}>
                    Not now
                  </button>
                </div>
              </div>
            )}
            {restored && (
              <p className="mb-4 flex items-center gap-2 rounded-md border border-[var(--color-accent)]/25 bg-[var(--color-accent)]/10 px-3 py-2 text-xs text-white/70">
                <Check size={14} className="shrink-0 text-[var(--color-accent)]" />
                {restored}
                <button
                  className="ml-auto shrink-0 underline decoration-white/30 underline-offset-2 hover:text-white"
                  onClick={forgetSong}
                >
                  Split it again
                </button>
              </p>
            )}
            <p className="mb-4 text-xs text-white/45">
              Instant is phase-based: no download, about a second, decent on most pop mixes.
              The AI split runs Demucs on your machine — first run pulls a ~180 MB model, then it is cached.
              Stems are kept on this device afterwards, so a song is only ever separated once.
            </p>
            <Mixer
              tracks={mixTracks}
              soloed={activeSolo}
              onSolo={setSoloed}
              onDownload={exportTrack}
              onChange={(id, p) => setMix((m) => ({ ...m, [id]: { ...(m[id] ?? { gain: 1, muted: false }), ...p } }))}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button className="btn" onClick={() => void exportAudio("backing")} disabled={!stems || !!busy}>
                <Download size={15} /> Backing track .{exportFormat}
              </button>
              <button className="btn" onClick={() => void exportAudio("mix")} disabled={!!busy}>
                <Download size={15} /> Current mix .{exportFormat}
              </button>
              <span className="flex rounded-md border border-white/10 p-0.5 text-xs">
                {(["wav", "mp3"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={`rounded px-2 py-1 uppercase ${exportFormat === f ? "bg-white/15 text-white" : "text-white/45 hover:text-white/70"}`}
                    onClick={() => setExportFormat(f)}
                  >
                    {f}
                  </button>
                ))}
              </span>
              <label className={`flex items-center gap-2 text-xs ${loop ? "text-white/60" : "text-white/25"}`}>
                <input
                  type="checkbox" checked={loopOnlyExport} disabled={!loop}
                  onChange={(e) => setLoopOnlyExport(e.target.checked)}
                />
                Only the looped section
              </label>
            </div>
            <p className="mt-2 text-xs text-white/35">
              The arrow on each row downloads that track on its own. Audio exports use your current
              practice speed and key, and your mix and take are kept on this device when you come back.
            </p>
          </section>

          {/* 3 — practise */}
          <section className="panel no-print mb-5 p-5">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-medium">
              <span className="step-badge">3</span> Slow it down
            </h2>
            <Waveform
              peaks={wavePeaks}
              duration={transport.duration}
              time={transport.time}
              loop={loop}
              onSeek={(t) => void engineRef.current?.seek(t)}
              onLoop={setLoop}
            />
            <div className="mb-4 mt-2 flex flex-wrap items-center gap-3">
              <p className="text-xs text-white/40">Drag across the waveform to loop a section.</p>
              <button className="btn text-xs" onClick={trimToLoop} disabled={!loop || !!busy}>
                Trim song to loop
              </button>
              <button className="btn text-xs" onClick={nameLoop} disabled={!loop}>
                <Bookmark size={13} /> Name this section
              </button>
            </div>

            {sections.length > 0 && (
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className="text-xs text-white/40">Sections:</span>
                {sections.map((s, i) => (
                  <span key={`${s.from}-${s.to}-${i}`} className="flex items-center overflow-hidden rounded bg-white/5">
                    {editingSection === i ? (
                      <input
                        autoFocus
                        className="w-28 bg-transparent px-2 py-1 text-xs text-white outline-none"
                        defaultValue={s.name}
                        onBlur={(e) => {
                          const name = e.target.value.trim() || s.name;
                          setSections((l) => l.map((x, j) => (j === i ? { ...x, name } : x)));
                          setEditingSection(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                          if (e.key === "Escape") setEditingSection(null);
                        }}
                      />
                    ) : (
                      <button
                        className="px-2 py-1 text-xs text-white/70 hover:bg-white/10 hover:text-white"
                        onClick={() => { setLoop([s.from, s.to]); void engineRef.current?.seek(s.from); }}
                        onDoubleClick={() => setEditingSection(i)}
                        title={`${fmtTime(s.from)}–${fmtTime(s.to)} — double-click to rename`}
                      >
                        {s.name}
                      </button>
                    )}
                    <button
                      className="px-1.5 py-1 text-xs text-white/25 hover:text-white/70"
                      onClick={() => setSections((l) => l.filter((_, j) => j !== i))}
                      aria-label={`Remove ${s.name}`}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="mb-4 flex flex-wrap items-center gap-4 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2">
              <label className="flex items-center gap-2 text-xs text-white/60">
                Count-in
                <select
                  className="bg-transparent text-xs"
                  value={countInBars}
                  onChange={(e) => setCountInBars(Number(e.target.value))}
                >
                  <option value={0}>off</option>
                  <option value={1}>1 bar</option>
                  <option value={2}>2 bars</option>
                </select>
              </label>

              <label className="flex items-center gap-2 text-xs text-white/60">
                <input
                  type="checkbox"
                  checked={!!trainer}
                  disabled={!loop}
                  onChange={(e) => { setTrainer(e.target.checked ? { step: 0.05, target: 1 } : null); setPasses(0); }}
                />
                Speed trainer
                {trainer && (
                  <>
                    <span className="text-white/35">+5% a pass, up to</span>
                    <select
                      className="bg-transparent text-xs"
                      value={trainer.target}
                      onChange={(e) => setTrainer({ ...trainer, target: Number(e.target.value) })}
                    >
                      <option value={0.75}>75%</option>
                      <option value={0.9}>90%</option>
                      <option value={1}>100%</option>
                      <option value={1.1}>110%</option>
                    </select>
                  </>
                )}
              </label>

              {loop && <span className="text-xs text-white/35">{passes} {passes === 1 ? "pass" : "passes"}</span>}
              {!loop && <span className="text-xs text-white/25">The trainer needs a loop.</span>}
            </div>
            <Transport
              playing={transport.playing}
              time={transport.time}
              duration={transport.duration}
              rate={transport.rate}
              semitones={transport.semitones}
              rendering={transport.rendering}
              loop={loop}
              counting={counting}
              onToggle={() => void startPlaying()}
              onSeek={(t) => void engineRef.current?.seek(t)}
              onRate={(r) => void engineRef.current?.setRate(r)}
              onSemitones={(s) => void engineRef.current?.setSemitones(s)}
              onClearLoop={() => setLoop(null)}
            />
          </section>

          {/* 4 — transcribe */}
          <section className="panel mb-5 p-5">
            <h2 className="no-print mb-3 flex items-center gap-2 text-lg font-medium">
              <span className="step-badge">4</span> Notes &amp; tab
            </h2>

            <div className="no-print mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-sm">
                <span className="mb-1 block text-white/60">Transcribe which part</span>
                <select className="w-full" value={source} onChange={(e) => setSource(e.target.value as Source)}>
                  <option value="mix">Full mix</option>
                  {stems && stemMode === "ai" && STEM_NAMES.map((n) => (
                    <option key={n} value={n}>{STEM_LABEL[n].label}</option>
                  ))}
                  {stems && stemMode === "instant" && (
                    <>
                      <option value="vocals">Centre / vocal</option>
                      <option value="other">Backing track</option>
                    </>
                  )}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-white/60">Write the next part for</span>
                <select
                  className="w-full" value={settings.instrument}
                  onChange={(e) => patch(instrumentPatch(e.target.value as InstrumentId))}
                >
                  {Object.values(INSTRUMENTS).map((i) => (
                    <option key={i.id} value={i.id}>{i.label}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-white/60">Tempo (BPM)</span>
                <input
                  type="number" min={30} max={300} step={0.1} className="w-full" value={settings.bpm}
                  onChange={(e) => patch({ bpm: Number(e.target.value) || 120 })}
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-white/60">Snap notes to</span>
                <select
                  className="w-full" value={settings.quantizeDivision}
                  onChange={(e) => patch({ quantizeDivision: Number(e.target.value) as 4 | 8 | 16 | 32 })}
                >
                  <option value={4}>Quarter notes</option>
                  <option value={8}>Eighths</option>
                  <option value={16}>Sixteenths</option>
                  <option value={32}>Thirty-seconds</option>
                </select>
              </label>
            </div>

            <details className="no-print mb-4 text-sm">
              <summary className="cursor-pointer text-white/60">Fine tuning</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label>
                  <span className="mb-1 block text-white/60">Note sensitivity {settings.onsetThreshold.toFixed(2)}</span>
                  <input type="range" min={0.1} max={0.9} step={0.05} value={settings.onsetThreshold}
                    onChange={(e) => patch({ onsetThreshold: Number(e.target.value) })} className="w-full" />
                  <span className="text-xs text-white/35">Lower finds more notes (and more mistakes).</span>
                </label>
                <label>
                  <span className="mb-1 block text-white/60">Sustain {settings.frameThreshold.toFixed(2)}</span>
                  <input type="range" min={0.1} max={0.9} step={0.05} value={settings.frameThreshold}
                    onChange={(e) => patch({ frameThreshold: Number(e.target.value) })} className="w-full" />
                </label>
                <label>
                  <span className="mb-1 block text-white/60">Capo {settings.capo}</span>
                  <input type="range" min={0} max={9} step={1} value={settings.capo}
                    onChange={(e) => patch({ capo: Number(e.target.value) })} className="w-full" />
                </label>
                {/*
                  Pick a key, not a number of semitones. A player asks for "put
                  it in G", not "move it up seven" — and the key signature moves
                  with the notes, which it did not used to.
                */}
                <label>
                  <span className="mb-1 block text-white/60">
                    Write it in
                    {settings.transposeSemitones !== 0 && (
                      <span className="ml-1 text-white/35">
                        ({settings.transposeSemitones > 0 ? "+" : ""}{settings.transposeSemitones} st)
                      </span>
                    )}
                  </span>
                  <select
                    className="w-full"
                    value={writtenTonic ?? ""}
                    disabled={!parts.length}
                    onChange={(e) => {
                      const to = Number(e.target.value);
                      patch({ transposeSemitones: shortestShift(soundingTonic, to) });
                    }}
                  >
                    {!parts.length && <option value="">transcribe a part first</option>}
                    {parts.length > 0 &&
                      keyChoices(parts[0].keyMode).map((k) => (
                        <option key={k.tonicPc} value={k.tonicPc}>
                          {k.label}
                          {k.tonicPc === soundingTonic ? " — as played" : ""}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={settings.monophonic}
                    onChange={(e) => patch({ monophonic: e.target.checked })} />
                  <span className="text-white/70">Single melody line only</span>
                </label>
                <label>
                  <span className="mb-1 block text-white/60">Bar start offset {settings.offsetSeconds.toFixed(2)}s</span>
                  <input type="range" min={0} max={4} step={0.01} value={settings.offsetSeconds}
                    onChange={(e) => patch({ offsetSeconds: Number(e.target.value) })} className="w-full" />
                </label>
                <label>
                  <span className="mb-1 block text-white/60">Score zoom {Math.round(zoom * 100)}%</span>
                  <input type="range" min={0.6} max={1.8} step={0.05} value={zoom}
                    onChange={(e) => setZoom(Number(e.target.value))} className="w-full" />
                </label>
              </div>
            </details>

            <div className="no-print mb-4 flex flex-wrap gap-2">
              <button className="btn btn-primary" onClick={() => void runTranscribe()} disabled={!!busy}>
                {busy?.label.startsWith("Listening") ? <Loader2 className="animate-spin" size={15} /> : <FileMusic size={15} />}
                {busy?.label.startsWith("Listening")
                  ? `Transcribing… ${Math.round((busy.value ?? 0) * 100)}%`
                  : "Transcribe"}
              </button>
              <button className="btn" onClick={exportMidi} disabled={!parts.length}>
                <Download size={15} /> MIDI
              </button>
              <button className="btn" onClick={exportMusicXml} disabled={!sheet}>
                <Download size={15} /> MusicXML
              </button>
              <button className="btn" onClick={exportTex} disabled={!tex}>
                <Download size={15} /> alphaTex
              </button>
              <button className="btn" onClick={() => window.print()} disabled={!tex}>
                <Printer size={15} /> Print / PDF
              </button>
              <label className="flex items-center gap-2 text-xs text-white/60">
                <input type="checkbox" checked={playAlong} onChange={(e) => setPlayAlong(e.target.checked)} />
                Follow the music
              </label>
            </div>
            {tex && playAlong && (
              <p className="no-print mb-3 text-xs text-white/40">
                The score scrolls itself and highlights the beat being played, so you can leave your
                hands on the instrument. Set a loop on the waveform above to drill one phrase.
              </p>
            )}

            {parts.length > 0 && (
              <div className="no-print mb-4 grid gap-2">
                {parts.map((part) => (
                  <div
                    key={part.id}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-line)] px-3 py-2"
                  >
                    <select
                      className="text-sm"
                      value={part.instrument}
                      onChange={(e) => setPartInstrument(part.id, e.target.value as InstrumentId)}
                    >
                      {Object.values(INSTRUMENTS).map((i) => (
                        <option key={i.id} value={i.id}>{i.label}</option>
                      ))}
                    </select>
                    <span className="text-xs text-white/45">
                      {part.notes.length} notes · {part.keyName} · from{" "}
                      {part.source === "mix" ? "the full mix" : part.source}
                    </span>
                    <span className="ml-auto flex items-center gap-2">
                      <button
                        className="btn py-1 text-xs"
                        onClick={() => arrangeForEnsemble(part.id, ensembleSize)}
                        title="Split this line into separate voices, one per instrument"
                      >
                        <Users size={14} /> Split into {ensembleSize} voices
                      </button>
                      <button className="btn py-1 text-xs" onClick={() => removePart(part.id)}>
                        Remove
                      </button>
                    </span>
                  </div>
                ))}
                <label className="flex items-center gap-2 text-xs text-white/45">
                  Ensemble size
                  <select
                    className="text-xs"
                    value={ensembleSize}
                    onChange={(e) => setEnsembleSize(Number(e.target.value))}
                  >
                    <option value={2}>Duo — violin, cello</option>
                    <option value={3}>Trio — violin, viola, cello</option>
                    <option value={4}>Quartet — 2 violins, viola, cello</option>
                    <option value={5}>Quintet — + double bass</option>
                  </select>
                  <span>
                    Splitting arranges one line across instruments; it does not recover the original
                    players from the recording.
                  </span>
                </label>
              </div>
            )}

            {tex ? (
              <>
                <ScoreView
                  tex={tex}
                  zoom={zoom}
                  playAlong={playAlong}
                  timeSeconds={transport.time}
                  timeline={timeline}
                  onPickBeat={setPickedBeat}
                  selectedBeat={pickedBeat}
                />
                <div className="no-print mt-3 flex flex-wrap items-center gap-2 text-sm">
                  {pickedNotes.length > 0 ? (
                    <>
                      <span className="text-white/60">
                        {/* Tenths matter here: two notes a beat apart both read
                            as the same mm:ss, which is confusing when you are
                            picking one of them to correct. */}
                        {pickedNotes.length === 1
                          ? `${noteName(pickedNotes[0].pitchMidi)} at ${pickedNotes[0].startTimeSeconds.toFixed(1)}s`
                          : `${pickedNotes.length} notes at ${pickedNotes[0].startTimeSeconds.toFixed(1)}s`}
                      </span>
                      <button className="btn text-xs" onClick={() => nudgePicked(1)} title="Up a semitone">
                        <ChevronUp size={14} /> semitone
                      </button>
                      <button className="btn text-xs" onClick={() => nudgePicked(-1)} title="Down a semitone">
                        <ChevronDown size={14} /> semitone
                      </button>
                      <button className="btn text-xs" onClick={() => nudgePicked(12)}>+ octave</button>
                      <button className="btn text-xs" onClick={() => nudgePicked(-12)}>− octave</button>
                      <button className="btn text-xs text-red-200" onClick={deletePicked}>
                        <Trash2 size={13} /> Remove
                      </button>
                    </>
                  ) : (
                    <span className="text-white/35">
                      Click a note on the top staff to correct it — the model is a good first draft, not a transcriber.
                    </span>
                  )}
                  <span className="flex items-center gap-1" role="group" aria-label="Select a beat without the mouse">
                    <button className="btn py-0.5 text-xs" onClick={() => stepBeat(-1)} aria-label="Select the previous beat">‹ beat</button>
                    <button className="btn py-0.5 text-xs" onClick={() => stepBeat(1)} aria-label="Select the next beat">beat ›</button>
                  </span>
                  {undoStack.length > 0 && (
                    <button className="btn ml-auto text-xs" onClick={undoEdit}>
                      <Undo2 size={13} /> Undo
                    </button>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-white/40">
                Run the transcriber to see notation and tablature here. Transcribe as many parts as you
                like — pick a stem, choose an instrument, and each one is added as another staff on the
                same score. One instrument at a time is where this model is strongest, so split the stems
                first rather than transcribing the full mix.
              </p>
            )}
          </section>

          <SaveBar buildChart={buildChart} chartId={chartId} onChartId={linkChart} />

          {/* 5 — record */}
          <section className="panel no-print mb-5 p-5">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-medium">
              <span className="step-badge">5</span> Play or sing over it
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              {recording ? (
                <button className="btn bg-red-500/20 text-red-200" onClick={stopRecording}>
                  <Square size={15} /> Stop
                </button>
              ) : (
                <button className="btn btn-primary" onClick={startRecording} disabled={!!busy}>
                  <Mic size={15} /> Record from here
                </button>
              )}
              {overdub && (
                <button className="btn" onClick={() => setOverdub(null)}>Delete take</button>
              )}
              <label className="ml-2 text-xs text-white/55">
                Nudge take {nudgeMs > 0 ? `+${nudgeMs}` : nudgeMs} ms
                <input type="range" min={-300} max={300} step={5} value={nudgeMs}
                  onChange={(e) => setNudgeMs(Number(e.target.value))} className="ml-2 align-middle" />
              </label>
            </div>
            {overdub && parts.length > 0 && (
              <div className="mt-4 rounded-md border border-white/10 bg-white/[0.02] p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <button className="btn btn-primary" onClick={checkTake} disabled={!!busy}>
                    {busy?.label.startsWith("Listening to your take") ? <Loader2 className="animate-spin" size={15} /> : <Target size={15} />}
                    How did I do?
                  </button>
                  {parts.length > 1 && (
                    <select
                      className="text-xs"
                      value={checkPart ?? parts[0].id}
                      onChange={(e) => setCheckPart(e.target.value)}
                    >
                      {parts.map((x) => (
                        <option key={x.id} value={x.id}>
                          against {INSTRUMENTS[x.instrument].label}
                        </option>
                      ))}
                    </select>
                  )}
                  {report && (
                    <span className="text-sm">
                      <b className={report.accuracy >= 0.9 ? "text-emerald-300" : report.accuracy >= 0.7 ? "text-[var(--color-accent)]" : "text-red-300"}>
                        {Math.round(report.accuracy * 100)}%
                      </b>
                      <span className="text-white/45"> clean</span>
                    </span>
                  )}
                </div>

                {report && (
                  <>
                    <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-white/55">
                      <span>{report.clean} right</span>
                      {report.missed > 0 && <span>{report.missed} missed</span>}
                      {report.outOfTune > 0 && <span>{report.outOfTune} out of tune</span>}
                      {report.outOfTime > 0 && <span>{report.outOfTime} out of time</span>}
                      {report.extra > 0 && <span>{report.extra} not in the part</span>}
                      {Math.abs(report.meanMsOff) >= 25 && (
                        <span className="text-[var(--color-accent)]">
                          {report.meanMsOff > 0 ? "dragging" : "rushing"} ~{Math.abs(report.meanMsOff)} ms
                        </span>
                      )}
                    </div>

                    {/* A bar per column, so the shape of the problem is visible at a glance. */}
                    <div className="mb-3 flex items-end gap-[3px]" style={{ height: 44 }}>
                      {report.bars.map((b) => (
                        <div
                          key={b.bar}
                          title={`Bar ${b.bar}: ${b.clean} of ${b.notes} clean`}
                          className={`w-3 shrink-0 rounded-sm ${
                            b.accuracy >= 0.9 ? "bg-emerald-400/70" : b.accuracy >= 0.6 ? "bg-[var(--color-accent)]/70" : "bg-red-400/70"
                          }`}
                          style={{ height: `${Math.max(8, b.accuracy * 44)}px` }}
                        />
                      ))}
                    </div>

                    {report.worstBars.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-white/55">
                          Weakest {report.worstBars.length === 1 ? "bar" : "bars"}:{" "}
                          {report.worstBars.map((b) => b.bar).join(", ")}
                        </span>
                        <button className="btn text-xs" onClick={loopWorstBars}>
                          <Repeat size={13} /> Loop {barsLabel(barsToLoop(report.worstBars))} and go again
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs text-emerald-300/80">Nothing stands out as weak. Take the speed up.</p>
                    )}

                    <p className="mt-3 text-xs text-white/35">
                      Marked by transcribing your take and lining it up with the written part, so it
                      inherits the same blind spots as the transcription — treat a surprising result as
                      a question rather than a verdict.
                    </p>
                  </>
                )}
              </div>
            )}

            <p className="mt-3 text-xs text-white/45">
              Record at any speed — a take played at 60% is stretched back to full tempo without going
              chipmunk. Use headphones so the backing track does not bleed into the mic.
              {parts.length > 0 && " Mute your own part in the mixer first, so you are playing the line rather than doubling it."}
            </p>
          </section>
        </>
      )}

      {/*
        The transport, always within reach. A player holding an instrument
        cannot go hunting up the page for the play button, and the score is
        long — so it follows you down the page instead.
      */}
      {audio && (
        <div className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#0c0f14]/95 backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-2.5">
            <button
              className="btn btn-primary"
              onClick={() => void startPlaying()}
              aria-label={counting ? "Cancel the count-in" : transport.playing ? "Pause" : "Play"}
            >
              {counting ? <Loader2 className="animate-spin" size={16} /> : transport.playing ? <Pause size={16} /> : <Play size={16} />}
              {counting ? "Counting in… (stop)" : transport.playing ? "Pause" : "Play"}
            </button>
            <button
              className="btn"
              onClick={() => void engineRef.current?.seek(loop ? loop[0] : 0)}
              title="Back to the start of the loop"
            >
              <RotateCcw size={15} />
            </button>
            <span className="font-mono text-sm tabular-nums text-white/70">
              {fmtTime(transport.time)}
              <span className="text-white/30"> / {fmtTime(transport.duration)}</span>
            </span>

            <span className="flex items-center gap-1">
              {[0.5, 0.75, 1].map((s) => (
                <button
                  key={s}
                  onClick={() => void engineRef.current?.setRate(s)}
                  className={`rounded px-1.5 py-0.5 text-xs ${
                    Math.abs(transport.rate - s) < 0.005
                      ? "bg-[var(--color-accent)] text-black"
                      : "bg-white/5 text-white/60 hover:bg-white/10"
                  }`}
                >
                  {Math.round(s * 100)}%
                </button>
              ))}
              {![0.5, 0.75, 1].some((s) => Math.abs(transport.rate - s) < 0.005) && (
                <span className="rounded bg-[var(--color-accent)] px-1.5 py-0.5 text-xs text-black">
                  {Math.round(transport.rate * 100)}%
                </span>
              )}
            </span>

            {loop && (
              <button className="btn text-xs text-emerald-300" onClick={() => setLoop(null)} title="Clear the loop">
                <Repeat size={14} /> {fmtTime(loop[0])}–{fmtTime(loop[1])} ✕
              </button>
            )}
            {trainer && <span className="text-xs text-[var(--color-accent)]">trainer → {Math.round(trainer.target * 100)}%</span>}
            {transport.rendering !== null && (
              <span className="flex items-center gap-1.5 text-xs text-[var(--color-accent)]">
                <Loader2 className="animate-spin" size={12} /> {Math.round(transport.rendering * 100)}%
              </span>
            )}
          </div>
        </div>
      )}
      {audio && <div className="no-print h-16" aria-hidden />}

      <footer className="no-print pb-10 pt-4 text-center text-xs text-white/30">
        Basic Pitch (Spotify, Apache-2.0) · Demucs (Meta, MIT) · alphaTab (MPL-2.0) · Signalsmith Stretch (MIT)
      </footer>
    </div>
  );
}
