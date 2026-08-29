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

  return (
    <canvas
      ref={canvas}
      className="h-24 w-full cursor-crosshair rounded-lg border border-[var(--color-line)]"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag({ from: posFor(e), to: posFor(e) });
      }}
      onPointerMove={(e) => drag && setDrag({ ...drag, to: posFor(e) })}
      onPointerUp={(e) => {
        const p = posFor(e);
        if (drag && Math.abs(p - drag.from) > duration * 0.01) {
          onLoop([Math.min(drag.from, p), Math.max(drag.from, p)]);
        } else {
          onSeek(p);
          onLoop(null);
        }
        setDrag(null);
      }}
    />
  );
}
