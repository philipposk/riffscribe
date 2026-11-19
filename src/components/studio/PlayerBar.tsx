"use client";
import { useEffect, useRef } from "react";
import { Loader2, Pause, Play, Repeat, RotateCcw, X } from "lucide-react";

import {
  fmtTime, type EngineRef, type Loop, type Setter, type Trainer, type TransportState,
} from "./constants";
import SpeedKeyPopover from "./SpeedKeyPopover";
import { useWakeLock } from "./useWakeLock";

/** The transport fixed to the bottom of the screen, so play is always within reach. */
export interface PlayerBarProps {
  startPlaying: () => Promise<void>;
  counting: boolean;
  transport: TransportState;
  engineRef: EngineRef;
  loop: Loop;
  setLoop: Setter<Loop>;
  trainer: Trainer | null;
  onRate: (r: number) => void;
  onSemitones: (s: number) => void;
}

export default function PlayerBar({
  startPlaying, counting, transport, engineRef, loop, setLoop, trainer, onRate, onSemitones,
}: PlayerBarProps) {
  const bar = useRef<HTMLDivElement>(null);

  // The screen stays on while the song plays.
  useWakeLock(transport.playing);

  // Lift the assistant launcher (and its panel) clear of the bar. The widget
  // reads --pa-offset-bottom through a plain var() lookup, and custom
  // properties inherit into its shadow root, so the root element is enough.
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const root = document.documentElement;
    const apply = () => root.style.setProperty("--pa-offset-bottom", `${Math.ceil(el.getBoundingClientRect().height) + 8}px`);
    apply();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(apply) : null;
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.style.removeProperty("--pa-offset-bottom");
    };
  }, []);

  const status = [
    transport.rendering !== null ? `rendering ${Math.round(transport.rendering * 100)}%` : null,
    trainer ? `trainer → ${Math.round(trainer.target * 100)}%` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div
      ref={bar}
      className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#0c0f14]/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto flex max-w-5xl flex-nowrap items-center gap-2 px-4 py-2 sm:gap-3">
        <button
          className="btn btn-primary min-h-[44px] min-w-[44px] shrink-0 justify-center"
          onClick={() => void startPlaying()}
          aria-label={counting ? "Cancel the count-in" : transport.playing ? "Pause" : "Play"}
        >
          {counting ? <Loader2 className="animate-spin" size={18} /> : transport.playing ? <Pause size={18} /> : <Play size={18} />}
          <span className="hidden sm:inline">{counting ? "Counting in…" : transport.playing ? "Pause" : "Play"}</span>
        </button>
        <button
          className="btn min-h-[44px] min-w-[44px] shrink-0 justify-center px-2"
          onClick={() => void engineRef.current?.seek(loop ? loop[0] : 0)}
          aria-label={loop ? "Back to the start of the loop" : "Back to the start"}
          title={loop ? "Back to the start of the loop" : "Back to the start"}
        >
          <RotateCcw size={15} />
        </button>
        <span className="shrink-0 font-mono text-xs tabular-nums text-white/70 sm:text-sm">
          {fmtTime(transport.time)}
          <span className="text-faint"> / {fmtTime(transport.duration)}</span>
        </span>

        <SpeedKeyPopover rate={transport.rate} semitones={transport.semitones} onRate={onRate} onSemitones={onSemitones} />

        {loop && (
          <button
            className="btn min-h-[44px] shrink-0 px-2 text-xs text-emerald-300"
            onClick={() => setLoop(null)}
            aria-label="Clear loop"
            title="Clear the loop"
          >
            <Repeat size={14} aria-hidden />
            <span className="hidden sm:inline">{fmtTime(loop[0])}–{fmtTime(loop[1])}</span>
            <X size={14} aria-hidden />
          </button>
        )}

        {status && (
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--color-accent)]" role="status">
            {transport.rendering !== null && <Loader2 className="shrink-0 animate-spin" size={12} aria-hidden />}
            <span className="truncate">{status}</span>
          </span>
        )}
      </div>
    </div>
  );
}
