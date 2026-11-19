"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Gauge } from "lucide-react";

import Transport from "../Transport";

/** Speed and key live behind one button so the player bar stays on a single row. */
export interface SpeedKeyPopoverProps {
  rate: number;
  semitones: number;
  onRate: (r: number) => void;
  onSemitones: (s: number) => void;
}

export default function SpeedKeyPopover({ rate, semitones, onRate, onSemitones }: SpeedKeyPopoverProps) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const pct = `${Math.round(rate * 100)}%`;
  const key = semitones ? ` ${semitones > 0 ? "+" : "−"}${Math.abs(semitones)} st` : "";

  return (
    <div ref={wrap} className="shrink-0">
      <button
        ref={button}
        type="button"
        className="btn min-h-[44px] px-2.5 text-xs tabular-nums sm:px-3 sm:text-sm"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Speed ${pct}${semitones ? `, key ${semitones > 0 ? "plus" : "minus"} ${Math.abs(semitones)} semitones` : ""}. Open speed and key`}
        onClick={() => setOpen((o) => !o)}
      >
        <Gauge size={15} aria-hidden />
        {pct}{key}
      </button>
      {open && (
        <div
          id={panelId}
          role="group"
          aria-label="Speed and key"
          className="panel fixed inset-x-4 z-50 mx-auto max-w-xl p-4 shadow-2xl"
          style={{ bottom: "var(--pa-offset-bottom, 72px)" }}
        >
          <Transport rate={rate} semitones={semitones} onRate={onRate} onSemitones={onSemitones} />
        </div>
      )}
    </div>
  );
}
