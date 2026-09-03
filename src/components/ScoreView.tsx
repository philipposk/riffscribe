"use client";
/**
 * Standard notation + tablature, rendered by alphaTab from alphaTex.
 *
 * In play-along mode the score follows the music: the beat being played is
 * highlighted and the page scrolls itself, so you can keep both hands on the
 * instrument.
 *
 * The highlight is drawn by us, not by alphaTab's own cursor. alphaTab will
 * only move its cursor while its synthesiser is up and running, which needs a
 * second AudioContext and a user gesture of its own — and it would then be a
 * second clock, free to drift from the audio you are actually hearing. Instead
 * we ask alphaTab where each written beat sits on the page (boundsLookup) and
 * position the highlight from our own playback position. One clock, no synth.
 */
import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  tex: string;
  zoom: number;
  /** Follow the music: highlight the current beat and auto-scroll. */
  playAlong: boolean;
  /** Playback position, in song seconds. */
  timeSeconds: number;
  /** When each written beat sounds, in song seconds. Index = beat order. */
  timeline: { start: number; end: number }[];
}

interface Rect { x: number; y: number; w: number; h: number }

export default function ScoreView({ tex, zoom, playAlong, timeSeconds, timeline }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const beats = useRef<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [cursor, setCursor] = useState<Rect | null>(null);
  const lastIndex = useRef(-1);

  /** Flatten the score's beats into the order alphaTex emitted them. */
  const collectBeats = useCallback(() => {
    const score = api.current?.score;
    if (!score) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const flat: any[] = [];
    const staff = score.tracks?.[0]?.staves?.[0];
    for (const bar of staff?.bars ?? []) {
      for (const voice of bar.voices ?? []) {
        for (const beat of voice.beats ?? []) if (!beat.isEmpty) flat.push(beat);
      }
    }
    beats.current = flat;
  }, []);

  useEffect(() => {
    let disposed = false;
    (async () => {
      const alphaTab = await import("@coderline/alphatab");
      if (disposed || !host.current) return;
      const instance = new alphaTab.AlphaTabApi(host.current, {
        core: {
          fontDirectory: "/alphatab/font/",
          engine: "svg",
          logLevel: 1,
          // render on the main thread — our scores are small, and this avoids
          // depending on how the bundler emits alphaTab's worker
          useWorkers: false,
          // paint the whole score at once. Lazy loading only fills in the
          // systems currently on screen, which leaves Print/PDF with blank
          // staves for everything below the fold.
          enableLazyLoading: false,
        },
        display: { scale: zoom, layoutMode: "page", staveProfile: "default" },
        // no player: we drive the highlight ourselves — see the file comment
        player: { playerMode: 0, enableCursor: false, enableUserInteraction: true },
      });
      instance.error.on((e: unknown) => {
        setError(e instanceof Error ? e.message : "could not render this score");
      });
      instance.renderFinished.on(() => {
        collectBeats();
        lastIndex.current = -1;
        setReady(true);
      });
      api.current = instance;
      if (tex) {
        try {
          instance.tex(tex);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      disposed = true;
      try {
        api.current?.destroy();
      } catch {
        /* already gone */
      }
      api.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!api.current || !tex) return;
    setError(null);
    setReady(false);
    setCursor(null);
    try {
      api.current.tex(tex);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [tex]);

  useEffect(() => {
    if (!api.current) return;
    api.current.settings.display.scale = zoom;
    api.current.updateSettings();
    api.current.render();
  }, [zoom]);

  // move the highlight, and keep it on screen
  useEffect(() => {
    if (!playAlong || !ready || !timeline.length) {
      if (cursor) setCursor(null);
      return;
    }
    let index = -1;
    for (let i = 0; i < timeline.length; i++) {
      if (timeSeconds >= timeline[i].start && timeSeconds < timeline[i].end) { index = i; break; }
      if (timeline[i].start > timeSeconds) break;
    }
    if (index < 0 || index === lastIndex.current) return;
    lastIndex.current = index;

    const beat = beats.current[index];
    const lookup = api.current?.boundsLookup;
    if (!beat || !lookup) return;
    const bounds = lookup.findBeat(beat);
    if (!bounds) return;

    const bar = bounds.barBounds?.masterBarBounds?.visualBounds;
    const own = bounds.visualBounds;
    const rect: Rect = {
      x: own.x,
      y: bar ? bar.y : own.y,
      w: Math.max(own.w, 6),
      h: bar ? bar.h : own.h,
    };
    setCursor(rect);

    const vp = viewport.current;
    if (vp) {
      const target = rect.y - vp.clientHeight * 0.35;
      if (Math.abs(vp.scrollTop - target) > vp.clientHeight * 0.2) {
        vp.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeSeconds, playAlong, ready, timeline]);

  // If the score is engraved while the tab is hidden the container measures 0px
  // wide and the layout comes out unusable — re-render once it has real width.
  useEffect(() => {
    const el = host.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let lastWidth = el.clientWidth;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (w > 0 && Math.abs(w - lastWidth) > 24) {
        lastWidth = w;
        api.current?.render();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="relative">
      {error && (
        <p className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          Score render failed: {error}
        </p>
      )}
      {!ready && !error && tex && <p className="mb-3 text-sm text-white/50">Engraving…</p>}
      <div
        ref={viewport}
        className={
          playAlong
            ? "at-viewport relative overflow-y-auto overflow-x-hidden rounded-xl bg-white"
            : "relative overflow-x-auto rounded-xl bg-white"
        }
        style={playAlong ? { height: "min(65vh, 620px)" } : undefined}
      >
        <div className="relative">
          <div ref={host} className="at-wrap p-2 text-black" />
          {playAlong && cursor && (
            <div
              className="pointer-events-none absolute rounded-sm"
              style={{
                left: cursor.x + 8,
                top: cursor.y + 8,
                width: cursor.w,
                height: cursor.h,
                background: "rgba(240,180,41,0.30)",
                boxShadow: "0 0 0 1px rgba(240,180,41,0.75)",
                transition: "left 90ms linear, top 140ms ease, width 90ms linear",
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
