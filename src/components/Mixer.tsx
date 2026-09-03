"use client";
/** One fader per track. Mute the vocals here to turn any song into a backing track. */
import { Download, Volume2, VolumeX } from "lucide-react";

export interface MixTrack {
  id: string;
  label: string;
  hint?: string;
  gain: number;
  muted: boolean;
}

interface Props {
  tracks: MixTrack[];
  soloed: string | null;
  onChange: (id: string, patch: Partial<MixTrack>) => void;
  onSolo: (id: string | null) => void;
  /** Download this track on its own. */
  onDownload: (id: string) => void;
}

export default function Mixer({ tracks, soloed, onChange, onSolo, onDownload }: Props) {
  return (
    <div className="grid gap-2">
      {tracks.map((t) => {
        const dimmed = soloed !== null && soloed !== t.id;
        return (
          <div
            key={t.id}
            className={`flex items-center gap-3 rounded-lg border border-[var(--color-line)] px-3 py-2 ${
              dimmed ? "opacity-45" : ""
            }`}
          >
            <button
              className="text-white/60 hover:text-white"
              onClick={() => onChange(t.id, { muted: !t.muted })}
              title={t.muted ? "Unmute" : "Mute"}
            >
              {t.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            <div className="w-28 shrink-0">
              <div className="text-sm font-medium">{t.label}</div>
              {t.hint && <div className="text-[11px] text-white/40">{t.hint}</div>}
            </div>
            <input
              type="range" min={0} max={1.5} step={0.01} value={t.gain}
              onChange={(e) => onChange(t.id, { gain: Number(e.target.value) })}
              className="flex-1"
              disabled={t.muted}
            />
            <span className="w-10 text-right font-mono text-xs text-white/50">
              {Math.round(t.gain * 100)}
            </span>
            <button
              className={`rounded px-1.5 py-0.5 text-xs ${
                soloed === t.id ? "bg-emerald-400 text-black" : "bg-white/5 text-white/60 hover:bg-white/10"
              }`}
              onClick={() => onSolo(soloed === t.id ? null : t.id)}
            >
              solo
            </button>
            <button
              className="text-white/45 hover:text-white"
              onClick={() => onDownload(t.id)}
              title={`Download ${t.label} on its own`}
            >
              <Download size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
