"use client";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";

import { SHORTCUT_HELP } from "./useShortcuts";

/**
 * A native modal <dialog> driven by an `open` flag: the browser traps focus, closes it on
 * Escape and hands focus back to whatever opened it. Shared by the studio's dialogs.
 */
export function useModal(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    // Escape and form-less close() both end here; keep the parent's flag in step.
    const onDialogClose = () => closeRef.current();
    // A click on the backdrop lands on the dialog element itself, outside its box
    // (a click on the dialog's own padding does too, but inside the box).
    const onClick = (e: MouseEvent) => {
      if (e.target !== d) return;
      const r = d.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) d.close();
    };
    d.addEventListener("close", onDialogClose);
    d.addEventListener("click", onClick);
    return () => {
      d.removeEventListener("close", onDialogClose);
      d.removeEventListener("click", onClick);
    };
  }, []);
  return ref;
}

/** The keyboard shortcuts, and the way out to the About page. Opens from "?" and the header button. */
export interface HelpOverlayProps {
  open: boolean;
  onClose: () => void;
}

export default function HelpOverlay({ open, onClose }: HelpOverlayProps) {
  const dialog = useModal(open, onClose);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="studio-help-title"
      className="panel no-print m-auto w-[calc(100%-2rem)] max-w-lg bg-[var(--color-panel)] p-5 text-[#e8ebf2] backdrop:bg-black/60"
    >
      <div className="mb-3 flex items-center gap-2">
        <h2 id="studio-help-title" className="text-lg font-medium">Keyboard shortcuts</h2>
        <button type="button" className="btn ml-auto px-2 py-1" onClick={onClose} aria-label="Close">
          <X size={15} aria-hidden />
        </button>
      </div>
      <p className="mb-3 text-xs text-[var(--color-muted)]">
        They work anywhere on the page except while you are typing in a field, moving a slider or talking to the assistant.
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {SHORTCUT_HELP.map((s) => (
          <div key={s.does} className="contents">
            <dt className="whitespace-nowrap">
              {s.keys.map((k, i) =>
                k === "…" ? (
                  <span key={i} className="mx-0.5 text-[var(--color-faint)]">…</span>
                ) : (
                  <kbd
                    key={i}
                    className="mr-1 inline-block min-w-[1.6rem] rounded border border-[var(--color-line-strong)] bg-white/5 px-1.5 py-0.5 text-center font-mono text-xs"
                  >
                    {k}
                  </kbd>
                )
              )}
            </dt>
            <dd className="text-[var(--color-muted)]">{s.does}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 border-t border-[var(--color-line)] pt-3 text-sm">
        {/* A new tab: leaving this page would drop the loaded song and any split in progress. */}
        <a className="underline decoration-white/30 underline-offset-2 hover:text-white" href="/" target="_blank" rel="noopener">
          About Riffscribe
        </a>
        <span className="text-[var(--color-faint)]"> opens in a new tab, so your song stays loaded here.</span>
      </p>
    </dialog>
  );
}
