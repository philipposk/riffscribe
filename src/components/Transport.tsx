"use client";
/** Play/pause, speed, key and the A–B practice loop. */
import { useEffect, useState } from "react";
import { Loader2, Pause, Play, RotateCcw, Repeat } from "lucide-react";

function fmt(t: number) {
  if (!isFinite(t)) return "0:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface Props {
  playing: boolean;
  time: number;
  duration: number;
  rate: number;
  semitones: number;
  loop: [number, number] | null;
  onToggle: () => void;
  onSeek: (t: number) => void;
  onRate: (r: number) => void;
  onSemitones: (s: number) => void;
  onClearLoop: () => void;
  /** 0..1 while the new speed/pitch is being rendered. */
  rendering: number | null;
}

const SPEEDS = [0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1, 1.25, 1.5];

export default function Transport(p: Props) {
  // Changing speed or pitch re-renders the audio, so the sliders only commit
  // when you let go — dragging still moves the label in real time.
  const [rate, setRate] = useState(p.rate);
  const [semitones, setSemitones] = useState(p.semitones);
  useEffect(() => setRate(p.rate), [p.rate]);
  useEffect(() => setSemitones(p.semitones), [p.semitones]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-primary" onClick={p.onToggle} aria-label={p.playing ? "Pause" : "Play"}>
          {p.playing ? <Pause size={16} /> : <Play size={16} />}
          {p.playing ? "Pause" : "Play"}
        </button>
        <button className="btn" onClick={() => p.onSeek(p.loop ? p.loop[0] : 0)} title="Back to start">
          <RotateCcw size={15} />
        </button>
        <span className="font-mono text-sm tabular-nums text-white/70">
          {fmt(p.time)} <span className="text-white/30">/ {fmt(p.duration)}</span>
        </span>
        {p.rendering !== null && (
          <span className="flex items-center gap-2 text-xs text-[var(--color-accent)]">
            <Loader2 className="animate-spin" size={13} />
            Rendering at {Math.round(p.rate * 100)}% — {Math.round(p.rendering * 100)}%
          </span>
        )}
        {p.loop && (
          <button className="btn text-emerald-300" onClick={p.onClearLoop} title="Clear the loop">
            <Repeat size={15} /> {fmt(p.loop[0])}–{fmt(p.loop[1])} ✕
          </button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 flex items-baseline justify-between text-sm text-white/70">
            Speed <b className="font-mono text-white">{Math.round(rate * 100)}%</b>
          </span>
          <input
            type="range" min={0.25} max={1.5} step={0.05} value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
            onPointerUp={() => p.onRate(rate)}
            onKeyUp={() => p.onRate(rate)}
            className="w-full"
          />
          <span className="mt-1 flex flex-wrap gap-1">
            {SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => { setRate(s); p.onRate(s); }}
                className={`rounded px-1.5 py-0.5 text-xs ${
                  Math.abs(rate - s) < 0.005 ? "bg-[var(--color-accent)] text-black" : "bg-white/5 text-white/60 hover:bg-white/10"
                }`}
              >
                {Math.round(s * 100)}%
              </button>
            ))}
          </span>
          <span className="mt-1 block text-xs text-white/40">Pitch stays exactly where it was.</span>
        </label>

        <label className="block">
          <span className="mb-1 flex items-baseline justify-between text-sm text-white/70">
            Transpose <b className="font-mono text-white">{semitones > 0 ? `+${semitones}` : semitones} st</b>
          </span>
          <input
            type="range" min={-12} max={12} step={1} value={semitones}
            onChange={(e) => setSemitones(Number(e.target.value))}
            onPointerUp={() => p.onSemitones(semitones)}
            onKeyUp={() => p.onSemitones(semitones)}
            className="w-full"
          />
          <span className="mt-1 block text-xs text-white/40">
            Move the song into your range — the tempo does not change.
          </span>
        </label>
      </div>
    </div>
  );
}
