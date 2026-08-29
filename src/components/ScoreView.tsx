"use client";
/** Renders standard notation + tablature with alphaTab, from alphaTex source. */
import { useEffect, useRef, useState } from "react";

interface Props {
  tex: string;
  zoom: number;
}

export default function ScoreView({ tex, zoom }: Props) {
  const host = useRef<HTMLDivElement>(null);
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
        player: { enablePlayer: false, enableCursor: false, enableUserInteraction: true },
      });
      instance.error.on((e: unknown) => {
        setError(e instanceof Error ? e.message : "could not render this score");
      });
      instance.renderFinished.on(() => setReady(true));
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
      {!ready && !error && tex && (
        <p className="mb-3 text-sm text-white/50">Engraving…</p>
      )}
      <div ref={host} className="at-wrap overflow-x-auto rounded-xl bg-white p-2 text-black" />
    </div>
  );
}
