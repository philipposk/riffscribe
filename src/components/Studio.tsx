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
  Download, FileMusic, Loader2, Mic, Music2, Printer, Scissors, Square, Upload, Wand2,
} from "lucide-react";

import Assistant, { type AssistantActions } from "./Assistant";
import Mixer, { type MixTrack } from "./Mixer";
import ScoreView from "./ScoreView";
import Transport from "./Transport";
import Waveform from "./Waveform";

import { fileToAudioBuffer, peaks as peaksOf, toMono, toStereo } from "@/lib/audio/decode";
import { estimateKey, estimateTempo, chromaFromNotes } from "@/lib/audio/analyze";
import { PracticeEngine, makeClickTrack, type EngineTrack } from "@/lib/audio/engine";
import { MicRecorder, estimateLatency, placeTake, stretchOffline } from "@/lib/audio/recorder";
import {
  DEMUCS_SAMPLE_RATE, mixStems, separateInstantAsync, separateWithDemucs, type StemSet,
} from "@/lib/audio/stems";
import { synthesizeGuide } from "@/lib/audio/guide";
import { downloadBlob, encodeWav } from "@/lib/audio/wav";
import { channelsToAudioBuffer, toModelInput } from "@/lib/transcribe/basicPitch";
import { transcribeInWorker } from "@/lib/transcribe/runner";
import { keyToken, sheetToAlphaTex } from "@/lib/transcribe/alphatex";
import { notesToMidi } from "@/lib/transcribe/midi";
import { sheetToMusicXml } from "@/lib/transcribe/musicxml";
import { quantize, slotTimeline, type Sheet } from "@/lib/transcribe/quantize";
import { assignFrets } from "@/lib/transcribe/tab";
import {
  DEFAULT_SETTINGS, INSTRUMENTS, STEM_NAMES, type InstrumentId, type NoteEvent,
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

export default function Studio() {
  const [file, setFile] = useState<File | null>(null);
  const [audio, setAudio] = useState<{ left: Float32Array; right: Float32Array } | null>(null);
  const [wavePeaks, setWavePeaks] = useState<Float32Array | null>(null);
  const [stems, setStems] = useState<StemSet | null>(null);
  const [stemMode, setStemMode] = useState<StemMode>("none");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string>("");

  const [notes, setNotes] = useState<NoteEvent[] | null>(null);
  const [settings, setSettings] = useState<TranscriptionSettings>(DEFAULT_SETTINGS);
  const [keyName, setKeyName] = useState<{ name: string; fifths: number; mode: "major" | "minor" } | null>(null);
  const [source, setSource] = useState<Source>("mix");
  const [zoom, setZoom] = useState(1);

  const [mix, setMix] = useState<Record<string, { gain: number; muted: boolean }>>({});
  const [soloed, setSoloed] = useState<string | null>(null);
  const [transport, setTransport] = useState<{
    playing: boolean; time: number; duration: number; rate: number; semitones: number; rendering: number | null;
  }>({ playing: false, time: 0, duration: 0, rate: 1, semitones: 0, rendering: null });
  const [loop, setLoop] = useState<[number, number] | null>(null);

  const [recArmed, setRecArmed] = useState(false);
  const [recording, setRecording] = useState(false);
  const [overdub, setOverdub] = useState<{ left: Float32Array; right: Float32Array } | null>(null);
  const [nudgeMs, setNudgeMs] = useState(0);
  const [loopOnlyExport, setLoopOnlyExport] = useState(false);
  const [playAlong, setPlayAlong] = useState(true);

  const engineRef = useRef<PracticeEngine | null>(null);
  const recorderRef = useRef<MicRecorder | null>(null);
  const recStartRef = useRef(0);
  const cancelSplitRef = useRef<(() => void) | null>(null);
  const cancelTranscribeRef = useRef<(() => void) | null>(null);

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

  /* ------------------------------------------------------------------ load */

  const loadFile = useCallback(async (f: File) => {
    setError(null);
    setBusy({ label: `Decoding ${f.name}…` });
    try {
      const buf = await fileToAudioBuffer(f);
      const stereo = await toStereo(buf, DEMUCS_SAMPLE_RATE);
      setFile(f);
      setAudio({ left: stereo.left, right: stereo.right });
      setWavePeaks(peaksOf(toMono(stereo.left, stereo.right), 2200));
      setStems(null);
      setStemMode("none");
      setNotes(null);
      setOverdub(null);
      setSource("mix");

      const mono = toMono(stereo.left, stereo.right);
      const tempo = estimateTempo(mono, DEMUCS_SAMPLE_RATE);
      setSettings((s) => ({ ...s, bpm: tempo.bpm, offsetSeconds: tempo.offsetSeconds }));
      setLog(`Detected ${tempo.bpm} BPM (confidence ${(tempo.confidence * 100).toFixed(0)}%)`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not read that file");
    } finally {
      setBusy(null);
    }
  }, []);

  /* --------------------------------------------------------------- engine  */

  const guideTrack = useMemo(() => {
    if (!audio || !notes?.length) return null;
    const [left, right] = synthesizeGuide(notes, {
      timbre: INSTRUMENTS[settings.instrument].timbre,
      sampleRate: DEMUCS_SAMPLE_RATE,
      lengthSamples: audio.left.length,
      transposeSemitones: settings.transposeSemitones,
    });
    return { left, right };
  }, [audio, notes, settings.instrument, settings.transposeSemitones]);

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
    if (guideTrack) {
      out.push({
        id: "guide",
        label: `Your part — ${INSTRUMENTS[settings.instrument].label}`,
        hint: "the transcription, played back",
      });
    }
    if (audio) out.push({ id: "click", ...STEM_LABEL.click });
    if (overdub) out.push({ id: "overdub", ...STEM_LABEL.overdub });
    return out;
  }, [stems, stemMode, audio, overdub, guideTrack, settings.instrument]);

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

    if (guideTrack) push("guide", guideTrack.left, guideTrack.right);
    if (clickTrack) push("click", clickTrack.left, clickTrack.right);
    if (overdub) push("overdub", overdub.left, overdub.right);

    try {
      await engine.load(tracks, DEMUCS_SAMPLE_RATE);
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
        else if (t.id === "guide") next[t.id] = { gain: 0.85, muted: false };
        else next[t.id] = { gain: 1, muted: false };
      }
      return next;
    });
  }, [audio, stems, stemMode, overdub, trackList, clickTrack, guideTrack]);

  // rebuilding tears down the audio graph, so coalesce bursts (e.g. typing a BPM)
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
      const audible = !m.muted && (soloed === null || soloed === t.id);
      engine.setGain(t.id, audible ? m.gain : 0);
    }
  }, [mix, soloed, trackList]);

  useEffect(() => { void engineRef.current?.setLoop(loop); }, [loop]);

  /* -------------------------------------------------------------- separate */

  async function runInstant() {
    if (!audio) return;
    setError(null);
    setBusy({ label: "Pulling the centre channel out…" });
    try {
      const result = await separateInstantAsync(
        Float32Array.from(audio.left),
        Float32Array.from(audio.right),
        DEMUCS_SAMPLE_RATE
      );
      setStems(result);
      setStemMode("instant");
      setSource("other");
      setLog("Instant split done. For a cleaner result, run the AI split.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "instant split failed");
    } finally {
      setBusy(null);
    }
  }

  async function runDemucs() {
    if (!audio) return;
    setError(null);
    setBusy({ label: "Loading the separation model…" });
    try {
      const { promise, cancel } = separateWithDemucs(
        Float32Array.from(audio.left),
        Float32Array.from(audio.right),
        (p) => {
          if (p.phase === "download") setBusy({ label: `Downloading model (one time, ~180 MB) ${p.message ?? ""}`, value: p.value });
          else if (p.phase === "prepare") setBusy({ label: "Preparing the model — this takes a moment…" });
          else if (p.phase === "separate") setBusy({ label: `Separating stems ${p.message ?? ""}`, value: p.value });
          else if (p.message) setLog(p.message);
        }
      );
      cancelSplitRef.current = cancel;
      const result = await promise;
      setStems(result);
      setStemMode("ai");
      setSource("other");
      setLog("Four stems ready. Mute what you don't want to hear.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "stem separation failed");
    } finally {
      cancelSplitRef.current = null;
      setBusy(null);
    }
  }

  function cancelJob() {
    cancelSplitRef.current?.();
    cancelTranscribeRef.current?.();
    const wasSplit = !!cancelSplitRef.current;
    cancelSplitRef.current = null;
    cancelTranscribeRef.current = null;
    setBusy(null);
    setLog(wasSplit ? "Separation cancelled. Whatever downloaded is kept." : "Transcription cancelled.");
  }

  /** Cut the song down to the looped section — separation is slow, so this helps. */
  function trimToLoop() {
    if (!audio || !loop) return;
    const a = Math.max(0, Math.floor(loop[0] * DEMUCS_SAMPLE_RATE));
    const b = Math.min(audio.left.length, Math.floor(loop[1] * DEMUCS_SAMPLE_RATE));
    if (b - a < DEMUCS_SAMPLE_RATE) return;
    const left = audio.left.slice(a, b);
    const right = audio.right.slice(a, b);
    setAudio({ left, right });
    setWavePeaks(peaksOf(toMono(left, right), 2200));
    setStems(null);
    setStemMode("none");
    setNotes(null);
    setOverdub(null);
    setSource("mix");
    setLoop(null);
    setSettings((s) => ({ ...s, offsetSeconds: 0 }));
    setLog(`Trimmed to ${Math.round((b - a) / DEMUCS_SAMPLE_RATE)}s. Separation and transcription will be much quicker.`);
  }

  /* ------------------------------------------------------------ transcribe */

  const sourceChannels = useCallback((): { left: Float32Array; right: Float32Array } | null => {
    if (!audio) return null;
    if (source === "mix" || !stems) return audio;
    return stems[source];
  }, [audio, stems, source]);

  async function runTranscribe() {
    const src = sourceChannels();
    if (!src) return;
    const inst = INSTRUMENTS[settings.instrument];
    setError(null);
    setBusy({ label: "Listening for notes…", value: 0 });
    const startedAt = performance.now();
    try {
      const buffer = channelsToAudioBuffer([src.left, src.right], DEMUCS_SAMPLE_RATE);
      const mono22 = await toModelInput(buffer);
      const { promise, cancel } = transcribeInWorker(mono22, {
        onsetThreshold: settings.onsetThreshold,
        frameThreshold: settings.frameThreshold,
        minNoteLength: settings.minNoteLength,
        minMidi: inst.range[0],
        maxMidi: inst.range[1],
        onProgress: (p) => setBusy({ label: "Listening for notes…", value: p }),
      });
      cancelTranscribeRef.current = cancel;
      const { notes: found, backend } = await promise;
      setNotes(found);
      const k = estimateKey(chromaFromNotes(found));
      setKeyName({ name: k.name, fifths: k.fifths, mode: k.mode });
      const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1);
      setLog(`${found.length} notes • ${k.name} • ${settings.bpm} BPM • ${elapsed}s on ${backend}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "transcription failed");
    } finally {
      cancelTranscribeRef.current = null;
      setBusy(null);
    }
  }

  const sheet: Sheet | null = useMemo(() => {
    if (!notes?.length) return null;
    const s = quantize(notes, settings);
    const inst = INSTRUMENTS[settings.instrument];
    if (inst.tuning) {
      assignFrets(s, { tuning: inst.tuning, maxFret: inst.frets ?? 22, capo: settings.capo });
    }
    return s;
  }, [notes, settings]);

  // when each written beat sounds, so the play-along highlight can follow
  const timeline = useMemo(
    () => (sheet ? slotTimeline(sheet, settings.offsetSeconds) : []),
    [sheet, settings.offsetSeconds]
  );

  const tex = useMemo(() => {
    if (!sheet) return "";
    return sheetToAlphaTex(sheet, {
      title: file?.name.replace(/\.[^.]+$/, "") || "Riffscribe transcription",
      instrument: INSTRUMENTS[settings.instrument],
      capo: settings.capo,
      keySignature: keyName ? keyToken(keyName.fifths, keyName.mode) : undefined,
    });
  }, [sheet, settings.instrument, settings.capo, keyName, file]);

  /* ----------------------------------------------------------------- record */

  async function armMic() {
    try {
      await recorderRef.current!.arm();
      setRecArmed(true);
      setError(null);
    } catch {
      setError("Microphone permission denied — allow it in the browser to record.");
    }
  }

  async function startRecording() {
    const engine = engineRef.current;
    if (!engine || !recorderRef.current) return;
    await engine.play();
    recorderRef.current.start();
    recStartRef.current = engine.state().time;
    setRecording(true);
  }

  async function stopRecording() {
    const engine = engineRef.current;
    if (!engine || !recorderRef.current) return;
    setRecording(false);
    const blob = await recorderRef.current.stop();
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
      const [pl, pr] = placeTake({ left: l, right: r, startSeconds: start, sampleRate: DEMUCS_SAMPLE_RATE }, total);
      setOverdub({ left: pl, right: pr });
      setLog(`Take captured at ${Math.round(rate * 100)}% speed and mapped back to full tempo.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not process the recording");
    } finally {
      setBusy(null);
    }
  }

  /* ---------------------------------------------------------------- exports */

  const baseName = (file?.name.replace(/\.[^.]+$/, "") || "riffscribe").slice(0, 60);

  function exportMidi() {
    if (!notes) return;
    const bytes = notesToMidi(notes, { bpm: settings.bpm, name: baseName });
    downloadBlob(new Blob([bytes as unknown as BlobPart], { type: "audio/midi" }), `${baseName}.mid`);
  }

  function exportMusicXml() {
    if (!sheet) return;
    const xml = sheetToMusicXml(sheet, {
      title: baseName,
      instrument: INSTRUMENTS[settings.instrument],
      fifths: keyName?.fifths ?? 0,
      capo: settings.capo,
    });
    downloadBlob(new Blob([xml], { type: "application/vnd.recordare.musicxml+xml" }), `${baseName}.musicxml`);
  }

  function exportTex() {
    if (!tex) return;
    downloadBlob(new Blob([tex], { type: "text/plain" }), `${baseName}.alphatex`);
  }

  /** Every track that currently exists, keyed the same way as the mixer. */
  function allParts(): Record<string, { left: Float32Array; right: Float32Array }> {
    const parts: Record<string, { left: Float32Array; right: Float32Array }> = stems
      ? { ...stems }
      : audio
        ? { original: audio }
        : {};
    if (overdub) parts.overdub = overdub;
    if (guideTrack) parts.guide = guideTrack;
    if (clickTrack) parts.click = clickTrack;
    return parts;
  }

  /** Whole song, or just the looped section when the user asked for that. */
  function exportWindow() {
    const total = audio ? audio.left.length : 0;
    if (!loopOnlyExport || !loop) return { from: 0, to: total, suffix: "" };
    const from = Math.max(0, Math.floor(loop[0] * DEMUCS_SAMPLE_RATE));
    const to = Math.min(total, Math.floor(loop[1] * DEMUCS_SAMPLE_RATE));
    return { from, to, suffix: `-${Math.round(loop[0])}s-${Math.round(loop[1])}s` };
  }

  function writeWav(
    channels: { left: Float32Array; right: Float32Array },
    name: string
  ) {
    const { from, to, suffix } = exportWindow();
    const left = from || to < channels.left.length ? channels.left.slice(from, to) : channels.left;
    const right = from || to < channels.right.length ? channels.right.slice(from, to) : channels.right;
    downloadBlob(encodeWav([left, right], DEMUCS_SAMPLE_RATE), `${baseName}-${name}${suffix}.wav`);
  }

  function exportAudio(kind: "backing" | "mix") {
    if (!audio) return;
    const length = audio.left.length;

    if (kind === "backing" && stems) {
      // everything except the vocals, at full level, whatever the faders say
      const keys = stemMode === "instant" ? ["other"] : ["drums", "bass", "other"];
      setError(null);
      writeWav(mixStems(stems, keys, { length }), "backing");
      return;
    }

    const parts = allParts();
    const gains: Record<string, number> = {};
    const audible = trackList
      .map((t) => t.id)
      .filter((id) => {
        if (!parts[id]) return false;
        const m = mix[id] ?? { gain: 1, muted: false };
        if (m.muted || (soloed !== null && soloed !== id)) return false;
        gains[id] = m.gain;
        return true;
      });

    if (!audible.length) {
      setError("Everything is muted or soloed out — nothing to export.");
      return;
    }
    setError(null);
    writeWav(mixStems(parts, audible, { length, gains }), "mix");
  }

  /** One track on its own — the stem, your part, your take, the click. */
  function exportTrack(id: string) {
    const part = allParts()[id];
    if (!part) return;
    setError(null);
    writeWav(part, id);
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
      if (!audio) return "No song is loaded yet — drop a file into step 1 first.";
      const parts: string[] = [
        `${file?.name ?? "A song"}, ${fmtTime(transport.duration)} long, at ${settings.bpm} BPM.`,
        stems
          ? stemMode === "ai"
            ? "It has been split into four stems."
            : "The centre channel has been pulled out."
          : "It has not been split into stems.",
        notes?.length
          ? `${notes.length} notes are written out for ${INSTRUMENTS[settings.instrument].label}${keyName ? ` in ${keyName.name}` : ""}.`
          : "Nothing has been transcribed yet.",
        `Playing at ${Math.round(transport.rate * 100)}%${transport.semitones ? `, transposed ${transport.semitones > 0 ? "+" : ""}${transport.semitones}` : ""}.`,
        loop ? `Looping ${fmtTime(loop[0])} to ${fmtTime(loop[1])}.` : "No loop is set.",
      ];
      return parts.join(" ");
    },

    setInstrument: (id) => {
      if (!(id in INSTRUMENTS)) return `I do not know an instrument called "${id}".`;
      patch({ instrument: id as InstrumentId });
      return `The part is now written for ${INSTRUMENTS[id as InstrumentId].label}.`;
    },

    splitStems: async (mode) => {
      if (!audio) return "Load a song first.";
      if (busy) return "Something else is already running.";
      if (mode === "instant") { await runInstant(); return "Instant split done — vocal and backing are separate rows in the mixer."; }
      await runDemucs();
      return "The AI split finished — vocals, drums, bass and everything else are separate rows now.";
    },

    transcribe: async (src) => {
      if (!audio) return "Load a song first.";
      if (busy) return "Something else is already running.";
      if (src) setSource(src as Source);
      await runTranscribe();
      return notes?.length
        ? `Written out for ${INSTRUMENTS[settings.instrument].label}.`
        : "Transcription finished.";
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
      if (w.includes("midi")) { exportMidi(); return "MIDI downloaded."; }
      if (w.includes("xml")) { exportMusicXml(); return "MusicXML downloaded."; }
      if (w.includes("tex")) { exportTex(); return "alphaTex downloaded."; }
      if (w.includes("pdf") || w.includes("print")) { window.print(); return "Opened the print dialog."; }
      if (w.includes("backing")) { exportAudio("backing"); return "Backing track downloaded."; }
      if (w.includes("mix")) { exportAudio("mix"); return "The current mix was downloaded."; }
      const track = trackList.find((t) => w.includes(t.id) || w.includes(t.label.toLowerCase()));
      if (track) { exportTrack(track.id); return `${track.label} downloaded on its own.`; }
      return `I can export midi, musicxml, alphatex, pdf, the backing track, the current mix, or one of: ${trackList.map((t) => t.id).join(", ")}.`;
    },

    setPlayAlong: (on) => { setPlayAlong(on); return on ? "The score will follow the music." : "The score will stay put."; },

    pageState: () => ({
      songLoaded: !!audio,
      fileName: file?.name ?? null,
      durationSeconds: Math.round(transport.duration),
      stems: stems ? (stemMode === "ai" ? ["vocals", "drums", "bass", "other"] : ["vocals", "other"]) : [],
      transcribed: !!notes?.length,
      noteCount: notes?.length ?? 0,
      instrument: settings.instrument,
      key: keyName?.name ?? null,
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
        soloed: soloed === t.id,
      })),
      busy: busy?.label ?? null,
    }),
  };

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
        <a className="btn" href="/">About</a>
      </header>

      {error && (
        <p className="no-print sticky top-2 z-30 mb-5 rounded-xl border border-red-500/40 bg-red-950/90 px-4 py-3 text-sm text-red-200 backdrop-blur">
          {error}
        </p>
      )}
      {busy && (
        <div className="no-print sticky top-2 z-30 mb-5 rounded-xl border border-[var(--color-accent)]/40 bg-[#1a1608]/95 px-4 py-3 text-sm shadow-lg backdrop-blur">
          <p className="flex items-center gap-2 text-[var(--color-accent)]">
            <Loader2 className="animate-spin" size={16} /> {busy.label}
            {(cancelSplitRef.current || cancelTranscribeRef.current) && (
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
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--color-line)] px-4 py-8 text-center hover:border-white/30"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) void loadFile(f);
          }}
        >
          <Upload size={20} className="text-white/50" />
          <span className="text-sm">
            {file ? <b>{file.name}</b> : "Drop an mp3, wav, m4a, flac or ogg here — or click to pick one"}
          </span>
          <span className="text-xs text-white/40">Nothing is uploaded. The file never leaves your browser.</span>
          <input
            type="file" accept="audio/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadFile(f); }}
          />
        </label>
        {log && <p className="mt-3 text-xs text-white/45">{log}</p>}
      </section>

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
              <button className="btn btn-primary" onClick={runDemucs} disabled={!!busy}>
                {busy && /model|Separating/i.test(busy.label) ? <Loader2 className="animate-spin" size={15} /> : <Wand2 size={15} />}
                {busy && /model|Separating/i.test(busy.label) ? "Separating…" : "AI split into 4 stems"}
              </button>
            </div>
            <p className="mb-4 text-xs text-white/45">
              Instant is phase-based: no download, about a second, decent on most pop mixes.
              The AI split runs Demucs on your machine — first run pulls a ~180 MB model, then it is cached.
            </p>
            <Mixer
              tracks={mixTracks}
              soloed={soloed}
              onSolo={setSoloed}
              onDownload={exportTrack}
              onChange={(id, p) => setMix((m) => ({ ...m, [id]: { ...(m[id] ?? { gain: 1, muted: false }), ...p } }))}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button className="btn" onClick={() => exportAudio("backing")} disabled={!stems}>
                <Download size={15} /> Backing track .wav
              </button>
              <button className="btn" onClick={() => exportAudio("mix")}>
                <Download size={15} /> Current mix .wav
              </button>
              <label className={`flex items-center gap-2 text-xs ${loop ? "text-white/60" : "text-white/25"}`}>
                <input
                  type="checkbox" checked={loopOnlyExport} disabled={!loop}
                  onChange={(e) => setLoopOnlyExport(e.target.checked)}
                />
                Only the looped section
              </label>
            </div>
            <p className="mt-2 text-xs text-white/35">
              The arrow on each row downloads that track on its own — the isolated vocal, the drums,
              your part, your take.
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
              <button className="btn text-xs" onClick={trimToLoop} disabled={!loop}>
                Trim song to loop
              </button>
            </div>
            <Transport
              playing={transport.playing}
              time={transport.time}
              duration={transport.duration}
              rate={transport.rate}
              semitones={transport.semitones}
              rendering={transport.rendering}
              loop={loop}
              onToggle={() => void engineRef.current?.toggle()}
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
                <span className="mb-1 block text-white/60">Write it for</span>
                <select
                  className="w-full" value={settings.instrument}
                  onChange={(e) => patch({ instrument: e.target.value as InstrumentId })}
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
                <label>
                  <span className="mb-1 block text-white/60">Transpose {settings.transposeSemitones} st</span>
                  <input type="range" min={-12} max={12} step={1} value={settings.transposeSemitones}
                    onChange={(e) => patch({ transposeSemitones: Number(e.target.value) })} className="w-full" />
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
              <button className="btn btn-primary" onClick={runTranscribe} disabled={!!busy}>
                {busy?.label.startsWith("Listening") ? <Loader2 className="animate-spin" size={15} /> : <FileMusic size={15} />}
                {busy?.label.startsWith("Listening")
                  ? `Transcribing… ${Math.round((busy.value ?? 0) * 100)}%`
                  : "Transcribe"}
              </button>
              <button className="btn" onClick={exportMidi} disabled={!notes}>
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

            {tex ? (
              <ScoreView
                tex={tex}
                zoom={zoom}
                playAlong={playAlong}
                timeSeconds={transport.time}
                timeline={timeline}
              />
            ) : (
              <p className="text-sm text-white/40">
                Run the transcriber to see notation and tablature here. Tip: split the stems first and
                transcribe just the bass or just the &ldquo;everything else&rdquo; stem — one instrument at a
                time is where this model is strongest.
              </p>
            )}
          </section>

          {/* 5 — record */}
          <section className="panel no-print mb-5 p-5">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-medium">
              <span className="step-badge">5</span> Play or sing over it
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              {!recArmed ? (
                <button className="btn" onClick={armMic}><Mic size={15} /> Enable microphone</button>
              ) : recording ? (
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
            <p className="mt-3 text-xs text-white/45">
              Record at any speed — a take played at 60% is stretched back to full tempo without going
              chipmunk. Use headphones so the backing track does not bleed into the mic.
              {guideTrack && " Mute \u201cYour part\u201d in the mixer first, so you are playing the line rather than doubling it."}
            </p>
          </section>
        </>
      )}

      <Assistant actions={assistantActions} />

      <footer className="no-print pb-10 pt-4 text-center text-xs text-white/30">
        Basic Pitch (Spotify, Apache-2.0) · Demucs (Meta, MIT) · alphaTab (MPL-2.0) · Signalsmith Stretch (MIT)
      </footer>
    </div>
  );
}
