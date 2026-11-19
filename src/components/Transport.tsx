"use client";
/** The speed and key sliders (opened from the player bar). */
import { useEffect, useState } from "react";

interface Props {
  rate: number;
  semitones: number;
  onRate: (r: number) => void;
  onSemitones: (s: number) => void;
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
            aria-label="Speed"
            aria-valuetext={`${Math.round(rate * 100)} percent`}
            className="w-full"
          />
          <span className="mt-1 flex flex-wrap gap-1">
            {SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => { setRate(s); p.onRate(s); }}
                aria-pressed={Math.abs(rate - s) < 0.005}
                className={`min-h-6 min-w-6 rounded px-1.5 py-0.5 text-xs ${
                  Math.abs(rate - s) < 0.005 ? "bg-[var(--color-accent)] text-black" : "bg-white/5 text-white/60 hover:bg-white/10"
                }`}
              >
                {Math.round(s * 100)}%
              </button>
            ))}
          </span>
          <span className="mt-1 block text-xs text-faint">Pitch stays exactly where it was.</span>
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
            aria-label="Transpose in semitones"
            aria-valuetext={`${semitones > 0 ? "plus " : ""}${semitones} semitones`}
            className="w-full"
          />
          <span className="mt-1 block text-xs text-faint">
            Move the song into your range — the tempo does not change.
          </span>
        </label>
      </div>
    </div>
  );
}
