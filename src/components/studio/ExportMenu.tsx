"use client";
import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Download, Printer } from "lucide-react";

import type { Busy, ExportFormat, Loop, Setter } from "./constants";

/**
 * Every download in one place: the notation (MIDI, MusicXML, alphaTex, print) and the
 * audio (backing track or current mix). Rendered by both the stems and the notes panels
 * with the same handlers. A single track's download stays on its mixer row.
 */
export interface ExportMenuProps {
  busy: Busy;
  /** Whether there are parts to write out. */
  hasParts: boolean;
  /** Whether the score has been engraved (MusicXML reads the quantised sheet). */
  hasSheet: boolean;
  tex: string;
  exportMidi: () => void;
  exportMusicXml: () => void;
  exportTex: () => void;
  /** The backing track needs stems to leave the vocals out of. */
  hasStems: boolean;
  exportAudio: (kind: "backing" | "mix") => Promise<void>;
  exportFormat: ExportFormat;
  setExportFormat: Setter<ExportFormat>;
  loop: Loop;
  loopOnlyExport: boolean;
  setLoopOnlyExport: Setter<boolean>;
}

export default function ExportMenu({
  busy, hasParts, hasSheet, tex, exportMidi, exportMusicXml, exportTex, hasStems, exportAudio, exportFormat,
  setExportFormat, loop, loopOnlyExport, setLoopOnlyExport,
}: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const loopId = useId();

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

  /** Run a download and close the menu; the busy banner reports a slow one. */
  const pick = (run: () => void | Promise<void>) => () => {
    setOpen(false);
    void run();
  };

  const item = "btn w-full justify-start py-1.5 text-sm";

  return (
    <div ref={wrap} className="relative inline-block">
      <button
        ref={button}
        type="button"
        className="btn"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <Download size={15} aria-hidden /> Export <ChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <div
          id={panelId}
          role="group"
          aria-label="Export"
          className="panel fixed inset-x-4 z-40 mt-1 grid gap-3 p-3 shadow-2xl sm:absolute sm:inset-x-auto sm:left-0 sm:top-full sm:w-72"
        >
          <div role="group" aria-labelledby={`${panelId}-notation`} className="grid gap-1">
            <p id={`${panelId}-notation`} className="text-xs uppercase tracking-wide text-[var(--color-faint)]">Notation</p>
            <button type="button" className={item} onClick={pick(exportMidi)} disabled={!hasParts}>
              <Download size={14} aria-hidden /> MIDI
            </button>
            <button type="button" className={item} onClick={pick(exportMusicXml)} disabled={!hasSheet}>
              <Download size={14} aria-hidden /> MusicXML
            </button>
            <button type="button" className={item} onClick={pick(exportTex)} disabled={!tex}>
              <Download size={14} aria-hidden /> alphaTex
            </button>
            <button type="button" className={item} onClick={pick(() => window.print())} disabled={!tex}>
              <Printer size={14} aria-hidden /> Print / PDF
            </button>
            {!hasParts && <p className="text-xs text-[var(--color-faint)]">Transcribe a part to write it out.</p>}
          </div>

          <div role="group" aria-labelledby={`${panelId}-audio`} className="grid gap-1 border-t border-[var(--color-line)] pt-3">
            <p id={`${panelId}-audio`} className="text-xs uppercase tracking-wide text-[var(--color-faint)]">Audio</p>
            <button
              type="button"
              className={item}
              onClick={pick(() => exportAudio("backing"))}
              disabled={!hasStems || !!busy}
              title={hasStems ? undefined : "Split the song first: the backing track leaves the vocals out"}
            >
              <Download size={14} aria-hidden /> Backing track .{exportFormat}
            </button>
            <button type="button" className={item} onClick={pick(() => exportAudio("mix"))} disabled={!!busy}>
              <Download size={14} aria-hidden /> Current mix .{exportFormat}
            </button>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <span className="flex rounded-md border border-white/10 p-0.5 text-xs" role="group" aria-label="Audio format">
                {(["wav", "mp3"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={exportFormat === f}
                    className={`rounded px-2 py-1 uppercase ${exportFormat === f ? "bg-white/15 text-white" : "text-white/55 hover:text-white/80"}`}
                    onClick={() => setExportFormat(f)}
                  >
                    {f}
                  </button>
                ))}
              </span>
              <label htmlFor={loopId} className={`flex items-center gap-2 text-xs ${loop ? "text-white/70" : "text-white/35"}`}>
                <input
                  id={loopId}
                  type="checkbox"
                  checked={loopOnlyExport}
                  disabled={!loop}
                  onChange={(e) => setLoopOnlyExport(e.target.checked)}
                />
                Loop only
              </label>
            </div>
            <p className="text-xs text-[var(--color-faint)]">At your practice speed and key, with your current mix.</p>
          </div>
        </div>
      )}
    </div>
  );
}
