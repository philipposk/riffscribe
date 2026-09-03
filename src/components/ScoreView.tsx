"use client";
/**
 * Standard notation + tablature, rendered by alphaTab from alphaTex.
 *
 * In play-along mode the score also follows the music: alphaTab's own cursor
 * and auto-scroll are switched on, but its synthesiser is muted
 * (`masterVolume = 0`) and it is never told to play. Instead we seek it —
 * `api.timePosition = <song position>` — from our audio engine on every tick,
 * so the highlighted beat and the scrolling are driven by the audio you are
 * actually hearing rather than by a second, drifting clock.
 *
 * No soundfont is loaded: alphaTab only needs the player enabled and a MIDI
 * file generated for the cursor to move, and the sound comes from our own
 * guide track.
 */
import { useEffect, useRef, useState } from "react";

interface Props {
  tex: string;
  zoom: number;
  /** Follow the music: cursor + auto-scroll inside a fixed-height viewport. */
  playAlong: boolean;
  /** Position in the score, in seconds (already offset-corrected). */
  scoreTimeSeconds: number;
}

export default function ScoreView({ tex, zoom, playAlong, scoreTimeSeconds }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

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
        player: {
          // the player has to be on for the cursor to exist at all, but we
          // never call play() and the synth is muted — see the file comment
          playerMode: 2, // PlayerMode.EnabledSynthesizer
          enableCursor: true,
          enableAnimatedBeatCursor: true,
          enableElementHighlighting: true,
          enableUserInteraction: true,
          scrollElement: viewport.current ?? "html,body",
          scrollMode: 1, // ScrollMode.Continuous
          scrollOffsetY: -30,
        },
      });
      instance.error.on((e: unknown) => {
        setError(e instanceof Error ? e.message : "could not render this score");
      });
      instance.renderFinished.on(() => setReady(true));
      instance.playerReady.on(() => {
        instance.masterVolume = 0;
        instance.metronomeVolume = 0;
      });
      instance.masterVolume = 0;
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

  // keep alphaTab's idea of "now" pinned to the audio engine's
  useEffect(() => {
    const a = api.current;
    if (!a || !playAlong || !ready) return;
    const ms = Math.max(0, scoreTimeSeconds * 1000);
    try {
      if (Math.abs(a.timePosition - ms) > 40) a.timePosition = ms;
    } catch {
      /* the player is not ready yet */
    }
  }, [scoreTimeSeconds, playAlong, ready]);

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
            ? "at-viewport overflow-y-auto overflow-x-hidden rounded-xl bg-white"
            : "overflow-x-auto rounded-xl bg-white"
        }
        style={playAlong ? { height: "min(65vh, 620px)" } : undefined}
      >
        <div ref={host} className="at-wrap p-2 text-black" />
      </div>
    </div>
  );
}
