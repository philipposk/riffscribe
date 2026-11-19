import { Loader2, WandSparkles } from "lucide-react";

import { INSTRUMENTS, type InstrumentId } from "@/lib/types";
import type { Busy } from "./constants";

/** One-press recipes over the steps below. Today: put an instrument where the singer was. */
export interface RecipesProps {
  busy: Busy;
  /** The instrument the next "Replace the voice" writes for. */
  instrument: InstrumentId;
  setInstrument: (id: InstrumentId) => void;
  replaceVoice: (instrument: InstrumentId, quality: "quick" | "clean") => Promise<void>;
  /** Label of the instrument now playing the vocal line, or null when none does yet. */
  replacedBy: string | null;
  /** Whether the singer is currently heard (their stem not muted). */
  singerAudible: boolean;
  toggleSinger: () => void;
}

export default function Recipes({
  busy, instrument, setInstrument, replaceVoice, replacedBy, singerAudible, toggleSinger,
}: RecipesProps) {
  return (
    <section className="panel no-print mb-5 p-5" aria-labelledby="recipe-voice">
      <h2 id="recipe-voice" className="mb-1 flex items-center gap-2 text-lg font-medium">
        <WandSparkles size={18} className="text-[var(--color-accent)]" aria-hidden /> Replace the voice with…
      </h2>
      <p className="mb-3 text-sm text-white/50">
        Takes the singer out and has an instrument play their line, following their pitch and
        loudness, moved to where that instrument sounds best.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="mb-1 block text-white/60">Instrument</span>
          <select
            value={instrument}
            onChange={(e) => setInstrument(e.target.value as InstrumentId)}
            disabled={!!busy}
          >
            {Object.values(INSTRUMENTS).map((i) => (
              <option key={i.id} value={i.id}>{i.label}</option>
            ))}
          </select>
        </label>
        <button className="btn" onClick={() => void replaceVoice(instrument, "quick")} disabled={!!busy}>
          {busy ? <Loader2 className="animate-spin" size={15} aria-hidden /> : null}
          Quick (about a second)
        </button>
        <button className="btn btn-primary" onClick={() => void replaceVoice(instrument, "clean")} disabled={!!busy}>
          Clean (AI split, about 180 MB the first time, minutes)
        </button>
        {replacedBy && (
          <button className="btn" onClick={toggleSinger}>
            {singerAudible ? `Hear the ${replacedBy.toLowerCase()}` : "Hear the singer"}
          </button>
        )}
      </div>
    </section>
  );
}
