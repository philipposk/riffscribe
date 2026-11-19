import { Loader2 } from "lucide-react";

import type { Busy } from "./constants";

/** The error and the busy banners, pinned to the top while they are up. */
export interface StatusBannersProps {
  error: string | null;
  setError: (e: string | null) => void;
  busy: Busy;
  cancelSplitRef: { readonly current: (() => void) | null };
  cancelJob: () => void;
}

export default function StatusBanners({ error, setError, busy, cancelSplitRef, cancelJob }: StatusBannersProps) {
  return (
    <>
      {error && (
        <p
          role="alert"
          className="no-print sticky top-2 z-30 mb-5 flex items-start gap-3 rounded-xl border border-red-500/40 bg-red-950/90 px-4 py-3 text-sm text-red-200 backdrop-blur"
        >
          <span className="min-w-0 flex-1">{error}</span>
          <button className="btn shrink-0 py-0.5 text-xs" onClick={() => setError(null)} aria-label="Dismiss this message">
            Dismiss
          </button>
        </p>
      )}
      {busy && (
        <div
          role="status"
          aria-live="polite"
          className="no-print sticky top-2 z-30 mb-5 rounded-xl border border-[var(--color-accent)]/40 bg-[#1a1608]/95 px-4 py-3 text-sm shadow-lg backdrop-blur">
          <p className="flex items-center gap-2 text-[var(--color-accent)]">
            <Loader2 className="animate-spin" size={16} /> {busy.label}
            {cancelSplitRef.current && (
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
    </>
  );
}
