import { Loader2, Pause, Play, Repeat, RotateCcw } from "lucide-react";

import {
  fmtTime, type EngineRef, type Loop, type Setter, type Trainer, type TransportState,
} from "./constants";

/** The transport fixed to the bottom of the screen, so play is always within reach. */
export interface PlayerBarProps {
  startPlaying: () => Promise<void>;
  counting: boolean;
  transport: TransportState;
  engineRef: EngineRef;
  loop: Loop;
  setLoop: Setter<Loop>;
  trainer: Trainer | null;
}

export default function PlayerBar({ startPlaying, counting, transport, engineRef, loop, setLoop, trainer }: PlayerBarProps) {
  return (
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
  );
}
