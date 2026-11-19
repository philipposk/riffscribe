import { Check, Download, Loader2, Scissors, Wand2 } from "lucide-react";

import type { StemSet } from "@/lib/audio/stems";
import Mixer, { type MixTrack } from "../Mixer";
import type { Busy, ExportFormat, Loop, MixState, Setter } from "./constants";

/** Step 2: instant or AI split, the mixer, and the audio exports. */
export interface SplitPanelProps {
  busy: Busy;
  runInstant: () => Promise<boolean>;
  startAiSplit: () => Promise<void>;
  aiSplitCautionGb: number | null;
  setAiSplitCautionGb: Setter<number | null>;
  runDemucs: () => Promise<boolean>;
  restored: string | null;
  forgetSong: () => Promise<void>;
  mixTracks: MixTrack[];
  activeSolo: string | null;
  setSoloed: Setter<string | null>;
  exportTrack: (id: string) => Promise<void>;
  setMix: Setter<MixState>;
  exportAudio: (kind: "backing" | "mix") => Promise<void>;
  stems: StemSet | null;
  exportFormat: ExportFormat;
  setExportFormat: Setter<ExportFormat>;
  loop: Loop;
  loopOnlyExport: boolean;
  setLoopOnlyExport: Setter<boolean>;
}

export default function SplitPanel({
  busy, runInstant, startAiSplit, aiSplitCautionGb, setAiSplitCautionGb, runDemucs, restored, forgetSong,
  mixTracks, activeSolo, setSoloed, exportTrack, setMix, exportAudio, stems, exportFormat, setExportFormat,
  loop, loopOnlyExport, setLoopOnlyExport,
}: SplitPanelProps) {
  return (
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
  );
}
