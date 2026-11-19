import type { AssistantActions } from "../Assistant";
import type { StemSet } from "@/lib/audio/stems";
import { nativeDeviceMemoryGb } from "@/lib/native";
import type { User } from "@/lib/store/account";
import { barsToLoop, summarise, type TakeReport } from "@/lib/transcribe/compare";
import { INSTRUMENTS, STEM_NAMES, type InstrumentId, type Part, type TranscriptionSettings } from "@/lib/types";
import {
  barsLabel, fmtTime, instrumentPatch, type Busy, type Channels, type EngineRef, type ExportFormat, type Loop,
  type MixState, type Setter, type Source, type StemMode, type TrackMeta, type TransportState,
} from "./constants";

/** Everything the assistant's capabilities read or call, as it stands in the render that built them. */
export interface AssistantContext {
  audio: Channels | null;
  file: File | null;
  signedIn: User | null;
  transport: TransportState;
  settings: TranscriptionSettings;
  stems: StemSet | null;
  stemMode: StemMode;
  parts: Part[];
  loop: Loop;
  busy: Busy;
  trackList: TrackMeta[];
  mix: MixState;
  activeSolo: string | null;
  overdub: Channels | null;
  report: TakeReport | null;
  engineRef: EngineRef;
  patch: (p: Partial<TranscriptionSettings>) => void;
  runInstant: () => Promise<boolean>;
  runDemucs: () => Promise<boolean>;
  runTranscribe: (from?: Source) => Promise<boolean>;
  checkTake: () => Promise<TakeReport | string | null>;
  loopWorstBars: () => void;
  arrangeForEnsemble: (id: string, size: number) => void;
  setAiSplitCautionGb: Setter<number | null>;
  setSource: Setter<Source>;
  setLoop: Setter<Loop>;
  setSoloed: Setter<string | null>;
  setMix: Setter<MixState>;
  setExportFormat: Setter<ExportFormat>;
  setEnsembleSize: Setter<number>;
  setPlayAlong: Setter<boolean>;
  exportMidi: () => void;
  exportMusicXml: () => void;
  exportTex: () => void;
  /** `format` overrides the export format state, which a just-made change has not reached yet. */
  exportAudio: (kind: "backing" | "mix", format?: ExportFormat) => Promise<void>;
  exportTrack: (id: string, format?: ExportFormat) => Promise<void>;
}

/**
 * The page assistant's capabilities. Rebuilt every render so they always act on
 * current state; the studio keeps a ref to the latest copy.
 */
export function buildAssistantActions(ctx: AssistantContext): AssistantActions {
  const {
    audio, file, signedIn, transport, settings, stems, stemMode, parts, loop, busy, trackList, mix, activeSolo,
    overdub, report, engineRef, patch, runInstant, runDemucs, runTranscribe, checkTake, loopWorstBars,
    arrangeForEnsemble, setAiSplitCautionGb, setSource, setLoop, setSoloed, setMix, setExportFormat,
    setEnsembleSize, setPlayAlong, exportMidi, exportMusicXml, exportTex, exportAudio, exportTrack,
  } = ctx;
  return {
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
      // Passed along as well as set: the state change has not reached this render's exports.
      const fmt: ExportFormat | undefined = w.includes("mp3") ? "mp3" : w.includes("wav") ? "wav" : undefined;
      if (fmt) setExportFormat(fmt);
      if (w.includes("midi")) { exportMidi(); return "MIDI downloaded."; }
      if (w.includes("xml")) { exportMusicXml(); return "MusicXML downloaded."; }
      if (w.includes("tex")) { exportTex(); return "alphaTex downloaded."; }
      if (w.includes("pdf") || w.includes("print")) { window.print(); return "Opened the print dialog."; }
      const track = trackList.find((t) => w.includes(t.id) || w.includes(t.label.toLowerCase()));
      if ((w.includes("backing") || w.includes("mix") || track) && busy) return `Wait for “${busy.label}” to finish, then ask again.`;
      if (w.includes("backing")) { void exportAudio("backing", fmt); return "Backing track download started — at your current speed and key."; }
      if (w.includes("mix")) { void exportAudio("mix", fmt); return "Mix download started — at your current speed and key."; }
      if (track) { void exportTrack(track.id, fmt); return `${track.label} download started.`; }
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
}
