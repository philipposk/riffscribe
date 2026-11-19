"use client";
import { X } from "lucide-react";

import Tuner from "../Tuner";
import { useModal } from "./HelpOverlay";

/**
 * The tuner and drone, out of the page flow until asked for. The sheet stays mounted
 * when closed, so a drone keeps sounding while you play against it; the tuner's
 * microphone is closed whenever the sheet is.
 */
export interface ToolsSheetProps {
  open: boolean;
  onClose: () => void;
  suggestedTonic?: number;
}

export default function ToolsSheet({ open, onClose, suggestedTonic }: ToolsSheetProps) {
  const dialog = useModal(open, onClose);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="studio-tools-title"
      className="panel no-print m-auto w-[calc(100%-2rem)] max-w-2xl bg-[var(--color-panel)] p-5 text-[#e8ebf2] backdrop:bg-black/60"
    >
      <div className="mb-4 flex items-center gap-2">
        <h2 id="studio-tools-title" className="text-lg font-medium">Tools</h2>
        <button type="button" className="btn ml-auto px-2 py-1" onClick={onClose} aria-label="Close">
          <X size={15} aria-hidden />
        </button>
      </div>
      <Tuner suggestedTonic={suggestedTonic} active={open} />
    </dialog>
  );
}
