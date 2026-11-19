"use client";
import { useModal } from "./HelpOverlay";

export type AiSplitChoice = "split" | "trim" | "cancel";

/** Minutes the AI split is likely to take here: a rough rule, said as one. */
export function aiSplitMinutes(durationSeconds: number): number {
  return Math.max(1, Math.round((durationSeconds / 60) * 1.5));
}

/**
 * Asked once a session, before the first AI split of a song with no stems on this
 * device: what it downloads and roughly how long it takes, with the cheaper way out.
 */
export interface AiSplitConfirmProps {
  /** Open while a choice is wanted. */
  open: boolean;
  durationSeconds: number;
  hasLoop: boolean;
  onChoice: (c: AiSplitChoice) => void;
}

export default function AiSplitConfirm({ open, durationSeconds, hasLoop, onChoice }: AiSplitConfirmProps) {
  // Escape or a click outside is "Cancel".
  const dialog = useModal(open, () => onChoice("cancel"));
  const minutes = aiSplitMinutes(durationSeconds);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="ai-split-title"
      aria-describedby="ai-split-body"
      className="panel no-print m-auto w-[calc(100%-2rem)] max-w-md bg-[var(--color-panel)] p-5 text-[#e8ebf2] backdrop:bg-black/60"
    >
      <h2 id="ai-split-title" className="mb-2 text-lg font-medium">Run the AI split?</h2>
      <div id="ai-split-body" className="space-y-2 text-sm text-[var(--color-muted)]">
        <p>
          The first time, it downloads a separation model of about 180 MB. After that it is kept on this device and
          works offline.
        </p>
        <p>
          On this device it should take about {minutes} {minutes === 1 ? "minute" : "minutes"} for this song
          <span className="text-[var(--color-faint)]"> (rough estimate)</span>.
          {hasLoop
            ? " Trimming to your loop first makes it much quicker."
            : " Set a loop on the waveform first if you only need part of the song: trimmed songs split much quicker."}
        </p>
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" className="btn" onClick={() => onChoice("cancel")}>Cancel</button>
        <button type="button" className="btn" onClick={() => onChoice("trim")} disabled={!hasLoop}>
          Trim to loop first
        </button>
        <button type="button" className="btn btn-primary" onClick={() => onChoice("split")}>
          Split
        </button>
      </div>
    </dialog>
  );
}
