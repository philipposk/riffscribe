"use client";
/** Waveform strip: click to seek, drag to set the practice loop. */
import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  peaks: Float32Array | null;
  duration: number;
  time: number;
  loop: [number, number] | null;
  onSeek: (t: number) => void;
  onLoop: (l: [number, number] | null) => void;
}

export default function Waveform({ peaks, duration, time, loop, onSeek, onLoop }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);

  const draw = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== w * dpr || c.height !== h * dpr) {
      c.width = w * dpr;
      c.height = h * dpr;
    }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = "#0b0e13";
    ctx.fillRect(0, 0, w, h);

    if (peaks && peaks.length) {
      ctx.fillStyle = "rgba(232,235,242,0.45)";
      const step = peaks.length / w;
      for (let x = 0; x < w; x++) {
        let p = 0;
        const s = Math.floor(x * step);
        for (let i = s; i < s + step && i < peaks.length; i++) p = Math.max(p, peaks[i]);
        const bar = Math.max(1, p * h * 0.92);
        ctx.fillRect(x, (h - bar) / 2, 1, bar);
      }
    }

    const region = drag ? ([Math.min(drag.from, drag.to), Math.max(drag.from, drag.to)] as [number, number]) : loop;
    if (region && duration > 0) {
      const x0 = (region[0] / duration) * w;
      const x1 = (region[1] / duration) * w;
      ctx.fillStyle = "rgba(52,211,153,0.16)";
      ctx.fillRect(x0, 0, x1 - x0, h);
      ctx.strokeStyle = "rgba(52,211,153,0.8)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 0.5, 0.5, x1 - x0 - 1, h - 1);
    }

    if (duration > 0) {
      const x = (time / duration) * w;
      ctx.fillStyle = "#f0b429";
      ctx.fillRect(x - 1, 0, 2, h);
    }
  }, [peaks, duration, time, loop, drag]);

  useEffect(() => { draw(); }, [draw]);
  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw]);

  const posFor = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration;
  };

  const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

  return (
    <canvas
      ref={canvas}
      // touch-none: without it a finger drag scrolls the page (or is cancelled) instead of drawing a loop.
      className="h-24 w-full cursor-crosshair touch-none rounded-lg border border-[var(--color-line)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
      role="slider"
      tabIndex={0}
      aria-label="Position in the song. Arrow keys move 5 seconds, shift moves 1."
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(time)}
      aria-valuetext={`${fmt(time)} of ${fmt(duration)}`}
      onKeyDown={(e) => {
        if (duration <= 0) return;
        const step = e.shiftKey ? 1 : 5;
        let to: number | null = null;
        if (e.key === "ArrowRight" || e.key === "ArrowUp") to = time + step;
        else if (e.key === "ArrowLeft" || e.key === "ArrowDown") to = time - step;
        else if (e.key === "Home") to = 0;
        else if (e.key === "End") to = duration;
        if (to === null) return;
        e.preventDefault();
        onSeek(Math.max(0, Math.min(duration, to)));
      }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag({ from: posFor(e), to: posFor(e) });
      }}
      onPointerMove={(e) => {
        // A drag that lost its pointer (cancelled, or released elsewhere) must not keep resizing.
        if (drag && e.currentTarget.hasPointerCapture(e.pointerId)) setDrag({ ...drag, to: posFor(e) });
      }}
      onPointerUp={(e) => {
        if (!drag) return;
        const p = posFor(e);
        if (Math.abs(p - drag.from) > duration * 0.01) {
          onLoop([Math.min(drag.from, p), Math.max(drag.from, p)]);
        } else {
          onSeek(p);
          onLoop(null);
        }
        setDrag(null);
      }}
      // The browser took the gesture, or the pointer was lost: abandon the half-drawn loop.
      onPointerCancel={() => setDrag(null)}
      onLostPointerCapture={() => setDrag(null)}
    />
  );
}
