import { ChevronDown, ChevronUp, Download, FileMusic, Loader2, Printer, Trash2, Undo2, Users } from "lucide-react";

import { noteName } from "@/lib/audio/analyze";
import type { StemSet } from "@/lib/audio/stems";
import type { Sheet } from "@/lib/transcribe/quantize";
import { keyChoices, shortestShift } from "@/lib/transcribe/spelling";
import {
  INSTRUMENTS, STEM_NAMES, type InstrumentId, type NoteEvent, type Part, type TranscriptionSettings,
} from "@/lib/types";
import ScoreView from "../ScoreView";
import {
  STEM_LABEL, instrumentPatch, type Busy, type Setter, type Source, type StemMode, type TransportState,
} from "./constants";

/** Step 4: transcription settings, the parts list, exports, the score and note fixing. */
export interface PartsPanelProps {
  source: Source;
  setSource: Setter<Source>;
  stems: StemSet | null;
  stemMode: StemMode;
  settings: TranscriptionSettings;
  patch: (p: Partial<TranscriptionSettings>) => void;
  zoom: number;
  setZoom: Setter<number>;
  writtenTonic: number | null;
  parts: Part[];
  soundingTonic: number;
  runTranscribe: (from?: Source) => Promise<boolean>;
  busy: Busy;
  exportMidi: () => void;
  sheet: Sheet | null;
  exportMusicXml: () => void;
  tex: string;
  exportTex: () => void;
  playAlong: boolean;
  setPlayAlong: Setter<boolean>;
  setPartInstrument: (id: string, instrument: InstrumentId) => void;
  arrangeForEnsemble: (id: string, size: number) => void;
  ensembleSize: number;
  removePart: (id: string) => void;
  setEnsembleSize: Setter<number>;
  transport: TransportState;
  timeline: { start: number; end: number }[];
  setPickedBeat: Setter<number | null>;
  pickedBeat: number | null;
  pickedNotes: NoteEvent[];
  nudgePicked: (semitones: number) => void;
  deletePicked: () => void;
  stepBeat: (dir: 1 | -1) => void;
  undoStack: Part[][];
  undoEdit: () => void;
}

export default function PartsPanel({
  source, setSource, stems, stemMode, settings, patch, zoom, setZoom, writtenTonic, parts, soundingTonic,
  runTranscribe, busy, exportMidi, sheet, exportMusicXml, tex, exportTex, playAlong, setPlayAlong,
  setPartInstrument, arrangeForEnsemble, ensembleSize, removePart, setEnsembleSize, transport, timeline,
  setPickedBeat, pickedBeat, pickedNotes, nudgePicked, deletePicked, stepBeat, undoStack, undoEdit,
}: PartsPanelProps) {
  return (
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
  );
}
