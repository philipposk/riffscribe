"use client";
/**
 * Tuner and drone.
 *
 * Neither has anything to do with taking a recording apart, and both are the
 * first things a string player reaches for. They live behind one toggle so
 * they cost nothing — no microphone is opened and no oscillator started until
 * someone asks.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Music4, Square } from "lucide-react";

import { noteName } from "@/lib/audio/analyze";
import { Drone, detectPitch, type Reading } from "@/lib/audio/tuner";

/** Two octaves either side of middle C covers the tonic of anything sane. */
const DRONE_RANGE = { min: 36, max: 84 };

export default function Tuner({ suggestedTonic }: { suggestedTonic?: number }) {
  const [listening, setListening] = useState(false);
  const [reading, setReading] = useState<Reading | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [droneMidi, setDroneMidi] = useState(suggestedTonic ?? 57); // A3
  const [droning, setDroning] = useState(false);

  const stream = useRef<MediaStream | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const drone = useRef<Drone | null>(null);

  useEffect(() => {
    if (suggestedTonic != null) setDroneMidi(suggestedTonic);
  }, [suggestedTonic]);

  const stopListening = useCallback(() => {
    if (timer.current != null) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void ctx.current?.close().catch(() => {});
    ctx.current = null;
    setListening(false);
    setReading(null);
  }, []);

  useEffect(() => () => {
    stopListening();
    void drone.current?.dispose();
  }, [stopListening]);

  async function startListening() {
    setError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        // The browser's cleanup is tuned for speech and will fight an
        // instrument — it gates quiet notes and shifts pitch slightly.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      stream.current = s;
      const c = new AudioContext();
      ctx.current = c;
      const src = c.createMediaStreamSource(s);
      const analyser = c.createAnalyser();
      analyser.fftSize = 4096;
      src.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      setListening(true);

      // A timer rather than requestAnimationFrame: rAF stops dead whenever the
      // window is occluded or in a background tab, and someone tuning may well
      // be looking at their instrument with this window behind another one.
      timer.current = setInterval(() => {
        analyser.getFloatTimeDomainData(buf);
        const r = detectPitch(buf, c.sampleRate);
        // Hold the last reading through short gaps rather than flickering to
        // nothing between bow strokes.
        if (r) setReading(r);
      }, 40);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not open the microphone");
      setListening(false);
    }
  }

  function toggleDrone() {
    drone.current ??= new Drone();
    if (droning) {
      drone.current.stop();
      setDroning(false);
    } else {
      drone.current.start(droneMidi);
      setDroning(true);
    }
  }

  // Retune a running drone as the note is changed, so you can hunt for it.
  useEffect(() => {
    if (droning && drone.current) drone.current.start(droneMidi);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [droneMidi]);

  const cents = reading?.cents ?? 0;
  const inTune = reading != null && Math.abs(cents) <= 5;

  return (
    <section className="panel no-print mb-5 p-5">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-medium">
        <Music4 size={18} className="text-[var(--color-accent)]" /> Tune up
      </h2>

      <div className="grid gap-6 sm:grid-cols-2">
        {/* ---- tuner ---- */}
        <div>
          <div className="mb-2 flex items-center gap-2">
            {!listening ? (
              <button className="btn" onClick={startListening}>
                <Mic size={15} /> Start the tuner
              </button>
            ) : (
              <button className="btn" onClick={stopListening}>
                <Square size={15} /> Stop
              </button>
            )}
          </div>

          <div className="rounded-lg border border-white/10 bg-black/20 p-4 text-center">
            <div className="font-mono text-4xl tabular-nums text-white">
              {reading ? noteName(reading.midi) : "—"}
            </div>
            <div className="mt-1 text-xs text-white/40">
              {reading ? `${reading.hz.toFixed(1)} Hz` : listening ? "play a note" : "not listening"}
            </div>

            {/* A needle, because ±12 cents means nothing to most people. */}
            <div className="relative mt-4 h-2 rounded-full bg-white/10">
              <div className="absolute left-1/2 top-[-4px] h-4 w-px bg-white/30" />
              {reading && (
                <div
                  className={`absolute top-[-3px] h-3 w-3 rounded-full transition-[left] duration-75 ${
                    inTune ? "bg-emerald-400" : "bg-[var(--color-accent)]"
                  }`}
                  style={{
                    left: `calc(${Math.max(0, Math.min(100, 50 + (cents / 50) * 50))}% - 6px)`,
                  }}
                />
              )}
            </div>
            <div className="mt-2 flex justify-between text-[10px] text-white/25">
              <span>−50c</span>
              <span className={inTune ? "text-emerald-300" : "text-white/45"}>
                {reading ? `${cents > 0 ? "+" : ""}${cents}c` : ""}
              </span>
              <span>+50c</span>
            </div>
          </div>
          {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
        </div>

        {/* ---- drone ---- */}
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <button className={`btn ${droning ? "btn-primary" : ""}`} onClick={toggleDrone}>
              {droning ? <Square size={15} /> : <Music4 size={15} />}
              {droning ? "Stop the drone" : "Play a drone"}
            </button>
            <span className="font-mono text-sm text-white/70">{noteName(droneMidi)}</span>
          </div>
          <input
            type="range"
            className="w-full"
            min={DRONE_RANGE.min}
            max={DRONE_RANGE.max}
            step={1}
            value={droneMidi}
            onChange={(e) => setDroneMidi(Number(e.target.value))}
          />
          <p className="mt-2 text-xs text-white/40">
            Hold a drone on the key of the piece and play against it. A note a few cents out beats
            audibly against a drone long before it looks wrong on any meter — which is why this is
            worth more than the needle for intonation.
            {suggestedTonic != null && " Set to the key of the song you loaded."}
          </p>
        </div>
      </div>
    </section>
  );
}
